import UIKit

/**
 * 축하하는 말이 오가면 **폭죽 단추**가 뜨고, 누르면 화면에 폭죽이 터진다
 * (사용자 요청 — `채팅창에 ㅊㅋ,축하,ㅊㅋㅊㅋ,추카 문구를 입력하고
 * 전송을하면 메시지입력창 윗쪽에 카톡처럼 폭죽버튼이 나오고 그걸 누르면
 * 카톡처럼 화면에 폭죽이 나오는 기능`).
 *
 * **웹(`src/lib/cheer.ts` · `src/components/Fireworks.tsx`)과 한 벌이다.**
 * 말 목록도 떠 있는 시간도 같은 값이라 **한쪽만 고치지 말 것** — 웹으로
 * 보는 사람과 앱으로 보는 사람이 같은 자리에서 같은 단추를 봐야 한다.
 *
 * **보낸 사람만이 아니라 방에 있는 모두에게 뜬다**(카톡이 그렇다).
 * **터지는 것은 누른 사람의 화면뿐이다** — 남의 화면을 우리가 건드리지 않는다.
 *
 * **글에 아무것도 저장하지 않는다.** `@언급`·링크와 같은 결이라 그릴 때
 * 글자를 보고 가리고, 그래서 **예전 글에도 그대로 먹는다**(붙여넣을 SQL도,
 * 새 칸도 없다).
 */
enum ChatCheer {
    /**
     * 이 말이 들어 있으면 축하다 — **사용자가 적어 준 넷 그대로다.**
     * `ㅊㅋㅊㅋ`는 `ㅊㅋ`에 이미 걸리므로 따로 안 적는다(`추카추카`·
     * `축하합니다`도 같은 까닭으로 저절로 걸린다).
     *
     * **함부로 늘리지 말 것** — `ㅋㅋ`까지 넣으면 웃는 말마다 단추가 떠서
     * 정작 축하할 때 아무도 안 누른다. 웹 `lib/cheer.ts`의 `WORDS`와
     * **같은 목록이어야 한다.**
     */
    static let words = ["축하", "추카", "ㅊㅋ"]

    /**
     * 단추가 떠 있는 시간(초). **영영 두지 않는다** — 한참 뒤에 들어와
     * 어제 것으로 폭죽을 터뜨리면 무엇을 축하하는지 알 수가 없다.
     *
     * **10초다**(사용자 요청 — `폭죽터트리기 단추는 10초만 보이게해줘.
     * 채팅을 가리니까`). 웹 `CHEER_MS`와 **같은 값이어야 한다 — 한쪽만
     * 고치지 말 것.**
     */
    static let window: TimeInterval = 10

    /**
     * 이 글이 축하하는 말인가.
     *
     * **사진·이모티콘에 딸린 글도 본다** — 사진을 올리면서 `축하!`라고
     * 적는 것이 오히려 흔하다. **안내 줄(`system`)도 그대로 본다**:
     * 생일 축하 글이 그 갈래라 그 줄에서도 단추가 떠야 한다.
     */
    static func isCheer(_ body: String?) -> Bool {
        let t = (body ?? "").filter { !$0.isWhitespace }
        guard !t.isEmpty else { return false }
        return words.contains { t.contains($0) }
    }
}

/**
 * 입력칸 위에 뜨는 폭죽 단추.
 *
 * **분홍을 안 쓴다** — 이 화면에서 '지금 눌러야 할 것'은 보내기 단추
 * 하나다. 보라 목록 위에 서는 줄이라 날짜 칸과 같은 `chip` 바탕에 흰
 * 글자이고, 웹 `.cheer-btn`과 같은 값이다(44px · 알약 · 굵은 13px).
 *
 * **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다(투표
 * 결과 카드의 `🗳`에서 겪었다). 웹은 선 SVG, 여기는 SF Symbol이다.
 *
 * 바깥 칸의 바탕이 **대화 바탕색**인 것은 `MentionList`·`ReplyBox`와 같은
 * 까닭이다 — 안 깔면 화면 바탕(크림색)이 비쳐 판이 하나 더 깔린 것처럼
 * 보인다.
 */
