import { createClient } from '@supabase/supabase-js';
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
export async function signInWithKakao() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'kakao',
        options: {
            redirectTo: window.location.origin + window.location.pathname,
            scopes: 'profile_nickname profile_image',
        },
    });
    if (error) throw error;
}

export async function signOut() {
    await supabase.auth.signOut();
}
