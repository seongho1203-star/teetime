import UIKit

/*
 * **쓰는 화면의 뼈대** — 공지 쓰기·모집 열기·투표 만들기가 같이 쓴다
 * (`docs/아이폰-네이티브.md` 3단계). 웹의 `.card` + `.field` + `.form-actions`를
 * 옮긴 것이다.
 *
 *  - 본문은 굴러가는 카드 기둥(`stack`)이고, **저장 단추는 아래 붙박이 바**다
 *    (웹 `.form-actions`). 바는 `keyboardLayoutGuide`에 묶여 키보드와 한 몸으로
 *    오르내린다 — 웹에서는 `lib/keyboard.ts`가 탭바를 감추고 단추를 키보드 위로
 *    내리던 일을 iOS가 대신 한다.
 *  - **글칸이 아닌 데를 누르면 키보드를 내린다**(웹 `lib/keyboard.ts`와 같은
 *    규칙 — 한글 자판에는 `완료`가 없어 이 길이 없으면 내릴 방법이 없다).
 *  - **글자 수 한도는 조합이 끝난 뒤에 자른다**(`markedTextRange`). 조합 중에
 *    자르면 한글이 깨진다.
 *  - 안내 글씨는 네이티브 `placeholder`를 쓴다 — 웹에서 `Hinted`로 직접 그리던
 *    것은 WebKit이 조합 중인 글자를 '빈칸'으로 봐서였고 네이티브 칸에는 그
 *    자국이 없다.
 */
class FormScreenController: NativeScreenController, UIGestureRecognizerDelegate {
    let scroll = UIScrollView()
    let stack = UIStackView()
    let saveBar = UIView()
    let saveBtn = UIButton(type: .system)
    let spinner = UIActivityIndicatorView(style: .medium)
    /// 한 번 그렸으면 다시 받지 않는다 — 되살아날 때(`revive`) 적던 것이 날아가면 안 된다.
    var built = false
    var saving = false

    override func viewDidLoad() {
        super.viewDidLoad()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        scroll.keyboardDismissMode = .interactive
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 4, left: 16, bottom: 24, right: 16)
        scroll.addSubview(stack)

