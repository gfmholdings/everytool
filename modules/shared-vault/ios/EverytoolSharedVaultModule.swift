import AVFoundation
import CoreGraphics
import ExpoModulesCore
import ImageIO
import ReplayKit
import UIKit
import UserNotifications
import Vision
import WidgetKit

/// The shared App Group store. The app, keyboard, share extension and
/// broadcast extension all keep one JSON document ("everytool.state.v1")
/// in the App Group's UserDefaults suite, plus files (share inbox,
/// broadcast frames) in the group container. This module is the app's
/// side of that contract; each extension compiles targets/_shared/
/// SharedVault.swift for the same keys.
public class EverytoolSharedVaultModule: Module {
  /// Kept alive while Apple's broadcast sheet is up; released on the next
  /// call. The picker is the only public way to start a ReplayKit
  /// broadcast from inside an app.
  private var picker: RPSystemBroadcastPickerView?

  public func definition() -> ModuleDefinition {
    Name("EverytoolSharedVault")

    Function("readStateJson") { (groupId: String) -> String? in
      UserDefaults(suiteName: groupId)?.string(forKey: "everytool.state.v1")
    }

    Function("writeStateJson") { (groupId: String, json: String) -> Bool in
      guard let defaults = UserDefaults(suiteName: groupId) else { return false }
      defaults.set(json, forKey: "everytool.state.v1")
      // Flush before returning: AppStore mutations are read-modify-write
      // through a FRESH suite instance per call, and two commits can land
      // back to back in one tap (clip Save writes the snippet word, then
      // the text). Without the flush the second commit's read can see
      // the pre-write document and silently overwrite the first commit —
      // that is exactly how a saved snippet word was lost (Codemagic
      // runs 6ad8302e/6ad83868/6ad83eb4, flow 03).
      defaults.synchronize()
      return true
    }

    Function("groupContainerUri") { (groupId: String) -> String? in
      FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: groupId)?
        .absoluteString
    }

    /// Control Center controls record the tool they want here. The app
    /// takes it — read + clear — on activation.
    Function("takePendingTool") { (groupId: String) -> String? in
      guard let defaults = UserDefaults(suiteName: groupId) else { return nil }
      let tool = defaults.string(forKey: "everytool.pendingTool")
      if tool != nil {
        defaults.removeObject(forKey: "everytool.pendingTool")
        defaults.synchronize()
      }
      return tool
    }

    /// Small string values shared with the extensions — e.g. the
    /// screenshot-session start time the "Start Screenshots" control sets.
    Function("readGroupString") { (groupId: String, key: String) -> String? in
      UserDefaults(suiteName: groupId)?.string(forKey: key)
    }

    Function("writeGroupString") { (groupId: String, key: String, value: String?) -> Bool in
      guard let defaults = UserDefaults(suiteName: groupId) else { return false }
      if let value { defaults.set(value, forKey: key) } else { defaults.removeObject(forKey: key) }
      defaults.synchronize()
      return true
    }

    /// Tell the Days counter widgets that countdowns changed.
    Function("reloadWidgets") { () -> Void in
      WidgetCenter.shared.reloadAllTimelines()
    }

    /// On-device text recognition (Apple Vision) for receipt scanning.
    /// Boxes are normalised 0–1 with the origin at the top-left.
    AsyncFunction("recognizeText") { (uri: String) throws -> [[String: Any]] in
      guard
        let url = URL(string: uri),
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
      else { return [] }
      var orientation = CGImagePropertyOrientation.up
      if let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
         let raw = props[kCGImagePropertyOrientation] as? UInt32,
         let o = CGImagePropertyOrientation(rawValue: raw) {
        orientation = o
      }
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = false
      let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
      try handler.perform([request])
      let observations = request.results ?? []
      return observations.compactMap { obs -> [String: Any]? in
        guard let top = obs.topCandidates(1).first else { return nil }
        let b = obs.boundingBox
        return [
          "text": top.string,
          "x": Double(b.minX),
          "y": Double(1 - b.maxY),
          "width": Double(b.width),
          "height": Double(b.height),
        ]
      }
    }

