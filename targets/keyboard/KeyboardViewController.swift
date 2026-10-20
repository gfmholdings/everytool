import UIKit

/// The Everytool keyboard. A real typing keyboard first — QWERTY, two
/// symbol pages, shift + caps lock, delete-repeat, cursor keys, globe —
/// that types with Full Access OFF. Two extra tabs ride along:
///
/// - Clipboard: a full clipboard manager over the shared vault (App
///   Group) and the system pasteboard. Paste, Copy, Cut and Save act on
///   the text field you are typing in; each saved clip can be inserted,
///   copied, edited (typed with these same keys), pinned or deleted.
/// - Text tools: counts and extraction over the text around the cursor.
///
/// iOS rules this keyboard lives by:
/// - The pasteboard and the App Group are only reachable with Full
///   Access on; the Clipboard tab says so and disables what can't work.
/// - A keyboard can read the current selection (selectedText) and delete
///   it, but it cannot change the selection itself — so Copy and Cut act
///   on whatever the user selected in the field.
///
/// Nothing here touches the network. That is a product promise.
final class KeyboardViewController: UIInputViewController {
  private enum Tab: Int {
    case keys, clipboard, text
  }

  /// When non-nil, the keys type into this clip draft instead of the
  /// host field (new clip: id == nil; edit: id of the clip).
  private struct ClipEditor {
    var id: String?
    var text: String
  }

  // Named currentTab, not tab: UIViewController grew its own `tab`
  // property (UITab?) in recent iOS SDKs and a same-named stored
  // property collides with it.
  private var currentTab: Tab = .keys
  private var shifted = false
  private var capsLock = false
  private var lastShiftAt: Date?
  private var symbols = false
  private var symbolsPage2 = false
  private var lastSpaceAt: Date?
  /// Snippet shortcut word → clip text, refreshed whenever the keyboard
  /// appears (the app is where shortcuts are set).
  private var snippets: [String: String] = [:]
  private var editor: ClipEditor?
  private var confirmClearUntil: Date?

  private let rootStack = UIStackView()
  private let tabBar = UIStackView()
  private let content = UIView()
  private let toast = UILabel()
  private var heightConstraint: NSLayoutConstraint?
  private var deleteTimer: Timer?
  private var toastTimer: Timer?

  // MARK: - Lifecycle