        let tap = UITapGestureRecognizer(target: self, action: #selector(backgroundTapped))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        scroll.addGestureRecognizer(tap)

        saveBar.translatesAutoresizingMaskIntoConstraints = false
        saveBar.backgroundColor = AppSkin.bg
        let rule = UIView()
        rule.backgroundColor = AppSkin.line
        rule.translatesAutoresizingMaskIntoConstraints = false
        saveBtn.translatesAutoresizingMaskIntoConstraints = false
        saveBtn.titleLabel?.font = .systemFont(ofSize: 16, weight: .bold)
        saveBtn.setTitleColor(.white, for: .normal)
        saveBtn.setTitleColor(AppSkin.faint, for: .disabled)
        saveBtn.backgroundColor = AppSkin.brand
        saveBtn.layer.cornerRadius = AppSkin.radiusSm
        saveBtn.addTarget(self, action: #selector(saveTapped), for: .touchUpInside)
        saveBar.addSubview(rule); saveBar.addSubview(saveBtn)

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true

        body.addSubview(scroll); body.addSubview(saveBar); body.addSubview(spinner)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: body.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: saveBar.topAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            saveBar.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            saveBar.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            saveBar.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            rule.topAnchor.constraint(equalTo: saveBar.topAnchor),
            rule.leadingAnchor.constraint(equalTo: saveBar.leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: saveBar.trailingAnchor),
            rule.heightAnchor.constraint(equalToConstant: 1),
            saveBtn.topAnchor.constraint(equalTo: saveBar.topAnchor, constant: 10),
            saveBtn.bottomAnchor.constraint(equalTo: saveBar.bottomAnchor, constant: -10),
            saveBtn.leadingAnchor.constraint(equalTo: saveBar.leadingAnchor, constant: 16),
            saveBtn.trailingAnchor.constraint(equalTo: saveBar.trailingAnchor, constant: -16),
            saveBtn.heightAnchor.constraint(equalToConstant: 48),
            spinner.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: body.centerYAnchor)
        ])
        scroll.isHidden = true
        saveBar.isHidden = true
    }

    /// 저장 단추 글자 — 도는 동안은 `저장 중…`이고 눌리지 않는다.
    func setSave(_ title: String, busy: Bool) {
        saving = busy
        saveBtn.isEnabled = !busy
        saveBtn.backgroundColor = busy ? AppSkin.surface2 : AppSkin.brand
        saveBtn.setTitle(busy ? "저장 중…" : title, for: .normal)
    }

    /// 다 받았다 — 본문과 바를 내보인다.
    func showForm(saveTitle: String) {
        spinner.stopAnimating()
        scroll.isHidden = false
        saveBar.isHidden = false
        setSave(saveTitle, busy: false)
    }

    /// 못 쓰는 사람에게 — 빨간 안내 카드 하나만(웹 `.notice danger`).
    func showNotice(_ text: String) {
        spinner.stopAnimating()
        stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let l = mkLabel(text, size: 15, weight: .semibold, color: AppSkin.danger, lines: 0)
        let wrap = UIStackView(arrangedSubviews: [l])
        wrap.isLayoutMarginsRelativeArrangement = true
        wrap.layoutMargins = UIEdgeInsets(top: 12, left: 14, bottom: 12, right: 14)
        wrap.backgroundColor = AppSkin.danger.withAlphaComponent(0.08)
        wrap.layer.cornerRadius = AppSkin.radiusSm
        stack.addArrangedSubview(wrap)
        scroll.isHidden = false
        saveBar.isHidden = true
    }

    @objc func saveTapped() {}

    @objc private func backgroundTapped() { view.endEditing(true) }
    /* 글칸·단추·스위치를 누른 것은 그 일을 하게 둔다 — 그 밖만 '내리는 자리'다. */
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var v = touch.view
        while let x = v, x !== scroll {
            if x is UIControl || x is UITextView { return false }
            v = x.superview
        }
        return true
    }

    // ── 칸 만들기 ────────────────────────────────────────────────

    /// 이름 + 칸 한 벌(웹 `.field` — 이름은 작고 굵은 흐린 글자).
    func field(_ name: String, _ input: UIView, note: String? = nil) -> UIView {
        let v = UIStackView()
        v.axis = .vertical
        v.spacing = 6
        v.addArrangedSubview(mkLabel(name, size: 13, weight: .bold, color: AppSkin.dim))
        v.addArrangedSubview(input)
        if let note = note { v.addArrangedSubview(mkLabel(note, size: 12, color: AppSkin.faint, lines: 0)) }
        return v
    }

    /// 켜고 끄는 줄(웹 `.switch-row` — 켜지면 분홍).
    func switchRow(_ title: String, desc: String?, on: Bool) -> (UIView, UISwitch) {
        appSwitchRow(title, desc: desc, on: on)
    }

    /// 카드 한 장에 칸들을 담는다.
    @discardableResult
    func card(_ views: [UIView], spacing: CGFloat = 14) -> CardView {
        let c = CardView()
        c.content.spacing = spacing
        views.forEach { c.content.addArrangedSubview($0) }
        stack.addArrangedSubview(c)
        return c
    }

    /// 글을 치는 자리가 키보드에 가리면 끌어 올린다 — 여러 줄 칸이 늘어날 때.
    func reveal(_ v: UIView, rect: CGRect? = nil) {
        let r = scroll.convert(rect ?? v.bounds, from: v).insetBy(dx: 0, dy: -12)
        scroll.scrollRectToVisible(r, animated: false)
    }
}

/// 한 줄 칸(웹 `.input` — 16px · 44 높이 · 흰 바탕 · 가는 테두리).
final class FormTextField: UITextField {
    var maxLength = 0
    private let pad = UIEdgeInsets(top: 0, left: 13, bottom: 0, right: 13)

