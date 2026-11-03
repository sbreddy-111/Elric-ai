import SwiftUI
import UIKit

enum Mode: String, CaseIterable, Identifiable {
  case study, shopping, general
  var id: String { rawValue }
  var key: String {
    switch self {
    case .study: return "modeStudy"
    case .shopping: return "modeShopping"
    case .general: return "modeGeneral"
    }
  }
  var descKey: String { key + "Desc" }
}

struct Turn: Identifiable, Equatable {
  enum Role { case user, model }
  let id = UUID()
  var role: Role
  var text: String
}

enum SheetKind: String, Identifiable {
  case menu, mode, models, about, licenses, privacy, photo, mic
  var id: String { rawValue }
}

struct ContentView: View {
  @EnvironmentObject var loc: Loc
  @EnvironmentObject var store: ModelStore
  @EnvironmentObject var llm: LLMService

  @State private var mode: Mode = .study
  @State private var turns: [Turn] = []
  @State private var input = ""
  @State private var busy = false
  @State private var sheet: SheetKind?
  @State private var genTask: Task<Void, Never>?
  @FocusState private var inputFocused: Bool

  var body: some View {
    VStack(spacing: 0) {
      header
      pill.padding(.bottom, 4)
      ScrollViewReader { proxy in
        ScrollView {
          if turns.isEmpty {
            hero
          } else {
            chat
          }
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: turns) { _, _ in
          withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("bottom", anchor: .bottom) }
        }
      }
      composer
    }
    .frame(maxWidth: 720)
    .frame(maxWidth: .infinity)
    .background(Theme.bg.ignoresSafeArea())
    .foregroundStyle(Theme.tx)
    .sheet(item: $sheet) { kind in
      SheetView(kind: kind, mode: $mode, sheet: $sheet, clearChat: clearChat)
        .environmentObject(loc)
        .environmentObject(store)
        .environmentObject(llm)
        .presentationDetents(kind == .licenses || kind == .models ? [.large] : [.medium, .large])
        .presentationBackground(Theme.s1)
        .preferredColorScheme(.dark)
    }
  }

  // MARK: Header

  private var header: some View {
    HStack(spacing: 6) {
      iconButton("line.3.horizontal", label: loc.t("cdMenu")) { sheet = .menu }
      Button { sheet = .mode } label: {
        HStack(spacing: 4) {
          Text("Elric AI · ").fontWeight(.medium)
            + Text(loc.t(mode.key)).fontWeight(.semibold).foregroundColor(Theme.gold)
          Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mu)
        }
        .frame(maxWidth: .infinity)
      }
      .accessibilityLabel(loc.t("cdMode"))
      Button { loc.toggle() } label: {
        Text(loc.lang == .en ? "हिं" : "EN")
          .font(.system(size: 13))
          .foregroundStyle(Theme.mu)
          .padding(.horizontal, 10).padding(.vertical, 5)
          .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
      }
      iconButton("square.and.pencil", label: loc.t("cdNewChat")) { clearChat() }
    }
    .padding(.horizontal, 8).padding(.top, 8).padding(.bottom, 4)
  }

  private func iconButton(_ name: String, label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Image(systemName: name).font(.system(size: 19)).frame(width: 42, height: 42)
    }
    .accessibilityLabel(label)
  }

  private var pill: some View {
    let online = mode == .shopping
    let c = online ? Theme.violet : Theme.ok
    return HStack(spacing: 6) {
      Circle().fill(c).frame(width: 7, height: 7)
      Text(online ? loc.t("privacyOnline") : loc.t("privacyOnDevice")).font(.system(size: 12.5))
    }
    .foregroundStyle(c)
    .padding(.horizontal, 12).padding(.vertical, 4)
    .background(Capsule().fill((online ? Theme.ind : Theme.ok).opacity(0.1)))
    .overlay(Capsule().stroke((online ? Theme.ind : Theme.ok).opacity(0.3), lineWidth: 1))
  }

  // MARK: Hero

  private var hero: some View {
    VStack(alignment: .leading, spacing: 0) {
      Spacer(minLength: 24)
      Image("Mark").resizable().frame(width: 44, height: 44).padding(.bottom, 10)
      Text(loc.t("greeting"))
        .font(.system(size: 40, weight: .semibold))
        .foregroundStyle(Theme.brand)
      Text(loc.t("subtitle")).font(.system(size: 17)).foregroundStyle(Theme.mu)
        .padding(.top, 4).padding(.bottom, 20)
      LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], spacing: 10) {
        card("sugQuiz") { send(loc.t("promptQuiz")) }
        card("sugPhoto") { sheet = .photo }
        card("sugLecture") { input = loc.t("promptLecture"); inputFocused = true }
        card("sugWatch") { mode = .shopping; send(loc.t("promptWatch")) }
      }
      StatusCard()
      Color.clear.frame(height: 1).id("bottom")
    }
    .padding(.horizontal, 18).padding(.vertical, 12)
  }

  private func card(_ key: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(loc.t(key))
        .font(.system(size: 14.5))
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, minHeight: 48, alignment: .topLeading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16).fill(Theme.s1))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
  }

  // MARK: Chat

  private var chat: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(turns) { turn in
        Bubble(turn: turn)
      }
      if mode == .shopping {
        Text(loc.t("shoppingNote"))
          .font(.system(size: 12.5)).foregroundStyle(Theme.violet)
          .padding(.horizontal, 12).padding(.vertical, 8)
          .background(RoundedRectangle(cornerRadius: 12).fill(Theme.ind.opacity(0.1)))
      }
      if llm.state != .ready { StatusCard() }
      Color.clear.frame(height: 1).id("bottom")
    }
    .padding(.horizontal, 18).padding(.vertical, 12)
  }

  // MARK: Composer

  private var composer: some View {
    HStack(alignment: .bottom, spacing: 4) {
      Button { sheet = .photo } label: {
        Image(systemName: "camera").font(.system(size: 17, weight: .semibold))
          .frame(width: 40, height: 40)
          .background(Circle().fill(Theme.gold)).foregroundStyle(Theme.onGold)
      }
      .accessibilityLabel(loc.t("cdSnap"))
      TextField(loc.t("composerHint"), text: $input, axis: .vertical)
        .lineLimit(1...6)
        .focused($inputFocused)
        .padding(.vertical, 9).padding(.horizontal, 4)
        .font(.system(size: 16))
      Button { sheet = .mic } label: {
        Image(systemName: "mic").font(.system(size: 18)).frame(width: 40, height: 40)
      }
      .accessibilityLabel(loc.t("cdMic"))
      Button {
        if busy { stopGenerating() } else { send(input) }
      } label: {
        Image(systemName: busy ? "stop.fill" : "arrow.up").font(.system(size: 17, weight: .bold))
          .frame(width: 40, height: 40)
          .background(Circle().fill(Theme.tx)).foregroundStyle(Theme.bg)
      }
      .accessibilityLabel(busy ? loc.t("cdStop") : loc.t("cdSend"))
    }
    .padding(6)
    .background(RoundedRectangle(cornerRadius: 28).fill(Theme.s1))
    .overlay(RoundedRectangle(cornerRadius: 28).stroke(Theme.line, lineWidth: 1))
    .padding(.horizontal, 12).padding(.top, 6).padding(.bottom, 10)
  }

  // MARK: Actions

  private func send(_ raw: String) {
    let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !busy else { return }
    input = ""
    turns.append(Turn(role: .user, text: text))
    guard llm.state == .ready else {
      // Nothing is sent anywhere; the status card explains what is needed.
      turns.append(Turn(role: .model, text: loc.t("cantAnswer")))
      return
    }
    turns.append(Turn(role: .model, text: ""))
    let idx = turns.count - 1
    busy = true
    genTask = Task { @MainActor in
      do {
        for try await piece in llm.stream(text) {
          if idx < turns.count { turns[idx].text += piece }
        }
      } catch {
        if idx < turns.count {
          let msg = loc.t("errorAnswer", ["err": error.localizedDescription])
          turns[idx].text += (turns[idx].text.isEmpty ? "" : "\n\n") + msg
        }
      }
      if Task.isCancelled, idx < turns.count {
        turns[idx].text += (turns[idx].text.isEmpty ? "" : " ") + loc.t("stopped")
      }
      busy = false
    }
  }

  private func stopGenerating() {
    llm.stop()
    genTask?.cancel()
  }

  private func clearChat() {
    if busy { stopGenerating() }
    turns = []
    Task { await llm.newConversation() }
  }
}

