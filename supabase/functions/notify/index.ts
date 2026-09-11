/**
 * 알림 발송기 (Supabase Edge Function).
 *
 * DB 웹훅이 새 행을 여기로 보내면, 받을 사람을 골라 폰으로 밀어 준다.
 * 앱에는 서버가 없으므로 **밀어 주는 일은 여기 한 곳에서만** 한다.
 *
 *   messages           새 글  → 쓴 사람 빼고 회원 모두
 *                      (앱이 저절로 남긴 `system` 줄은 안 울린다 —
 *                       사람이 누른 `📣 대화방에 공유`만 예외다)
 *   profiles           새 가입 → 운영진 모두 ('pending'으로 들어온 행)
 *   rounds             새 모집 → 연 사람 빼고 회원 모두
 *   polls · posts      새 투표·공지 → 올린 사람 빼고 회원 모두
 *   rounds · polls (UPDATE)  다시 열림 → 회원 모두
 *   signups (INSERT)   대기 신청 → **그 모집을 연 사람에게만**
 *   signups (UPDATE)   대기 → 확정 → **올라간 그 사람에게만**
 *   round_groups       조 편성 → **그 라운드의 확정 참가자에게만**
 *   round_reminders    필드는 전날 저녁 · 스크린은 시작 2시간 전
 *                      → **그 라운드의 확정 참가자에게만**, 사람마다 자기 조로
 *   settlement_shares  정산 → **그 몫의 주인 한 사람에게만** (금액이 사람마다 다르다)
 *   settle_reminders   입금 독촉 → **아직 안 낸 사람에게만**
 *
 * **`UPDATE`가 오면 그건 '뒤집혔다'는 뜻이다.** 무엇을 보고 가리는지는
 * DB 트리거의 `when` 절에 있다 — 여기서 다시 가리지 않는다. 라운드·투표는
 * '다시 열림', 신청은 '대기에서 확정으로 올라감'이다.
 *
 * **받는 곳이 셋이다** — 홈 화면 웹앱은 웹푸시로, **아이폰 앱은 애플에
 * 바로**(APNs), **안드로이드 앱은 구글을 거쳐**(FCM) 민다. 앱 안에는
 * 웹푸시가 아예 없고, 안드로이드는 구글 말고 길이 없기 때문이다.
 * 가르는 것은 구독 주소의 `apns:` · `fcm:` 표시뿐이고, **누구에게
 * 보낼지를 정하는 규칙은 한 벌 그대로다**(`planFor`).
 *
 * 웹훅은 Supabase 화면(Database → Webhooks)에서 건다. 보낼 때
 * `x-notify-secret` 헤더에 NOTIFY_SECRET을 넣게 해 두었다 — 이 함수는
 * 인증 없이 열려 있으므로 그 값이 맞을 때만 일한다.
 *
 * 필요한 Secret (Edge Functions → Secrets):
 *   VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · VAPID_SUBJECT · NOTIFY_SECRET
 * SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY는 자동으로 들어 있다.
 */

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';

webpush.setVapidDetails(
    env('VAPID_SUBJECT') || 'mailto:noreply@example.com',
    env('VAPID_PUBLIC_KEY'),
    env('VAPID_PRIVATE_KEY'),
);

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

/* ══ 앱(아이폰)으로 보내기 — 애플에 바로 민다 ═══════════════════════
 *
 * **아이폰 앱 안에는 웹푸시가 없다.** 서비스워커도 안 돌아서, 앱으로
 * 옮겨 간 회원은 소식을 **한 건도 못 받고 있었다.**
 *
 * **FCM이 아니라 애플에 바로 보낸다.** 지금 내는 것이 아이폰뿐이라
 * 파이어베이스를 끼우면 손만 더 간다(프로젝트 만들기 · 앱 등록 ·
 * `GoogleService-Info.plist` · APNs 키 올리기 · 서비스 계정 JSON).
 * 애플에 직접 보내면 그 다섯이 **`.p8` 열쇠 하나**로 줄어든다.
 * 안드로이드를 낼 때 FCM을 더하면 되고, 그때도 아래 짜임은 그대로 쓴다.
 *
 * **비밀값이 없으면 조용히 지나간다** — 앱 알림을 아직 안 켠 저장소에서
 * 웹 알림까지 막히면 안 된다.
 *
 * 필요한 Secret (Edge Functions → Secrets):
 *   APNS_KEY_P8 · APNS_KEY_ID · APNS_TEAM_ID
 *   (APNS_BUNDLE_ID · APNS_HOST 는 안 넣으면 아래 기본값을 쓴다)
 */
const APNS_HOST = env('APNS_HOST') || 'https://api.push.apple.com';
const APNS_TOPIC = env('APNS_BUNDLE_ID') || 'com.kkakkung.app';
/** 이 기기는 앱인가. 웹 구독 주소는 `https://…`이라 섞일 일이 없다. */
const APNS_MARK = 'apns:';

/* 아이폰 알림음. 앱 번들 맨 위의 그 파일 이름이다(`ios/App/App/kkakkung.wav`).
   **비밀값으로 비워 두면 폰 기본음으로 돌아간다**(`APNS_SOUND=default`) —
   소리가 거슬린다는 말이 나오면 앱을 다시 만들지 않고 여기서 되돌린다. */
const APNS_SOUND = env('APNS_SOUND') || 'kkakkung.wav';

