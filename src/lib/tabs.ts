import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * 탭 사이를 **밀어서 옮긴다**(사용자 요청 — `메뉴간 스와이프기능 만들어줘`).
 *
 * ── **한 번 걷어냈다가 되살린 기능이다. 그 까닭을 알고 있을 것** ──────
 *
 * 예전에도 있었는데 **아이폰에서 좌우가 다르게 느껴진다**는 제보로 뺐었다.
 * 원인은 우리 코드가 아니었다 — 코드는 양쪽이 대칭인데, **사파리는 왼쪽
 * 가장자리에서 미는 '뒤로 가기'에만 제 애니메이션을 붙여 준다.** 그 한
 * 방향만 부드러워 나머지가 더 도드라졌다.
 *
 * **앱(Capacitor)에는 그 뒤로 가기 손짓이 없다.** 그래서 이번에는 좌우가
 * 정말로 대칭이고, 예전에 뺐던 이유가 사라졌다. 웹에서도 같이 돌지만
 * 거기서는 예전의 그 어긋남이 남아 있다 — **되살릴지 다시 물을 일이
 * 생기면 이 문단을 볼 것.**
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

/** 탭바와 **같은 순서여야 한다**(`components/TabBar.tsx`). 한쪽만 고치지 말 것. */
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

export function useTabSwipe(): void {
    const nav = useNavigate();
    const { pathname } = useLocation();
    const at = TAB_PATHS.indexOf(pathname);

    useEffect(() => {
        // 탭 화면에서만 돈다 — 상세 화면에서는 뒤로 가기가 그 자리를 맡는다.
        if (at < 0) return;

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
            if (Math.abs(dx) < MIN_X || Math.abs(dx) < Math.abs(dy) * SLOPE) return;
            const to = at + (dx < 0 ? 1 : -1);
            if (to < 0 || to >= TAB_PATHS.length) return;
            nav(TAB_PATHS[to]);
        };

        /* **`preventDefault`를 부르지 않는다** — 세로 스크롤을 막으면 안 되고,
           그래서 `passive`로 붙여 브라우저가 굴리는 일을 안 기다리게 한다. */
        document.addEventListener('touchstart', start, { passive: true });
        document.addEventListener('touchend', end, { passive: true });
        return () => {
            document.removeEventListener('touchstart', start);
            document.removeEventListener('touchend', end);
        };
    }, [at, nav]);
}

/**
 * 탭이 바뀌면 새 화면이 **옮겨 온 쪽에서 미끄러져 들어온다**
 * (사용자 요청 — `메뉴이동시 부드럽게 이동될수있게`).
 *
 * **`transform`과 `opacity`만 움직이고 한 번 돌고 끝난다** — 늘 켜져 있는
 * 그리기 비용이 안드로이드에서 화면을 끊기게 한다는 규칙 그대로다.
 * 화면을 통째로 감싸는 칸을 새로 만들지 않았다 — `.app`이 flex 기둥이라
 * 사이에 무엇을 끼우면 `.page`의 `flex: 1`이 어긋난다. 대신 `.app`에
 * 방향을 적어 두고 **첫 자식**(=지금 화면)만 CSS가 움직인다.
 */
export function useTabSlide(ref: RefObject<HTMLElement | null>): void {
    const { pathname } = useLocation();
    const prev = useRef(pathname);

    useLayoutEffect(() => {
        const from = TAB_PATHS.indexOf(prev.current);
        const to = TAB_PATHS.indexOf(pathname);
        prev.current = pathname;

        const el = ref.current;
        if (!el || from < 0 || to < 0 || from === to) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const cls = to > from ? 'slide-l' : 'slide-r';
        el.classList.remove('slide-l', 'slide-r');
        void el.offsetWidth;   // 같은 방향으로 잇따라 옮길 때 다시 돌게 한다
        el.classList.add(cls);
        const off = window.setTimeout(() => el.classList.remove(cls), 260);
        return () => window.clearTimeout(off);
    }, [pathname, ref]);
}