final class CheerBar: UIView {
    /// 웹 `.cheer-btn`과 같은 값 — 44px, 좌우 10px, 입력칸까지 6px.
    private static let barH: CGFloat = 44
    private static let padSide: CGFloat = 10
    private static let gapBottom: CGFloat = 6

    var onTap: (() -> Void)?
    private let pill = UIControl()
    private let mark = UIImageView()
    private let label = UILabel()
    /// 알약을 가로질러 지나가는 빛 한 줄기 — 알약 안에서만 보인다(`masksToBounds`).
    private let shine = CAGradientLayer()
    /// 알약 둘레에서 톡톡 반짝이는 작은 별 넷.
    private var sparks: [UIImageView] = []
    /// 다음 배치 때 움직임을 시작하라는 표 — 알약 크기가 정해진 뒤에 걸어야 한다.
    private var wantsPlay = false

    /* **숨기면 움직임을 함께 걷는다** — 남겨 두면 다음에 뜰 때 도중부터 돈다. */
    override var isHidden: Bool {
        didSet { if isHidden { stopMotion() } }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isHidden = true
        backgroundColor = ChatSkin().bg
        pill.backgroundColor = ChatSkin().chip
        pill.layer.cornerRadius = CheerBar.barH / 2
        pill.layer.cornerCurve = .continuous
        pill.addTarget(self, action: #selector(tapped), for: .touchUpInside)
        mark.image = UIImage(systemName: "sparkles", withConfiguration:
            UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold))
        mark.tintColor = ChatSkin().on
        mark.contentMode = .scaleAspectFit
        mark.isUserInteractionEnabled = false
        label.text = "축하 폭죽 터뜨리기"
        label.font = .systemFont(ofSize: 13, weight: .heavy)
        label.textColor = ChatSkin().on
        label.isUserInteractionEnabled = false
        pill.accessibilityLabel = "축하 폭죽 터뜨리기"
        pill.accessibilityIdentifier = "native-chat-cheer"
        pill.isAccessibilityElement = true
        pill.layer.masksToBounds = true
        shine.colors = [UIColor(white: 1, alpha: 0).cgColor,
                        UIColor(white: 1, alpha: 0.38).cgColor,
                        UIColor(white: 1, alpha: 0).cgColor]
        shine.startPoint = CGPoint(x: 0, y: 0.5)
        shine.endPoint = CGPoint(x: 1, y: 0.5)
        shine.opacity = 0
        pill.layer.addSublayer(shine)
        addSubview(pill); pill.addSubview(mark); pill.addSubview(label)
        /* 별 색은 폭죽 불꽃과 같은 값이다(`CheerBurst.colors`) — 누르면 터질
           그것이 먼저 살짝 보이는 셈이다. 뜻이 있는 색 규칙에는 안 걸린다
           (불꽃과 같은 까닭 — 몇 초 반짝이고 사라지는 장식이다). */
        for i in 0..<4 {
            let v = UIImageView(image: UIImage(systemName: "sparkle", withConfiguration:
                UIImage.SymbolConfiguration(pointSize: i % 2 == 0 ? 11 : 8, weight: .bold)))
            v.tintColor = CheerBurst.colors[[1, 0, 5, 2][i]]
            v.contentMode = .center
            v.isUserInteractionEnabled = false
            v.alpha = 0
            sparks.append(v); addSubview(v)
        }
    }

    /**
     * 단추가 뜰 때 한 번 도는 움직임(사용자 요청 — `폭죽 버튼이 너무
     * 단순한데 움직이는 모션이있었으면 좋겠어`). 넷이 겹친다:
     *
     * 1. **통통 튀며 나타난다** — 작게 시작해 스프링으로 제 크기가 된다.
     * 2. **그림(✨)이 흔들리며 커졌다 작아진다** — 1.6초마다.
     * 3. **빛 한 줄기가 알약을 가로질러 지나간다** — 2.4초마다.
     * 4. **둘레에서 작은 별 넷이 차례로 톡톡 반짝인다.**
     *
     * **무한 반복은 쓰지 않는다** — 단추가 떠 있는 10초(`ChatCheer.window`)
     * 안에서 횟수를 정해 끝난다(늘 켜져 있는 그리기 비용 규칙). 움직이는
     * 것은 `transform`·`opacity`·자리뿐이다(`filter`·blur 없음).
     * 움직임을 줄여 달라고 해 둔 기기에서는 서서히 나타나기만 한다.
     */
    func play() {
        wantsPlay = true
        setNeedsLayout()
    }

