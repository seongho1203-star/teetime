import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { hasNativeChat } from './native-chat';

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
 *   - 글칸·고르는 칸 — 글자를 고르거나 값을 미는 자리다.
 *   - **가로로 굴러가는 것** — 이모티콘 서랍의 탭 줄, 종류 가리개 등.
 *     클래스로 적어 두면 새로 만든 곳을 빠뜨리므로 **실제로 넘치는지**를 본다.
 *   - 화면을 덮는 창 — 길게 누른 창·프로필 카드·확인창.
 */

/**
 * **'이 화면이 탭인가'를 가리는 데만 쓴다** — 탭 화면에서는 뒤로 갈 데가
 * 없으므로 미는 손짓도 안 받고 미끄러져 들어오지도 않는다.
 *
 * **`/chat`은 여기 없다**(사용자 요청 — `채팅에서 탭바없애고 오른쪽에서
 * 왼쪽으로 채팅화면이 나오고 뒤로가기처럼 나올수있게해줘`). 탭바에는
 * 그대로 `대화`가 있지만 그건 **들어가는 문**일 뿐이고, 들어간 뒤로는
 * 카톡의 대화방처럼 **뒤로 나오는 화면**이다 — 탭바가 감춰지고(`TabBar`),
 * 오른쪽에서 미끄러져 들어오며(`useScreenSlide`), `←`와 미는 손짓으로
 * 나온다. 그래서 **탭바의 다섯 줄과 이 목록은 이제 개수가 다르다.**
 */
export const TAB_PATHS = ['/', '/board', '/rounds', '/polls'];

/**
 * 손짓이 이미 임자가 있는 자리에서 시작했는가.
 *
 * **`.chat-row`는 여기 없다.** 한동안 넣어 두었는데, 그 줄이 대화 목록을
 * 통째로 덮고 있어 **대화방에서는 뒤로 가기 손짓이 아예 시작조차 못 했다**
 * (사용자 제보 — `손으로 우측으로 밀어도 뒤로가기가 안먹혀`). 대화가
 * 탭이던 때는 어차피 뒤로 갈 데가 없어 티가 안 났다.
 *
 * **둘은 방향이 달라 안 부딪힌다** — 답장은 **왼쪽으로** 그은 것만 걸리고
 * (`Bubble`의 `onTouchMove`가 `dx < 0`을 본다) 뒤로 가기는 **오른쪽으로**
 * 그어야 깨어난다(`gx >= WAKE`). 길게 누르기도 8px만 움직이면 스스로
 * 취소되므로 남는 자리가 없다. **되돌리지 말 것.**
 */
