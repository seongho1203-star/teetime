import UIKit

/*
 * **키보드가 오르내리는 동안 대화 목록의 '그림'을 앱이 들고 움직인다**(14판).
 *
 * 왜 — 사용자가 `카톡만큼 부드럽게`를 바라며 짚은 자리가 **키보드가
 * 오르내릴 때**였다. 13판까지는 바가 프레임마다 제 자리를 웹에 알리고
 * (`ComposerBar.follow`) 웹이 그때마다 목록 높이를 다시 배치했다. 그 길은
 * **한 프레임마다 다리를 한 번 건너고 목록을 한 번 다시 배치하는 일**이라,
 * 곡선을 아무리 맞춰도 프레임이 고르게 안 나온다 — 다리를 건너는 시간이
 * 들쭉날쭉하고, 웹은 그 신호가 닿은 뒤에야 그린다. 카톡의 목록은 네이티브
 * 뷰라 iOS가 키보드와 **한 움직임**으로 옮긴다.
 *
 * 그래서 이렇게 한다:
 *
 * 1. 키보드가 움직이기 **시작하는 그 순간**(`keyboardWillShow`) 웹뷰의
 *    지금 화면을 그대로 떠서(`snapshotView`, 즉시) 목록 자리에 얹는다.
 * 2. 웹에는 **끝값 하나만** 알린다(`kb` 신호의 `chatH`·`pad`·`s`). 웹은 그
 *    자리에서 **한 번만** 다시 배치하고 굴러간 자리를 `s`만큼 옮긴다 —
 *    그 일은 이 그림 뒤에서 벌어져 안 보인다.
 * 3. 그림을 키보드와 **같은 시간·같은 곡선**으로 밀어 올린다(`UIView.animate`
 *    에 알림의 `duration`·`curve`를 그대로 준다 — 바가 `setKb`에서 제
 *    자리를 옮기는 것과 같은 한 벌이다).
 * 4. 다 움직이면 그림을 걷는다. 그 밑의 웹은 이미 끝 자리에 그려져 있어
 *    **한 픽셀도 안 튄다** — 목록 아랫변이 바 윗변에 붙어 있고, 웹이 굴린
 *    자리를 딱 `s`만큼 옮겼기 때문이다.
 *
 * **내려갈 때는 한 가지가 더 있다.** 그림을 아래로 밀면 위쪽에 `s`만큼
 * 빈자리가 드러나는데 옛 그림에는 그 위 내용이 없다(화면 밖이었다). 그래서
 * 웹이 **다시 배치를 끝냈다고 알려 오면**(`settled`) 그때 **새 화면을 한 장
 * 더 떠서**(`afterScreenUpdates: true`) 그 자리에 갈아 끼운다 — 새 그림은
 * 위 내용까지 들어 있으므로 나머지 길은 그것이 간다. 갈아 끼우기 전
 * 몇 프레임은 위 빈자리를 목록 바탕색(`listBg`)으로 덮어 둔다.
 *
 * **안 하는 때** — 웹이 `slide: false`로 꺼 두었을 때(서랍을 여닫는 동안 ·
 * 검색 중 · 덮는 창), 바가 감춰졌을 때, 그림을 못 떴을 때, 움직일 거리가
 * 1px도 안 될 때. 그때는 `begin`이 false를 돌려주고 바는 13판처럼
 * 프레임마다 알리는 길로 간다(`ComposerBar.follow`). **웹도 그 답(`slide`)을
 * 보고 갈래를 고른다** — 한쪽만 바꾸면 화면이 두 번 움직인다.
 *
 * **웹이 `settled`를 영영 안 보내면**(옛 웹 · 오류) 시간이 다 된 뒤 1초 안에
 * 그림을 걷는다. 그림은 손짓을 안 받으므로(`isUserInteractionEnabled`)
 * 그 사이 눌러도 밑의 웹이 받는다.
 *
 * 헤드리스로는 확인할 수 없는 자리다(맥도 아이폰도 없다) — 그래서 **되물러남을
 * 먼저 만들어 두었다**: 여기가 어긋나도 `slide: false` 한 줄(웹)로 13판 길로
 * 돌아간다(`localStorage`의 `teetime:nc-slide` = `off`).
 */
