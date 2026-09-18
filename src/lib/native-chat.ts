import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard, type KeyboardResize } from '@capacitor/keyboard';

/**
 * 앱 화면이 웹에 보내는 소식.
 *
 * - `navigate` — 카드를 눌렀다(갈 곳이 `path`).
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
    data: { path?: string; at?: string; phase?: string };
};
export const NativeChat = registerPlugin<{
    open(config: Record<string, unknown>): Promise<{ ok: boolean }>;
    close(config: { screen: string }): Promise<void>;
    session(config: { user: string; token: string }): Promise<void>;
    reset(): Promise<void>;
    addListener(name: 'event', callback: (e: NativeChatEvent) => void): Promise<PluginListenerHandle>;
}>('NativeChat');

export const hasNativeChat = () => Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('NativeChat');
let queue: Promise<unknown> = Promise.resolve();
let resize: KeyboardResize | undefined;
let owner: string | undefined;
function ordered<T>(run: () => Promise<T>): Promise<T> {
    const next = queue.then(run); queue = next.catch(() => {}); return next;
}
export function openNativeChat(screen: string, config: Record<string, unknown>): Promise<void> {
    return ordered(async () => {
        if (resize === undefined) resize = (await Keyboard.getResizeMode()).mode;
        await Keyboard.setResizeMode({ mode: 'none' as KeyboardResize });
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
