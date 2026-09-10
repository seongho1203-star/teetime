import { IS_NATIVE } from './native';
import { supabase } from './supabase';
import type { PushState } from './push';

/**
 * **앱(Capacitor)에서 오는 알림.**
 *
 * 웹은 서비스워커 + 웹푸시로 받는데(`lib/push.ts`), **아이폰 앱 안에는
 * 웹푸시가 아예 없다** — 서비스워커도 안 돈다. 그래서 앱에서는 회원들이
 * 라운드·모집·대화 소식을 **한 건도 못 받고 있었다.**
 *
 * ## FCM이 아니라 애플에 바로 보낸다
 *
 * `docs/출시-전-할일.md`에는 `FCM으로 옮긴다`고 적어 두었는데, 지금
 * 내는 것이 **아이폰뿐이라 그 길이 오히려 멀다.** FCM을 쓰려면
 * 파이어베이스 프로젝트를 만들고 · 앱을 등록하고 · `GoogleService-Info.plist`를
 * 넣고 · APNs 키를 파이어베이스에 올리고 · 발송기에 서비스 계정 JSON
 * (수십 줄짜리 비밀값)을 넣어야 한다. **애플에 바로 보내면 그 다섯이
 * `.p8` 열쇠 하나로 줄어든다** — 사용자가 폰으로 하는 일이라 손이 적은
 * 쪽이 맞다.
 *
 * `@capacitor/push-notifications`는 **아이폰에서 APNs 토큰을 그대로**
 * 준다(파이어베이스를 깔았을 때만 FCM 토큰이 된다). 그래서 플러그인은
 * 이것 하나면 되고, 발송기가 그 토큰으로 애플에 직접 민다.
 *
 * **안드로이드를 낼 때 FCM을 더한다.** 그때는 받는 쪽 토큰만 갈리고
 * (`registration`이 FCM 토큰을 준다) 아래 짜임은 그대로 쓴다.
 *
 * ## 표를 새로 안 만들었다
 *
 * 웹 구독이 쓰던 `push_subscriptions`에 **`endpoint`를 `apns:<토큰>`으로**
 * 넣는다. 이모티콘이 사진 칸을 `sticker:<id>`로 같이 쓰는 것과 같은
 * 방식이다 — 칸이나 표를 늘리면 **사용자가 손으로 붙여넣어야 하는 SQL이
 * 늘고**, 스키마를 아직 안 돌린 저장소에서 또 갈라진다.
 * 덕분에 받는 사람을 고르는 규칙(`only`·`except`·대화 스위치)과 죽은
 * 구독을 지우는 자리가 **웹과 한 코드로 남는다.**
 * `p256dh`·`auth`는 웹 암호에 쓰는 값이라 앱에는 없다 — 빈 글자로 둔다
 * (그 칸이 `not null`이라 null을 못 넣는다).
 */

/** 이 기기의 APNs 토큰. 앱을 껐다 켜도 남아야 해서 적어 둔다. */
const KEY = 'teetime:apns';

type Plugin = (typeof import('@capacitor/push-notifications'))['PushNotifications'];

let plugin: Plugin | null = null;

/**
 * 플러그인을 불러온다. **앱일 때만 불러온다** — 웹 묶음에 안 실리게
 * 하려는 것이고(`import()`), 플러그인이 없는 옛 앱에서는 조용히 null이다.
 */
async function load(): Promise<Plugin | null> {
    if (!IS_NATIVE) return null;
    if (plugin) return plugin;
    try {
        const m = await import('@capacitor/push-notifications');
        plugin = m.PushNotifications;
        return plugin;
    } catch {
        return null;
    }
}

function savedToken(): string | null {
    try { return localStorage.getItem(KEY); } catch { return null; }
}

/** 이 기기를 가리키는 값. 웹의 구독 주소 자리에 들어간다. */
export function nativeEndpoint(): string | null {
    const t = savedToken();
    return t ? `apns:${t}` : null;
}

/**
 * 애플에 등록하고 이 기기의 토큰을 받아 온다.
 *
 * **`register()`는 답을 바로 안 준다** — 애플에 다녀와서 `registration`
 * 이벤트로 온다. 그래서 이벤트를 걸어 두고 기다린다.
 *
 * **반드시 시간 제한을 둔다.** `aps-environment` 권한이 앱에 없으면
 * `registrationError`가 오지만, 통신이 막힌 자리에서는 **둘 다 안 오고
 * 그대로 멈춘다** — 그러면 `알림 켜기`를 누른 사람이 영영 기다린다.
 */
function askToken(p: Plugin): Promise<string> {
    return new Promise((resolve, reject) => {
        let done = false;
        const drops: Array<() => void> = [];
        const end = (fn: () => void) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            drops.forEach(f => f());
            fn();
        };
        const timer = setTimeout(
            () => end(() => reject(new Error('애플에서 답이 없습니다. 잠시 뒤 다시 눌러 주세요.'))),
            15000,
        );
        void (async () => {
            const hs = await Promise.all([
                p.addListener('registration', ({ value }) => end(() => resolve(value))),
                p.addListener('registrationError', e => end(() => reject(new Error(
                    String((e as { error?: unknown }).error ?? '알 수 없는 까닭'))))),
            ]);
            if (done) { hs.forEach(h => { void h.remove(); }); return; }
            hs.forEach(h => drops.push(() => { void h.remove(); }));
            await p.register();
        })();
    });
}

