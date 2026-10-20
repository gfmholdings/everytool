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
      if tool != nil { defaults.removeObject(forKey: "everytool.pendingTool") }
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

    /// Lets the broadcast extension post "Your long screenshot is ready"
    /// when the recording stops. Optional — stitching works without it.
    AsyncFunction("requestNotificationPermission") { () async -> Bool in
      let center = UNUserNotificationCenter.current()
      let granted = try? await center.requestAuthorization(options: [.alert, .sound])
      return granted ?? false
    }
  }
}
