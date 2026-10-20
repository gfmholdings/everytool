import AppIntents
import CoreImage
import Foundation
import ImageIO
import PDFKit
import UniformTypeIdentifiers

// Siri & Shortcuts actions for every Everytool tool. Compiled into the
// MAIN APP target (plugins/withOpenToolIntent.js copies this file at
// prebuild) — App Intents metadata is only extracted from the app's own
// sources. The app target also compiles targets/_shared/SharedVault.swift.
//
// Actions that need a screen open Everytool at the right tool; the rest
// run in the background and hand their result back to Shortcuts.

private let groupId = "group.app.everytool.ios"

struct EverytoolIntentError: Error, CustomLocalizedStringResourceConvertible {
  let message: String
  var localizedStringResource: LocalizedStringResource {
    LocalizedStringResource(stringLiteral: message)
  }
}

// MARK: - Open a tool

enum EverytoolTool: String, AppEnum {
  case stitch, clipboard, convert, qr, resize, pdf, text, days, split, gif

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Everytool Tool"
  static let caseDisplayRepresentations: [EverytoolTool: DisplayRepresentation] = [
    .stitch: "Long Screenshot",
    .clipboard: "Clipboard",
    .convert: "Convert",
    .qr: "QR Toolbox",
    .resize: "Resize Photo",
    .pdf: "PDF Tools",
    .text: "Text Tools",
    .days: "Days Counter",
    .split: "Split Bill",
    .gif: "Video to GIF",
  ]
}

private func requestTool(_ ref: String) {
  UserDefaults(suiteName: groupId)?.set(ref, forKey: "everytool.pendingTool")
}

struct OpenEverytoolToolIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Everytool Tool"
  static let openAppWhenRun = true

  @Parameter(title: "Tool")
  var tool: EverytoolTool

  func perform() async throws -> some IntentResult {
    requestTool(tool.rawValue)
    return .result()
  }
}

// MARK: - Long screenshot

struct StartLongScreenshotIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Long Screenshot"
  static let openAppWhenRun = false

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let ms = Int64(Date().timeIntervalSince1970 * 1000)
    UserDefaults(suiteName: groupId)?.set(String(ms), forKey: "everytool.screenshotSession")
    return .result(dialog: "Take screenshots as you scroll, then say “Stitch screenshots in Everytool”.")
  }
}

struct StitchScreenshotsIntent: AppIntent {
  static let title: LocalizedStringResource = "Stitch Screenshots"
  static let openAppWhenRun = true

  func perform() async throws -> some IntentResult {
    requestTool("stitch:session")
    return .result()
  }
}

// MARK: - Clipboard

struct SaveClipIntent: AppIntent {
  static let title: LocalizedStringResource = "Save to Everytool Clipboard"

  @Parameter(title: "Text")
  var text: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard SharedVault.saveClip(text) else {
      throw EverytoolIntentError(message: "There's no text to save.")
    }
    return .result(dialog: "Saved to your Everytool clipboard.")
  }
}

struct GetClipsIntent: AppIntent {
  static let title: LocalizedStringResource = "Get Everytool Clips"

  @Parameter(title: "Pinned only", default: false)
  var pinnedOnly: Bool

  func perform() async throws -> some IntentResult & ReturnsValue<[String]> {
    let clips = SharedVault.clips()
      .filter { !pinnedOnly || (($0["pinned"] as? Bool) ?? false) }
      .compactMap { $0["text"] as? String }
    return .result(value: clips)
  }
}

// MARK: - Text tools

struct TextStatsIntent: AppIntent {
  static let title: LocalizedStringResource = "Count Words"

  @Parameter(title: "Text")
  var text: String

  func perform() async throws -> some IntentResult & ReturnsValue<Int> & ProvidesDialog {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let words = trimmed.isEmpty ? 0 : trimmed.split(whereSeparator: { $0.isWhitespace }).count
    let lines = text.isEmpty ? 0 : text.split(separator: "\n", omittingEmptySubsequences: false).count
    return .result(
      value: words,
      dialog: "\(words) words, \(text.count) characters, \(lines) lines."
    )
  }
}

