import SwiftUI
import WidgetKit

/// Every control Everytool offers in Control Center → Add a Control.
/// WidgetBundleBuilder accepts at most 10 widgets per block, so the
/// thirteen controls are split across two nested bundles.
@main
struct EverytoolControls: WidgetBundle {
  var body: some Widget {
    EverytoolCaptureControls().body
    EverytoolToolControls().body
  }
}

struct EverytoolCaptureControls: WidgetBundle {
  var body: some Widget {
    StartSessionControl()
    FinishSessionControl()
    RecordControl()
    StitchControl()
    ClipboardControl()
    ConvertControl()
    QrControl()
  }
}

struct EverytoolToolControls: WidgetBundle {
  var body: some Widget {
    ResizeControl()
    PdfControl()
    TextControl()
    DaysControl()
    SplitControl()
    GifControl()
  }
}
