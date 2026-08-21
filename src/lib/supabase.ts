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
 * **`scopes`를 반드시 적어 보낸다.** 비워 두면 Supabase가 카카오에
 * `account_email`(이메일)까지 함께 요구하는데, 비즈 앱이 아니면 그 항목을
 * 쓸 수 없어 카카오가 `KOE205 잘못된 요청`으로 막아 버린다 — 로그인 화면이
 * 아예 안 뜬다. 우리가 쓰는 건 닉네임과 프로필 사진 둘뿐이므로 그 둘만 적는다.
 * (카카오 콘솔의 동의항목에서도 이 둘이 사용 설정되어 있어야 한다.)
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
