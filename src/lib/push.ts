import { supabase } from './supabase';
import { IS_NATIVE } from './native';
import {
    disableNativePush, enableNativePush, nativeEndpoint, nativePushState, pushStep,
    watchNativePush,
} from './native-push';

/* 어디까지 갔는지 화면이 적을 수 있게 그대로 내보낸다 — 화면은 앱인지
   웹인지 몰라도 되게 이 파일이 유일한 문이다(`pushState`와 같은 잣대다). */
export { pushDiag, watchPushStep } from './native-push';

/**
 * 앱을 안 보고 있을 때 폰으로 오는 알림.
 *
 * 흐름은 이렇다:
 *   이 파일이 서비스워커(`public/sw.js`)를 등록하고 구독을 만든다
 *     → 구독 주소를 `push_subscriptions`에 남긴다
 *     → 새 글·새 가입이 생기면 DB 웹훅이 Edge Function(`supabase/functions/notify`)을 부르고
 *     → 그 함수가 이 주소들로 알림을 밀어 준다
 *
 * **iOS는 홈 화면에 추가한 앱에서만 알림이 온다.** 사파리 탭에서는
 * 권한 요청 자체가 뜨지 않는다 — 그래서 `canPush()`가 그것부터 본다.
 *
 * **앱(Capacitor)에서는 위 흐름이 통째로 안 돈다** — 아이폰 앱 안에는
 * 웹푸시도 서비스워커도 없다. 그때는 `lib/native-push.ts`가 애플에 직접
 * 등록해 받는다. **이 파일이 그 갈래의 유일한 문이다** — 화면(`Me.tsx`)은
 * 어느 쪽인지 몰라도 되게 여기서 갈라 준다.
 */

/** 발송기(Edge Function)의 비밀키와 짝이다. 공개키라 코드에 있어도 된다. */
const VAPID_PUBLIC_KEY = 'BCLvmt_hHbn4X6THwjrH-7ItuowKfhcLrUMLS8ajGzoAO1qKFVP46wnnKCzrEsJRkefyDBD0O7n9lbhy3KhiFiM';

/** 서비스워커는 앱과 같은 경로에 있어야 한다(`/teetime/sw.js`). */
const SW_URL = new URL('sw.js', document.baseURI).href;

export type PushState = 'unsupported' | 'standalone-required' | 'denied' | 'off' | 'on';

/**
 * 앱을 열 때 서비스워커를 등록해 둔다.
 *
 * 알림을 켤 때 등록해도 알림은 되지만, **안드로이드 크롬이 '앱 설치'를
 * 띄우려면 처음부터 등록돼 있어야 한다.** 설치와 알림은 다른 이야기라
 * 알림을 안 켜는 사람도 설치는 할 수 있어야 한다.
 */
export function registerServiceWorker() {
    /* **앱에서는 서비스워커가 아예 없다.** 대신 알림을 눌렀을 때 갈 곳만
       플러그인에서 받아 같은 `goTo()`로 넘긴다 — 갈 곳을 실어 보내는 쪽
       (발송기)은 웹이든 앱이든 한 줄도 안 갈린다. */
    if (IS_NATIVE) { watchNativePush(goTo); return; }
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(SW_URL).catch(() => {
        // 등록이 안 돼도 앱은 그대로 돌아간다. 설치 배너만 안 뜬다.
    });

    /* 알림을 눌렀을 때 서비스워커가 "이 화면으로 가라"고 보내는 한 마디.
       앱이 이미 열려 있으면 서비스워커의 `client.navigate()`로 옮기는 게
       정석인데 **iOS는 그걸 지원하지 않기도 해서**, 그 경우 창만 앞으로
       나오고 화면은 그대로였다. 그때를 위한 예비 길이다. */
    navigator.serviceWorker.addEventListener('message', e => {
        const msg = e.data as { type?: string; url?: string } | null;
        if (msg?.type !== 'navigate' || !msg.url) return;
        goTo(msg.url);
    });

    takePendingNav();

    /* **접혀 있다 돌아올 때도 다시 묻는다.** 이 한 줄이 없어서
       `알림을 눌러도 화면이 안 바뀐다`는 자리가 남아 있었다.
       아이폰 홈 화면 앱은 알림을 누르면 대개 **껐다 켜는 게 아니라
       접어 둔 것을 도로 펴 준다** — 그때는 위의 `takePendingNav()`가
       다시 돌 일이 없고, `client.navigate()`는 iOS가 지원하지 않기도 하고,
       `postMessage`는 잠들어 있던 화면이 놓칠 수 있다. 돌아오는 그 순간에
       한 번 더 물어보면 그 셋이 다 어긋나도 결국 찾아간다.
       **적어 둔 시각을 보므로**(`NAV_FRESH`) 며칠 전 값에 끌려가지 않는다. */
    const again = () => { if (!document.hidden) takePendingNav(); };
    document.addEventListener('visibilitychange', again);
    /* **`pageshow`는 되살아난 것(`persisted`)만 본다.** 그냥 걸면 처음 열
       때도 한 번 더 불려 켜자마자 두 번 묻게 된다 — 값은 첫 번째가
       가져가므로 탈은 없지만, 헛걸음을 남겨 둘 이유가 없다. */
    window.addEventListener('pageshow', e => { if (e.persisted) again(); });
}

