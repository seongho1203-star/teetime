import { registerPlugin } from '@capacitor/core';
import { IS_NATIVE } from './native';

/*
 * **네이티브 글칸을 부르는 쪽.**
 *
 * 앱 안에서만 돌고, 없으면 아무 일도 안 한다 — 그때는 예전 웹 글칸이
 * 그대로 쓰인다. 이 되물러남이 이 파일의 절반이다:
 *
 * - **앱은 새로 만들어 깔기까지 시간이 걸리는데 웹은 밀면 바로 올라간다.**
 *   그래서 늘 `새 웹 + 옛 앱`인 사이가 생긴다. 플러그인이 없으면
 *   `ready()`가 던지고, 우리는 웹 글칸으로 돌아선다.
 * - **끄는 스위치가 웹에 있다**(`teetime:nc` = `off`). 실기기에서 무언가
 *   어긋나도 앱을 다시 만들지 않고 되돌릴 수 있어야 한다.
 *
 * **모양과 크기를 여기서 정하는 것도 같은 까닭이다.** 네이티브 쪽에는
 * 예비값만 있고 실제 값은 `skin()`이 넘긴다 — 손볼 일이 생기면 웹만 밀면 된다.
 */

export type ComposerAction = 'plus' | 'sticker';

type Handle = { remove: () => Promise<void> };

