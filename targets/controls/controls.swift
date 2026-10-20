import AppIntents
import SwiftUI
import WidgetKit

/// One Control Center control per Everytool tool (iOS 18+). Each is a
/// door into the app: it runs OpenToolIntent, which opens Everytool at
/// that tool. "Record long screenshot" opens the stitcher and raises
/// Apple's screen-broadcast sheet straight away (tool id "stitch:record").
///
/// Kinds are stable identifiers — controls a user already placed keep
/// working across updates, so never rename an existing kind.
private func toolControl(
  _ tool: String,
  _ title: String,
  _ symbol: String,
  _ summary: String
) -> some ControlWidgetConfiguration {
  StaticControlConfiguration(kind: "app.everytool.ios.controls.\(tool)") {
    ControlWidgetButton(action: OpenToolIntent(tool: tool)) {
      Label(title, systemImage: symbol)
    }
  }
  .displayName(LocalizedStringResource(stringLiteral: title))
  .description(LocalizedStringResource(stringLiteral: summary))
}

struct RecordControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "app.everytool.ios.controls.record") {
      ControlWidgetButton(action: OpenToolIntent(tool: "stitch:record")) {
        Label("Record Long Shot", systemImage: "record.circle")
      }
    }
    .displayName("Record Long Screenshot")
    .description("Start a scrolling capture that Everytool stitches into one image.")
  }
}

struct StitchControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("stitch", "Long Screenshot", "rectangle.expand.vertical",
                "Open Everytool's long screenshot stitcher.")
  }
}

struct ClipboardControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("clipboard", "Clipboard", "doc.on.clipboard",
                "Open your saved clipboard items.")
  }
}

struct ConvertControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("convert", "Convert", "arrow.left.arrow.right.square",
                "Open Everytool's file converter.")
  }
}

struct QrControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("qr", "QR", "qrcode", "Make or scan a QR code.")
  }
}

struct ResizeControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("resize", "Resize Photo", "arrow.down.right.and.arrow.up.left",
                "Shrink a photo to a smaller size.")
  }
}

struct PdfControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("pdf", "PDF Tools", "doc.richtext",
                "Merge, split or compress PDFs.")
  }
}

struct TextControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("text", "Text Tools", "text.alignleft",
                "Count, extract and clean up text.")
  }
}

struct DaysControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("days", "Days Counter", "calendar",
                "Count days between dates.")
  }
}

struct SplitControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("split", "Split Bill", "person.2",
                "Split a bill with tax and tip.")
  }
}

struct GifControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    toolControl("gif", "Video to GIF", "photo.stack",
                "Turn a short video into a GIF.")
  }
}
