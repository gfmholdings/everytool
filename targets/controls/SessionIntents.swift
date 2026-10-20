import AppIntents
import Foundation
import SwiftUI
import WidgetKit

/// "Start Screenshots" — begins a screenshot session WITHOUT leaving the
/// app the user is in: it records the start time in the App Group and
/// returns. The user then takes ordinary screenshots (side + volume up,
/// or Back Tap) while scrolling. Everytool stitches every screenshot
/// taken since this moment. Runs in the controls extension.
struct StartScreenshotSessionIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Screenshot Session"
  static let openAppWhenRun = false

  init() {}

  func perform() async throws -> some IntentResult {
    let defaults = UserDefaults(suiteName: "group.app.everytool.ios")
    let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
    defaults?.set(String(nowMs), forKey: "everytool.screenshotSession")
    return .result()
  }
}

struct StartSessionControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "app.everytool.ios.controls.sessionstart") {
      ControlWidgetButton(action: StartScreenshotSessionIntent()) {
        Label("Start Screenshots", systemImage: "camera.viewfinder")
      }
    }
    .displayName("Start Long Screenshot")
    .description("Start a session: take screenshots while you scroll, then tap Stitch Screenshots.")
  }
}

/// "Stitch Screenshots" — opens Everytool, which joins every screenshot
/// taken since the session started into one long image.
struct FinishSessionControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "app.everytool.ios.controls.sessionfinish") {
      ControlWidgetButton(action: OpenToolIntent(tool: "stitch:session")) {
        Label("Stitch Screenshots", systemImage: "rectangle.stack.badge.plus")
      }
    }
    .displayName("Stitch Screenshots")
    .description("Join the screenshots you took into one long screenshot.")
  }
}
