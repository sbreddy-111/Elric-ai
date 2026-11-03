import SwiftUI

struct SheetView: View {
  @EnvironmentObject var loc: Loc
  let kind: SheetKind
  @Binding var mode: Mode
  @Binding var sheet: SheetKind?
  let clearChat: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 4) {
        content
        Button(loc.t("close")) { sheet = nil }
          .frame(maxWidth: .infinity).padding(10)
          .foregroundStyle(Theme.mu)
          .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
          .padding(.top, 14)
      }
      .padding(18)
    }
    .foregroundStyle(Theme.tx)
  }

  @ViewBuilder private var content: some View {
    switch kind {
    case .menu:
      HStack(spacing: 12) {
        Image("Mark").resizable().frame(width: 40, height: 40)
        VStack(alignment: .leading) {
          Text("Elric AI").bold()
          Text(loc.t("modeStudyDesc")).font(.system(size: 13)).foregroundStyle(Theme.gold)
        }
      }
      .padding(.bottom, 10)
      row(loc.t("menuModels"), sub: loc.t("modelLite")) { sheet = .models }
      row(loc.t("menuLanguage"), sub: loc.t("langName")) { loc.toggle() }
      row(loc.t("menuClear")) { clearChat(); sheet = nil }
      row(loc.t("menuAbout")) { sheet = .about }
      row(loc.t("menuLicenses")) { sheet = .licenses }
      row(loc.t("menuPrivacy")) { sheet = .privacy }
    case .mode:
      Text(loc.t("cdMode")).font(.title3.bold()).padding(.bottom, 8)
      ForEach(Mode.allCases) { m in
        row(loc.t(m.key), sub: loc.t(m.descKey), selected: m == mode) {
          mode = m
          sheet = nil
        }
      }
    case .models:
      Text(loc.t("menuModels")).font(.title3.bold())
      StatusCard()
    case .about:
      title("menuAbout")
      para("aboutBody")
    case .privacy:
      title("menuPrivacy")
      para("privacyBody")
    case .photo:
      title("photoSoonTitle")
      para("photoSoonBodyIOS")
    case .mic:
      title("micSoonTitle")
      para("micSoonBodyIOS")
    case .licenses:
      title("menuLicenses")
      para("licensesIntro")
      ForEach(Licenses.all) { lic in
        VStack(alignment: .leading, spacing: 4) {
          Text(lic.name).bold()
          Text(lic.license).font(.system(size: 13)).foregroundStyle(Theme.gold)
          if let url = URL(string: lic.url) {
            Link(lic.url, destination: url).font(.system(size: 13)).foregroundStyle(Theme.gold)
          }
          Text(lic.notice).font(.system(size: 12)).foregroundStyle(Theme.mu)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.s2))
        .padding(.top, 8)
      }
      Text(Licenses.apache2Summary).font(.system(size: 12)).foregroundStyle(Theme.mu).padding(.top, 10)
    }
  }

  private func title(_ key: String) -> some View {
    Text(loc.t(key)).font(.title3.bold()).padding(.vertical, 4)
  }

  private func para(_ key: String) -> some View {
    Text(loc.t(key)).font(.system(size: 14.5)).foregroundStyle(Color(hex: 0xC9C9D2))
  }

  private func row(_ title: String, sub: String? = nil, selected: Bool = false, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).bold().foregroundStyle(selected ? Theme.gold : Theme.tx)
        if let sub { Text(sub).font(.system(size: 13)).foregroundStyle(Theme.mu) }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(12)
      .background(RoundedRectangle(cornerRadius: 12).fill(selected ? Theme.s2 : Color.clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

struct License: Identifiable {
  var id: String { name }
  let name: String
  let license: String
  let url: String
  let notice: String
}

enum Licenses {
  // The licenses screen is the one place the underlying open model is credited by name.
  static let all: [License] = [
    License(
      name: "Elric AI", license: "Apache License 2.0",
      url: "https://github.com/sbreddy-111/Elric-ai",
      notice: "Elric AI app. Based on Google AI Edge Gallery (Apache-2.0)."),
    License(
      name: "Gemma 4 (E2B, LiteRT-LM build)", license: "Apache License 2.0",
      url: "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm",
      notice: "The open model behind Elric Lite. Copyright Google LLC."),
    License(
      name: "LiteRT-LM", license: "Apache License 2.0",
      url: "https://github.com/google-ai-edge/LiteRT-LM",
      notice: "On-device language model runtime. Copyright Google LLC. Includes third-party components under their own open-source licenses."),
  ]

  static let apache2Summary =
    "Licensed under the Apache License, Version 2.0 (the \"License\"); you may not use these files except in compliance with the License. You may obtain a copy of the License at https://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an \"AS IS\" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied."
}
