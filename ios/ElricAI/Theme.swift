import SwiftUI

/// Colours mirror the web app (web/src/style.css).
enum Theme {
  static let bg = Color(hex: 0x0F0F12)
  static let s1 = Color(hex: 0x17171C)
  static let s2 = Color(hex: 0x1F1F26)
  static let line = Color(hex: 0x2A2A33)
  static let tx = Color(hex: 0xECECF1)
  static let mu = Color(hex: 0x9A9AA6)
  static let gold = Color(hex: 0xD4A64A)
  static let ind = Color(hex: 0x6C6CF0)
  static let ok = Color(hex: 0x3DBE7A)
  static let warn = Color(hex: 0xE0A44A)
  static let onGold = Color(hex: 0x1A1405)
  static let violet = Color(hex: 0x9C9CFF)
  static let brand = LinearGradient(colors: [gold, ind], startPoint: .leading, endPoint: .trailing)
}

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255)
  }
}

enum Fmt {
  static func gb(_ bytes: Int64) -> String { String(format: "%.1f GB", Double(bytes) / 1e9) }
  static func mb(_ bytes: Int64) -> String { String(format: "%.0f MB", Double(bytes) / 1e6) }
}