type Native = {
    /** `v`는 앱 쪽 판 번호다. 없으면 1판(`inputAccessoryView`로 세우던 판). */
    ready(): Promise<{ ok: boolean; v?: number }>;
    attach(o: Record<string, unknown>): Promise<void>;
    detach(): Promise<void>;
    setText(o: { text: string; sel?: number }): Promise<void>;
    getText(): Promise<{ text: string }>;
    setState(o: Record<string, unknown>): Promise<void>;
    focus(): Promise<void>;
    blur(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    /**
     * 사진을 고른다(8판부터). **`+`가 앱의 단추라 웹에는 누른 자리가 없어서**,
     * 웹의 `<input type="file">`을 쓰면 iOS가 고르는 창을 붙일 데를 못 찾고
     * 화면 아무 데나 띄웠다. 앱이 직접 띄우면 그 자리가 아예 없다.
     * `data`는 **이미 줄인 JPEG**의 base64다(`lib/image.ts`와 같은 값).
     */
    pickPhoto(): Promise<{ ok: boolean; data?: string; why?: string }>;
    /** 사진첩에 저장(8판부터). 웹에서는 `<a download>`가 앱 안에서 안 먹는다. */
    savePhoto(o: { url: string }): Promise<{ ok: boolean }>;
    /** 폰이 띄워 주는 공유창에 넘긴다(8판부터). */
    sharePhoto(o: { url: string }): Promise<{ ok: boolean }>;
    addListener(n: 'change', cb: (e: { text: string; sel: number }) => void): Promise<Handle>;
    addListener(n: 'send', cb: (e: { text: string }) => void): Promise<Handle>;
    addListener(n: 'action', cb: (e: { name: ComposerAction }) => void): Promise<Handle>;
    addListener(n: 'focus', cb: (e: { on: boolean }) => void): Promise<Handle>;
    /** `y`·`fr`·`kb`는 3판부터 — 바 윗변(화면 기준)·초점·키보드. 진단값이다. */
    addListener(n: 'height', cb: (e: { height: number; y?: number; fr?: boolean; kb?: boolean }) => void): Promise<Handle>;
    /**
     * 키보드가 오르내리기 **시작했다**(3판부터). `dur`는 iOS가 쓸 시간(초),
     * `at`은 네이티브가 보낸 시각(1970년부터 ms)이다.
     *
     * **`at`이 이 신호의 값이다.** 소식이 다리를 건너오느라 한두 프레임
     * 늦는데, 그만큼 늦게 시작해 놓고 0.25초를 다 쓰면 화면이 키보드보다
     * 늦게 도착한다. `Date.now()`와 견주면 늦은 만큼이 그대로 나온다.
     */
    addListener(n: 'kb', cb: (e: {
        on: boolean; dur: number; at: number;
        /**
         * 14판부터 — 다 움직인 뒤의 화면 높이·입력칸 여백(`chatH`·`pad`), 바
         * 윗변(=목록 아랫변)이 움직일 거리 `s`(위로가 양수), 그리고 **앱이 그
         * 사이 목록 그림을 들고 움직이는가**(`slide`). 참이면 웹은 끝값을 한
         * 번에 적고 굴린 자리를 `s`만큼 옮긴 뒤 `settled`로 알린다 — 프레임마다
         * 오는 `frame`은 그때 안 온다. 거짓이면 13판과 같다.
         */
        chatH?: number; pad?: number; s?: number; slide?: boolean;
    }) => void): Promise<Handle>;
    /**
     * 키보드 끝값대로 **다시 배치를 마쳤다**(14판). `dy`는 실제로 옮긴 굴림
     * 거리다(위로가 양수). 앱은 이걸 받아야 목록 그림을 걷고, 내려가는 길에서는
     * 새 그림으로 갈아 끼운다(`ListSlider.swift`).
     */
    settled(o: { dy: number }): Promise<void>;
    /**
     * 키보드가 움직이는 동안 **바가 실제로 그려지는 자리**(4판부터, 프레임마다).
     * `bottom`은 바 아랫변(= 키보드 윗변) · `h`는 바 높이 · `p`는 0(내려가
     * 있음)~1(다 올라옴) · `end`는 다 움직였다는 표시. 웹이 이 값을 그대로
     * 화면 높이로 쓴다 — 곡선을 흉내 내지 않는다(`ComposerBar.follow` 주석).
     */
    addListener(n: 'frame', cb: (e: {
        bottom: number; h: number; p: number; end: boolean;
        /** 5판부터 — 화면 높이와 입력칸 여백을 **자리 하나에서** 셈한 값.
            바의 그려지는 높이(`h`)는 자리와 곡선이 달라 따로 쓰면 목록이
            넘쳤다 돌아온다(`ComposerBar.tick` 주석). 있으면 이걸 쓴다. */
        chatH?: number; pad?: number;
    }) => void): Promise<Handle>;
};

export const NativeComposer = registerPlugin<Native>('NativeComposer');

const OFF_KEY = 'teetime:nc';

/**
 * **어디서 막혔는지 남겨 두는 자리.** `내 정보` 맨 아래에 한 줄로 적힌다.
 *
 * 여기서는 폰을 못 보므로, 안 될 때 물어볼 것이 없으면 짐작만 하게 된다 —
 * 실제로 첫판에서 **플러그인이 등록조차 안 된 것**을 이 줄이 없어 한 바퀴
 * 늦게 알았다. 셋이면 충분하다: 앱인가 · 플러그인이 있나 · 바가 섰나.
 */
export const ncLog = {
    native: IS_NATIVE,
    /** `ready()`가 답했나. null이면 아직 안 물어봤다. */
    ready: null as boolean | null,
    /** 바가 제 높이를 알려 왔나 — 화면에 실제로 섰다는 증거다. */
    stood: false,
    /** 앱 쪽 판 번호. 0이면 아직 모른다. */
    v: 0,
};

/** `내 정보` 아래에 적을 한 줄. 판 번호를 함께 적는다 — 새 앱을 깔았는지가
    폰에서는 이걸로만 갈린다. */
export function ncStatus(): string {
    const yn = (v: boolean | null) => (v === null ? '?' : v ? 'O' : 'X');
    const v = ncLog.v ? `(${ncLog.v}판)` : '';
    return `글칸 앱${yn(ncLog.native)}·플러그인${yn(ncLog.ready)}${v}·바${yn(ncLog.stood)}`;
}

let asked: Promise<boolean> | null = null;

/**
 * 네이티브 글칸을 쓸 수 있는가. **한 번만 물어보고 기억한다.**
 *
 * 웹이면 곧바로 false다. 앱이어도 플러그인이 없는 판이면 `ready()`가
 * 던지므로 false가 된다 — 그때는 부르는 쪽이 웹 글칸을 그대로 쓴다.
 */
export function composerReady(): Promise<boolean> {
    if (asked) return asked;
    asked = (async () => {
        if (!IS_NATIVE) return false;
        try { if (localStorage.getItem(OFF_KEY) === 'off') return false; } catch { /* 사파리 잠금 */ }
        try {
            const r = await NativeComposer.ready();
            ncLog.ready = r?.ok === true;
            ncLog.v = ncLog.ready ? (typeof r?.v === 'number' ? r.v : 1) : 0;
            /* **2판부터는 바가 `inputAccessoryView`가 아니라 보통 뷰다.**
               키보드가 올라와도 웹뷰 아래를 바가 덮으므로 여백 셈이 다르다 —
               CSS가 `html.nc2`로 가른다(`Chat.css`·`global.css`). 옛 앱에는
               이 표시가 안 붙어 예전 셈이 그대로 돈다. */
            if (ncLog.v >= 2) document.documentElement.classList.add('nc2');
        } catch {
            ncLog.ready = false;
        }
        return ncLog.ready;
    })();
    return asked;
}

/* ── 키보드가 오르내릴 때 목록 그림을 앱이 들고 움직인다(14판) ──
 *
 * 사용자가 `카톡만큼 부드럽게`를 바라며 짚은 자리가 **키보드가 오르내릴
 * 때**였다. 13판까지는 바가 프레임마다 자리를 알리고 웹이 그때마다 목록을
 * 다시 배치했는데, 그 길은 한 프레임마다 다리를 건너고 배치를 다시 하는
 * 일이라 고르게 안 나온다. 14판은 앱이 목록의 **그림**을 떠서 키보드와 한
 * 움직임으로 옮기고, 웹은 그 뒤에서 **한 번만** 다시 배치한다
 * (`ios/App/App/ListSlider.swift`).
 *
 * **끄는 스위치가 웹에 있다**(`teetime:nc-slide` = `off`). 실기기에서 어긋나면
 * 앱을 다시 만들지 않고 13판 길로 되돌릴 수 있어야 한다.
 */
const SLIDE_OFF_KEY = 'teetime:nc-slide';

/**
 * 앱이 목록 그림을 들고 움직일 수 있는 판인가.
 *
 * **기본이 꺼짐이다 — 켜려면 `teetime:nc-slide`를 `on`으로 적어야 한다.**
 * 실기기에서 세 판을 돌려도 `채팅내용이 잘리거나 위아래로 깜빡인다`가
 * 안 없어졌다(사용자 제보). 여기는 **헤드리스로 확인할 길이 아예 없는
 * 자리**라(그림을 뜨고 미는 것이 앱이다) 고치는 쪽도 짐작이 되는데,
 * 그러는 동안 대화 화면이 매일 쓰는 자리라는 것이 더 무겁다.
 * 13판 길(`ComposerBar.follow` — 바가 프레임마다 제 자리를 알린다)은
 * 오래 돌아 온 길이므로 그쪽을 기본으로 둔다.
 *
 * **코드는 지우지 않았다.** 다시 팔 때는 `내 정보`에 진단 줄을 먼저 넣고
 * (`ncStatus`와 같은 방식) 실기기에서 값을 읽어 가며 할 것 — 짐작으로
 * 고치면 또 판만 태운다.
 */
export function canSlide(): boolean {
    if (ncLog.ready !== true || ncLog.v < 14) return false;
    try { return localStorage.getItem(SLIDE_OFF_KEY) === 'on'; } catch { return false; }
}
/** 지금 꺼져 있는가(= 13판 길로 돈다). */
export function slideOff(): boolean { return !canSlide(); }
export function setSlideOn(on: boolean): void {
    try {
        if (on) localStorage.setItem(SLIDE_OFF_KEY, 'on');
        else localStorage.removeItem(SLIDE_OFF_KEY);
    } catch { /* 사파리 잠금 */ }
}

/* ── 사진 고르기 — 대화의 `+`와 `내 정보`의 프로필 사진이 같이 쓴다 ──
 *
 * **웹 `<input type="file">`을 앱에서 쓰면 고르는 창이 엉뚱한 데 뜬다.**
 * iOS는 그 창을 **칸이 있는 자리**에 붙이는데, 코드로 `click()`을 부르면
 * 붙일 손짓이 없어 제 맘대로 띄운다(사용자 제보 — `팝업뜨는 위치가 지
 * 맘데로야`). 앱이 직접 띄우면 그 자리가 아예 없다.
 *
 * **12판부터만 앱 창을 쓴다.** 9~11판은 창이 닫히기 전에 다음 창을 띄워
 * 보관함·카메라가 아예 안 열렸다 — 그 판을 든 폰은 웹 칸으로 물러난다.
 * 자리가 어긋난 것과 아예 못 고르는 것 중에서는 앞엣것이 낫다.
 */

/** 앱에게 고르게 할 수 있는가. false면 부르는 쪽이 웹 칸으로 물러난다. */
export function canPickNative(): boolean {
    return ncLog.ready === true && ncLog.v >= 12;
}

/**
 * 고른 결과 셋. **`취소`와 `고장`을 반드시 가른다** — 예전에는
 * `catch(() => null)` 하나로 둘을 같이 삼켜서, 사진이 안 올라가는데
 * **아무 말도 안 떴다**(`사진 크기를 키운 후로 안돼`가 그 자리였다).
 * 취소에 문구를 띄우면 안 보내기로 한 사람에게 오류창이 뜬다.
 */
export type Picked =
    | { kind: 'photo'; blob: Blob }
    | { kind: 'cancel' }
    | { kind: 'fail'; why: string };

/**
 * 앱이 사진을 고르고 **이미 줄여서** 넘겨준다(`lib/image.ts`와 같은 값).
 * `canPickNative()`가 참일 때만 부를 것.
 */
export async function pickNativePhoto(): Promise<Picked> {
    let r: { ok?: boolean; data?: string; why?: string } | null = null;
    try {
        r = await NativeComposer.pickPhoto();
    } catch (err) {
        return { kind: 'fail', why: err instanceof Error ? err.message : String(err) };
    }
    if (r?.ok && r.data) {
        const bin = atob(r.data);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return { kind: 'photo', blob: new Blob([buf], { type: 'image/jpeg' }) };
    }
    /* 취소는 까닭 없이 온다. 까닭이 실려 왔으면 **앱이 스스로 막힌 것을
       안 것**이라, 부르는 쪽이 알리고 웹 칸으로 물러난다. */
    return r?.why ? { kind: 'fail', why: r.why } : { kind: 'cancel' };
}

/** 끄고 켜기. `내 정보`에서 쓴다 — 어긋났을 때 앱을 다시 안 만들고 되돌리는 길이다. */
export function composerOff(): boolean {
    try { return localStorage.getItem(OFF_KEY) === 'off'; } catch { return false; }
}
export function setComposerOff(off: boolean): void {
    try {
        if (off) localStorage.setItem(OFF_KEY, 'off');
        else localStorage.removeItem(OFF_KEY);
    } catch { /* 사파리 잠금 */ }
    asked = null;
}

/** 토큰에서 색을 읽는다. 값이 없으면 예비 색이 그대로 남는다. */
function hex(name: string, fallback: string): string {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
    } catch {
        return fallback;
    }
}