enum ExtractKind: String, AppEnum {
  case links, emails, phones
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "What to find"
  static let caseDisplayRepresentations: [ExtractKind: DisplayRepresentation] = [
    .links: "Links", .emails: "Email addresses", .phones: "Phone numbers",
  ]
}

struct ExtractFromTextIntent: AppIntent {
  static let title: LocalizedStringResource = "Find Links, Emails or Phone Numbers"

  @Parameter(title: "Find", default: .links)
  var kind: ExtractKind

  @Parameter(title: "Text")
  var text: String

  func perform() async throws -> some IntentResult & ReturnsValue<[String]> {
    let pattern: String
    switch kind {
    case .links: pattern = #"(https?://|www\.)[^\s<>"')\]]+"#
    case .emails: pattern = #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#
    case .phones: pattern = #"(\+?1[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}"#
    }
    let regex = try NSRegularExpression(pattern: pattern)
    var seen = Set<String>()
    var out: [String] = []
    for m in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
      guard let r = Range(m.range, in: text) else { continue }
      var v = String(text[r])
      if kind == .links {
        v = v.replacingOccurrences(of: #"[.,;:!?]+$"#, with: "", options: .regularExpression)
      }
      if seen.insert(v.lowercased()).inserted { out.append(v) }
    }
    return .result(value: out)
  }
}

// MARK: - Days & bills

struct DaysUntilIntent: AppIntent {
  static let title: LocalizedStringResource = "Days Until"

  @Parameter(title: "Date")
  var date: Date

  func perform() async throws -> some IntentResult & ReturnsValue<Int> & ProvidesDialog {
    let cal = Calendar.current
    let n = cal.dateComponents([.day], from: cal.startOfDay(for: Date()), to: cal.startOfDay(for: date)).day ?? 0
    let words = n == 0 ? "That's today." : (n > 0 ? "\(n) days to go." : "That was \(-n) days ago.")
    return .result(value: n, dialog: IntentDialog(stringLiteral: words))
  }
}

struct SplitBillIntent: AppIntent {
  static let title: LocalizedStringResource = "Split a Bill"

  @Parameter(title: "Bill total")
  var total: Double

  @Parameter(title: "Tip percent", default: 18)
  var tipPercent: Double

  @Parameter(title: "Tax", default: 0)
  var tax: Double

  @Parameter(title: "People", default: 2)
  var people: Int

  func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    // Integer cents, same rule as src/lib/money.ts: shares sum exactly.
    let totalCents = Int((max(0, total) * 100).rounded())
    let taxCents = Int((max(0, tax) * 100).rounded())
    let tipCents = Int((Double(totalCents) * max(0, tipPercent) / 100).rounded())
    let grand = totalCents + taxCents + tipCents
    let n = max(1, people)
    let base = grand / n
    let extra = grand - base * n
    func money(_ c: Int) -> String { String(format: "$%d.%02d", c / 100, c % 100) }
    let summary = extra == 0
      ? "\(money(base)) each (total \(money(grand)))"
      : "\(extra) pay \(money(base + 1)), \(n - extra) pay \(money(base)) (total \(money(grand)))"
    return .result(value: summary, dialog: IntentDialog(stringLiteral: summary))
  }
}

// MARK: - QR

struct MakeQRCodeIntent: AppIntent {
  static let title: LocalizedStringResource = "Make QR Code"

  @Parameter(title: "Text or link")
  var text: String