  override func viewDidLoad() {
    super.viewDidLoad()
    rootStack.axis = .vertical
    rootStack.spacing = 6
    rootStack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(rootStack)
    NSLayoutConstraint.activate([
      rootStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 4),
      rootStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -4),
      rootStack.topAnchor.constraint(equalTo: view.topAnchor, constant: 6),
      rootStack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -4),
    ])
    let h = view.heightAnchor.constraint(equalToConstant: 284)
    h.priority = .defaultHigh
    h.isActive = true
    heightConstraint = h
    buildTabBar()
    rootStack.addArrangedSubview(tabBar)
    rootStack.addArrangedSubview(content)

    toast.font = .systemFont(ofSize: 13, weight: .semibold)
    toast.textColor = .white
    toast.backgroundColor = UIColor.black.withAlphaComponent(0.78)
    toast.textAlignment = .center
    toast.layer.cornerRadius = 10
    toast.clipsToBounds = true
    toast.alpha = 0
    toast.numberOfLines = 2
    toast.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(toast)
    NSLayoutConstraint.activate([
      toast.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      toast.topAnchor.constraint(equalTo: view.topAnchor, constant: 40),
      toast.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -40),
      toast.heightAnchor.constraint(greaterThanOrEqualToConstant: 30),
    ])
    showTab(.keys)
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    loadSnippets()
    // Refresh whichever tab is showing: clips may have changed in the app.
    showTab(currentTab)
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    deleteTimer?.invalidate()
    deleteTimer = nil
  }

  override func textDidChange(_ textInput: UITextInput?) {
    super.textDidChange(textInput)
    if currentTab == .text { showTab(.text) }
  }

  private func flash(_ message: String) {
    toast.text = "  \(message)  "
    view.bringSubviewToFront(toast)
    UIView.animate(withDuration: 0.15) { self.toast.alpha = 1 }
    toastTimer?.invalidate()
    toastTimer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: false) {
      [weak self] _ in
      UIView.animate(withDuration: 0.25) { self?.toast.alpha = 0 }
    }
  }

  // MARK: - Tab bar

  private func buildTabBar() {
    tabBar.axis = .horizontal
    tabBar.distribution = .fillEqually
    tabBar.spacing = 6
    let items: [(Tab, String)] = [
      (.keys, "Keyboard"),
      (.clipboard, "Clipboard"),
      (.text, "Text tools"),
    ]
    for (t, title) in items {
      let b = UIButton(type: .system)
      b.setTitle(title, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
      b.layer.cornerRadius = 8
      b.tag = t.rawValue
      b.accessibilityIdentifier = "kb.tab.\(title)"
      b.addTarget(self, action: #selector(tabTapped(_:)), for: .touchUpInside)
      tabBar.addArrangedSubview(b)
    }
    tabBar.heightAnchor.constraint(equalToConstant: 32).isActive = true
  }

  @objc private func tabTapped(_ sender: UIButton) {
    showTab(Tab(rawValue: sender.tag) ?? .keys)
  }

  private func styleTabBar() {
    for case let b as UIButton in tabBar.arrangedSubviews {
      let active = b.tag == currentTab.rawValue
      b.backgroundColor = active
        ? UIColor.systemBlue
        : UIColor.secondarySystemBackground.withAlphaComponent(0.7)
      b.setTitleColor(active ? .white : .label, for: .normal)
    }
  }

  private func showTab(_ t: Tab) {
    currentTab = t
    styleTabBar()
    content.subviews.forEach { $0.removeFromSuperview() }
    switch t {
    case .keys:
      heightConstraint?.constant = editor == nil ? 284 : 344
      buildKeys()
    case .clipboard:
      heightConstraint?.constant = 330
      buildClipboard()
    case .text:
      heightConstraint?.constant = 330
      buildTextTools()
    }
  }

  // MARK: - Keys tab

  private var keyBackground: UIColor {
    UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0.32, alpha: 1)
        : .white
    }
  }

  private var specialBackground: UIColor {
    UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(white: 0.18, alpha: 1)
        : UIColor(red: 0.72, green: 0.74, blue: 0.78, alpha: 1)
    }
  }

  private func makeKey(
    _ title: String,
    special: Bool = false,
    fontSize: CGFloat = 22,
    height: CGFloat = 46
  ) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.setTitleColor(.label, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: fontSize)
    b.titleLabel?.lineBreakMode = .byTruncatingTail
    b.titleLabel?.adjustsFontSizeToFitWidth = true
    b.titleLabel?.minimumScaleFactor = 0.6
    b.backgroundColor = special ? specialBackground : keyBackground
    b.layer.cornerRadius = 6
    b.layer.shadowColor = UIColor.black.cgColor
    b.layer.shadowOffset = CGSize(width: 0, height: 1)
    b.layer.shadowOpacity = 0.25
    b.layer.shadowRadius = 0
    b.translatesAutoresizingMaskIntoConstraints = false
    b.heightAnchor.constraint(equalToConstant: height).isActive = true
    return b
  }

  private func keyRow(_ keys: [UIButton]) -> UIStackView {
    let row = UIStackView(arrangedSubviews: keys)
    row.axis = .horizontal
    row.distribution = .fillEqually
    row.spacing = 5
    return row
  }

  private var letterRows: [[String]] {
    if !symbols {
      return [
        ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
        ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
        ["z", "x", "c", "v", "b", "n", "m"],
      ]
    }
    if symbolsPage2 {
      return [
        ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="],
        ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•"],
        [".", ",", "?", "!", "'"],
      ]
    }
    return [
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
      ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""],
      [".", ",", "?", "!", "'"],
    ]
  }

  private func buildKeys() {
    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 8
    stack.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
      stack.topAnchor.constraint(equalTo: content.topAnchor),
      stack.bottomAnchor.constraint(lessThanOrEqualTo: content.bottomAnchor),
    ])

    if let editor {
      stack.addArrangedSubview(editorBar(editor))
    }

    for (index, letters) in letterRows.enumerated() {
      var keys: [UIButton] = []
      if index == 2 && !symbols {
        let title = capsLock ? "⇪" : (shifted ? "⬆︎" : "⇧")
        let shift = makeKey(title, special: true, fontSize: 18)
        shift.accessibilityLabel = capsLock ? "Caps lock" : "Shift"
        shift.backgroundColor = (shifted || capsLock) ? .white : specialBackground
        shift.addTarget(self, action: #selector(shiftTapped), for: .touchUpInside)
        keys.append(shift)
      }
      if index == 2 && symbols {
        let more = makeKey(symbolsPage2 ? "123" : "#+=", special: true, fontSize: 16)
        more.addTarget(self, action: #selector(symbolsMoreTapped), for: .touchUpInside)
        keys.append(more)
      }
      for letter in letters {
        let upper = !symbols && (shifted || capsLock)
        let key = makeKey(upper ? letter.uppercased() : letter, fontSize: symbols ? 20 : 22)
        key.accessibilityLabel = letter
        key.addTarget(self, action: #selector(charTapped(_:)), for: .touchUpInside)
        keys.append(key)
      }
      if index == 2 {
        let del = makeKey("⌫", special: true, fontSize: 18)
        del.accessibilityLabel = "Delete"
        del.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside)
        del.addTarget(self, action: #selector(deleteDown), for: .touchDown)
        del.addTarget(
          self,
          action: #selector(deleteUp),
          for: [.touchUpInside, .touchUpOutside, .touchCancel]
        )
        keys.append(del)
      }
      stack.addArrangedSubview(keyRow(keys))
    }

    // Bottom row: page toggle, [globe], cursor left, space, cursor right, return.
    let toggle = makeKey(symbols ? "ABC" : "123", special: true, fontSize: 16)
    toggle.addTarget(self, action: #selector(pageTapped), for: .touchUpInside)
    var bottomKeys: [UIButton] = [toggle]
    var globe: UIButton?
    if needsInputModeSwitchKey {
      let g = makeKey("🌐", special: true, fontSize: 16)
      g.accessibilityLabel = "Next keyboard"
      g.addTarget(
        self,
        action: #selector(handleInputModeList(from:with:)),
        for: .allTouchEvents
      )
      bottomKeys.append(g)
      globe = g
    }
    let left = makeKey("◀︎", special: true, fontSize: 14)
    left.accessibilityLabel = "Move cursor left"
    left.addTarget(self, action: #selector(cursorLeft), for: .touchUpInside)
    let space = makeKey("space", fontSize: 16)
    space.addTarget(self, action: #selector(spaceTapped), for: .touchUpInside)
    let right = makeKey("▶︎", special: true, fontSize: 14)
    right.accessibilityLabel = "Move cursor right"
    right.addTarget(self, action: #selector(cursorRight), for: .touchUpInside)
    let ret = makeKey(editor == nil ? "return" : "⏎", special: true, fontSize: 16)
    ret.addTarget(self, action: #selector(returnTapped), for: .touchUpInside)
    bottomKeys += [left, space, right, ret]

    let bottom = UIStackView(arrangedSubviews: bottomKeys)
    bottom.axis = .horizontal
    bottom.spacing = 5
    bottom.distribution = .fill
    toggle.widthAnchor.constraint(equalTo: content.widthAnchor, multiplier: 0.13).isActive = true
    globe?.widthAnchor.constraint(equalTo: content.widthAnchor, multiplier: 0.1).isActive = true
    left.widthAnchor.constraint(equalTo: content.widthAnchor, multiplier: 0.09).isActive = true
    right.widthAnchor.constraint(equalTo: content.widthAnchor, multiplier: 0.09).isActive = true
    ret.widthAnchor.constraint(equalTo: content.widthAnchor, multiplier: 0.16).isActive = true
    stack.addArrangedSubview(bottom)
  }

  /// The clip editor: shows the draft (typed with these keys), Save and
  /// Cancel. Shown above the keys while editing or creating a clip.
  private func editorBar(_ editor: ClipEditor) -> UIView {
    let bar = UIStackView()
    bar.axis = .horizontal
    bar.spacing = 6
    bar.alignment = .center

    let label = UILabel()
    label.text = editor.text.isEmpty
      ? (editor.id == nil ? "New clip — type it below" : "Empty")
      : editor.text + "▏"
    label.font = .systemFont(ofSize: 14)
    label.textColor = editor.text.isEmpty ? .secondaryLabel : .label
    label.numberOfLines = 2
    label.lineBreakMode = .byTruncatingHead
    label.backgroundColor = keyBackground
    label.layer.cornerRadius = 8
    label.clipsToBounds = true
    label.setContentHuggingPriority(.defaultLow, for: .horizontal)
    label.heightAnchor.constraint(equalToConstant: 48).isActive = true
    label.accessibilityIdentifier = "kb.editor.text"

    let cancel = smallButton("Cancel", tag: 0, action: #selector(editorCancel))
    let save = smallButton("Save", tag: 0, action: #selector(editorSave))
    save.backgroundColor = .systemBlue
    save.setTitleColor(.white, for: .normal)
    cancel.widthAnchor.constraint(equalToConstant: 66).isActive = true
    save.widthAnchor.constraint(equalToConstant: 58).isActive = true
    bar.addArrangedSubview(label)
    bar.addArrangedSubview(cancel)
    bar.addArrangedSubview(save)
    return bar
  }

  /// All typing goes through here: into the clip draft while editing,
  /// otherwise into the host text field.
  private func typeText(_ text: String) {
    if editor != nil {
      editor?.text += text
      showTab(.keys)
    } else {
      textDocumentProxy.insertText(text)
    }
  }

  private func backspace() {
    if editor != nil {
      if !(editor?.text.isEmpty ?? true) { editor?.text.removeLast() }
      showTab(.keys)
    } else {
      textDocumentProxy.deleteBackward()
    }
  }

  @objc private func charTapped(_ sender: UIButton) {
    guard let letter = sender.accessibilityLabel else { return }
    let upper = !symbols && (shifted || capsLock)
    typeText(upper ? letter.uppercased() : letter)
    if shifted && !capsLock {
      shifted = false
      showTab(.keys)
    }
  }

  @objc private func shiftTapped() {
    // Double-tap shift locks caps, like the system keyboard.
    if let last = lastShiftAt, Date().timeIntervalSince(last) < 0.35 {
      capsLock = true
      shifted = true
      lastShiftAt = nil
    } else if capsLock {
      capsLock = false
      shifted = false
      lastShiftAt = nil
    } else {
      shifted.toggle()
      lastShiftAt = Date()
    }
    showTab(.keys)
  }

  @objc private func pageTapped() {
    symbols.toggle()
    symbolsPage2 = false
    showTab(.keys)
  }

  @objc private func symbolsMoreTapped() {
    symbolsPage2.toggle()
    showTab(.keys)
  }

  @objc private func deleteTapped() {
    backspace()
  }

  @objc private func deleteDown() {
    deleteTimer?.invalidate()
    deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.45, repeats: false) {
      [weak self] _ in
      self?.deleteTimer = Timer.scheduledTimer(
        withTimeInterval: 0.06,
        repeats: true
      ) { [weak self] _ in
        self?.backspace()
      }
    }
  }

  @objc private func deleteUp() {
    deleteTimer?.invalidate()
    deleteTimer = nil
  }

  @objc private func cursorLeft() {
    if editor == nil { textDocumentProxy.adjustTextPosition(byCharacterOffset: -1) }
  }

  @objc private func cursorRight() {
    if editor == nil { textDocumentProxy.adjustTextPosition(byCharacterOffset: 1) }
  }

  private func loadSnippets() {
    guard hasFullAccess else {
      snippets = [:]
      return
    }
    var map: [String: String] = [:]
    for clip in SharedVault.clips() {
      if let word = (clip["shortcut"] as? String)?.lowercased(), !word.isEmpty,
        let text = clip["text"] as? String
      {
        map[word] = text
      }
    }
    snippets = map
  }

  /// Snippets: if the word just typed is a clip's shortcut, replace it
  /// with the clip's text. Same rule as src/lib/clips.ts matchSnippet.
  /// Returns true when it expanded.
  private func expandSnippet() -> Bool {
    guard editor == nil, !snippets.isEmpty else { return false }
    let before = textDocumentProxy.documentContextBeforeInput ?? ""
    guard let last = before.last, !last.isWhitespace else { return false }
    let word = String(before.reversed().prefix { !$0.isWhitespace }.reversed())
    guard word.count >= 2, word.count <= 16, let text = snippets[word.lowercased()] else {
      return false
    }
    for _ in 0..<word.count { textDocumentProxy.deleteBackward() }
    textDocumentProxy.insertText(text)
    return true
  }

  @objc private func spaceTapped() {
    if expandSnippet() {
      textDocumentProxy.insertText(" ")
      lastSpaceAt = nil
      return
    }
    // Double-tap space ends the sentence, like the system keyboard.
    if let last = lastSpaceAt, Date().timeIntervalSince(last) < 0.3 {
      backspace()
      typeText(". ")
      lastSpaceAt = nil
      return
    }
    typeText(" ")
    lastSpaceAt = Date()
  }

  @objc private func returnTapped() {
    typeText("\n")
  }

  @objc private func editorCancel() {
    editor = nil
    showTab(.clipboard)
  }

  @objc private func editorSave() {
    guard let editor else { return }
    let ok: Bool
    if let id = editor.id {
      ok = SharedVault.updateClip(id: id, text: editor.text)
    } else {
      ok = SharedVault.saveClip(editor.text)
    }
    if !ok {
      flash(editor.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "Type something first" : "Couldn’t save — is Full Access on?")
      return
    }
    self.editor = nil
    showTab(.clipboard)
    flash("Saved")
  }

  // MARK: - Clipboard tab

  private func smallButton(_ title: String, tag: Int, action: Selector) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
    b.titleLabel?.adjustsFontSizeToFitWidth = true
    b.titleLabel?.minimumScaleFactor = 0.7
    b.setTitleColor(.label, for: .normal)
    b.backgroundColor = keyBackground
    b.layer.cornerRadius = 8
    b.tag = tag
    b.heightAnchor.constraint(equalToConstant: 34).isActive = true
    b.addTarget(self, action: action, for: .touchUpInside)
    return b
  }

  private var pasteboardText: String {
    hasFullAccess ? (UIPasteboard.general.string ?? "") : ""
  }

  private func buildClipboard() {
    rowTexts.removeAll()
    rowIds.removeAll()
    let outer = UIStackView()
    outer.axis = .vertical
    outer.spacing = 6
    outer.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(outer)
    NSLayoutConstraint.activate([
      outer.leadingAnchor.constraint(equalTo: content.leadingAnchor),
      outer.trailingAnchor.constraint(equalTo: content.trailingAnchor),
      outer.topAnchor.constraint(equalTo: content.topAnchor),
      outer.bottomAnchor.constraint(equalTo: content.bottomAnchor),
    ])

    // Actions on the field being typed in.
    let actions = UIStackView()
    actions.axis = .horizontal
    actions.distribution = .fillEqually
    actions.spacing = 5
    actions.addArrangedSubview(smallButton("Paste", tag: 0, action: #selector(pasteTapped)))
    actions.addArrangedSubview(smallButton("Copy", tag: 0, action: #selector(copyTapped)))
    actions.addArrangedSubview(smallButton("Cut", tag: 0, action: #selector(cutTapped)))
    actions.addArrangedSubview(smallButton("Save", tag: 0, action: #selector(saveSelectionTapped)))
    actions.addArrangedSubview(smallButton("New", tag: 0, action: #selector(newClipTapped)))
    let clearTitle = (confirmClearUntil.map { $0 > Date() } ?? false) ? "Sure?" : "Clear"
    actions.addArrangedSubview(smallButton(clearTitle, tag: 0, action: #selector(clearTapped)))
    outer.addArrangedSubview(actions)

    let scroll = UIScrollView()
    scroll.alwaysBounceVertical = true
    outer.addArrangedSubview(scroll)
    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 6
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
      stack.topAnchor.constraint(equalTo: scroll.topAnchor),
      stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
      stack.widthAnchor.constraint(equalTo: scroll.widthAnchor),
    ])

    guard hasFullAccess else {
      let label = UILabel()
      label.text =
        "Turn on Allow Full Access (Settings → General → Keyboard → Keyboards → Everytool) to paste, copy, cut and keep clips here. Typing works either way."
      label.font = .systemFont(ofSize: 14)
      label.textColor = .secondaryLabel
      label.numberOfLines = 0
      label.textAlignment = .center
      stack.addArrangedSubview(label)
      return
    }

    let clips = SharedVault.clips()

    // The current system clipboard rides on top, with a one-tap Save,
    // unless it's already a saved clip.
    let current = pasteboardText.trimmingCharacters(in: .whitespacesAndNewlines)
    if !current.isEmpty && !clips.contains(where: { ($0["text"] as? String) == current }) {
      stack.addArrangedSubview(sectionLabel("On the clipboard now"))
      stack.addArrangedSubview(clipRow(id: nil, text: current, pinned: false))
    }

    if clips.isEmpty {
      let label = UILabel()
      label.text = "No saved clips yet. Select text and tap Copy or Cut, tap Save to keep what's on the clipboard, or New to type one."
      label.font = .systemFont(ofSize: 14)
      label.textColor = .secondaryLabel
      label.numberOfLines = 0
      label.textAlignment = .center
      stack.addArrangedSubview(label)
      return
    }
    stack.addArrangedSubview(sectionLabel("Saved · tap to insert · [word] + space expands"))
    for clip in clips {
      guard let text = clip["text"] as? String else { continue }
      let id = clip["id"] as? String
      let pinned = (clip["pinned"] as? Bool) ?? false
      let shortcut = (clip["shortcut"] as? String).flatMap { $0.isEmpty ? nil : $0 }
      stack.addArrangedSubview(clipRow(id: id, text: text, pinned: pinned, shortcut: shortcut))
    }
  }

  private func sectionLabel(_ text: String) -> UILabel {
    let l = UILabel()
    l.text = text
    l.font = .systemFont(ofSize: 12, weight: .semibold)
    l.textColor = .secondaryLabel
    return l
  }

  /// Clip ids are carried on the row buttons; the text is looked up again
  /// at tap time so an edit made elsewhere is never inserted stale.
  private var rowTexts: [Int: String] = [:]
  private var rowIds: [Int: String] = [:]
  private var nextRowTag = 1000

  private func registerRow(id: String?, text: String) -> Int {
    nextRowTag += 1
    rowTexts[nextRowTag] = text
    if let id { rowIds[nextRowTag] = id }
    return nextRowTag
  }

  /// One clip: tap the text to insert it; the icons copy, edit, pin and
  /// delete. A row with id == nil is the live pasteboard (save only).
  private func clipRow(id: String?, text: String, pinned: Bool, shortcut: String? = nil) -> UIView {
    let tag = registerRow(id: id, text: text)
    let row = UIStackView()
    row.axis = .horizontal
    row.spacing = 4
    row.alignment = .center

    let main = UIButton(type: .system)
    main.setTitle((pinned ? "★ " : "") + (shortcut.map { "[\($0)] " } ?? "") + text, for: .normal)
    main.setTitleColor(.label, for: .normal)
    main.titleLabel?.font = .systemFont(ofSize: 15)
    main.titleLabel?.numberOfLines = 2
    main.titleLabel?.lineBreakMode = .byTruncatingTail
    main.contentHorizontalAlignment = .left
    main.backgroundColor = keyBackground
    main.layer.cornerRadius = 8
    main.contentEdgeInsets = UIEdgeInsets(top: 8, left: 10, bottom: 8, right: 10)
    main.tag = tag
    main.accessibilityLabel = text
    main.addTarget(self, action: #selector(clipTapped(_:)), for: .touchUpInside)
    main.heightAnchor.constraint(greaterThanOrEqualToConstant: 40).isActive = true
    main.setContentHuggingPriority(.defaultLow, for: .horizontal)
    row.addArrangedSubview(main)

    func icon(_ title: String, _ label: String, _ action: Selector) -> UIButton {
      let b = UIButton(type: .system)
      b.setTitle(title, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 15)
      b.backgroundColor = specialBackground
      b.layer.cornerRadius = 8
      b.tag = tag
      b.accessibilityLabel = label
      b.widthAnchor.constraint(equalToConstant: 34).isActive = true
      b.heightAnchor.constraint(equalToConstant: 34).isActive = true
      b.addTarget(self, action: action, for: .touchUpInside)
      return b
    }

    if id == nil {
      let save = icon("＋", "Save clip", #selector(saveRowTapped(_:)))
      save.widthAnchor.constraint(equalToConstant: 52).isActive = true
      row.addArrangedSubview(save)
    } else {
      row.addArrangedSubview(icon("⧉", "Copy clip", #selector(copyRowTapped(_:))))
      row.addArrangedSubview(icon("✎", "Edit clip", #selector(editRowTapped(_:))))
      row.addArrangedSubview(icon(pinned ? "★" : "☆", pinned ? "Unpin clip" : "Pin clip",
                                  #selector(pinRowTapped(_:))))
      row.addArrangedSubview(icon("✕", "Delete clip", #selector(deleteRowTapped(_:))))
    }
    return row
  }

  // Field actions -----------------------------------------------------

  @objc private func pasteTapped() {
    let text = pasteboardText
    guard !text.isEmpty else {
      flash(hasFullAccess ? "Clipboard is empty" : "Needs Full Access")
      return
    }
    textDocumentProxy.insertText(text)
    flash("Pasted")
  }

  @objc private func copyTapped() {
    guard hasFullAccess else { return flash("Needs Full Access") }
    guard let selected = textDocumentProxy.selectedText, !selected.isEmpty else {
      return flash("Select text in the field first")
    }
    UIPasteboard.general.string = selected
    SharedVault.saveClip(selected)
    showTab(.clipboard)
    flash("Copied & saved")
  }

  @objc private func cutTapped() {
    guard hasFullAccess else { return flash("Needs Full Access") }
    guard let selected = textDocumentProxy.selectedText, !selected.isEmpty else {
      return flash("Select text in the field first")
    }
    UIPasteboard.general.string = selected
    SharedVault.saveClip(selected)
    // With a selection, deleteBackward removes exactly the selection.
    textDocumentProxy.deleteBackward()
    showTab(.clipboard)
    flash("Cut & saved")
  }

  /// Save: the selection if there is one, otherwise the clipboard.
  @objc private func saveSelectionTapped() {
    guard hasFullAccess else { return flash("Needs Full Access") }
    if let selected = textDocumentProxy.selectedText, !selected.isEmpty {
      SharedVault.saveClip(selected)
      showTab(.clipboard)
      return flash("Selection saved")
    }
    let text = pasteboardText
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return flash("Nothing to save — copy or select text")
    }
    SharedVault.saveClip(text)
    showTab(.clipboard)
    flash("Clipboard saved")
  }

  @objc private func newClipTapped() {
    guard hasFullAccess else { return flash("Needs Full Access") }
    editor = ClipEditor(id: nil, text: "")
    showTab(.keys)
  }

  @objc private func clearTapped() {
    guard hasFullAccess else { return flash("Needs Full Access") }
    if let until = confirmClearUntil, until > Date() {
      confirmClearUntil = nil
      SharedVault.clearUnpinnedClips()
      showTab(.clipboard)
      flash("Cleared (pinned clips kept)")
    } else {
      confirmClearUntil = Date().addingTimeInterval(3)
      showTab(.clipboard)
    }
  }

  // Row actions -------------------------------------------------------

  @objc private func clipTapped(_ sender: UIButton) {
    guard let text = rowTexts[sender.tag] else { return }
    textDocumentProxy.insertText(text)
  }

  @objc private func saveRowTapped(_ sender: UIButton) {
    guard let text = rowTexts[sender.tag] else { return }
    SharedVault.saveClip(text)
    showTab(.clipboard)
    flash("Saved")
  }

  @objc private func copyRowTapped(_ sender: UIButton) {
    guard let text = rowTexts[sender.tag] else { return }
    UIPasteboard.general.string = text
    flash("Copied")
  }

  @objc private func editRowTapped(_ sender: UIButton) {
    guard let id = rowIds[sender.tag], let text = rowTexts[sender.tag] else { return }
    editor = ClipEditor(id: id, text: text)
    showTab(.keys)
  }

  @objc private func pinRowTapped(_ sender: UIButton) {
    guard let id = rowIds[sender.tag] else { return }
    SharedVault.togglePin(id: id)
    showTab(.clipboard)
  }

  @objc private func deleteRowTapped(_ sender: UIButton) {
    guard let id = rowIds[sender.tag] else { return }
    SharedVault.deleteClip(id: id)
    showTab(.clipboard)
    flash("Deleted")
  }

  // MARK: - Text tab

  private var draftContext: String {
    (textDocumentProxy.documentContextBeforeInput ?? "")
      + (textDocumentProxy.documentContextAfterInput ?? "")
  }

  private func buildTextTools() {
    rowTexts.removeAll()
    rowIds.removeAll()
    let scroll = UIScrollView()
    scroll.translatesAutoresizingMaskIntoConstraints = false
    content.addSubview(scroll)
    NSLayoutConstraint.activate([
      scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
      scroll.topAnchor.constraint(equalTo: content.topAnchor),
      scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor),
    ])
    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 8
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
      stack.topAnchor.constraint(equalTo: scroll.topAnchor),
      stack.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
      stack.widthAnchor.constraint(equalTo: scroll.widthAnchor),
    ])

    let draft = draftContext
    let pasteboard = pasteboardText
    let source = draft.isEmpty ? pasteboard : draft

    let counts = UILabel()
    let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
    let words = trimmed.isEmpty
      ? 0
      : trimmed.split(whereSeparator: { $0.isWhitespace }).count
    counts.text =
      source.isEmpty
      ? "Type something, or copy text, to use these."
      : "\(words) words · \(source.count) characters"
        + (draft.isEmpty ? " (from clipboard)" : "")
    counts.font = .systemFont(ofSize: 14, weight: .semibold)
    counts.textColor = .label
    counts.numberOfLines = 0
    stack.addArrangedSubview(counts)

    let actions = UIStackView()
    actions.axis = .horizontal
    actions.distribution = .fillEqually
    actions.spacing = 6
    for (title, tag) in [("Links", 1), ("Emails", 2), ("Phones", 3)] {
      let b = smallButton(title, tag: tag, action: #selector(extractTapped(_:)))
      actions.addArrangedSubview(b)
    }
    stack.addArrangedSubview(actions)

    let transforms = UIStackView()
    transforms.axis = .horizontal
    transforms.distribution = .fillEqually
    transforms.spacing = 6
    for (title, tag) in [("Remove duplicates", 4), ("Sort A–Z", 5)] {
      let b = smallButton(title, tag: tag, action: #selector(transformTapped(_:)))
      transforms.addArrangedSubview(b)
    }
    stack.addArrangedSubview(transforms)

    let results = UIStackView()
    results.axis = .vertical
    results.spacing = 6
    results.tag = 99
    stack.addArrangedSubview(results)
  }

  private func extractItems(kind: Int, from source: String) -> [String] {
    let pattern: String
    switch kind {
    case 1: pattern = #"(https?://|www\.)[^\s<>"')\]]+"#
    case 2: pattern = #"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#
    default: pattern = #"(\+?1[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}"#
    }
    guard
      let regex = try? NSRegularExpression(pattern: pattern)
    else { return [] }
    let range = NSRange(source.startIndex..., in: source)
    var seen = Set<String>()
    var out: [String] = []
    for match in regex.matches(in: source, range: range) {
      guard let r = Range(match.range, in: source) else { continue }
      var value = String(source[r])
      if kind == 1 {
        value = value.replacingOccurrences(
          of: #"[.,;:!?]+$"#,
          with: "",
          options: .regularExpression
        )
      }
      if seen.insert(value.lowercased()).inserted { out.append(value) }
    }
    return out
  }

  @objc private func extractTapped(_ sender: UIButton) {
    guard
      let stack = content.viewWithTag(99) as? UIStackView
    else { return }
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    let draft = draftContext
    let source = draft.isEmpty ? pasteboardText : draft
    let items = extractItems(kind: sender.tag, from: source)
    if items.isEmpty {
      let label = UILabel()
      label.text = "Nothing found in this text."
      label.font = .systemFont(ofSize: 13)
      label.textColor = .secondaryLabel
      stack.addArrangedSubview(label)
      return
    }
    for item in items {
      let tag = registerRow(id: nil, text: item)
      let b = UIButton(type: .system)
      b.setTitle(item, for: .normal)
      b.setTitleColor(.systemBlue, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 14)
      b.titleLabel?.numberOfLines = 1
      b.titleLabel?.lineBreakMode = .byTruncatingTail
      b.contentHorizontalAlignment = .left
      b.tag = tag
      b.accessibilityLabel = item
      b.addTarget(self, action: #selector(clipTapped(_:)), for: .touchUpInside)
      stack.addArrangedSubview(b)
    }
  }

  @objc private func transformTapped(_ sender: UIButton) {
    // Transforms rewrite the text before the cursor — the only part of
    // the field a keyboard may touch. Capped, and a no-op in password
    // fields (iOS swaps those to the system keyboard anyway).
    let before = textDocumentProxy.documentContextBeforeInput ?? ""
    guard !before.isEmpty else { return flash("Type some lines first") }
    guard before.count <= 1500 else {
      return flash("Too long for the keyboard — use the app")
    }
    var lines = before.split(separator: "\n", omittingEmptySubsequences: false)
      .map(String.init)
    if sender.tag == 4 {
      var seen = Set<String>()
      lines = lines.filter {
        seen.insert($0.trimmingCharacters(in: .whitespaces)).inserted
      }
    } else {
      let nonEmpty = lines.filter {
        !$0.trimmingCharacters(in: .whitespaces).isEmpty
      }
      lines = nonEmpty.sorted {
        $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
      }
    }
    for _ in 0..<before.count { textDocumentProxy.deleteBackward() }
    textDocumentProxy.insertText(lines.joined(separator: "\n"))
    showTab(.text)
  }
}
