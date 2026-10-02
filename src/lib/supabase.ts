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
const realUrl = import.meta.env.VITE_SUPABASE_URL;
const realKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * **심사용 서버** — 애플·구글 심사자가 쓰는 별도 Supabase 프로젝트다
 * (사용자가 정했다 — 실제 모임과 완전히 갈라 둔다). 심사자는 로그인 화면의
 * `심사용 테스트 계정`으로 들어오고, 그러면 **이 기기만** 그 서버에 붙는다.
 * 실제 회원 100명의 이름·대화는 거기 없고, 심사자가 글을 써도 회원 폰이
 * 안 울린다. 표·샘플 자료·심사 계정은 `.github/workflows/review.yml`이 채운다.
 *
 * - **고른 서버는 `localStorage`의 `teetime:server`에 남는다** — 클라이언트는
 *   파일을 불러오는 그 순간 한 번 만들어지므로, 바꿀 때는 화면을 다시 연다
 *   (`switchReviewServer`). 로그인 상태는 서버마다 따로 저장돼(열쇠 이름에
 *   프로젝트 id가 든다) 오가도 실제 로그인이 안 풀린다.
 * - **값이 없는 판(로컬 · 옛 빌드)에서는 그 길이 통째로 안 보인다**(`hasReviewServer`).
 * - 앱 화면(Swift)에 넘기는 주소·키도 **반드시 `SUPABASE_URL`·`SUPABASE_KEY`를
 *   쓸 것** — `import.meta.env`를 직접 읽으면 심사자의 앱 화면만 실제 서버로 간다.
 */
const reviewUrl = import.meta.env.VITE_REVIEW_SUPABASE_URL as string | undefined;
const reviewKey = import.meta.env.VITE_REVIEW_SUPABASE_ANON_KEY as string | undefined;
const SERVER_KEY = 'teetime:server';

export const hasReviewServer = Boolean(reviewUrl && reviewKey);

function wantReview(): boolean {
    try { return localStorage.getItem(SERVER_KEY) === 'review'; } catch { return false; }
}

/** 이 화면이 지금 심사용 서버에 붙어 있는가. */
export const onReviewServer = hasReviewServer && wantReview();

const url = onReviewServer ? reviewUrl : realUrl;
const anonKey = onReviewServer ? reviewKey : realKey;
export const SUPABASE_URL: string = url ?? '';
export const SUPABASE_KEY: string = anonKey ?? '';

/** 서버를 바꾸고 화면을 다시 연다 — 로그인 화면에서만 부른다. */
export function switchReviewServer(on: boolean) {
    try {
        if (on) localStorage.setItem(SERVER_KEY, 'review');
        else localStorage.removeItem(SERVER_KEY);
    } catch { /* 저장이 막힌 기기 — 다시 열어도 그대로다 */ }
    location.reload();
}

/** 심사용 테스트 계정 로그인(이메일·비밀번호). 심사용 서버에서만 쓴다. */
export async function signInWithPassword(email: string, password: string) {
    if (!onReviewServer) throw new Error('심사용 서버가 아닙니다.');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
        throw new Error(/invalid login|credentials/i.test(error.message)
            ? '이메일이나 비밀번호가 맞지 않습니다.'
            : error.message);
    }
    // 앱을 껐다 켜도 심사용 서버로 돌아오게 다시 적어 둔다(로그아웃이 지웠을 수 있다).
    try { localStorage.setItem(SERVER_KEY, 'review'); } catch { /* 무시 */ }
}

export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
    console.warn(
        '[teetime] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다.\n' +
        '.env.example을 .env로 복사해 채워 넣으세요.'
    );
}