function b64url(bytes: ArrayBuffer | Uint8Array): string {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return btoa(String.fromCharCode(...b))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `.p8`(PEM)에서 열쇠를 꺼낸다. 줄바꿈이 `\n` 글자로 들어와도 받아 준다. */
async function apnsKey(): Promise<CryptoKey> {
    const pem = env('APNS_KEY_P8').replace(/\\n/g, '\n');
    const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
    return await crypto.subtle.importKey(
        'pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/**
 * 애플에 낼 표(JWT).
 *
 * **한 번 만들어 두고 다시 쓴다.** 애플은 같은 열쇠로 **20분에 한 번보다
 * 자주 새로 만들면** `TooManyProviderTokenUpdates`로 막는다 — 알림 한 건마다
 * 새로 만들면 바쁜 날 그대로 걸린다. Edge Function은 한 번 깨어나면 잠시
 * 살아 있으므로 이 모듈 값이 그동안 그대로 쓰인다(식으면 다시 만든다).
 */
let token: { jwt: string; at: number } | null = null;
async function apnsJwt(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (token && now - token.at < 45 * 60) return token.jwt;
    const head = b64url(new TextEncoder().encode(
        JSON.stringify({ alg: 'ES256', kid: env('APNS_KEY_ID') })));
    const body = b64url(new TextEncoder().encode(
        JSON.stringify({ iss: env('APNS_TEAM_ID'), iat: now })));
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, await apnsKey(),
        new TextEncoder().encode(`${head}.${body}`));
    const jwt = `${head}.${body}.${b64url(sig)}`;
    token = { jwt, at: now };
    return jwt;
}

/** 앱으로 보낼 수 있는 저장소인가. 열쇠 셋이 다 있어야 한다. */
const canApns = () =>
    !!(env('APNS_KEY_P8') && env('APNS_KEY_ID') && env('APNS_TEAM_ID'));

/**
 * 한 대에 민다. 보냈으면 true, **못 쓰게 된 토큰이면 'dead'**.
 *
 * 앱을 지웠거나 다시 깐 폰은 `410 Unregistered` · `400 BadDeviceToken`으로
 * 온다 — 그때 지워 두지 않으면 발송할 때마다 같은 실패가 쌓인다
 * (웹 구독의 404·410과 같은 자리다).
 */
async function pushToApns(
    deviceToken: string,
    note: { title: string; body: string; tag: string; url: string; badge: number; chat: boolean },
): Promise<'ok' | 'dead' | 'fail'> {
    const res = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
        method: 'POST',
        headers: {
            authorization: `bearer ${await apnsJwt()}`,
            'apns-topic': APNS_TOPIC,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            /* **웹의 `tag`와 같은 뜻**을 애플에서는 `collapse-id`가 한다 —
               같은 값이면 알림창에서 뒤엣것이 앞엣것을 대신한다.
               64바이트를 넘으면 애플이 통째로 거절하므로 잘라 쓴다. */
            'apns-collapse-id': note.tag.slice(0, 64),
        },
        body: JSON.stringify({
            aps: {
                alert: { title: note.title, body: note.body },
                /* **알림음도 `까꿍`이다.** 소리 파일은 앱 번들 맨 위에
                   들어 있다(`ios/App/App/kkakkung.wav` — 16비트 PCM ·
                   0.59초. 아이폰은 30초 넘거나 PCM이 아니면 안 받는다).
                   **파일 이름만 적는다** — `public/` 아래에 두면 iOS가
                   못 찾는다(번들 맨 위나 `Library/Sounds`만 본다).
                   **못 찾으면 폰 기본음으로 울릴 뿐 알림은 그대로 뜬다** —
                   그래서 이 파일이 없는 옛 앱에서도 탈이 없다. */
                sound: APNS_SOUND,
                /* **아이콘 위 빨간 숫자.** 앱 안에는 서비스워커가 없어서
                   웹에서 숫자를 세던 `sw.js`의 `bumpBadge`가 아예 안 돈다 —
                   이 값을 안 실으면 **앱에는 표시가 통째로 안 붙는다.**
                   **카톡처럼 안 읽은 대화 + 안 읽은 알림 개수다**(`badge_counts`).
                   0이면 iOS가 표시를 지우므로, 다 읽은 사람에게 알림이
                   갈 때 저절로 깨끗해진다. */
                badge: note.badge,
                /* 같은 이야기끼리 묶어 준다(알림창에서 접힌다). */
                'thread-id': note.tag,
            },
            /* **갈 곳은 웹과 같은 값이다** — `lib/native-push.ts`가
               `data.url`로 받아 그 화면으로 옮긴다. */
            url: note.url,
            /* **대화인가.** 앱이 이 표를 보고 **앞에 떠 있는 동안에는
               배너를 안 띄운다**(`ios/App/App/MainViewController.swift`의
               `QuietChatPush`) — 대화방을 열어 놓고 주고받는 내내 제 화면
               위로 배너가 덮였다는 제보에서 나온 것이다. 나머지 알림은
               그대로 뜬다. 이 표를 모르는 옛 앱은 그냥 지나간다. */
            chat: note.chat,
        }),
    });
    if (res.ok) return 'ok';
    const why = await res.text().catch(() => '');
    if (res.status === 410 || (res.status === 400 && why.includes('BadDeviceToken'))) return 'dead';
    /* **`BadEnvironmentKeyInToken`은 열쇠를 잘못 만든 것이다.** 애플의
       Keys 화면에서 APNs에 체크할 때 `Sandbox` 하나만 고르면 그 열쇠는
       **개발용에만** 통하는데, TestFlight·앱스토어로 깐 앱은 늘
       `Production`으로 온다 — 그 어긋남이 이 403이다.
       코드로는 못 고치는 자리라(열쇠를 새로 만들어야 한다) **무엇을
       해야 하는지 로그에 그대로 적는다.** 안 적으면 애플의 영문 한 줄만
       남아 어디를 고쳐야 하는지 알 길이 없다(`docs/설치.md` 7-1번). */
    if (why.includes('BadEnvironmentKeyInToken')) {
        console.error(
            'apns 403 BadEnvironmentKeyInToken — 열쇠(.p8)가 Sandbox 전용입니다. '
            + '애플 개발자 사이트 → Keys 에서 APNs 환경을 `Sandbox & Production`으로 '
            + '만든 새 열쇠로 APNS_KEY_P8 · APNS_KEY_ID 를 바꿔 주세요.',
        );
        return 'fail';
    }
    console.error('apns', res.status, why);
    return 'fail';
}

interface Hook {
    type: 'INSERT' | 'UPDATE' | 'DELETE';
    table: string;
    record: Record<string, unknown> | null;
    old_record: Record<string, unknown> | null;
}

interface Note {
    title: string;
    body: string;
    tag: string;
    url: string;
    /** 이 사람들에게만. 비우면 (보낸 사람 빼고) 회원 모두. */
    only?: string[];
    except?: string | null;
    /**
     * 기기가 따로 끌 수 있는 갈래. 지금은 대화 하나뿐이다 —
     * 종일 울리는 것이 그것뿐이라, 그것 때문에 알림을 통째로 끄는 일을
     * 막으려고 두었다. 갈래가 없는 알림(모집·공지·투표·가입)은 켜 둔
     * 기기 모두에게 간다.
     */
    channel?: 'chat';
    /**
     * 갈래를 껐어도 이 사람들에게는 보낸다. `@언급`과 **내 글에 달린
     * 답장**이 그렇다 — 한 사람을 콕 집은 글은 '알아 두라'가 아니라
     * '지금 봐 달라'라서, 그것까지 막히면 부르거나 답할 이유가 없어진다.
     */
    always?: string[];
    /**
     * 사람마다 다른 본문. 여기 이름이 있는 사람은 `body` 대신 이걸 받는다.
     *
     * **라운드 알림 하나 때문에 있다.** 같은 라운드라도 조와 조별 시각이
     * 사람마다 달라서, 한 문구로 보내면 `조 편성을 확인하세요`밖에 못 적는다 —
     * 그러면 앱을 열어 봐야 하니 알림을 보내는 뜻이 반쯤 없어진다.
     * (정산은 몫 행 하나가 사람 하나라 이게 필요 없었다.)
     */
    bodyBy?: Record<string, string>;
}

/** `오전 7:30` — 발송기에는 앱의 `lib/format`이 없어 여기 따로 둔다. */
const kstTimeFmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit', hour12: true,
});
const kstTime = (iso: unknown): string =>
    typeof iso === 'string' && iso ? kstTimeFmt.format(new Date(iso)) : '';

/** `9월 5일 (토) 오전 7:30` — 공유 알림처럼 날짜까지 필요한 자리에 쓴다. */
const kstWhenFmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
});
const kstWhen = (iso: unknown): string =>
    typeof iso === 'string' && iso ? kstWhenFmt.format(new Date(iso)) : '';

