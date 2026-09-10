import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
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
 * ## 아이폰은 애플에 바로, 안드로이드는 구글을 거친다
 *
 * **받는 코드는 한 벌이다.** `@capacitor/push-notifications`가 아이폰에서는
 * APNs 토큰을, 안드로이드에서는 FCM 토큰을 그대로 주므로, 여기서는
 * **어느 쪽 토큰인지 표시만 붙여**(`MARK`) 발송기가 갈라 보낸다.
 *
 * **아이폰에 FCM을 안 쓴 까닭**: 그러려면 파이어베이스 프로젝트 ·
 * 앱 등록 · `GoogleService-Info.plist` · APNs 키 올리기까지 딸려 오는데,
 * 애플에 바로 보내면 **`.p8` 열쇠 하나**로 끝난다. 안드로이드는 구글 말고
 * 길이 없어 그쪽만 파이어베이스를 쓴다.
 *
 * ## 표를 새로 안 만들었다
 *
 * 웹 구독이 쓰던 `push_subscriptions`에 **`endpoint`를
 * `apns:<토큰>`·`fcm:<토큰>`으로** 넣는다.
 * 이모티콘이 사진 칸을 `sticker:<id>`로 같이 쓰는 것과 같은
 * 방식이다 — 칸이나 표를 늘리면 **사용자가 손으로 붙여넣어야 하는 SQL이
 * 늘고**, 스키마를 아직 안 돌린 저장소에서 또 갈라진다.
 * 덕분에 받는 사람을 고르는 규칙(`only`·`except`·대화 스위치)과 죽은
 * 구독을 지우는 자리가 **웹과 한 코드로 남는다.**
 * `p256dh`·`auth`는 웹 암호에 쓰는 값이라 앱에는 없다 — 빈 글자로 둔다
 * (그 칸이 `not null`이라 null을 못 넣는다).
 */

/** 이 기기의 토큰. 앱을 껐다 켜도 남아야 해서 적어 둔다. */
const KEY = 'teetime:apns';

/**
 * 이 기기로 보내는 길. 구독 주소 앞에 붙어 발송기가 이것으로 갈라 본다.
 *
 * **아이폰은 애플에 바로, 안드로이드는 구글을 거친다.**
 * `@capacitor/push-notifications`가 아이폰에서는 APNs 토큰을,
 * 안드로이드에서는 FCM 토큰을 주므로 **받는 코드는 한 벌이고 표시만
 * 갈린다.** (아이폰에도 FCM을 쓰면 파이어베이스가 딸려 오는데, 지금은
 * 그럴 값이 없다 — 위 머리말 참고.)
 */
const MARK = Capacitor.getPlatform() === 'android' ? 'fcm:' : 'apns:';

type Plugin = typeof PushNotifications;

/**
 * 플러그인을 집는다. **앱일 때만 준다.**
 *
 * **`import()`(동적)로 불러오지 말 것 — 실기기에서 그 약속이 안 끝났다.**
 * 사용자 제보(`플러그인 찾는중에서 안넘어가`)로 잡은 자리다. 걸음이 1에서
 * 멈춰 있고 `1 플러그인 없음`도 안 뜬다는 것은, 거절도 아니고 **답이 아예
 * 안 온다**는 뜻이다 — 앱 안에서는 문서가 `capacitor://localhost`라
 * 조각(chunk)을 받아 오는 길이 웹과 다르고, 거기서 막히면 그대로 굳는다.
 *
 * 그래서 **static import로 바꿨다.** 이 꾸러미의 알맹이는
 * `registerPlugin(...)` 한 줄뿐이고(웹용 구현은 그 안에서 따로 늦게 불러온다)
 * `registerPlugin` 자체는 `lib/composer.ts` 때문에 어차피 묶음에 들어 있다 —
 * 늘어나는 것이 0.3KB이고, 대신 **1번 걸음이 멈추거나 거절할 자리가 통째로
 * 사라진다.** 플러그인이 안 실린 옛 앱은 예나 지금이나 **2번에서**
 * `not implemented`로 갈린다(`notThere()`).
 */
function load(): Plugin | null {
    return IS_NATIVE ? PushNotifications : null;
}