function taken(from: EventTarget | null): boolean {
    let el = from instanceof Element ? from : null;
    while (el && el !== document.body) {
        if (el.matches('input, textarea, select, [contenteditable]'
                     + ', .chat-menu, .sheet, .modal'  /* 덮는 창 */
                     + ', .photo-zoom'        /* 크게 본 사진 — 벌리고 끄는 자리 */
                     + ', .profile-full'      /* 전체화면 프로필 — 아래로 내려 닫는 자리 */
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
/**
 * 찍어 둔 화면 한 장.
 *
 * `scroll`은 창을 굴린 자리이고, **`list`는 대화 목록(`.chat-list`)을 굴린
 * 자리다** — `cloneNode`는 굴린 자리를 안 가져오므로 따로 적어 둔다. 안 적으면
 * 대화방 그림이 늘 **맨 위 글**부터 보인다.
 *
 * **`chat`은 앱이 떠 준 대화방 그림 한 장이다**(아래 `setChatShot`).
 * **`stub`은 그 그림마저 없을 때의 표다**(아래 `snap`) — 그림 자체는
 * **그 앞 화면**(대개 홈)이라, 그걸 뒤에 깔고 끌면 **엉뚱한 화면이 손을
 * 따라 나온다.** 그래서 `backIsChat()`이 그 표를 보고 끌기를 통째로 넘긴다.
 */
type Shot = {
    path: string; node: HTMLElement; scroll: number; list: number;
    stub?: true; chat?: true;
};
const shots: Shot[] = [];
const MAX_SHOTS = 6;   // 뒤로 여섯 번이면 넉넉하다

/** 지금 화면을 한 장 찍는다(위 `Shot`). */
function takeShot(el: HTMLElement): Shot {
    const list = el.querySelector<HTMLElement>('.chat-list');
    return {
        path: routeOf(location.href),
        node: el.cloneNode(true) as HTMLElement,
        scroll: window.scrollY,
        list: list?.scrollTop ?? 0,
    };
}

/**
 * 찍어 둔 그림을 화면에 깔 사본으로 만든다.
 *
 * 굴린 자리는 **붙인 뒤에** 잡아야 한다(`placeChatList`) — 아직 문서에
 * 없는 칸은 높이가 없어 `scrollTop`이 안 먹는다.
 */
function cloneShot(shot: Shot): { c: HTMLElement; list: HTMLElement | null } {
    const c = shot.node.cloneNode(true) as HTMLElement;
    /* 찍을 때 굴려 둔 자리까지 되살린다 — 안 그러면 앞 화면이
       늘 맨 위부터 보여 딴 화면처럼 느껴진다. */
    if (shot.scroll) c.style.marginTop = `${-shot.scroll}px`;
    return { c, list: c.querySelector<HTMLElement>('.chat-list') };
}

/** 그림 속 대화 목록을 **보던 자리**로 굴려 둔다. */
function placeChatList(list: HTMLElement, shot: Shot): void {
    list.scrollTop = shot.list;
}

/** **떠나는** 화면 그림(뒤로 갈 때 오른쪽으로 빠져나가는 그것).
 *  위 `shots`는 **뒤에 깔리는 앞 화면**이라 서로 다른 것이다. */
let exiting: Shot | null = null;
/** 그 그림을 찍은 시각. */
let exitAt = 0;
/** 그 그림이 너무 오래된 것이면 안 쓴다 — 지난주에 찍힌 것이 오늘 화면을
 *  덮으면 안 된다(알림의 `NAV_FRESH`와 같은 결이다). */
const EXIT_FRESH = 700;

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

/**
 * **앱이 떠 준 대화방 그림**(`data:image/jpeg;base64,…`).
 *
 * 앱이 그리는 대화방은 웹뷰 **위에 얹힌 앱 부품**이라 웹은 그 화면을 만들
 * 길이 아예 없다 — 그래서 카드를 눌러 나가는 그 순간 앱이 한 장 떠서
 * 함께 보내 준다(`NativeChatViewController.navigate`). 아래 `snap()`이
 * **한 번 쓰고 비운다.**
 */
let chatShot = '';
export function setChatShot(url: string): void { chatShot = url; }

/** 그 그림을 뒤에 깔 수 있는 화면 한 장으로 만든다. */
function chatPlate(): Shot | undefined {
    if (!chatShot) return undefined;
    const node = document.createElement('div');
    node.className = 'chat-plate';
    node.style.backgroundImage = `url("${chatShot}")`;
    return { path: routeOf(location.href), node, scroll: 0, list: 0, chat: true };
}

function snap(toPath: string) {
    /* 앱이 준 그림은 **이 한 번**을 위한 것이다 — 남겨 두면 다음에 엉뚱한
       자리에 깔린다. 아래 어느 갈래로 빠지든 여기서 비운다. */
    const plate = chatPlate();
    chatShot = '';
    /* **탭으로 가는 길은 안 찍는다** — 탭 화면에서는 뒤로 갈 데가 없어
       그 그림을 쓸 일이 아예 없다(찍는 값만 든다). */
    if (TAB_PATHS.includes(toPath)) return;
    /* **앱이 그리는 대화방은 찍어 봐야 스피너 한 장이다**(`NativeChat.tsx`는
       자리만 지킨다). 그대로 담으면 그 뒤로 뒤에 깔리는 앞 화면이 통째로
       **빈 흰 화면**이 된다 — 대화방에서 카드를 눌러 라운드로 들어갔다가
       끌어서 나올 때 실제로 그랬다.
       **그래서 앱이 나가는 그 순간 화면을 한 장 떠서 보내 준다**(`chatShot`).
       그것이 있으면 여느 화면과 똑같이 끌어서 뒤로 갈 수 있다(사용자 제보 —
       `채팅에서 공유된 라운드,투표버튼을 눌러서 들어갔다 되돌아오기할때
       손끌기가 안되네`).

       **못 받았을 때의 예비 길이 `stub`이다**(알림을 눌러 곧바로 나가는
       길처럼 앱을 안 거치는 자리가 있다). `shots`는 히스토리 깊이와 짝이라
       (`popstate`가 하나씩 꺼낸다) **한 자리도 비워 둘 수 없어**, 바로 앞
       그림을 한 번 더 담되 표를 붙인다 — 그 그림은 대화방이 아니라 **그 앞
       화면**(대개 홈)이라, 표가 없으면 라운드에서 끌어 뒤로 갈 때 **홈이
       손을 따라 나왔다가 대화방으로 바뀐다**(사용자 제보 — `뒤로 가기를
       하면 홈이 보였다가 채팅 화면으로 돌아와`). */
    const el = pageEl();
    const blank = hasNativeChat() && routeOf(location.href) === '/chat';
    const prev = shots[shots.length - 1];
    const shot: Shot | undefined = blank
        ? (plate ?? (prev && { ...prev, stub: true as const }))
        : el ? takeShot(el) : undefined;
    if (!shot) return;
    shots.push(shot);
    while (shots.length > MAX_SHOTS) shots.shift();
}

/**
 * **바로 뒤가 앱이 그리는 대화방인데 그 그림이 없는가**(위 `Shot.stub`).
 *
 * 그 자리에는 **대화방 그림이 없을 수 있다** — 웹 쪽에 남는 것이 자리를
 * 지키는 스피너 한 장뿐이라, 앱이 떠서 넘겨 준 것이 없으면 `snap()`이 그
 * 앞 화면을 대신 담아 둔다. 그때 뒤로 가는 그림을 웹이 그리면 **엉뚱한
 * 화면이 나온다**: 끌면 홈이 손을 따라 나오고, 놓으면 그 홈이 그대로 남아
 * 있다가 대화방으로 바뀐다. 그때의 전환은 **앱이 맡는다**
 * (`nativeChatPop` → `NativeChatPlugin.open`의 `pop`) — 웹은 끌지 않고
 * 곧바로 뒤로 간다.
 *
 * **그림을 받았으면(`Shot.chat`) 여느 화면과 똑같이 끈다** — 그 길을
 * 열려고 앱이 나가는 순간 한 장 떠서 보내 준다(위 `setChatShot`).
 */
export function backIsChat(): boolean {
    return shots[shots.length - 1]?.stub === true;
}

/** 지금 화면을 **떠나는 것**으로 찍어 둔다(위 `exiting`). */
function snapExit(): void {
    const el = pageEl();
    exiting = el ? takeShot(el) : null;
    exitAt = exiting ? Date.now() : 0;
}
/** 방금 찍은 떠나는 화면인가. */
function exitFresh(): boolean {
    return !!exiting && Date.now() - exitAt < EXIT_FRESH;
}

/* ── 남아 버린 앞 화면 그림을 걷는다 ──────────────────────────
 *
 * **깔아 둔 그림이 화면에 그대로 남는 일이 실제로 있었다**(사용자 제보 —
 * `뒤로가기하면서 오류가나더니 저렇게됐어` · 사진). 그러면 앱이 통째로
 * 죽은 것처럼 보인다 — 그림은 죽은 복사본이라 아무것도 안 눌린다.
 *
 * **걷는 일이 `requestAnimationFrame`에만 매달려 있으면 안 된다.** 아래
 * `end()`는 `setTimeout` → rAF 두 번으로 걷는데, **rAF는 앱을 덮어 두면
 * 아예 안 돈다** — 뒤로 가는 도중에 홈으로 나가면 그림이 영영 남는다.
 * 손짓 도중에 무엇이 던져져도 마찬가지다.
 *
 * 그래서 **누가 걷었는지와 무관하게 훑어 걷는 자리를 따로 둔다** —
 * 화면이 바뀔 때 · 앱으로 돌아올 때. 다만 **지금 돌고 있는 손짓까지
 * 걷어 버리면 안 되므로**(뒤로 가는 그 0.23초가 곧 화면 바뀌는 때다)
 * 깐 지 `GHOST_MAX`가 지난 것만 본다.
 */
const GHOST_MAX = 1500;
/** 마지막으로 그림을 깐 시각. 0이면 깔린 것이 없다. */
let ghostAt = 0;
/** 이동이 걷힐 때마다 하나씩 오른다 — 아직 안 돈 `nextFrames`를 가린다. */
let moveSeq = 0;

/** 깔거나 얹는 그림 전부. **새로 만들면 여기에 더할 것** — 하나라도
 *  빠지면 그것만 화면에 남아 앱이 죽은 것처럼 보인다. */
const GHOSTS = '.back-ghost, .exit-ghost, .exit-dim';
/** 화면을 옮기는 동안에만 붙는 표 전부. 위와 같은 이유로 한곳에 모아 둔다. */
const MOVING = ['back-drag', 'back-ease', 'screen-push', 'screen-pop', 'screen-ease'];

/** 끄는 동안에만 세로 굴리기를 막는다(아래 `block` 주석). */
function blockScroll(e: TouchEvent) { if (e.cancelable) e.preventDefault(); }

/**
 * 남은 그림·클래스·`transform`을 걷는다.
 * @param force 지금 막 깐 것까지 걷는다(손짓이 끝난 것이 확실할 때만).
 */
function sweepGhosts(force = false): void {
    /* **깔아 둔 채로 두는 그림은 훑기로 안 걷는다**(아래 `nativeChatEnter`) —
       앱이 대화 화면을 그리는 동안 웹뷰에 남아 있어야 하는 그림이다. */
    if (!force && heldGhost) return;
    if (!force && ghostAt && Date.now() - ghostAt < GHOST_MAX) return;
    const root = document.documentElement;
    const left = document.querySelectorAll(GHOSTS);
    if (!left.length && !MOVING.some(c => root.classList.contains(c))) return;
    for (const g of left) g.remove();
    heldGhost = null;
    popPlate = null;
    root.classList.remove(...MOVING);
    /* 걷었으면 아직 안 돈 `nextFrames`도 없던 일로 한다(위 `moveSeq`). */
    moveSeq++;
    document.removeEventListener('touchmove', blockScroll);
    const el = pageEl();
    if (el) { el.style.transform = ''; el.style.transition = ''; }
    ghostAt = 0;
}

let watched = false;
function watchGhosts() {
    if (watched || typeof window === 'undefined') return;
    watched = true;
    /* 앱으로 돌아왔을 때 — rAF가 안 돌아 못 걷은 것이 여기서 걸린다. */
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) sweepGhosts();
    });
    window.addEventListener('pageshow', () => sweepGhosts());
}
watchGhosts();

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
    window.addEventListener('popstate', () => {
        /* **떠나는 화면은 바로 지금 찍어야 한다.** 리액트가 목적지를 그리고
           나면 없어지는데, 뒤로 갈 때 오른쪽으로 빠져나가야 하는 것이
           바로 그 화면이다(`runPop`).
           **이 자리가 되는 까닭** — 우리 듣기는 이 파일을 불러오는 순간
           붙고 라우터 것은 화면을 그리며 붙으므로 **우리가 먼저 돈다.**
           그래서 여기서는 아직 떠나는 화면이 그대로 있다.
           손가락으로 끌어 가는 참이면 이미 손을 따라 내보냈으므로 안 찍는다. */
        if (!skipSlide) snapExit();
        /* 뒤로 갔으면 그 그림은 다 쓴 것이다. */
        shots.pop();
    });
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
/** **끌리는 것 없이** 갈 때의 잣대. 손끝만 스친 것으로 넘어가지 않게
 *  한다(끌기 쪽의 `TAKE`는 화면을 실제로 밀어 보며 정하는 값이라 더 크다). */
const PLAIN_TAKE = 60;

/**
 * 이 손짓을 **끌리는 것 없이** 처리할 것인가.
 *
 *  1. 움직임을 줄여 달라고 해 둔 기기.
 *  2. **네이티브 부품이 화면에 얹혀 있을 때**(`html.nc` — 앱의 글칸 바와,
 *     켜 두었다면 대화 목록). 그것들은 웹뷰 **위에 따로 얹힌 앱 부품**이라
 *     우리가 `transform`으로 화면을 밀어도 **따라오지 않는다** — 위쪽 절반만
 *     손을 따라가고 입력칸은 제자리에 남아 **찢어져 보인다.**
 *     (웹의 `z-index`로 앱 부품을 못 덮는 그 자리와 같은 까닭이다.)
 *  3. **뒤가 앱이 그리는 대화방인데 그 그림을 못 받았을 때**(`backIsChat()`).
 *     그때는 그 앞 화면(대개 홈)이 대신 담겨 있어 끌면 **홈이 손을 따라
 *     나온다.** 그 전환은 앱이 맡는다. (그림을 받았으면 여느 화면과
 *     똑같이 끈다 — 위 `setChatShot`.)
 *
 * **손짓이 시작될 때마다 본다.** `nc`는 대화가 열리고 바가 선 **뒤에**
 * 붙으므로, 효과가 걸리는 순간에 잡아 두면 늘 거짓이다
 * (`owns6()`에서 겪은 그 함정이다 — 판 번호를 값으로 잡지 말 것).
 */
function plainBack(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
        || document.documentElement.classList.contains('nc')
        || backIsChat();
}

/* ── 앱이 끌 때 웹이 하는 일 ────────────────────────────────
 *
 * **아이폰의 대화방은 앱이 통째로 그린다**(`screens/NativeChat.tsx` →
 * `NativeChatViewController`). 그 화면은 웹뷰 **위에 얹힌 앱 부품**이라
 * 웹이 `transform`으로 밀어도 안 따라오고, 반대로 **앱은 앞 화면을 만들
 * 길이 없다** — 그것은 떠날 때 찍어 둔 웹 DOM이기 때문이다(위 `shots`).
 *
 * 그래서 일을 나눈다: **끄는 것은 앱**(`ChatList.swift`의 `BackDrag`),
 * **뒤에 깔 앞 화면은 웹**. 아래 셋은 `useBackSwipe`가 하던 일에서
 * **손짓과 화면 밀기를 뺀 나머지**다. 값(`PARALLAX`·`DIM`·`TAKE`·`FLICK`)은
 * 앱 쪽에 같은 것이 적혀 있다 — **한쪽만 고치지 말 것.**
 *
 * (17~40판의 잡종을 걷어내면서 한 번 같이 지웠는데, 그러자 **대화방에서
 * 뒤로 끌 때 뒷배경이 아예 안 나왔다** — 앱이 끄는 동안 웹뷰에는 대화
 * 자리를 지키는 스피너 한 장뿐이기 때문이다. 사용자 제보 —
 * `뒤로 되돌아오기 할때 뒷배경이 안 나오거든`.)
 */

/** 앱이 끄는 동안 감춰 둔 지금 화면. */
let backPage: HTMLElement | null = null;
/** **대화방이 열려 있는 동안 웹뷰에 깔아 두는 앞 화면 그림**(아래 참고). */
let heldGhost: HTMLDivElement | null = null;
/** 라운드·투표에서 대화방으로 **돌아올 때** 잠깐 깔아 두는 떠나는 화면
 *  (아래 `nativeChatPop`). 앱이 그것을 찍어 오른쪽으로 내보낸다. */
let popPlate: HTMLDivElement | null = null;
/** **손가락으로 끌어서** 대화방으로 돌아왔는가(`useBackSwipe`의 `fromChat`).
 *  그때는 대화방 그림이 이미 제자리에 깔려 있으므로 `NativeChat.tsx`가
 *  들어올 때 아무것도 안 깔고, 앱이 화면을 세운 **뒤에** 갈아 끼운다. */
let chatDrag = false;
export function chatDragged(): boolean { const v = chatDrag; chatDrag = false; return v; }

/**
 * 앱이 대화 화면을 통째로 그리는 동안 **웹뷰에는 앞 화면 그림을 깔아 둔다.**
 *
 * 웹 쪽에 남는 것은 **자리를 지키는 스피너 한 장**뿐이라(`NativeChat.tsx`),
 * 그대로 두면 두 자리가 함께 어긋났다:
 *  1. **들어올 때** 그 빈 화면이 오른쪽에서 밀려 들어왔다(사용자 제보 —
 *     `채팅들어갈때 흰색뒷배경이 나오고 채팅창이 왼쪽으로 들어옴`).
 *  2. **끌어서 뒤로 갈 때** 앱이 웹뷰를 1/4만큼 내보내도 거기 드러날 것이
 *     없었다(`끌기할때 뒷배경 안보임`).
 *
 * 그래서 들어올 때 한 번 깔고 **나갈 때까지 그대로 둔다** — 끌기가 시작되면
 * 그 그림이 이미 제자리에 있다(`nativeBackStart`).
 *
 * **그 그림은 가만히 있는다 — 밀지도 어둡게 하지도 않는다**(사용자 요청 —
 * `대화버튼으로 진입시 뒷배경이 왼쪽으로 밀리고`). 한동안 아이폰의 그
 * 전환처럼 왼쪽으로 1/4만큼 밀며 어둡게 했는데, **탭바의 `대화`를 눌러
 * 들어가는 길이 이 화면의 거의 전부**라 그때마다 홈 화면이 한 번 밀렸다
 * 제자리로 돌아오는 것이 그대로 보였다. 지금은 대화 화면만 오른쪽에서
 * 들어온다. **`PARALLAX`·`DIM`을 여기에 다시 붙이지 말 것** — 그 둘은
 * 손가락으로 끌 때(`BackDrag`)와 돌아올 때(`nativeChatPop`) 몫이다.
 */
export function nativeChatEnter(): void {
    sweepGhosts(true);
    const shot = shots[shots.length - 1];
    if (!shot) return;              // 뒤에 깔 것이 없으면 아무것도 안 한다
    heldGhost = layGhost(shot).g;
    /* 깔자마자 **끌 준비가 된 자리**(제자리 · 막 없음)로 둔다. */
    restHeld();
}

/** 깔아 둔 그림을 **끌 준비가 된 자리**(제자리 · 막 없음)로 되돌린다. */
function restHeld(): void {
    const g = heldGhost;
    if (!g) return;
    g.style.transition = '';
    g.style.transform = 'translate3d(0,0,0)';
    const dim = g.querySelector<HTMLElement>('.back-ghost-dim');
    if (dim) { dim.style.transition = ''; dim.style.opacity = '0'; }
}

/**
 * **라운드·투표에서 대화방으로 돌아올 때** — 떠나는 화면을 웹뷰에 그대로
 * 깔아 둔다. 앱이 그 웹뷰를 찍어 오른쪽으로 내보내고 대화 화면은 왼쪽에서
 * 따라 들어온다(`NativeChatPlugin.open`의 `pop`).
 *
 * **웹이 내보낼 수는 없다** — 앱 대화 화면은 웹뷰의 자식이라 웹 DOM을
 * 통째로 덮는다(`.exit-ghost`가 z-index 900이어도 그 아래다). 그래서
 * 웹은 **떠나는 화면을 깔아 두기만** 하고 미는 것은 앱이 맡는다.
 *
 * @returns 깔았으면 true. 방금 찍어 둔 떠나는 화면이 없으면 false다.
 */
export function nativeChatPop(): boolean {
    if (!exitFresh() || !exiting) return false;
    sweepGhosts(true);
    const gx = document.createElement('div');
    gx.className = 'exit-ghost';
    const { c, list } = cloneShot(exiting);
    gx.appendChild(c);
    document.body.appendChild(gx);
    if (list) placeChatList(list, exiting);
    gx.style.transform = 'translate3d(0,0,0)';
    ghostAt = Date.now();
    popPlate = gx;
    return true;
}

/** 대화방을 떠난다 — 깔아 둔 그림을 걷는다.
 *
 *  **깔아 둔 것이 있을 때만 걷는다.** 이 뒷정리는 리액트의 보통 효과라
 *  `useScreenSlide`(배치 효과)보다 **나중에** 도는데, 그냥 훑어 걷으면
 *  대화방에서 라운드로 들어갈 때 **방금 깔아 둔 `runPush` 그림까지
 *  지워져** 화면이 아예 안 움직인다(`useBackSwipe`의 `clean()`이 그랬던
 *  그 자리다 — `끌던 것이 있을 때만 걷는다`). */
export function nativeChatLeave(): void {
    if (!heldGhost && !popPlate) return;
    heldGhost = null;
    popPlate = null;
    sweepGhosts(true);
}

/**
 * **뒤에 깔 앞 화면 그림이 있는가.** 없으면 앱이 끌지 않고 곧바로 넘어간다 —
 * 바탕만 깔고 끌면 **빈 화면이 손을 따라 나온다.**
 */
export function hasBackShot(): boolean {
    return shots.length > 0;
}

/** 앱이 끌기 시작했다 — 앞 화면을 깔고 지금 화면은 감춘다(앱이 찍어 둔
 *  그림이 그 자리를 대신한다). */
export function nativeBackStart(): boolean {
    /* **들어올 때 깔아 둔 그림이 이미 있다**(`nativeChatEnter`). 그것을
       제자리로 되돌려 쓰면 되고, 없을 때만 새로 깐다. */
    if (heldGhost) restHeld();
    else {
        const shot = shots[shots.length - 1];
        if (!shot) return false;
        sweepGhosts(true);
        layGhost(shot);
    }
    backPage = pageEl();
    if (backPage) backPage.style.visibility = 'hidden';
    return true;
}

/**
 * 앱이 놓았다. `go`면 넘어간 것이라 **여기서 뒤로 간다** — 앱이 그림을
 * 다 내보낸 뒤에 부르므로, 웹 `end()`가 230ms 기다렸다 `nav(-1)`을
 * 부르는 그 차례와 같다.
 *
 * **걷는 것은 목적지가 한 번 그려진 뒤다**(rAF 두 번 · 예비 타이머).
 * 먼저 걷으면 그 한 프레임에 옛 화면이 비친다.
 */
export function nativeBackEnd(go: boolean, nav: () => void): void {
    if (!go) {
        showBackPage();
        /* 제자리로 되돌아온 것이라 **깔아 둔 그림은 그대로 둔다** — 다음
           손짓에 또 필요하다(`nativeChatEnter`). */
        if (!heldGhost) sweepGhosts(true);
        return;
    }
    skipSlide = true;
    heldGhost = null;
    nav();
    const done = () => { showBackPage(); sweepGhosts(true); };
    requestAnimationFrame(() => requestAnimationFrame(done));
    window.setTimeout(done, 600);
}

/**
 * 감춰 둔 화면을 도로 내보인다.
 *
 * **잡아 둔 것과 지금 것을 둘 다 본다** — 리액트가 같은 자리의 DOM을 다시
 * 쓰는 일이 있어, 잡아 둔 것만 되돌리면 **새 화면이 안 보인 채로 굳는다.**
 */
function showBackPage(): void {
    for (const el of [backPage, pageEl()]) if (el) el.style.visibility = '';
    backPage = null;
}

/**
 * **뒤에 깔리는 앞 화면**을 만들어 body 맨 앞에 넣는다.
 * 찍어 둔 것이 없으면 바탕만 깐다.
 *
 * 손가락으로 끌 때(`useBackSwipe`)와 눌러서 들어갈 때(`runPush`)가
 * **같은 그림을 쓴다** — 두 벌로 두면 한쪽만 고치게 된다.
 */
function layGhost(shot: Shot | undefined): { g: HTMLDivElement; dim: HTMLDivElement } {
    const g = document.createElement('div');
    g.className = 'back-ghost';
    let list: HTMLElement | null = null;
    if (shot) {
        const made = cloneShot(shot);
        list = made.list;
        g.appendChild(made.c);
    }
    const dim = document.createElement('div');
    dim.className = 'back-ghost-dim';
    g.appendChild(dim);
    document.body.insertBefore(g, document.body.firstChild);
    /* 대화 목록은 **붙인 뒤에** 굴려야 먹는다(위 `cloneShot`). */
    if (shot && list) placeChatList(list, shot);
    ghostAt = Date.now();
    return { g, dim };
}

/**
 * 첫 자리를 한 번 그린 **뒤에** 끝자리로 옮긴다.
 *
 * **같은 프레임에 둘 다 적으면 브라우저가 처음과 끝을 하나로 합쳐
 * 아무것도 안 움직인다.** 프레임을 두 번 건너는 것은 리액트가 방금
 * 그린 화면이 한 번 자리를 잡게 두려는 것이다.
 */
function nextFrames(run: () => void): void {
    const mine = moveSeq;
    requestAnimationFrame(() => requestAnimationFrame(() => {
        /* **앞 것이 끝나기 전에 새 이동이 시작됐으면 그냥 돌아선다.**
           안 그러면 이미 걷어 낸 자리에 끝자리와 `screen-ease`만 남는다 —
           실제로 `표가 screen-ease 하나뿐`인 자국으로 나타났다. */
        if (moveSeq !== mine) return;
        run();
    }));
}

/**
 * **눌러서 들어갈 때** — 새 화면이 오른쪽 끝에서 통째로 들어오고,
 * 앞 화면은 뒤에서 `PARALLAX`만큼 따라 나가며 어두워진다.
 */
function runPush(el: HTMLElement, shot: Shot | undefined): void {
    const root = document.documentElement;
    const W = window.innerWidth || 1;
    const { g, dim } = layGhost(shot);
    root.classList.add('screen-push');
    el.style.transform = `translate3d(${W}px,0,0)`;
    g.style.transform = 'translate3d(0,0,0)';
    dim.style.opacity = '0';
    nextFrames(() => {
        root.classList.add('screen-ease');
        el.style.transform = 'translate3d(0,0,0)';
        g.style.transform = `translate3d(${-W * PARALLAX}px,0,0)`;
        dim.style.opacity = String(DIM);
    });
}

/**
 * **뒤로 갈 때** — 떠나는 화면이 위에 얹혀 오른쪽으로 빠져나가고,
 * 그 밑에서 목적지가 `PARALLAX` 자리에서 제자리로 돌아오며 밝아진다.
 * 손가락으로 끌어 뒤로 가는 것과 **같은 그림**이고, 손 대신 시간이 민다.
 */
function runPop(el: HTMLElement, shot: Shot): void {
    const root = document.documentElement;
    const W = window.innerWidth || 1;
    const dim = document.createElement('div');
    dim.className = 'exit-dim';
    dim.style.opacity = String(DIM);
    const gx = document.createElement('div');
    gx.className = 'exit-ghost';
    const { c, list } = cloneShot(shot);
    gx.appendChild(c);
    document.body.appendChild(dim);
    document.body.appendChild(gx);
    if (list) placeChatList(list, shot);
    ghostAt = Date.now();
    root.classList.add('screen-pop');
    el.style.transform = `translate3d(${-W * PARALLAX}px,0,0)`;
    gx.style.transform = 'translate3d(0,0,0)';
    nextFrames(() => {
        root.classList.add('screen-ease');
        el.style.transform = 'translate3d(0,0,0)';
        gx.style.transform = `translate3d(${W}px,0,0)`;
        dim.style.opacity = '0';
    });
}

export function useBackSwipe(): void {
    const nav = useNavigate();
    const { pathname } = useLocation();
    const onTab = TAB_PATHS.includes(pathname);

    useEffect(() => {
        // 탭 화면에서는 뒤로 갈 데가 없다.
        if (onTab) return;

        let x0 = 0, y0 = 0, dx = 0, vx = 0, lastX = 0, lastT = 0;
        let cand = false, live = false, plain = false, W = 1;
        /** 깔아 둔 그림이 **앱이 그리는 대화방**인가(`Shot.chat`) — 넘어가면
         *  걷지 않고 붙들어 둔다(아래 `end`). */
        let fromChat = false;
        let page: HTMLElement | null = null;
        let ghost: HTMLDivElement | null = null;
        let dim: HTMLDivElement | null = null;

        const paint = () => {
            const p = Math.max(0, Math.min(1, dx / W));
            if (page) page.style.transform = `translate3d(${dx}px,0,0)`;
            if (ghost) ghost.style.transform = `translate3d(${(p - 1) * W * PARALLAX}px,0,0)`;
            if (dim) dim.style.opacity = String(DIM * (1 - p));
        };

        /** 앞 화면을 뒤에 깐다(위 `layGhost` — 눌러서 들어갈 때와 같은 그림). */
        const build = () => {
            const shot = shots[shots.length - 1];
            fromChat = shot?.chat === true;
            const laid = layGhost(shot);
            ghost = laid.g;
            dim = laid.dim;
        };

        /**
         * 끄는 동안에만 **세로 굴리기를 막는다.**
         *
         * **늘 걸어 두지 말 것** — `passive: false`인 `touchmove`가 문서에
         * 붙어 있으면 브라우저가 굴릴 때마다 우리 코드를 먼저 기다린다.
         * 상세 화면마다 그 값을 무는 셈이라, 손짓이 우리 것으로 정해진
         * 뒤에 붙였다 끝나면 뗀다(늘 켜져 있는 값을 안 만든다는 규칙 그대로다).
         */
        const block = blockScroll;

        const clean = () => {
            document.removeEventListener('touchmove', block);
            document.documentElement.classList.remove('back-drag', 'back-ease');
            /* **붙들어 둔 그림은 여기서 안 걷는다**(아래 `end`의 `fromChat`) —
               앱이 대화 화면을 세울 때까지 그 자리를 지켜야 한다. */
            if (ghost && ghost !== heldGhost) ghost.remove();
            ghost = dim = null;
            ghostAt = 0;
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
            /* **앞 손짓이 안 끝난 채로 남아 있으면 먼저 걷는다.** iOS는
               시스템 손짓에 가로채이면 `touchend`를 아예 안 주기도 하는데,
               그때 여기서 `live`만 내려 버리면 **깔아 둔 그림을 놓아 버려**
               영영 화면에 남는다(그 다음 `build()`가 새 그림을 덮어쓴다). */
            if (live || ghost) clean();
            cand = live = false;
            if (e.touches.length !== 1 || taken(e.target)) return;
            x0 = lastX = e.touches[0].clientX;
            y0 = e.touches[0].clientY;
            lastT = e.timeStamp;
            /* **이 손짓 하나에 대해** 끌지 말지를 여기서 정한다(위 `plainBack`). */
            plain = plainBack();
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
                W = window.innerWidth || 1;
                live = true;
                /* **끌지 않는 판에서는 자리만 쫓는다** — 그림도 안 깔고
                   화면도 안 민다(위 `plainBack` 주석). */
                if (!plain) {
                    page = pageEl();
                    if (!page) { cand = false; live = false; return; }
                    document.documentElement.classList.add('back-drag');
                    /* 여기서부터는 우리 손짓이다 — 굴리는 것을 막는 듣기를
                       **이제** 붙인다(위 `block` 주석). */
                    document.addEventListener('touchmove', block, { passive: false });
                    build();
                }
            }
            dx = Math.max(0, gx);
            const dt = e.timeStamp - lastT;
            if (dt > 0) vx = (t.clientX - lastX) / dt;
            lastX = t.clientX; lastT = e.timeStamp;
            if (!plain) paint();
        };

        const end = () => {
            if (!cand) return;
            cand = false;
            if (!live) return;
            /* 손이 멈춘 채로 있었으면 빠르기는 없던 것으로 본다. */
            const still = performance.now() - lastT > STALE;
            const flick = !still && vx > FLICK && dx > FLICK_MIN;
            if (plain) {
                live = false;
                if (dx > PLAIN_TAKE || flick) nav(-1);
                return;
            }
            const go = dx > W * TAKE || flick;
            document.documentElement.classList.add('back-ease');
            dx = go ? W : 0;
            paint();
            const mine = ghost;
            window.setTimeout(() => {
                if (go) {
                    skipSlide = true;
                    /* **앱이 그리는 대화방으로 돌아가는 길이면 그림을 붙들어
                       둔다.** 여기서 걷으면 앱이 화면을 세우기까지 몇 프레임
                       동안 **그 뒤(대개 홈)가 비친다** — 지금 막 손으로
                       끌어다 놓은 대화방이 한 번 깜빡이는 꼴이다.
                       걷는 것은 `NativeChat.tsx`가 다 서고 나서 한다
                       (`chatDragged` → `nativeChatEnter`). */
                    if (fromChat && ghost) { chatDrag = true; heldGhost = ghost; }
                    nav(-1);
                }
                /* 새 화면이 한 번 그려진 **뒤에** 걷는다 — 바로 걷으면
                   그 한 프레임에 옛 화면이 비친다. */
                requestAnimationFrame(() => requestAnimationFrame(clean));
            }, 230);
            /* **rAF에만 매달지 않는다.** 앱을 덮어 두면 위의 rAF가 아예
               안 돌아 그림이 화면에 남는다(`setTimeout`은 그래도 돈다).
               같은 그림이 아직 붙어 있고 새 손짓도 없을 때만 걷는다. */
            window.setTimeout(() => {
                if (!live && mine && mine.isConnected) clean();
            }, 600);
        };

        /* 흔들림 없이 되돌아오게, 손짓이 끊기면 그대로 접는다. */
        const cancel = () => { if (live && !plain) { dx = 0; paint(); } clean(); cand = false; };

        /* **무엇이 던져져도 그림은 걷는다.** 손짓 도중에 오류가 나면
           깔아 둔 앞 화면이 그대로 남아 앱이 죽은 것처럼 보인다
           (사용자 제보 — `뒤로가기하면서 오류가나더니 저렇게됐어`). */
        const guard = (fn: (e: TouchEvent) => void) => (e: TouchEvent) => {
            try { fn(e); } catch { cand = false; clean(); }
        };
        const onStart = guard(start), onMove = guard(move);
        const onEnd = guard(end), onCancel = guard(cancel);

        document.addEventListener('touchstart', onStart, { passive: true });
        /* 알아채는 듣기는 **passive다** — 막는 일은 위 `block`이 맡는다. */
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onEnd, { passive: true });
        document.addEventListener('touchcancel', onCancel, { passive: true });
        return () => {
            document.removeEventListener('touchstart', onStart);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            document.removeEventListener('touchcancel', onCancel);
            /* **끌던 것이 있을 때만 걷는다.** 그냥 걷으면 `clean()`이
               지금 화면의 `transform`을 지우고 `ghostAt`을 0으로 되돌리는데,
               상세에서 탭으로 **뒤로 가는 순간**이 바로 이 뒷정리가 도는
               때라 — 방금 깔아 둔 '떠나는 화면'을 그 자리에서 날린다
               (아래 `sweepGhosts()`도 `ghostAt`이 0이 되어 따라 걷는다).
               **재서 잡은 자리다** — 떠나는 화면이 깔린 그 프레임에 지워져
               뒤로 가기가 통째로 안 움직였다. 위 `start()`가 같은 잣대를
               쓴다(`if (live || ghost)`). */
            if (live || ghost) clean();
        };
    }, [onTab, nav]);

    /* **화면이 바뀌면 남은 그림이 있는지 훑는다.** 위 효과의 뒷정리는
       `onTab`이 뒤집힐 때만 도므로, 상세에서 상세로 옮길 때는 안 돈다.
       `GHOST_MAX`가 지난 것만 걷으므로 **지금 돌고 있는 뒤로 가기는
       건드리지 않는다.** */
    useEffect(() => { sweepGhosts(); }, [pathname]);
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
 *
 * **아직 스피너뿐인 화면이면 내용이 온 뒤에 한 번 더 미끄러뜨린다**(아래
 * `SLIDE_WAIT`). 자료를 물어보는 화면은 첫 그림이 `.page.center-fill`
 * 하나뿐이라, 왕복이 길면 **스피너만 미끄러지고 정작 내용은 툭 나타난다** —
 * 헤드리스로 재서 잡은 자리다(왕복 350ms에서 창 300ms이 끝난 **399ms**에
 * 대화가 들어앉았다. 사용자 제보 — `우측에서 밀려오는게 아니고 화면이
 * 그냥 뜨고`).
 */
