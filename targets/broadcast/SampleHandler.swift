import CoreImage
import ImageIO
import ReplayKit
import UniformTypeIdentifiers

/// ReplayKit broadcast upload extension — the capture half of the long
/// screenshot. The user starts and stops the recording with Apple's own
/// UI (Control Center long-press, or the picker in the app); this
/// handler samples about one frame per second, scales it to at most
/// 1170px wide (the stitch rule: never work at capture resolution), and
/// writes PNG frames into the App Group's BroadcastInbox. When the
/// broadcast finishes it flags the inbox, and Everytool stitches the
/// frames on next launch.
///
/// Honest limits: frames arrive at the screen's refresh cadence, so
/// sampling is approximate; there is no scroll-position metadata in a
/// sample buffer — the app estimates overlap by matching frame content,
/// and says plainly when a seam didn't match. Mic and app audio are
/// ignored entirely.
class SampleHandler: RPBroadcastSampleHandler {
    private let ciContext = CIContext()
    private var lastSavedAt: TimeInterval = 0
    private var frameIndex = 0
    private var finished = false

    private static let maxWidth: CGFloat = 1170
    private static let sampleInterval: TimeInterval = 1.0

    override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
        SharedVault.resetBroadcastInbox()
        frameIndex = 0
        lastSavedAt = 0
        finished = false
    }

    override func broadcastPaused() {
        // Sampling resumes with the broadcast; nothing to do.
    }

    override func broadcastResumed() {
        lastSavedAt = 0
    }

    override func broadcastFinished() {
        if !finished {
            finished = true
            SharedVault.markBroadcastFinished()
        }
    }

    override func processSampleBuffer(
        _ sampleBuffer: CMSampleBuffer,
        with sampleBufferType: RPSampleBufferType
    ) {
        guard sampleBufferType == .video else { return }
        let now = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        guard now - lastSavedAt >= Self.sampleInterval || frameIndex == 0 else {
            return
        }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }
        lastSavedAt = now

        let sourceWidth = CVPixelBufferGetWidth(pixelBuffer)
        let sourceHeight = CVPixelBufferGetHeight(pixelBuffer)
        guard sourceWidth > 0, sourceHeight > 0 else { return }
        let scale = min(1, Self.maxWidth / CGFloat(sourceWidth))
        let targetWidth = Int(CGFloat(sourceWidth) * scale)
        let targetHeight = Int(CGFloat(sourceHeight) * scale)

        var image = CIImage(cvPixelBuffer: pixelBuffer)
        if scale < 1 {
            image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }
        guard
            let cgImage = ciContext.createCGImage(
                image,
                from: CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight)
            )
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
            width: targetWidth,
            height: targetHeight
        )
    }
}
