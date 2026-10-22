import CoreImage
import ImageIO
import ReplayKit
import UniformTypeIdentifiers
import UserNotifications

/// ReplayKit broadcast upload extension — the capture half of the long
/// screenshot. The user starts it from Everytool's "Record" button,
/// the "Record Long Screenshot" control, or Control Center's screen
/// recording long-press, then scrolls. This handler:
///
/// - samples a frame every 0.4 s (fast enough that consecutive frames of
///   a normal scroll still overlap),
/// - skips frames that look the same as the last saved one (a 24×52
///   grayscale signature), so pauses cost nothing and a recording can
///   run as long as the user keeps scrolling,
/// - writes PNG frames at the screen's own pixels (no resample) up to
///   1320 px wide, into the App Group's BroadcastInbox with an index.json,
/// - flags the inbox finished and posts a local notification when the
///   recording stops; tapping it opens Everytool, which stitches.
///
/// Broadcast extensions run under a ~50 MB memory ceiling, so every
/// buffer here is per-frame and released immediately.
class SampleHandler: RPBroadcastSampleHandler {
  private let ciContext = CIContext(options: [.cacheIntermediates: false])
  private var lastSavedAt: TimeInterval = -1
  private var frameIndex = 0
  private var finished = false
  private var lastSignature: [UInt8]?

  /// Wider than any current iPhone screenshot. Scaling a 1179 px frame
  /// down to 1170 blends adjacent rows; the stitch cuts on that blend
  /// and a line appears at every join. Only something wider (an iPad)
  /// is reduced, and then onto a whole-pixel grid.
  private static let maxWidth = 1320
  private static let sampleInterval: TimeInterval = 0.4
  private static let sigWidth = 24
  private static let sigHeight = 52
  /// Mean absolute difference (0–255) under which a frame counts as
  /// unchanged and is skipped.
  private static let sameThreshold: Double = 0.8

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    SharedVault.resetBroadcastInbox()
    frameIndex = 0
    lastSavedAt = -1
    lastSignature = nil
    finished = false
  }

  override func broadcastPaused() {
    // Sampling resumes with the broadcast; nothing to do.
  }

  override func broadcastResumed() {
    lastSavedAt = -1
  }

  override func broadcastFinished() {
    guard !finished else { return }
    finished = true
    SharedVault.markBroadcastFinished()
    notifyReady()
  }

  private func notifyReady() {
    guard frameIndex > 0 else { return }
    let center = UNUserNotificationCenter.current()
    let content = UNMutableNotificationContent()
    content.title = "Long screenshot ready"
    content.body = "Tap to stitch your \(frameIndex)-frame recording in Everytool."
    content.sound = nil
    content.userInfo = ["url": "everytool://tool/stitch"]
    let request = UNNotificationRequest(
      identifier: "everytool.broadcast.ready",
      content: content,
      trigger: nil
    )
    // Fire-and-forget: if the user never allowed notifications this is a
    // no-op, and Everytool still finds the frames when it next opens.
    center.add(request, withCompletionHandler: nil)
  }

  override func processSampleBuffer(
    _ sampleBuffer: CMSampleBuffer,
    with sampleBufferType: RPSampleBufferType
  ) {
    guard sampleBufferType == .video, !finished else { return }
    let now = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
    guard lastSavedAt < 0 || now - lastSavedAt >= Self.sampleInterval else {
      return
    }
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }
    autoreleasepool {
      saveFrame(pixelBuffer, at: now)
    }
  }

  private func signature(of image: CIImage, width: Int, height: Int) -> [UInt8]? {
    let sx = CGFloat(Self.sigWidth) / CGFloat(width)
    let sy = CGFloat(Self.sigHeight) / CGFloat(height)
    let small = image.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
    var bytes = [UInt8](repeating: 0, count: Self.sigWidth * Self.sigHeight)
    bytes.withUnsafeMutableBytes { raw in
      guard let base = raw.baseAddress else { return }
      ciContext.render(
        small,
        toBitmap: base,
        rowBytes: Self.sigWidth,
        bounds: CGRect(x: 0, y: 0, width: Self.sigWidth, height: Self.sigHeight),
        format: .L8,
        colorSpace: nil
      )
    }
    return bytes
  }

  private func isSameAsLast(_ sig: [UInt8]) -> Bool {
    guard let last = lastSignature, last.count == sig.count else { return false }
    var total = 0
    for i in 0..<sig.count {
      total += abs(Int(sig[i]) - Int(last[i]))
    }
    return Double(total) / Double(sig.count) < Self.sameThreshold
  }

  private func saveFrame(_ pixelBuffer: CVPixelBuffer, at now: TimeInterval) {
    let sourceWidth = CVPixelBufferGetWidth(pixelBuffer)
    let sourceHeight = CVPixelBufferGetHeight(pixelBuffer)
    guard sourceWidth > 0, sourceHeight > 0 else { return }

    let source = CIImage(cvPixelBuffer: pixelBuffer)
    if let sig = signature(of: source, width: sourceWidth, height: sourceHeight) {
      if isSameAsLast(sig) {
        // Nothing moved: skip, but don't reset the clock — the next
        // changed frame is saved as soon as it arrives.
        return
      }
      lastSignature = sig
    }
    lastSavedAt = now

    // Keep the screen's own pixels. A fractional scale (1179 → 1170)
    // blends two source rows into one, and the stitch's integer cut
    // then draws that blend as a line at every join. An iPad, which is
    // wider than maxWidth, is reduced onto a whole-pixel grid with
    // nearest-neighbor so the edge row is not a blended or black sliver.
    let image: CIImage
    let targetWidth: Int
    let targetHeight: Int
    if sourceWidth <= Self.maxWidth {
      image = source
      targetWidth = sourceWidth
      targetHeight = sourceHeight
    } else {
      targetWidth = Self.maxWidth
      targetHeight = max(1, (sourceHeight * targetWidth) / sourceWidth)
      let sx = CGFloat(targetWidth) / CGFloat(sourceWidth)
      let sy = CGFloat(targetHeight) / CGFloat(sourceHeight)
      image = source.samplingNearest().transformed(
        by: CGAffineTransform(scaleX: sx, y: sy)
      )
    }
    let crop = CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight)
      .intersection(image.extent)
    guard !crop.isNull, !crop.isEmpty,
      let cgImage = ciContext.createCGImage(image, from: crop)
    else { return }

    guard let dir = SharedVault.broadcastDir() else { return }
    let name = String(format: "frame-%05d.png", frameIndex)
    let url = dir.appendingPathComponent(name)
    guard
      let dest = CGImageDestinationCreateWithURL(
        url as CFURL,
        UTType.png.identifier as CFString,
        1,
        nil
      )
    else { return }
    CGImageDestinationAddImage(dest, cgImage, nil)
    guard CGImageDestinationFinalize(dest) else { return }

    frameIndex += 1
    SharedVault.appendBroadcastFrame(
      file: name,
      width: cgImage.width,
      height: cgImage.height
    )
  }
}
