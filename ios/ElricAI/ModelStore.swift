import Foundation
import UIKit

/// Downloads and stores the on-device model ("Elric Lite").
///
/// - Uses a background URLSession so the download continues if the user switches apps.
/// - Pausing / failures keep URLSession resume data on disk, so the download continues
///   from where it stopped instead of restarting.
/// - The finished file lives in Application Support and is excluded from iCloud backup.
final class ModelStore: NSObject, ObservableObject {
  static let shared = ModelStore()

  // litert-community/gemma-4-E2B-it-litert-lm (Apache-2.0, ungated).
  // Never shown in the UI; users only see "Elric Lite".
  static let remoteURL = URL(
    string:
      "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm"
  )!
  static let expectedBytes: Int64 = 2_588_147_712
  static let sessionID = "in.elricai.app.model-download"

  enum State: Equatable {
    case idle
    case downloading
    case stored
    case failed(String)
  }

  @Published private(set) var state: State = .idle
  @Published private(set) var bytesDone: Int64 = 0
  @Published private(set) var bytesTotal: Int64 = ModelStore.expectedBytes

  var progress: Double { bytesTotal > 0 ? min(1, Double(bytesDone) / Double(bytesTotal)) : 0 }
  var hasPartial: Bool { resumeData != nil && bytesDone > 0 }

  var backgroundCompletionHandler: (() -> Void)?

  private var session: URLSession!
  private var task: URLSessionDownloadTask?

  // MARK: Paths

  static var modelsDir: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("Models", isDirectory: true)
  }
  static var modelURL: URL { modelsDir.appendingPathComponent("elric-lite.litertlm") }
  private static var resumeURL: URL { modelsDir.appendingPathComponent("elric-lite.resume") }
  private static let resumeBytesKey = "elric.resumeBytes"

  private var resumeData: Data? {
    get { try? Data(contentsOf: Self.resumeURL) }
    set {
      if let newValue {
        try? newValue.write(to: Self.resumeURL, options: .atomic)
        var u = Self.resumeURL
        Self.excludeFromBackup(&u)
      } else {
        try? FileManager.default.removeItem(at: Self.resumeURL)
        UserDefaults.standard.removeObject(forKey: Self.resumeBytesKey)
      }
    }
  }

  // MARK: Init

  override init() {
    super.init()
    try? FileManager.default.createDirectory(at: Self.modelsDir, withIntermediateDirectories: true)
    var dir = Self.modelsDir
    Self.excludeFromBackup(&dir)

    let cfg = URLSessionConfiguration.background(withIdentifier: Self.sessionID)
    cfg.isDiscretionary = false
    cfg.sessionSendsLaunchEvents = true
    cfg.allowsCellularAccess = true
    cfg.timeoutIntervalForResource = 60 * 60 * 24
    session = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)

    if isStoredAndValid() {
      state = .stored
      bytesDone = Self.expectedBytes
    } else {
      bytesDone = Int64(UserDefaults.standard.integer(forKey: Self.resumeBytesKey))
    }
    reconnect()
  }

  /// Re-attaches to a download that the system kept running while the app was closed.
  func reconnect() {
    session.getAllTasks { [weak self] tasks in
      guard let self else { return }
      if let t = tasks.compactMap({ $0 as? URLSessionDownloadTask }).first(where: { $0.state == .running }) {
        self.task = t
        DispatchQueue.main.async {
          self.state = .downloading
          self.setScreenAwake(true)
        }
      }
    }
  }

  func isStoredAndValid() -> Bool {
    let attrs = try? FileManager.default.attributesOfItem(atPath: Self.modelURL.path)
    let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    return size == Self.expectedBytes
  }

  static func freeDiskBytes() -> Int64 {
    let url = URL(fileURLWithPath: NSHomeDirectory())
    let v = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
    return v?.volumeAvailableCapacityForImportantUsage ?? 0
  }

  // MARK: Actions

  func start(loc: Loc) {
    guard state != .downloading else { return }
    let need = Self.expectedBytes - bytesDone + 200_000_000
    let free = Self.freeDiskBytes()
    if free > 0 && free < need {
      state = .failed(loc.t("reasonStorageIOS", ["need": Fmt.gb(need), "have": Fmt.gb(free)]))
      return
    }
    if let data = resumeData {
      task = session.downloadTask(withResumeData: data)
    } else {
      var req = URLRequest(url: Self.remoteURL)
      req.setValue("ElricAI-iOS", forHTTPHeaderField: "User-Agent")
      task = session.downloadTask(with: req)
      bytesDone = 0
    }
    task?.countOfBytesClientExpectsToReceive = Self.expectedBytes
    state = .downloading
    setScreenAwake(true)
    task?.resume()
  }

  /// Pauses and keeps resume data, so "Resume download" continues where it stopped.
  func pause() {
    guard let task else { state = .idle; return }
    task.cancel(byProducingResumeData: { [weak self] data in
      guard let self else { return }
      if let data { self.resumeData = data }
      DispatchQueue.main.async {
        self.task = nil
        self.state = .idle
        self.setScreenAwake(false)
      }
    })
  }

  func remove() {
    task?.cancel()
    task = nil
    resumeData = nil
    try? FileManager.default.removeItem(at: Self.modelURL)
    bytesDone = 0
    state = .idle
    setScreenAwake(false)
  }

  func clearFailure() {
    if case .failed = state { state = isStoredAndValid() ? .stored : .idle }
  }

  private func setScreenAwake(_ on: Bool) {
    DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = on }
  }

  static func excludeFromBackup(_ url: inout URL) {
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
  }
}

