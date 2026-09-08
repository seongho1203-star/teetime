import { Capacitor } from '@capacitor/core';
import { supabase, NATIVE_REDIRECT } from './supabase';

/* 앱(Capacitor)일 때만 도는 것들. **웹에서는 한 줄도 안 돈다** —
 * `isNativePlatform()`이 false면 곧바로 돌아서고, 플러그인도 그때만
 * 불러오므로 웹 묶음이 무거워지지 않는다.
 *
 * 지금 하는 일은 하나다: **바깥 브라우저로 내보낸 카카오 로그인이
 * 끝나고 앱으로 돌아올 때 그걸 받아 세션을 세운다.**
 * 내보내는 쪽은 `supabase.ts`의 `signInWithKakao()`다.
 */

const SCHEME = NATIVE_REDIRECT.split('://')[0] + '://';

/** 돌아온 주소에서 값을 꺼낸다.
 *
 * **`new URL()`로 파싱하지 않는다** — `kkakkung://` 같은 커스텀 스킴은
 * 브라우저마다 다루는 법이 달라 `search`가 비어 오기도 한다. 글자를
 * 직접 자르는 편이 어긋날 자리가 없다.
 *
 * 물음표 쪽과 우물정자 쪽을 **둘 다 본다** — 지금은 PKCE라 `?code=`로
 * 오지만, 설정이 바뀌면 `#access_token=`으로 온다. 한쪽만 보면 그때
 * 조용히 로그인이 안 된다. */
function partsOf(url: string) {
    const afterQ = url.split('?')[1]?.split('#')[0] ?? '';
    const afterH = url.split('#')[1] ?? '';
    return { q: new URLSearchParams(afterQ), h: new URLSearchParams(afterH) };
}

async function handleAuthUrl(url: string): Promise<void> {
    if (!url.startsWith(SCHEME)) return;

    // 로그인 창을 먼저 닫는다 — 세션을 세우는 동안 사파리 창이 떠 있으면
    // 다 됐는데 안 된 것처럼 보인다. 이미 닫혔으면 그냥 넘어간다.
    try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.close();
    } catch { /* 이미 닫혔다 */ }

    const { q, h } = partsOf(url);

    const failed = q.get('error_description') ?? h.get('error_description')
        ?? q.get('error') ?? h.get('error');
    if (failed) {
        // 화면 쪽 토스트는 리액트 안에 있어 여기서 못 쓴다. 이 자리는
        // **왜 못 들어갔는지 폰에서 읽을 수 있는 유일한 길**이라 그대로 띄운다.
        alert('로그인에 실패했습니다.\n' + failed);
        return;
    }

    try {
        const code = q.get('code');
        if (code) {
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
            return;
        }
        const access_token = h.get('access_token');
        const refresh_token = h.get('refresh_token');
        if (access_token && refresh_token) {
            const { error } = await supabase.auth.setSession({ access_token, refresh_token });
            if (error) throw error;
        }
    } catch (e) {
        alert('로그인을 마무리하지 못했습니다.\n' + (e as Error).message);
    }
}

export function watchNativeAuth(): void {
    if (!Capacitor.isNativePlatform()) return;

    void (async () => {
        const { App } = await import('@capacitor/app');

        // 앱이 떠 있는 채로 돌아온 경우.
        await App.addListener('appUrlOpen', ({ url }) => { void handleAuthUrl(url); });

        // **앱이 꺼져 있다가 그 주소로 켜진 경우는 위 이벤트가 안 온다.**
        // 켜질 때 한 번 물어봐야 한다 — 안 그러면 로그인하고 돌아왔는데
        // 로그인 화면이 그대로 있는 자리가 된다.
        const launch = await App.getLaunchUrl();
        if (launch?.url) await handleAuthUrl(launch.url);
    })();
}
