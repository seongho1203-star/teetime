import { supabase } from './supabase';

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
        try {
            const to = new URL(msg.url, location.href);
            if (to.origin !== location.origin) return;
            // 해시 라우팅이라 해시만 옮기면 화면이 바뀐다.
            if (to.hash && to.hash !== location.hash) location.hash = to.hash;
        } catch { /* 이상한 주소면 그냥 둔다 */ }
    });
}

/** 홈 화면에 추가해서 연 앱인가. iOS는 이때만 알림을 준다. */
function isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
        // iOS 사파리는 표준 대신 이 값을 쓴다.
        || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function pushState(): Promise<PushState> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return isIOS && !isStandalone() ? 'standalone-required' : 'unsupported';
    }
    if (isIOS && !isStandalone()) return 'standalone-required';
    if (Notification.permission === 'denied') return 'denied';

    return await currentEndpoint() ? 'on' : 'off';
}

/** 이 기기의 구독 주소. 알림이 꺼져 있으면 null. */
async function currentEndpoint(): Promise<string | null> {
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
    const state = await pushState();
    if (state === 'unsupported' || state === 'standalone-required' || state === 'denied') {
        return state;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

    const reg = await navigator.serviceWorker.register(SW_URL);
    await navigator.serviceWorker.ready;

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
