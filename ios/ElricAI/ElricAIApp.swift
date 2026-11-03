import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
  /// Called when the background model download finishes while the app was suspended.
  func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    ModelStore.shared.backgroundCompletionHandler = completionHandler
    ModelStore.shared.reconnect()
  }
}

@main
struct ElricAIApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
  @StateObject private var loc = Loc()
  @StateObject private var store = ModelStore.shared
  @StateObject private var llm = LLMService()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(loc)
        .environmentObject(store)
        .environmentObject(llm)
        .preferredColorScheme(.dark)
    }
  }
}
