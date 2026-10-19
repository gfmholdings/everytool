import AppIntents
import Foundation

/// Opens Everytool at one tool — the app-process copy of the intent the
/// Control Center controls (targets/controls) fire. With
/// openAppWhenRun = true, iOS performs the intent HERE, in the app
/// process, so the type must exist in the app binary too; the controls
/// extension carries an identical copy for its buttons. perform()
/// records the chosen tool in the App Group, and the app consumes it
/// the moment it activates (App.tsx → takePendingTool). A control
/// cannot do the tool's work itself — it is a door, honestly.
struct OpenToolIntent: AppIntent {
  static var title: LocalizedStringResource = "Open Tool"
  static var openAppWhenRun = true

  @Parameter(title: "Tool")
  var tool: String

  init() {
    self.tool = "stitch"
  }

  init(tool: String) {
    self.tool = tool
  }

  func perform() async throws -> some IntentResult {
    UserDefaults(suiteName: "group.app.everytool.ios")?.set(
      tool,
      forKey: "everytool.pendingTool"
    )
    return .result()
  }
}
