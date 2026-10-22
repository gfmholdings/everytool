import ReplayKit
import UIKit

/// The setup screen iOS shows when the user picks Everytool in the
/// broadcast picker. It only explains the flow — starting and stopping
/// the recording is always Apple's own UI, never ours.
// Note: there is no RPBroadcastActivitySetupViewController type in the
// ReplayKit SDK — a broadcast setup UI extension's principal class is a
// plain UIViewController. (An earlier draft declared conformance to that
// nonexistent type and failed compilation.)
class BroadcastSetupViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Palette.background

        let title = UILabel()
        title.text = "Long screenshot with Everytool"
        title.font = .systemFont(ofSize: 19, weight: .bold)
        title.textColor = Palette.textPrimary
        title.numberOfLines = 0

        let body = UILabel()
        body.text =
            "Start the recording, then scroll the page slowly, a screen at a time. Stop the recording when you're done — Everytool stitches the pieces into one long image."
        body.font = .systemFont(ofSize: 15)
        body.textColor = Palette.textSecondary
        body.numberOfLines = 0

        let stack = UIStackView(arrangedSubviews: [title, body])
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    func prepare(for broadcastConfiguration: RPBroadcastConfiguration) {
        // Nothing to configure: frames are sampled as they come.
    }

    func prepare(
        for broadcastConfiguration: RPBroadcastConfiguration,
        with setupInfo: [String: NSObject]?
    ) {
        prepare(for: broadcastConfiguration)
    }
}
