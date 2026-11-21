import ActivityKit
import Foundation

// F-13 R-13.20 (#119): shape of the date check-in Live Activity.
// This file exists twice, byte for byte: targets/safety-live (widget extension) and
// modules/thirstr-safety/ios (app). ActivityKit matches the two by type name.
// __tests__/safetyNative.test.ts fails if they drift apart.
// All text comes from the app (en/fr/de). Nothing here names the date or says "Thirstr" (lock screen privacy).
public struct SafetyAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// Check-in start; the bar shows time left over (due - started).
    public var started: Date
    /// Due time. iOS draws the countdown and marks the activity stale here (danger look).
    public var due: Date
    /// "Due 23:40 · 2 contacts in the loop"
    public var sub: String
    /// "Check in now"
    public var lateTitle: String
    /// "Your contacts get an alert at 23:55"
    public var lateSub: String
    /// false after 3 extensions (R-13.6): the +30 min button is hidden.
    public var canExtend: Bool

    public init(started: Date, due: Date, sub: String, lateTitle: String, lateSub: String, canExtend: Bool) {
      self.started = started
      self.due = due
      self.sub = sub
      self.lateTitle = lateTitle
      self.lateSub = lateSub
      self.canExtend = canExtend
    }
  }

  /// "Safety check-in"
  public var title: String
  public var ok: String
  public var more: String
  public var sos: String
  /// Short past-due word for the timer slot ("Late").
  public var late: String

  public init(title: String, ok: String, more: String, sos: String, late: String) {
    self.title = title
    self.ok = ok
    self.more = more
    self.sos = sos
    self.late = late
  }
}
