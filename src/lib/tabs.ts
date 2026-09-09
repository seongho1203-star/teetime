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
                     + ', .photo-zoom'        /* 크게 본 사진 — 벌리고 끄는 자리 */
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

/* ── 앞 화면을 찍어 둔다 ──────────────────────────────────────
 *
 * **손가락을 따라 뒤로 가려면 앞 화면이 뒤에 깔려 있어야 한다**(사용자 요청 —
 * `아이폰처럼 손가락따라가면서 뒤로가기`). 그런데 그 화면은 이미 없어진 뒤라,
 * **떠날 때 찍어 두는 수밖에 없다.**
 *
 * **앞 화면을 리액트로 한 번 더 그리는 길로 가지 말 것**(`<Routes location>`을
 * 하나 더 띄우는 그것이다). 화면이 통째로 다시 **살아나면서** 딸린 일까지
 * 다시 돈다 — 대화를 열면 읽음이 찍히고, 투표 목록은 결과 알리기를 부르고,
 * 실시간 구독이 두 벌이 된다. 그림만 필요한 자리에 그 위험을 질 이유가 없다.
 * **찍어 둔 것은 죽은 그림이라** 아무 일도 안 한다.
 *
 * **찍는 자리가 `pushState`인 까닭.** 리액트의 효과는 전부 DOM이 바뀐
 * **뒤에** 도는데, 그때는 앞 화면이 이미 사라지고 없다. `pushState`는
 * 리액트가 주소가 바뀐 걸 알아채기 **전에** 도는 유일한 자리다.
 * 원래 하던 일은 그대로 부르므로 라우터는 아무것도 모른다.
 */
type Shot = { path: string; node: HTMLElement; scroll: number };
const shots: Shot[] = [];
const MAX_SHOTS = 6;   // 뒤로 여섯 번이면 넉넉하다

/** 지금 화면(`.app`의 첫 자식)을 찾는다. */
function pageEl(): HTMLElement | null {
    return document.querySelector<HTMLElement>('.app > :first-child');
}

/**
 * 주소에서 **화면 경로**를 꺼낸다.
 *
 * **이 앱은 해시 라우팅이다**(`/#/rounds` — 그 까닭은 CLAUDE.md에 있다).
 * 그래서 `pathname`은 어느 화면에 있든 늘 `/`이고, 그것으로 가리면
 * **모든 길이 탭으로 보여 그림을 한 장도 안 찍는다**(실제로 그렇게 짰다가
 * 헤드리스에서 잡았다 — 앞 화면이 늘 빈 채로 깔렸다).
 */
function routeOf(href: string): string {
    try {
        const h = new URL(href, location.href).hash;
        return h.startsWith('#') ? (h.slice(1) || '/') : '/';
    } catch { return '/'; }
}

function snap(toPath: string) {
    /* **탭으로 가는 길은 안 찍는다** — 탭 화면에서는 뒤로 갈 데가 없어
       그 그림을 쓸 일이 아예 없다(찍는 값만 든다). */
    if (TAB_PATHS.includes(toPath)) return;
    const el = pageEl();
    if (!el) return;
    shots.push({ path: routeOf(location.href), node: el.cloneNode(true) as HTMLElement,
                 scroll: window.scrollY });
    while (shots.length > MAX_SHOTS) shots.shift();
}

let patched = false;
function watchHistory() {
    if (patched || typeof history === 'undefined') return;
    patched = true;
    const push = history.pushState.bind(history);
    history.pushState = function (data: unknown, title: string, url?: string | URL | null) {
        try {
            if (url != null) snap(routeOf(String(url)));
        } catch { /* 주소가 이상해도 넘어가는 것이 낫다 */ }
        return push(data as never, title, url);
    } as typeof history.pushState;
    /* 뒤로 갔으면 그 그림은 다 쓴 것이다. */
    window.addEventListener('popstate', () => { shots.pop(); });
}
watchHistory();

/** 손가락으로 끌어 뒤로 간 직후에는 화면이 또 미끄러지지 않게 한다. */
let skipSlide = false;