/** CSS 길이 토큰(`56px`)에서 숫자만. */
function px(name: string, fallback: number): number {
    try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    } catch {
        return fallback;
    }
}

/**
 * 바의 모양과 크기. **`Chat.css`의 `.chat-input` 한 줄을 그대로 옮긴 값이다** —
 * 좌우 여백 6 · 위아래 10 · 글칸 한 줄 38 · 최대 120 · 모서리 19 ·
 * `+` 32 · 보내기 34 · 이모티콘 30. 한쪽만 고치면 웹과 앱의 글칸이
 * 다르게 보인다.
 *
 * `tabH`는 **키보드가 내려가 있을 때 바 아래에 비워 둘 자리**다(웹 탭바).
 * 0을 주면 바가 탭바를 덮으므로, 그때는 웹에서 탭바를 함께 감춰야 한다.
 *
 * **글자 색은 `fg`다. `text`라고 부르지 말 것** — 그 이름은 **글 내용**이
 * 쓰고 있어서(댓글 칸이 적어 둔 글을 그렇게 실어 보낸다), 예전에 색을
 * `text`로 보냈다가 **글칸에 `#1b1f19`가 그대로 찍혀 나왔다**(실기기).
 */
/** 토큰에서 읽어 온 값. **한 번만 읽고 기억한다** — `getComputedStyle`을
    열두 번 부르는 일이라, 댓글 칸을 누르는 그 순간에 하면 바가 그만큼 늦게
    선다. 색은 앱이 도는 동안 안 바뀐다(어두운 테마가 없다). */