    private func stopMotion() {
        wantsPlay = false
        pill.layer.removeAllAnimations(); mark.layer.removeAllAnimations()
        shine.removeAllAnimations(); shine.opacity = 0
        for v in sparks { v.layer.removeAllAnimations(); v.alpha = 0 }
    }

    private func startMotion() {
        stopMotion()
        let now = CACurrentMediaTime()
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0; fade.toValue = 1; fade.duration = 0.25
        pill.layer.add(fade, forKey: "fade")
        if UIAccessibility.isReduceMotionEnabled { return }

        // 1. 통통 튀며 나타난다.
        let pop = CASpringAnimation(keyPath: "transform.scale")
        pop.fromValue = 0.55; pop.toValue = 1
        pop.damping = 11; pop.stiffness = 220; pop.mass = 1
        pop.duration = pop.settlingDuration
        pill.layer.add(pop, forKey: "pop")

        // 2. 그림이 흔들리며 커졌다 작아진다.
        let wig = CAKeyframeAnimation(keyPath: "transform.rotation.z")
        wig.values = [0, -0.38, 0.34, -0.2, 0.1, 0]
        wig.duration = 0.7
        let grow = CAKeyframeAnimation(keyPath: "transform.scale")
        grow.values = [1, 1.4, 0.95, 1.08, 1]
        grow.duration = 0.7
        let icon = CAAnimationGroup()
        icon.animations = [wig, grow]
        icon.duration = 1.6; icon.repeatCount = 5
        icon.beginTime = now + 0.35
        mark.layer.add(icon, forKey: "wiggle")

        // 3. 빛 한 줄기가 지나간다.
        let w = pill.bounds.width, bandW: CGFloat = 56
        shine.frame = CGRect(x: -bandW, y: 0, width: bandW, height: pill.bounds.height)
        shine.opacity = 1
        let move = CABasicAnimation(keyPath: "position.x")
        move.fromValue = -bandW / 2; move.toValue = w + bandW / 2
        move.duration = 0.85
        move.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        let sweep = CAAnimationGroup()
        sweep.animations = [move]
        sweep.duration = 2.4; sweep.repeatCount = 3
        sweep.beginTime = now + 0.6
        shine.add(sweep, forKey: "sweep")

        // 4. 별 넷이 차례로 반짝인다.
        for (i, v) in sparks.enumerated() {
            let a = CAKeyframeAnimation(keyPath: "opacity")
            a.values = [0, 1, 0]; a.keyTimes = [0, 0.35, 1]; a.duration = 0.7
            let b = CAKeyframeAnimation(keyPath: "transform.scale")
            b.values = [0.2, 1.25, 0.4]; b.keyTimes = [0, 0.35, 1]; b.duration = 0.7
            let c = CABasicAnimation(keyPath: "transform.rotation.z")
            c.fromValue = 0; c.toValue = i % 2 == 0 ? 1.2 : -1.2; c.duration = 0.7
            let g = CAAnimationGroup()
            g.animations = [a, b, c]
            g.duration = 1.8; g.repeatCount = 4
            g.beginTime = now + 0.3 + Double(i) * 0.22
            g.fillMode = .backwards
            /* 모델 값은 0으로 두어 돌지 않는 사이·끝난 뒤에는 안 보인다 —
               그림자만 켜 두면 네 번 돈 뒤 별이 제자리에 남는다. */
            v.layer.opacity = 0
            v.layer.add(g, forKey: "spark")
        }
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func tapped() { onTap?() }

    /* 스택 안에서는 **감추면 자리도 함께 없어진다** — 높이만 알려 주면 된다
       (`MentionList`가 제 높이를 제약으로 잡아 두는 것과 같은 결이다). */
    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: CheerBar.barH + CheerBar.gapBottom)
    }

    /* **알약은 글자만큼만 넓고 줄 가운데에 선다**(사용자 요청 — `폭죽단추
       좌우크기를 글씨크기만큼 줄여서 가운데에 뜨게해줘`). 예전에는 줄을
       통째로 채워 말풍선 한 줄을 가렸다. 웹 `.cheer-btn`의
       `align-self: center` + `padding: 0 18px`과 같은 값이다 —
       **한쪽만 고치지 말 것.** 좁은 화면에서 글자가 넘치지 않게 줄 안폭을
       넘지는 않는다. */
    override func layoutSubviews() {
        super.layoutSubviews()
        let gap: CGFloat = 7, icon: CGFloat = 17, inset: CGFloat = 18
        let textW = label.intrinsicContentSize.width
        let total = icon + gap + textW
        let room = max(0, bounds.width - CheerBar.padSide * 2)
        let pillW = min(room, total + inset * 2)
        pill.frame = CGRect(x: (bounds.width - pillW) / 2, y: 0,
                            width: pillW, height: CheerBar.barH)
        /* 그림과 글자를 한 덩어리로 가운데에 놓는다(웹의 `gap: 7px`). */
        let left = (pill.bounds.width - total) / 2
        mark.frame = CGRect(x: left, y: (CheerBar.barH - icon) / 2, width: icon, height: icon)
        label.frame = CGRect(x: left + icon + gap, y: 0, width: textW, height: CheerBar.barH)
        /* 별 넷은 알약 네 귀퉁이에 걸친다(왼위·오른위·왼아래·오른아래).
           줄 밖으로 조금 나가도 된다 — 스택이 자르지 않는다. */
        let p = pill.frame, sz: CGFloat = 16
        let spots = [CGPoint(x: p.minX + 6, y: p.minY + 2), CGPoint(x: p.maxX - 8, y: p.minY + 4),
                     CGPoint(x: p.minX + 14, y: p.maxY - 3), CGPoint(x: p.maxX - 2, y: p.maxY - 10)]
        for (v, c) in zip(sparks, spots) {
            v.bounds = CGRect(x: 0, y: 0, width: sz, height: sz); v.center = c
        }
        if wantsPlay && !isHidden && pill.bounds.width > 1 {
            wantsPlay = false
            startMotion()
        }
    }
}

