import UIKit

/// The Everytool keyboard. It is a real typing keyboard first — full
/// QWERTY, symbols page, shift, delete-repeat, globe key — and it works
/// completely with Full Access OFF. Two extra tabs ride along:
///
/// - Clipboard: the shared vault (App Group). Tap a clip to insert it.
/// - Text tools: counts and extraction over the text around the cursor
///   (the only text iOS lets a keyboard see), plus the system clipboard
///   when Full Access is on.
///
/// Nothing here touches the network. That is a product promise.
final class KeyboardViewController: UIInputViewController {
  private enum Tab: Int {
    case keys, clipboard, text
  }

  // Named currentTab, not tab: UIViewController grew its own `tab`
  // property (UITab?) in recent iOS SDKs and a same-named stored
  // property collides with it.
  private var currentTab: Tab = .keys
  private var shifted = false
  private var symbols = false
  private var lastSpaceAt: Date?

  private let rootStack = UIStackView()
  private let tabBar = UIStackView()
  private let content = UIView()
  private var heightConstraint: NSLayoutConstraint?
  private var deleteTimer: Timer?

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
    showTab(.keys)
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    // Refresh whichever tab is showing: clips may have changed in the app.
    showTab(currentTab)
  }

  override func textDidChange(_ textInput: UITextInput?) {
    super.textDidChange(textInput)
    if currentTab == .text { showTab(.text) }
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
      b.addTarget(self, action: #selector(tabTapped(_:)), for: .touchUpInside)
      tabBar.addArrangedSubview(b)
    }
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
    heightConstraint?.constant = t == .keys ? 284 : 330
    switch t {
    case .keys: buildKeys()
    case .clipboard: buildClipboard()
    case .text: buildTextTools()
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
    fontSize: CGFloat = 22
  ) -> UIButton {
    let b = UIButton(type: .system)
    b.setTitle(title, for: .normal)
    b.setTitleColor(.label, for: .normal)
    b.titleLabel?.font = .systemFont(ofSize: fontSize)
    b.titleLabel?.lineBreakMode = .byTruncatingTail
    b.backgroundColor = special ? specialBackground : keyBackground
    b.layer.cornerRadius = 6
    b.layer.shadowColor = UIColor.black.cgColor
    b.layer.shadowOffset = CGSize(width: 0, height: 1)
    b.layer.shadowOpacity = 0.25
    b.layer.shadowRadius = 0
    b.translatesAutoresizingMaskIntoConstraints = false
    b.heightAnchor.constraint(equalToConstant: 52).isActive = true
    return b
  }

  private func keyRow(_ keys: [UIButton]) -> UIStackView {
    let row = UIStackView(arrangedSubviews: keys)
    row.axis = .horizontal
    row.distribution = .fillEqually
    row.spacing = 5
    return row
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
      stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
    ])

    let rows: [[String]] =
      symbols
      ? [
          ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
          ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""],
          [".", ",", "?", "!", "'"],
        ]
      : [
          ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
          ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
          ["z", "x", "c", "v", "b", "n", "m"],
        ]

    for (index, letters) in rows.enumerated() {
      var keys: [UIButton] = []
      if index == 2 && !symbols {
        let shift = makeKey(shifted ? "⇪" : "⇧", special: true, fontSize: 18)
        shift.addTarget(self, action: #selector(shiftTapped), for: .touchUpInside)
        keys.append(shift)
      }
      if index == 2 && symbols {
        let more = makeKey("#+=", special: true, fontSize: 16)
        more.addTarget(self, action: #selector(symbolsMoreTapped), for: .touchUpInside)
        keys.append(more)
      }
      for letter in letters {
        let display =
          !symbols && shifted ? letter.uppercased() : letter
        let key = makeKey(display, fontSize: symbols ? 20 : 22)
        key.accessibilityLabel = letter
        key.addTarget(self, action: #selector(charTapped(_:)), for: .touchUpInside)
        keys.append(key)
      }
      if index == 2 {
        let del = makeKey("⌫", special: true, fontSize: 18)
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

    // Bottom row: page toggle, globe, space, return.
    let toggle = makeKey(symbols ? "ABC" : "123", special: true, fontSize: 16)
    toggle.addTarget(self, action: #selector(pageTapped), for: .touchUpInside)
    let globe = makeKey("🌐", special: true, fontSize: 16)
    globe.addTarget(
      self,
      action: #selector(handleInputModeList(from:with:)),
      for: .allTouchEvents
    )
    let space = makeKey("space", fontSize: 16)
    space.addTarget(self, action: #selector(spaceTapped), for: .touchUpInside)
    let ret = makeKey("return", special: true, fontSize: 16)
    ret.addTarget(self, action: #selector(returnTapped), for: .touchUpInside)

    let bottom = UIStackView(arrangedSubviews: [toggle, globe, space, ret])
    bottom.axis = .horizontal
    bottom.spacing = 5
    bottom.distribution = .fill
    toggle.widthAnchor.constraint(equalTo: content.widthAnchor, multiplier: 0.16)
      .isActive = true
    globe.widthAnchor.constraint(equalTo: content.widthAnchor, multiplier: 0.12)
      .isActive = true
    ret.widthAnchor.constraint(equalTo: content.widthAnchor, multiplier: 0.16)
      .isActive = true
    stack.addArrangedSubview(bottom)
  }

  @objc private func charTapped(_ sender: UIButton) {
    guard let letter = sender.accessibilityLabel else { return }
    textDocumentProxy.insertText(shifted && !symbols ? letter.uppercased() : letter)
    if shifted {
      shifted = false
      showTab(.keys)
    }
  }

  @objc private func shiftTapped() {
    shifted.toggle()
    showTab(.keys)
  }

  @objc private func pageTapped() {
    symbols.toggle()
    showTab(.keys)
  }

  @objc private func symbolsMoreTapped() {
    // A second symbol layer is beyond what fits honestly here; the
    // button cycles back to letters instead of pretending.
    symbols = false
    showTab(.keys)
  }

  @objc private func deleteTapped() {
    textDocumentProxy.deleteBackward()
  }

  @objc private func deleteDown() {
    deleteTimer?.invalidate()
    deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.45, repeats: false) {
      [weak self] _ in
      self?.deleteTimer = Timer.scheduledTimer(
        withTimeInterval: 0.06,
        repeats: true
      ) { [weak self] _ in
        self?.textDocumentProxy.deleteBackward()
      }
    }
  }

  @objc private func deleteUp() {
    deleteTimer?.invalidate()
    deleteTimer = nil
  }

  @objc private func spaceTapped() {
    // Double-tap space ends the sentence, like the system keyboard.
    if let last = lastSpaceAt, Date().timeIntervalSince(last) < 0.3 {
      textDocumentProxy.deleteBackward()
      textDocumentProxy.insertText(". ")
      lastSpaceAt = nil
      return
    }
    textDocumentProxy.insertText(" ")
    lastSpaceAt = Date()
  }

  @objc private func returnTapped() {
    textDocumentProxy.insertText("\n")
  }

  // MARK: - Clipboard tab

  private func buildClipboard() {
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

    let clips = SharedVault.clips()
    if clips.isEmpty {
      let label = UILabel()
      label.text =
        hasFullAccess
        ? "Nothing saved yet. Save text in the Everytool app and it shows up here."
        : "Turn on Allow Full Access in Settings to use your saved clips here. Typing works either way."
      label.font = .systemFont(ofSize: 14)
      label.textColor = .secondaryLabel
      label.numberOfLines = 0
      label.textAlignment = .center
      stack.addArrangedSubview(label)
      return
    }
    let hint = UILabel()
    hint.text = "Tap to insert"
    hint.font = .systemFont(ofSize: 12, weight: .semibold)
    hint.textColor = .secondaryLabel
    stack.addArrangedSubview(hint)
    for clip in clips {
      guard let text = clip["text"] as? String else { continue }
      let pinned = (clip["pinned"] as? Bool) ?? false
      let b = UIButton(type: .system)
      b.setTitle((pinned ? "★ " : "") + text, for: .normal)
      b.setTitleColor(.label, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 15)
      b.titleLabel?.numberOfLines = 2
      b.titleLabel?.lineBreakMode = .byTruncatingTail
      b.contentHorizontalAlignment = .left
      b.backgroundColor = keyBackground
      b.layer.cornerRadius = 8
      b.contentEdgeInsets = UIEdgeInsets(top: 9, left: 12, bottom: 9, right: 12)
      b.accessibilityLabel = text
      b.addTarget(self, action: #selector(clipTapped(_:)), for: .touchUpInside)
      stack.addArrangedSubview(b)
    }
  }

  @objc private func clipTapped(_ sender: UIButton) {
    guard let text = sender.accessibilityLabel else { return }
    textDocumentProxy.insertText(text)
  }

  // MARK: - Text tab

  private var draftContext: String {
    (textDocumentProxy.documentContextBeforeInput ?? "")
      + (textDocumentProxy.documentContextAfterInput ?? "")
  }

  private func buildTextTools() {
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
    let pasteboard =
      hasFullAccess ? (UIPasteboard.general.string ?? "") : ""
    let source = draft.isEmpty ? pasteboard : draft

    let counts = UILabel()
    let words =
      source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      ? 0
      : source
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .split(whereSeparator: { $0.isWhitespace }).count
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
      let b = UIButton(type: .system)
      b.setTitle(title, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
      b.backgroundColor = keyBackground
      b.layer.cornerRadius = 8
      b.tag = tag
      b.heightAnchor.constraint(equalToConstant: 40).isActive = true
      b.addTarget(self, action: #selector(extractTapped(_:)), for: .touchUpInside)
      actions.addArrangedSubview(b)
    }
    stack.addArrangedSubview(actions)

    let transforms = UIStackView()
    transforms.axis = .horizontal
    transforms.distribution = .fillEqually
    transforms.spacing = 6
    for (title, tag) in [("Remove duplicates", 4), ("Sort A–Z", 5)] {
      let b = UIButton(type: .system)
      b.setTitle(title, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
      b.backgroundColor = keyBackground
      b.layer.cornerRadius = 8
      b.tag = tag
      b.heightAnchor.constraint(equalToConstant: 40).isActive = true
      b.addTarget(self, action: #selector(transformTapped(_:)), for: .touchUpInside)
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
    let source =
      draft.isEmpty && hasFullAccess
      ? (UIPasteboard.general.string ?? "")
      : draft
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
      let b = UIButton(type: .system)
      b.setTitle(item, for: .normal)
      b.setTitleColor(.systemBlue, for: .normal)
      b.titleLabel?.font = .systemFont(ofSize: 14)
      b.titleLabel?.numberOfLines = 1
      b.titleLabel?.lineBreakMode = .byTruncatingTail
      b.contentHorizontalAlignment = .left
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
    guard !before.isEmpty, before.count <= 1500 else { return }
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