/** 스피너가 내용으로 바뀌기를 이만큼까지 기다린다. */
const SLIDE_WAIT = 3000;
/** 자료를 기다리는 동안의 화면 — 이것뿐이면 아직 '내용'이 아니다. */
const SPINNER = '.center-fill';
/**
 * 화면이 한 번 밀려 들어오는 데 걸리는 시간. **`global.css`의
 * `screen-in`·`screen-back`·`screen-ease` 셋과 같은 값이어야 한다** —
 * 한쪽만 고치면 앱 목록이 셈하는 '남은 시간'이 어긋나 머리말과 말풍선
 * 자리가 따로 끝난다(아래 `slideMark`).
 * **0.50초다**(사용자가 고른 값 — `0.5초로 느리게해줘`). 아이폰·카톡은
 * 0.35초인데 그보다 한 뜸 느긋한 쪽을 골랐다.
 */
const SCREEN_MS = 500;
/**
 * **대화방만 짧다**(사용자 제보 — `홈에서 채팅 눌러서 들어갈 때 오른쪽에서
 * 왼쪽으로 나오는 속도가 너무 느리고`).
 *
 * 웹 화면들은 리액트가 그리는 그 프레임에 곧바로 움직이기 시작하지만,
 * **앱 대화 화면은 다리를 한 번 건너간 뒤에야 선다** — 화면을 만들고
 * 붙이고 배치까지 하느라 `SCREEN_MS`에 그 값이 통째로 얹힌다. 그래서
 * 같은 0.5초를 줘도 대화방만 유독 느리게 느껴진다.
 * **`SCREEN_MS`를 함께 내리지 말 것** — 그쪽은 사용자가 고른 값이다.
 *
 * 330으로 두었다가 **사용자 요청으로 240까지 내렸다**(`조금 더 빨리
 * 들어오게 해줘`). **40 아래로는 내리지 말 것** — `slideLeft()`가 지나간
 * 시간을 빼고 남은 값을 넘기는데, 플러그인이 `slide > 40`일 때만 움직이므로
 * (`NativeChatPlugin.open`) 너무 낮추면 **그냥 툭 나타나는 판**이 생긴다.
 */