// MARK: - URLSessionDownloadDelegate

extension ModelStore: URLSessionDownloadDelegate {
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : Self.expectedBytes
    UserDefaults.standard.set(Int(totalBytesWritten), forKey: Self.resumeBytesKey)
    DispatchQueue.main.async {
      self.bytesDone = totalBytesWritten
      self.bytesTotal = total
      if self.state != .downloading { self.state = .downloading }
    }
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didResumeAtOffset fileOffset: Int64,
    expectedTotalBytes: Int64
  ) {
    DispatchQueue.main.async { self.bytesDone = fileOffset }
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL
  ) {
    // The temp file is deleted when this method returns, so move it synchronously.
    let fm = FileManager.default
    let attrs = try? fm.attributesOfItem(atPath: location.path)
    let size = (attrs?[.size] as? NSNumber)?.int64Value ?? -1
    let http = downloadTask.response as? HTTPURLResponse
    var failure: String?

    if let http, !(200..<300).contains(http.statusCode) {
      failure = "HTTP \(http.statusCode)"
    } else if size != Self.expectedBytes {
      let loc = Loc()
      failure = loc.t("sizeMismatch", ["got": Fmt.mb(size), "want": Fmt.mb(Self.expectedBytes)])
    } else {
      do {
        try fm.createDirectory(at: Self.modelsDir, withIntermediateDirectories: true)
        if fm.fileExists(atPath: Self.modelURL.path) { try fm.removeItem(at: Self.modelURL) }
        try fm.moveItem(at: location, to: Self.modelURL)
        var dst = Self.modelURL
        Self.excludeFromBackup(&dst)
      } catch {
        failure = "Could not save the model: \(error.localizedDescription)"
      }
    }
    resumeData = nil
    let ok = failure == nil
    DispatchQueue.main.async {
      self.task = nil
      self.setScreenAwake(false)
      if ok {
        self.bytesDone = Self.expectedBytes
        self.state = .stored
      } else {
        self.bytesDone = 0
        self.state = .failed(failure ?? "")
      }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let error else { return }  // success is handled in didFinishDownloadingTo
    let ns = error as NSError
    if let data = ns.userInfo[NSURLSessionDownloadTaskResumeData] as? Data {
      resumeData = data
    }
    let cancelled = ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled
    DispatchQueue.main.async {
      self.task = nil
      self.setScreenAwake(false)
      if cancelled {
        if self.state == .downloading { self.state = .idle }
      } else {
        self.state = .failed(error.localizedDescription)
      }
    }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    DispatchQueue.main.async {
      self.backgroundCompletionHandler?()
      self.backgroundCompletionHandler = nil
    }
  }
}