final class ListSlider {

    /// 그림을 뜰 웹뷰와, 그림을 얹을 바탕(`bridge.viewController.view`).
    weak var webView: UIView?
    weak var root: UIView?
    /// 이 뷰 **바로 아래**에 얹는다 — 바가 그림 위에 서야 한다.
    weak var above: UIView?

    /// 웹이 켜 둔 동안만 한다(`attach`/`setState`의 `slide`).
    var enabled = false
    /// 목록이 시작하는 자리(웹뷰 기준 pt). 머리말·방 공지 아래다. 웹이 알려 준다.
    var listTop: CGFloat = 0
    /// 목록 바탕색. 내려갈 때 위에 잠깐 드러나는 자리를 이 색으로 덮는다.
    var listBg: UIColor = UIColor(red: 0x73 / 255, green: 0x69 / 255, blue: 0xa0 / 255, alpha: 1)

    private var box: UIView?        // 자르는 틀. 목록 자리에 고정.
    private var strip: UIView?      // 그 안에서 움직이는 판. 그림이 여기 든다.
    private var cap: UIView?        // 내려갈 때 위에 드러나는 자리를 덮는 바탕색
    private var seq = 0
    private var shift: CGFloat = 0  // 이번에 움직일 거리(양수면 위로 = 키보드 올라옴)
    private var acked = false
    private var ended = false
    private var endAt: CFTimeInterval = 0
    private var opts: UIView.AnimationOptions = []

    /**
     * 시작한다. `from`·`to`는 바 윗변(바탕 기준)의 지금 자리와 끝 자리다 —
     * 목록 아랫변이 곧 바 윗변이라 그 차이가 목록이 움직일 거리다.
     * 돌려주는 값이 false면 **하지 않는 것**이고, 부르는 쪽이 13판 길로 간다.
     */
    func begin(from: CGFloat, to: CGFloat, dur: Double, opts: UIView.AnimationOptions) -> Bool {
        cancel()
        guard enabled, let web = webView, let root = root, web.window != nil else { return false }
        if let above = above, above.isHidden { return false }
        let s = from - to
        guard abs(s) > 1 else { return false }

        let top = root.convert(CGPoint(x: 0, y: listTop), from: web).y
        let bottom = max(from, to)
        guard bottom - top > 2 else { return false }
        /* **떠지지 않으면 안 한다.** `snapshotView`는 창에 붙은 뷰에서만
           답하고, 웹뷰의 화면(다른 프로세스가 그린 겹판)도 그대로 담긴다 —
           `drawHierarchy`와 달리 비지 않는다. */
        guard let snap = web.snapshotView(afterScreenUpdates: false) else { return false }

        seq += 1
        let mine = seq
        shift = s
        acked = false
        ended = false
        self.opts = opts
        endAt = CACurrentMediaTime() + dur

        let box = UIView(frame: CGRect(x: 0, y: top, width: root.bounds.width, height: bottom - top))
        box.clipsToBounds = true
        box.isUserInteractionEnabled = false
        box.backgroundColor = .clear

        /* 내려갈 때만 — 그림이 아래로 밀리며 위에 드러나는 `|s|`만큼을
           바탕색으로 덮는다. 새 그림으로 갈아 끼우기 전 몇 프레임의 몫이다.
           올라갈 때는 드러나는 자리가 없다(위는 잘리고 아래는 바가 덮는다). */
        if s < 0 {
            let c = UIView(frame: CGRect(x: 0, y: 0, width: box.bounds.width, height: -s))
            c.backgroundColor = listBg
            box.addSubview(c)
            cap = c
        }

        let strip = UIView(frame: box.bounds)
        strip.backgroundColor = .clear
        box.addSubview(strip)

        /* **틀을 먼저 붙이고 그림 자리를 잰다** — 붙기 전의 뷰로 좌표를
           옮기면 값이 엉뚱하다(`convert`는 같은 창 안에서만 맞다). */
        if let above = above, above.superview === root {
            root.insertSubview(box, belowSubview: above)
        } else {
            root.addSubview(box)
        }
        // 그림을 **살아 있는 웹뷰와 같은 자리**에 놓는다. 틀이 목록 자리만 남긴다.
        snap.frame = web.convert(web.bounds, to: box)
        strip.addSubview(snap)
        self.box = box
        self.strip = strip

        UIView.animate(withDuration: dur, delay: 0, options: [opts, .beginFromCurrentState],
                       animations: { strip.transform = CGAffineTransform(translationX: 0, y: -s) },
                       completion: { _ in
            guard mine == self.seq else { return }
            self.ended = true
            self.finishIfReady()
        })
        // 웹이 끝내 안 알려 와도 그림이 남아 있으면 안 된다.
        DispatchQueue.main.asyncAfter(deadline: .now() + dur + 1.0) {
            if mine == self.seq { self.cancel() }
        }
        return true
    }