  func perform() async throws -> some IntentResult & ReturnsValue<IntentFile> {
    guard
      !text.isEmpty,
      let filter = CIFilter(name: "CIQRCodeGenerator")
    else { throw EverytoolIntentError(message: "There's nothing to encode.") }
    filter.setValue(Data(text.utf8), forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let output = filter.outputImage else {
      throw EverytoolIntentError(message: "That text is too long for a QR code.")
    }
    let scale = max(1, 1024 / output.extent.width)
    let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let cg = CIContext().createCGImage(scaled, from: scaled.extent) else {
      throw EverytoolIntentError(message: "Couldn't draw the QR code.")
    }
    let data = try encode(cg, as: .png, quality: 1)
    return .result(value: IntentFile(data: data, filename: "QR Code.png", type: .png))
  }
}

// MARK: - Images

enum ImageFormatOption: String, AppEnum {
  case jpg, png, heic
  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Format"
  static let caseDisplayRepresentations: [ImageFormatOption: DisplayRepresentation] = [
    .jpg: "JPG", .png: "PNG", .heic: "HEIC",
  ]
  var utType: UTType {
    switch self {
    case .jpg: return .jpeg
    case .png: return .png
    case .heic: return .heic
    }
  }
}

private func encode(_ image: CGImage, as type: UTType, quality: Double) throws -> Data {
  let out = NSMutableData()
  guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, type.identifier as CFString, 1, nil) else {
    throw EverytoolIntentError(message: "This iPhone can't write \(type.preferredFilenameExtension ?? "that format").")
  }
  CGImageDestinationAddImage(
    dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
  guard CGImageDestinationFinalize(dest) else {
    throw EverytoolIntentError(message: "Couldn't save the image.")
  }
  return out as Data
}

/// Decode with orientation applied, optionally limiting the width.
/// Re-encoding through CGImage carries no GPS/EXIF over.
private func loadImage(_ data: Data, maxWidth: Int?) throws -> CGImage {
  guard let src = CGImageSourceCreateWithData(data as CFData, nil),
    let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
    let w = props[kCGImagePropertyPixelWidth] as? Int,
    let h = props[kCGImagePropertyPixelHeight] as? Int
  else { throw EverytoolIntentError(message: "That file isn't an image Everytool can read.") }
  let orientation = (props[kCGImagePropertyOrientation] as? Int) ?? 1
  let rotated = orientation >= 5
  let shownW = rotated ? h : w
  let longSide = max(w, h)
  var target = longSide
  if let maxWidth, maxWidth > 0, maxWidth < shownW {
    target = Int((Double(longSide) * Double(maxWidth) / Double(shownW)).rounded())
  }
  let opts: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: target,
  ]
  guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else {
    throw EverytoolIntentError(message: "Couldn't read that image.")
  }
  return cg
}

private func baseName(_ file: IntentFile) -> String {
  let name = (file.filename as NSString).deletingPathExtension
  return name.isEmpty ? "Image" : name
}

struct ConvertImageIntent: AppIntent {
  static let title: LocalizedStringResource = "Convert Image"

  @Parameter(title: "Image", supportedTypeIdentifiers: ["public.image"])
  var image: IntentFile

  @Parameter(title: "Format", default: .jpg)
  var format: ImageFormatOption

  func perform() async throws -> some IntentResult & ReturnsValue<IntentFile> {
    let cg = try loadImage(image.data, maxWidth: nil)
    let data = try encode(cg, as: format.utType, quality: 0.92)
    let ext = format.utType.preferredFilenameExtension ?? format.rawValue
    return .result(value: IntentFile(data: data, filename: "\(baseName(image)).\(ext)", type: format.utType))
  }
}

struct ResizeImageIntent: AppIntent {
  static let title: LocalizedStringResource = "Resize Image"

  @Parameter(title: "Image", supportedTypeIdentifiers: ["public.image"])
  var image: IntentFile

  @Parameter(title: "Width", default: 1080)
  var width: Int

  @Parameter(title: "Quality (0–1)", default: 0.75)
  var quality: Double

  func perform() async throws -> some IntentResult & ReturnsValue<IntentFile> {
    let cg = try loadImage(image.data, maxWidth: max(16, width))
    let data = try encode(cg, as: .jpeg, quality: min(1, max(0.1, quality)))
    return .result(value: IntentFile(data: data, filename: "\(baseName(image))-\(cg.width).jpg", type: .jpeg))
  }
}

