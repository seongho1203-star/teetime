import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard, type KeyboardResize } from '@capacitor/keyboard';

/**
 * 앱 화면이 웹에 보내는 소식.
 *
 * - `navigate` — 카드를 눌렀다(갈 곳이 `path`). **`shot`은 그때의 대화
 *   화면을 뜬 그림이다**(`data:image/jpeg;base64,…`) — 라운드·투표에서
 *   손가락으로 끌어 뒤로 올 때 **뒤에 깔 것**이다. 웹 쪽에는 대화 자리를
 *   지키는 스피너 한 장뿐이라 그림을 만들 길이 아예 없다
 *   (`lib/tabs.ts`의 `setChatShot`).
 * - `read` — 여기까지 읽었다(`at`).
 * - `auth` — 토큰이 만료됐다.
 * - `back` — **뒤로 가기 손짓**(`phase`: `start` 끌기 시작 ·
 *   `commit` 넘어감 · `cancel` 제자리 · `plain` 끌리는 것 없이 곧바로).
 *   앞 화면 그림은 웹만 만들 수 있어 그 셋을 웹이 받아 깐다
 *   (`lib/tabs.ts`의 `nativeBackStart`/`nativeBackEnd`).
 */
export type NativeChatEvent = {
    screen: string;
    type: 'navigate' | 'read' | 'auth' | 'back';
    data: { path?: string; at?: string; phase?: string; shot?: string };
};
export const NativeChat = registerPlugin<{
    open(config: Record<string, unknown>): Promise<{ ok: boolean }>;
    close(config: { screen: string }): Promise<void>;
    session(config: { user: string; token: string }): Promise<void>;
    reset(): Promise<void>;
    addListener(name: 'event', callback: (e: NativeChatEvent) => void): Promise<PluginListenerHandle>;
}>('NativeChat');

/**
 * **안드로이드는 시험 중이라 스위치 뒤에 있다**(`docs/안드로이드-네이티브.md`).
 * 코틀린 대화 화면이 아이폰만큼 되기 전까지는 `내 정보`의
 * `시험 중: 앱 대화 화면`을 켠 폰에서만 그 화면으로 간다 — 꺼져 있으면
 * 지금처럼 웹 대화(`Chat.tsx`)다. 다 되면 이 스위치를 걷어내고 아이폰과
 * 같은 갈래로 합친다.
 */
export const ANDROID_CHAT_KEY = 'teetime:android-chat';
export function androidChatOn(): boolean {
    try { return localStorage.getItem(ANDROID_CHAT_KEY) === 'on'; } catch { return false; }
}
export function setAndroidChat(on: boolean): void {
    try { if (on) localStorage.setItem(ANDROID_CHAT_KEY, 'on'); else localStorage.removeItem(ANDROID_CHAT_KEY); } catch { /* 못 적으면 그대로 웹이다 */ }
}
export const hasNativeChat = () => {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios') return Capacitor.isPluginAvailable('NativeChat');
    if (platform === 'android') return androidChatOn() && Capacitor.isPluginAvailable('NativeChat');
    return false;
};
let queue: Promise<unknown> = Promise.resolve();
let resize: KeyboardResize | undefined;
let owner: string | undefined;
function ordered<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run); queue = next.catch(() => {}); return next;
}
/* **키보드 크기 맞추기를 끄는 것은 아이폰뿐이다.** 거기서는 앱 화면이
   `keyboardLayoutGuide`로 제 키보드를 따라가므로 웹뷰까지 줄면 두 번
   움직인다. 안드로이드는 반대로 **창이 줄어야** 글칸이 키보드 위로 올라온다
   (`ChatScreen`은 창 inset을 그대로 받는다). */
const IOS = Capacitor.getPlatform() === 'ios';
export function openNativeChat(screen: string, config: Record<string, unknown>): Promise<void> {
    return ordered(async () => {
        if (IOS && resize === undefined) resize = (await Keyboard.getResizeMode()).mode;
        if (IOS) await Keyboard.setResizeMode({ mode: 'none' as KeyboardResize });
        try {
            const result = await NativeChat.open({ ...config, screen });
            if (!result.ok) throw new Error('채팅을 열지 못했습니다. 다시 시도해 주세요.');
            owner = screen;
        } catch (error) {
            if (resize !== undefined) await Keyboard.setResizeMode({ mode: resize });
            resize = undefined; throw error;
        }
    });
}
export function closeNativeChat(screen: string): Promise<void> {
    return ordered(async () => {
        await NativeChat.close({ screen });
        if (owner !== screen) return;
        owner = undefined;
        if (resize !== undefined) await Keyboard.setResizeMode({ mode: resize });
        resize = undefined;
    });
}
export function resetNativeChat(): Promise<void> {
    return ordered(async () => {
        await NativeChat.reset(); owner = undefined;
        if (resize !== undefined) await Keyboard.setResizeMode({ mode: resize });
        resize = undefined;
    });
}