/**
 * **어디까지 갔는지 화면에 적어 주는 자리.**
 *
 * 알림을 켜는 일은 **폰에서만 도는 네 걸음**이다 — 플러그인 찾기 · 권한
 * 묻기 · 애플(구글)에서 토큰 받기 · 서버에 남기기. 어느 걸음에서 막혔는지
 * 밖에서는 알 길이 없어, 안 켜진다는 제보를 받으면 **짐작만 하게 된다**
 * (`ncStatus()`와 같은 자리다 — 그때도 그래서 한 바퀴를 헛돌았다).
 *
 * 그래서 걸음마다 한 마디를 적어 화면(`Me.tsx`)이 그대로 보여 준다.
 * **토스트로만 알리지 말 것** — 몇 초 뒤 사라져서 사진으로 찍어 보낼 수가
 * 없다. 실패한 까닭은 그 줄에 그대로 남는다.
 */
export const pushDiag: { step: string; why: string } = { step: '', why: '' };

let onStep: (s: string) => void = () => {};

/** 화면이 걸음을 따라 적게 한다. 돌려주는 것을 부르면 그만 듣는다. */
export function watchPushStep(fn: (s: string) => void): () => void {
    onStep = fn;
    return () => { onStep = () => {}; };
}

export function pushStep(s: string) {
    pushDiag.step = s;
    onStep(s);
}

function savedToken(): string | null {
    try { return localStorage.getItem(KEY); } catch { return null; }
}

/** 이 기기를 가리키는 값. 웹의 구독 주소 자리에 들어간다. */
export function nativeEndpoint(): string | null {
    const t = savedToken();
    return t ? `${MARK}${t}` : null;
}

/**
 * 등록하고 이 기기의 토큰을 받아 온다.
 *
 * **`register()`는 답을 바로 안 준다** — 아이폰은 애플, 안드로이드는
 * 구글에 다녀와서 `registration` 이벤트로 온다. 그래서 이벤트를 걸어
 * 두고 기다린다.
 *
 * **반드시 시간 제한을 둔다.** 뭔가 빠졌으면 대개 `registrationError`가
 * 오지만(아이폰은 `aps-environment` 권한, 안드로이드는
 * `google-services.json`), 통신이 막힌 자리에서는 **둘 다 안 오고 그대로
 * 멈춘다** — 그러면 `알림 켜기`를 누른 사람이 영영 기다린다.
 */
/**
 * 애플·구글이 등록을 거절한 까닭을 **사람 말로** 바꾼다.
 *
 * 그대로 두면 `응용 프로그램을 위한 유효한 'aps-environment' 인타이틀먼트
 * 문자열을 찾을 수 없습니다` 같은 줄이 화면에 그대로 뜬다(사용자 제보 ·
 * 1.34판). 뜻은 **앱 파일에 알림 권한이 안 실렸다**는 것이고, 고칠 자리는
 * 폰이 아니라 **애플 개발자 사이트와 앱 빌드**다 — 그 말을 적어 준다.
 */
function whyToken(raw: unknown): string {
    const s = String(raw ?? '알 수 없는 까닭');
    if (s.includes('aps-environment')) {
        return '이 앱에 알림 권한이 안 실려 있습니다. 앱을 다시 만들어 받아야 켜집니다.';
    }
    return s;
}

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
            () => end(() => reject(new Error('알림 서버에서 답이 없습니다. 잠시 뒤 다시 눌러 주세요.'))),
            15000,
        );
        void (async () => {
            const hs = await Promise.all([
                p.addListener('registration', ({ value }) => end(() => resolve(value))),
                p.addListener('registrationError', e => end(() => reject(
                    new Error(whyToken((e as { error?: unknown }).error))))),
            ]);
            if (done) { hs.forEach(h => { void h.remove(); }); return; }
            hs.forEach(h => drops.push(() => { void h.remove(); }));
            await p.register();
        })().catch(e => end(() => reject(e as Error)));
        /* **여기서 안 받으면 15초를 꼬박 기다린다.** 플러그인이 안 실린
           앱에서는 `register()`가 곧바로 거절하는데, 그 거절이 갈 데가
           없으면 시간 제한이 끝날 때까지 화면이 멈춰 선 것처럼 보인다. */
    });
}

