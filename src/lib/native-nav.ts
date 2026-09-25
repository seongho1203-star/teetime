import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * **화면 전환과 뒤로 끌기를 앱이 맡는 층**(사용자 요청 — `화면 전환 /
 * 뒤로끌기 → Native Navigation Layer 이렇게 만들어줘` · `전부 네이티브`).
 *
 * 웹 화면(라운드·투표·게시판·내 정보)은 그대로 웹이 그리고, **화면이
 * 밀려 들어오고 나가는 움직임과 손가락으로 끌어 뒤로 가는 일만** 앱
 * (`ios/App/App/NativeNavPlugin.swift` · `android/.../nav/NavLayer.kt`)이
 * 한다. 웹의 `transform`으로 미는 것과 갈리는 자리가 셋이다:
 *
 *  1. **웹뷰 위에 얹힌 앱 부품까지 한 몸으로 움직인다** — 네이티브 글칸
 *     바·대화 화면은 웹의 `transform`을 안 따라와 찢어져 보였다
 *     (`lib/tabs.ts`의 `plainBack` 주석). 앱이 웹뷰 자체를 옮기면 그 위의
 *     것이 함께 간다.
 *  2. **손짓이 앱 것이라 굴리기와 다투지 않는다** — 웹에서는 `passive:
 *     false` 듣기를 붙였다 떼며 막았다.
 *  3. **앞 화면 그림이 진짜 픽셀이다** — 웹은 DOM을 복사해 그림을 흉내
 *     냈고(얼굴이 다시 받아지는 자국이 두 번 있었다), 앱은 화면을 그대로
 *     찍는다.
 *
 * ── 오가는 말 ────────────────────────────────────────────────
 *
 *  웹 → 앱
 *   - `push({ms, native})` — 새 화면으로 **들어간다.** 앱이 **지금 웹뷰를
 *     찍어** 뒤에 깔고(그 그림이 곧 앞 화면이다) 웹뷰를 오른쪽 끝에서
 *     제자리로 민다. `native`면 목적지가 앱이 그리는 화면(대화)이라
 *     찍어 두기만 하고 안 민다.
 *   - `pop({ms, native})` — **뒤로 간다.** 앱이 지금 웹뷰를 찍어 **위에**
 *     얹고 오른쪽으로 내보내며, 그 밑에서 웹뷰가 1/4 자리에서 돌아온다.
 *   - `back({on})` — 이 화면에서 **끌어서 뒤로 갈 수 있는가.** 탭 화면과
 *     맨 처음 화면에서는 끈다.
 *   - `touch({free})` — 손을 댄 자리가 **다른 손짓의 임자인가**(글칸·
 *     가로로 굴러가는 줄·덮는 창). 앱은 DOM을 모르므로 웹이 알려 준다.
 *   - `rendered()` — 끌어서 넘어간 뒤 **목적지를 다 그렸다.** 앱이 그때
 *     깔아 둔 그림을 걷는다.
 *  앱 → 웹 (`nav` 이벤트)
 *   - `{type:'back', phase:'commit'}` — 끌어서 넘어갔다. 웹이 `뒤로`를
 *     하고 다 그린 뒤 `rendered()`를 부른다.
 *   - `{type:'back', phase:'cancel'}` — 제자리로 돌아왔다.
 *   - `{type:'back', phase:'plain'}` — 끌리는 것 없이 뒤로(안드로이드 뒤로
 *     단추). 웹이 `뒤로`를 하면 여느 길(`pop`)로 밀린다.
 *
 * **찍는 순간의 웹뷰가 곧 앞 화면이어야 한다.** `push`·`pop`은 주소가
 * 바뀌는 그 자리(`pushState`·`popstate`)에서 부르는데, 다리를 건너는
 * 사이에 리액트가 새 화면을 그려 버릴 수 있다. 그래서 웹은 부르기 전에
 * **지금 화면의 사본을 맨 위에 덮어 두고**(`lib/tabs.ts`의 `holdScreen`)
 * 앱이 찍고 답하면 걷는다 — 어느 프레임을 찍어도 옛 화면이다.
 *
 * **없으면 저절로 웹 길이다** — 플러그인이 안 실린 옛 앱과 브라우저에서는
 * `hasNativeNav()`가 거짓이라 `lib/tabs.ts`가 예전 그대로 돈다.
 * 스위치도 있다: `localStorage`의 `teetime:nav`가 `off`면 앱에서도 웹 길로
 * 간다(폰에서 두 길을 견줄 때 쓴다).
 */
export type NativeNavEvent = { type: 'back'; phase: 'commit' | 'cancel' | 'plain' };
export const NativeNav = registerPlugin<{
    ready(): Promise<{ v: number }>;
    push(o: { ms: number; native: boolean; shot?: string }): Promise<void>;
    pop(o: { ms: number; native: boolean }): Promise<void>;
    back(o: { on: boolean }): Promise<void>;
    touch(o: { free: boolean }): Promise<void>;
    rendered(): Promise<void>;
    addListener(name: 'nav', cb: (e: NativeNavEvent) => void): Promise<PluginListenerHandle>;
}>('NativeNav');

export const NATIVE_NAV_KEY = 'teetime:nav';
export function nativeNavOff(): boolean {
    try { return localStorage.getItem(NATIVE_NAV_KEY) === 'off'; } catch { return false; }
}
export function setNativeNavOff(off: boolean): void {
    try { if (off) localStorage.setItem(NATIVE_NAV_KEY, 'off'); else localStorage.removeItem(NATIVE_NAV_KEY); } catch { /* 못 적으면 그대로 */ }
}

let known: boolean | undefined;
/** 앱이 화면 전환을 맡는가. 한 번 정해지면 그대로다(판이 바뀌면 앱을 새로 깐다). */
export function hasNativeNav(): boolean {
    if (known !== undefined) return known;
    known = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativeNav') && !nativeNavOff();
    return known;
}