    /// Copy a photo without its location (GPS) and XMP metadata. For JPEG
    /// and HEIC this is lossless: the image data is not re-encoded.
    Function("stripLocation") { (inputUri: String, outputUri: String) -> Bool in
      guard
        let inURL = URL(string: inputUri),
        let outURL = URL(string: outputUri),
        let source = CGImageSourceCreateWithURL(inURL as CFURL, nil),
        let type = CGImageSourceGetType(source),
        let dest = CGImageDestinationCreateWithURL(outURL as CFURL, type, 1, nil)
      else { return false }
      let options: [CFString: Any] = [
        kCGImageMetadataShouldExcludeGPS: true,
        kCGImageMetadataShouldExcludeXMP: true,
      ]
      return CGImageDestinationCopyImageSource(dest, source, options as CFDictionary, nil)
    }

    /// True when the image file carries GPS location metadata.
    Function("imageHasLocation") { (uri: String) -> Bool in
      guard
        let url = URL(string: uri),
        let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
      else { return false }
      return props[kCGImagePropertyGPSDictionary] != nil
    }

    /// Opens Apple's screen-broadcast sheet with the Everytool broadcast
    /// extension preselected. The user taps Start Broadcast; ReplayKit
    /// hands frames to targets/broadcast. Returns false when no window
    /// is available to host the picker.
    AsyncFunction("showBroadcastPicker") { (extensionBundleId: String) -> Bool in
      self.picker?.removeFromSuperview()
      let picker = RPSystemBroadcastPickerView(
        frame: CGRect(x: 0, y: 0, width: 44, height: 44)
      )
      picker.preferredExtension = extensionBundleId
      picker.showsMicrophoneButton = false
      picker.alpha = 0.011
      let window = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first { $0.isKeyWindow }
      guard let window else { return false }
      window.addSubview(picker)
      self.picker = picker
      for case let button as UIButton in picker.subviews {
        button.sendActions(for: .touchUpInside)
        return true
      }
      // Some iOS versions nest the button one level deeper.
      for sub in picker.subviews {
        for case let button as UIButton in sub.subviews {
          button.sendActions(for: .touchUpInside)
          return true
        }
      }
      return false
    }
    .runOnQueue(.main)