const CHAT_MS = 240;

/**
 * 마지막으로 화면을 미끄러뜨리기 시작한 때.
 *
 * **앱 목록(`ChatList.swift`)이 이 값을 보고 따라 들어온다.** 그 목록은
 * 웹뷰 **위에 얹힌 앱 부품**이라 웹의 `transform`을 안 따라오는데, 대화는
 * 그 목록이 화면의 거의 전부라 **머리말만 밀려 들어오고 말풍선 자리는
 * 그냥 나타났다**(사용자 제보 — `채팅창은 밀려서 들어오는 게 아니고 그냥
 * 바로 나타나`).
 *
 * **남은 시간만큼만 움직이게 하는 것이 이 값이 있는 까닭이다.** 앱 목록은
 * 웹 화면이 그려진 **뒤에** 서므로 늘 한두 프레임 늦는데, 40px을 제 시간
 * 그대로 돌면 머리말보다 늦게 끝나 두 단계로 보인다.
 */
export const slideMark = { at: 0, ms: SCREEN_MS };

/** 지금 도는 화면 움직임이 얼마나 남았나(ms). 안 돌고 있으면 0이다. */
export function slideLeft(): number {
    if (!slideMark.at) return 0;
    return Math.max(0, slideMark.ms - (Date.now() - slideMark.at));
}