/**
 * **플러그인이 앱에 안 실린 판을 가려낸다.**
 *
 * `import()`는 웹 묶음에서 오므로 **늘 성공한다** — 그래서 `load()`가 값을
 * 돌려줘도 앱 쪽에 진짜 플러그인이 없을 수 있다(그 판으로 만든 앱을 아직
 * 쓰고 있는 경우다). 그때 첫 호출이 `not implemented`로 거절하는데,
 * 그 오류를 그냥 던지면 화면이 **`확인 중…`에 멈춘 채로 굳는다**
 * (사용자 제보 — `이 기기로 받기 확인중.....`).
 *
 * 걸러 내면 `unsupported`가 되고, 화면은 앱일 때 그것을
 * **`앱을 최신 판으로 받으면 켤 수 있습니다`**로 적는다 — 실제로 그것이
 * 맞는 안내다.
 */
function notThere(e: unknown): boolean {
    const m = String((e as { message?: unknown })?.message ?? e).toLowerCase();
    return m.includes('not implemented') || m.includes('not available')
        || m.includes('unimplemented');
}

/**
 * **답이 안 오는 것을 실패로 바꾼다.** 플러그인을 부르는 일은 앱 쪽으로
 * 한 번 건너갔다 오는 것이라, 저쪽이 답을 안 주면 **그 자리에서 굳는다** —
 * 그러면 화면은 `켜는 중… 2 권한 보는 중`에 멈춘 채로 남는다.
 * (`pushState()`의 6초 제한과 같은 결이다. 멈춰 서 있는 것보다 낫다.)
 */
function soon<T>(job: Promise<T>, ms = 5000): Promise<T> {
    return Promise.race([
        job,
        new Promise<T>((_, no) => setTimeout(() => no(new Error('앱이 답하지 않습니다')), ms)),
    ]);
}

export async function nativePushState(): Promise<PushState> {
    const p = load();
    if (!p) return 'unsupported';
    let receive: string;
    try {
        ({ receive } = await soon(p.checkPermissions()));
    } catch (e) {
        if (notThere(e)) return 'unsupported';
        throw e;
    }
    if (receive === 'denied') return 'denied';
    /* **권한이 있어도 토큰이 없으면 꺼진 것으로 본다.** 앱을 지웠다 다시
       깐 경우가 그렇다 — 권한은 기억돼 있는데 우리 쪽 기록은 비어 있다.
       그때 `켜짐`이라고 적으면 켜 볼 길이 없어진다. */
    return receive === 'granted' && nativeEndpoint() ? 'on' : 'off';
}

export async function enableNativePush(userId: string): Promise<PushState> {
    pushStep('1 플러그인 찾는 중');
    const p = load();
    if (!p) { pushStep('1 플러그인 없음'); return 'unsupported'; }
    pushStep('1 플러그인 ok');

    let receive: string;
    try {
        pushStep('2 권한 보는 중');
        ({ receive } = await soon(p.checkPermissions()));
        /* 권한 창은 **누른 그 자리에서** 띄운다. 한 번 거절하면 그다음부터는
           창이 안 뜨므로(`denied`) 폰 설정에서 켜야 한다 — 화면이 그 말을 한다.
           **여기는 사람이 창을 보고 누르는 시간이라 넉넉히 준다.** */
        if (receive !== 'granted' && receive !== 'denied') {
            pushStep('2 권한 묻는 중');
            receive = (await soon(p.requestPermissions(), 60000)).receive;
        }
    } catch (e) {
        /* 플러그인이 안 실린 앱이다. 그대로 던지면 영문 오류가 그대로 뜨므로
           무엇을 하면 되는지로 바꿔 준다(`nativePushState`와 같은 잣대다). */
        if (notThere(e)) throw new Error('앱을 최신 판으로 받아야 알림을 켤 수 있습니다.');
        throw e;
    }
    pushStep(`2 권한 ${receive}`);
    if (receive !== 'granted') return 'denied';

    pushStep('3 토큰 받는 중');
    const token = await askToken(p);
    pushStep(`3 토큰 ok(${token.slice(0, 6)}…)`);
    try { localStorage.setItem(KEY, token); } catch { /* 막힌 판 */ }

    /* `chat`은 일부러 안 보낸다 — upsert는 **보낸 칸만** 고치므로 대화
       알림만 꺼 둔 것이 껐다 켜도 그대로 살아남는다(웹과 같은 규칙이다). */
    pushStep('4 서버에 남기는 중');
    const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: `${MARK}${token}`,
        user_id: userId,
        p256dh: '',
        auth: '',
        ua: navigator.userAgent.slice(0, 200),
    });
    if (error) throw new Error(error.message);
    pushStep('4 켜짐');
    return 'on';
}

