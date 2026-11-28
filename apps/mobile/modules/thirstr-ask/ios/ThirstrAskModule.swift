import AVFoundation
import ExpoModulesCore
import Speech
#if canImport(FoundationModels)
import FoundationModels
#endif

// F-24 R-24.1, R-24.3 (#346): Ask engine 1 (Apple Foundation Models, iOS 26+, on-device) and
// on-device dictation. The search text and the audio never leave the phone: the model is the
// system's on-device model, and speech uses requiresOnDeviceRecognition (no Apple server).
public class ThirstrAskModule: Module {
  private let audio = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?

  public func definition() -> ModuleDefinition {
    Name("ThirstrAsk")
    Events("onSpeech", "onSpeechEnd")

    AsyncFunction("engine") { () -> String? in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        if SystemLanguageModel.default.isAvailable { return "apple" }
      }
      #endif
      return nil
    }

    AsyncFunction("parse") { (text: String, instructions: String, promise: Promise) in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        Task {
          do {
            let session = LanguageModelSession(instructions: instructions)
            let r = try await session.respond(to: text, generating: AskOut.self, options: GenerationOptions(temperature: 0))
            let data = try JSONSerialization.data(withJSONObject: r.content.dict())
            promise.resolve(String(data: data, encoding: .utf8) ?? "{}")
          } catch {
            promise.reject("E_ASK", error.localizedDescription)
          }
        }
        return
      }
      #endif
      promise.reject("E_UNSUPPORTED", "On-device model needs iOS 26")
    }

    Function("speechSupported") { (lang: String) -> Bool in
      guard let r = SFSpeechRecognizer(locale: Locale(identifier: lang)) else { return false }
      return r.supportsOnDeviceRecognition
    }

    AsyncFunction("listen") { (lang: String, promise: Promise) in
      SFSpeechRecognizer.requestAuthorization { status in
        guard status == .authorized else { return promise.resolve(false) }
        AVAudioSession.sharedInstance().requestRecordPermission { ok in
          guard ok else { return promise.resolve(false) }
          DispatchQueue.main.async {
            do {
              try self.start(lang)
              promise.resolve(true)
            } catch {
              self.finish(error.localizedDescription)
              promise.resolve(false)
            }
          }
        }
      }
    }

    Function("stop") {
      DispatchQueue.main.async { self.request?.endAudio() }
    }

    OnDestroy {
      self.finish(nil)
    }
  }

  private func start(_ lang: String) throws {
    finish(nil)
    guard let rec = SFSpeechRecognizer(locale: Locale(identifier: lang)), rec.supportsOnDeviceRecognition else {
      throw NSError(domain: "ThirstrAsk", code: 1, userInfo: [NSLocalizedDescriptionKey: "unsupported"])
    }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: .duckOthers)
    try session.setActive(true, options: .notifyOthersOnDeactivation)
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.requiresOnDeviceRecognition = true
    req.shouldReportPartialResults = true
    request = req
    let input = audio.inputNode
    input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in
      req.append(buf)
    }
    audio.prepare()
    try audio.start()
    task = rec.recognitionTask(with: req) { [weak self] result, error in
      guard let self else { return }
      if let result {
        self.sendEvent("onSpeech", ["text": result.bestTranscription.formattedString, "final": result.isFinal])
        if result.isFinal { self.finish(nil) }
      }
      if let error { self.finish(error.localizedDescription) }
    }
    // Hard cap: 15 s of listening (energy, R-24.1).
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
      if self?.request === req { req.endAudio() }
    }
  }

  private func finish(_ error: String?) {
    let wasOn = request != nil
    if audio.isRunning {
      audio.stop()
      audio.inputNode.removeTap(onBus: 0)
    }
    task?.cancel()
    task = nil
    request = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    if wasOn { sendEvent("onSpeechEnd", error.map { ["error": $0] } ?? [:]) }
  }
}

#if canImport(FoundationModels)
// Guided generation: the model can only fill these fields. Values outside the lists are dropped
// again in JS (sanitize, AC-24.2); forbidden topics have no field at all.
@available(iOS 26.0, *)
@Generable
struct AskOut {
  @Guide(description: "Youngest age wanted, 18 to 99, only if said")
  var ageMin: Int?
  @Guide(description: "Oldest age wanted, 18 to 99, only if said")
  var ageMax: Int?
  @Guide(description: "Maximum distance in kilometres, only if said")
  var distanceKm: Double?
  @Guide(description: "true only if they want people online now")
  var onlineNow: Bool?
  @Guide(description: "true only if they want verified people")
  var verifiedOnly: Bool?
  @Guide(description: "true only if they want new members")
  var newMembers: Bool?
  @Guide(description: "Values from the position list")
  var position: [String]
  @Guide(description: "Values from the hosting list")
  var hosting: [String]
  @Guide(description: "Values from the tribes list")
  var tribes: [String]
  @Guide(description: "Values from the build list")
  var build: [String]
  @Guide(description: "Values from the looking_for list")
  var lookingFor: [String]
  @Guide(description: "Values from the sports list")
  var sports: [String]
  @Guide(description: "Values from the schedule list")
  var schedule: [String]
  @Guide(description: "Values from the interests list")
  var interests: [String]
  @Guide(description: "Any of hookup, friends, sport")
  var intents: [String]

  func dict() -> [String: Any] {
    var f: [String: Any] = [:]
    if let ageMin { f["age_min"] = ageMin }
    if let ageMax { f["age_max"] = ageMax }
    if let distanceKm { f["distance_max"] = Int(distanceKm * 1000) }
    if onlineNow == true { f["online_now"] = true }
    if verifiedOnly == true { f["verified_only"] = true }
    if newMembers == true { f["new_members"] = true }
    let lists: [(String, [String])] = [("position", position), ("hosting", hosting), ("tribes", tribes), ("build", build), ("looking_for", lookingFor), ("sports", sports), ("schedule", schedule), ("interests", interests)]
    for (k, v) in lists where !v.isEmpty { f[k] = v }
    return ["filters": f, "intents": intents]
  }
}
#endif
