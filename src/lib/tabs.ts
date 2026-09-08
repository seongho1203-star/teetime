import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

/**
 * **오른쪽으로 밀면 뒤로 간다**(사용자 요청 — `내정보를 들어갔다가 왼쪽에서
 * 오른쪽으로 스와이프`). 아이폰의 그 손짓과 방향이 같다.
 *
 * ── **탭 사이를 미는 기능은 없다. 되살리지 말 것** ──────────────────
 *
 * 두 번 넣었다가 두 번 다 걷어냈다:
 *  1. 처음에는 **아이폰에서 좌우가 다르게 느껴진다**는 제보였다. 원인은 우리
 *     코드가 아니었다 — 코드는 대칭인데, **사파리는 왼쪽 가장자리에서 미는
 *     '뒤로 가기'에만 제 애니메이션을 붙여 준다.**
 *  2. 앱에는 그 손짓이 없어 대칭이 되므로 다시 넣었는데, 실기기에서 써 보고
 *     **사용자가 지웠다**(`탭바 슬라이딩은 삭제해줘. 뒤로가기는 놔두고`).
 *     탭을 옮기는 일은 탭바가 맡는다.
 *
 * 그래서 지금 미는 손짓은 **뒤로 가기 하나뿐**이고, 화면이 미끄러져 들어오는
 * 것도 **드나들 때만**이다(탭 사이는 안 움직인다).
 *
 * ── 무엇을 안 건드리는가 ─────────────────────────────────────
 *
 * 가로로 미는 손짓이 이미 임자가 있는 자리가 여럿이라, **그 위에서
 * 시작한 손짓은 통째로 넘긴다**(`taken`):
 *   - `.chat-row`  — 왼쪽으로 밀어 **답장**을 건다(대화 화면).
 *   - 글칸·고르는 칸 — 글자를 고르거나 값을 미는 자리다.
 *   - **가로로 굴러가는 것** — 이모티콘 서랍의 탭 줄, 종류 가리개 등.
 *     클래스로 적어 두면 새로 만든 곳을 빠뜨리므로 **실제로 넘치는지**를 본다.
 *   - 화면을 덮는 창 — 길게 누른 창·프로필 카드·확인창.
 */

/** 탭바와 **같은 순서여야 한다**(`components/TabBar.tsx`). 한쪽만 고치지 말 것.
 *  여기서는 **'이 화면이 탭인가'를 가리는 데만** 쓴다 — 탭 화면에서는
 *  뒤로 갈 데가 없으므로 미는 손짓을 안 받는다. */
export const TAB_PATHS = ['/', '/board', '/rounds', '/polls', '/chat'];

/** 손짓이 이미 임자가 있는 자리에서 시작했는가. */
function taken(from: EventTarget | null): boolean {
    let el = from instanceof Element ? from : null;
    while (el && el !== document.body) {
        if (el.matches('input, textarea, select, [contenteditable]'
                     + ', .chat-row'          /* 왼쪽으로 밀어 답장 */
                     + ', .chat-menu, .chat-card, .sheet, .modal'  /* 덮는 창 */
                     + ', .sticker-tray, .chat-hits'  /* 위에 얹힌 판 */
        )) return true;
        // 가로로 굴러갈 수 있는 줄이면 그쪽이 임자다.
        if (el.scrollWidth > el.clientWidth + 4) {
            const ox = getComputedStyle(el).overflowX;
            if (ox === 'auto' || ox === 'scroll') return true;
        }
        el = el.parentElement;
    }
    return false;
}

/** 가로로 이만큼은 그어야 넘긴다. 세로가 더 크면 굴리는 손짓이다. */
const MIN_X = 60;
const SLOPE = 1.6;

export function useBackSwipe(): void {
    const nav = useNavigate();
    const { pathname } = useLocation();
    const onTab = TAB_PATHS.includes(pathname);

    useEffect(() => {
        // 탭 화면에서는 뒤로 갈 데가 없다.
        if (onTab) return;

        let x0 = 0, y0 = 0, live = false;

        const start = (e: TouchEvent) => {
            if (e.touches.length !== 1 || taken(e.target)) { live = false; return; }
            x0 = e.touches[0].clientX;
            y0 = e.touches[0].clientY;
            live = true;
        };
        const end = (e: TouchEvent) => {
            if (!live) return;
            live = false;
            const t = e.changedTouches[0];
            if (!t) return;
            const dx = t.clientX - x0, dy = t.clientY - y0;
            // 오른쪽으로 그은 것만 받는다. 왼쪽은 앞으로 갈 데가 없다.
            if (dx < MIN_X || dx < Math.abs(dy) * SLOPE) return;
            nav(-1);
        };

        /* **`preventDefault`를 부르지 않는다** — 세로 스크롤을 막으면 안 되고,
           그래서 `passive`로 붙여 브라우저가 굴리는 일을 안 기다리게 한다. */
        document.addEventListener('touchstart', start, { passive: true });
        document.addEventListener('touchend', end, { passive: true });
        return () => {
            document.removeEventListener('touchstart', start);
            document.removeEventListener('touchend', end);
        };
    }, [onTab, nav]);
}

/**
 * 화면에 **들어가고 나올 때** 새 화면이 온 쪽에서 미끄러져 들어온다.
 *
 * **탭 사이는 안 움직인다**(사용자 요청 — 위 참고). 탭은 나란히 있는 것이라
 * 눌러서 곧바로 바뀌는 편이 낫다는 판단이다.
 *
 * **`transform`과 `opacity`만 움직이고 한 번 돌고 끝난다** — 늘 켜져 있는
 * 그리기 비용이 안드로이드에서 화면을 끊기게 한다는 규칙 그대로다.
 * 화면을 통째로 감싸는 칸을 새로 만들지 않았다 — `.app`이 flex 기둥이라
 * 사이에 무엇을 끼우면 `.page`의 `flex: 1`이 어긋난다. 대신 `.app`에
 * 방향을 적어 두고 **첫 자식**(=지금 화면)만 CSS가 움직인다.
 */
export function useScreenSlide(ref: RefObject<HTMLElement | null>): void {
    const { pathname } = useLocation();
    const how = useNavigationType();      // PUSH(들어감) · POP(뒤로) · REPLACE
    const prev = useRef(pathname);

    useLayoutEffect(() => {
        const wasTab = TAB_PATHS.includes(prev.current);
        const isTab = TAB_PATHS.includes(pathname);
        const same = prev.current === pathname;
        prev.current = pathname;

        const el = ref.current;
        if (!el || same) return;
        // **탭 사이는 안 움직인다.**
        if (wasTab && isTab) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const cls = how === 'POP' ? 'slide-back'   // 뒤로 — 왼쪽에서 들어온다
                                  : 'slide-in';    // 들어감 — 오른쪽에서 들어온다
        el.classList.remove('slide-in', 'slide-back');
        void el.offsetWidth;   // 같은 방향으로 잇따라 옮길 때 다시 돌게 한다
        el.classList.add(cls);
        const off = window.setTimeout(() => el.classList.remove(cls), 300);
        return () => window.clearTimeout(off);
    }, [pathname, how, ref]);
}
