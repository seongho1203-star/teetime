import { useRef, useState, type TouchEvent as RTouchEvent } from 'react';
import { GIFT_URL, ROLE_LABEL, ROLE_TAG, personLabel, type Person } from '../lib/types';
import { httpsUrl } from '../lib/image';
import './ProfileFull.css';

/* ── 전체화면 프로필 ────────────────────────────────────────────
 *
 * 손가락을 얼마나 내리면 닫히는가. **튕김도 함께 본다** — 짧게 톡
 * 내리치는 손짓이 여기 안 닿으면 `안 닫히네` 하고 다시 끌게 된다.
 * 값은 뒤로 가기 손짓(`lib/tabs.ts`)과 같은 결로 골랐다.
 */
const SHEET_CLOSE = 120;     // 이만큼 내리면 닫는다
const SHEET_FLICK = 0.6;     // px/ms — 이보다 빠르면 거리가 짧아도 닫는다
/** 튕김으로 닫히는 최소 거리. **이보다 짧은 것은 손이 떨린 것으로 본다** —
 *  손끝이 조금만 미끄러져도 닫히면 사진을 들여다볼 수가 없다. */
const SHEET_FLICK_MIN = 40;
const SHEET_FADE = 420;      // 이만큼 내려가면 바탕이 다 걷힌다

/**
 * **쓰는 곳이 둘이다 — 웹 대화의 얼굴과 회원 명단의 얼굴**(사용자 요청 —
 * `회원 명단에서 프로필을 누르면 채팅에서 프로필 눌렀을 때 뜨는 것처럼`).
 * 그래서 `Chat.tsx`에서 떼어 여기 두었다. **두 벌로 만들지 말 것.**
 * 명단에서는 `onMention`을 안 넘기므로 `@언급하기`·`🎁 선물하기`가 안 선다
 * (부를 대화가 그 자리에 없다).
 *
 * **전체화면 프로필**(사용자 요청 — `프로필 누르면 사진처럼 전체화면이
 * 나오고 뒤로가기처럼 아래로 내리면 사라지게해줘` · 카톡 사진을 받아 맞췄다).
 *
 * 예전에는 아래에서 올라오는 작은 카드(`.chat-card`)였다. 100명 모임에서
 * 얼굴을 누르는 까닭은 **`83/신성호/광산구`만 보고는 누군지 안 떠올라서**라,
 * 사진이 작게 뜨면 그 물음에 답이 안 된다. **되돌리지 말 것.**
 *
 * 규칙 다섯 — 넷은 이미 앱 안에 있던 것을 그대로 따른 것이다:
 * - **아래로 끌면 손가락을 따라온다**(뒤로 가기 손짓과 같은 결).
 *   `SHEET_CLOSE`를 넘기거나 튕기면 닫히고, 아니면 제자리로 돌아온다.
 *   **위로 끄는 것은 1/3만 따라간다** — 갈 데가 없으니 벽에 닿은 느낌만 준다.
 * - **자리를 state에 안 넣는다.** 손가락을 따라 매 프레임 다시 그리면
 *   느린 폰에서 그대로 끊긴다 — `PhotoZoom`·답장 밀기와 같은 자리라
 *   요소에 직접 적는다(`el.style.transform`).
 * - **`transform`과 `opacity`만 움직인다.** `filter`·`blur`은 안 쓴다.
 * - **분홍을 안 쓴다** — 이 화면에서 '지금 눌러야 할 것'은 보내기 단추
 *   하나다. 검은 바탕 위 흰 알약으로, 크게 본 사진의 단추와 같은 값이다.
 * - **`✕`는 왼쪽 위다**(카톡과 같다). 크게 본 사진의 `✕`는 오른쪽인데,
 *   그건 사진 위에 얹힌 것이고 이건 화면을 통째로 차지하는 창이다.
 *
 * **이 창도 `overlayUp`에 든다** — `card`가 곧 그 값이라 네이티브 바와
 * 앱 목록이 함께 감춰진다(웹의 `z-index`로는 앱 부품을 못 덮는다).
 */
