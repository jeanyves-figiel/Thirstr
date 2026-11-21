import ExpoModulesCore
import NaturalLanguage
import SwiftUI
import UIKit
#if canImport(Translation)
import Translation
#endif

// F-07 R-07.25–R-07.29: chat translation on the phone only.
// Detection: NaturalLanguage. Translation: Apple Translation framework (iOS 18+), driven through a
// 1×1 SwiftUI host because TranslationSession is handed out by the `.translationTask` modifier.
// No text is sent anywhere; Apple downloads language packs only (system sheet, on user tap).
public class ThirstrTranslateModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ThirstrTranslate")

    Function("supported") { () -> Bool in
      #if canImport(Translation)
      if #available(iOS 18.0, *) { return true }
      #endif
      return false
    }

    // Best language guess with its probability; empty when unsure.
    AsyncFunction("detect") { (text: String) -> [String: Any] in
      let r = NLLanguageRecognizer()
      r.processString(text)
      guard let best = r.languageHypotheses(withMaximum: 1).max(by: { $0.value < $1.value }) else { return [:] }
      return ["lang": best.key.rawValue, "p": best.value]
    }

    // "installed" | "supported" (pack not downloaded) | "unsupported"
    AsyncFunction("status") { (from: String, to: String, promise: Promise) in
      #if canImport(Translation)
      if #available(iOS 18.0, *) {
        Task {
          let s = await LanguageAvailability().status(from: Locale.Language(identifier: from), to: Locale.Language(identifier: to))
          switch s {
          case .installed: promise.resolve("installed")
          case .supported: promise.resolve("supported")
          default: promise.resolve("unsupported")
          }
        }
        return
      }
      #endif
      promise.resolve("unsupported")
    }

    // Translates a batch for one language pair. A missing pack shows the system download sheet.
    AsyncFunction("translate") { (texts: [String], from: String, to: String, promise: Promise) in
      #if canImport(Translation)
      if #available(iOS 18.0, *) {
        Task { @MainActor in
          guard TranslateHost.shared.attach() else {
            promise.reject("E_NO_WINDOW", "No window to host translation")
            return
          }
          TranslateHost.shared.model.enqueue(TranslateJob(texts: texts, from: from, to: to) { result in
            switch result {
            case .success(let out): promise.resolve(out)
            case .failure(let e): promise.reject("E_TRANSLATE", e.localizedDescription)
            }
          })
        }
        return
      }
      #endif
      promise.reject("E_UNSUPPORTED", "Translation needs iOS 18")
    }
  }
}

#if canImport(Translation)
struct TranslateJob {
  let texts: [String]
  let from: String
  let to: String
  let done: (Result<[String], Error>) -> Void
}

@available(iOS 18.0, *)
@MainActor
final class TranslateModel: ObservableObject {
  @Published var config: TranslationSession.Configuration?
  private var queue: [TranslateJob] = []
  private var current: TranslateJob?

  func enqueue(_ job: TranslateJob) {
    queue.append(job)
    next()
  }

  private func next() {
    guard current == nil, !queue.isEmpty else { return }
    let job = queue.removeFirst()
    current = job
    let source = Locale.Language(identifier: job.from)
    let target = Locale.Language(identifier: job.to)
    if var c = config, c.source == source, c.target == target {
      c.invalidate() // same pair: re-run the task
      config = c
    } else {
      config = TranslationSession.Configuration(source: source, target: target)
    }
  }

  func run(_ session: TranslationSession) async {
    guard let job = current else { return }
    do {
      let requests = job.texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
      let responses = try await session.translations(from: requests)
      var out = job.texts
      for r in responses {
        if let id = r.clientIdentifier, let i = Int(id), i < out.count { out[i] = r.targetText }
      }
      job.done(.success(out))
    } catch {
      job.done(.failure(error))
    }
    current = nil
    next()
  }
}

@available(iOS 18.0, *)
struct TranslateView: View {
  @ObservedObject var model: TranslateModel
  var body: some View {
    Color.clear
      .translationTask(model.config) { session in
        await model.run(session)
      }
  }
}

@available(iOS 18.0, *)
@MainActor
final class TranslateHost {
  static let shared = TranslateHost()
  let model = TranslateModel()
  private var host: UIHostingController<TranslateView>?

  /// Keeps an invisible 1×1 SwiftUI view in the key window so `.translationTask` can run
  /// (and present the language download sheet when needed).
  func attach() -> Bool {
    if let h = host, h.view.window != nil { return true }
    let window = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
    guard let root = window?.rootViewController else { return false }
    let h = host ?? UIHostingController(rootView: TranslateView(model: model))
    if h.parent != nil {
      h.willMove(toParent: nil)
      h.view.removeFromSuperview()
      h.removeFromParent()
    }
    h.view.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
    h.view.backgroundColor = .clear
    h.view.alpha = 0.011
    h.view.isUserInteractionEnabled = false
    h.view.accessibilityElementsHidden = true
    root.addChild(h)
    root.view.addSubview(h.view)
    h.didMove(toParent: root)
    host = h
    return true
  }
}
#endif
