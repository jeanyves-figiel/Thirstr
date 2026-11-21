import ActivityKit
import ExpoModulesCore
import UIKit

// F-13 R-13.20 (#119): date check-in Live Activity + app-icon quick actions.
// The app calls liveSync / liveEnd only when the check-in changes (start, +30 min, end), so the
// activity costs nothing while it runs: iOS draws the countdown itself (see targets/safety-live).

struct LivePayload: Record {
  /// ms since epoch
  @Field var started: Double = 0
  @Field var due: Double = 0
  @Field var title: String = ""
  @Field var sub: String = ""
  @Field var lateTitle: String = ""
  @Field var lateSub: String = ""
  @Field var ok: String = ""
  @Field var more: String = ""
  @Field var sos: String = ""
  @Field var late: String = ""
  @Field var canExtend: Bool = true
}

struct ShortcutRecord: Record {
  /// start | ok | more | sos
  @Field var type: String = ""
  @Field var title: String = ""
  @Field var subtitle: String?
  /// SF Symbol name
  @Field var symbol: String = ""
}

/// Quick action taps arrive in the app delegate, possibly before JS runs: kept until JS takes it.
enum SafetyShortcuts {
  static let notification = Notification.Name("ThirstrSafetyShortcut")
  static let prefix = "thirstr.safety."
  private static let lock = NSLock()
  private static var pending: String?

  static func receive(_ type: String) -> Bool {
    guard type.hasPrefix(prefix) else { return false }
    let action = String(type.dropFirst(prefix.count))
    lock.lock()
    pending = action
    lock.unlock()
    NotificationCenter.default.post(name: notification, object: action)
    return true
  }

  static func take() -> String? {
    lock.lock()
    defer { lock.unlock() }
    let action = pending
    pending = nil
    return action
  }
}

public class ThirstrSafetyAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    completionHandler(SafetyShortcuts.receive(shortcutItem.type))
  }
}

public class ThirstrSafetyModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ThirstrSafety")

    Events("onShortcut")

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(forName: SafetyShortcuts.notification, object: nil, queue: .main) { [weak self] _ in
        // take() so the same tap is not handled twice (event now + takeShortcut on next launch).
        if let action = SafetyShortcuts.take() {
          self?.sendEvent("onShortcut", ["type": action])
        }
      }
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
      }
      self.observer = nil
    }

    // ------------------------------------------------------------ Live Activity

    Function("liveSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    Function("liveRunning") { () -> Bool in
      if #available(iOS 16.2, *) {
        return Activity<SafetyAttributes>.activities.contains { $0.activityState == .active || $0.activityState == .stale }
      }
      return false
    }

    // Starts the activity, or updates the running one. One activity at most.
    AsyncFunction("liveSync") { (p: LivePayload) async throws -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
      let due = Date(timeIntervalSince1970: p.due / 1000)
      let started = min(Date(timeIntervalSince1970: p.started / 1000), due)
      let state = SafetyAttributes.ContentState(
        started: started, due: due, sub: p.sub, lateTitle: p.lateTitle, lateSub: p.lateSub, canExtend: p.canExtend
      )
      let content = ActivityContent(state: state, staleDate: due, relevanceScore: 100)
      let running = Activity<SafetyAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
      if let first = running.first {
        await first.update(content)
        for extra in running.dropFirst() {
          await extra.end(nil, dismissalPolicy: .immediate)
        }
        return true
      }
      let attrs = SafetyAttributes(title: p.title, ok: p.ok, more: p.more, sos: p.sos, late: p.late)
      _ = try Activity.request(attributes: attrs, content: content, pushType: nil)
      return true
    }

    AsyncFunction("liveEnd") { () async -> Void in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<SafetyAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }

    // ------------------------------------------------------------ Quick actions

    Function("setShortcuts") { (items: [ShortcutRecord]) in
      let list = items.map {
        UIApplicationShortcutItem(
          type: SafetyShortcuts.prefix + $0.type,
          localizedTitle: $0.title,
          localizedSubtitle: $0.subtitle,
          icon: UIApplicationShortcutIcon(systemImageName: $0.symbol),
          userInfo: nil
        )
      }
      DispatchQueue.main.async {
        UIApplication.shared.shortcutItems = list
      }
    }

    // A quick action that launched the app before JS listened.
    Function("takeShortcut") { () -> String? in
      SafetyShortcuts.take()
    }
  }
}