/**
 * 적어 둔 '갈 곳'을 언제까지 따라가는가.
 *
 * 화면으로 돌아올 때마다 묻기 때문에 **한도가 없으면 안 된다** — 지난주에
 * 누르고 안 지워진 값이 남아 있다가, 오늘 앱을 열었을 때 엉뚱한 라운드로
 * 끌고 간다. 알림을 누르고 앱이 뜨는 데 2분이 걸릴 일은 없다.
 */
const NAV_FRESH = 2 * 60 * 1000;

/**
 * 알림이 가리키는 화면으로 옮긴다. 해시 라우팅이라 해시만 갈면 된다.
 *
 * **앱(Capacitor)으로 감쌀 때 이걸 그대로 쓴다** — 알림을 누른 사건
 * (`pushNotificationActionPerformed`)에서 `data.url`을 꺼내 여기 넘기면
 * 끝이다. 갈 곳은 발송기가 이미 알림마다 실어 보내고 있다.
 * `docs/출시-전-할일.md` 4번 참고.
 */
export function goTo(url: string) {
    try {
        const to = new URL(url, location.href);
        if (to.origin !== location.origin) return;
        if (to.hash && to.hash !== location.hash) location.hash = to.hash;
    } catch { /* 이상한 주소면 그냥 둔다 */ }
}

/**
 * 앱이 켜질 때 "눌린 알림이 있었나"를 서비스워커에 물어본다.
 *
 * **앱이 꺼져 있을 때 누른 경우를 위한 길이다.** 그때 서비스워커는
 * `openWindow`에 주소를 주는데 **아이폰은 그걸 무시하고 첫 화면으로 띄우기도
 * 한다** — 알림을 눌렀는데 홈이 나오는 것이다. 서비스워커가 갈 곳을 적어
 * 두었으므로(`sw.js`의 `putNav`) 여기서 가져와 옮긴다.
 *
 * **가져오면 그쪽에서 지운다.** 안 지우면 다음에 앱을 그냥 켤 때도 옛
 * 알림 화면으로 끌려간다.
 */
function takePendingNav() {
    navigator.serviceWorker.ready.then(reg => {
        const sw = reg.active;
        if (!sw) return;
        const ch = new MessageChannel();
        ch.port1.onmessage = e => {
            const nav = e.data as { url?: string; at?: number } | null;
            if (!nav?.url) return;
            // 시각이 없는 것은 예전 판이 적어 둔 값이다 — 그건 그대로 따라간다
            // (켤 때 한 번만 묻던 때의 것이라 오래됐을 리가 없다).
            if (nav.at && Date.now() - nav.at > NAV_FRESH) return;
            goTo(nav.url);
        };
        sw.postMessage({ type: 'take-nav' }, [ch.port2]);
    }).catch(() => { /* 서비스워커가 없으면 그냥 둔다 */ });
}

/** 홈 화면에 추가해서 연 앱인가. iOS는 이때만 알림을 준다. */
function isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
        // iOS 사파리는 표준 대신 이 값을 쓴다.
        || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * **이 함수는 절대 실패하지도, 멈춰 서지도 않는다.**
 *
 * 화면(`Me.tsx`)은 답이 오기 전까지 `확인 중…`을 적어 두는데, 던져지거나
 * 답이 안 오면 **그 자리에 영영 멈춘다** — 알림을 켤 길이 통째로 사라지고,
 * 무엇이 막힌 것인지도 알 수 없다(사용자 제보 — `이 기기로 받기
 * 확인중.....`).
 *
 * 실제로 던지는 자리가 있다: **플러그인이 안 실린 앱**에서
 * `checkPermissions()`를 부르면 Capacitor가 `not implemented`로 거절한다.
 * 웹에서도 `Notification`이 없는 판에서 같은 일이 난다.
 *
 * **그때는 `꺼짐`으로 답한다** — `못 함`이 아니라. 켜기 단추가 살아 있어야
 * 눌러 볼 수 있고, 그러면 `enablePush()`가 **진짜 까닭을 토스트로** 보여
 * 준다. 알 수 없다고 길을 막아 버리면 고칠 실마리까지 함께 없어진다.
 */
export async function pushState(): Promise<PushState> {
    try {
        return await withTimeout(readPushState(), 6000);
    } catch {
        return 'off';
    }
}