export async function nativePushState(): Promise<PushState> {
    const p = await load();
    if (!p) return 'unsupported';
    const { receive } = await p.checkPermissions();
    if (receive === 'denied') return 'denied';
    /* **권한이 있어도 토큰이 없으면 꺼진 것으로 본다.** 앱을 지웠다 다시
       깐 경우가 그렇다 — 권한은 기억돼 있는데 우리 쪽 기록은 비어 있다.
       그때 `켜짐`이라고 적으면 켜 볼 길이 없어진다. */
    return receive === 'granted' && nativeEndpoint() ? 'on' : 'off';
}

export async function enableNativePush(userId: string): Promise<PushState> {
    const p = await load();
    if (!p) return 'unsupported';

    let { receive } = await p.checkPermissions();
    /* 권한 창은 **누른 그 자리에서** 띄운다. 한 번 거절하면 그다음부터는
       창이 안 뜨므로(`denied`) 폰 설정에서 켜야 한다 — 화면이 그 말을 한다. */
    if (receive !== 'granted' && receive !== 'denied') {
        receive = (await p.requestPermissions()).receive;
    }
    if (receive !== 'granted') return 'denied';

    const token = await askToken(p);
    try { localStorage.setItem(KEY, token); } catch { /* 막힌 판 */ }

    /* `chat`은 일부러 안 보낸다 — upsert는 **보낸 칸만** 고치므로 대화
       알림만 꺼 둔 것이 껐다 켜도 그대로 살아남는다(웹과 같은 규칙이다). */
    const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: `apns:${token}`,
        user_id: userId,
        p256dh: '',
        auth: '',
        ua: navigator.userAgent.slice(0, 200),
    });
    if (error) throw new Error(error.message);
    return 'on';
}

export async function disableNativePush(): Promise<PushState> {
    const endpoint = nativeEndpoint();
    if (endpoint) await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    try { localStorage.removeItem(KEY); } catch { /* 막힌 판 */ }
    const p = await load();
    /* **애플 쪽 등록도 끊는다.** 행만 지우면 폰은 계속 등록돼 있어,
       발송기가 미처 안 지운 옛 토큰으로 한 번 더 울릴 수 있다
       (웹에서 `unsubscribe()`를 먼저 부르는 것과 같은 자리다). */
    if (p) await p.unregister().catch(() => { /* 안 돼도 행은 이미 지웠다 */ });
    return 'off';
}

/**
 * 알림을 눌렀을 때 그 화면으로 간다.
 *
 * 웹에서는 서비스워커가 하던 일인데(`sw.js`의 `notificationclick`),
 * 앱에는 그것이 없어 플러그인이 주는 사건으로 받는다. **갈 곳은 발송기가
 * 알림마다 실어 보내는 그 값 그대로다**(`note.url` → `data.url`) —
 * 웹과 앱이 같은 값을 쓰므로 발송기는 한 줄도 안 갈린다.
 *
 * **앱이 꺼져 있다가 알림으로 켜진 경우도 같은 사건으로 온다** —
 * 웹에서처럼 따로 적어 두었다 가져올 필요가 없다.
 */
export function watchNativePush(onNav: (url: string) => void): void {
    void (async () => {
        const p = await load();
        if (!p) return;
        await p.addListener('pushNotificationActionPerformed', e => {
            const url = (e.notification.data as { url?: unknown } | null)?.url;
            if (typeof url === 'string' && url) onNav(url);
        });
        /* 앱을 열면 쌓인 알림을 걷는다 — 안 걷으면 알림창에 지난 것이
           그대로 남아, 눌러 봐야 이미 본 화면으로 간다. */
        await p.removeAllDeliveredNotifications().catch(() => { /* 없는 판 */ });
        await refresh(p);
    })();
}

/**
 * **토큰이 바뀌었으면 갈아 끼운다.**
 *
 * 애플이 주는 토큰은 영원하지 않다 — 앱을 지웠다 다시 깔거나, 폰을 새로
 * 사서 백업을 되살리면 **다른 값이 온다.** 그때 갈아 끼우지 않으면 옛
 * 토큰으로 계속 밀다가 애플이 `410`을 주고, 발송기가 그 행을 지운다 →
 * **알림이 조용히 끊긴다.** 켜 둔 사람은 켠 줄 알고 있으므로 알아챌 길이
 * 없는 자국이다.
 *
 * **켜 둔 기기에서만 한다**(적어 둔 토큰이 있을 때). 안 켠 사람에게
 * 앱을 열 때마다 등록을 신청할 이유가 없다.
 *
 * **행을 지웠다 넣지 않고 고친다** — 지우면 그 기기에서 **대화 알림만
 * 꺼 둔 것**(`chat`)이 함께 날아간다.
 */
async function refresh(p: Plugin): Promise<void> {
    const old = savedToken();
    if (!old) return;
    let fresh: string;
    try {
        fresh = await askToken(p);
    } catch {
        return;   // 통신이 막혔거나 권한이 없다 — 그대로 두고 다음에 다시 본다
    }
    if (fresh === old) return;

    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user.id;
    if (!uid) return;   // 아직 로그인 전이다. 다음에 열 때 맞춘다

    try { localStorage.setItem(KEY, fresh); } catch { /* 막힌 판 */ }
    const { data } = await supabase.from('push_subscriptions')
        .update({ endpoint: `apns:${fresh}` })
        .eq('endpoint', `apns:${old}`)
        .select('endpoint');
    // 옛 행이 이미 지워졌으면(발송기가 죽은 것으로 보고 걷었다) 새로 넣는다.
    if (!data?.length) {
        await supabase.from('push_subscriptions').upsert({
            endpoint: `apns:${fresh}`,
            user_id: uid,
            p256dh: '',
            auth: '',
            ua: navigator.userAgent.slice(0, 200),
        });
    }
}
