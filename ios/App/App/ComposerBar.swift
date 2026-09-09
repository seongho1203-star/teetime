import UIKit

/*
 * 대화·댓글의 **글칸 한 줄**을 네이티브로 그린다.
 *
 * 왜 네이티브인가 — 두 가지가 웹으로는 안 고쳐진다(`docs/출시-전-할일.md` 2-1번):
 *
 * 1. **천지인 깜빡임.** 아이폰 천지인 자판은 웹 글칸에서 조합(marked text)을
 *    아예 안 쓰고 `ㄱ·` → `ㄱ` → `` → `고`처럼 **칸을 진짜 비웠다가 다시
 *    채운다.** 그 빈 상태가 7~13ms 이어져 한 프레임에 걸리면 글씨가
 *    사라졌다 나온다. 맨 칸(자바스크립트 한 줄 없는 `<textarea>`)에서도
 *    같아서 웹에서 바꿀 수 있는 것이 없었다. `UITextView`는 조합을 쓰므로
 *    칸이 빌 일 자체가 없다.
 * 2. **키보드와 따로 노는 움직임.** 카톡의 입력칸은 키보드에 붙어 있는
 *    네이티브 뷰(`inputAccessoryView`)라 iOS가 **한 번의 움직임으로 함께**
 *    옮긴다. 웹뷰 안에서는 iOS 키보드 · 웹뷰 줄이기 · 웹 화면 셋이 따로
 *    놀아서 그 틈을 좁힐 수는 있어도 없앨 수는 없었다.
 *
 * **모양과 크기는 JS가 정한다.** 여기 적힌 값은 예비값일 뿐이고 실제로는
 * `attach()`가 받은 값으로 덮인다 — 앱은 새로 만들려면 30분이 걸리지만
 * 웹은 밀면 바로 반영되므로, 손볼 만한 것은 전부 웹 쪽에 두는 것이 맞다.
 * (`src/lib/composer.ts`의 `SKIN`이 그 값이다.)
 *
 * 크기는 `Chat.css`의 `.chat-input` 한 줄을 그대로 옮긴 것이다 —
 * 글칸 한 줄 38px · 최대 120px · 안여백 7/14 · 모서리 19px(한 줄의 절반).
 */

protocol ComposerBarDelegate: AnyObject {
    /// 글이 바뀌었다. `sel`은 커서 자리다(`@언급`을 가려내는 데 쓴다).
    func composerChanged(text: String, sel: Int)
    /// 보내기를 눌렀다.
    func composerSend(text: String)
    /// `+`나 이모티콘 단추를 눌렀다.
    func composerTapped(_ name: String)
    /// 글칸에 초점이 오갔다.
    func composerFocus(_ on: Bool)
    /// 바 높이가 바뀌었다(줄이 늘거나 줄었다).
    func composerResized(_ height: Double)
}

final class ComposerBar: UIView, UITextViewDelegate {

    weak var barDelegate: ComposerBarDelegate?

    // ── 크기 (JS가 덮어쓴다) ────────────────────────────────
    var padV: CGFloat = 10          // .chat-input 의 위아래 여백(--gap-sm)
    var padH: CGFloat = 6           // .chat-input 의 좌우 여백(--gap-xs)
    var gap: CGFloat = 2            // .chat-bar 의 사이
    var minH: CGFloat = 38          // 글칸 한 줄
    var maxH: CGFloat = 120
    var plusW: CGFloat = 32
    var sendW: CGFloat = 34
    var iconW: CGFloat = 30         // 글칸 안 이모티콘 단추
    var fontSize: CGFloat = 16
    var radius: CGFloat = 19
    /**
     * **키보드가 내려가 있을 때 아래에 비워 둘 자리**(웹 탭바 높이).
     *
     * 바는 화면 맨 아래에 서는데 우리 앱은 거기에 탭바(홈·공지·…)가 있다.
     * 그 높이만큼 바를 키우고 **그 자리는 칠하지도, 손짓을 받지도 않는다** —
     * 그러면 밑에 있는 웹 탭바가 그대로 보이고 눌린다.
     * 키보드가 올라오면 탭바는 감춰지므로 이 몫도 0이 된다.
     *
     * **웹이 정하는 값이라 어긋나도 앱을 다시 안 만들어도 된다** — 0을
     * 넘기고 웹에서 탭바를 감추면 그대로 맞는다.
     */
    var tabH: CGFloat = 0

