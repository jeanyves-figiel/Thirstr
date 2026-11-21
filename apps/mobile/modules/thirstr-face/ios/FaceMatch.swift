import AVFoundation
import CoreML
import UIKit
import Vision

// F-18 R-18.15 (#185): on-device face match for the video check.
// Frames of the clip vs the largest face in each of the peer's public photos. Everything stays in
// memory on this phone: no frame, crop, embedding or score is written to disk or sent anywhere
// (AC-03.1). The caller gets one similarity number per frame and decides what to show.
enum FaceMatch {
  /// ArcFace 5-point template for a 112×112 crop: eye (image left), eye (image right), nose tip,
  /// mouth corner (image left), mouth corner (image right). Same template as OpenCV FaceRecognizerSF.
  static let template: [CGPoint] = [
    CGPoint(x: 38.2946, y: 51.6963), CGPoint(x: 73.5318, y: 51.5014), CGPoint(x: 56.0252, y: 71.7366),
    CGPoint(x: 41.5493, y: 92.3655), CGPoint(x: 70.7299, y: 92.2041),
  ]
  static let side = 112
  /// Photos are scaled down to this before detection (speed, memory). Faces in profile photos are large.
  static let maxPixels: CGFloat = 1024
  /// Faces narrower than this share of the picture are ignored (too few pixels to compare).
  static let minFace: CGFloat = 0.08

  // MARK: model

  private static let lock = NSLock()
  private static var cached: MLModel?

  /// SFace (MobileFaceNet, Apache-2.0, 8-bit weights, ~10 MB) shipped in the app. Compiled once on
  /// first use and kept in Application Support (no network, excluded from backups).
  static func model() throws -> MLModel {
    lock.lock()
    defer { lock.unlock() }
    if let m = cached { return m }
    let cfg = MLModelConfiguration()
    cfg.computeUnits = .all
    let bundles = [Bundle.main, Bundle(for: Anchor.self)]
    if let c = bundles.lazy.compactMap({ $0.url(forResource: "ThirstrFaceNet", withExtension: "mlmodelc") }).first {
      let m = try MLModel(contentsOf: c, configuration: cfg)
      cached = m
      return m
    }
    guard let raw = bundles.lazy.compactMap({ $0.url(forResource: "ThirstrFaceNet", withExtension: "mlmodel") }).first else {
      throw NSError(domain: "ThirstrFace", code: 1, userInfo: [NSLocalizedDescriptionKey: "Face model missing"])
    }
    let fm = FileManager.default
    var dir = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    dir.appendPathComponent("ThirstrFaceNet-v1.mlmodelc", isDirectory: true)
    if !fm.fileExists(atPath: dir.path) {
      let tmp = try MLModel.compileModel(at: raw)
      try? fm.removeItem(at: dir)
      try fm.moveItem(at: tmp, to: dir)
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try? dir.setResourceValues(values)
    }
    let m = try MLModel(contentsOf: dir, configuration: cfg)
    cached = m
    return m
  }

  private final class Anchor {}

  // MARK: entry point

  /// Returns `{ photoFaces, frames }`: how many photos had a usable face, and per clip frame the best
  /// cosine similarity against those faces (−1 = no face in that frame).
  static func matchClip(clip: URL, photos: [URL], frameCount: Int) throws -> [String: Any] {
    let net = try model()
    let refs = references(photos, net).faces
    var frames: [Double] = []
    if !refs.isEmpty {
      for img in try clipFrames(clip, count: frameCount) {
        guard let v = (try? embed(img, net)) ?? nil else {
          frames.append(-1)
          continue
        }
        frames.append(Double(refs.map { dot($0, v) }.max() ?? -1))
      }
    }
    return ["photoFaces": refs.count, "frames": frames]
  }

  /// F-03 R-03.2 (#232): own selfie stills (local files, from the liveness check) vs own public photos.
  /// Returns `{ photoFaces, photoErrors, frames }`: `photoErrors` = photos that could not be loaded
  /// (network), so the caller can tell "no face in your photos" from "photos didn't load".
  static func matchStills(stills: [URL], photos: [URL]) throws -> [String: Any] {
    let net = try model()
    let (refs, errors) = references(photos, net)
    var frames: [Double] = []
    if !refs.isEmpty {
      for url in stills {
        guard let img = try? loadPhoto(url), let v = embedAnyOrientation(img, net) else {
          frames.append(-1)
          continue
        }
        frames.append(Double(refs.map { dot($0, v) }.max() ?? -1))
      }
    }
    return ["photoFaces": refs.count, "photoErrors": errors, "frames": frames]
  }

