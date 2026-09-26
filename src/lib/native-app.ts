import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * **앱이 통째로 그리는 화면들의 다리** — 대화(`native-chat.ts`) 다음 걸음이다
 * (사용자 요청 — `까꿍앱을 완전한 네이티브앱으로 바꿔줘. 일단 아이폰만`).
 * 단계와 켜는 법은 `docs/아이폰-네이티브.md`에 있다.
 *
 * 오가는 말은 대화 플러그인과 같은 꼴이다(`ios/App/App/NativeAppPlugin.swift`):
 *  - `open({screen, path, user, token, url, key, slide})` — 그 주소의 화면을
 *    화면 틀에 밀어 올린다. 앱이 모르는 주소면 거절한다.
 *  - `close({screen})` · `session({user, token})`.
 *  - `event` — `back`(`plain` — 웹이 뒤로 간다) · `navigate`(`path`) ·
 *    `auth`(토큰 만료 — 웹이 갱신해 `session`으로 준다).
 *
 * **아직 스위치 뒤에 있다**(`내 정보 → 🧪 시험 중: 앱 화면`). 켜진 아이폰
 * 앱에서만 `NATIVE_SCREENS`의 주소가 앱 화면으로 가고, 꺼져 있으면 지금의
 * 웹 화면이다. 화면이 하나씩 다 옮겨지면 스위치를 걷어내고 기본으로 한다.
 */
export type NativeAppEvent = {
    screen: string;
    type: 'navigate' | 'auth' | 'back';
    /** `'shell'`이면 껍데기(홈·탭바)가 보낸 것이다. */
    /** `replace`면 이 화면의 자리를 그 화면이 대신한다(지운 글에서 목록으로). */
    data: { path?: string; phase?: string; replace?: boolean };
};
export const NativeApp = registerPlugin<{
    ready(): Promise<{ v: number; screens: string[] }>;
    open(config: Record<string, unknown>): Promise<{ ok: boolean }>;
    close(config: { screen: string }): Promise<void>;
    session(config: { user: string; token: string }): Promise<void>;
    /** 앱 화면 쪽 기록 — `내 정보` 맨 아래에 적는다(폰에서만 갈리는 자리를 읽으려는 것). */
    debug(): Promise<{ lines: string[] }>;
    /** 앱 껍데기(홈·탭바)를 세운다 — 로그인이 끝나면(`NativeShellSync`). 같은 사람이면 토큰·탭만 맞춘다. */
    shell(config: Record<string, unknown>): Promise<{ ok: boolean }>;
    /** 껍데기를 내린다(로그아웃). */
    shellOff(): Promise<void>;
    /** 껍데기더러 그 주소로 가라고 — 탭이면 켜고, 앱 화면이면 밀어 올리고, 웹 화면이면 웹에 되돌려 연다. */
    go(config: { path: string }): Promise<void>;
    /** 웹 쪽 한 줄을 앱 기록에 남긴다(`내 정보` 맨 아래) — 다리 양쪽을 한 줄로 읽으려는 것. */
    log(config: { line: string }): Promise<void>;
    addListener(name: 'event', callback: (e: NativeAppEvent) => void): Promise<PluginListenerHandle>;
}>('NativeApp');

/**
 * **앱이 그릴 줄 아는 주소.** Swift의 `NativeAppPlugin.screens`와 같아야 한다 —
 * 한쪽만 고치면 웹이 보냈는데 앱이 `모르는 화면`으로 거절한다.
 */
export const NATIVE_SCREENS = ['/members', '/alerts', '/board/:id', '/rounds/:id'];

/**
 * 주소가 그 꼴인가 — `:id`는 **uuid 한 조각**이다. 그래서 `/board/new`와
 * `/board/<id>/edit`(쓰는 화면 · 아직 웹)는 `/board/:id`에 안 걸린다.
 * Swift의 `NativeAppPlugin.make`가 같은 잣대(`UUID(uuidString:)`)로 가른다.
 */
function matches(pattern: string, path: string): boolean {
    if (!pattern.includes(':')) return pattern === path;
    const re = new RegExp('^' + pattern.replace(/:[^/]+/g, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}') + '$', 'i');
    return re.test(path);
}

export const NATIVE_APP_KEY = 'teetime:native-app';
export function nativeAppOn(): boolean {
    try { return localStorage.getItem(NATIVE_APP_KEY) === 'on'; } catch { return false; }
}
export function setNativeAppOn(on: boolean): void {
    try { if (on) localStorage.setItem(NATIVE_APP_KEY, 'on'); else localStorage.removeItem(NATIVE_APP_KEY); } catch { /* 못 적으면 그대로 웹이다 */ }
}

/** 이 아이폰 앱이 화면을 그릴 수 있고 스위치가 켜져 있는가. */
export function hasNativeApp(): boolean {
    return Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('NativeApp') && nativeAppOn();
}

/** 이 주소를 앱이 그리는가(스위치·플러그인·목록 셋 다 맞을 때). */
export function nativeScreen(path: string): boolean {
    return hasNativeApp() && NATIVE_SCREENS.some(p => matches(p, path));
}
