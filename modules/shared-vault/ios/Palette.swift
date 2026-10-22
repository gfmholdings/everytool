import UIKit

/// Native mirror of src/theme.ts. Extensions and the app use these roles.
/// Bytes match the token hex; the palette test fails if they drift.
enum Palette {
  static func ui(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> UIColor {
    UIColor(red: r / 255, green: g / 255, blue: b / 255, alpha: a)
  }

  static func dynamic(light: UIColor, dark: UIColor) -> UIColor {
    UIColor { traits in
      traits.userInterfaceStyle == .dark ? dark : light
    }
  }

  static let primary = dynamic(light: ui(0, 102, 214), dark: ui(77, 163, 255))
  static let onPrimary = dynamic(light: ui(255, 255, 255), dark: ui(28, 28, 30))
  static let secondary = dynamic(light: ui(232, 232, 237), dark: ui(44, 44, 46))
  static let onSecondary = dynamic(light: ui(28, 28, 30), dark: ui(255, 255, 255))
  static let surface = dynamic(light: ui(255, 255, 255), dark: ui(28, 28, 30))
  static let background = dynamic(light: ui(242, 242, 247), dark: ui(0, 0, 0))
  static let textPrimary = dynamic(light: ui(28, 28, 30), dark: ui(255, 255, 255))
  static let textSecondary = dynamic(light: ui(92, 99, 112), dark: ui(174, 174, 178))
  static let destructive = dynamic(light: ui(215, 0, 21), dark: ui(255, 69, 58))
  static let onDestructive = dynamic(light: ui(255, 255, 255), dark: ui(28, 28, 30))
  static let success = dynamic(light: ui(30, 122, 52), dark: ui(48, 209, 88))
  static let warning = dynamic(light: ui(154, 77, 0), dark: ui(255, 159, 10))
  static let separator = dynamic(light: ui(133, 133, 138), dark: ui(133, 133, 138))
  static let toast = dynamic(light: ui(28, 28, 30), dark: ui(58, 58, 60))
  static let onToast = dynamic(light: ui(255, 255, 255), dark: ui(255, 255, 255))
  static let media = dynamic(light: ui(0, 0, 0), dark: ui(0, 0, 0))
  static let onMedia = dynamic(light: ui(255, 255, 255), dark: ui(255, 255, 255))
  static let mediaRaised = dynamic(light: ui(28, 28, 30), dark: ui(28, 28, 30))
  static let mediaTrack = dynamic(light: ui(44, 44, 46), dark: ui(44, 44, 46))
  static let keyboardBackground = dynamic(light: ui(209, 214, 219), dark: ui(28, 28, 30))
  static let keyBackground = dynamic(light: ui(255, 255, 255), dark: ui(82, 82, 82))
  static let keySpecial = dynamic(light: ui(184, 189, 199), dark: ui(46, 46, 46))
}
