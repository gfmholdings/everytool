import AppIntents
import SwiftUI
import WidgetKit

/// Opens Everytool at one tool. The intent runs in the app process
/// (openAppWhenRun), records the chosen tool in the App Group, and the
/// app consumes it the moment it activates (App.tsx → takePendingTool).
/// A control cannot do the tool's work itself — it is a door, honestly.
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
        SharedVault.defaults?.set(tool, forKey: "everytool.pendingTool")
        return .result()
    }
}

struct StitchControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "app.everytool.ios.controls.stitch") {
            ControlWidgetButton(action: OpenToolIntent(tool: "stitch")) {
                Label("Stitch", systemImage: "rectangle.stack.badge.plus")
            }
        }
        .displayName("Stitch")
        .description("Open Everytool's long screenshot stitcher.")
    }
}

struct ConvertControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "app.everytool.ios.controls.convert") {
            ControlWidgetButton(action: OpenToolIntent(tool: "convert")) {
                Label("Convert", systemImage: "arrow.left.arrow.right.square")
            }
        }
        .displayName("Convert")
        .description("Open Everytool's file converter.")
    }
}

struct QrControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "app.everytool.ios.controls.qr") {
            ControlWidgetButton(action: OpenToolIntent(tool: "qr")) {
                Label("QR", systemImage: "qrcode")
            }
        }
        .displayName("QR")
        .description("Open Everytool's QR toolbox.")
    }
}