/**
 * 화면 가득 터지는 폭죽 — 카톡의 그 축하 효과다.
 *
 * **`CAEmitterLayer` 하나로 그린다.** 조각마다 뷰를 만들면 수백 개가
 * 화면에 들어앉아 느린 폰에서 그대로 주저앉는다 — 이 앱이 무한 애니메이션과
 * blur을 걷어낸 그 자리와 같은 잣대다. 다 터지면 **스스로 걷힌다.**
 *
 * **아무것도 안 가로막는다**(`isUserInteractionEnabled = false`) — 축하가
 * 도는 동안에도 대화는 그대로 눌리고 굴러간다.
 *
 * **색은 뜻이 없다.** 이 앱의 색 규칙(분홍은 지금 눌러야 할 것, 잔디는 좋은
 * 상태…)은 **화면의 값**을 가르는 규칙이라, 2초 만에 사라지는 불꽃에는
 * 걸리지 않는다. `ChatSkin`으로 묶지 말 것 — 묶으면 다음에 그 값을 만질 때
 * 불꽃까지 따라 바뀐다. 웹 `Fireworks.tsx`의 `COLORS`와 같은 여섯이다.
 */
final class CheerBurst: UIView {
    private static let bursts = 5
    private static let gap: TimeInterval = 0.28
    private static let life: TimeInterval = 1.5
    static let colors: [UIColor] = [
        UIColor(red: 1, green: 0x4e / 255, blue: 0x8a / 255, alpha: 1),
        UIColor(red: 1, green: 0xd2 / 255, blue: 0x3f / 255, alpha: 1),
        UIColor(red: 0x4a / 255, green: 0xd6 / 255, blue: 0x6d / 255, alpha: 1),
        UIColor(red: 0x6c / 255, green: 0x5c / 255, blue: 0xe7 / 255, alpha: 1),
        UIColor(red: 1, green: 0x9f / 255, blue: 0x1c / 255, alpha: 1),
        .white,
    ]

    private var done = false
    private var onDone: (() -> Void)?