export async function disableNativePush(): Promise<PushState> {
    const endpoint = nativeEndpoint();
    if (endpoint) await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    try { localStorage.removeItem(KEY); } catch { /* 막힌 판 */ }
    const p = load();
    /* **폰 쪽 등록도 끊는다.** 행만 지우면 폰은 계속 등록돼 있어,
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
        const p = load();
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
 * 받은 토큰은 영원하지 않다 — 앱을 지웠다 다시 깔거나, 폰을 새로 사서
 * 백업을 되살리면 **다른 값이 온다.** 그때 갈아 끼우지 않으면 옛 토큰으로
 * 계속 밀다가 `410`(애플)·`404 UNREGISTERED`(구글)가 오고, 발송기가 그 행을 지운다 →
 * **알림이 조용히 끊긴다.** 켜 둔 사람은 켠 줄 알고 있으므로 알아챌 길이
 * 없는 자국이다.
 *
 * **켜 둔 기기에서만 한다**(적어 둔 토큰이 있을 때). 안 켠 사람에게
 * 앱을 열 때마다 등록을 신청할 이유가 없다.
 *
 * **행을 지웠다 넣지 않고 고친다** — 지우면 그 기기에서 **대화 알림만
 * 꺼 둔 것**(`chat`)이 함께 날아간다.
 *
 * **토큰이 그대로여도 행이 아직 있는지 본다.** 이게 없으면 조용히 끊긴
 * 채로 굳는 자리가 남는다 — 발송기가 애플에게 `410`·`400 BadDeviceToken`을
 * 한 번 받으면 그 행을 걷는데(옛 토큰을 쌓아 두지 않으려고 그렇게 짜
 * 두었다), 폰은 적어 둔 토큰이 그대로라 **`내 정보`에는 `켜짐`으로 보인다.**
 * 켠 사람은 켠 줄 알고 있으니 알아챌 길이 아예 없다. 앱을 열 때 한 번
 * 물어보는 값이 훨씬 싸다.
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

    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user.id;
    if (!uid) return;   // 아직 로그인 전이다. 다음에 열 때 맞춘다

    if (fresh === old) {
        /* 토큰은 그대로다. **행이 아직 있는지만** 본다 — 있으면 할 일이 없고,
           걷혔으면 아래에서 되살린다. 못 물어봤을 때는 그냥 둔다(있는 쪽으로
           기운다 — 헛 upsert가 `chat`을 건드리지는 않지만 쓸 일이 없다). */
        const { data, error } = await supabase.from('push_subscriptions')
            .select('endpoint').eq('endpoint', `${MARK}${fresh}`).maybeSingle();
        if (error || data) return;
    } else {
        try { localStorage.setItem(KEY, fresh); } catch { /* 막힌 판 */ }
        const { data } = await supabase.from('push_subscriptions')
            .update({ endpoint: `${MARK}${fresh}` })
            .eq('endpoint', `${MARK}${old}`)
            .select('endpoint');
        if (data?.length) return;   // 갈아 끼웠다
        // 옛 행이 이미 지워졌으면(발송기가 죽은 것으로 보고 걷었다) 아래에서 새로 넣는다.
    }

    await supabase.from('push_subscriptions').upsert({
        endpoint: `${MARK}${fresh}`,
        user_id: uid,
        p256dh: '',
        auth: '',
        ua: navigator.userAgent.slice(0, 200),
    });
}