struct RemoveLocationIntent: AppIntent {
  static let title: LocalizedStringResource = "Remove Location from Photo"

  @Parameter(title: "Photo", supportedTypeIdentifiers: ["public.image"])
  var image: IntentFile

  func perform() async throws -> some IntentResult & ReturnsValue<IntentFile> {
    guard
      let src = CGImageSourceCreateWithData(image.data as CFData, nil),
      let type = CGImageSourceGetType(src)
    else { throw EverytoolIntentError(message: "That file isn't an image Everytool can read.") }
    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, type, 1, nil) else {
      throw EverytoolIntentError(message: "Couldn't write the photo.")
    }
    let options: [CFString: Any] = [
      kCGImageMetadataShouldExcludeGPS: true,
      kCGImageMetadataShouldExcludeXMP: true,
    ]
    guard CGImageDestinationCopyImageSource(dest, src, options as CFDictionary, nil) else {
      throw EverytoolIntentError(message: "Couldn't remove the location.")
    }
    let ut = UTType(type as String) ?? .jpeg
    return .result(value: IntentFile(data: out as Data, filename: image.filename, type: ut))
  }
}

// MARK: - PDF

struct MergePDFsIntent: AppIntent {
  static let title: LocalizedStringResource = "Merge PDFs"

  @Parameter(title: "PDFs", supportedTypeIdentifiers: ["com.adobe.pdf"])
  var files: [IntentFile]

  func perform() async throws -> some IntentResult & ReturnsValue<IntentFile> {
    let out = PDFDocument()
    for file in files {
      guard let doc = PDFDocument(data: file.data) else {
        throw EverytoolIntentError(message: "“\(file.filename)” isn't a PDF Everytool can read.")
      }
      for i in 0..<doc.pageCount {
        if let page = doc.page(at: i) { out.insert(page, at: out.pageCount) }
      }
    }
    guard out.pageCount > 0, let data = out.dataRepresentation() else {
      throw EverytoolIntentError(message: "Add at least one PDF.")
    }
    return .result(value: IntentFile(data: data, filename: "Merged.pdf", type: .pdf))
  }
}

// MARK: - Siri phrases (shown in the Shortcuts app automatically)

struct EverytoolShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartLongScreenshotIntent(),
      phrases: ["Start a long screenshot in \(.applicationName)", "Start \(.applicationName) screenshots"]
    )
    AppShortcut(
      intent: StitchScreenshotsIntent(),
      phrases: ["Stitch screenshots in \(.applicationName)", "Make my long screenshot in \(.applicationName)"]
    )
    AppShortcut(
      intent: OpenEverytoolToolIntent(),
      phrases: ["Open \(\.$tool) in \(.applicationName)", "Open \(.applicationName) \(\.$tool)"]
    )
    AppShortcut(
      intent: SaveClipIntent(),
      phrases: ["Save to \(.applicationName) clipboard", "Save a clip in \(.applicationName)"]
    )
    AppShortcut(
      intent: MakeQRCodeIntent(),
      phrases: ["Make a QR code with \(.applicationName)"]
    )
    AppShortcut(
      intent: SplitBillIntent(),
      phrases: ["Split a bill with \(.applicationName)"]
    )
    AppShortcut(
      intent: DaysUntilIntent(),
      phrases: ["Count days with \(.applicationName)"]
    )
    AppShortcut(
      intent: ConvertImageIntent(),
      phrases: ["Convert an image with \(.applicationName)"]
    )
    AppShortcut(
      intent: RemoveLocationIntent(),
      phrases: ["Remove photo location with \(.applicationName)"]
    )
    AppShortcut(
      intent: MergePDFsIntent(),
      phrases: ["Merge PDFs with \(.applicationName)"]
    )
  }
}
