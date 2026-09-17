import XCTest
import UIKit
@testable import App

final class ChatFixtureProtocol: URLProtocol {
    static var rows: [[String: Any]] = []
    static var requests: [URLRequest] = []
    static var rejectWrites = false
    static let user = "00000000-0000-0000-0000-000000000001"
    static let room = "00000000-0000-0000-0000-000000000002"
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "native-chat.test" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        DispatchQueue.main.async { self.respond() }
    }
    override func stopLoading() {}
    private func respond() {
        Self.requests.append(request)
        let path = request.url!.path
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
        func value(_ key: String) -> String { query.first { $0.name == key }?.value ?? "" }
        var output: Any = []
        var code = 200
        if path.hasSuffix("/rooms") { output = [["id": Self.room, "name": "Native fixture"]] }
        else if path.hasSuffix("/profiles") { output = [["id": Self.user, "name": "Tester", "role": "member"]] }
        else if path.hasSuffix("/messages") {
            if request.httpMethod == "POST" {
                if Self.rejectWrites { code = 403 }
                else {
                    var data = request.httpBody ?? Data()
                    if let stream = request.httpBodyStream {
                        stream.open(); defer { stream.close() }
                        var buffer = [UInt8](repeating: 0, count: 4096)
                        while stream.hasBytesAvailable {
                            let n = stream.read(&buffer, maxLength: buffer.count)
                            if n <= 0 { break }; data.append(buffer, count: n)
                        }
                    }
                    var row = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
                    row["created_at"] = "2026-09-17T10:00:00Z"
                    Self.rows.append(row); output = [row]
                }
            } else {
                var rows = Self.rows
                if value("id").hasPrefix("in.(") { rows = rows.filter { value("id").contains($0["id"] as! String) } }
                else if value("id").hasPrefix("eq.") { rows = rows.filter { "eq.\($0["id"]!)" == value("id") } }
                else if !value("or").isEmpty { rows = [] }
                if !value("order").contains("asc") { rows.reverse() }
                output = Array(rows.prefix(Int(value("limit")) ?? 100))
            }
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: output))
        client?.urlProtocolDidFinishLoading(self)
    }
}

@MainActor
final class NativeChatTests: XCTestCase {
    private var window: UIWindow!
    private var root: UIViewController!
    private var chat: NativeChatViewController!
    private var service: NativeChatService!
    private func find<T: UIView>(_ view: UIView, _ type: T.Type) -> T? {
        if let found = view as? T { return found }
        for child in view.subviews { if let found = find(child, type) { return found } }
        return nil
    }
    private func settle(_ seconds: Double = 0.15) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        root.view.layoutIfNeeded(); chat.view.layoutIfNeeded()
    }
    private func attach() {
        root.addChild(chat); chat.view.translatesAutoresizingMaskIntoConstraints = false
        root.view.addSubview(chat.view)
        NSLayoutConstraint.activate([
            chat.view.topAnchor.constraint(equalTo: root.view.topAnchor),
            chat.view.bottomAnchor.constraint(equalTo: root.view.bottomAnchor),
            chat.view.leadingAnchor.constraint(equalTo: root.view.leadingAnchor),
            chat.view.trailingAnchor.constraint(equalTo: root.view.trailingAnchor)
        ])
        chat.didMove(toParent: root); root.view.layoutIfNeeded(); chat.resume()
    }
    private func prepare() async {
        ChatFixtureProtocol.requests = []; ChatFixtureProtocol.rejectWrites = false
        ChatFixtureProtocol.rows = (0..<100).map { i in [
            "id": String(format: "00000000-0000-0000-0001-%012d", i),
            "user_id": ChatFixtureProtocol.user, "room_id": ChatFixtureProtocol.room,
            "body": "Message \(i)\nA wrapped message for viewport measurement.",
            "created_at": String(format: "2026-09-17T09:%02d:%02dZ", i / 60, i % 60)
        ] }
        let config = NativeChatConfig(["user": ChatFixtureProtocol.user, "url": "https://native-chat.test",
            "key": "test-anon", "token": "test-member-token"])!
        let network = URLSessionConfiguration.ephemeral; network.protocolClasses = [ChatFixtureProtocol.self]
        service = NativeChatService(config, session: URLSession(configuration: network), liveUpdates: false)
        chat = NativeChatViewController(service: service)
        root = UIViewController(); window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = root; window.makeKeyAndVisible(); attach()
        for _ in 0..<50 {
            await settle(0.1)
            if find(chat.view, ChatList.self)?.rowCount == 100 { break }
        }
        XCTAssertEqual(find(chat.view, ChatList.self)?.rowCount, 100)
    }
    private func finish() { chat.pause(); window.isHidden = true; window = nil; chat = nil; root = nil }

    func testHomeRoundTripsKeepFractionalReadingPositionAndDraft() async throws {
        await prepare(); defer { finish() }
        let list = try XCTUnwrap(find(chat.view, ChatList.self))
        let composer = try XCTUnwrap(find(chat.view, ComposerBar.self))
        XCTAssertTrue(list.scrollTo(id: "00000000-0000-0000-0001-000000000050", place: "at", off: 17.25, flash: false))
        composer.text = "Draft survives home"
        await settle()
        let expected = try XCTUnwrap(list.topSpot())
        for _ in 0..<20 {
            chat.pause(); chat.willMove(toParent: nil); chat.view.removeFromSuperview(); chat.removeFromParent()
            attach(); await settle()
            let actual = try XCTUnwrap(list.topSpot())
            XCTAssertEqual(actual.id, expected.id)
            XCTAssertEqual(actual.off, expected.off, accuracy: 1)
            XCTAssertEqual(composer.text, "Draft survives home")
        }
    }

    func testSendKeepsKeyboardAndUsesMemberAuthentication() async throws {
        await prepare(); defer { finish() }
        let composer = try XCTUnwrap(find(chat.view, ComposerBar.self))
        composer.textView.becomeFirstResponder(); composer.text = "Native send"
        await settle(0.5)
        XCTAssertTrue(composer.textView.isFirstResponder)
        chat.composerSend(text: composer.text)
        await settle(0.5)
        XCTAssertTrue(composer.textView.isFirstResponder)
        XCTAssertEqual(composer.text, "")
        XCTAssertEqual(ChatFixtureProtocol.rows.last?["body"] as? String, "Native send")
        let sent = try XCTUnwrap(ChatFixtureProtocol.requests.first { $0.httpMethod == "POST" && $0.url!.path.hasSuffix("/messages") })
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-member-token")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "apikey"), "test-anon")
        XCTAssertNotNil(UUID(uuidString: ChatFixtureProtocol.rows.last?["id"] as? String ?? ""))
    }

    func testRejectedSendPreservesDraftAndDoesNotAddMessage() async throws {
        await prepare(); defer { finish() }
        ChatFixtureProtocol.rejectWrites = true
        let composer = try XCTUnwrap(find(chat.view, ComposerBar.self))
        composer.text = "Keep failed draft"; chat.composerSend(text: composer.text)
        await settle(0.5)
        XCTAssertEqual(composer.text, "Keep failed draft")
        XCTAssertEqual(ChatFixtureProtocol.rows.count, 100)
        XCTAssertTrue(composer.sendBtn.isEnabled)
    }
}