    /**
     * 화면을 덮고 터뜨린다. 다 끝나면 스스로 걷히고 `onDone`을 한 번 부른다.
     *
     * **`over`의 자식으로 붙인다** — 대화 화면 위에 얹혀야 말풍선·입력칸을
     * 다 덮는다. 웹의 `z-index: 1100`과 같은 자리다.
     */
    static func fire(over host: UIView, onDone: (() -> Void)? = nil) {
        let burst = CheerBurst(frame: host.bounds)
        burst.onDone = onDone
        burst.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        burst.isUserInteractionEnabled = false
        burst.backgroundColor = .clear
        host.addSubview(burst)
        host.bringSubviewToFront(burst)
        burst.start()
    }

    private func start() {
        /* **움직임을 줄여 달라고 해 둔 기기에서는 한 번만 터뜨린다.**
           사람이 눌러서 보는 것이라 아예 안 보여 주면 누른 뜻이 없어지므로,
           없애는 대신 짧게 끝낸다(뒤로 가기 효과가 갈래를 나누는 것과 같다). */
        let count = UIAccessibility.isReduceMotionEnabled ? 1 : CheerBurst.bursts
        for i in 0..<count {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * CheerBurst.gap) {
                [weak self] in self?.boom()
            }
        }
        /* **rAF 대신 타이머 하나로 끝낸다.** 걷는 일을 그리기에만 매달면
           앱을 덮어 둔 사이에 그림이 화면에 그대로 남는다(뒤로 가기 그림을
           걷을 때 겪은 그 자리다). */
        let all = Double(count - 1) * CheerBurst.gap + CheerBurst.life + 0.4
        DispatchQueue.main.asyncAfter(deadline: .now() + all) { [weak self] in self?.finish() }
    }

    private func boom() {
        guard bounds.width > 0, bounds.height > 0 else { return }
        /* 터지는 자리는 **화면 위쪽 절반**에 흩는다 — 아래쪽은 입력칸과
           탭바 자리라 거기서 터지면 반이 가린다(웹과 같은 범위다). */
        let x = bounds.width * CGFloat.random(in: 0.18...0.82)
        let y = bounds.height * CGFloat.random(in: 0.16...0.50)
        let color = CheerBurst.colors.randomElement() ?? .white

        let emitter = CAEmitterLayer()
        emitter.emitterPosition = CGPoint(x: x, y: y)
        emitter.emitterShape = .point
        emitter.emitterMode = .outline
        emitter.birthRate = 1
        emitter.emitterCells = (0..<2).map { i in
            let cell = CAEmitterCell()
            /* 한 번에 한 색이면 밋밋해서 조각 몇은 딴 색으로 튄다(웹과 같다). */
            cell.color = (i == 0 ? color : CheerBurst.colors.randomElement() ?? color).cgColor
            cell.contents = CheerBurst.dot.cgImage
            cell.birthRate = i == 0 ? 90 : 26
            cell.lifetime = Float(CheerBurst.life)
            cell.velocity = 210
            cell.velocityRange = 110
            cell.emissionRange = .pi * 2
            cell.yAcceleration = 220                // 중력
            cell.scale = 0.28
            cell.scaleRange = 0.16
            cell.scaleSpeed = -0.1
            cell.alphaSpeed = -1 / Float(CheerBurst.life)
            cell.spin = 2
            cell.spinRange = 4
            return cell
        }
        layer.addSublayer(emitter)
        /* 한 번만 터뜨리고 문을 닫는다 — 안 닫으면 계속 뿜는다. */
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) { emitter.birthRate = 0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + CheerBurst.life + 0.3) {
            emitter.removeFromSuperlayer()
        }
    }

    /**
     * 조각 하나 — 작은 동그라미를 **한 번만** 그려 두고 다시 쓴다.
     * **흰색으로 그린다**: `CAEmitterCell.color`는 이 그림에 곱해지는
     * 값이라(흰색 × 색 = 그 색) 색을 여기 박으면 칠이 안 먹는다.
     */
    private static let dot: UIImage = {
        let size = CGSize(width: 14, height: 14)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor.white.setFill()
            ctx.cgContext.fillEllipse(in: CGRect(origin: .zero, size: size))
        }
    }()

    /// **한 번만 걷는다** — 두 번 부르면 `onDone`이 두 번 돈다.
    private func finish() {
        guard !done else { return }
        done = true
        removeFromSuperview()
        onDone?()
    }
}