    /// Re-encode a photo on device. `format` is jpeg, png, or heic.
    /// `maxWidth` 0 keeps the pixel width. Quality is 0...1 (PNG ignores it).
    /// Metadata (EXIF, GPS) is omitted when `stripMetadata` is true.
    /// Returns the byte size, or -1 if the encode failed. No network.
    Function("reencodeImage") {
      (
        inputUri: String,
        outputUri: String,
        format: String,
        quality: Double,
        maxWidth: Int,
        stripMetadata: Bool
      ) -> Int in
      guard
        let inURL = URL(string: inputUri),
        let outURL = URL(string: outputUri),
        let data = try? Data(contentsOf: inURL),
        let image = UIImage(data: data)
      else { return -1 }
      let pixelW = max(1, Int((image.size.width * image.scale).rounded()))
      let pixelH = max(1, Int((image.size.height * image.scale).rounded()))
      let outW = maxWidth > 0 && maxWidth < pixelW ? maxWidth : pixelW
      let outH = max(1, Int((Double(pixelH) * Double(outW) / Double(pixelW)).rounded()))
      let rendererFormat = UIGraphicsImageRendererFormat()
      rendererFormat.scale = 1
      rendererFormat.opaque = format != "png"
      let renderer = UIGraphicsImageRenderer(
        size: CGSize(width: outW, height: outH),
        format: rendererFormat
      )
      let drawn = renderer.image { _ in
        image.draw(in: CGRect(x: 0, y: 0, width: outW, height: outH))
      }
      guard let cg = drawn.cgImage else { return -1 }
      let uti: CFString
      switch format {
      case "png": uti = "public.png" as CFString
      case "heic": uti = "public.heic" as CFString
      default: uti = "public.jpeg" as CFString
      }
      let encoded = NSMutableData()
      guard let dest = CGImageDestinationCreateWithData(encoded, uti, 1, nil) else {
        return -1
      }
      var props: [CFString: Any] = [
        kCGImageDestinationLossyCompressionQuality: min(1, max(0, quality)),
      ]
      if !stripMetadata,
        let source = CGImageSourceCreateWithURL(inURL as CFURL, nil),
        let original = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] {
        for (key, value) in original { props[key] = value }
        // The draw above already baked orientation, so the tag must say "up".
        props[kCGImagePropertyOrientation] = 1
        props[kCGImageDestinationLossyCompressionQuality] = min(1, max(0, quality))
      }
      CGImageDestinationAddImage(dest, cg, props as CFDictionary)
      guard CGImageDestinationFinalize(dest) else { return -1 }
      do {
        if FileManager.default.fileExists(atPath: outURL.path) {
          try FileManager.default.removeItem(at: outURL)
        }
        try encoded.write(to: outURL, options: .atomic)
      } catch {
        return -1
      }
      return encoded.length
    }

    /// Sandbox copy made by PdfDocumentHandler while the security scope
    /// was still open. A second delivery of the same URL still resolves.
    Function("takeOpenedPdf") { (sourceUrl: String) -> [String: String]? in
      OpenedPdfs.take(sourceUrl)
    }

    /// Video frames as raw 8-bit sRGB RGBA files. One generator, exact
    /// timestamps, upright pixels. The GIF encoder reads these bytes
    /// directly — there is no PNG, JPEG, or HEIC in between, because
    /// ImageIO's stills of HEVC/HDR/P3 clips are often 16-bit and the
    /// JS PNG decoder rejects them ("Unsupported PNG format.").
    AsyncFunction("sampleVideoFrames") {
      (videoUri: String, timesMs: [Double], maxWidth: Int) async throws -> [[String: Any]] in
      try await sampleVideoFrames(videoUri: videoUri, timesMs: timesMs, maxWidth: maxWidth)
    }

    /// Lets the broadcast extension post "Your long screenshot is ready"
    /// when the recording stops. Optional — stitching works without it.
    AsyncFunction("requestNotificationPermission") { () async -> Bool in
      let center = UNUserNotificationCenter.current()
      let granted = try? await center.requestAuthorization(options: [.alert, .sound])
      return granted ?? false
    }
  }
}

private func gifSampleError(_ message: String) -> NSError {
  NSError(
    domain: "EverytoolGif",
    code: 1,
    userInfo: [NSLocalizedDescriptionKey: message]
  )
}

private func videoFileURL(from uri: String) -> URL? {
  if uri.hasPrefix("/") {
    return URL(fileURLWithPath: uri)
  }
  guard let url = URL(string: uri), url.scheme != "ph", url.scheme != "assets-library" else {
    return nil
  }
  return url
}