/** 이름을 붙여 준다. 누가 썼는지가 알림에서 제일 중요하다. */
async function nameOf(id: unknown): Promise<string> {
    if (typeof id !== 'string') return '누군가';
    const { data } = await db.from('profiles').select('name').eq('id', id).maybeSingle();
    return (data?.name as string) || '누군가';
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 모두를 한 번에 부르는 이름. **`src/lib/mention.ts`의 `ALL_MENTION`과
 * 같아야 한다** — 앱과 발송기는 따로 올라가므로 한쪽만 고치면 화면에는
 * 도드라지는데 알림은 안 온다.
 */
const ALL_MENTION = '전체';

/**
 * 직책 묶음. **`src/lib/types.ts`·`src/lib/auth.tsx`와 같아야 한다.**
 *
 * 직책을 넷으로 늘리면서 여기 목록을 빠뜨려 두 가지가 조용히 죽었다 —
 * 총무·앱관리자는 `@언급`을 해도 알림이 안 갔고(명단에 없어 이름이
 * 안 맞았다), 앱관리자가 쓴 `@전체`는 운영진으로 안 쳐서 안 뚫렸으며,
 * 가입 신청도 앱관리자에게는 안 갔다. **직책을 늘리면 여기도 함께 고칠 것.**
 */
const MEMBERS = ['member', 'treasurer', 'staff', 'admin', 'superadmin'];
const STAFF_UP = ['staff', 'admin', 'superadmin'];

/**
 * 글에서 `@이름`으로 부른 사람들.
 *
 * **대화 알림을 꺼 둔 기기에도 이건 간다.** 부르는 것은 '알아 두라'가
 * 아니라 '지금 봐 달라'라서, 그것까지 막히면 부를 이유가 없어진다.
 *
 * `@전체`는 **운영진(운영자·부운영자)이 썼을 때만** 모두를 부른 것으로 본다.
 * 서른 명의 폰을 한꺼번에 울리면서 대화 알림 스위치까지 뚫는 일이라,
 * 아무나 쓰면 그 스위치가 있으나 마나가 된다. 화면에서 목록을 감추는
 * 것만으로는 손으로 쳐 넣는 것을 못 막으므로 **여기서 다시 확인한다.**
 *
 * 맞추는 규칙은 앱 화면(`src/lib/mention.ts`의 `splitMentions`)과 같아야
 * 한다 — **긴 이름 먼저**(`김지`와 `김지명`이 함께 있으면 뒤엣것).
 * 한쪽만 고치면 화면에는 도드라지는데 알림은 안 오는 일이 생긴다.
 */
async function mentionedIds(body: unknown, authorId: unknown): Promise<string[]> {
    if (typeof body !== 'string' || !body.includes('@')) return [];
    const { data } = await db.from('profiles')
        .select('id, name, role').in('role', MEMBERS);
    const list = (data ?? [])
        .filter(p => typeof p.name === 'string' && p.name)
        .sort((a, b) => String(b.name).length - String(a.name).length);
    if (!list.length) return [];

    // 쓴 사람이 운영진이면 `@전체`도 이름 하나처럼 맞춰 본다.
    const staff = list.some(
        p => p.id === authorId && STAFF_UP.includes(String(p.role)));
    const words = [...new Set([
        ...(staff ? [ALL_MENTION] : []),
        ...list.map(p => String(p.name)),
    ])].sort((a, b) => b.length - a.length);

    const re = new RegExp(`@(${words.map(escapeRe).join('|')})`, 'g');
    const called = new Set([...body.matchAll(re)].map(m => m[1]));
    // `@전체` 한 번이면 나머지는 볼 것도 없다 — 어차피 다 부른 것이다.
    if (called.has(ALL_MENTION)) return list.map(p => p.id as string);
    return list.filter(p => called.has(String(p.name))).map(p => p.id as string);
}

/** 답장이면 원본을 쓴 사람. 답장이 아니거나 원본이 지워졌으면 null. */
async function repliedAuthor(replyTo: unknown): Promise<string | null> {
    if (typeof replyTo !== 'string' || !replyTo) return null;
    const { data } = await db.from('messages')
        .select('user_id').eq('id', replyTo).maybeSingle();
    return (data?.user_id as string) ?? null;
}

/**
 * 대화 알림을 꺼 두었어도 받아야 할 사람들.
 *
 * 둘 다 **한 사람을 콕 집은 글**이라 같이 다룬다 — 이름을 부른 것과
 * 내 글에 답장이 달린 것. 나머지 잡담과 달리 '지금 봐 달라'는 신호라,
 * 이것까지 막히면 부르거나 답할 이유가 없어진다.
 */
async function alwaysFor(r: Record<string, unknown>): Promise<string[]> {
    const ids = new Set(await mentionedIds(r.body, r.user_id));
    const replied = await repliedAuthor(r.reply_to);
    if (replied) ids.add(replied);
    return [...ids];
}

/**
 * 사람이 `📣 대화방에 공유`로 올린 라운드 줄.
 *
 * `system` 줄은 원래 안 울리는데(위 planFor 참고) 이것만 뚫는다 —
 * **자리가 남았다고 다시 알리는 것이 그 단추의 목적**이라, 대화방에만
 * 남으면 하루 백 마디가 쌓이는 방에서 또 묻힌다.
 *
 * **문구를 글에서 가져오지 않는다.** 대화 글은 회원이 손으로도 넣을 수
 * 있는 값이라, 라운드를 다시 읽어 거기서 짠다 — 무엇을 적어 보내든
 * 알림에는 그 라운드의 사실만 나간다.
 *
 * `tag`는 모집 알림과 **같은** `round-`다. 같은 라운드 이야기라 알림창에
 * 두 줄이 쌓일 이유가 없고, 뒤엣것이 앞엣것을 대신하는 것이 맞다.
 */
async function shareNote(r: Record<string, unknown>): Promise<Note | null> {
    if (r.notify !== true || typeof r.round_id !== 'string') return null;
    const { data: rd } = await db.from('rounds')
        .select('course, title, kind, tee_at, capacity').eq('id', r.round_id).maybeSingle();
    if (!rd) return null;
    const screen = rd.kind === 'screen';
    const where = (rd.course as string) || (rd.title as string)
        || (screen ? '스크린' : '라운드');
    const who = await nameOf(r.user_id);
    return {
        title: screen ? '🎯 스크린 공유' : '⛳ 라운드 공유',
        body: `${who}님이 올렸습니다\n${where} · ${kstWhen(rd.tee_at)}`,
        tag: `round-${r.round_id}`,
        url: `#/rounds/${r.round_id}`,
        except: typeof r.user_id === 'string' ? r.user_id : null,
    };
}

/* ══ 안드로이드로 보내기 — FCM ═══════════════════════════════════
 *
 * **안드로이드는 FCM 말고 길이 없다.** 아이폰은 애플에 바로 보내면
 * 되지만(위 참고) 안드로이드 알림은 구글을 반드시 거친다.
 *
 * 열쇠는 **서비스 계정 JSON** 하나다(`FCM_SERVICE_ACCOUNT`). 파이어베이스
 * 콘솔에서 받아 그대로 붙여넣으면 되고, 그 안의 `project_id`까지 우리가
 * 꺼내 쓰므로 **넣을 비밀값이 하나뿐**이다.
 *
 * **없으면 조용히 지나간다** — 웹·아이폰 알림까지 막히면 안 된다.
 */
const FCM_MARK = 'fcm:';

/* 안드로이드 알림음. **아이폰과 달리 파일 이름이 아니라 `채널` 이름이다** —
   안드로이드 8부터 소리는 payload가 아니라 채널에 박혀 있고, 그 채널은
   앱이 미리 만들어 둔다(`android/app/src/main/java/.../MainActivity.java`).
   **`android/app/src/main/res/values/notify.xml`의 `notify_channel_id`와
   같은 글자여야 한다** — 어긋나면 안드로이드가 모르는 채널로 보고
   매니페스트의 기본 채널로 떨어뜨린다(거기도 `까꿍`이라 소리는 나지만,
   둘이 갈린 채로 굳으면 다음에 채널을 올릴 때 조용히 어긋난다).
   **비밀값으로 갈아 끼울 수 있다**(`FCM_CHANNEL_ID`) — 앱을 다시 안 만들고
   되돌릴 길을 아이폰(`APNS_SOUND`)과 같이 남겨 둔 것이다. */
const FCM_CHANNEL = env('FCM_CHANNEL_ID') || 'kkakkung_v1';
/* 안드로이드 8 **미만**에만 쓰이는 값이다(거기는 채널이 없다).
   확장자를 뺀 `res/raw`의 파일 이름이다. */
const FCM_SOUND = env('FCM_SOUND') || 'kkakkung';

interface Account { client_email: string; private_key: string; project_id: string }

function account(): Account | null {
    const raw = env('FCM_SERVICE_ACCOUNT');
    if (!raw) return null;
    try {
        const a = JSON.parse(raw) as Account;
        return a.client_email && a.private_key && a.project_id ? a : null;
    } catch {
        console.error('fcm: 서비스 계정 JSON을 못 읽었습니다');
        return null;
    }
}

/**
 * 구글에 낼 표(access token).
 *
 * 서비스 계정으로 **서명한 JWT를 구글에 주고 바꿔 받는다**(RS256).
 * 한 시간짜리라 **받아 두고 다시 쓴다** — 알림 한 건마다 받아 오면
 * 구글에 다녀오는 왕복이 그만큼 는다.
 */
let gtoken: { at: number; token: string } | null = null;
async function fcmToken(a: Account): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (gtoken && now - gtoken.at < 45 * 60) return gtoken.token;

    const body = a.private_key.replace(/\\n/g, '\n')
        .replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const key = await crypto.subtle.importKey(
        'pkcs8', Uint8Array.from(atob(body), c => c.charCodeAt(0)),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);

    const head = b64url(new TextEncoder().encode(
        JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const claim = b64url(new TextEncoder().encode(JSON.stringify({
        iss: a.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    })));
    const sig = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${head}.${claim}.${b64url(sig)}`,
        }),
    });
    const got = await res.json() as { access_token?: string; error_description?: string };
    if (!got.access_token) throw new Error(got.error_description ?? '구글이 표를 안 줬습니다');
    gtoken = { at: now, token: got.access_token };
    return got.access_token;
}

/**
 * 한 대에 민다. 애플 쪽(`pushToApns`)과 답이 같은 모양이다.
 *
 * **앱을 지웠거나 토큰이 바뀐 폰은 `404 UNREGISTERED`로 온다** — 그때
 * 지워 두지 않으면 발송할 때마다 같은 실패가 쌓인다.
 */
async function pushToFcm(
    a: Account, deviceToken: string,
    note: { title: string; body: string; tag: string; url: string; badge: number; chat: boolean },
): Promise<'ok' | 'dead' | 'fail'> {
    const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`,
        {
            method: 'POST',
            headers: {
                authorization: `Bearer ${await fcmToken(a)}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                message: {
                    token: deviceToken,
                    notification: { title: note.title, body: note.body },
                    /* **갈 곳은 웹·아이폰과 같은 값이다** —
                       `lib/native-push.ts`가 `data.url`로 받는다.
                       FCM의 `data`는 글자만 담을 수 있다.
                       `chat`은 아이폰과 같은 표다 — **안드로이드는 아직
                       이걸 안 본다**(배너를 띄우는 자리가 플러그인 안에
                       있어 끼어들 데가 없다). 아이폰과 같은 값을 실어 두어
                       나중에 손댈 때 발송기를 다시 안 고치게 한 것이다. */
                    data: { url: note.url, chat: note.chat ? '1' : '0' },
                    android: {
                        priority: 'HIGH',
                        /* `tag`가 애플의 `collapse-id`와 같은 일을 한다 —
                           같은 값이면 알림창에서 뒤엣것이 앞엣것을 대신한다. */
                        /* 아이콘 위 숫자. **런처마다 다르게 그린다** —
                           삼성은 숫자로, 순정은 점만 찍거나 아예 안 그린다.
                           안 되는 기기에서도 알림은 그대로 뜬다. */
                        notification: {
                            tag: note.tag,
                            notification_count: note.badge,
                            /* **`까꿍` 소리가 나는 자리다.** 안드로이드 8부터는
                               이 `channel_id`가 가리키는 채널의 소리로 울린다
                               (앱이 `MainActivity`에서 만들어 둔 그것).
                               `sound`는 8 미만 폰 몫이라 함께 적어 둔다. */
                            channel_id: FCM_CHANNEL,
                            sound: FCM_SOUND,
                        },
                    },
                },
            }),
        });
    if (res.ok) return 'ok';
    const why = await res.text().catch(() => '');
    if (res.status === 404 || why.includes('UNREGISTERED') || why.includes('INVALID_ARGUMENT')) {
        return 'dead';
    }
    console.error('fcm', res.status, why);
    return 'fail';
}

async function planFor(hook: Hook): Promise<Note | null> {
    const r = hook.record ?? {};

    if (hook.table === 'messages' && hook.type === 'INSERT') {
        /* **앱이 스스로 남긴 줄에는 알림을 안 보낸다.** 라운드·투표가
           올라오면 DB 트리거가 대화방에도 한 줄 적는데(`announce_to_chat`),
           그 건은 `⛳ 새 모집` 알림이 이미 나간 뒤다 — 여기서 또 보내면
           같은 일로 두 번 울린다.

           **딱 하나 예외가 `notify`가 선 줄이다** — 라운드 상세의
           `📣 대화방에 공유`로 **사람이 눌러서** 올린 것이라, 자리가 남았다고
           다시 알리는 것이 그 단추의 목적이다. 대화방에만 남으면 하루에
           백 마디가 쌓이는 방에서 또 묻힌다.
           **문구는 글이 아니라 라운드에서 다시 짠다** — 대화 글은 회원이
           손으로도 넣을 수 있는 값이라, 거기 적힌 것을 그대로 백 명의
           알림창에 띄우지 않으려는 것이다. */
        if (r.system === true) return shareNote(r);

        const who = await nameOf(r.user_id);
        /* 사진과 이모티콘은 `messages.image_url` 한 칸을 같이 쓴다 —
           `sticker:`로 시작하면 이모티콘이다(`src/lib/stickers.ts`).
           **어느 이모티콘인지는 안 적는다** — 이름 목록을 발송기에도 두면
           그림을 갈 때 양쪽을 고쳐야 한다. 알림창에서 궁금한 것은
           '누가 뭘 보냈나'까지다. */
        const pic = typeof r.image_url === 'string' ? r.image_url : '';
        const text = typeof r.body === 'string' && r.body.trim()
            ? r.body.trim()
            : (pic.startsWith('sticker:') ? '이모티콘을 보냈습니다'
               : pic ? '사진을 보냈습니다' : '');
        return {
            // **무엇에 대한 알림인지 제목 첫머리에 세운다.** 알림창에는 제목
            // 한 줄만 보이는 때가 많아, 이름만 있으면 대화인지 모집인지
            // 열어 봐야 안다.
            title: `💬 대화 · ${who}`,
            body: text.slice(0, 120),
            // 대화는 한 덩어리로 묶어 알림창이 도배되지 않게 한다.
            tag: 'chat',
            url: '#/chat',
            except: typeof r.user_id === 'string' ? r.user_id : null,
            channel: 'chat',
            always: await alwaysFor(r),
        };
    }

    if (hook.table === 'rounds' && hook.type === 'INSERT') {
        const who = await nameOf(r.created_by);
        const course = typeof r.course === 'string' && r.course ? r.course : '라운드';
        // 스크린도 잦아서 알림창 한 줄만 봐도 어느 쪽인지 알아야 한다.
        // 칸이 없는(스키마를 아직 안 돌린) 저장소에서는 필드로 본다.
        const screen = r.kind === 'screen';
        return {
            title: screen ? '🎯 새 스크린' : '⛳ 새 모집',
            body: `${who}님이 ${course} 모집을 열었습니다`,
            tag: `round-${r.id}`,
            url: `#/rounds/${r.id}`,
            except: typeof r.created_by === 'string' ? r.created_by : null,
        };
    }

    if (hook.table === 'polls' && hook.type === 'INSERT') {
        const who = await nameOf(r.created_by);
        return {
            title: '🗳 새 투표',
            body: `${who}님: ${String(r.title ?? '').slice(0, 80)}`,
            tag: `poll-${r.id}`,
            // 투표가 여러 개 열려 있으면 목록으로 보내 봐야 또 찾아야 한다.
            url: `#/polls/${r.id}`,
            except: typeof r.created_by === 'string' ? r.created_by : null,
        };
    }

    /* ── 다시 열렸다 ────────────────────────────────────────────
     *
     * **여기까지 왔다는 것이 곧 '다시 열렸다'는 뜻이다.** 무엇을 보고
     * 가리는지는 DB 트리거의 `when` 절에 있다(`docs/설치.md` 3번) —
     * 마감했다 푼 것만 이 함수를 부르고, 제목만 고치거나 마감할 때는
     * 아예 안 부른다. 그래서 여기서 `old_record`를 볼 필요가 없다
     * (`notify_push()`가 그 칸을 null로 보내기도 한다).
     *
     * **말을 새로 올린 것과 갈라 적는다.** `🗳 새 투표`라고 오면 새 투표가
     * 생긴 줄 알고 들어갔다가 아까 그것을 보게 된다.
     *
     * **누가 눌렀는지는 뺄 수 없다.** 웹훅이 주는 것은 바뀐 행뿐이라
     * 누른 사람을 알 길이 없다 — `created_by`로 빼면 남이 다시 열었을 때
     * **정작 만든 사람만 소식을 못 듣는다.** 그래서 아무도 안 뺀다:
     * 누른 사람에게 한 번 더 울리는 쪽이 덜 나쁘다.
     */
    if (hook.table === 'polls' && hook.type === 'UPDATE') {
        return {
            title: '🗳 투표 다시 열림',
            body: `${String(r.title ?? '').slice(0, 80)}\n다시 고르실 수 있습니다`,
            tag: `poll-${r.id}`,
            url: `#/polls/${r.id}`,
        };
    }

    if (hook.table === 'rounds' && hook.type === 'UPDATE') {
        const course = typeof r.course === 'string' && r.course ? r.course : '라운드';
        const screen = r.kind === 'screen';
        return {
            title: screen ? '🎯 스크린 다시 열림' : '⛳ 모집 다시 열림',
            body: `${course} 모집이 다시 열렸습니다`,
            tag: `round-${r.id}`,
            url: `#/rounds/${r.id}`,
        };
    }

    /* ── 대기 신청이 들어왔다 ────────────────────────────────────
     *
     * **모집을 연 사람에게만** 간다(사용자 요청). 자리가 없어 대기를 건
     * 사람이 있다는 것은 **정원을 늘릴지 말지 정할 사람**에게 필요한
     * 소식이고, 그 사람이 곧 라운드를 연 사람이다. 지금까지는 라운드에
     * 직접 들어가 봐야 알 수 있어서, 대기자가 며칠씩 그냥 기다렸다.
     *
     * **확정으로 들어온 신청에는 안 보낸다.** 자리가 남아 있을 때 누가
     * 신청하는 것은 그냥 늘 있는 일이라, 그것까지 울리면 모집 하나에
     * 폰이 열 번 운다. 트리거의 `when`이 이미 대기만 고르지만 여기서도
     * 한 번 더 본다 — 트리거가 없는 저장소에 걸어도 조용하도록.
     *
     * **제가 열고 제가 대기를 건 경우는 뺀다.** 방금 자기 손으로 누른
     * 일을 도로 알려 줄 것 없다.
     *
     * `tag`는 **신청 한 건마다** 다르다(`wait-<신청 id>`). 라운드로 묶으면
     * 둘째 사람이 첫째를 알림창에서 밀어내는데, 대기자 둘은 **서로 다른
     * 사실**이라 하나로 덮으면 안 된다.
     */
    if (hook.table === 'signups' && hook.type === 'INSERT') {
        if (r.state !== 'waitlist' || typeof r.round_id !== 'string') return null;
        const { data: rd } = await db.from('rounds')
            .select('course, title, kind, created_by').eq('id', r.round_id).maybeSingle();
        if (!rd || typeof rd.created_by !== 'string') return null;
        if (rd.created_by === r.user_id) return null;

        const screen = rd.kind === 'screen';
        const where = (rd.course as string) || (rd.title as string)
            || (screen ? '스크린' : '라운드');
        const who = await nameOf(r.user_id);
        /* 지금 몇 명이 기다리는지까지 적는다 — **정원을 늘릴지 정하는 데
           쓰는 숫자**라, 이게 없으면 결국 앱을 열어 세어 봐야 한다.
           `head: true`라 몸통은 안 실려 온다. */
        const { count } = await db.from('signups')
            .select('id', { count: 'exact', head: true })
            .eq('round_id', r.round_id).eq('state', 'waitlist');
        const n = count ?? 0;
        return {
            title: '🙋 대기 신청',
            body: `${who}님이 ${where} 대기를 신청했습니다`
                + (n > 1 ? `\n지금 대기 ${n}명` : ''),
            tag: `wait-${r.id}`,
            url: `#/rounds/${r.round_id}`,
            only: [rd.created_by],
        };
    }

    /* ── 대기가 확정으로 올라갔다 ────────────────────────────────
     *
     * **이 알림이 없으면 올라간 사람은 앱을 열어 봐야 안다.** 자리는 남이
     * 취소할 때 나므로 본인은 아무것도 안 한 채로 확정된다 — 라운드 전날
     * 자리가 나도 모르고 안 나오는 일이 실제로 생길 자리였다.
     *
     * 트리거의 `when`이 '대기 → 확정'만 고르므로 여기서 다시 안 가린다.
     * 정원을 늘려서 여럿이 한꺼번에 올라가면 사람마다 한 번씩 온다 —
     * 각자에게 가는 소식이라 묶을 것이 없다.
     */
    if (hook.table === 'signups' && hook.type === 'UPDATE') {
        if (typeof r.user_id !== 'string') return null;
        const { data: rd } = await db.from('rounds')
            .select('course, title, kind, tee_at').eq('id', r.round_id).maybeSingle();
        const where = (rd?.course as string) || (rd?.title as string) || '라운드';
        return {
            title: '🎉 자리가 났습니다',
            body: `${where} · 대기에서 참가 확정으로 올라갔습니다`,
            /* 모집 알림(`round-`)과 갈라 둔다. 같은 tag면 알림창에서 서로를
               밀어내는데, 이건 그 모집과 별개로 읽어야 할 소식이다. */
            tag: `signup-${r.round_id}`,
            url: `#/rounds/${r.round_id}`,
            only: [r.user_id],
        };
    }

    /* ── 조 편성이 나왔다 ────────────────────────────────────────
     *
     * **확정 참가자에게만** 간다. 안 가는 라운드의 조가 몇 명인지는
     * 아무도 안 궁금하다.
     *
     * 이 표는 라운드 하나에 한 줄이라, 열여섯 명을 배정해도 알림은 한 번이다
     * (`signups`를 열여섯 줄 고치는 것에 걸었으면 열여섯 번 울렸다).
     * 저장을 다시 눌러도 바뀐 게 없으면 `set_round_groups`가 아예 안 쓰므로
     * 여기까지 오지 않는다.
     */
    if (hook.table === 'round_groups') {
        const [{ data: rd }, { data: ups }] = await Promise.all([
            db.from('rounds').select('course, title').eq('id', r.round_id).maybeSingle(),
            db.from('signups').select('user_id, grp')
              .eq('round_id', r.round_id).eq('state', 'confirmed'),
        ]);
        const rows = ups ?? [];
        const groups = new Set(
            rows.map(x => x.grp).filter(g => g !== null && g !== undefined)).size;
        const where = (rd?.course as string) || (rd?.title as string) || '라운드';
        return {
            title: '🚩 조 편성',
            body: `${where} · ${groups}개 조로 나뉘었습니다`,
            tag: `groups-${r.round_id}`,
            url: `#/rounds/${r.round_id}`,
            // 짠 사람은 방금 자기 손으로 저장했다. 본인에게까지 울릴 것 없다.
            only: rows.map(x => x.user_id as string).filter(id => id !== r.posted_by),
        };
    }

    /* ── 라운드가 코앞이다 ───────────────────────────────────────
     *
     * **골프는 새벽에 나간다.** 지금은 몇 시인지·몇 조인지 보려면 앱을 열어
     * 라운드까지 들어가야 하고, 그래서 깜빡하고 안 나오는 일이 생긴다.
     *
     * 두 갈래인데 **무엇을 보낼지는 표의 `kind`가 말해 준다** — 언제 보낼지를
     * 고르는 규칙은 전부 DB 함수(`queue_round_reminders`)에 있고 여기서는
     * 다시 안 가린다(라운드·투표의 '다시 열림'이 트리거의 `when`에만 적혀
     * 있는 것과 같은 규칙이다):
     *   day_before  전날 저녁 — **필드만**
     *   soon        시작 두 시간 전 — **스크린만**
     *
     * 그래서 제목은 사실상 `⛳ 내일 라운드`와 `🎯 2시간 뒤 스크린` 둘이다.
     * `🎯 내일 스크린`이 남아 있는 것은 **줄을 넣은 뒤에 종류를 스크린으로
     * 바꾼 라운드** 때문이다 — 제목을 그 라운드의 지금 종류에서 뽑으므로
     * 그때도 말이 맞는다.
     *
     * **사람마다 자기 조와 조 시각을 적어 보낸다**(`bodyBy`). 한 문구로
     * 보내면 `조 편성을 확인하세요`밖에 못 적는데, 그러면 결국 앱을 열어야
     * 해서 알림을 보내는 뜻이 반쯤 없어진다. 조를 안 짠 라운드거나 아직
     * 배정 안 된 사람에게는 그냥 `body`가 간다.
     *
     * 확정 참가자가 아무도 없으면 조용히 끝난다.
     */
    if (hook.table === 'round_reminders' && hook.type === 'INSERT') {
        const [{ data: rd }, { data: ups }, { data: grp }] = await Promise.all([
            db.from('rounds').select('course, title, kind, tee_at')
              .eq('id', r.round_id).maybeSingle(),
            db.from('signups').select('user_id, grp')
              .eq('round_id', r.round_id).eq('state', 'confirmed'),
            db.from('round_groups').select('tees').eq('round_id', r.round_id).maybeSingle(),
        ]);
        if (!rd) return null;
        const rows = ups ?? [];
        const only = rows.map(x => x.user_id as string);
        if (!only.length) return null;

        const screen = rd.kind === 'screen';
        const where = (rd.course as string) || (rd.title as string)
            || (screen ? '스크린' : '라운드');
        const when = kstTime(rd.tee_at);
        const body = `${when} · ${where}`;

        const tees = (grp?.tees ?? {}) as Record<string, string>;
        const bodyBy: Record<string, string> = {};
        for (const u of rows) {
            if (u.grp === null || u.grp === undefined) continue;
            const t = kstTime(tees[String(u.grp)]);
            bodyBy[u.user_id as string] =
                `${body}\n${u.grp}조${t ? ` · ${t}` : ''}`;
        }

        return {
            title: r.kind === 'soon'
                ? '🎯 2시간 뒤 스크린'
                : screen ? '🎯 내일 스크린' : '⛳ 내일 라운드',
            body,
            /* **모집 알림(`round-`)과 갈라 둔다.** 알림창에서 같은 tag는
               뒤엣것이 앞엣것을 덮는데, 이건 그 모집과 별개로 읽어야 할
               소식이다. 두 갈래끼리는 같은 tag를 쓴다 — 전날 알림을 아직
               안 지웠으면 두 시간 전 알림이 그 자리를 대신하는 것이 맞다. */
            tag: `remind-${r.round_id}`,
            url: `#/rounds/${r.round_id}`,
            only,
            bodyBy,
        };
    }

    if (hook.table === 'posts' && hook.type === 'INSERT') {
        return {
            title: '📢 새 공지',
            body: String(r.title ?? '').slice(0, 80),
            tag: `post-${r.id}`,
            url: `#/board/${r.id}`,
            except: typeof r.author_id === 'string' ? r.author_id : null,
        };
    }

    /* 정산은 **고른 사람에게만, 각자의 금액으로** 간다.
       몫 행(`settlement_shares`) 하나가 사람 하나라, 그 행이 들어올 때
       그 사람에게만 보내면 금액이 저절로 맞는다 — 사람마다 낼 돈이
       다르기 때문에(중간 참여자) 한 번에 묶어 보낼 수가 없다.
       `tag`를 정산 단위로 묶어 두어 알림창이 도배되지도 않는다. */
    if (hook.table === 'settlement_shares' && hook.type === 'INSERT') {
        const { data: st } = await db.from('settlements')
            .select('title, bank, account, created_by, round_id')
            .eq('id', r.settlement_id).maybeSingle();
        if (!st) return null;
        const who = await nameOf(st.created_by);
        const won = Number(r.amount ?? 0).toLocaleString('ko-KR');
        const acc = [st.bank, st.account].filter(Boolean).join(' ');
        return {
            title: '💰 정산',
            body: `${st.title} · ${won}원`
                + (acc ? `\n${acc} (${who})` : ''),
            tag: `settle-${r.settlement_id}`,
            /* **그 라운드로 바로 보낸다.** 정산은 라운드 안에 있어서
               목록으로 보내면 어느 라운드였는지 찾아 들어가야 한다.
               `round_id`가 없는 옛 행이면 목록으로라도 보낸다. */
            url: st.round_id ? `#/rounds/${st.round_id}` : '#/rounds',
            only: typeof r.user_id === 'string' ? [r.user_id] : [],
        };
    }

    /* ── 입금 독촉 ───────────────────────────────────────────────
     *
     * 총무가 `💬 아직 안 내신 분` 하고 대화방에 적던 일을 대신한다.
     * **아직 안 낸 사람에게만** 가므로, 이미 낸 사람은 재촉받지 않는다 —
     * 대화방에 적으면 그게 안 갈리는 것이 가장 성가신 점이었다.
     *
     * **금액은 안 적는다.** 이 알림 한 건이 여러 사람에게 가는데 낼 돈은
     * 사람마다 다르다(중간 참여자). 잘못 적느니 안 적고, 눌러서 들어가면
     * 자기 몫이 크게 적혀 있다. 계좌는 거기서 바로 복사할 수 있다.
     *
     * 다 낸 정산이면 보낼 사람이 없어 조용히 끝난다.
     */
    if (hook.table === 'settle_reminders' && hook.type === 'INSERT') {
        const { data: st } = await db.from('settlements')
            .select('title, bank, account, round_id')
            .eq('id', r.settlement_id).maybeSingle();
        if (!st) return null;
        const { data: unpaid } = await db.from('settlement_shares')
            .select('user_id').eq('settlement_id', r.settlement_id).eq('paid', false);
        const only = (unpaid ?? []).map(x => x.user_id as string);
        if (!only.length) return null;
        const acc = [st.bank, st.account].filter(Boolean).join(' ');
        return {
            title: '💰 입금 부탁드립니다',
            body: `${st.title}` + (acc ? `\n${acc}` : ''),
            /* 정산 알림과 **같은 tag**를 쓴다. 처음 받은 알림을 아직 안
               지웠으면 이 독촉이 그 자리를 대신한다 — 같은 정산 건으로
               알림창에 두 줄이 쌓일 이유가 없다. */
            tag: `settle-${r.settlement_id}`,
            url: st.round_id ? `#/rounds/${st.round_id}` : '#/rounds',
            only,
        };
    }

    // 가입 신청은 **운영진에게만**(부운영자·운영자·앱관리자).
    // 트리거가 만든 pending 행이 들어온다.
    if (hook.table === 'profiles' && hook.type === 'INSERT' && r.role === 'pending') {
        const { data: admins } = await db.from('profiles')
            .select('id').in('role', STAFF_UP);
        const only = (admins ?? []).map(a => a.id as string);
        if (!only.length) return null;
        return {
            title: '🙋 가입 신청',
            body: `${String(r.name ?? '') || '새 회원'}님이 승인을 기다립니다`,
            tag: 'pending',
            url: '#/members',
            only,
        };
    }

    return null;
}

Deno.serve(async req => {
    if (req.method !== 'POST') return new Response('ok');

    const secret = env('NOTIFY_SECRET');
    if (secret && req.headers.get('x-notify-secret') !== secret) {
        return new Response('no', { status: 401 });
    }

    let hook: Hook;
    try {
        hook = await req.json();
    } catch {
        return new Response('bad json', { status: 400 });
    }

    const note = await planFor(hook);
    if (!note) return new Response(JSON.stringify({ sent: 0, skipped: true }));

    let q = db.from('push_subscriptions').select('endpoint, p256dh, auth, user_id');
    // 받을 사람이 아무도 없으면 조회할 것도 없다.
    if (note.only && !note.only.length) return new Response(JSON.stringify({ sent: 0 }));
    if (note.only) q = q.in('user_id', note.only);
    else if (note.except) q = q.neq('user_id', note.except);
    // 이 갈래를 끈 기기는 뺀다. **다만 이름이 불린 사람은 껐어도 받는다.**
    // `chat` 칸이 없는(스키마를 아직 안 돌린) 저장소에서는 이 조회가 오류로
    // 돌아오고 아래에서 500으로 끝난다 — 조용히 안 가는 것보다 낫다.
    // 칸을 더하는 alter가 schema.sql에 있다.
    if (note.channel) {
        q = note.always?.length
            ? q.or(`chat.eq.true,user_id.in.(${note.always.join(',')})`)
            : q.eq('chat', true);
    }

    const { data: subs, error } = await q;
    if (error) return new Response(error.message, { status: 500 });

    /* ── 아이콘 위 빨간 숫자 ─────────────────────────────────────
     *
     * **앱은 이 값을 알림에 실어 보내야만 뜬다.** 앱 안에는 서비스워커가
     * 없어 웹에서 세던 `sw.js`의 `bumpBadge`가 한 줄도 안 돈다.
     *
     * **한 번의 조회로 받는 사람 전부를 센다**(`unread_chat_counts`).
     * 사람마다 물어보면 100명 방의 한 마디에 조회가 100번 나간다 — 그
     * 값이 무서워 한동안 `1`(개수가 아니라 '새 소식 있음' 표)로 두었다.
     *
     * **못 세도 알림은 그대로 보낸다.** 그 함수가 아직 없는 저장소도 있고
     * (스키마를 안 돌린 곳), 숫자 하나 때문에 소식이 끊기면 안 된다 —
     * 그때는 표시만 안 붙는다(`0`이면 iOS가 지운다). */
    /* ── 알림함에도 남긴다 ───────────────────────────────────────
     *
     * **미는 것으로 끝내면 배너를 놓쳤을 때 되짚을 데가 없다.** 아이콘에
     * `12`가 떠 있어도 그중 둘이 정산인지 자리가 난 것인지 앱 안에서
     * 알 길이 없었다(사용자 제보 — `앱에서는 알수있는 방법이 없어`).
     * 홈 머리말의 🔔이 이 표를 본다.
     *
     * **대화는 안 넣는다.** 하루 100마디가 그대로 쌓이는 데다, 대화는
     * 대화방이 곧 목록이라 여기 또 적을 것이 없다.
     *
     * **기기가 아니라 사람에게 남긴다.** 위 `subs`는 알림을 켜 둔 기기
     * 목록이라, 그걸로 넣으면 **알림을 안 켠 사람은 앱을 열어도 못 본다** —
     * 알림함은 켜고 끄고와 상관없이 있어야 하는 자리다.
     *
     * **넣는 것이 먼저다** — 아래 뱃지 셈이 이 표를 세기 때문이다. */
    if (note.channel !== 'chat') {
        const people = note.only ?? (await db.from('profiles')
            .select('id').in('role', MEMBERS)).data?.map(p => p.id as string) ?? [];
        const rows = people
            .filter(id => id && id !== note.except)
            .map(id => ({
                user_id: id,
                kind: hook.table,
                title: note.title,
                body: note.bodyBy?.[id] || note.body,
                url: note.url,
            }));
        if (rows.length) {
            const { error: noteErr } = await db.from('notifications').insert(rows);
            // **못 남겨도 알림은 그대로 민다.** 표가 아직 없는 저장소도 있고,
            // 목록 하나 때문에 소식이 끊기면 안 된다.
            if (noteErr) console.error('알림함', noteErr.message);
        }
    }

    /* ── 아이콘 위 빨간 숫자 ─────────────────────────────────────
     *
     * **안 읽은 대화 + 안 읽은 알림**이다(사용자가 정한 셈 —
     * `채팅10 + 정산1 + 참가확정1 이면 12`). 한 번의 조회로 둘을 함께
     * 받는다(`badge_counts`) — 사람마다 물어보면 100명 방의 한 마디에
     * 조회가 100번 나간다.
     *
     * **못 세도 알림은 그대로 보낸다.** 그 함수가 아직 없는 저장소에서는
     * 표시만 안 붙는다(`0`이면 iOS가 지운다). */
    const badges = new Map<string, number>();
    const uids = [...new Set((subs ?? [])
        .map(s => s.user_id).filter((u): u is string => typeof u === 'string'))];
    if (uids.length) {
        const { data: counts, error: countErr } = await db
            .rpc('badge_counts', { p_users: uids });
        if (countErr) console.error('badge', countErr.message);
        for (const c of (counts ?? []) as { user_id: string; chat: number; notes: number }[]) {
            badges.set(c.user_id, (c.chat ?? 0) + (c.notes ?? 0));
        }
    }
    const badgeFor = (uid: unknown): number => {
        const n = typeof uid === 'string' ? badges.get(uid) ?? 0 : 0;
        /* **대화가 아닌 알림은 못해도 하나는 붙인다.** 표가 없는 저장소나
           셈이 실패한 판에서 `0`이 실리면 **알림은 왔는데 아이콘은 깨끗한**
           꼴이 된다. 제대로 세어졌으면 이미 1 이상이라 아무 일도 안 한다. */
        return note.channel === 'chat' ? n : Math.max(n, 1);
    };

    /* **본문은 기기마다 다를 수 있다.** 라운드 알림이 사람마다 자기 조를
       실어 보내기 때문이다(`bodyBy`). 없으면 지금까지처럼 다 같은 문구다. */
    const payloadFor = (uid: unknown) => JSON.stringify({
        title: note.title,
        body: (typeof uid === 'string' && note.bodyBy?.[uid]) || note.body,
        tag: note.tag,
        url: note.url,
    });

    // 못 쓰게 된 구독은 404/410으로 돌아온다. 그때 지워 두지 않으면
    // 발송할 때마다 같은 실패가 쌓인다.
    const dead: string[] = [];
    let sent = 0;

    /* **한 목록에서 웹과 앱을 갈라 보낸다.** 받는 사람을 고르는 규칙
       (`only`·`except`·대화 스위치)은 위에서 이미 끝났으므로, 여기서는
       **어디로 미느냐만** 다르다 — 그래서 표를 나누지 않고 `apns:` 표시
       하나로 가른다(`lib/native-push.ts` 참고). */
    const google = account();

    await Promise.all((subs ?? []).map(async s => {
        const endpoint = s.endpoint as string;
        const one = {
            title: note.title,
            body: (typeof s.user_id === 'string' && note.bodyBy?.[s.user_id]) || note.body,
            tag: note.tag,
            url: note.url,
            /* **대화가 아닌 알림은 못해도 하나는 붙인다.** 세는 값이
               '안 읽은 대화 개수'라, 대화를 다 읽어 둔 사람에게 정산·조
               편성 알림이 가면 `0`이 실려 **뱃지가 아예 안 붙는다** —
               알림은 왔는데 아이콘은 깨끗해 보인다.
               정산·조 편성에는 '안 읽음'이라는 것이 애초에 없으므로
               (읽었는지 알 길이 없다) **앱을 열면 지워지는 것**으로 끝낸다
               (`AppDelegate`의 `applicationDidBecomeActive`). */
            badge: badgeFor(s.user_id),
            /* **앱을 보고 있는 동안 배너를 띄울지 가르는 표다.**
               아이폰 앱이 이 값을 보고 대화만 조용히 넘긴다 — 위
               `pushToApns`의 주석 참고. */
            chat: note.channel === 'chat',
        };

        if (endpoint.startsWith(FCM_MARK)) {
            // 열쇠가 없는 저장소에서는 건너뛴다 — **행은 안 지운다.**
            // **조용히 넘어가지는 않는다** — 폰에서는 `켜짐`인데 소식만
            // 안 오는 꼴이라, 로그에 까닭이 안 남으면 짚을 데가 없다.
            if (!google) { console.error('fcm: FCM_SERVICE_ACCOUNT 가 없어 안드로이드 앱 기기를 건너뜁니다'); return; }
            try {
                const r = await pushToFcm(google, endpoint.slice(FCM_MARK.length), one);
                if (r === 'ok') sent++;
                else if (r === 'dead') dead.push(endpoint);
            } catch (e) {
                console.error('fcm', (e as Error).message);
            }
            return;
        }

        if (endpoint.startsWith(APNS_MARK)) {
            /* 열쇠를 아직 안 넣어 둔 저장소에서는 앱 기기를 그냥 건너뛴다 —
               **행을 지우지는 않는다.** 열쇠를 넣으면 그대로 살아나야 한다.
               **다만 로그에는 남긴다** — 폰에서는 `이 기기로 받기`가 켜져
               있는데 소식만 안 오는 꼴이라, 까닭이 어디에도 안 적히면
               어디가 막힌 것인지 밖에서 알 길이 없다(`docs/설치.md` 7-1번). */
            if (!canApns()) {
                console.error('apns: APNS_KEY_P8 · APNS_KEY_ID · APNS_TEAM_ID 중 없는 것이 있어 아이폰 앱 기기를 건너뜁니다');
                return;
            }
            try {
                const r = await pushToApns(endpoint.slice(APNS_MARK.length), one);
                if (r === 'ok') sent++;
                else if (r === 'dead') dead.push(endpoint);
            } catch (e) {
                console.error('apns', (e as Error).message);
            }
            return;
        }

        try {
            await webpush.sendNotification(
                { endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                payloadFor(s.user_id),
            );
            sent++;
        } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) dead.push(endpoint);
        }
    }));

    if (dead.length) await db.from('push_subscriptions').delete().in('endpoint', dead);

    return new Response(JSON.stringify({ sent, dropped: dead.length }), {
        headers: { 'content-type': 'application/json' },
    });
});
