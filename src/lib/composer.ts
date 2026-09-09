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
    ready(): Promise<{ ok: boolean }>;
    attach(o: Record<string, unknown>): Promise<void>;
    detach(): Promise<void>;
    setText(o: { text: string; sel?: number }): Promise<void>;
    getText(): Promise<{ text: string }>;
    setState(o: Record<string, unknown>): Promise<void>;
    focus(): Promise<void>;
    blur(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    addListener(n: 'change', cb: (e: { text: string; sel: number }) => void): Promise<Handle>;
    addListener(n: 'send', cb: (e: { text: string }) => void): Promise<Handle>;
    addListener(n: 'action', cb: (e: { name: ComposerAction }) => void): Promise<Handle>;
    addListener(n: 'focus', cb: (e: { on: boolean }) => void): Promise<Handle>;
    addListener(n: 'height', cb: (e: { height: number }) => void): Promise<Handle>;
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
};

/** `내 정보` 아래에 적을 한 줄. */
export function ncStatus(): string {
    const yn = (v: boolean | null) => (v === null ? '?' : v ? 'O' : 'X');
    return `글칸 앱${yn(ncLog.native)}·플러그인${yn(ncLog.ready)}·바${yn(ncLog.stood)}`;
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
        } catch {
            ncLog.ready = false;
        }
        return ncLog.ready;
    })();
    return asked;
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
export function composerSkin(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        padV: 10, padH: 6, gap: 2,
        minH: 38, maxH: 120,
        plusW: 32, sendW: 34, iconW: 30,
        fontSize: 16, radius: 19,
        showPlus: true, showIcon: true, tray: false, forceSend: false,
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
        ...over,
    };
}

/** 던지는 것을 삼킨다. **글칸 하나 때문에 화면이 죽으면 안 된다.** */
export async function hush(p: Promise<unknown>): Promise<void> {
    try { await p; } catch { /* 없는 판에서는 그냥 지나간다 */ }
}
