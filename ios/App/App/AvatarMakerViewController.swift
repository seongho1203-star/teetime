import UIKit

/*
 * **커스텀 프로필 만들기** — 카톡의 그 화면(사용자 요청 — 카톡 프사가 가입할 때 저절로 딸려
 * 오는데 그게 싫은 사람이 있다 · 카톡 화면 사진을 받아 맞췄다).
 * 색 바탕에 **닉네임 글자**나 **이모티콘**을 얹은 그림을 앱이 그려서 **보통 프로필 사진과 똑같이**
 * 올린다(`avatars/<내 id>/<시각>.jpg` · `MeViewController.upload`). 그래서 새 칸도 SQL도 없고,
 * 이 그림을 모르는 옛 앱·웹에서도 그대로 보인다.
 *
 * **그리는 규칙은 `AvatarArt` 하나다 — 안드로이드 `AvatarMaker.kt`와 값이 같아야 한다**
 * (색 · 이모티콘 목록 · 글자 자리). 한쪽만 고치면 같은 사람이 폰마다 다르게 만든다.
 *
 *  - 머리: 왼쪽 `✕` · 가운데 제목 · 오른쪽 `확인`.
 *  - 가운데 크게 미리보기(얼굴과 같은 둥근 네모 · 모서리 = 크기 × 10/29).
 *  - 아래에 떠 있는 알약 도구 셋 — 😀 이모티콘 · 🎨 색 · `Aa` 글자. 누른 것의 판이 그 위에 선다.
 *  - `Aa` 판: `텍스트 적용` 스위치 · 적을 글자(기본 닉네임 · 여덟 글자까지) · `기본 글씨체`/`굵은 글씨체`.
 */
enum AvatarArt {
    /** 바탕색 열둘 — 첫째가 카톡 사진의 그 라벤더다. */
    static let colors = ["#b088c8", "#e85d9a", "#f29a76", "#f6c343", "#7cb342", "#4db6ac",
                         "#5aa9e6", "#3f5ba9", "#8d6e63", "#9e9e9e", "#2b2b2b", "#f5f1e8"]
    /** 이모티콘 스물넷 — 맨 앞의 빈 글자가 `없음`이다. */
    static let emojis = ["", "⛳", "🏌️", "🏆", "🎯", "😎", "😀", "😆", "🥰", "🤩", "😇", "🤔",
                         "🐻", "🐶", "🐱", "🐰", "🦊", "🐼", "🐧", "🌸", "🌿", "☀️", "🍺", "☕"]
    static let maxText = 8

    struct Spec {
        var color = AvatarArt.colors[0]
        var text = ""
        var showText = true
        var bold = false
        var emoji = ""
    }

    /** 바탕이 밝으면 먹색 글자, 아니면 흰 글자. */
    static func ink(_ hex: String) -> UIColor {
        guard let c = UIColor(hexString: hex) else { return .white }
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (0.299 * r + 0.587 * g + 0.114 * b) > 0.72 ? AppSkin.text : .white
    }

    /**
     * 정사각 `side`로 그린다. 자리는 셋 중 하나다:
     * 글자만 — 폭 80% · 높이 34%까지 · 가운데 / 이모티콘만 — 56% · 가운데 /
     * 둘 다 — 이모티콘 42%를 위(가운데 40%)에, 글자는 폭 78% · 높이 16%까지 아래(가운데 76%)에.
     */
    static func render(_ s: Spec, side: CGFloat, scale: CGFloat = 0) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.default()
        if scale > 0 { fmt.scale = scale }
        fmt.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: fmt).image { ctx in
            (UIColor(hexString: s.color) ?? .gray).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
            let text = s.showText ? String(s.text.trimmingCharacters(in: .whitespaces).prefix(maxText)) : ""
            let hasEmoji = !s.emoji.isEmpty
            if hasEmoji {
                let size = side * (text.isEmpty ? 0.56 : 0.42)
                draw(s.emoji, font: .systemFont(ofSize: size), color: .black,
                     center: CGPoint(x: side / 2, y: side * (text.isEmpty ? 0.5 : 0.40)))
            }
            if !text.isEmpty {
                let maxW = side * (hasEmoji ? 0.78 : 0.80)
                let maxH = side * (hasEmoji ? 0.16 : 0.34)
                let weight: UIFont.Weight = s.bold ? .heavy : .medium
                let probe = (text as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: 100, weight: weight)])
                let size = min(maxH, 100 * maxW / max(probe.width, 1))
                draw(text, font: .systemFont(ofSize: size, weight: weight), color: ink(s.color),
                     center: CGPoint(x: side / 2, y: side * (hasEmoji ? 0.76 : 0.5)))
            }
        }
    }

    private static func draw(_ str: String, font: UIFont, color: UIColor, center: CGPoint) {
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
        let sz = (str as NSString).size(withAttributes: attrs)
        (str as NSString).draw(at: CGPoint(x: center.x - sz.width / 2, y: center.y - sz.height / 2), withAttributes: attrs)
    }
}

