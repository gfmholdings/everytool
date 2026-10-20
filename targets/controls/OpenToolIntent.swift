import AppIntents
import Foundation

/// Opens Everytool at one tool. Compiled into BOTH the controls extension
/// (this folder) and the main app target (plugins/withOpenToolIntent.js
/// copies this file there at prebuild): Apple requires an
/// openAppWhenRun intent used by a control to exist in the app, where
/// iOS runs perform(). perform() records the tool in the App Group and
/// the app consumes it on activation (App.tsx → takePendingTool).
/// Self-contained on purpose (plain UserDefaults, no SharedVault helper)
/// so it compiles identically in both targets.
struct OpenToolIntent: AppIntent {
  static let title: LocalizedStringResource = "Open Everytool Tool"
  static let openAppWhenRun = true

  @Parameter(title: "Tool")
  var tool: String

  init() {
    self.tool = "stitch"
  }

  init(tool: String) {
    self.tool = tool
  }

  func perform() async throws -> some IntentResult {
    let defaults = UserDefaults(suiteName: "group.app.everytool.ios")
    defaults?.set(tool, forKey: "everytool.pendingTool")
    defaults?.set(Date().timeIntervalSince1970, forKey: "everytool.pendingToolAt")
    return .result()
  }
}