    // ── 색 (JS가 덮어쓴다) ─────────────────────────────────
    var cBg: UIColor = .white
    var cField: UIColor = UIColor(white: 0.94, alpha: 1)
    var cText: UIColor = .black
    var cHint: UIColor = UIColor(white: 0.6, alpha: 1)
    var cDim: UIColor = UIColor(white: 0.45, alpha: 1)
    var cBrand: UIColor = UIColor(red: 1, green: 0.36, blue: 0.6, alpha: 1)
    var cOnBrand: UIColor = .white
    var cOffBg: UIColor = UIColor(white: 0.90, alpha: 1)
    var cOffFg: UIColor = UIColor(white: 0.62, alpha: 1)
    var cLine: UIColor = UIColor(white: 0.88, alpha: 1)

    let plusBtn = UIButton(type: .system)
    let iconBtn = UIButton(type: .system)
    let sendBtn = UIButton(type: .system)
    let textView = UITextView()
    let hintLabel = UILabel()
    private let topLine = UIView()
    /// 바탕칠. **바 전체가 아니라 위쪽만 칠한다** — 아래 탭바 자리는
    /// 비워 두어야 밑에 있는 웹 탭바가 보인다(`tabH` 주석 참고).
    private let fill = UIView()

    /// 마지막으로 알려 준 높이. 같은 값을 되풀이해 보내지 않는다.
    private var toldHeight: CGFloat = 0
    /// 이모티콘 서랍이 열려 있는가(그때는 자판 그림이 된다).
    private var trayOn = false
    /// 이모티콘 단추를 그리는가. 한 장도 없으면 자리를 비운다.
    var showIcon = true
    /// `+`(사진) 단추를 그리는가. **댓글 칸에서는 안 그린다** — 거기는
    /// 사진을 못 붙인다.
    var showPlus = true

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        build()
    }

    private func build() {
        // `inputAccessoryView`가 제 높이(`intrinsicContentSize`)를 따르게
        // 하는 한 쌍이다. 빼면 44px에 갇힌다.
        autoresizingMask = .flexibleHeight
        translatesAutoresizingMaskIntoConstraints = true

        backgroundColor = .clear
        fill.isUserInteractionEnabled = false
        addSubview(fill)

        topLine.isUserInteractionEnabled = false
        addSubview(topLine)

        textView.delegate = self
        textView.font = .systemFont(ofSize: fontSize)
        textView.isScrollEnabled = true
        textView.showsVerticalScrollIndicator = false
        textView.layer.cornerRadius = radius
        textView.layer.masksToBounds = true
        // 웹 글칸(`padding: 7px 40px 7px 14px`)과 같은 안여백.
        textView.textContainerInset = UIEdgeInsets(top: 7, left: 9, bottom: 7, right: 34)
        textView.textContainer.lineFragmentPadding = 5
        textView.keyboardType = .default
        textView.returnKeyType = .default
        addSubview(textView)

        hintLabel.text = "메시지"
        hintLabel.isUserInteractionEnabled = false
        addSubview(hintLabel)

        plusBtn.addTarget(self, action: #selector(tapPlus), for: .touchUpInside)
        plusBtn.accessibilityLabel = "사진 보내기"
        addSubview(plusBtn)

        iconBtn.addTarget(self, action: #selector(tapIcon), for: .touchUpInside)
        iconBtn.accessibilityLabel = "이모티콘"
        addSubview(iconBtn)

        sendBtn.addTarget(self, action: #selector(tapSend), for: .touchUpInside)
        sendBtn.accessibilityLabel = "보내기"
        sendBtn.layer.masksToBounds = true
        addSubview(sendBtn)

        watchKeyboard()
        paint()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // ── 겉모습 ────────────────────────────────────────────

    /// 색과 그림을 다시 입힌다. 값이 바뀔 때마다 부른다.
    func paint() {
        fill.backgroundColor = cBg
        topLine.backgroundColor = cLine

        textView.backgroundColor = cField
        textView.textColor = cText
        textView.tintColor = cBrand
        textView.font = .systemFont(ofSize: fontSize)
        textView.layer.cornerRadius = radius

        hintLabel.textColor = cHint
        hintLabel.font = .systemFont(ofSize: fontSize)
        hintLabel.sizeToFit()

        let heavy = UIImage.SymbolConfiguration(pointSize: 19, weight: .medium)
        let light = UIImage.SymbolConfiguration(pointSize: 17, weight: .regular)
        let small = UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)

        plusBtn.setImage(UIImage(systemName: "plus", withConfiguration: heavy), for: .normal)
        plusBtn.tintColor = cText

        iconBtn.setImage(UIImage(systemName: trayOn ? "keyboard" : "face.smiling",
                                 withConfiguration: light), for: .normal)
        iconBtn.tintColor = trayOn ? cBrand : cDim
        iconBtn.isHidden = !showIcon
        plusBtn.isHidden = !showPlus

        sendBtn.setImage(UIImage(systemName: "arrow.up", withConfiguration: small), for: .normal)
        sendBtn.layer.cornerRadius = sendW / 2
        refreshSend()
        refreshHint()
    }

    /// 보내기 단추의 켜짐. **웹과 같은 잣대다** — 초점이 있거나 적어 둔
    /// 글이 있으면 켠다. 글자 수로만 정하면 조합 중에 깜빡인다.
    func refreshSend() {
        let on = textView.isFirstResponder || !textView.text.isEmpty || forceSend
        sendBtn.backgroundColor = on ? cBrand : cOffBg
        sendBtn.tintColor = on ? cOnBrand : cOffFg
    }

    /// 골라 둔 이모티콘이 있을 때처럼 글이 없어도 켜 두어야 하는 경우.
    var forceSend = false { didSet { refreshSend() } }

    private func refreshHint() {
        hintLabel.isHidden = textView.isFirstResponder || !textView.text.isEmpty
    }

    func setTray(_ on: Bool) {
        guard trayOn != on else { return }
        trayOn = on
        paint()
    }

    func setHint(_ s: String) {
        hintLabel.text = s
        hintLabel.sizeToFit()
        setNeedsLayout()
    }

    // ── 자리 ─────────────────────────────────────────────

    private func totalWidth() -> CGFloat {
        return bounds.width > 1 ? bounds.width : UIScreen.main.bounds.width
    }

    /// `+`가 없으면 그 자리도 없다.
    private func plusWidth() -> CGFloat { return showPlus ? plusW : 0 }

    private func fieldWidth() -> CGFloat {
        let w = totalWidth() - padH * 2 - plusWidth() - sendW - gap * 2
        return max(60, w)
    }

    /// 적은 글에 맞춘 글칸 높이. 한 줄(minH)과 한도(maxH) 사이다.
    private func fieldHeight() -> CGFloat {
        let fit = textView.sizeThatFits(CGSize(width: fieldWidth(),
                                               height: .greatestFiniteMagnitude)).height
        return min(maxH, max(minH, ceil(fit)))
    }

    /// 키보드가 올라와 있는가. 아래 빈자리를 둘지가 이걸로 갈린다.
    private(set) var kbUp = false

    /// 칠하고 누를 수 있는 곳의 아래 끝.
    private func innerBottom() -> CGFloat {
        return bounds.height - safeAreaInsets.bottom - (kbUp ? 0 : tabH)
    }

    private func barHeight() -> CGFloat {
        return padV * 2 + fieldHeight() + safeAreaInsets.bottom + (kbUp ? 0 : tabH)
    }

    /// 키보드가 오르내릴 때 스스로 알아챈다 — **웹이 알려 주기를
    /// 기다리면 한 번 건너오느라 늦어 그 사이 자리가 어긋난다.**
    func watchKeyboard() {
        let c = NotificationCenter.default
        c.addObserver(self, selector: #selector(kbShow),
                      name: UIResponder.keyboardWillShowNotification, object: nil)
        c.addObserver(self, selector: #selector(kbHide),
                      name: UIResponder.keyboardWillHideNotification, object: nil)
    }

    @objc private func kbShow() { setKb(true) }
    @objc private func kbHide() { setKb(false) }

    private func setKb(_ on: Bool) {
        guard kbUp != on else { return }
        kbUp = on
        invalidateIntrinsicContentSize()
        setNeedsLayout()
    }

    /// 아래 빈자리는 우리 것이 아니다 — 손짓을 그대로 흘려보낸다.
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if point.y > innerBottom() { return nil }
        return super.hitTest(point, with: event)
    }

    override var intrinsicContentSize: CGSize {
        return CGSize(width: UIView.noIntrinsicMetric, height: barHeight())
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        invalidateIntrinsicContentSize()
    }

    override func layoutSubviews() {
        super.layoutSubviews()

        let w = bounds.width
        let fh = fieldHeight()
        // 안쪽 내용의 아래 끝. 홈 인디케이터와 탭바 자리는 비워 둔다.
        let inner = innerBottom()

        fill.frame = CGRect(x: 0, y: 0, width: w, height: max(0, inner))
        topLine.frame = CGRect(x: 0, y: 0, width: w, height: 1 / UIScreen.main.scale)

        let fx = padH + plusWidth() + (showPlus ? gap : 0)
        let fy = inner - padV - fh
        textView.frame = CGRect(x: fx, y: fy, width: fieldWidth(), height: fh)

        hintLabel.frame = CGRect(x: fx + 14,
                                 y: fy + (minH - hintLabel.bounds.height) / 2,
                                 width: hintLabel.bounds.width,
                                 height: hintLabel.bounds.height)

        plusBtn.frame = CGRect(x: padH, y: inner - padV - minH, width: plusW, height: minH)

        iconBtn.frame = CGRect(x: textView.frame.maxX - 4 - iconW,
                               y: textView.frame.maxY - 4 - iconW,
                               width: iconW, height: iconW)

        sendBtn.frame = CGRect(x: w - padH - sendW,
                               y: inner - padV - sendW - 2,
                               width: sendW, height: sendW)

        tellHeight()
    }

    /// 높이가 바뀌면 웹에 알린다 — 웹이 그만큼 자리를 비워야
    /// 목록이 바 밑으로 숨지 않는다(`--composer`).
    private func tellHeight() {
        let h = bounds.height
        guard h > 1, abs(h - toldHeight) > 0.5 else { return }
        toldHeight = h
        barDelegate?.composerResized(Double(h))
    }

    // ── 글 ───────────────────────────────────────────────

    var text: String {
        get { return textView.text ?? "" }
        set {
            textView.text = newValue
            afterEdit(tell: false)
        }
    }

    /// 커서 자리(글자 수 기준).
    var caret: Int {
        get {
            guard let r = textView.selectedTextRange else { return textView.text.count }
            return textView.offset(from: textView.beginningOfDocument, to: r.start)
        }
        set {
            let n = max(0, min(newValue, (textView.text as NSString).length))
            textView.selectedRange = NSRange(location: n, length: 0)
        }
    }

    private func afterEdit(tell: Bool) {
        refreshHint()
        refreshSend()
        let before = bounds.height
        invalidateIntrinsicContentSize()
        setNeedsLayout()
        if abs(before - barHeight()) > 0.5 { layoutIfNeeded() }
        if tell { barDelegate?.composerChanged(text: text, sel: caret) }
    }

    // ── 손짓 ─────────────────────────────────────────────

    @objc private func tapPlus() { barDelegate?.composerTapped("plus") }
    @objc private func tapIcon() { barDelegate?.composerTapped("sticker") }
    @objc private func tapSend() { barDelegate?.composerSend(text: text) }

    func textViewDidChange(_ tv: UITextView) {
        afterEdit(tell: true)
    }

    func textViewDidBeginEditing(_ tv: UITextView) {
        refreshHint()
        refreshSend()
        barDelegate?.composerFocus(true)
    }

    func textViewDidEndEditing(_ tv: UITextView) {
        refreshHint()
        refreshSend()
        barDelegate?.composerFocus(false)
    }

    func textViewDidChangeSelection(_ tv: UITextView) {
        // 커서만 옮긴 것도 `@언급` 목록을 다시 가려야 한다.
        guard tv.isFirstResponder else { return }
        barDelegate?.composerChanged(text: text, sel: caret)
    }
}