/** 이만큼 끌면 넘어간다(화면 폭의 몫). */
const TAKE = 0.34;
/** 짧게 튕겨도 넘어가는 빠르기(px/ms). 800px/s쯤 — 마음먹고 튕긴 것만
 *  걸리게 둔다. 낮추면 **천천히 끌다 놓은 것까지 넘어간다.** */
const FLICK = 0.8;
/** 튕김으로 볼 최소 거리. 이보다 짧은 것은 손 떨림에 가깝다. */
const FLICK_MIN = 40;
/** 마지막으로 움직인 지 이만큼 지났으면 **멈춘 것으로 본다.**
 *  안 그러면 끌다가 망설이고 놓았을 때 옛 빠르기가 그대로 남아 넘어간다. */
const STALE = 120;
/** 가로로 이만큼은 그어야 '뒤로 가려는 것'으로 본다. */
const WAKE = 12;
const SLOPE = 1.2;
/** 앞 화면이 뒤에서 따라 나오는 몫(아이폰의 그 어긋남). */
const PARALLAX = 0.25;
const DIM = 0.18;

export function useBackSwipe(): void {
    const nav = useNavigate();
    const { pathname } = useLocation();
    const onTab = TAB_PATHS.includes(pathname);

    useEffect(() => {
        // 탭 화면에서는 뒤로 갈 데가 없다.
        if (onTab) return;
        /* 움직임을 줄여 달라고 해 둔 기기에서는 끌리는 것 없이 곧바로
           간다 — 아래 효과가 그 몫을 맡는다. */
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        let x0 = 0, y0 = 0, dx = 0, vx = 0, lastX = 0, lastT = 0;
        let cand = false, live = false, W = 1;
        let page: HTMLElement | null = null;
        let ghost: HTMLDivElement | null = null;
        let dim: HTMLDivElement | null = null;

        const paint = () => {
            const p = Math.max(0, Math.min(1, dx / W));
            if (page) page.style.transform = `translate3d(${dx}px,0,0)`;
            if (ghost) ghost.style.transform = `translate3d(${(p - 1) * W * PARALLAX}px,0,0)`;
            if (dim) dim.style.opacity = String(DIM * (1 - p));
        };

        /** 앞 화면을 뒤에 깐다. 찍어 둔 것이 없으면 바탕만 깐다. */
        const build = () => {
            const g = document.createElement('div');
            g.className = 'back-ghost';
            const shot = shots[shots.length - 1];
            if (shot) {
                const c = shot.node.cloneNode(true) as HTMLElement;
                /* 찍을 때 굴려 둔 자리까지 되살린다 — 안 그러면 앞 화면이
                   늘 맨 위부터 보여 딴 화면처럼 느껴진다. */
                if (shot.scroll) c.style.marginTop = `${-shot.scroll}px`;
                g.appendChild(c);
            }
            const d = document.createElement('div');
            d.className = 'back-ghost-dim';
            g.appendChild(d);
            document.body.insertBefore(g, document.body.firstChild);
            ghost = g;
            dim = d;
        };

        /**
         * 끄는 동안에만 **세로 굴리기를 막는다.**
         *
         * **늘 걸어 두지 말 것** — `passive: false`인 `touchmove`가 문서에
         * 붙어 있으면 브라우저가 굴릴 때마다 우리 코드를 먼저 기다린다.
         * 상세 화면마다 그 값을 무는 셈이라, 손짓이 우리 것으로 정해진
         * 뒤에 붙였다 끝나면 뗀다(늘 켜져 있는 값을 안 만든다는 규칙 그대로다).
         */
        const block = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };

        const clean = () => {
            document.removeEventListener('touchmove', block);
            document.documentElement.classList.remove('back-drag', 'back-ease');
            ghost?.remove();
            ghost = dim = null;
            /* **지금 화면과 우리가 잡아 둔 것을 둘 다 지운다.** 리액트가
               같은 자리의 DOM을 다시 쓰는 일이 있어, 잡아 둔 것만 지우면
               새 화면에 옛 `transform`이 남는다. */
            for (const el of [page, pageEl()]) {
                if (el) { el.style.transform = ''; el.style.transition = ''; }
            }
            page = null;
            live = false;
        };

        const start = (e: TouchEvent) => {
            cand = live = false;
            if (e.touches.length !== 1 || taken(e.target)) return;
            x0 = lastX = e.touches[0].clientX;
            y0 = e.touches[0].clientY;
            lastT = e.timeStamp;
            cand = true;
        };

        const move = (e: TouchEvent) => {
            if (!cand || e.touches.length !== 1) return;
            const t = e.touches[0];
            const gx = t.clientX - x0, gy = t.clientY - y0;
            if (!live) {
                // 세로가 크면 굴리는 손짓이다 — 통째로 넘긴다.
                if (Math.abs(gy) > Math.abs(gx) && Math.abs(gy) > WAKE) { cand = false; return; }
                if (gx < WAKE || gx < Math.abs(gy) * SLOPE) return;
                page = pageEl();
                if (!page) { cand = false; return; }
                W = window.innerWidth || 1;
                document.documentElement.classList.add('back-drag');
                /* 여기서부터는 우리 손짓이다 — 굴리는 것을 막는 듣기를
                   **이제** 붙인다(위 `block` 주석). */
                document.addEventListener('touchmove', block, { passive: false });
                build();
                live = true;
            }
            dx = Math.max(0, gx);
            const dt = e.timeStamp - lastT;
            if (dt > 0) vx = (t.clientX - lastX) / dt;
            lastX = t.clientX; lastT = e.timeStamp;
            paint();
        };

        const end = () => {
            if (!cand) return;
            cand = false;
            if (!live) return;
            /* 손이 멈춘 채로 있었으면 빠르기는 없던 것으로 본다. */
            const still = performance.now() - lastT > STALE;
            const go = dx > W * TAKE
                    || (!still && vx > FLICK && dx > FLICK_MIN);
            document.documentElement.classList.add('back-ease');
            dx = go ? W : 0;
            paint();
            window.setTimeout(() => {
                if (go) { skipSlide = true; nav(-1); }
                /* 새 화면이 한 번 그려진 **뒤에** 걷는다 — 바로 걷으면
                   그 한 프레임에 옛 화면이 비친다. */
                requestAnimationFrame(() => requestAnimationFrame(clean));
            }, 230);
        };

        /* 흔들림 없이 되돌아오게, 손짓이 끊기면 그대로 접는다. */
        const cancel = () => { if (live) { dx = 0; paint(); } clean(); cand = false; };

        document.addEventListener('touchstart', start, { passive: true });
        /* 알아채는 듣기는 **passive다** — 막는 일은 위 `block`이 맡는다. */
        document.addEventListener('touchmove', move, { passive: true });
        document.addEventListener('touchend', end, { passive: true });
        document.addEventListener('touchcancel', cancel, { passive: true });
        return () => {
            document.removeEventListener('touchstart', start);
            document.removeEventListener('touchmove', move);
            document.removeEventListener('touchend', end);
            document.removeEventListener('touchcancel', cancel);
            clean();
        };
    }, [onTab, nav]);

    useEffect(() => {
        if (onTab) return;
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        let x0 = 0, y0 = 0, ok0 = false;
        const s = (e: TouchEvent) => {
            ok0 = e.touches.length === 1 && !taken(e.target);
            if (ok0) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }
        };
        const t = (e: TouchEvent) => {
            if (!ok0) return;
            ok0 = false;
            const c = e.changedTouches[0];
            if (c && c.clientX - x0 > 60 && c.clientX - x0 > Math.abs(c.clientY - y0) * 1.6) nav(-1);
        };
        document.addEventListener('touchstart', s, { passive: true });
        document.addEventListener('touchend', t, { passive: true });
        return () => {
            document.removeEventListener('touchstart', s);
            document.removeEventListener('touchend', t);
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
        /* **손가락으로 끌어 뒤로 온 참이면 아무것도 안 한다.** 이미 손을
           따라 끝까지 옮겨 놓은 화면을 여기서 또 미끄러뜨리면 두 번 움직인다. */
        if (skipSlide) { skipSlide = false; return; }
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
