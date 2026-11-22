import ExpoModulesCore
import UIKit
import Vision

// F-03 R-03.1 / R-03.5: face measurements for one still, computed on device with Apple Vision.
// Returns numbers only; the image is read from a local file and nothing is kept.
public class ThirstrFaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ThirstrFace")

    AsyncFunction("analyze") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri),
            let data = try? Data(contentsOf: url),
            let image = UIImage(data: data),
            let cg = image.cgImage else {
        promise.reject("E_IMAGE", "Could not read the image")
        return
      }
      let declared = ThirstrFaceModule.orientation(image.imageOrientation)
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          // #131: try the photo's own orientation first, then the others (raw front-camera
          // stills can carry no or a wrong EXIF orientation; Vision finds no face sideways).
          var tries: [CGImagePropertyOrientation] = [declared]
          for o in [CGImagePropertyOrientation.leftMirrored, .right, .left, .up, .rightMirrored, .down] where o != declared {
            tries.append(o)
          }
          for o in tries {
            if let out = try ThirstrFaceModule.measure(cg, o) {
              promise.resolve(out)
              return
            }
          }
          promise.resolve(["faces": 0])
        } catch {
          promise.reject("E_VISION", error.localizedDescription)
        }
      }
    }

    // F-21 R-21.2 (#221): every face box in an upright still (Moment composer "Blur faces").
    // Normalized 0…1, origin top-left, largest first. Numbers only; the photo stays on the phone.
    AsyncFunction("faceBoxes") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri), url.isFileURL,
            let data = try? Data(contentsOf: url),
            let image = UIImage(data: data),
            let cg = image.cgImage else {
        promise.reject("E_IMAGE", "Could not read the image")
        return
      }
      let o = ThirstrFaceModule.orientation(image.imageOrientation)
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let handler = VNImageRequestHandler(cgImage: cg, orientation: o, options: [:])
          let rects = VNDetectFaceRectanglesRequest()
          rects.revision = VNDetectFaceRectanglesRequestRevision3
          try handler.perform([rects])
          let boxes = (rects.results ?? [])
            .map { $0.boundingBox }
            .sorted { $0.width * $0.height > $1.width * $1.height }
            .prefix(20)
            .map { b in [Double(b.minX), Double(1 - b.maxY), Double(b.width), Double(b.height)] }
          promise.resolve(Array(boxes))
        } catch {
          promise.reject("E_VISION", error.localizedDescription)
        }
      }
    }

    // F-03 R-03.2 (#232): own selfie stills vs own public photos, on this phone only.
    AsyncFunction("matchStills") { (stillUris: [String], photoUrls: [String], promise: Promise) in
      let stills = stillUris.compactMap { URL(string: $0) }.filter { $0.isFileURL }
      guard !stills.isEmpty else {
        promise.reject("E_STILL", "Stills must be local files")
        return
      }
      let photos = photoUrls.compactMap { URL(string: $0) }.filter { $0.scheme == "https" }
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          promise.resolve(try FaceMatch.matchStills(stills: stills, photos: photos))
        } catch {
          promise.reject("E_MATCH", error.localizedDescription)
        }
      }
    }

    // F-18 R-18.15 (#185): clip frames vs the peer's public photos, on this phone only.
    AsyncFunction("matchClip") { (clipUri: String, photoUrls: [String], promise: Promise) in
      guard let clip = URL(string: clipUri), clip.isFileURL else {
        promise.reject("E_CLIP", "Clip must be a local file")
        return
      }
      let photos = photoUrls.compactMap { URL(string: $0) }.filter { $0.isFileURL || $0.scheme == "https" }
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          promise.resolve(try FaceMatch.matchClip(clip: clip, photos: photos, frameCount: 3))
        } catch {
          promise.reject("E_MATCH", error.localizedDescription)
        }
      }
    }
  }

  /// Face rectangles revision 3 (iOS 15+) gives continuous yaw and pitch; the landmarks request
  /// alone runs the older detector (yaw in 45° steps, no pitch), which made turn / look up fail (#131).
  static func measure(_ cg: CGImage, _ o: CGImagePropertyOrientation) throws -> [String: Any]? {
    let handler = VNImageRequestHandler(cgImage: cg, orientation: o, options: [:])
    let rects = VNDetectFaceRectanglesRequest()
    rects.revision = VNDetectFaceRectanglesRequestRevision3
    try handler.perform([rects])
    let faces = rects.results ?? []
    guard !faces.isEmpty else { return nil }
    // Largest face is the user (closest to the phone).
    let face = faces.max { $0.boundingBox.width < $1.boundingBox.width }!
    let marks = VNDetectFaceLandmarksRequest()
    marks.inputFaceObservations = [face]
    try handler.perform([marks])
    var out: [String: Any] = [
      "faces": faces.filter { $0.boundingBox.width >= face.boundingBox.width * 0.5 }.count,
      "yaw": face.yaw?.doubleValue ?? 0,
      "roll": face.roll?.doubleValue ?? 0,
      "size": Double(face.boundingBox.width),
    ]
    if let p = face.pitch { out["pitch"] = p.doubleValue }
    if let lm = marks.results?.first?.landmarks {
      out["leftEye"] = openness(lm.leftEye)
      out["rightEye"] = openness(lm.rightEye)
      out["mouth"] = width(lm.outerLips)
      // Pose fallback from landmarks: nose tip relative to the eye/lip frame.
      if let nose = centroid(lm.nose), let l = centroid(lm.leftEye), let r = centroid(lm.rightEye), let lip = centroid(lm.outerLips) {
        let eyeW = abs(r.x - l.x)
        let midX = (l.x + r.x) / 2
        let eyeY = (l.y + r.y) / 2
        let faceH = abs(eyeY - lip.y)
        if eyeW > 0, faceH > 0 {
          out["noseX"] = (nose.x - midX) / eyeW
          out["noseY"] = (nose.y - lip.y) / faceH
        }
      }
    }
    return out
  }

  static func centroid(_ r: VNFaceLandmarkRegion2D?) -> (x: Double, y: Double)? {
    guard let r = r, r.pointCount > 0 else { return nil }
    let pts = r.normalizedPoints
    let n = Double(pts.count)
    return (pts.reduce(0) { $0 + Double($1.x) } / n, pts.reduce(0) { $0 + Double($1.y) } / n)
  }

  // Landmark points are normalised to the face bounding box.
  static func extent(_ r: VNFaceLandmarkRegion2D?) -> (Double, Double) {
    guard let r = r, r.pointCount > 0 else { return (0, 0) }
    let pts = r.normalizedPoints
    let xs = pts.map { Double($0.x) }
    let ys = pts.map { Double($0.y) }
    return ((xs.max() ?? 0) - (xs.min() ?? 0), (ys.max() ?? 0) - (ys.min() ?? 0))
  }

  static func openness(_ r: VNFaceLandmarkRegion2D?) -> Double {
    let (w, h) = extent(r)
    return w > 0 ? h / w : 0
  }

  static func width(_ r: VNFaceLandmarkRegion2D?) -> Double {
    return extent(r).0
  }

  static func orientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch o {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    case .upMirrored: return .upMirrored
    case .downMirrored: return .downMirrored
    case .leftMirrored: return .leftMirrored
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
