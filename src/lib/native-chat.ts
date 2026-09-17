import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard, type KeyboardResize } from '@capacitor/keyboard';

export type NativeChatEvent = { screen: string; type: 'navigate' | 'read' | 'auth'; data: { path?: string; at?: string } };
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