// MARK: - Bubble

struct Bubble: View {
  @EnvironmentObject var loc: Loc
  let turn: Turn

  var body: some View {
    HStack {
      if turn.role == .user { Spacer(minLength: 40) }
      Group {
        if turn.text.isEmpty {
          Text("•••").foregroundStyle(Theme.mu).kerning(2)
        } else {
          Text(turn.text).textSelection(.enabled)
        }
      }
      .font(.system(size: 15.5))
      .padding(.vertical, 10)
      .padding(.horizontal, turn.role == .user ? 14 : 2)
      .background(
        UnevenRoundedRectangle(
          topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 6, topTrailingRadius: 18
        )
        .fill(turn.role == .user ? Theme.s2 : Color.clear)
      )
      if turn.role == .model { Spacer(minLength: 20) }
    }
  }
}

// MARK: - Model status card (download / load / error)

struct StatusCard: View {
  @EnvironmentObject var loc: Loc
  @EnvironmentObject var store: ModelStore
  @EnvironmentObject var llm: LLMService
  @State private var confirmRemove = false
  @State private var copied = false

  private var size: String { Fmt.gb(ModelStore.expectedBytes) }

  var body: some View {
    Group {
      if llm.state == .ready {
        Text("● \(loc.t("modelLite")) · \(loc.t("loaded"))")
          .font(.system(size: 13)).foregroundStyle(Theme.ok)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.top, 16)
      } else if case .failed(let err) = llm.state {
        errorBox(err)
      } else {
        box
      }
    }
  }

  private var box: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text(loc.t("modelLite")).bold()
        Spacer()
        Text(size).font(.system(size: 13)).foregroundStyle(Theme.mu)
      }
      Text(loc.t("modelLiteDescIOS")).font(.system(size: 14)).foregroundStyle(Theme.mu).padding(.vertical, 6)
      content
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 16).fill(Theme.s1))
    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1))
    .padding(.top, 16)
    .confirmationDialog(loc.t("removeConfirm"), isPresented: $confirmRemove, titleVisibility: .visible) {
      Button(loc.t("remove"), role: .destructive) {
        llm.unload()
        store.remove()
      }
      Button(loc.t("cancel"), role: .cancel) {}
    }
  }

  @ViewBuilder private var content: some View {
    if llm.state == .loading {
      ProgressView().tint(Theme.gold).padding(.top, 10)
      tip(loc.t("loading"))
    } else {
      switch store.state {
      case .idle:
        if store.hasPartial { progressBar(store.progress); tip(doneOf) }
        primary(store.hasPartial ? loc.t("resume") : loc.t("downloadSize", ["size": size])) {
          store.start(loc: loc)
        }
        tip(loc.t("wifiTip"))
      case .downloading:
        progressBar(store.progress)
        tip("\(loc.t("downloading", ["pct": "\(Int(store.progress * 100))%"])) · \(doneOf)")
        tip(loc.t("keepOpen"))
        ghost(loc.t("cancel")) { store.pause() }
      case .stored:
        tip("✓ \(loc.t("ready"))")
        primary(loc.t("loadModel")) { Task { await llm.load(on: .gpu) } }
        ghost(loc.t("remove")) { confirmRemove = true }
      case .failed(let msg):
        Text(loc.t("pausedTitle")).font(.system(size: 16, weight: .semibold)).padding(.top, 6)
        Text(msg).font(.system(size: 14)).foregroundStyle(Theme.warn).padding(.vertical, 6).textSelection(.enabled)
        primary(store.hasPartial ? loc.t("resume") : loc.t("retry")) {
          store.clearFailure()
          store.start(loc: loc)
        }
      }
    }
  }

  private var doneOf: String {
    loc.t("downloadedOf", ["done": Fmt.mb(store.bytesDone), "total": Fmt.mb(store.bytesTotal)])
  }

  private func errorBox(_ err: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(loc.t("cantRunTitle")).font(.system(size: 16, weight: .semibold))
      Text(loc.t("errorDetails")).font(.system(size: 13)).foregroundStyle(Theme.mu)
      ScrollView {
        Text(err)
          .font(.system(size: 12, design: .monospaced))
          .foregroundStyle(Theme.warn)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .frame(maxHeight: 220)
      .padding(10)
      .background(RoundedRectangle(cornerRadius: 10).fill(Theme.bg))
      Text(
        loc.t(
          "memNote",
          ["ram": Fmt.gb(MemoryInfo.physical), "avail": Fmt.gb(MemoryInfo.availableToApp)])
      )
      .font(.system(size: 13)).foregroundStyle(Theme.mu)
      primary(loc.t("retry")) { Task { llm.resetFailure(); await llm.load(on: .gpu) } }
      ghost(loc.t("tryCpu")) { Task { llm.resetFailure(); await llm.load(on: .cpu) } }
      ghost(copied ? loc.t("copied") : loc.t("copyError")) {
        UIPasteboard.general.string = err
        copied = true
      }
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 16).fill(Theme.s1))
    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.warn.opacity(0.4), lineWidth: 1))
    .padding(.top, 16)
  }

  private func tip(_ s: String) -> some View {
    Text(s).font(.system(size: 13)).foregroundStyle(Theme.mu).padding(.top, 8)
  }

  private func progressBar(_ p: Double) -> some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        Capsule().fill(Theme.s2)
        Capsule().fill(Theme.brand).frame(width: max(0, g.size.width * p))
      }
    }
    .frame(height: 6)
    .padding(.top, 10)
  }

  private func primary(_ title: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title).fontWeight(.semibold).frame(maxWidth: .infinity).padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.gold))
        .foregroundStyle(Theme.onGold)
    }
    .buttonStyle(.plain)
    .padding(.top, 10)
  }

  private func ghost(_ title: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Text(title).frame(maxWidth: .infinity).padding(10)
        .foregroundStyle(Theme.mu)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
    }
    .buttonStyle(.plain)
    .padding(.top, 8)
  }
}