  /// Largest face of each photo (main first, at most 6). One bad photo never stops the match.
  static func references(_ photos: [URL], _ net: MLModel) -> (faces: [[Float]], errors: Int) {
    var refs: [[Float]] = []
    var errors = 0
    for url in photos.prefix(6) {
      guard let img = ((try? loadPhoto(url)) ?? nil) else {
        errors += 1
        continue
      }
      if let v = (try? embed(img, net)) ?? nil { refs.append(v) }
    }
    return (refs, errors)
  }

  /// #131: raw front-camera stills can carry no or a wrong EXIF orientation; Vision finds no face
  /// sideways. Try upright first, then the other quarter turns.
  static func embedAnyOrientation(_ img: CGImage, _ net: MLModel) -> [Float]? {
    for turns in [0, 1, 3, 2] {
      guard let r = turns == 0 ? img : rotate(img, quarterTurns: turns) else { continue }
      if let v = (try? embed(r, net)) ?? nil { return v }
    }
    return nil
  }

  /// Rotates by 90° steps clockwise (pixels only, no metadata).
  static func rotate(_ img: CGImage, quarterTurns: Int) -> CGImage? {
    let q = ((quarterTurns % 4) + 4) % 4
    let w = img.width, h = img.height
    let (ow, oh) = q % 2 == 1 ? (h, w) : (w, h)
    guard let ctx = CGContext(data: nil, width: ow, height: oh, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
    ctx.translateBy(x: CGFloat(ow) / 2, y: CGFloat(oh) / 2)
    ctx.rotate(by: -CGFloat(q) * .pi / 2)
    ctx.draw(img, in: CGRect(x: -CGFloat(w) / 2, y: -CGFloat(h) / 2, width: CGFloat(w), height: CGFloat(h)))
    return ctx.makeImage()
  }

  // MARK: inputs

  /// Downloads a public photo into memory only (ephemeral session: no URL cache, no cookies).
  static func loadPhoto(_ url: URL) throws -> CGImage? {
    let data: Data
    if url.isFileURL {
      data = try Data(contentsOf: url)
    } else {
      let sem = DispatchSemaphore(value: 0)
      var got: Data?
      let task = session.dataTask(with: url) { d, r, _ in
        if let h = r as? HTTPURLResponse, h.statusCode == 200 { got = d }
        sem.signal()
      }
      task.resume()
      if sem.wait(timeout: .now() + 15) == .timedOut {
        task.cancel()
        return nil
      }
      guard let d = got else { return nil }
      data = d
    }
    guard let ui = UIImage(data: data) else { return nil }
    return upright(ui)
  }

  static let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.urlCache = nil
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    c.timeoutIntervalForRequest = 15
    return URLSession(configuration: c)
  }()