    /**
     * 웹이 다시 배치를 마쳤다. `dy`는 웹이 실제로 옮긴 굴림 거리다(위로 옮겼으면
     * 양수). 보통은 `shift`와 같다 — 내려갈 때 맨 위 가까이 있었으면 그만큼
     * 못 옮겨 작아지는데, 그때는 그림의 끝 자리를 그 값으로 바꾼다(끝에서
     * 튀지 않게).
     */
    func ack(dy: CGFloat) {
        guard let box = box, let strip = strip, let web = webView else { return }
        acked = true
        if shift < 0 {
            /* 내려가는 길 — 새 그림으로 갈아 끼운다. `afterScreenUpdates: true`라
               다음 화면 갱신(웹이 이미 보내 둔 새 화면이 든다)을 기다려 뜬다.
               새 그림은 살아 있는 웹과 같은 자리에서 시작해야 하므로, 옛
               그림이 밀린 만큼(`strip`)에서 웹이 옮긴 만큼(`dy`)을 되돌린
               자리에 놓는다 — 다 움직인 끝에서 둘이 겹쳐 0이 된다. */
            if let snap2 = web.snapshotView(afterScreenUpdates: true) {
                snap2.frame = web.convert(web.bounds, to: box)
                snap2.transform = CGAffineTransform(translationX: 0, y: dy)
                strip.subviews.forEach { $0.removeFromSuperview() }
                strip.addSubview(snap2)
                cap?.removeFromSuperview()
                cap = nil
            }
        }
        if abs(dy - shift) > 1 {
            /* 웹이 덜 옮겼다(내려갈 때 맨 위 가까이). 끝 자리를 그 값으로 —
               남은 시간에 같은 곡선으로. 드문 일이라 곡선이 살짝 달라도 된다. */
            let left = max(0.05, endAt - CACurrentMediaTime())
            UIView.animate(withDuration: left, delay: 0, options: [opts, .beginFromCurrentState],
                           animations: { strip.transform = CGAffineTransform(translationX: 0, y: -dy) },
                           completion: nil)
        }
        finishIfReady()
    }

    /// 그림을 걷는 것은 **움직임이 끝나고 웹도 다 그린 뒤**다. 둘 중 하나만
    /// 되어 있으면 아직이다 — 먼저 걷으면 옛 화면이 한 프레임 비친다.
    private func finishIfReady() {
        guard ended, acked else { return }
        cancel()
    }

    /// 그림을 걷는다. 도중에 새 움직임이 시작해도 먼저 부른다.
    func cancel() {
        seq += 1
        box?.removeFromSuperview()
        box = nil
        strip = nil
        cap = nil
        acked = false
        ended = false
    }
}
