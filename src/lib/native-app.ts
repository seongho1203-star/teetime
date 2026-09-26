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
 *    `auth`(토큰 만료 — 웹이 갱신해 `session`으로 준다) ·
 *    `action`(`name`·`value` — **웹이 쥐고 있는 일을 부탁한다**: 알림 켜기·
 *    로그아웃·탈퇴·시험 스위치. `내 정보`가 쓴다). 웹은 마치면 `reply`로 답한다.
 *
 * **아직 스위치 뒤에 있다**(`내 정보 → 🧪 시험 중: 앱 화면`). 켜진 아이폰
 * 앱에서만 `NATIVE_SCREENS`의 주소가 앱 화면으로 가고, 꺼져 있으면 지금의
 * 웹 화면이다. 화면이 하나씩 다 옮겨지면 스위치를 걷어내고 기본으로 한다.
 */
export type NativeAppEvent = {
    screen: string;
    type: 'navigate' | 'auth' | 'back' | 'action';
    /** `'shell'`이면 껍데기(홈·탭바)가 보낸 것이다. */
    /** `replace`면 이 화면의 자리를 그 화면이 대신한다(지운 글에서 목록으로). */
    data: { path?: string; phase?: string; replace?: boolean; name?: string; value?: unknown };
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
    /** 앱 화면이 부탁한 일(`action`)의 답 — `{screen, name, ok, why?, …}`. 앱 판 11부터. */
    reply(config: Record<string, unknown>): Promise<void>;
    /** 알림을 눌러 온 주소 — 껍데기가 맨 위에 있으면 앱이 열고 `handled: true`. 앱 판 12부터. */
    deep(config: { path: string }): Promise<{ handled: boolean }>;
    /** 실시간으로 바뀐 표 — 보이는 앱 화면이 다시 받는다(`AppLive`). 앱 판 12부터. */
    changed(config: { tables: string[] }): Promise<void>;
    addListener(name: 'event', callback: (e: NativeAppEvent) => void): Promise<PluginListenerHandle>;
}>('NativeApp');

/**
 * **앱이 그릴 줄 아는 주소.** Swift의 `NativeAppPlugin.screens`와 같아야 한다 —
 * 한쪽만 고치면 웹이 보냈는데 앱이 `모르는 화면`으로 거절한다.
 */
export const NATIVE_SCREENS = ['/members', '/alerts', '/board/:id', '/rounds/:id', '/polls/:id', '/help',
    '/board/new', '/board/:id/edit', '/polls/new', '/polls/:id/edit',
    '/rounds/new', '/rounds/:id/edit', '/rounds/:id/groups', '/settle', '/me'];

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

/**
 * **앱 화면은 이제 기본이다**(사용자 — `이것만하면 아이폰앱은 완성된거같아`).
 * 한동안 `내 정보 → 🧪 시험 중: 앱 화면` 스위치(`teetime:native-app`) 뒤에
 * 있었는데 걷어냈다 — 플러그인이 실린 아이폰 앱이면 늘 앱 화면이다.
 * 옛 판 앱(플러그인 없음)은 `hasNativeApp()`의 나머지 조건에서 저절로 웹이다.
 */
export function nativeAppOn(): boolean { return true; }

/** 이 아이폰 앱이 화면을 그릴 수 있고 스위치가 켜져 있는가. */
export function hasNativeApp(): boolean {
    return Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('NativeApp') && nativeAppOn();
}

/** 이 주소를 앱이 그리는가(스위치·플러그인·목록 셋 다 맞을 때). */
export function nativeScreen(path: string): boolean {
    return hasNativeApp() && NATIVE_SCREENS.some(p => matches(p, path));
}

/*
 * **알림을 눌러 온 길(딥링크)** — 5단계.
 *
 * 껍데기가 서 있으면 웹 주소를 바꾸지 않고 **앱에 곧바로 넘긴다**(`deep`).
 * 앱은 틀을 껍데기까지 되돌린 뒤 그 주소로 간다 — 탭이면 켜고, 앱 화면이면
 * 밀어 올리고, 아직 웹인 화면이면 웹에 열라고 한다(`shell.go`).
 * 앱이 맡지 못하는 자리(대화방이나 웹이 연 화면이 위에 있을 때 · 옛 앱)면
 * `handled: false`가 오고, 그때는 예전처럼 해시를 바꾼다.
 *
 * **앱이 꺼져 있다가 알림으로 켜진 판**에는 알림 사건이 껍데기보다 먼저
 * 온다 — 그때 해시를 바꾸면 껍데기가 그 위를 덮어 버린다. 적어 두었다가
 * 껍데기가 서면(`shellReady`) 그때 넘긴다.
 */
let shellUp = false;
let pendingDeep = '';

function hashTo(path: string) {
    const h = '#' + path;
    if (location.hash !== h) location.hash = h;
}

/** 알림이 가리키는 주소를 앱이 맡았는가(맡았으면 웹은 아무것도 안 한다). */
export function nativeDeepLink(path: string): boolean {
    if (!hasNativeApp()) return false;
    if (!shellUp) { pendingDeep = path; return true; }
    void NativeApp.deep({ path })
        .then(r => { if (!r?.handled) hashTo(path); })
        .catch(() => hashTo(path));
    return true;
}

/** 껍데기가 섰다(`ok`) · 못 섰다 · 내렸다 — 기다리던 딥링크가 있으면 그때 넘긴다. */
export function shellReady(ok: boolean) {
    shellUp = ok;
    if (!pendingDeep) return;
    const p = pendingDeep;
    pendingDeep = '';
    if (ok) nativeDeepLink(p); else hashTo(p);
}

/**
 * **앱 화면에 알리는 표** — 웹 화면들이 `useRealtime`으로 듣는 것과 같은 줄.
 * `room_reads`(누가 읽을 때마다)와 `message_reactions`는 뺐다 — 앱 화면 중
 * 그걸로 바뀌는 곳이 없고, 백 명 방에서는 그것만으로 쉬지 않고 울린다.
 */
export const LIVE_TABLES = ['rounds', 'signups', 'polls', 'poll_options', 'poll_votes',
    'posts', 'post_comments', 'poll_comments', 'round_comments', 'profiles',
    'settlements', 'settlement_shares', 'round_groups', 'notifications', 'messages'];