  /// Draws the photo upright (EXIF orientation applied) and no larger than `maxPixels`.
  static func upright(_ ui: UIImage) -> CGImage? {
    let s = ui.size
    guard s.width > 0, s.height > 0 else { return nil }
    let k = min(1, maxPixels / max(s.width, s.height))
    let size = CGSize(width: (s.width * k).rounded(), height: (s.height * k).rounded())
    let fmt = UIGraphicsImageRendererFormat()
    fmt.scale = 1
    fmt.opaque = true
    return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in ui.draw(in: CGRect(origin: .zero, size: size)) }.cgImage
  }

  /// Evenly spaced frames (20 %, 50 %, 80 % for 3), upright, from the local decrypted clip.
  static func clipFrames(_ url: URL, count: Int) throws -> [CGImage] {
    let asset = AVURLAsset(url: url)
    let gen = AVAssetImageGenerator(asset: asset)
    gen.appliesPreferredTrackTransform = true
    gen.maximumSize = CGSize(width: maxPixels, height: maxPixels)
    gen.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 10)
    gen.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 10)
    let secs = CMTimeGetSeconds(asset.duration)
    guard secs.isFinite, secs > 0 else { return [] }
    let n = max(1, count)
    var out: [CGImage] = []
    for i in 0..<n {
      let f = n == 1 ? 0.5 : 0.2 + 0.6 * Double(i) / Double(n - 1)
      if let img = try? gen.copyCGImage(at: CMTime(seconds: secs * f, preferredTimescale: 600), actualTime: nil) {
        out.append(img)
      }
    }
    return out
  }

  // MARK: face → embedding

  /// Largest face → 5 landmarks → aligned 112×112 crop → L2-normalised 128-d embedding. Nil = no usable face.
  static func embed(_ img: CGImage, _ net: MLModel) throws -> [Float]? {
    guard let pts = try landmarks(img) else { return nil }
    guard let buf = align(img, pts) else { return nil }
    let input = try MLDictionaryFeatureProvider(dictionary: ["face": MLFeatureValue(pixelBuffer: buf)])
    let out = try net.prediction(from: input)
    guard let arr = out.featureValue(for: "embedding")?.multiArrayValue else { return nil }
    var v = [Float](repeating: 0, count: arr.count)
    for i in 0..<arr.count { v[i] = arr[i].floatValue }
    let n = sqrt(v.reduce(0) { $0 + $1 * $1 })
    guard n > 0 else { return nil }
    return v.map { $0 / n }
  }

  static func dot(_ a: [Float], _ b: [Float]) -> Float {
    var s: Float = 0
    for i in 0..<min(a.count, b.count) { s += a[i] * b[i] }
    return s
  }

  /// Five points in image pixels (origin top left), in template order.
  static func landmarks(_ img: CGImage) throws -> [CGPoint]? {
    let handler = VNImageRequestHandler(cgImage: img, orientation: .up, options: [:])
    let rects = VNDetectFaceRectanglesRequest()
    rects.revision = VNDetectFaceRectanglesRequestRevision3
    try handler.perform([rects])
    guard let face = (rects.results ?? []).max(by: { $0.boundingBox.width < $1.boundingBox.width }),
          face.boundingBox.width >= minFace else { return nil }
    let marks = VNDetectFaceLandmarksRequest()
    marks.inputFaceObservations = [face]
    try handler.perform([marks])
    guard let lm = marks.results?.first?.landmarks else { return nil }
    let size = CGSize(width: img.width, height: img.height)
    // Vision points: normalised to the image, origin bottom left → pixels, origin top left.
    func px(_ r: VNFaceLandmarkRegion2D?) -> [CGPoint] {
      guard let r = r, r.pointCount > 0 else { return [] }
      return r.pointsInImage(imageSize: size).map { CGPoint(x: $0.x, y: size.height - $0.y) }
    }
    func mean(_ p: [CGPoint]) -> CGPoint? {
      guard !p.isEmpty else { return nil }
      return CGPoint(x: p.map(\.x).reduce(0, +) / CGFloat(p.count), y: p.map(\.y).reduce(0, +) / CGFloat(p.count))
    }
    guard let e1 = mean(px(lm.leftPupil)) ?? mean(px(lm.leftEye)),
          let e2 = mean(px(lm.rightPupil)) ?? mean(px(lm.rightEye)) else { return nil }
    let lips = px(lm.outerLips)
    let nosePts = px(lm.noseCrest) + px(lm.nose)
    guard lips.count >= 2, !nosePts.isEmpty else { return nil }
    let (eL, eR) = e1.x <= e2.x ? (e1, e2) : (e2, e1)
    // Face axes from the eyes, so a tilted head still finds the right points.
    let ax = CGPoint(x: eR.x - eL.x, y: eR.y - eL.y)
    let len = hypot(ax.x, ax.y)
    guard len > 1 else { return nil }
    let u = CGPoint(x: ax.x / len, y: ax.y / len)
    let down = CGPoint(x: -u.y, y: u.x)
    let mid = CGPoint(x: (eL.x + eR.x) / 2, y: (eL.y + eR.y) / 2)
    let along = { (p: CGPoint) in (p.x - mid.x) * u.x + (p.y - mid.y) * u.y }
    let below = { (p: CGPoint) in (p.x - mid.x) * down.x + (p.y - mid.y) * down.y }
    // Nose tip: the nose point furthest below the eye line. Mouth corners: the lip extremes along it.
    guard let nose = nosePts.max(by: { below($0) < below($1) }),
          let mL = lips.min(by: { along($0) < along($1) }),
          let mR = lips.max(by: { along($0) < along($1) }) else { return nil }
    return [eL, eR, nose, mL, mR]
  }

  /// Least-squares similarity transform (rotation, uniform scale, shift) from `src` to `dst` (Umeyama).
  static func similarity(_ src: [CGPoint], _ dst: [CGPoint]) -> (a: Double, b: Double, tx: Double, ty: Double)? {
    let n = Double(src.count)
    let ms = (src.map { Double($0.x) }.reduce(0, +) / n, src.map { Double($0.y) }.reduce(0, +) / n)
    let md = (dst.map { Double($0.x) }.reduce(0, +) / n, dst.map { Double($0.y) }.reduce(0, +) / n)
    var a = 0.0, b = 0.0, norm = 0.0
    for (p, q) in zip(src, dst) {
      let sx = Double(p.x) - ms.0, sy = Double(p.y) - ms.1
      let dx = Double(q.x) - md.0, dy = Double(q.y) - md.1
      a += sx * dx + sy * dy
      b += sx * dy - sy * dx
      norm += sx * sx + sy * sy
    }
    guard norm > 0 else { return nil }
    let c = a / norm, s = b / norm
    return (c, s, md.0 - (c * ms.0 - s * ms.1), md.1 - (s * ms.0 + c * ms.1))
  }

  /// Warps the face onto the 112×112 template (bilinear, like cv2.warpAffine) into a BGRA pixel buffer.
  static func align(_ img: CGImage, _ pts: [CGPoint]) -> CVPixelBuffer? {
    guard let t = similarity(pts, template) else { return nil }
    let w = img.width, h = img.height
    var src = [UInt8](repeating: 0, count: w * h * 4)
    let cs = CGColorSpaceCreateDeviceRGB()
    let ok = src.withUnsafeMutableBytes { raw -> Bool in
      guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
      ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    guard ok else { return nil }
    var pb: CVPixelBuffer?
    let attrs = [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true] as CFDictionary
    guard CVPixelBufferCreate(kCFAllocatorDefault, side, side, kCVPixelFormatType_32BGRA, attrs, &pb) == kCVReturnSuccess, let buf = pb else { return nil }
    CVPixelBufferLockBaseAddress(buf, [])
    defer { CVPixelBufferUnlockBaseAddress(buf, []) }
    guard let base = CVPixelBufferGetBaseAddress(buf) else { return nil }
    let row = CVPixelBufferGetBytesPerRow(buf)
    let out = base.assumingMemoryBound(to: UInt8.self)
    // Inverse map: destination pixel → source pixel.
    let det = t.a * t.a + t.b * t.b
    for y in 0..<side {
      for x in 0..<side {
        let dx = Double(x) - t.tx, dy = Double(y) - t.ty
        let sx = (t.a * dx + t.b * dy) / det
        let sy = (-t.b * dx + t.a * dy) / det
        var rgb: (Double, Double, Double) = (0, 0, 0)
        let x0 = Int(floor(sx)), y0 = Int(floor(sy))
        let fx = sx - Double(x0), fy = sy - Double(y0)
        for (ox, oy, wgt) in [(0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)] {
          let px = x0 + ox, py = y0 + oy
          guard px >= 0, py >= 0, px < w, py < h, wgt > 0 else { continue }
          let i = (py * w + px) * 4
          rgb.0 += Double(src[i]) * wgt
          rgb.1 += Double(src[i + 1]) * wgt
          rgb.2 += Double(src[i + 2]) * wgt
        }
        let o = y * row + x * 4
        out[o] = UInt8(max(0, min(255, rgb.2.rounded())))
        out[o + 1] = UInt8(max(0, min(255, rgb.1.rounded())))
        out[o + 2] = UInt8(max(0, min(255, rgb.0.rounded())))
        out[o + 3] = 255
      }
    }
    // Wipe the decoded copy of the picture.
    src.withUnsafeMutableBytes { $0.initializeMemory(as: UInt8.self, repeating: 0) }
    return buf
  }
}
