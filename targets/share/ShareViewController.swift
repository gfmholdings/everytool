import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Copy a provider file URL into our temp directory before the provider
/// deletes it. Remote URLs are refused — sharing stays on-device.
/// A missing extension is sniffed so a PNG is not stored as ".img".
private func copyFileURL(_ url: URL) -> URL? {
    guard url.isFileURL else { return nil }
    var ext = url.pathExtension.lowercased()
    if ext.isEmpty, let handle = try? FileHandle(forReadingFrom: url) {
        let head = (try? handle.read(upToCount: 12)) ?? Data()
        try? handle.close()
        ext = imageExtension(for: head)
    }
    if ext.isEmpty { ext = "img" }
    let dest = FileManager.default.temporaryDirectory
        .appendingPathComponent("shared-\(UUID().uuidString).\(ext)")
    do {
        try FileManager.default.copyItem(at: url, to: dest)
        return dest
    } catch {
        return nil
    }
}

private func writeImageTemp(_ data: Data, ext: String) -> URL? {
    let dest = FileManager.default.temporaryDirectory
        .appendingPathComponent("shared-\(UUID().uuidString).\(ext)")
    do {
        try data.write(to: dest, options: .atomic)
        return dest
    } catch {
        return nil
    }
}

/// PNG / JPEG / HEIC (and GIF) from the file header. Anything else is
/// written as PNG bytes only when the caller already encoded PNG.
private func imageExtension(for data: Data) -> String {
    let b = [UInt8](data.prefix(12))
    if b.count >= 8,
       b[0] == 0x89, b[1] == 0x50, b[2] == 0x4E, b[3] == 0x47 {
        return "png"
    }
    if b.count >= 3, b[0] == 0xFF, b[1] == 0xD8, b[2] == 0xFF {
        return "jpg"
    }
    if b.count >= 6 {
        let gif = String(bytes: b.prefix(6), encoding: .ascii) ?? ""
        if gif.hasPrefix("GIF87") || gif.hasPrefix("GIF89") { return "gif" }
    }
    if b.count >= 12,
       b[4] == 0x66, b[5] == 0x74, b[6] == 0x79, b[7] == 0x70 {
        let brand = String(bytes: b[8..<12], encoding: .ascii) ?? ""
        if brand == "heic" || brand == "heix" || brand == "heif"
            || brand == "mif1" || brand == "msf1" || brand == "heim" {
            return "heic"
        }
    }
    return "img"
}

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
                // Concrete types first. A PNG often conforms to public.image
                // but loadFileRepresentation("public.image") comes back empty,
                // while "public.png" (or loadItem → UIImage/Data) succeeds.
                if let url = await loadBestImage(provider) {
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

    /// Most specific first. public.image is the fallback for anything
    /// else that conforms (GIF, TIFF, a screenshot UTI we didn't name).
    private static let imageTypeOrder = [
        UTType.png.identifier,
        UTType.jpeg.identifier,
        UTType.heic.identifier,
        "public.heif",
        UTType.gif.identifier,
        UTType.image.identifier,
    ]

    private func loadBestImage(_ provider: NSItemProvider) async -> URL? {
        let types = Self.imageTypeOrder.filter {
            provider.hasItemConformingToTypeIdentifier($0)
        }
        if types.isEmpty { return nil }
        for type in types {
            if let url = await loadFile(provider, type: type) { return url }
            if let url = await loadImageItem(provider, type: type) { return url }
        }
        return nil
    }

    private func loadFile(_ provider: NSItemProvider, type: String) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                // The provider's URL is deleted when this completion
                // returns; copy it out before resuming.
                continuation.resume(returning: url.flatMap(copyFileURL))
            }
        }
    }

    /// Photos and Files sometimes hand a PNG over as UIImage or Data
    /// instead of a file URL. Write those to a temp file the inbox can copy.
    private func loadImageItem(_ provider: NSItemProvider, type: String) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: type, options: nil) { item, _ in
                if let image = item as? UIImage, let data = image.pngData() {
                    continuation.resume(returning: writeImageTemp(data, ext: "png"))
                    return
                }
                if let url = item as? URL {
                    continuation.resume(returning: copyFileURL(url))
                    return
                }
                if let data = item as? Data {
                    continuation.resume(returning: writeImageTemp(data, ext: imageExtension(for: data)))
                    return
                }
                continuation.resume(returning: nil)
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
        // The share sheet action is named Everytool. A PDF has nowhere else
        // to go, so that one tap opens the PDF tool. iOS has no setting for
        // a default PDF app; this is the Open In / share path.
        .onChange(of: model.loading) { _, isLoading in
            guard !isLoading, model.routed == nil else { return }
            let kinds = model.items.map(\.kind)
            guard !kinds.isEmpty, kinds.allSatisfy({ $0 == "pdf" }) else { return }
            model.route("pdf")
            onRouted("pdf")
        }
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