export function useScreenSlide(ref: RefObject<HTMLElement | null>): void {
    const { pathname } = useLocation();
    const how = useNavigationType();      // PUSH(들어감) · POP(뒤로) · REPLACE
    const prev = useRef(pathname);

    useLayoutEffect(() => {
        const from = prev.current;
        const wasTab = TAB_PATHS.includes(from);
        const isTab = TAB_PATHS.includes(pathname);
        const same = from === pathname;
        prev.current = pathname;

        const el = ref.current;
        if (!el || same) return;
        /* **손가락으로 끌어 뒤로 온 참이면 아무것도 안 한다.** 이미 손을
           따라 끝까지 옮겨 놓은 화면을 여기서 또 미끄러뜨리면 두 번 움직인다. */
        if (skipSlide) { skipSlide = false; return; }
        // **탭 사이는 안 움직인다.**
        if (wasTab && isTab) return;
        /* **앱이 대화 화면을 그리는 판에서는 웹이 아무것도 안 민다.**
           여기 남아 있는 것은 자리를 지키는 스피너 한 장뿐이라, 밀어 봐야
           **빈 화면이 통째로 지나간다**(사용자 제보 — `채팅들어갈때
           흰색뒷배경이 나오고 채팅창이 왼쪽으로 들어옴`).
           들어올 때 앞 화면 그림을 까는 일은 `nativeChatEnter`가 맡고,
           밀려 들어오는 것은 앱 화면 쪽이다.
           **카드를 눌러 나가는 길(PUSH)은 그대로 둔다** — 그때 들어오는
           것은 진짜 웹 화면이다. */
        let fromChat = false;
        if (hasNativeChat()) {
            if (pathname === '/chat') { slideMark.at = Date.now(); slideMark.ms = CHAT_MS; return; }
            if (from === '/chat') {
                if (how === 'POP') return;
                /* **대화방에서 카드를 눌러 나가는 길은 통째로 안 민다.**
                   앱이 떠 준 그림이 있어도(`Shot.chat`) 그렇다 — 그 순간
                   **앱 대화 화면이 아직 걷히는 중**이고, 그것은 웹뷰 위에
                   얹힌 앱 부품이라 밀려 들어오는 웹 화면을 그대로 덮는다.
                   그림이 없을 때는 더욱 그렇다: 뒤에 깔리는 것이 대화방이
                   아니라 **그 앞 화면**이라 엉뚱한 화면이 지나간다.
                   대신 예전 40px짜리로 물러난다 — 뒤에 아무것도 안 깐다. */
                fromChat = true;
            }
        }
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const cls = how === 'POP' ? 'slide-back'   // 뒤로 — 왼쪽에서 들어온다
                                  : 'slide-in';    // 들어감 — 오른쪽에서 들어온다

        /* **화면을 통째로 밀 수 있는 자리인가.**
           들어갈 때는 뒤에 깔 앞 화면이 있어야 하고(`snap`은 탭으로 가는
           길을 안 찍는다), 뒤로 갈 때는 방금 찍어 둔 떠나는 화면이 있어야
           한다. 없으면 예전 40px짜리로 물러난다 — **바탕만 깔고 밀면
           빈 화면이 통째로 지나간다.** */
        const leaving = how === 'POP' && exitFresh() ? exiting : null;
        const entering = how !== 'POP' && !isTab && !fromChat ? shots[shots.length - 1] : undefined;
        const full = leaving !== null || entering !== undefined;

        let off = 0;
        let moving = false;
        const run = () => {
            window.clearTimeout(off);
            /* 앞 것이 아직 돌고 있으면 먼저 걷는다 — 그림이 겹쳐 쌓인다. */
            sweepGhosts(true);
            el.classList.remove('slide-in', 'slide-back');
            /* 앱 목록이 남은 시간만큼만 따라 들어온다(위 `slideMark`). */
            slideMark.at = Date.now();
            slideMark.ms = SCREEN_MS;
            moving = true;
            /* **미는 것은 `.app`이 아니라 그 안의 화면이다.** `el`은 `.app`이고
               40px짜리는 CSS가 `.app.slide-in > :first-child`로 한 단 들어가
               움직인다 — 여기서 `el`을 그대로 밀면 아무것도 안 움직인다
               (실제로 그렇게 짰다가 `가장 많이 밀린 값 0px`으로 잡았다). */
            const scr = pageEl();
            if (full && scr) {
                if (leaving) runPop(scr, leaving); else runPush(scr, entering);
                off = window.setTimeout(() => { moving = false; sweepGhosts(true); },
                                        SCREEN_MS + 80);
                return;
            }
            void el.offsetWidth;   // 같은 방향으로 잇따라 옮길 때 다시 돌게 한다
            el.classList.add(cls);
            /* **`SCREEN_MS`보다 넉넉히 뒤에 걷는다.** 딱 맞춰 걷으면 끝나기
               한 프레임 전에 클래스가 빠져 화면이 툭 튄다 — 시간을 늘릴 때
               여기 숫자를 못박아 두면 그대로 걸린다(실제로 300으로 박혀
               있었고 `SCREEN_MS`가 300이 되면서 딱 붙었다). */
            off = window.setTimeout(() => { moving = false; el.classList.remove(cls); },
                                    SCREEN_MS + 60);
        };
        run();

        /* **아직 스피너뿐이면 내용이 올 때 한 번 더 민다**(위 주석).
           다만 **움직이는 도중에 왔으면 그대로 둔다** — 리액트가 같은 칸을
           다시 쓰므로 돌고 있는 움직임이 새 내용을 그대로 싣고 간다(재서
           확인했다). 거기서 다시 돌리면 뒤로 튄다. */
        if (!el.firstElementChild?.matches(SPINNER)) {
            return () => window.clearTimeout(off);
        }

        let give = 0;
        const mo = new MutationObserver(() => {
            const kid = el.firstElementChild;
            if (!kid || kid.matches(SPINNER)) return;
            /* 내용이 왔다 — 관찰은 여기서 끝낸다. 대화가 그려진 뒤로는
               이 아래가 통째로 커지므로 **반드시 곧바로 끊는다.** */
            mo.disconnect();
            window.clearTimeout(give);
            if (moving) return;   // 아직 미끄러지는 중
            run();
        });
        mo.observe(el, { childList: true, subtree: true,
                         attributes: true, attributeFilter: ['class'] });
        give = window.setTimeout(() => mo.disconnect(), SLIDE_WAIT);

        return () => { window.clearTimeout(off); window.clearTimeout(give); mo.disconnect(); };
    }, [pathname, how, ref]);
}