    init(hint: String = "", max: Int = 0) {
        super.init(frame: .zero)
        maxLength = max
        font = .systemFont(ofSize: 16)
        textColor = AppSkin.text
        backgroundColor = AppSkin.surface
        layer.cornerRadius = AppSkin.radiusSm
        layer.borderWidth = 1
        layer.borderColor = AppSkin.line.cgColor
        attributedPlaceholder = NSAttributedString(string: hint, attributes: [.foregroundColor: AppSkin.faint])
        clearButtonMode = .never
        heightAnchor.constraint(equalToConstant: 44).isActive = true
        addTarget(self, action: #selector(changed), for: .editingChanged)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func textRect(forBounds bounds: CGRect) -> CGRect { bounds.inset(by: pad) }
    override func editingRect(forBounds bounds: CGRect) -> CGRect { bounds.inset(by: pad) }
    override func placeholderRect(forBounds bounds: CGRect) -> CGRect { bounds.inset(by: pad) }

    @objc private func changed() {
        guard maxLength > 0, markedTextRange == nil, let t = text, t.count > maxLength else { return }
        text = String(t.prefix(maxLength))
    }
}

/// 여러 줄 칸(웹 `.textarea`) — 적은 만큼 자라고, 한도에서 자른다.
final class FormTextView: UITextView, UITextViewDelegate {
    var maxLength = 0
    var onChange: (() -> Void)?
    private let hintLabel = UILabel()

    init(minHeight: CGFloat, max: Int = 0, hint: String = "") {
        super.init(frame: .zero, textContainer: nil)
        maxLength = max
        font = .systemFont(ofSize: 16)
        textColor = AppSkin.text
        backgroundColor = AppSkin.surface
        layer.cornerRadius = AppSkin.radiusSm
        layer.borderWidth = 1
        layer.borderColor = AppSkin.line.cgColor
        textContainerInset = UIEdgeInsets(top: 11, left: 9, bottom: 11, right: 9)
        isScrollEnabled = false
        delegate = self
        heightAnchor.constraint(greaterThanOrEqualToConstant: minHeight).isActive = true
        hintLabel.text = hint
        hintLabel.font = .systemFont(ofSize: 16)
        hintLabel.textColor = AppSkin.faint
        hintLabel.numberOfLines = 0
        hintLabel.translatesAutoresizingMaskIntoConstraints = false
        hintLabel.isUserInteractionEnabled = false
        addSubview(hintLabel)
        NSLayoutConstraint.activate([
            hintLabel.topAnchor.constraint(equalTo: topAnchor, constant: 11),
            hintLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            hintLabel.widthAnchor.constraint(equalTo: widthAnchor, constant: -28)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    /// 글을 넣을 때는 이것으로 — 안내 글씨도 함께 맞춘다.
    func setText(_ s: String) { text = s; hintLabel.isHidden = !s.isEmpty }

    func textViewDidChange(_ textView: UITextView) {
        if maxLength > 0, markedTextRange == nil, text.count > maxLength {
            text = String(text.prefix(maxLength))
        }
        hintLabel.isHidden = !text.isEmpty
        onChange?()
    }
}

/**
 * **날짜·시각 한 칸** — 투표 `마감 시각`과 모집 열기의 `티오프`가 같이 쓴다
 * (웹 `components/DateTimeField.tsx`와 같은 자리).
 *
 * 웹이 브라우저 날짜 칸을 걷어내고 달력을 직접 그린 까닭은 **아이폰이 웹뷰
 * 안에서 영어 창을 제멋대로 띄워서**였다. 네이티브 `UIDatePicker`는
 * `ko_KR`로 두면 한글이고 늘 같은 모양이라 그 까닭이 없다 — 그래서 여기서는
 * 시스템 것을 쓴다. **시간대는 늘 한국이다**(기기 시간대를 따르면 해외에 있는
 * 사람에게만 시각이 어긋난다).
 *
 * **아직 안 골랐으면 비어 있다**(`date == nil`) — 웹처럼 고르는 것은
 * 사람 몫이다. `고르기`를 누르면 다음 날 `hour:minute`에서 시작한다.
 */
final class WhenPicker: UIStackView {
    static let seoul = TimeZone(identifier: "Asia/Seoul") ?? .current
    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = seoul
        c.locale = Locale(identifier: "ko_KR")
        return c
    }
    private let picker = UIDatePicker()
    private let pickBtn = UIButton(type: .system)
    private let hour: Int, minute: Int
    var onChange: (() -> Void)?
    var date: Date? {
        didSet {
            if let d = date, picker.date != d { picker.date = d }
            picker.isHidden = date == nil
            pickBtn.isHidden = date != nil
        }
    }

    /// `quick`는 바로누름(`3일 후` 같은 것 · 지금부터 며칠 뒤 같은 시각).
    init(hour: Int, minute: Int, quick: [(String, Int)] = []) {
        self.hour = hour; self.minute = minute
        super.init(frame: .zero)
        axis = .vertical
        spacing = 8
        alignment = .leading
        picker.datePickerMode = .dateAndTime
        picker.preferredDatePickerStyle = .compact
        picker.locale = Locale(identifier: "ko_KR")
        picker.timeZone = Self.seoul
        picker.calendar = Self.calendar
        picker.tintColor = AppSkin.brand
        picker.isHidden = true
        picker.addTarget(self, action: #selector(picked), for: .valueChanged)
        appButton(pickBtn, title: "📅 날짜·시각 고르기", color: AppSkin.text, filled: false)
        pickBtn.addTarget(self, action: #selector(startTapped), for: .touchUpInside)
        addArrangedSubview(picker)
        addArrangedSubview(pickBtn)
        if !quick.isEmpty {
            let row = UIStackView()
            row.axis = .horizontal
            row.spacing = 6
            for (title, days) in quick {
                let b = UIButton(type: .system)
                appButton(b, title: title, color: AppSkin.dim, filled: false)
                b.tag = days
                b.addTarget(self, action: #selector(quickTapped(_:)), for: .touchUpInside)
                row.addArrangedSubview(b)
            }
            addArrangedSubview(row)
        }
    }
    required init(coder: NSCoder) { fatalError() }

    @objc private func picked() { date = picker.date; onChange?() }
    @objc private func startTapped() {
        let cal = Self.calendar
        let day = cal.startOfDay(for: Date(timeIntervalSinceNow: 86400))
        date = cal.date(bySettingHour: hour, minute: minute, second: 0, of: day)
        onChange?()
    }
    @objc private func quickTapped(_ b: UIButton) {
        date = Date(timeIntervalSinceNow: TimeInterval(b.tag) * 86400)
        onChange?()
    }

    /// 오늘(한국 날짜)에서 며칠 뒤 그 시각 — 새 투표의 마감 기본값.
    static func daysLater(_ days: Int, hour: Int, minute: Int) -> Date? {
        let cal = calendar
        guard let day = cal.date(byAdding: .day, value: days, to: cal.startOfDay(for: Date())) else { return nil }
        return cal.date(bySettingHour: hour, minute: minute, second: 0, of: day)
    }

    /// DB에 넣는 모양(UTC ISO).
    static func iso(_ d: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.string(from: d)
    }
    /// `10월 4일 (일)` — 웹 `dateLabel`과 같은 모양.
    static func dayLabel(_ dc: DateComponents) -> String {
        let cal = calendar
        guard let d = cal.date(from: dc) else { return "" }
        let week = ["일", "월", "화", "수", "목", "금", "토"][cal.component(.weekday, from: d) - 1]
        return "\(cal.component(.month, from: d))월 \(cal.component(.day, from: d))일 (\(week))"
    }
}

/// 켜고 끄는 줄(웹 `.switch-row`) — 쓰는 화면과 `내 정보`가 같이 쓴다.
func appSwitchRow(_ title: String, desc: String?, on: Bool) -> (UIView, UISwitch) {
    let sw = UISwitch()
    sw.isOn = on
    sw.onTintColor = AppSkin.brand
    sw.accessibilityLabel = title
    let texts = UIStackView(arrangedSubviews: [mkLabel(title, size: 15, weight: .bold)])
    texts.axis = .vertical
    texts.spacing = 2
    if let desc = desc { texts.addArrangedSubview(mkLabel(desc, size: 12, color: AppSkin.faint, lines: 0)) }
    let row = UIStackView(arrangedSubviews: [texts, sw])
    row.axis = .horizontal
    row.alignment = .center
    row.spacing = 12
    sw.setContentHuggingPriority(.required, for: .horizontal)
    return (row, sw)
}
