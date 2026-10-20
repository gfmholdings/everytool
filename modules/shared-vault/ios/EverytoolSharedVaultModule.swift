import ExpoModulesCore
import ReplayKit
import UIKit
import UserNotifications

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
