import Foundation

/// The shared App Group contract, identical on every surface. The app
/// (via the EverytoolSharedVault Expo module), the keyboard, the share
/// extension and the broadcast extension all read and write the same
/// places:
///
/// - State JSON: UserDefaults suite "group.app.everytool.ios", key
///   "everytool.state.v1" — { clips: [...], qrHistory: [...] }.
/// - ShareInbox/ in the group container: files + index.json.
/// - BroadcastInbox/ in the group container: frames + index.json.
///
/// Nothing here ever leaves the device.
enum SharedVault {
  static let groupId = "group.app.everytool.ios"
  static let stateKey = "everytool.state.v1"

  static var defaults: UserDefaults? {
    UserDefaults(suiteName: groupId)
  }

  static func containerURL() -> URL? {
    FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: groupId
    )
  }

  // MARK: - State

  static func state() -> [String: Any] {
    guard
      let json = defaults?.string(forKey: stateKey),
      let data = json.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data),
      let dict = parsed as? [String: Any]
    else { return [:] }
    return dict
  }

  /// Clipboard clips, pinned first, then newest first — the app's order.
  static func clips() -> [[String: Any]] {
    let raw = state()["clips"] as? [[String: Any]] ?? []
    return raw.sorted { a, b in
      let ap = (a["pinned"] as? Bool) ?? false
      let bp = (b["pinned"] as? Bool) ?? false
      if ap != bp { return ap && !bp }
      let at = (a["createdAt"] as? Double) ?? 0
      let bt = (b["createdAt"] as? Double) ?? 0
      return at > bt
    }
  }

  // MARK: - Clip edits (keyboard)
  //
  // Read-modify-write of the one state document, preserving every key the
  // extension doesn't own (qrHistory, future keys). The app re-reads this
  // document whenever it activates and before each of its own writes, so
  // edits made here are never clobbered. Clip shape matches src/types.ts:
  // { id, text, pinned, createdAt (ms) }.

  static let maxClips = 500

  private static func writeState(_ dict: [String: Any]) -> Bool {
    guard
      let defaults = Self.defaults,
      let data = try? JSONSerialization.data(withJSONObject: dict),
      let json = String(data: data, encoding: .utf8)
    else { return false }
    defaults.set(json, forKey: stateKey)
    // Same flush rule as the app-side module: readers use a fresh
    // suite instance per call, so an unflushed write can be missed
    // by the next read-modify-write and get overwritten.
    defaults.synchronize()
    return true
  }

  private static func mutateClips(
    _ change: (inout [[String: Any]]) -> Void
  ) -> Bool {
    var dict = state()
    var clips = dict["clips"] as? [[String: Any]] ?? []
    change(&clips)
    dict["clips"] = clips
    if dict["qrHistory"] == nil { dict["qrHistory"] = [] as [Any] }
    return writeState(dict)
  }

  private static func nowMs() -> Double {
    (Date().timeIntervalSince1970 * 1000).rounded()
  }

  /// Saves text as a new clip. Saving text that is already in the vault
  /// moves that clip to the top instead of duplicating it.
  @discardableResult
  static func saveClip(_ raw: String) -> Bool {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return false }
    return mutateClips { clips in
      if let i = clips.firstIndex(where: { ($0["text"] as? String) == text }) {
        clips[i]["createdAt"] = nowMs()
        return
      }
      let id = "\(Int(nowMs()))-kb\(UUID().uuidString.prefix(6).lowercased())"
      clips.insert(
        ["id": id, "text": text, "pinned": false, "createdAt": nowMs()],
        at: 0
      )
      // Keep the vault bounded: drop the oldest unpinned clips.
      while clips.count > maxClips,
        let last = clips.lastIndex(where: { !(($0["pinned"] as? Bool) ?? false) })
      {
        clips.remove(at: last)
      }
    }
  }

  @discardableResult
  static func updateClip(id: String, text raw: String) -> Bool {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return false }
    return mutateClips { clips in
      if let i = clips.firstIndex(where: { ($0["id"] as? String) == id }) {
        clips[i]["text"] = text
      }
    }
  }

  @discardableResult
  static func togglePin(id: String) -> Bool {
    mutateClips { clips in
      if let i = clips.firstIndex(where: { ($0["id"] as? String) == id }) {
        let pinned = (clips[i]["pinned"] as? Bool) ?? false
        clips[i]["pinned"] = !pinned
      }
    }
  }

  @discardableResult
  static func deleteClip(id: String) -> Bool {
    mutateClips { clips in
      clips.removeAll { ($0["id"] as? String) == id }
    }
  }

  /// Clears every unpinned clip; pinned ones stay.
  @discardableResult
  static func clearUnpinnedClips() -> Bool {
    mutateClips { clips in
      clips.removeAll { !(($0["pinned"] as? Bool) ?? false) }
    }
  }

  // MARK: - Image clips (keyboard)
  //
  // Copied screenshots and photos, kept apart from the text clips: the
  // state document gains an "imageClips" array of
  // { id, file, hash, pinned, createdAt } and the JPEG bytes live in
  // ClipImages/ in the group container. The app ignores the key for
  // now (its clip shape is text-only); the read-modify-write pattern
  // preserves it like every other key. A keyboard cannot insert an
  // image into a text field — an image clip is copied back to the
  // system pasteboard and the user pastes it in the host app.

  static let maxImageClips = 100

  static func imageClips() -> [[String: Any]] {
    let raw = state()["imageClips"] as? [[String: Any]] ?? []
    return raw.sorted { a, b in
      let ap = (a["pinned"] as? Bool) ?? false
      let bp = (b["pinned"] as? Bool) ?? false
      if ap != bp { return ap && !bp }
      let at = (a["createdAt"] as? Double) ?? 0
      let bt = (b["createdAt"] as? Double) ?? 0
      return at > bt
    }
  }

  private static func mutateImageClips(
    _ change: (inout [[String: Any]]) -> Void
  ) -> Bool {
    var dict = state()
    var images = dict["imageClips"] as? [[String: Any]] ?? []
    change(&images)
    dict["imageClips"] = images
    if dict["qrHistory"] == nil { dict["qrHistory"] = [] as [Any] }
    return writeState(dict)
  }

  static func clipImagesDir() -> URL? {
    guard let container = containerURL() else { return nil }
    let dir = container.appendingPathComponent("ClipImages", isDirectory: true)
    try? FileManager.default.createDirectory(
      at: dir, withIntermediateDirectories: true)
    return dir
  }

  static func imageClipURL(_ file: String) -> URL? {
    clipImagesDir()?.appendingPathComponent(file)
  }

  /// A stable-enough fingerprint of image bytes for "already saved?"
  /// checks and save-time dedupe (FNV-1a over a sampled prefix — the
  /// keyboard hashes a small thumbnail render, so identical copies of
  /// the same image land on the same value).
  static func imageHash(_ data: Data) -> String {
    var hash: UInt64 = 0xcbf29ce484222325
    let step = max(1, data.count / 4096)
    var i = 0
    while i < data.count {
      hash ^= UInt64(data[i])
      hash = hash &* 0x100000001b3
      i += step
    }
    return String(hash, radix: 16)
  }

  /// Stores JPEG bytes as a new image clip. Saving the same image
  /// again (same hash) bumps the existing clip to the top.
  @discardableResult
  static func saveImageClip(jpeg: Data, hash: String) -> Bool {
    if let existing = imageClips().first(where: { ($0["hash"] as? String) == hash }),
      let id = existing["id"] as? String
    {
      return mutateImageClips { images in
        if let i = images.firstIndex(where: { ($0["id"] as? String) == id }) {
          images[i]["createdAt"] = nowMs()
        }
      }
    }
    guard let dir = clipImagesDir() else { return false }
    let id = "\(Int(nowMs()))-kb\(UUID().uuidString.prefix(6).lowercased())"
    let file = "\(id).jpg"
    do {
      try jpeg.write(to: dir.appendingPathComponent(file), options: .atomic)
    } catch { return false }
    return mutateImageClips { images in
      images.insert(
        ["id": id, "file": file, "hash": hash, "pinned": false, "createdAt": nowMs()],
        at: 0)
      while images.count > maxImageClips,
        let last = images.lastIndex(where: { !(($0["pinned"] as? Bool) ?? false) })
      {
        if let stale = images[last]["file"] as? String,
          let url = imageClipURL(stale)
        {
          try? FileManager.default.removeItem(at: url)
        }
        images.remove(at: last)
      }
    }
  }

  @discardableResult
  static func toggleImagePin(id: String) -> Bool {
    mutateImageClips { images in
      if let i = images.firstIndex(where: { ($0["id"] as? String) == id }) {
        let pinned = (images[i]["pinned"] as? Bool) ?? false
        images[i]["pinned"] = !pinned
      }
    }
  }

  @discardableResult
  static func deleteImageClip(id: String) -> Bool {
    if let clip = imageClips().first(where: { ($0["id"] as? String) == id }),
      let file = clip["file"] as? String, let url = imageClipURL(file)
    {
      try? FileManager.default.removeItem(at: url)
    }
    return mutateImageClips { images in
      images.removeAll { ($0["id"] as? String) == id }
    }
  }

  // MARK: - Share inbox

  /// Copy a shared file into ShareInbox and append its index entry.
  /// Returns the inbox file name, or nil on failure.
  static func addToShareInbox(
    sourceURL: URL,
    kind: String,
    tool: String
  ) -> String? {
    guard let container = containerURL() else { return nil }
    let dir = container.appendingPathComponent("ShareInbox", isDirectory: true)
    try? FileManager.default.createDirectory(
      at: dir,
      withIntermediateDirectories: true
    )
    let ext = sourceURL.pathExtension.isEmpty ? "dat" : sourceURL.pathExtension
    let name =
      "share-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6)).\(ext)"
    let dest = dir.appendingPathComponent(name)
    do {
      if FileManager.default.fileExists(atPath: dest.path) {
        try FileManager.default.removeItem(at: dest)
      }
      try FileManager.default.copyItem(at: sourceURL, to: dest)
    } catch {
      return nil
    }
    var entries = readIndex(dir: dir)
    entries.append([
      "file": name,
      "kind": kind,
      "tool": tool,
      "at": Date().timeIntervalSince1970 * 1000,
    ])
    writeIndex(dir: dir, entries: entries)
    return name
  }

  // MARK: - Broadcast inbox

  static func broadcastDir() -> URL? {
    guard let container = containerURL() else { return nil }
    let dir = container.appendingPathComponent(
      "BroadcastInbox",
      isDirectory: true
    )
    try? FileManager.default.createDirectory(
      at: dir,
      withIntermediateDirectories: true
    )
    return dir
  }

  static func resetBroadcastInbox() {
    guard let dir = broadcastDir() else { return }
    let items = (try? FileManager.default.contentsOfDirectory(
      at: dir,
      includingPropertiesForKeys: nil
    )) ?? []
    for item in items { try? FileManager.default.removeItem(at: item) }
    writeIndex(dir: dir, entries: [])
  }

  static func appendBroadcastFrame(
    file: String,
    width: Int,
    height: Int,
    finished: Bool = false
  ) {
    guard let dir = broadcastDir() else { return }
    var entries = readIndex(dir: dir)
    entries.append([
      "file": file,
      "kind": "frame",
      "tool": "stitch",
      "width": width,
      "height": height,
      "at": Date().timeIntervalSince1970 * 1000,
    ])
    writeIndex(dir: dir, entries: entries, finished: finished)
  }

  static func markBroadcastFinished() {
    guard let dir = broadcastDir() else { return }
    writeIndex(dir: dir, entries: readIndex(dir: dir), finished: true)
  }

  // MARK: - index.json helpers

  private static func readIndex(dir: URL) -> [[String: Any]] {
    let url = dir.appendingPathComponent("index.json")
    guard
      let data = try? Data(contentsOf: url),
      let parsed = try? JSONSerialization.jsonObject(with: data),
      let dict = parsed as? [String: Any],
      let items = dict["items"] as? [[String: Any]]
    else { return [] }
    return items
  }

  private static func writeIndex(
    dir: URL,
    entries: [[String: Any]],
    finished: Bool? = nil
  ) {
    var dict: [String: Any] = ["items": entries]
    if let finished { dict["finished"] = finished }
    guard
      let data = try? JSONSerialization.data(withJSONObject: dict)
    else { return }
    try? data.write(
      to: dir.appendingPathComponent("index.json"),
      options: .atomic
    )
  }
}
