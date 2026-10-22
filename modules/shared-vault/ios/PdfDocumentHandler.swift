import ExpoModulesCore
import Foundation
import UIKit

/// Copies a PDF opened from Files, the share sheet, or another app into
/// the app sandbox, then lets JS route it to the PDF tool.
///
/// iOS delivers the URL through `application(_:open:options:)` and, under
/// the scene lifecycle, through `scene(_:openURLContexts:)`. Expo's scene
/// delegate forwards the scene call into that application method, which
/// reaches this subscriber. Expo Linking then hands the same URL to JS.
/// The security-scoped read has to finish before that method returns, so
/// the copy happens here and JS asks `takeOpenedPdf` for the sandbox file.
///
/// iOS has no user-selectable default PDF app. The Info.plist rank is
/// Alternate, so Everytool appears under Open In and the share sheet.
enum OpenedPdfs {
  struct Copy {
    let uri: String
    let name: String
  }

  private static var copies: [String: Copy] = [:]
  private static let lock = NSLock()

  /// Extensions Files may hand over for Any file → PDF. Photos and Office
  /// stay off this list. Same set as CONVERT_OPEN_EXTENSIONS in pdfOpen.ts.
  static let convertExtensions: Set<String> = [
    "txt", "text", "md", "markdown", "rtf", "rtfd", "html", "htm", "csv", "webarchive",
  ]

  /// Same character rules as `sandboxPdfFileName` in src/lib/pdfOpen.ts.
  static func sandboxFileName(displayName: String, unique: String) -> String {
    var stem = displayName
    if stem.lowercased().hasSuffix(".pdf") {
      stem = String(stem.dropLast(4))
    }
    let forbidden = CharacterSet(charactersIn: "\\/:*?\"<>|")
    stem = stem.components(separatedBy: forbidden).joined().trimmingCharacters(in: .whitespacesAndNewlines)
    if stem.isEmpty { stem = "document" }
    if stem.count > 80 { stem = String(stem.prefix(80)) }
    let id = unique.unicodeScalars.filter { scalar in
      (scalar.value >= 48 && scalar.value <= 57)
        || (scalar.value >= 65 && scalar.value <= 90)
        || (scalar.value >= 97 && scalar.value <= 122)
        || scalar.value == 45 || scalar.value == 95
    }.map { Character($0) }
    let safeId = id.isEmpty ? "open" : String(id)
    return "\(safeId)-\(stem).pdf"
  }

  static func displayName(for url: URL) -> String {
    let raw = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
    let ext = url.pathExtension.lowercased()
    if ext == "etsplit" {
      if raw.isEmpty { return "group.etsplit" }
      return raw.lowercased().hasSuffix(".etsplit") ? raw : "\(raw).etsplit"
    }
    if ext != "pdf" && convertExtensions.contains(ext) {
      if raw.isEmpty { return "document.\(ext)" }
      return raw
    }
    if raw.isEmpty { return "document.pdf" }
    return raw.lowercased().hasSuffix(".pdf") ? raw : "\(raw).pdf"
  }

  /// Same character rules as `sandboxConvertFileName` in src/lib/pdfOpen.ts.
  static func sandboxConvertFileName(displayName: String, unique: String) -> String {
    var clean = displayName.components(separatedBy: CharacterSet(charactersIn: "\\/:*?\"<>|")).joined()
    clean = clean.trimmingCharacters(in: .whitespacesAndNewlines)
    if clean.isEmpty { clean = "document.txt" }
    let ext = (clean as NSString).pathExtension.lowercased()
    var stem = (clean as NSString).deletingPathExtension
    stem = stem.trimmingCharacters(in: .whitespacesAndNewlines)
    if stem.isEmpty { stem = "document" }
    if stem.count > 80 { stem = String(stem.prefix(80)) }
    let id = unique.unicodeScalars.filter { scalar in
      (scalar.value >= 48 && scalar.value <= 57)
        || (scalar.value >= 65 && scalar.value <= 90)
        || (scalar.value >= 97 && scalar.value <= 122)
        || scalar.value == 45 || scalar.value == 95
    }.map { Character($0) }
    let safeId = id.isEmpty ? "open" : String(id)
    let suffix = ext.isEmpty ? "txt" : ext
    return "\(safeId)-\(stem).\(suffix)"
  }

  private static func directory() -> URL {
    let base = FileManager.default
      .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("OpenedPdfs", isDirectory: true)
    try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
  }

  /// Start security-scoped access, copy the bytes into the sandbox, then
  /// drop the scope. The caller's file is left where it was.
  static func adopt(_ url: URL) {
    let ext = url.pathExtension.lowercased()
    let convertible = convertExtensions.contains(ext) || ext == "etsplit"
    guard url.isFileURL, ext == "pdf" || convertible else { return }
    let accessing = url.startAccessingSecurityScopedResource()
    defer {
      if accessing { url.stopAccessingSecurityScopedResource() }
    }
    let name = displayName(for: url)
    let unique = "\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6))"
    let stored = convertible
      ? sandboxConvertFileName(displayName: name, unique: unique)
      : sandboxFileName(displayName: name, unique: unique)
    let dest = directory().appendingPathComponent(stored)
    // copyItem while the scope is held. A coordinator here runs on the
    // main thread inside openURL and can deadlock against a file presenter.
    do {
      if FileManager.default.fileExists(atPath: dest.path) {
        try FileManager.default.removeItem(at: dest)
      }
      try FileManager.default.copyItem(at: url, to: dest)
    } catch {
      return
    }
    let copy = Copy(uri: dest.absoluteString, name: name)
    lock.lock()
    copies[url.absoluteString] = copy
    copies[url.path] = copy
    lock.unlock()
  }

  /// Lookup, not consume. Files and the scene delegate can deliver the
  /// same URL twice; both deliveries have to resolve to the sandbox copy.
  static func take(_ source: String) -> [String: String]? {
    lock.lock()
    defer { lock.unlock() }
    if let hit = copies[source] {
      return ["uri": hit.uri, "name": hit.name]
    }
    let path = URL(string: source)?.path
    guard let path else { return nil }
    if let hit = copies[path] {
      return ["uri": hit.uri, "name": hit.name]
    }
    return nil
  }
}

/// Registered from expo-module.config.json so both open-URL entry points
/// run this before JavaScript reads the file.
public class PdfDocumentHandler: ExpoAppDelegateSubscriber {
  public func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    let ext = url.pathExtension.lowercased()
    guard url.isFileURL, ext == "pdf" || ext == "etsplit" || OpenedPdfs.convertExtensions.contains(ext) else { return false }
    OpenedPdfs.adopt(url)
    return true
  }
}