final class AvatarMakerViewController: UIViewController, UITextFieldDelegate {
    private enum Panel { case emoji, color, text }

    private var spec = AvatarArt.Spec()
    private var panel: Panel = .color
    private let done: (Data) -> Void
    private let preview = UIImageView()
    private let panelBox = UIStackView()
    private let toolBar = UIStackView()
    private let textField = UITextField()

    init(name: String, done: @escaping (Data) -> Void) {
        self.done = done
        super.init(nibName: nil, bundle: nil)
        spec.text = String(name.prefix(AvatarArt.maxText))
        spec.showText = !spec.text.isEmpty
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = AppSkin.surface

        let close = circleButton(title: nil, symbol: "xmark", action: #selector(closeTapped))
        close.accessibilityLabel = "닫기"
        let ok = circleButton(title: "확인", symbol: nil, action: #selector(okTapped))
        let title = mkLabel("커스텀 프로필 만들기", size: 17, weight: .bold)
        title.textAlignment = .center
        [close, ok, title].forEach { $0.translatesAutoresizingMaskIntoConstraints = false; view.addSubview($0) }

        preview.translatesAutoresizingMaskIntoConstraints = false
        preview.layer.cornerCurve = .continuous
        preview.layer.masksToBounds = true
        preview.isAccessibilityElement = true
        preview.accessibilityLabel = "미리보기"
        view.addSubview(preview)

        panelBox.axis = .vertical
        panelBox.spacing = 0
        panelBox.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .onDrag
        scroll.addSubview(panelBox)
        view.addSubview(scroll)

        toolBar.axis = .horizontal
        toolBar.distribution = .fillEqually
        toolBar.backgroundColor = AppSkin.surface
        toolBar.layer.cornerRadius = 28
        toolBar.layer.borderWidth = 1
        toolBar.layer.borderColor = AppSkin.line.cgColor
        toolBar.layer.shadowColor = UIColor.black.cgColor
        toolBar.layer.shadowOpacity = 0.08
        toolBar.layer.shadowRadius = 10
        toolBar.layer.shadowOffset = CGSize(width: 0, height: 2)
        toolBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolBar)

        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            close.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
            close.topAnchor.constraint(equalTo: g.topAnchor, constant: 8),
            close.widthAnchor.constraint(equalToConstant: 44),
            close.heightAnchor.constraint(equalToConstant: 44),
            ok.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            ok.centerYAnchor.constraint(equalTo: close.centerYAnchor),
            ok.heightAnchor.constraint(equalToConstant: 44),
            ok.widthAnchor.constraint(greaterThanOrEqualToConstant: 64),
            title.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: close.centerYAnchor),
            title.leadingAnchor.constraint(greaterThanOrEqualTo: close.trailingAnchor, constant: 8),
            title.trailingAnchor.constraint(lessThanOrEqualTo: ok.leadingAnchor, constant: -8),

            preview.topAnchor.constraint(equalTo: close.bottomAnchor, constant: 20),
            preview.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            preview.widthAnchor.constraint(equalTo: g.widthAnchor, multiplier: 0.64),
            preview.heightAnchor.constraint(equalTo: preview.widthAnchor),

            scroll.topAnchor.constraint(equalTo: preview.bottomAnchor, constant: 20),
            scroll.leadingAnchor.constraint(equalTo: g.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: g.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: toolBar.topAnchor, constant: -8),
            panelBox.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            panelBox.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            panelBox.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor),
            panelBox.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor),

            toolBar.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            toolBar.widthAnchor.constraint(equalToConstant: 240),
            toolBar.heightAnchor.constraint(equalToConstant: 56),
            toolBar.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -12),
        ])

        textField.delegate = self
        textField.text = spec.text
        textField.font = .systemFont(ofSize: 16)
        textField.placeholder = "적을 글자"
        textField.clearButtonMode = .whileEditing
        textField.returnKeyType = .done
        textField.addTarget(self, action: #selector(textChanged), for: .editingChanged)

        buildTools()
        showPanel()
        redraw()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview.layer.cornerRadius = preview.bounds.width * 10 / 29
    }

    // ── 그리기 ──────────────────────────────────────────────────

    private func redraw() {
        preview.image = AvatarArt.render(spec, side: 240)
    }

    // ── 도구 ────────────────────────────────────────────────────

    private func buildTools() {
        toolBar.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let items: [(Panel, String)] = [(.emoji, "이모티콘"), (.color, "색"), (.text, "글자")]
        for (p, name) in items {
            let b = UIButton(type: .system)
            b.accessibilityLabel = name
            let on = panel == p
            switch p {
            case .emoji:
                b.setImage(UIImage(systemName: "face.smiling.inverse",
                                   withConfiguration: UIImage.SymbolConfiguration(pointSize: 24)), for: .normal)
                b.tintColor = on ? AppSkin.text : AppSkin.faint
            case .color:
                /* 색 도구는 지금 고른 색의 동그라미다 — 누르기 전에 무엇이 골라져 있는지 보인다. */
                let dot = UIView()
                dot.isUserInteractionEnabled = false
                dot.backgroundColor = UIColor(hexString: spec.color)
                dot.layer.cornerRadius = 14
                dot.layer.borderWidth = on ? 3 : 1
                dot.layer.borderColor = (on ? AppSkin.text : AppSkin.line).cgColor
                dot.translatesAutoresizingMaskIntoConstraints = false
                b.addSubview(dot)
                NSLayoutConstraint.activate([
                    dot.centerXAnchor.constraint(equalTo: b.centerXAnchor),
                    dot.centerYAnchor.constraint(equalTo: b.centerYAnchor),
                    dot.widthAnchor.constraint(equalToConstant: 28),
                    dot.heightAnchor.constraint(equalToConstant: 28),
                ])
            case .text:
                b.setTitle("Aa", for: .normal)
                b.titleLabel?.font = .systemFont(ofSize: 17, weight: .bold)
                b.setTitleColor(on ? .white : AppSkin.faint, for: .normal)
                if on {
                    let box = UIView()
                    box.isUserInteractionEnabled = false
                    box.backgroundColor = AppSkin.text
                    box.layer.cornerRadius = 6
                    box.translatesAutoresizingMaskIntoConstraints = false
                    b.insertSubview(box, at: 0)
                    NSLayoutConstraint.activate([
                        box.centerXAnchor.constraint(equalTo: b.centerXAnchor),
                        box.centerYAnchor.constraint(equalTo: b.centerYAnchor),
                        box.widthAnchor.constraint(equalToConstant: 34),
                        box.heightAnchor.constraint(equalToConstant: 30),
                    ])
                }
            }
            b.addAction(UIAction { [weak self] _ in
                guard let self = self else { return }
                self.panel = p
                self.view.endEditing(true)
                self.buildTools()
                self.showPanel()
            }, for: .touchUpInside)
            toolBar.addArrangedSubview(b)
        }
    }

    private func showPanel() {
        panelBox.arrangedSubviews.forEach { $0.removeFromSuperview() }
        switch panel {
        case .emoji: panelBox.addArrangedSubview(grid(count: AvatarArt.emojis.count, cell: emojiCell))
        case .color: panelBox.addArrangedSubview(grid(count: AvatarArt.colors.count, cell: colorCell))
        case .text: textPanel()
        }
    }

    /** 여섯 칸씩 한 줄 — 칸은 정사각이고 가운데에 얹힌다. */
    private func grid(count: Int, cell: (Int) -> UIView) -> UIView {
        let col = UIStackView()
        col.axis = .vertical
        col.spacing = 10
        col.isLayoutMarginsRelativeArrangement = true
        col.layoutMargins = UIEdgeInsets(top: 8, left: 20, bottom: 8, right: 20)
        var i = 0
        while i < count {
            let row = UIStackView()
            row.axis = .horizontal
            row.distribution = .fillEqually
            row.spacing = 10
            for j in i..<i + 6 {
                row.addArrangedSubview(j < count ? cell(j) : UIView())
            }
            row.heightAnchor.constraint(equalToConstant: 48).isActive = true
            col.addArrangedSubview(row)
            i += 6
        }
        return col
    }

    private func colorCell(_ i: Int) -> UIView {
        let hex = AvatarArt.colors[i]
        let b = UIButton(type: .custom)
        b.accessibilityLabel = "색 \(i + 1)"
        let dot = UIView()
        dot.isUserInteractionEnabled = false
        dot.backgroundColor = UIColor(hexString: hex)
        dot.layer.cornerRadius = 20
        dot.layer.borderWidth = 1
        dot.layer.borderColor = AppSkin.line.cgColor
        dot.translatesAutoresizingMaskIntoConstraints = false
        b.addSubview(dot)
        NSLayoutConstraint.activate([
            dot.centerXAnchor.constraint(equalTo: b.centerXAnchor),
            dot.centerYAnchor.constraint(equalTo: b.centerYAnchor),
            dot.widthAnchor.constraint(equalToConstant: 40),
            dot.heightAnchor.constraint(equalToConstant: 40),
        ])
        if hex == spec.color {
            let check = UIImageView(image: UIImage(systemName: "checkmark",
                                                   withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .bold)))
            check.tintColor = AvatarArt.ink(hex)
            check.translatesAutoresizingMaskIntoConstraints = false
            dot.addSubview(check)
            NSLayoutConstraint.activate([
                check.centerXAnchor.constraint(equalTo: dot.centerXAnchor),
                check.centerYAnchor.constraint(equalTo: dot.centerYAnchor),
            ])
        }
        b.addAction(UIAction { [weak self] _ in
            self?.spec.color = hex
            self?.redraw(); self?.buildTools(); self?.showPanel()
        }, for: .touchUpInside)
        return b
    }

    private func emojiCell(_ i: Int) -> UIView {
        let e = AvatarArt.emojis[i]
        let b = UIButton(type: .custom)
        b.accessibilityLabel = e.isEmpty ? "이모티콘 없음" : e
        if e.isEmpty {
            b.setTitle("없음", for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
            b.setTitleColor(AppSkin.faint, for: .normal)
        } else {
            b.setTitle(e, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 28)
        }
        b.layer.cornerRadius = 12
        b.layer.borderWidth = e == spec.emoji ? 2 : 0
        b.layer.borderColor = AppSkin.brand.cgColor
        b.backgroundColor = e == spec.emoji ? AppSkin.brand.withAlphaComponent(0.08) : .clear
        b.addAction(UIAction { [weak self] _ in
            self?.spec.emoji = e
            self?.redraw(); self?.showPanel()
        }, for: .touchUpInside)
        return b
    }

    private func textPanel() {
        let sw = UISwitch()
        sw.isOn = spec.showText
        sw.onTintColor = AppSkin.brand
        sw.addAction(UIAction { [weak self, weak sw] _ in
            self?.spec.showText = sw?.isOn ?? true
            self?.redraw()
        }, for: .valueChanged)
        panelBox.addArrangedSubview(row(mkLabel("텍스트 적용", size: 16), right: sw))

        let fieldWrap = UIView()
        textField.translatesAutoresizingMaskIntoConstraints = false
        textField.backgroundColor = AppSkin.surface2
        textField.layer.cornerRadius = 12
        textField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        textField.leftViewMode = .always
        fieldWrap.addSubview(textField)
        NSLayoutConstraint.activate([
            textField.leadingAnchor.constraint(equalTo: fieldWrap.leadingAnchor, constant: 20),
            textField.trailingAnchor.constraint(equalTo: fieldWrap.trailingAnchor, constant: -20),
            textField.topAnchor.constraint(equalTo: fieldWrap.topAnchor, constant: 4),
            textField.bottomAnchor.constraint(equalTo: fieldWrap.bottomAnchor, constant: -8),
            textField.heightAnchor.constraint(equalToConstant: 44),
        ])
        panelBox.addArrangedSubview(fieldWrap)

        for (bold, name) in [(false, "기본 글씨체"), (true, "굵은 글씨체")] {
            let dot = UIView()
            dot.layer.cornerRadius = 12
            dot.layer.borderWidth = spec.bold == bold ? 0 : 1.5
            dot.layer.borderColor = AppSkin.line.cgColor
            dot.backgroundColor = spec.bold == bold ? AppSkin.brand : .clear
            if spec.bold == bold {
                let inner = UIView()
                inner.backgroundColor = .white
                inner.layer.cornerRadius = 5
                inner.translatesAutoresizingMaskIntoConstraints = false
                dot.addSubview(inner)
                NSLayoutConstraint.activate([
                    inner.centerXAnchor.constraint(equalTo: dot.centerXAnchor),
                    inner.centerYAnchor.constraint(equalTo: dot.centerYAnchor),
                    inner.widthAnchor.constraint(equalToConstant: 10),
                    inner.heightAnchor.constraint(equalToConstant: 10),
                ])
            }
            dot.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([dot.widthAnchor.constraint(equalToConstant: 24), dot.heightAnchor.constraint(equalToConstant: 24)])
            let r = row(mkLabel(name, size: 16, weight: bold ? .heavy : .medium), right: dot)
            let tap = UIButton(type: .custom)
            tap.accessibilityLabel = name
            tap.translatesAutoresizingMaskIntoConstraints = false
            r.addSubview(tap)
            NSLayoutConstraint.activate([
                tap.leadingAnchor.constraint(equalTo: r.leadingAnchor), tap.trailingAnchor.constraint(equalTo: r.trailingAnchor),
                tap.topAnchor.constraint(equalTo: r.topAnchor), tap.bottomAnchor.constraint(equalTo: r.bottomAnchor),
            ])
            tap.addAction(UIAction { [weak self] _ in
                self?.spec.bold = bold
                self?.redraw(); self?.showPanel()
            }, for: .touchUpInside)
            panelBox.addArrangedSubview(r)
        }
    }

    /** 카톡 판의 한 줄 — 왼쪽 글자 · 오른쪽 조각 · 아래 가는 선 · 높이 58. */
    private func row(_ left: UIView, right: UIView) -> UIView {
        let r = UIView()
        left.translatesAutoresizingMaskIntoConstraints = false
        right.translatesAutoresizingMaskIntoConstraints = false
        let line = UIView()
        line.backgroundColor = AppSkin.line
        line.translatesAutoresizingMaskIntoConstraints = false
        [left, right, line].forEach(r.addSubview)
        NSLayoutConstraint.activate([
            r.heightAnchor.constraint(equalToConstant: 58),
            left.leadingAnchor.constraint(equalTo: r.leadingAnchor, constant: 20),
            left.centerYAnchor.constraint(equalTo: r.centerYAnchor),
            right.trailingAnchor.constraint(equalTo: r.trailingAnchor, constant: -20),
            right.centerYAnchor.constraint(equalTo: r.centerYAnchor),
            line.leadingAnchor.constraint(equalTo: r.leadingAnchor),
            line.trailingAnchor.constraint(equalTo: r.trailingAnchor),
            line.bottomAnchor.constraint(equalTo: r.bottomAnchor),
            line.heightAnchor.constraint(equalToConstant: 0.5),
        ])
        return r
    }

    // ── 글자 칸 ─────────────────────────────────────────────────

    @objc private func textChanged() {
        /* 조합 중에는 안 자른다 — 한글을 치는 그 순간에 자르면 조합이 깨진다. */
        if textField.markedTextRange == nil, let t = textField.text, t.count > AvatarArt.maxText {
            textField.text = String(t.prefix(AvatarArt.maxText))
        }
        spec.text = textField.text ?? ""
        if !spec.text.isEmpty && !spec.showText { spec.showText = true }
        redraw()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }

    // ── 머리 단추 ───────────────────────────────────────────────

    private func circleButton(title: String?, symbol: String?, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        if let symbol = symbol {
            b.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)), for: .normal)
            b.tintColor = AppSkin.text
        }
        if let title = title {
            b.setTitle(title, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
            b.setTitleColor(AppSkin.text, for: .normal)
            b.contentEdgeInsets = UIEdgeInsets(top: 0, left: 16, bottom: 0, right: 16)
        }
        b.backgroundColor = AppSkin.surface
        b.layer.cornerRadius = 22
        b.layer.borderWidth = 1
        b.layer.borderColor = AppSkin.line.cgColor
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    @objc private func closeTapped() {
        view.endEditing(true)
        dismiss(animated: true)
    }

    @objc private func okTapped() {
        view.endEditing(true)
        /* 400px로 굽는다 — 사진으로 바꿀 때와 같은 크기다(`MeViewController.shrink`). */
        guard let data = AvatarArt.render(spec, side: 400, scale: 1).jpegData(compressionQuality: 0.9) else { return }
        dismiss(animated: true) { [done] in done(data) }
    }
}
