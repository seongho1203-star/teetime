import UIKit

/*
 * **앱 사용자 가이드** — 웹 `screens/Help.tsx`를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 2단계).
 *
 * **글은 여기 없다.** `src/lib/guide.ts` 한 곳에만 있고, 웹이 화면을 열 때
 * `open({guide})`로 통째로 실어 보낸다(대화 화면이 이모티콘 추천 표를 받는
 * 것과 같은 방식). 두 벌로 두면 화면 문구를 고칠 때 한쪽만 고치게 된다 —
 * **Swift에 글을 적지 말 것.**
 *
 * 표시는 둘뿐이다 — `**굵게**`·`((곁말))`. 웹 `Rich`와 같은 규칙으로 푼다
 * (`GuideText`). `webOnly`인 단계(홈 화면에 추가)는 앱에서는 뺀다.
 */
final class HelpViewController: NativeScreenController {
    private let guide: ChatJSON
    private let scroll = UIScrollView()
    private let stack = UIStackView()

    init(service: NativeChatService, guide: ChatJSON) {
        self.guide = guide
        super.init(service: service, title: "앱 사용자 가이드")
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 4, left: 16, bottom: 24, right: 16)
        scroll.addSubview(stack)
        body.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: body.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: body.bottomAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor)
        ])
        render()
    }

    override func loadScreen() {}   // 받아 올 것이 없다 — 글은 열 때 함께 왔다

    private func render() {
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        if let intro = guide["intro"] as? String {
            stack.addArrangedSubview(GuideText.label(intro, size: 15, color: AppSkin.dim))
        }
        for raw in guide["parts"] as? [ChatJSON] ?? [] {
            let card = CardView()
            card.content.spacing = 8
            let n = raw["n"] as? Int ?? 0
            let title = NSMutableAttributedString(string: "\(raw["icon"] as? String ?? "") ", attributes: [.font: UIFont.systemFont(ofSize: 18)])
            title.append(NSAttributedString(string: "\(n). ", attributes: [.font: UIFont.systemFont(ofSize: 17, weight: .heavy), .foregroundColor: AppSkin.faint]))
            title.append(NSAttributedString(string: raw["title"] as? String ?? "", attributes: [.font: UIFont.systemFont(ofSize: 17, weight: .heavy), .foregroundColor: AppSkin.text]))
            let tl = UILabel(); tl.attributedText = title; tl.numberOfLines = 0
            card.content.addArrangedSubview(tl)
            if let lead = raw["lead"] as? String {
                card.content.addArrangedSubview(GuideText.label(lead, size: 14, color: AppSkin.dim))
            }
            for item in raw["items"] as? [String] ?? [] {
                card.content.addArrangedSubview(bullet(item))
            }
            var no = 0
            for step in raw["steps"] as? [ChatJSON] ?? [] {
                if step["webOnly"] as? Bool == true { continue }    // 홈 화면에 추가 — 앱에는 없는 단계
                no += 1
                if let text = step["text"] as? String { card.content.addArrangedSubview(stepRow(no, text)) }
            }
            if let tip = raw["tip"] as? String {
                let l = GuideText.label(tip, size: 14, color: AppSkin.dim)
                let wrap = UIStackView(arrangedSubviews: [l])
                wrap.isLayoutMarginsRelativeArrangement = true
                wrap.layoutMargins = UIEdgeInsets(top: 9, left: 11, bottom: 9, right: 11)
                wrap.backgroundColor = AppSkin.surface2
                wrap.layer.cornerRadius = AppSkin.radiusSm
                card.content.addArrangedSubview(wrap)
            }
            stack.addArrangedSubview(card)
        }
        let foot = CardView()
        foot.content.alignment = .center
        if let f = guide["foot"] as? String {
            let l = GuideText.label(f, size: 14, color: AppSkin.text)
            l.textAlignment = .center
            foot.content.addArrangedSubview(l)
        }
        let home = UIButton(type: .system)
        appButton(home, title: "홈으로 가기", color: AppSkin.text, filled: false)
        home.addTarget(self, action: #selector(homeTapped), for: .touchUpInside)
        foot.content.addArrangedSubview(home)
        stack.addArrangedSubview(foot)
    }

    /// 점 목록 한 줄 — `•` + 글(웹 `.help-list li`).
    private func bullet(_ text: String) -> UIView {
        let dot = mkLabel("•", size: 14, color: AppSkin.dim)
        dot.widthAnchor.constraint(equalToConstant: 12).isActive = true
        dot.setContentHuggingPriority(.required, for: .horizontal)
        let l = GuideText.label(text, size: 14, color: AppSkin.text)
        let row = UIStackView(arrangedSubviews: [dot, l])
        row.axis = .horizontal; row.spacing = 4; row.alignment = .top
        return row
    }

    /// 번호가 붙는 한 단계 — 분홍 동그라미 숫자(웹 `.help-step`). 손으로 따라 할 일에만 쓴다.
    private func stepRow(_ n: Int, _ text: String) -> UIView {
        let no = mkLabel(String(n), size: 12, weight: .heavy, color: .white)
        no.textAlignment = .center
        no.backgroundColor = AppSkin.brand
        no.layer.cornerRadius = 10.5
        no.layer.masksToBounds = true
        no.widthAnchor.constraint(equalToConstant: 21).isActive = true
        no.heightAnchor.constraint(equalToConstant: 21).isActive = true
        no.setContentHuggingPriority(.required, for: .horizontal)
        let l = GuideText.label(text, size: 14, color: AppSkin.text)
        let row = UIStackView(arrangedSubviews: [no, l])
        row.axis = .horizontal; row.spacing = 9; row.alignment = .top
        return row
    }

    @objc private func homeTapped() { navigate("/") }
}

/// `**굵게**`·`((곁말))`을 푼다 — 웹 `Help.tsx`의 `Rich`와 같은 규칙. **한쪽만 고치지 말 것.**
enum GuideText {
    static func attributed(_ text: String, size: CGFloat, color: UIColor, dim: Bool = false) -> NSAttributedString {
        let out = NSMutableAttributedString()
        let para = NSMutableParagraphStyle(); para.lineSpacing = 4
        let base: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size), .foregroundColor: dim ? AppSkin.dim : color, .paragraphStyle: para]
        let bold: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size, weight: .bold), .foregroundColor: dim ? AppSkin.dim : color, .paragraphStyle: para]
        guard let re = try? NSRegularExpression(pattern: "\\*\\*(.+?)\\*\\*|\\(\\((.+?)\\)\\)", options: [.dotMatchesLineSeparators]) else {
            return NSAttributedString(string: text, attributes: base)
        }
        let ns = text as NSString
        var last = 0
        for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            if m.range.location > last { out.append(NSAttributedString(string: ns.substring(with: NSRange(location: last, length: m.range.location - last)), attributes: base)) }
            if m.range(at: 1).location != NSNotFound {
                out.append(NSAttributedString(string: ns.substring(with: m.range(at: 1)), attributes: bold))
            } else if m.range(at: 2).location != NSNotFound {
                out.append(attributed(ns.substring(with: m.range(at: 2)), size: size, color: color, dim: true))
            }
            last = m.range.location + m.range.length
        }
        if last < ns.length { out.append(NSAttributedString(string: ns.substring(from: last), attributes: base)) }
        return out
    }
    static func label(_ text: String, size: CGFloat, color: UIColor) -> UILabel {
        let l = UILabel()
        l.numberOfLines = 0
        l.attributedText = attributed(text, size: size, color: color)
        return l
    }
}
