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
 *    네이티브 뷰라 iOS가 **한 번의 움직임으로 함께** 옮긴다. 웹뷰 안에서는
 *    iOS 키보드 · 웹뷰 줄이기 · 웹 화면 셋이 따로 놀아서 그 틈을 좁힐 수는
 *    있어도 없앨 수는 없었다.
 *
 * **바는 `inputAccessoryView`가 아니라 화면 아래에 늘 서 있는 보통 뷰다**
 * (`NativeComposerPlugin`이 `keyboardLayoutGuide`에 묶어 세운다).
 * 처음에는 `inputAccessoryView`로 만들었는데 **first responder가 곧
 * 생명줄이라** 대화 바탕을 한 번 누르기만 해도 웹뷰가 그 자리를 가져가
 * **바가 통째로 사라졌다**(실기기 제보 — `채팅 배경을 누르면 아예 사라져`).
 * 되받으면 이번엔 탭바 밑에서 다시 솟아오르는 것이 보였다. 아래
 * `NativeComposerPlugin.swift` 머리말에 적어 두었다.
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
    /// 바 높이가 바뀌었다(줄이 늘거나 줄었다). `y`는 바 윗변(화면 기준),
    /// `fr`은 글칸에 초점이 있는가, `kb`는 키보드가 올라와 있는가 —
    /// **바가 어디에 섰는지를 폰에서 읽어 오려는 진단값**이다(3판에서
    /// `댓글창이 안 올라와`를 코드만 봐서는 못 가려서 넣었다).
    func composerResized(_ height: Double, y: Double, fr: Bool, kb: Bool)
    /**
     * 키보드가 오르내리기 **시작한다.** `dur`는 iOS가 쓸 시간(초),
     * `at`은 지금 시각(1970년부터 ms)이다.
     *
     * **시각을 함께 보내는 것이 이 신호의 값이다.** 웹은 이 소식을 다리
     * 건너 받으므로 늘 한두 프레임 늦는데, 그만큼 늦게 시작한 뒤 0.25초를
     * 다 쓰면 화면이 키보드보다 늦게 도착한다(사용자 제보 — `채팅배경이
     * 좀 늦게 따라와`). `at`을 견주면 **얼마나 늦었는지**가 나오므로 남은
     * 시간만큼만 움직여 함께 끝낼 수 있다.
     *
     * **14판부터 끝값도 함께 실어 보낸다** — `chatH`·`pad`는 다 움직인 뒤의
     * 대화 화면 높이와 입력칸 여백(`report`의 그 셈을 끝 자리로 낸 것),
     * `s`는 바 윗변(=목록 아랫변)이 움직일 거리(위로가 양수)다. `slide`가
     * 참이면 **앱이 그 사이 목록 그림을 들고 움직이므로**(`ListSlider`) 웹은
     * 끝값을 한 번에 적고 굴린 자리를 `s`만큼 옮긴 뒤 `settled`로 알리면 된다.
     * 거짓이면 13판처럼 `frame`이 프레임마다 온다.
     */
    func composerKeyboard(on: Bool, dur: Double, at: Double,
                          chatH: Double, pad: Double, s: Double, slide: Bool)
    /**
     * 키보드가 움직이는 동안 바가 **실제로 그려지는 자리**(4판).
     * `bottom`은 바 아랫변(= 키보드 윗변, 화면 기준) · `h`는 바 높이 ·
     * `p`는 0(내려가 있음)~1(다 올라옴) · `end`는 다 움직였다는 표시다.
     * 까닭은 `follow()` 주석에 있다.
     */
    func composerFrame(bottom: Double, h: Double, p: Double, end: Bool,
                       chatH: Double, pad: Double)
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
     * 바는 화면 아래(안전 영역 바로 위)에 서는데 우리 앱은 거기에 탭바
     * (홈·공지·…)가 있다. 그 높이만큼 바를 키우고 **그 자리는 칠하지도,
     * 손짓을 받지도 않는다** — 그러면 밑에 있는 웹 탭바가 그대로 보이고
     * 눌린다. 홈 인디케이터 자리는 바 밖이라(안전 영역) 거기도 웹이 보인다.
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
        // 오토레이아웃으로 세운다(가로는 화면에, 아래는 키보드 위에 묶인다).
        // 높이는 `intrinsicContentSize`가 정한다.
        translatesAutoresizingMaskIntoConstraints = false

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

    /// 키보드가 움직이는 동안 목록 그림을 들고 움직이는 것(14판). 플러그인이
    /// 세워서 넣어 준다. 없으면 13판처럼 프레임마다 알리는 길만 간다.
    var slider: ListSlider?

    /**
     * **지금 뜬 키보드가 이 바의 것인가.** 대화 검색 칸(웹) 때문에 뜬
     * 키보드가 내려갈 때 목록 그림을 밀면 검색 결과 창까지 밀린다 — 그때는
     * 안 한다. `textViewDidBeginEditing`에서 켜고 **키보드가 다 내려간 뒤에**
     * 끈다(`keyboardDidHide`). 초점이 떠나는 순간 끄면 `willHide`가 그보다
     * 먼저 와서 내려가는 길에는 늘 거짓이 된다.
     */
    private var kbOwner = false

    /// 칠하고 누를 수 있는 곳의 아래 끝.
    private func innerBottom() -> CGFloat {
        return bounds.height - safeAreaInsets.bottom - (kbUp ? 0 : tabH)
    }

    private func barHeight() -> CGFloat {
        return padV * 2 + fieldHeight() + safeAreaInsets.bottom + (kbUp ? 0 : tabH)
    }

    /**
     * iOS 15 아래에서만 쓰는 예비 길. `keyboardLayoutGuide`가 없는 판에서는
     * 바 아래를 화면 안전 영역에 묶어 두고, 키보드가 오르내릴 때 이 값을
     * 키보드 높이만큼 움직인다(플러그인이 넣어 준다).
     */
    var bottomC: NSLayoutConstraint?

    /// 키보드가 오르내릴 때 스스로 알아챈다 — **웹이 알려 주기를
    /// 기다리면 한 번 건너오느라 늦어 그 사이 자리가 어긋난다.**
    func watchKeyboard() {
        let c = NotificationCenter.default
        c.addObserver(self, selector: #selector(kbShow(_:)),
                      name: UIResponder.keyboardWillShowNotification, object: nil)
        c.addObserver(self, selector: #selector(kbHide(_:)),
                      name: UIResponder.keyboardWillHideNotification, object: nil)
        c.addObserver(self, selector: #selector(kbGone(_:)),
                      name: UIResponder.keyboardDidHideNotification, object: nil)
    }

    @objc private func kbShow(_ n: Notification) {
        if textView.isFirstResponder { kbOwner = true }
        setKb(true, n)
    }
    @objc private func kbHide(_ n: Notification) { setKb(false, n) }
    @objc private func kbGone(_ n: Notification) { kbOwner = false }

    /**
     * 아래 빈자리(`tabH`)를 걷거나 되돌린다. **키보드와 같은 시간·곡선으로
     * 편다** — 알림에 실려 오는 그 값이다. 그냥 바꾸면 키보드가 움직이기
     * 시작하는 순간 바가 탭바 높이만큼 툭 내려앉았다가 올라간다.
     * `keyboardLayoutGuide`가 바 아래를 옮기는 것도 같은 시간·곡선이라
     * 둘이 한 움직임으로 보인다.
     */
    private func setKb(_ on: Bool, _ n: Notification? = nil) {
        let info = n?.userInfo
        let dur = (info?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curve = (info?[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int) ?? 7
        let opts = UIView.AnimationOptions(rawValue: UInt(curve) << 16)

        /* **끝 자리를 먼저 셈한다**(14판). 바 윗변이 어디서 어디로 가는지가
           곧 목록이 움직일 거리다 — `report`와 같은 셈을 끝값으로 낸 것이라,
           둘이 어긋나면 그림을 걷을 때 튄다. 한쪽만 고치지 말 것. */
        let safe = superview?.safeAreaInsets.bottom ?? 0
        let rest = superview.map { $0.bounds.maxY - $0.safeAreaInsets.bottom } ?? 0
        var top = rest
        if on, let sv = superview,
           let end = info?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
            let f = sv.convert(end, from: nil)
            if f.minY < rest - 1 { top = f.minY }
        }
        let core = padV * 2 + fieldHeight()
        let toTop = (on ? top : rest) - core - (on ? 0 : tabH)
        // 움직이는 중이면 **그려진 자리**에서 출발한다(연달아 누른 경우).
        let moving = !(layer.animationKeys()?.isEmpty ?? true)
        let fromTop = (moving ? layer.presentation()?.frame.minY : nil) ?? frame.minY
        let chatH = (on ? top : rest) + (on ? 0 : safe)
        let pad = core + (on ? 0 : tabH + safe)
        /* 목록 그림을 들고 움직일 수 있으면 든다. 바가 아직 자리를 못 잡았거나
           (높이 0) 이 바의 키보드가 아니면 안 한다 — 그때는 13판 길이다. */
        let slide = bounds.height > 1 && kbOwner && superview != nil
            && (slider?.begin(from: fromTop, to: toTop, dur: dur, opts: opts) ?? false)

        /* **웹에 먼저 알린다 — 아래 `guard`보다 앞이다.** 아래 것은 바가
           비워 둘 자리(`tabH`)를 걷는 일이라 상태가 같으면 건너뛰어도 되지만,
           웹은 그 값과 상관없이 시각을 알아야 한다. */
        barDelegate?.composerKeyboard(on: on, dur: dur,
                                      at: Date().timeIntervalSince1970 * 1000,
                                      chatH: Double(chatH), pad: Double(pad),
                                      s: Double(fromTop - toTop), slide: slide)
        /* 그림을 들고 움직이는 동안은 프레임마다 안 알린다 — 웹이 그 값을
           적으면 그림 뒤에서 목록이 또 움직여, 걷을 때 자리가 어긋난다. */
        if !slide { follow(dur: dur, info: info) }

        guard kbUp != on else { return }
        kbUp = on
        invalidateIntrinsicContentSize()
        setNeedsLayout()
        guard let sv = superview else { return }
        sv.setNeedsLayout()

        // iOS 15 아래의 예비 길 — 키보드 높이만큼 바 아래를 올린다.
        if let c = bottomC {
            var rise: CGFloat = 0
            if on, let end = info?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                let f = sv.convert(end, from: nil)
                rise = max(0, sv.bounds.maxY - f.minY - sv.safeAreaInsets.bottom)
            }
            c.constant = -rise
        }

        UIView.animate(withDuration: dur, delay: 0, options: [opts, .beginFromCurrentState],
                       animations: { sv.layoutIfNeeded() },
                       completion: { _ in
            /* 다 움직인 뒤 **어디에 섰는지** 한 번 더 알린다(진단값 —
               `tellHeight` 주석). 높이가 그대로면 평소엔 안 보내는 것이라
               여기서는 억지로 보낸다. */
            self.tellHeight(force: true)
        })
    }

    // ── 그려지는 자리 따라가기 ────────────────────────────────

    private var link: CADisplayLink?
    private var followUntil: CFTimeInterval = 0
    /// 키보드 윗변(superview 기준). 올라오는 알림에서 잡아 둔다.
    private var kbTop: CGFloat = 0
    /// 키보드가 없을 때 바 아랫변(안전 영역 위).
    private var restBottom: CGFloat = 0

    /**
     * **키보드가 움직이는 동안 바가 실제로 그려지는 자리를 프레임마다 웹에
     * 알린다.** 웹은 그 값을 그대로 화면 높이로 쓴다(`Chat.tsx`의 `kbFrame`).
     *
     * 왜 이렇게까지 하는가 — 웹이 iOS의 곡선을 **흉내 내는 길은 끝까지 안
     * 맞았다.** 시간(0.25초라고 알고 있었는데 실기기는 0.383초를 알려 왔다)과
     * 곡선(`cubic-bezier`로 옮긴 것)을 아무리 맞춰도 실기기에서는 `늦다`가
     * 남았다(사용자 제보 두 번). 바는 iOS가 키보드와 한 움직임으로 옮기므로
     * **바의 실제 자리가 곧 키보드의 실제 자리**다 — 그걸 그대로 읽어 주면
     * 곡선을 알 필요가 없다. 한 번 건너가는 데 10ms쯤이라(실기기에서 쟀다)
     * 한 프레임 안이다.
     *
     * `layer.presentation()`이 **지금 화면에 그려진 값**이다(`frame`은 이미
     * 목표값이다). `p`는 웹이 홈 인디케이터 몫(34px)을 그 비율로 섞으려고
     * 준다 — 키보드가 내려가 있을 때만 그 자리가 화면 안에 있다.
     */
    private func follow(dur: Double, info: [AnyHashable: Any]?) {
        guard let sv = superview else { return }
        restBottom = sv.bounds.maxY - sv.safeAreaInsets.bottom
        if let end = info?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
            let f = sv.convert(end, from: nil)
            if f.minY < restBottom - 1 { kbTop = f.minY }     // 올라오는 것
        }
        followUntil = CACurrentMediaTime() + dur + 0.05
        if link == nil {
            let l = CADisplayLink(target: self, selector: #selector(tick))
            l.add(to: .main, forMode: .common)
            link = l
        }
    }

    @objc private func tick() {
        let done = CACurrentMediaTime() >= followUntil
        report(end: done)
        if done { link?.invalidate(); link = nil }
    }

    /**
     * **지금 이 순간 바가 그려지는 자리를 웹에 알린다.**
     *
     * 움직이는 동안에는 `CADisplayLink`가 프레임마다, 그 밖에는 자리가
     * 잡힐 때마다(`layoutSubviews`) 부른다 — **웹이 이 값 말고 다른 셈을
     * 쓰지 않게 하려는 것이다.** 값을 적는 곳이 둘이 되면 서로 엇갈려
     * 목록이 흔들린다(실기기 진단 — `--composer`가 116과 150을 오가며
     * 목록이 618↔652로 뛰었다).
     */
    private func report(end: Bool) {
        guard let sv = superview else { return }
        restBottom = sv.bounds.maxY - sv.safeAreaInsets.bottom
        // 움직이는 중에는 **그려진 값**을, 아니면 제자리 값을 쓴다.
        let f = (link != nil && !end ? layer.presentation()?.frame : nil) ?? frame
        let span = max(1, restBottom - kbTop)
        var p = min(1, max(0, (restBottom - f.maxY) / span))
        if link == nil || end { p = kbUp ? 1 : 0 }   // 안 움직일 땐 상태가 곧 답이다
        /* **웹이 쓸 두 값을 자리(`maxY`) 하나에서 셈한다.** 바의 그려지는
           높이(`f.height`)를 함께 보냈더니 실기기에서 목록이 넘쳤다 돌아왔다
           (사용자 제보 — `내려갔다가 다시 올라와`): 자리는 iOS가 키보드와
           함께 옮기는데 높이(탭바 자리를 되붙이는 것)는 우리 애니메이션이라
           **둘이 같은 곡선이 아니다.** 자리에서 비율(`p`)을 내고 그 비율로
           탭바 몫과 홈 인디케이터 몫을 섞으면 둘 다 한 곡선을 탄다.
           - `chatH` = 대화 화면 높이 = 바 아랫변 + 홈 인디케이터 몫 × (1−p)
           - `pad`   = 입력칸 아래 여백 = 바 알맹이 + (탭바 + 홈 인디케이터) × (1−p) */
        let safe = superview?.safeAreaInsets.bottom ?? 0
        let core = padV * 2 + fieldHeight()
        let chatH = f.maxY + safe * (1 - p)
        let pad = core + (tabH + safe) * (1 - p)
        barDelegate?.composerFrame(bottom: Double(f.maxY), h: Double(f.height),
                                   p: Double(p), end: end,
                                   chatH: Double(chatH), pad: Double(pad))
    }

    /**
     * 지금 값을 **억지로 한 번 알린다.** 세운 직후에 부른다.
     *
     * `tellHeight`는 높이가 바뀔 때만 보내는데, 바를 살려 두고 다시 쓰면
     * (6판) 높이가 지난번과 같아 **아무 말도 안 하게 된다** — 웹은 그것을
     * '바가 안 섰다'로 보고 1.5초 뒤 되돌린다(`watchdog`). 그래서 여기서
     * 한 번 못을 박는다.
     */
    func announce() {
        tellHeight(force: true)
        report(end: true)
    }

    /// `CADisplayLink`는 대상을 붙들고 있어 **떼어 낼 때 끊어야** 바가 해제된다.
    /// 들고 있던 목록 그림도 같이 걷는다 — 바 없이 그림만 남으면 안 된다.
    override func willMove(toSuperview newSuperview: UIView?) {
        super.willMove(toSuperview: newSuperview)
        if newSuperview == nil { link?.invalidate(); link = nil; slider?.cancel() }
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
        /* 자리가 잡힐 때마다 알린다 — 움직이는 동안이 아니어도 웹은 이
           값 하나만 쓴다(`report` 주석). 움직이는 중이면 `tick`이 이미
           프레임마다 보내고 있으므로 건너뛴다. */
        if link == nil { report(end: true) }
    }

    /// 높이가 바뀌면 웹에 알린다 — 웹이 그만큼 자리를 비워야
    /// 목록이 바 밑으로 숨지 않는다(`--composer`).
    private func tellHeight(force: Bool = false) {
        let h = bounds.height
        guard h > 1, force || abs(h - toldHeight) > 0.5 else { return }
        toldHeight = h
        let y = superview.map { $0.convert(frame.origin, to: nil).y } ?? -1
        barDelegate?.composerResized(Double(h), y: Double(y),
                                     fr: textView.isFirstResponder, kb: kbUp)
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
        kbOwner = true
        refreshHint()
        refreshSend()
        barDelegate?.composerFocus(true)
        tellHeight(force: true)     // 초점이 온 순간의 자리(진단값)
    }

    /**
     * **잠깐 초점을 붙들어 둔다 — 놓지 않는 것이 되찾는 것보다 낫다.**
     *
     * 아이폰은 **손을 떼는 순간 웹뷰가 first responder를 도로 가져간다.**
     * 웹 칸을 누른 것이 아니어도 그렇고, 웹의 `preventDefault`로도 못 막는다.
     * 그래서 댓글 칸을 누르면 키보드가 올라오다 뺏겨 내려갔다가, 우리가
     * 다시 잡아 또 올라왔다 — **오르락내리락하는 그 자국이 이것이다**
     * (실기기 제보 — `키보드가 나오다 중간에 다시 내려갔다가 다시 올라와`).
     *
     * 뺏긴 뒤에 되찾으면 그 오르내림이 그대로 보이므로, 아예 **놓지 않는다.**
     * `false`를 돌려주면 iOS가 first responder를 못 뗀다. 붙드는 것은
     * 초점을 준 직후 잠깐뿐이고(`NativeComposerPlugin.grabFocus`), 그 뒤는
     * 사람이 내리는 것이라 그대로 놓아 준다.
     *
     * **우리가 내릴 때도 먼저 풀어야 한다** — `blur`·`detach`가 그렇게 한다.
     */
    var holdFocus = false

    func textViewShouldEndEditing(_ tv: UITextView) -> Bool {
        return !holdFocus
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