let skinCache: Record<string, unknown> | null = null;

export function composerSkin(over: Record<string, unknown> = {}): Record<string, unknown> {
    if (skinCache) return { ...skinCache, ...over };
    skinCache = {
        padV: 10, padH: 6, gap: 2,
        minH: 38, maxH: 120,
        plusW: 32, sendW: 34, iconW: 30,
        fontSize: 16, radius: 19,
        showPlus: true, showIcon: true, tray: false, forceSend: false,
        /* **감춤은 늘 함께 보낸다.** 앱은 **보낸 값만** 고치므로, 안 보내면
           지난 화면의 값이 그대로 남는다 — 댓글 화면이 감춰 둔 바가 대화까지
           따라가 **입력칸이 통째로 안 보였다**(사용자 제보 — `메시지창 자체가
           안보여`). 감추는 쪽(`warm`)이 `true`로 덮어쓴다. */
        hidden: false,
        tabH: px('--tabbar-h', 56),
        bg: hex('--bg', '#f5f7f1'),
        field: hex('--surface-3', '#e4e9da'),
        fg: hex('--text', '#1b1f19'),
        hint: hex('--text-faint', '#8b9486'),
        dim: hex('--text-dim', '#5b6455'),
        brand: hex('--brand', '#d92b8e'),
        onBrand: hex('--on-brand', '#ffffff'),
        offBg: hex('--surface-3', '#e4e9da'),
        offFg: hex('--text-faint', '#8b9486'),
        line: hex('--line', '#dde3d1'),
        /* 목록 바탕색(14판 — 내려갈 때 위에 잠깐 드러나는 자리를 이 색으로
           덮는다). 모르는 판은 그냥 지나친다. */
        listBg: hex('--chat-bg', '#7369a0'),
    };
    return { ...skinCache, ...over };
}

/** 던지는 것을 삼킨다. **글칸 하나 때문에 화면이 죽으면 안 된다.** */
export async function hush(p: Promise<unknown>): Promise<void> {
    try { await p; } catch { /* 없는 판에서는 그냥 지나간다 */ }
}