/**
 * **로그인 서버(`/auth/v1/`)에 가는 요청에만 시간 제한을 건다**(사용자 제보 —
 * `어제 저녁에 앱사용하고 아침에 … 새로고침해도 반응도없고 새 정보를 받아오지못해` ·
 * 화면에는 `로그인을 확인하지 못했습니다`).
 *
 * 브라우저의 `fetch`에는 시간 제한이 없다. 밤새 잠들었던 폰이 깨어나는 그 순간
 * supabase-js가 토큰 갱신을 보내는데, 그 요청이 **죽은 연결에 걸려 답이 영영 안
 * 오면** supabase-js는 그 한 건을 모두가 기다리게 묶어 둔다(`refreshingDeferred`) —
 * 그 뒤의 갱신이 전부 같은 약속에 매달려 **앱을 완전히 껐다 켜기 전까지 멈춘다.**
 * 앱 화면은 웹에 새 토큰을 부탁하고 12초를 기다리다 그 문구를 띄운다.
 *
 * 8초에 끊으면 supabase-js가 그것을 '다시 해 볼 실패'로 보고 새 연결로 곧바로
 * 다시 보낸다 — 앱이 기다리는 12초 안에 끝난다. **사진 올리기(Storage)·조회는
 * 안 건드린다** — 50MB 원본을 8초에 끊으면 안 된다.
 */
const AUTH_TIMEOUT = 8000;
function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.includes('/auth/v1/')) return fetch(input, init);
    const ctl = new AbortController();
    const outer = init?.signal;
    if (outer) {
        if (outer.aborted) ctl.abort();
        else outer.addEventListener('abort', () => ctl.abort(), { once: true });
    }
    const timer = setTimeout(() => ctl.abort(), AUTH_TIMEOUT);
    return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient<Database>(
    url ?? 'http://localhost',
    anonKey ?? 'anon',
    {
        global: { fetch: authFetch },
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
    // 심사용 서버에서 나가면 **다음 실행부터는 실제 서버**다. 지금 화면은 다시
    // 안 연다 — 앱 껍데기를 걷는 뒷정리가 아직 돌아야 한다. 로그인 화면은
    // 그대로 심사용 폼이라 다시 들어오면 `signInWithPassword`가 표를 되살린다.
    if (onReviewServer) { try { localStorage.removeItem(SERVER_KEY); } catch { /* 무시 */ } }
}

let renewing: Promise<string | null> | null = null;
/**
 * **앱 화면이 토큰을 새로 달라고 할 때**(`auth` 이벤트) 부른다 — 새 토큰을 돌려준다.
 *
 * **한 번에 하나만 돈다.** 앱이 조회를 여럿 한꺼번에 보내면 401도 여럿이 와서,
 * 예전에는 화면마다 `refreshSession()`을 겹쳐 돌렸다(갱신 열쇠가 그만큼 여러 번
 * 바뀐다). **실패하면 세 번까지 다시 해 본다** — 오래 쉬다 깨어난 폰은 인터넷이
 * 다시 붙기까지 몇 초가 걸려 첫 판이 곧잘 실패하는데, 예전에는 그걸로 끝이라
 * 앱 화면이 `로그인이 만료됐습니다`로 굳었다(사용자 제보 — `앱을 한동안
 * 사용안하다가 접속하면`). **서버가 열쇠를 거절한 것(4xx)은 다시 안 해 본다** —
 * 그건 정말로 끝난 것이고, supabase-js가 스스로 로그아웃시켜 로그인 화면으로 간다.
 */
export function renewSession(): Promise<string | null> {
    if (renewing) return renewing;
    const run = (async () => {
        for (let i = 0; i < 4; i++) {
            try {
                /* **한 판이 영영 안 끝나도 여기서 끊는다** — 위 `authFetch`가 막지만,
                   이 약속이 매달리면 `renewing`이 비지 않아 그 뒤 부탁이 전부 같은
                   자리에서 멈춘다(앱을 껐다 켜기 전까지). 그것만은 없게 한다. */
                const { data, error } = await Promise.race([
                    supabase.auth.refreshSession(),
                    new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), 20000)),
                ]);
                if (data.session) return data.session.access_token;
                const status = (error as { status?: number } | null)?.status ?? 0;
                if (status >= 400 && status < 500 && status !== 408 && status !== 429) return null;
            } catch { /* 끊긴 것 — 조금 뒤 다시 */ }
            await new Promise(r => setTimeout(r, 1200 * (i + 1)));
        }
        return null;
    })();
    renewing = run;
    void run.finally(() => { if (renewing === run) renewing = null; });
    return run;
}
