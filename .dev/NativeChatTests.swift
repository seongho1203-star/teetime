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
        chat.prepareForEntry(in: root.view.bounds)
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
    private func prepare(navigation: Bool = false) async {
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
        if navigation {
            let nav = UINavigationController(rootViewController: root)
            nav.isNavigationBarHidden = true
            window.rootViewController = nav; window.makeKeyAndVisible()
            NativeChatPlugin.presentChat(chat, from: root, animated: false)
        } else {
            window.rootViewController = root; window.makeKeyAndVisible(); attach()
        }
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
        let list = try XCTUnwrap(find(chat.view, ChatList.self))
        let listFrame = list.convert(list.bounds, to: window)
        let inputFrame = composer.convert(composer.bounds, to: window)
        XCTAssertEqual(listFrame.maxY, inputFrame.minY, accuracy: 1)
        XCTAssertGreaterThan(listFrame.height, 100)
        chat.composerSend(text: composer.text)
        await settle(0.5)
        XCTAssertTrue(composer.textView.isFirstResponder)
        XCTAssertEqual(composer.text, "")
        XCTAssertEqual(ChatFixtureProtocol.rows.last?["body"] as? String, "Native send")
        let sent = try XCTUnwrap(ChatFixtureProtocol.requests.first { $0.httpMethod == "POST" && $0.url!.path.hasSuffix("/messages") })
        XCTAssertEqual(sent.value(forHTTPHeaderField: "Authorization"), "Bearer test-member-token")
        XCTAssertEqual(sent.value(forHTTPHeaderField: "apikey"), "test-anon")
        XCTAssertNotNil(UUID(uuidString: ChatFixtureProtocol.rows.last?["id"] as? String ?? ""))
        composer.textView.resignFirstResponder(); await settle(0.5)
        XCTAssertTrue(list.atBottom())
        XCTAssertEqual(list.convert(list.bounds, to: window).maxY, composer.convert(composer.bounds, to: window).minY, accuracy: 1)
    }

    /// 서랍 차례 — **운영진 → 총무 → 일반회원**, 묶음 안에서는 연장자가 앞이고
    /// 태어난 해를 모르는 사람은 늘 뒤다. 클래스 이름만 봐서는 뒤집혀도
    /// 안 보이는 자리라 **차례 자체를** 붙들어 둔다(웹의 `behave`와 같은 잣대).
    func testDrawerOrdersStaffFirstThenTreasurerThenByAge() {
        let people: [ChatJSON] = [
            ["name": "다일반", "role": "member", "birth_year": 1970],
            ["name": "가모름", "role": "member"],
            ["name": "나총무", "role": "treasurer", "birth_year": 1990],
            ["name": "라운영", "role": "admin", "birth_year": 1985],
            ["name": "마부운영", "role": "staff", "birth_year": 1975],
        ]
        let sorted = people.sorted(by: ChatRole.order).map { $0["name"] as? String ?? "" }
        XCTAssertEqual(sorted, ["마부운영", "라운영", "나총무", "다일반", "가모름"])
        XCTAssertTrue(ChatRole.isAdmin("staff"))
        XCTAssertFalse(ChatRole.isAdmin("treasurer"))
        XCTAssertEqual(ChatRole.label("superadmin"), "앱관리자")
    }

    /// 머리말에 **`전체 대화`를 안 적는다**(사용자 요청 — `채팅 좌측상단
    /// 전체대화 삭제해줘`). 클래스 이름만 봐서는 되살아나도 안 보이는
    /// 자리라 **글자 자체를** 훑는다.
    func testHeaderHasNoRoomTitle() async throws {
        await prepare(); defer { finish() }
        var titles: [String] = []
        func walk(_ v: UIView) {
            if let b = v as? UIButton {
                titles.append(b.currentTitle ?? b.currentAttributedTitle?.string ?? "")
            }
            if let l = v as? UILabel { titles.append(l.text ?? "") }
            v.subviews.forEach(walk)
        }
        walk(chat.view)
        XCTAssertFalse(titles.contains { $0.contains("전체 대화") })
    }

    /// 이모티콘은 **입력칸 아래·화면 끝까지** 선다(카톡과 같다).
    /// 전체화면 창으로 되돌아가면 여기서 빨갛게 뜬다.
    func testStickerTrayOpensBelowComposer() async throws {
        await prepare(); defer { finish() }
        let composer = try XCTUnwrap(find(chat.view, ComposerBar.self))
        let tray = try XCTUnwrap(find(chat.view, StickerTray.self))
        XCTAssertTrue(tray.isHidden)
        chat.composerTapped("sticker")
        await settle(0.3)
        XCTAssertFalse(tray.isHidden)
        XCTAssertGreaterThan(tray.bounds.height, 180)
        /* **자리를 잰다** — 바는 스택 안에 있어 좌표계가 달라서,
           옮겨 놓고 견주지 않으면 늘 어긋난다. */
        let bar = composer.convert(composer.bounds, to: chat.view)
        let box = tray.convert(tray.bounds, to: chat.view)
        XCTAssertEqual(box.minY, bar.maxY, accuracy: 1)
        XCTAssertEqual(box.maxY, chat.view.bounds.maxY, accuracy: 1)
        XCTAssertNil(chat.presentedViewController)   // 전체화면 창이 아니다
        chat.composerTapped("sticker")
        await settle(0.3)
        XCTAssertTrue(tray.isHidden)
    }

    /// Exercise the production navigation host, not the old addChild-only fixture.
    /// Check the presentation layer throughout entry, not just the final frame.
    func testKeyboardButtonBackThenReentryStaysHorizontal() async throws {
        await prepare(navigation: true); defer { finish() }
        let nav = try XCTUnwrap(root.navigationController)
        let composer = try XCTUnwrap(find(chat.view, ComposerBar.self))
        func backButton(_ v: UIView) -> UIButton? {
            if v.accessibilityIdentifier == "native-chat-back" { return v as? UIButton }
            return v.subviews.lazy.compactMap { backButton($0) }.first
        }
        let button = try XCTUnwrap(backButton(chat.view))
        for cycle in 0..<6 {
            composer.text = "Preserved draft \(cycle)"
            composer.textView.becomeFirstResponder()
            await settle(0.9)
            XCTAssertTrue(composer.textView.isFirstResponder)
            var closed = false
            chat.event = { [weak self] type, _ in
                guard type == "back", let self = self else { return }
                self.chat.whenExitFinishes {
                    self.chat.pause(); closed = true
                }
            }
            button.sendActions(for: .touchUpInside)
            XCTAssertFalse(closed, "Closing must wait for the animated UIKit pop")
            for _ in 0..<100 {
                if closed { break }
                await settle(0.02)
            }
            XCTAssertTrue(closed)
            XCTAssertTrue(nav.topViewController === root)
            XCTAssertNil(chat.parent)
            XCTAssertFalse(composer.textView.isFirstResponder)
            // Reenter immediately when close resolves: no arbitrary extra wait.
            NativeChatPlugin.presentChat(chat, from: root, animated: true)
            for _ in 0..<45 {
                try? await Task.sleep(nanoseconds: 16_000_000)
                let layer = chat.view.layer.presentation() ?? chat.view.layer
                let destination = window.layer.presentation() ?? window.layer
                let box = layer.convert(layer.bounds, to: destination)
                XCTAssertEqual(box.minY, window.bounds.minY, accuracy: 1.5, "Diagonal entry at cycle \(cycle)")
                XCTAssertEqual(box.height, window.bounds.height, accuracy: 1.5)
            }
            XCTAssertTrue(nav.topViewController === chat)
            XCTAssertFalse(composer.textView.isFirstResponder)
            XCTAssertEqual(composer.text, "Preserved draft \(cycle)")
            XCTAssertEqual(chat.view.transform, .identity)
        }
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
