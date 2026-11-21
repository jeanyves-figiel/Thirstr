import ActivityKit
import SwiftUI
import WidgetKit

// F-13 R-13.20 (#119): date check-in on the lock screen and in the Dynamic Island.
// Mockup: https://claude.ai/artifact/Nh3emJ4gZCADsoZYztURDH
// iOS draws the countdown and the bar from `due` (Text/ProgressView timerInterval), and flips to the
// past-due look at `staleDate = due`: no app wake-ups, no pushes, no network.
// Every button is a deep link that opens the app (app lock + duress PIN stay in the path).

private enum Pop {
  static let ink = Color(red: 0x17 / 255, green: 0x14 / 255, blue: 0x2E / 255)
  static let overlay = Color(red: 0x2E / 255, green: 0x2A / 255, blue: 0x55 / 255)
  static let line = Color(red: 0x39 / 255, green: 0x34 / 255, blue: 0x6A / 255)
  static let fg2 = Color(red: 0xC2 / 255, green: 0xBD / 255, blue: 0xE3 / 255)
  static let trust = Color(red: 0x3D / 255, green: 0xD6 / 255, blue: 0xC3 / 255)
  static let danger = Color(red: 0xFF / 255, green: 0x4D / 255, blue: 0x6D / 255)

  /// Bricolage Grotesque ExtraBold (bundled in the extension); iOS falls back to the system font if missing.
  static func display(_ size: CGFloat) -> Font { .custom("BricolageGrotesque-ExtraBold", size: size) }
}

private enum SafetyLink {
  static let quick = URL(string: "thirstr://safety/quick")!
  static let ok = URL(string: "thirstr://safety/ok")!
  static let more = URL(string: "thirstr://safety/more")!
  static let sos = URL(string: "thirstr://safety/sos")!
}

private extension ActivityViewContext where Attributes == SafetyAttributes {
  var late: Bool { isStale || state.due <= Date() }
  var tint: Color { late ? Pop.danger : Pop.trust }
  var range: ClosedRange<Date> { min(state.started, state.due)...state.due }
  var titleText: String { late ? state.lateTitle : attributes.title }
  var subText: String { late ? state.lateSub : state.sub }
}

@main
struct SafetyLiveBundle: WidgetBundle {
  var body: some Widget {
    SafetyLiveActivity()
  }
}

struct SafetyLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SafetyAttributes.self) { context in
      LockScreenView(context: context)
        .activityBackgroundTint(Pop.ink.opacity(0.9))
        .activitySystemActionForegroundColor(Pop.trust)
        .widgetURL(SafetyLink.quick)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ShieldBadge(tint: context.tint, size: 34)
            .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 1) {
            Text(context.titleText)
              .font(Pop.display(15))
              .foregroundStyle(.white)
              .lineLimit(1)
            Text(context.subText)
              .font(.system(size: 12, weight: .medium))
              .foregroundStyle(Pop.fg2)
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.trailing) {
          TimeLeft(context: context, size: 22)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ActionRow(context: context)
            .padding(.top, 6)
        }
      } compactLeading: {
        ShieldBadge(tint: context.tint, size: 22)
      } compactTrailing: {
        TimeLeft(context: context, size: 14)
          .frame(maxWidth: 58)
      } minimal: {
        ProgressView(timerInterval: context.range, countsDown: true) {
          EmptyView()
        } currentValueLabel: {
          Image(systemName: "shield.fill")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(context.tint)
        }
        .progressViewStyle(.circular)
        .tint(context.tint)
      }
      .widgetURL(SafetyLink.quick)
      .keylineTint(context.tint)
    }
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<SafetyAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 10) {
        ShieldBadge(tint: context.tint, size: 34)
        VStack(alignment: .leading, spacing: 1) {
          Text(context.titleText)
            .font(Pop.display(15))
            .foregroundStyle(.white)
            .lineLimit(1)
          Text(context.subText)
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(Pop.fg2)
            .lineLimit(1)
        }
        Spacer(minLength: 6)
        TimeLeft(context: context, size: 26)
      }
      if context.late {
        Capsule().fill(Pop.danger).frame(height: 5)
      } else {
        ProgressView(timerInterval: context.range, countsDown: true) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
        .progressViewStyle(.linear)
        .tint(Pop.trust)
        .background(Pop.line, in: Capsule())
      }
      ActionRow(context: context)
    }
    .padding(14)
  }
}

private struct ShieldBadge: View {
  let tint: Color
  let size: CGFloat

  var body: some View {
    ZStack {
      Circle().fill(tint)
      Image(systemName: "shield")
        .font(.system(size: size * 0.5, weight: .heavy))
        .foregroundStyle(Pop.ink)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

private struct TimeLeft: View {
  let context: ActivityViewContext<SafetyAttributes>
  let size: CGFloat

  var body: some View {
    Group {
      if context.late {
        Text(context.attributes.late)
      } else {
        Text(timerInterval: context.range, countsDown: true)
      }
    }
    .font(Pop.display(size))
    .monospacedDigit()
    .multilineTextAlignment(.trailing)
    .foregroundStyle(context.tint)
    .lineLimit(1)
    .minimumScaleFactor(0.7)
  }
}

private struct ActionRow: View {
  let context: ActivityViewContext<SafetyAttributes>

  var body: some View {
    HStack(spacing: 6) {
      Link(destination: SafetyLink.ok) {
        Pill(text: context.attributes.ok, fg: context.late ? .white : Pop.ink, bg: context.tint)
      }
      if context.state.canExtend {
        Link(destination: SafetyLink.more) {
          Pill(text: context.attributes.more, fg: .white, bg: Pop.overlay)
        }
      }
      Link(destination: SafetyLink.sos) {
        Pill(text: context.attributes.sos, fg: Pop.danger, bg: Pop.danger.opacity(0.18), stroke: Pop.danger, grow: false)
      }
    }
  }
}

private struct Pill: View {
  let text: String
  let fg: Color
  let bg: Color
  var stroke: Color? = nil
  var grow = true

  var body: some View {
    Text(text)
      .font(Pop.display(13))
      .foregroundStyle(fg)
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      .padding(.horizontal, 14)
      .frame(maxWidth: grow ? .infinity : nil, minHeight: 34)
      .background(bg, in: Capsule())
      .overlay {
        if let stroke {
          Capsule().strokeBorder(stroke, lineWidth: 1.5)
        }
      }
  }
}
