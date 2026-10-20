import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// One item handed to the share sheet, already copied to a temp file
/// the extension owns (providers hand out expiring URLs).
struct SharedItem: Identifiable {
    let id = UUID()
    let url: URL
    let kind: String  // "image" | "pdf" | "text"
    var isTextPayload = false
}

@MainActor
final class ShareModel: ObservableObject {
    @Published var items: [SharedItem] = []
    @Published var loading = true
    @Published var routed: String?

    func load(from context: NSExtensionContext?) {
        guard let items = context?.inputItems as? [NSExtensionItem] else {
            loading = false
            return
        }
        let providers = items.flatMap { $0.attachments ?? [] }
        Task {
            var loaded: [SharedItem] = []
            for provider in providers {
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
                   let url = await loadFile(provider, type: UTType.image.identifier) {
                    loaded.append(SharedItem(url: url, kind: "image"))
                } else if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier),
                          let url = await loadFile(provider, type: UTType.pdf.identifier) {
                    loaded.append(SharedItem(url: url, kind: "pdf"))
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = await loadText(provider) {
                    // Text rides through the inbox as a .txt file; the app
                    // reads it and saves it to the clipboard vault.
                    let tmp = FileManager.default.temporaryDirectory
                        .appendingPathComponent("shared-\(UUID().uuidString).txt")
                    try? text.data(using: .utf8)?.write(to: tmp)
                    loaded.append(SharedItem(url: tmp, kind: "text", isTextPayload: true))
                } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                          let url = await loadURL(provider) {
                    let tmp = FileManager.default.temporaryDirectory
                        .appendingPathComponent("shared-\(UUID().uuidString).txt")
                    try? url.absoluteString.data(using: .utf8)?.write(to: tmp)
                    loaded.append(SharedItem(url: tmp, kind: "text", isTextPayload: true))
                }
            }
            self.items = loaded
            self.loading = false
        }
    }

    private func loadFile(_ provider: NSItemProvider, type: String) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url else {
                    continuation.resume(returning: nil)
                    return
                }
                // The provider's URL is deleted when the completion runs;
                // copy it out first.
                let tmp = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent)
                try? FileManager.default.copyItem(at: url, to: tmp)
                continuation.resume(returning: tmp)
            }
        }
    }

    private func loadText(_ provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                continuation.resume(returning: item as? String)
            }
        }
    }

    private func loadURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                continuation.resume(returning: item as? URL)
            }
        }
    }

    /// The tools that make sense for what's being shared.
    var routes: [(tool: String, label: String)] {
        if items.contains(where: { $0.kind == "text" }) {
            return [("clipboard", "Save to clipboard")]
        }
        if items.contains(where: { $0.kind == "pdf" }) {
            return [("pdf", "PDF tools")]
        }
        if items.count > 1 {
            return [
                ("stitch", "Stitch together"),
                ("convert", "Convert first photo"),
            ]
        }
        return [
            ("convert", "Convert"),
            ("resize", "Resize"),
            ("qr", "Scan QR code"),
            ("stitch", "Stitch"),
        ]
    }

    /// Copy everything into the App Group inbox under the chosen route.
    /// The app drains the inbox on launch and opens the first item's
    /// tool (for stitch it uses the whole batch).
    func route(_ tool: String) {
        for item in items {
            _ = SharedVault.addToShareInbox(
                sourceURL: item.url,
                kind: item.kind,
                tool: item.isTextPayload ? "clipboard" : tool
            )
        }
        routed = tool
    }
}

struct ShareView: View {
    @ObservedObject var model: ShareModel
    var onCancel: () -> Void
    var onRouted: (String) -> Void

    var body: some View {
        VStack(spacing: 16) {
            HStack {
                Text("Everytool")
                    .font(.headline)
                Spacer()
                Button("Cancel", action: onCancel)
            }
            if model.loading {
                ProgressView()
                Text("Reading what you shared…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if model.items.isEmpty {
                Text("Nothing Everytool can use here — it takes photos, PDFs and text.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            } else if let routed = model.routed {
                Text("Saved. Opening \(label(for: routed))…")
                    .font(.subheadline)
            } else {
                Text(summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                ForEach(model.routes, id: \.tool) { route in
                    Button {
                        model.route(route.tool)
                        onRouted(route.tool)
                    } label: {
                        Text(route.label)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            Spacer()
        }
        .padding(20)
    }

    private var summary: String {
        let images = model.items.filter { $0.kind == "image" }.count
        let pdfs = model.items.filter { $0.kind == "pdf" }.count
        let texts = model.items.filter { $0.kind == "text" }.count
        var parts: [String] = []
        if images > 0 { parts.append(images == 1 ? "1 photo" : "\(images) photos") }
        if pdfs > 0 { parts.append(pdfs == 1 ? "1 PDF" : "\(pdfs) PDFs") }
        if texts > 0 { parts.append("text") }
        return parts.joined(separator: " · ")
    }

    private func label(for tool: String) -> String {
        model.routes.first { $0.tool == tool }?.label ?? "Everytool"
    }
}

final class ShareViewController: UIViewController {
    private let model = ShareModel()

    override func viewDidLoad() {
        super.viewDidLoad()
        let root = ShareView(
            model: model,
            onCancel: { [weak self] in
                self?.extensionContext?.cancelRequest(
                    withError: NSError(domain: "app.everytool.share", code: 0)
                )
            },
            onRouted: { [weak self] tool in
                // Give the inbox write a beat, then open the app.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    self?.openApp(tool: tool)
                }
            }
        )
        let host = UIHostingController(rootView: root)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)
        model.load(from: extensionContext)
    }

    private func openApp(tool: String) {
        let url = URL(string: "everytool://tool/\(tool)")!
        // Share extensions have no extensionContext.open; walk the
        // responder chain up to UIApplication, like every share sheet
        // that opens its app does.
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(url, options: [:]) { [weak self] _ in
                    self?.extensionContext?.completeRequest(
                        returningItems: [],
                        completionHandler: nil
                    )
                }
                return
            }
            responder = r.next
        }
        // Couldn't open (rare): the inbox still drains on next launch.
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
