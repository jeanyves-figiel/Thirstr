import UIKit
import UniformTypeIdentifiers

// I-01 R-I01.1 (#17): pick the first link from what was shared, open Thirstr with
// thirstr://share?url=… and close at once. Nothing is written anywhere; the app does the rest
// behind App lock (and the duress PIN), so this extension never shows chats or names.
final class ShareViewController: UIViewController {
  private var handled = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0x17 / 255, green: 0x14 / 255, blue: 0x2E / 255, alpha: 1)
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !handled else { return }
    handled = true
    Task { @MainActor in
      let shared = await firstLink()
      if let shared, let target = handOff(shared) { openApp(target) }
      extensionContext?.completeRequest(returningItems: nil)
    }
  }

  private func firstLink() async -> String? {
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    for item in items {
      for p in item.attachments ?? [] {
        if p.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           let u = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
           u.scheme == "https" || u.scheme == "http" {
          return u.absoluteString
        }
        if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
           let t = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
          return t
        }
      }
    }
    return nil
  }

  private func handOff(_ s: String) -> URL? {
    // Every character but letters and digits is percent-encoded, so the app reads one value.
    guard let enc = String(s.prefix(4000)).addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { return nil }
    return URL(string: "thirstr://share?url=" + enc)
  }

  // Extensions can't call UIApplication.open directly; walk the responder chain to the host
  // application and call it through the Objective-C runtime.
  private func openApp(_ url: URL) {
    let sel = NSSelectorFromString("openURL:options:completionHandler:")
    var r: UIResponder? = self
    while let cur = r {
      if cur.responds(to: sel), let imp = cur.method(for: sel), cur.isKind(of: UIApplication.self) {
        typealias Fn = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
        unsafeBitCast(imp, to: Fn.self)(cur, sel, url as NSURL, NSDictionary(), nil)
        return
      }
      r = cur.next
    }
  }
}