export function ProfileFull({ p, attend, onMention, onClose }: {
    p: Person;
    attend: number | null;
    onMention?: () => void;
    onClose: () => void;
}) {
    const backRef = useRef<HTMLDivElement | null>(null);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    /** 손짓 한 판. state로 두면 매 프레임 화면이 다시 그려진다. */
    const drag = useRef({ y0: 0, t0: 0, dy: 0, live: false, done: false });
    /* 사진을 못 받아 오면 글자로 되돌린다(`Avatar`의 `bad`와 같은 결 —
       참·거짓이 아니라 그 주소를 담는다). */
    const [bad, setBad] = useState<string | null>(null);

    const src = p.avatar_url ? httpsUrl(p.avatar_url) : null;
    const photo = src && src !== bad ? src : null;
    const label = (p.name || '').trim();

    /** 손끝을 따라 옮긴다. **읽지 않고 적기만 한다** — 배치를 다시 잡게 하면 끊긴다. */
    const paint = (dy: number, smooth = false) => {
        const s = sheetRef.current, b = backRef.current;
        if (s) {
            s.style.transition = smooth ? 'transform 0.18s ease-out' : 'none';
            s.style.transform = dy ? `translateY(${dy}px)` : '';
        }
        if (b) {
            b.style.transition = smooth ? 'opacity 0.18s ease-out' : 'none';
            b.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / SHEET_FADE));
        }
    };

    const start = (e: RTouchEvent) => {
        if (e.touches.length !== 1 || drag.current.done) return;
        drag.current = { y0: e.touches[0].clientY, t0: Date.now(), dy: 0, live: true, done: false };
    };
    const move = (e: RTouchEvent) => {
        const d = drag.current;
        if (!d.live || e.touches.length !== 1) return;
        const raw = e.touches[0].clientY - d.y0;
        /* 위로는 갈 데가 없다 — 1/3만 따라가 벽에 닿은 느낌만 준다. */
        d.dy = raw > 0 ? raw : raw / 3;
        paint(d.dy);
    };
    const end = () => {
        const d = drag.current;
        if (!d.live) return;
        d.live = false;
        const ms = Math.max(1, Date.now() - d.t0);
        const fast = d.dy / ms > SHEET_FLICK;
        if (d.dy > SHEET_CLOSE || (d.dy > SHEET_FLICK_MIN && fast)) {
            /* **닫는 동안에도 손짓을 안 받는다**(`done`) — 내려가는 중에 또
               잡으면 반쯤 내려간 자리에서 멈춘다. */
            d.done = true;
            paint(window.innerHeight, true);
            window.setTimeout(onClose, 170);
            return;
        }
        paint(0, true);
    };

    return (
        <div className="profile-full"
             onTouchStart={start} onTouchMove={move}
             onTouchEnd={end} onTouchCancel={end}>
            <div className="profile-full-back" ref={backRef} />
            <div className="profile-full-sheet" ref={sheetRef}>
                {photo
                    ? <img className="profile-full-photo" src={photo} alt={label}
                           onError={() => setBad(photo)} />
                    /* 사진이 없으면 얼굴에 쓰는 그 글자를 크게 놓는다
                       (`Avatar`와 같은 값 — 마지막 두 글자다). */
                    : <div className="profile-full-photo blank" aria-label={label}>
                          {label ? label.slice(-2) : '?'}
                      </div>}
                {/* 글자가 사진 위에서 읽히게 위아래만 어둡게 깐다. 사진이
                    어떤 것이 올지 모르므로 이 두 겹이 없으면 이름이 묻힌다. */}
                <div className="profile-full-scrim" aria-hidden="true" />
                <button className="profile-full-x" aria-label="닫기" onClick={onClose}>✕</button>
                <div className="profile-full-info">
                    <div className="profile-full-name">{personLabel(p)}</div>
                    <div className="profile-full-sub">
                        {ROLE_TAG[p.role] && (
                            <span className={`role-tag ${ROLE_TAG[p.role]}`}>
                                {ROLE_LABEL[p.role]}
                            </span>
                        )}
                        {attend !== null && <span className="profile-full-n">올해 {attend}회</span>}
                    </div>
                    {/* **남의 프로필에만 둘이 선다.** 내 얼굴에는 `@언급하기`가
                        없고(나를 부를 일이 없다) 나에게 선물할 일도 없다.
                        **`@언급하기`가 먼저다** — 이 화면에서 늘 하던 일이 그쪽이다. */}
                    {onMention && (
                        <div className="profile-full-acts">
                            <button className="profile-full-btn mention"
                                    onClick={onMention}>@언급하기</button>
                            {/* **우리가 선물을 보내는 것이 아니라 카카오 페이지를
                                여는 것뿐이다**(`GIFT_URL`의 설명 참고). 주소 하나를
                                여는 지름길이라 정산의 `토스로 보내기`와 같은 짜임이고,
                                **새 탭으로 연다** — 같은 창으로 나가면 홈 화면 앱에는
                                돌아올 길이 없다(대화 글 안의 주소와 같은 잣대다). */}
                            <a className="profile-full-btn gift" href={GIFT_URL}
                               target="_blank" rel="noreferrer">🎁 선물하기</a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