/** 답이 안 오는 것을 실패로 바꾼다 — 멈춰 서 있는 것보다 낫다. */
function withTimeout<T>(job: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        job,
        new Promise<T>((_, no) => setTimeout(() => no(new Error('시간 초과')), ms)),
    ]);
}

async function readPushState(): Promise<PushState> {
    if (IS_NATIVE) return nativePushState();
    if (!('serviceWorker' in navigator) || !('PushManager' in window)
        || !('Notification' in window)) {
        return isIOS && !isStandalone() ? 'standalone-required' : 'unsupported';
    }
    if (isIOS && !isStandalone()) return 'standalone-required';
    if (Notification.permission === 'denied') return 'denied';

    return await currentEndpoint() ? 'on' : 'off';
}

/** 이 기기의 구독 주소. 알림이 꺼져 있으면 null. */
async function currentEndpoint(): Promise<string | null> {
    if (IS_NATIVE) return nativeEndpoint();
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    return sub?.endpoint ?? null;
}

/**
 * 이 기기가 **대화** 알림을 받고 있는가.
 *
 * 대화만 따로 끄는 자리다. 모집·공지·투표는 하루 몇 번이지만 대화는 종일
 * 울려서, 그것 때문에 알림을 통째로 꺼 버리면 라운드 소식까지 놓친다.
 *
 * 켜짐 쪽으로 틀리게 두었다 — 못 받는 쪽으로 틀리면 사람이 알아채지
 * 못한 채 소식이 끊긴다. 칸이 없는(스키마를 아직 안 돌린) 저장소에서도
 * 조회가 실패하고 그대로 켜짐이 된다.
 */
export async function chatPush(): Promise<boolean> {
    const endpoint = await currentEndpoint();
    if (!endpoint) return true;
    const { data } = await supabase.from('push_subscriptions')
        .select('chat').eq('endpoint', endpoint).maybeSingle();
    return data?.chat !== false;
}

export async function setChatPush(on: boolean): Promise<void> {
    const endpoint = await currentEndpoint();
    if (!endpoint) throw new Error('이 기기는 알림이 꺼져 있습니다.');
    const { error } = await supabase.from('push_subscriptions')
        .update({ chat: on }).eq('endpoint', endpoint);
    if (error) throw new Error(error.message);
}

/**
 * 알림을 켠다. 권한을 묻고, 구독을 만들고, 주소를 남긴다.
 *
 * 권한 요청은 **누른 직후**에 해야 한다 — 시간이 지나면 브라우저가
 * "사용자가 부른 게 아니다"라며 무시한다.
 */
export async function enablePush(userId: string): Promise<PushState> {
    if (IS_NATIVE) return enableNativePush(userId);
    const state = await pushState();
    if (state === 'unsupported' || state === 'standalone-required' || state === 'denied') {
        return state;
    }

    pushStep('2 권한 묻는 중');
    const permission = await Notification.requestPermission();
    pushStep(`2 권한 ${permission}`);
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

    pushStep('3 서비스워커 붙이는 중');
    const reg = await navigator.serviceWorker.register(SW_URL);
    await navigator.serviceWorker.ready;

    pushStep('3 구독 만드는 중');
    const sub = await reg.pushManager.getSubscription()
        ?? await reg.pushManager.subscribe({
            // 이 앱은 알림을 사람에게 보여 주는 데만 쓴다. 조용한 푸시는 안 한다.
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });

    const json = sub.toJSON();
    // `chat`은 일부러 안 보낸다. upsert는 **보낸 칸만** 고치므로, 이미 있는
    // 행이면 대화 알림을 꺼 둔 것이 그대로 살아남는다. 새 행이면 DB 기본값
    // (켜짐)이 된다.
    pushStep('4 서버에 남기는 중');
    const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: sub.endpoint,
        user_id: userId,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
        ua: navigator.userAgent.slice(0, 200),
    });
    if (error) throw new Error(error.message);

    return 'on';
}

/**
 * 이 기기에서만 끈다.
 *
 * **행만 지우면 안 된다** — 브라우저 구독이 남아 있으면 켜진 것처럼 보이는데
 * 발송 목록에는 없는 상태가 된다. 구독을 먼저 끊고 행을 지운다.
 */
export async function disablePush(): Promise<PushState> {
    if (IS_NATIVE) return disableNativePush();
    const reg = await navigator.serviceWorker.getRegistration(SW_URL);
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
    return 'off';
}

/** VAPID 공개키는 base64url 글자다. 구독에는 바이트로 넣어야 한다. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
        .replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    // ArrayBuffer를 명시해 둔다. 그냥 Uint8Array면 SharedArrayBuffer일 수도
    // 있다고 보아 applicationServerKey 자리에 안 들어간다.
    const out = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}
