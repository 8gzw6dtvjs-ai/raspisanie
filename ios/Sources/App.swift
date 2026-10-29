import SwiftUI
import WebKit

@main
struct RaspisanieApp: App {
    var body: some Scene {
        WindowGroup { ScheduleView().ignoresSafeArea() }
    }
}

struct ScheduleView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let initial = context.coordinator.readData()
        let json = String(data: initial, encoding: .utf8) ?? "null"
        configuration.userContentController.addUserScript(WKUserScript(
            source: "window.__NATIVE_DATA__ = \(json);",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.refresh), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        webView.scrollView.alwaysBounceVertical = true
        context.coordinator.webView = webView
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Resources") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return webView
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate {
        weak var webView: WKWebView?
        private var task: URLSessionDataTask?
        private var cacheURL: URL {
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("schedule.json")
        }
        private func valid(_ data: Data) -> Bool {
            guard let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            return value["weeks"] is [Any] && value["S"] is [Any] && value["updated"] is String
        }
        func readData() -> Data {
            if let cached = try? Data(contentsOf: cacheURL), valid(cached) { return cached }
            guard let url = Bundle.main.url(forResource: "data", withExtension: "json", subdirectory: "Resources"),
                  let data = try? Data(contentsOf: url), valid(data) else { return Data("null".utf8) }
            return data
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { refresh() }
        @objc func refresh() {
            guard task == nil else { return }
            var request = URLRequest(url: URL(string: "https://8gzw6dtvjs-ai.github.io/raspisanie/data.json?t=\(Int(Date().timeIntervalSince1970))")!)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 15
            task = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
                guard let self = self else { return }
                var script: String?
                if let data = data, (response as? HTTPURLResponse)?.statusCode == 200, self.valid(data),
                   let json = String(data: data, encoding: .utf8) {
                    try? FileManager.default.createDirectory(at: self.cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try? data.write(to: self.cacheURL, options: .atomic)
                    script = "window.dispatchEvent(new CustomEvent('native-schedule', {detail: \(json)}));"
                }
                DispatchQueue.main.async {
                    self.task = nil
                    self.webView?.scrollView.refreshControl?.endRefreshing()
                    if let script = script { self.webView?.evaluateJavaScript(script) }
                }
            }
            task?.resume()
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.isFileURL || url.absoluteString == "about:blank" { decisionHandler(.allow); return }
            if ["https", "http"].contains(url.scheme ?? ""), navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }
}
