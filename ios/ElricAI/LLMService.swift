import Foundation
import LiteRTLM
import os

/// Runs Elric Lite on-device with the LiteRT-LM Swift API.
@MainActor
final class LLMService: ObservableObject {
  /// Same system prompt as the web app (web/src/engine.ts SYSTEM_PROMPT).
  static let systemPrompt =
    "You are Elric AI, built on open models. Answer reliably in the user's language (English or Hindi). If unsure, say so. If asked which model or company you are, say you are Elric AI, built on open models."

  enum State: Equatable {
    case notLoaded
    case loading
    case ready
    case failed(String)
  }

  enum Device: String { case gpu, cpu }

  @Published private(set) var state: State = .notLoaded
  @Published private(set) var device: Device = .gpu

  private var engine: Engine?
  private var conversation: Conversation?

  /// Loads the model. On failure the real error text is kept so it can be shown on screen.
  func load(on device: Device = .gpu) async {
    guard state != .loading else { return }
    self.device = device
    state = .loading
    let path = ModelStore.modelURL.path
    let cacheDir = Self.cacheDir()
    do {
      let (eng, conv) = try await Task.detached(priority: .userInitiated) {
        let config = try EngineConfig(
          modelPath: path,
          backend: device == .gpu ? .gpu : .cpu(),
          maxNumTokens: 4096,
          cacheDir: cacheDir
        )
        let eng = Engine(engineConfig: config)
        try await eng.initialize()
        let conv = try await eng.createConversation(with: LLMService.conversationConfig())
        return (eng, conv)
      }.value
      engine = eng
      conversation = conv
      state = .ready
    } catch {
      engine = nil
      conversation = nil
      state = .failed(Self.describe(error, device: device))
    }
  }

  /// Starts a fresh conversation (new chat) while keeping the engine loaded.
  func newConversation() async {
    guard let engine else { return }
    try? conversation?.cancel()
    conversation = try? await engine.createConversation(with: Self.conversationConfig())
  }

  /// Streams the answer as text chunks.
  func stream(_ text: String) -> AsyncThrowingStream<String, Error> {
    guard let conversation else {
      return AsyncThrowingStream { $0.finish(throwing: LLMNotReady()) }
    }
    return AsyncThrowingStream { continuation in
      let task = Task.detached {
        do {
          for try await chunk in conversation.sendMessageStream(Message(text)) {
            var piece = ""
            for content in chunk.contents.contents {
              if case .text(let t) = content { piece += t }
            }
            if !piece.isEmpty { continuation.yield(piece) }
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  func stop() {
    try? conversation?.cancel()
  }

  func unload() {
    try? conversation?.cancel()
    conversation = nil
    engine = nil
    state = .notLoaded
  }

  func resetFailure() {
    if case .failed = state { state = .notLoaded }
  }

  // MARK: Helpers

  nonisolated static func conversationConfig() throws -> ConversationConfig {
    // Low temperature: favour reliable, repeatable answers over creativity.
    let sampler = try SamplerConfig(topK: 20, topP: 0.9, temperature: 0.2)
    return ConversationConfig(
      systemMessage: Message(systemPrompt, role: .system),
      samplerConfig: sampler
    )
  }

  nonisolated static func cacheDir() -> String {
    let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let dir = base.appendingPathComponent("litertlm", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.path
  }

  nonisolated static func describe(_ error: Error, device: Device) -> String {
    var lines: [String] = []
    lines.append("Backend: \(device.rawValue.uppercased())")
    if let le = error as? LocalizedError, let d = le.errorDescription { lines.append(d) }
    lines.append(String(describing: error))
    let ns = error as NSError
    if ns.domain != "" && !(error is LiteRTLMError) {
      lines.append("\(ns.domain) code \(ns.code)")
    }
    if let native = LiteRTLMError.getLastErrorMessage(), !native.isEmpty {
      lines.append("Native: \(native)")
    }
    lines.append(MemoryInfo.summary())
    var seen = Set<String>()
    return lines.filter { seen.insert($0).inserted }.joined(separator: "\n")
  }
}

struct LLMNotReady: LocalizedError {
  var errorDescription: String? { "Elric Lite is not loaded." }
}

enum MemoryInfo {
  static var physical: Int64 { Int64(ProcessInfo.processInfo.physicalMemory) }
  static var availableToApp: Int64 { Int64(os_proc_available_memory()) }

  static func summary() -> String {
    "RAM \(Fmt.gb(physical)), available to app \(Fmt.gb(availableToApp)), iOS \(ProcessInfo.processInfo.operatingSystemVersionString)"
  }
}
