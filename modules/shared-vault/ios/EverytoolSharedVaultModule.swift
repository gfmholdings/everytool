import ExpoModulesCore

/// The shared App Group store. The app, keyboard, share extension and
/// broadcast extension all keep one JSON document ("everytool.state.v1")
/// in the App Group's UserDefaults suite, plus files (share inbox,
/// broadcast frames) in the group container. This module is the app's
/// side of that contract; each extension carries the same two helpers in
/// Swift (see SharedVault.swift in any target).
public class EverytoolSharedVaultModule: Module {
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

    /// Control Center controls record the tool they want here (their
    /// AppIntent runs in this process but cannot route inside React
    /// Native). The app takes it — read + clear — on activation.
    Function("takePendingTool") { (groupId: String) -> String? in
      guard let defaults = UserDefaults(suiteName: groupId) else { return nil }
      let tool = defaults.string(forKey: "everytool.pendingTool")
      if tool != nil { defaults.removeObject(forKey: "everytool.pendingTool") }
      return tool
    }
  }
}
