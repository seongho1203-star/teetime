import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import type { Database } from './types';

/**
 * Supabase 클라이언트.
 *
 * 주소와 anon 키는 `.env`에서 읽는다 (`.env.example` 참고).
 * anon 키는 브라우저에 드러나도 되는 값이다 — 진짜 방어선은 RLS다.
 * service_role 키는 **절대** 여기 넣지 말 것. 그건 RLS를 통째로 건너뛴다.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
    console.warn(
        '[teetime] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다.\n' +
        '.env.example을 .env로 복사해 채워 넣으세요.'
    );
}

export const supabase = createClient<Database>(
    url ?? 'http://localhost',
    anonKey ?? 'anon',
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            // 카카오 로그인은 주소창에 ?code=... 를 달고 돌아온다.
            detectSessionInUrl: true,
            flowType: 'pkce',
        },
    }
);

/**
 * 카카오 로그인으로 보낸다.
 *
 * 돌아올 곳을 현재 주소로 잡는다. 해시 라우팅(`/#/...`)을 쓰므로
 * 어느 화면에서 눌러도 origin + pathname 이면 충분하다.
 *
 * `scopes`는 우리가 쓰는 두 항목을 적어 둔 것이다. 다만 **이걸로
 * `account_email`을 뺄 수는 없다** — Supabase는 클라이언트가 무엇을 보내든
 * 카카오 기본 항목(`account_email` 포함)에 **덧붙이기만** 한다.
 * 그래서 이메일 동의항목이 꺼져 있으면 `KOE205 잘못된 요청`으로 막힌다.
 * 카카오는 이메일을 **비즈 앱**에서만 열어 주므로, 이 앱은 비즈 앱으로
 * 전환해 두어야 한다 (사업자번호 없이 본인인증만으로 된다. `docs/설치.md` 3-1).
 * 전환해도 이메일은 **선택 동의**로 두면 되고, 앱은 이메일을 쓰지 않는다
 * (Supabase의 `Allow users without an email`이 켜져 있어야 하는 이유다).
 *
 * 참고: supabase/supabase#36878 — 개인 개발자가 카카오 로그인을 못 쓰는 문제로
 * 열려 있다. 그쪽이 고쳐지면 이 전환은 필요 없어진다.
 */
/**
 * 앱(Capacitor)에서 로그인을 마치고 돌아올 주소.
 *
 * **앱 안에서는 카카오가 로그인을 막는다** — 앱에 박힌 웹 화면(웹뷰)에서
 * 들어오는 로그인을 카카오가 거절하기 때문이다. 그래서 앱에서는 로그인만
 * **바깥 브라우저로 내보내고**, 끝나면 이 주소로 앱을 다시 부른다.
 * 받는 곳은 `lib/native.ts`다.
 *
 * **카카오 콘솔은 안 건드려도 된다** — 카카오가 보는 것은 늘 Supabase의
 * 콜백 주소 하나뿐이고, 이 스킴은 그 **뒤에** Supabase가 우리를 부를 때만
 * 쓰인다. 그래서 등록할 곳은 **Supabase의 Redirect URLs 한 곳**이다
 * (`docs/출시-전-할일.md` 0-3번).
 */
export const NATIVE_REDIRECT = 'kkakkung://auth';

/**
 * 로그인 갈래 둘이 **한 코드를 쓴다.**
 *
 * 돌아올 곳·앱에서 바깥 브라우저로 여는 것·오류를 던지는 것이 카카오와
 * 애플에 똑같이 걸리므로, 갈리는 것은 **공급자 이름과 scopes뿐**이다.
 * 두 벌로 두면 한쪽만 고치게 된다(앱에서 웹뷰를 안 옮기는 그 줄이 특히 그렇다).
 */
async function startOAuth(provider: 'kakao' | 'apple', scopes?: string) {
    const native = Capacitor.isNativePlatform();

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
            redirectTo: native
                ? NATIVE_REDIRECT
                : window.location.origin + window.location.pathname,
            scopes,
            // 앱에서는 웹뷰를 옮기지 않는다 — 주소만 받아서 바깥 브라우저로
            // 연다. 이게 없으면 웹뷰 안에서 열려 카카오가 막는다.
            skipBrowserRedirect: native,
        },
    });
    if (error) throw error;

    if (native && data?.url) {
        // **`window.open`이 아니라 이 플러그인이어야 한다** — 아이폰에서
        // 사파리 창(SFSafariViewController)으로 떠서 카카오가 정상 브라우저로
        // 봐 준다. 무겁지 않게 native일 때만 불러온다.
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: data.url });
    }
}

export function signInWithKakao() {
    return startOAuth('kakao', 'profile_nickname profile_image');
}

/**
 * **애플 심사 4.8 때문에 있는 길이다.** 카카오 같은 **남의 로그인만** 쓰는
 * 앱에는 그것과 맞먹는 로그인을 하나 더 내놓으라고 요구한다 — 한국 앱이
 * 이걸로 반려된 사례가 많다(`docs/출시-전-할일.md` 0-7번).
 *
 * **`scopes`를 안 준다.** 애플은 이름을 **맨 처음 허락할 때 딱 한 번**만
 * 주고 그다음부터는 안 준다 — 그 한 번을 놓치면 되받을 길이 아예 없으므로
 * **애초에 안 받는 쪽으로 두고**, 닉네임은 앱이 직접 묻는다
 * (`needsProfile` → `FillProfile`). 그래야 어느 판에서 들어오든 규칙이 같다.
 *
 * 이메일은 `abc@privaterelay.appleid.com` 같은 가림 주소로 올 수 있다.
 * **우리는 이메일을 안 쓰므로** 그래도 아무 상관이 없다.
 */
export function signInWithApple() {
    return startOAuth('apple');
}

export async function signOut() {
    await supabase.auth.signOut();
}