/// Draw one generator image into straight 8-bit sRGB RGBA, top row first.
/// HDR and Display P3 are tone-mapped through an SDR renderer first so a
/// 16-bit or wide-gamut CGImage cannot reach the GIF encoder.
private func straightSrgbRgba(from image: CGImage, maxWidth: Int) -> (Data, Int, Int)? {
  let srcW = image.width
  let srcH = image.height
  guard srcW > 0, srcH > 0 else { return nil }
  let limit = min(4096, max(1, maxWidth))
  let scale = srcW > limit ? Double(limit) / Double(srcW) : 1
  var outW = max(1, Int((Double(srcW) * scale).rounded()))
  var outH = max(1, Int((Double(srcH) * scale).rounded()))
  let tallest = limit * 3
  if outH > tallest {
    let fit = Double(tallest) / Double(outH)
    outW = max(1, Int((Double(outW) * fit).rounded()))
    outH = tallest
  }

  let format = UIGraphicsImageRendererFormat()
  format.scale = 1
  format.opaque = true
  format.preferredRange = .standard
  let renderer = UIGraphicsImageRenderer(
    size: CGSize(width: outW, height: outH),
    format: format
  )
  let rendered = renderer.image { _ in
    UIImage(cgImage: image).draw(in: CGRect(x: 0, y: 0, width: outW, height: outH))
  }
  guard let cg = rendered.cgImage, let cs = CGColorSpace(name: CGColorSpace.sRGB) else {
    return nil
  }

  let rowBytes = outW * 4
  var raw = Data(count: outH * rowBytes)
  let drew = raw.withUnsafeMutableBytes { (buf: UnsafeMutableRawBufferPointer) -> Bool in
    guard let base = buf.baseAddress else { return false }
    guard let ctx = CGContext(
      data: base,
      width: outW,
      height: outH,
      bitsPerComponent: 8,
      bytesPerRow: rowBytes,
      space: cs,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
    ) else { return false }
    ctx.interpolationQuality = .high
    // Quartz bitmaps are bottom-up. Flip so byte 0 is the top-left pixel.
    ctx.translateBy(x: 0, y: CGFloat(outH))
    ctx.scaleBy(x: 1, y: -1)
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: outW, height: outH))
    return true
  }
  guard drew else { return nil }

  raw.withUnsafeMutableBytes { (buf: UnsafeMutableRawBufferPointer) in
    let pixels = buf.bindMemory(to: UInt8.self)
    var i = 0
    while i + 3 < pixels.count {
      let alpha = Int(pixels[i + 3])
      if alpha == 0 {
        pixels[i] = 0
        pixels[i + 1] = 0
        pixels[i + 2] = 0
      } else if alpha < 255 {
        pixels[i] = UInt8(min(255, Int(pixels[i]) * 255 / alpha))
        pixels[i + 1] = UInt8(min(255, Int(pixels[i + 1]) * 255 / alpha))
        pixels[i + 2] = UInt8(min(255, Int(pixels[i + 2]) * 255 / alpha))
      }
      pixels[i + 3] = 255
      i += 4
    }
  }
  return (raw, outW, outH)
}

/// Sample every requested time with one image generator.
/// `appliesPreferredTrackTransform` turns portrait clips and rotated
/// screen recordings upright. Tolerance is zero so a 60fps source is
/// read on the asked frame, not a nearby keyframe. Times are milliseconds.
private func sampleVideoFrames(
  videoUri: String,
  timesMs: [Double],
  maxWidth: Int
) async throws -> [[String: Any]] {
  guard let url = videoFileURL(from: videoUri) else {
    throw gifSampleError("Couldn’t open that video.")
  }
  let asset = AVURLAsset(
    url: url,
    options: [AVURLAssetPreferPreciseDurationAndTimingKey: true]
  )
  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  generator.requestedTimeToleranceBefore = .zero
  generator.requestedTimeToleranceAfter = .zero
  let cap = min(4096, max(1, maxWidth))
  // Width is the GIF size. Height follows the upright aspect, capped so
  // a pathological track cannot allocate a multi-hundred-megabyte frame.
  generator.maximumSize = CGSize(width: cap, height: cap * 3)

  var frames: [[String: Any]] = []
  for ms in timesMs {
    let time = CMTime(seconds: max(0, ms) / 1000, preferredTimescale: 60000)
    let cgImage: CGImage
    do {
      let (image, _) = try await generator.image(at: time)
      cgImage = image
    } catch {
      continue
    }
    guard let (data, width, height) = straightSrgbRgba(from: cgImage, maxWidth: cap) else {
      continue
    }
    let file = FileManager.default.temporaryDirectory
      .appendingPathComponent("everytool-rgba-\(UUID().uuidString).rgba")
    do {
      try data.write(to: file, options: .atomic)
    } catch {
      continue
    }
    frames.append([
      "uri": file.absoluteString,
      "width": width,
      "height": height,
      "timeMs": ms,
    ])
  }
  if frames.isEmpty {
    throw gifSampleError("No frames could be read from that video.")
  }
  return frames
}
