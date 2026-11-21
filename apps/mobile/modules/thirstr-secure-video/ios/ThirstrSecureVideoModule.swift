import AVFoundation
import ExpoModulesCore
import UIKit

// F-18 R-18.11 / R-18.13 (#159): video check playback and clip preparation, on device only.
public class ThirstrSecureVideoModule: Module {
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("ThirstrSecureVideo")

    Events("onScreenshot", "onCapture")

    OnStartObserving {
      let nc = NotificationCenter.default
      self.observers.append(nc.addObserver(forName: UIApplication.userDidTakeScreenshotNotification, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onScreenshot", [:])
      })
      self.observers.append(nc.addObserver(forName: UIScreen.capturedDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onCapture", ["captured": UIScreen.main.isCaptured])
      })
    }

    OnStopObserving {
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      self.observers.removeAll()
    }

    AsyncFunction("isCaptured") { () -> Bool in
      UIScreen.main.isCaptured
    }.runOnQueue(.main)

    // R-18.11: re-wrap the clip without any metadata (no location, device model or dates).
    // Passthrough: no re-encode, so it costs almost no battery. The source file is deleted.
    AsyncFunction("stripMetadata") { (uri: String, promise: Promise) in
      guard let src = URL(string: uri) else {
        promise.reject("E_URI", "Bad file")
        return
      }
      let asset = AVURLAsset(url: src)
      guard let ex = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
        promise.reject("E_EXPORT", "Export unavailable")
        return
      }
      let out = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
      ex.outputURL = out
      ex.outputFileType = .mp4
      ex.metadata = []
      ex.metadataItemFilter = AVMetadataItemFilter.forSharing()
      ex.shouldOptimizeForNetworkUse = true
      ex.exportAsynchronously {
        try? FileManager.default.removeItem(at: src)
        if ex.status == .completed {
          promise.resolve(out.absoluteString)
        } else {
          try? FileManager.default.removeItem(at: out)
          promise.reject("E_EXPORT", ex.error?.localizedDescription ?? "Export failed")
        }
      }
    }

    View(SecureVideoView.self) {
      Events("onProgress", "onEnd", "onReady", "onError")

      Prop("uri") { (view: SecureVideoView, uri: String?) in
        view.setUri(uri)
      }

      Prop("playing") { (view: SecureVideoView, playing: Bool) in
        view.setPlaying(playing)
      }

      Prop("loop") { (view: SecureVideoView, loop: Bool) in
        view.loop = loop
      }
    }
  }
}

/// Plays a local clip inside the layer iOS keeps out of screenshots and recordings (secure text
/// field canvas). If that layer can't be found on an iOS version, the video is drawn normally and
/// the app still reports screenshots and blacks out during capture (R-18.13).
class SecureVideoView: ExpoView {
  let onProgress = EventDispatcher()
  let onEnd = EventDispatcher()
  let onReady = EventDispatcher()
  let onError = EventDispatcher()

  var loop = false
  private let field = UITextField()
  private let host = UIView()
  private let playerLayer = AVPlayerLayer()
  private var player: AVPlayer?
  private var timeObs: Any?
  private var endObs: NSObjectProtocol?
  private var capObs: NSObjectProtocol?
  private var statusObs: NSKeyValueObservation?
  private var wantPlay = false
  private var ended = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
    field.isSecureTextEntry = true
    field.isUserInteractionEnabled = false
    field.backgroundColor = .clear
    addSubview(field)
    let canvas = field.subviews.first { String(describing: type(of: $0)).contains("CanvasView") } ?? field.subviews.first
    if let canvas = canvas {
      canvas.isUserInteractionEnabled = false
      canvas.addSubview(host)
    } else {
      addSubview(host)
    }
    playerLayer.videoGravity = .resizeAspectFill
    host.layer.addSublayer(playerLayer)
    capObs = NotificationCenter.default.addObserver(forName: UIScreen.capturedDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
      self?.applyCapture()
    }
  }

  deinit {
    teardown()
    if let capObs = capObs { NotificationCenter.default.removeObserver(capObs) }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    field.frame = bounds
    host.frame = bounds
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    playerLayer.frame = host.bounds
    CATransaction.commit()
  }

  func setUri(_ uri: String?) {
    teardown()
    guard let uri = uri, let url = URL(string: uri) else { return }
    let item = AVPlayerItem(url: url)
    let p = AVPlayer(playerItem: item)
    p.isMuted = true
    p.preventsDisplaySleepDuringVideoPlayback = true
    player = p
    playerLayer.player = p
    ended = false
    statusObs = item.observe(\.status, options: [.new]) { [weak self] it, _ in
      DispatchQueue.main.async {
        guard let self = self else { return }
        if it.status == .readyToPlay {
          self.onReady(["duration": CMTimeGetSeconds(it.duration)])
          self.applyPlay()
        } else if it.status == .failed {
          self.onError(["message": it.error?.localizedDescription ?? "failed"])
        }
      }
    }
    timeObs = p.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 10), queue: .main) { [weak self] t in
      guard let self = self, let d = self.player?.currentItem?.duration else { return }
      self.onProgress(["t": CMTimeGetSeconds(t), "d": CMTimeGetSeconds(d)])
    }
    endObs = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
      guard let self = self else { return }
      if self.loop {
        self.player?.seek(to: .zero)
        self.applyPlay()
      } else {
        self.ended = true
        self.onEnd([:])
      }
    }
  }

  func setPlaying(_ playing: Bool) {
    wantPlay = playing
    applyPlay()
  }

  private func applyCapture() {
    host.isHidden = UIScreen.main.isCaptured
    applyPlay()
  }

  private func applyPlay() {
    guard let p = player else { return }
    let captured = UIScreen.main.isCaptured
    host.isHidden = captured
    if wantPlay && !captured && !ended {
      p.play()
    } else {
      p.pause()
    }
  }

  private func teardown() {
    if let timeObs = timeObs { player?.removeTimeObserver(timeObs) }
    if let endObs = endObs { NotificationCenter.default.removeObserver(endObs) }
    timeObs = nil
    endObs = nil
    statusObs?.invalidate()
    statusObs = nil
    player?.pause()
    player?.replaceCurrentItem(with: nil)
    playerLayer.player = nil
    player = nil
  }
}
