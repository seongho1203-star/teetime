/**
 * 아이콘 위의 빨간 숫자(뱃지).
 *
 * **숫자를 세는 곳은 서비스워커 하나뿐이다**(`public/sw.js`). 알림이 올 때
 * 하나씩 올리고, 앱을 열면 여기서 지워 달라고 알린다 — 세는 코드가 두 군데가
 * 되면 언젠가 어긋난다.
 *
 * **홈 화면에 추가한 앱에서만 보인다.** 브라우저 탭에는 얹을 자리가 없다.
 * 아이폰은 iOS 16.4부터, 안드로이드는 설치한 앱에서 된다. 다만 안드로이드에는
 * 뱃지 숫자 표준이 없어 **런처마다 다르다** — 삼성은 숫자, 순정은 점만 찍힌다.
 * 안 되는 기기에서도 알림 자체는 그대로 뜨므로 조용히 지나간다.
 */

/**
 * 이 기기에서 뱃지가 되는지 물어본다. `내 정보` 맨 아래에 적힌다.
 *
 * **짐작으로 고치지 말고 재서 고칠 것.** 뱃지는 안 되어도 조용히 지나가게
 * 해 두어서, 안 뜰 때 어디가 막힌 것인지 밖에서는 알 길이 없다. 막히는
 * 자리가 둘이라 둘 다 본다:
 *   화면 — 이 브라우저가 뱃지를 아는가 (iOS 16.4 미만이면 없다)
 *   워커 — **알림이 올 때 도는 쪽**에서도 되는가. 숫자를 얹는 건 이쪽이라
 *          여기가 안 되면 화면이 되어도 소용이 없다. 서비스워커가 아직
 *          안 올라왔으면 `없음`이 나온다 — 그때는 앱을 껐다 켜 본다.
 */
export async function badgeSupport(): Promise<{ page: boolean; worker: boolean | null }> {
    const page = typeof navigator !== 'undefined' && 'setAppBadge' in navigator;
    const sw = navigator.serviceWorker?.controller;
    if (!sw) return { page, worker: null };
    return {
        page,
        worker: await new Promise<boolean | null>(done => {
            const ch = new MessageChannel();
            const timer = setTimeout(() => done(null), 1500);
            ch.port1.onmessage = e => { clearTimeout(timer); done(!!e.data?.badge); };
            sw.postMessage({ type: 'badge-support' }, [ch.port2]);
        }),
    };
}

/** 앱을 봤으니 0으로. */
export function clearBadge() {
    try {
        navigator.clearAppBadge?.().catch(() => {});
        // 세어 둔 값을 지우는 것은 서비스워커 몫이다.
        navigator.serviceWorker?.controller?.postMessage({ type: 'badge-clear' });
    } catch { /* 뱃지를 모르는 기기에서도 화면은 그대로 돌아야 한다 */ }
}

/**
 * 앱을 보고 있는 동안에는 뱃지를 비워 둔다.
 *
 * 처음 뜰 때 한 번, 그리고 **다른 앱에 갔다 돌아올 때마다** 지운다.
 * 홈 화면 앱은 백그라운드에 계속 떠 있어서, 돌아온 순간이 곧 '읽은 순간'이다.
 */
export function watchBadge(): () => void {
    const onVisible = () => { if (document.visibilityState === 'visible') clearBadge(); };
    onVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
}
