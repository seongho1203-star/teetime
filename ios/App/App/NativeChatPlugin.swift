import UIKit
import Capacitor

@objc(NativeChatPlugin)
public class NativeChatPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeChatPlugin"
    public let jsName = "NativeChat"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "session", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reset", returnType: CAPPluginReturnPromise)
    ]
    private var chat: NativeChatViewController?
    private var screen = ""

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let config = NativeChatConfig(call.options as? ChatJSON ?? [:]), let screen = call.getString("screen"),
                  let root = self.bridge?.viewController else { call.reject("채팅을 열 수 없습니다."); return }
            if self.chat?.service.config.user != config.user { self.remove(clear: true) }
            let chat = self.chat ?? NativeChatViewController(service: NativeChatService(config))
            self.chat = chat; self.screen = screen; chat.updateToken(config.token)
            chat.event = { [weak self] type, data in
                guard let self = self else { return }
                self.notifyListeners("event", data: ["screen": self.screen, "type": type, "data": data])
            }
            chat.service.authNeeded = { [weak self] in
                guard let self = self else { return }
                self.notifyListeners("event", data: ["screen": self.screen, "type": "auth", "data": [:]])
            }
            if chat.parent == nil {
                root.view.endEditing(true)
                root.addChild(chat); chat.view.translatesAutoresizingMaskIntoConstraints = false
                root.view.addSubview(chat.view)
                NSLayoutConstraint.activate([
                    chat.view.topAnchor.constraint(equalTo: root.view.topAnchor),
                    chat.view.bottomAnchor.constraint(equalTo: root.view.bottomAnchor),
                    chat.view.leadingAnchor.constraint(equalTo: root.view.leadingAnchor),
                    chat.view.trailingAnchor.constraint(equalTo: root.view.trailingAnchor)
                ])
                chat.didMove(toParent: root)
            }
            root.view.bringSubviewToFront(chat.view); root.view.layoutIfNeeded(); chat.resume()
            call.resolve(["ok": true])
        }
    }
    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if call.getString("screen") == self.screen { self.remove(clear: false) }
            call.resolve()
        }
    }
    @objc func session(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if call.getString("user") == self.chat?.service.config.user, let token = call.getString("token") {
                self.chat?.updateToken(token)
            }
            call.resolve()
        }
    }
    @objc func reset(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.remove(clear: true); call.resolve() }
    }
    @MainActor private func remove(clear: Bool) {
        chat?.pause()
        chat?.dismiss(animated: false)
        chat?.willMove(toParent: nil); chat?.view.removeFromSuperview(); chat?.removeFromParent()
        screen = ""
        if clear { chat = nil }
    }
}
