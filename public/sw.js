/* 알림을 받는 서비스워커.
 *
 * 앱이 닫혀 있어도 브라우저가 이 파일을 깨워 알림을 띄운다.
 * **일부러 캐시를 두지 않는다** — 캐시하면 코드를 고쳐도 예전 화면이 남는다.
 * 이 앱은 assets 파일 이름에 해시가 붙어 있어 캐시가 없어도 빠르다.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/* **크롬이 '앱 설치'를 띄우는 조건**이라 있는 것이다(안드로이드).
   일부러 캐시를 두지 않는다 — 캐시하면 코드를 고쳐도 예전 화면이 남는다.

   `cache: 'no-store'`가 붙은 이유가 따로 있다. 우리가 캐시를 안 둬도
   **브라우저의 HTTP 캐시**가 index.html을 10분쯤 들고 있다(GitHub Pages가
   그렇게 보낸다). 그 문서가 옛 파일 이름을 가리키고 있으면 새로 배포해도
   폰에는 예전 화면이 그대로 뜬다 — 고친 게 안 먹는다고 여러 번 헤맸다.
   문서만은 늘 새로 받아 온다. 나머지 파일은 이름에 해시가 붙어 있어
   캐시돼도 문제가 없다. */
self.addEventListener('fetch', event => {
    if (event.request.mode !== 'navigate') return;
    event.respondWith(
        fetch(event.request, { cache: 'no-store' })
            // 통신이 안 될 때는 캐시라도 있는 편이 아무것도 없는 것보다 낫다.
            .catch(() => fetch(event.request)),
    );
});

/* ── 아이콘 위의 빨간 숫자(뱃지) ──────────────────────────────
 *
 * 카톡처럼 안 본 개수를 아이콘에 얹는다. **여기가 세는 유일한 자리다** —
 * 화면 쪽(`lib/badge.ts`)은 "봤다"고 알려 주기만 한다.
 *
 * **`registration.getNotifications()`로 세면 안 된다.** 대화 알림은 같은
 * `tag`로 묶여 여러 줄이 와도 알림창에는 하나뿐이라, 여섯 개가 와도 1이 된다.
 * 그래서 따로 센다.
 *
 * 서비스워커에는 localStorage가 없어 IndexedDB에 담는다. 값 하나뿐이라
 * 손으로 열고 닫는다.
 *
 * 뱃지를 모르는 기기(브라우저 탭, 옛 iOS)에서는 조용히 지나간다 —
 * **알림 자체는 그대로 떠야 한다.**
 */
function openDb() {
    return new Promise((ok, no) => {
        const req = indexedDB.open('teetime-badge', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('n');
        req.onsuccess = () => ok(req.result);
        req.onerror = () => no(req.error);
    });
}

/** `by`만큼 올린다. 0을 주면 비운다. */
async function bumpBadge(by) {
    if (!('setAppBadge' in navigator)) return;
    try {
        const db = await openDb();
        const next = await new Promise((ok, no) => {
            const st = db.transaction('n', 'readwrite').objectStore('n');
            const get = st.get('count');
            get.onsuccess = () => {
                const n = by === 0 ? 0 : (get.result || 0) + by;
                st.put(n, 'count');
                ok(n);
            };
            get.onerror = () => no(get.error);
        });
        if (next > 0) await navigator.setAppBadge(next);
        else await navigator.clearAppBadge();
    } catch { /* 뱃지가 안 붙어도 알림은 떠야 한다 */ }
}

/** 화면을 보고 있는 창이 있는가. 보고 있으면 숫자를 올릴 이유가 없다. */
async function isWatching() {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    return list.some(c => c.visibilityState === 'visible');
}

/* 앱이 "봤다"고 알려 오면 비운다. **화면에서 직접 세지 않고 여기로 넘기는**
   이유는 세는 곳을 하나로 두려는 것이다. */
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'badge-clear') event.waitUntil(bumpBadge(0));
});

/* 알림창 맨 윗줄(`까꿍`)은 **우리가 넣는 게 아니다.** 폰이 앱 이름을
   붙인다 — 홈 화면 앱이면 manifest의 name, 브라우저 탭이면 사이트 주소다.
   주소가 뜨는 건 브라우저가 '어디서 온 알림인지' 밝히는 것이라 끌 수 없다.
   설치해서 쓰면 이름으로 바뀐다. 우리가 정할 수 있는 건 그 이름뿐이다. */
self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

    const title = data.title || '까꿍';
    const options = {
        body: data.body || '',
        icon: './icon-192.png',
        badge: './icon-192.png',
        // 같은 tag면 알림이 쌓이지 않고 마지막 것으로 갱신된다.
        // 대화가 여러 줄 와도 알림창이 도배되지 않게 하려는 것이다.
        tag: data.tag || 'teetime',
        renotify: true,
        data: { url: data.url || './' },
    };
    /* 보고 있는 동안 온 것은 세지 않는다 — 그 자리에서 읽는 것이라
       숫자가 붙었다 바로 지워지는 깜빡임만 남는다. 겸사겸사 앱이 미처
       못 지운 옛 숫자도 여기서 바로잡힌다. */
    event.waitUntil(Promise.all([
        self.registration.showNotification(title, options),
        isWatching().then(seen => bumpBadge(seen ? 0 : 1)),
    ]));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    /* **주소를 스코프에 붙여 절대 주소로 만든다.**
       발송기가 보내는 것은 `#/chat` 같은 상대 주소인데, 이걸 그대로
       `openWindow`에 넘기면 **서비스워커 파일 기준**으로 풀린다 —
       `/teetime/sw.js#/chat`, 즉 알림을 눌렀더니 코드가 뜨는 것이다.
       `registration.scope`가 앱이 놓인 자리(`/teetime/`)이므로 거기에 붙인다. */
    const scope = self.registration.scope;
    const target = new URL(
        (event.notification.data && event.notification.data.url) || './',
        scope,
    ).href;

    event.waitUntil((async () => {
        const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

        for (const client of list) {
            // 우리 앱 창만 쓴다. 다른 탭을 알림 화면으로 끌고 가면 안 된다.
            if (!client.url.startsWith(scope)) continue;
            if (!('focus' in client)) continue;

            // 해시만 바꾸는 이동이라 대개 navigate로 충분한데, iOS는 이걸
            // 지원하지 않기도 한다. 그때를 위해 앱에도 한 마디 보낸다
            // (`lib/push.ts`가 받아서 주소를 옮긴다).
            try { if ('navigate' in client) await client.navigate(target); } catch { /* 무시 */ }
            try { client.postMessage({ type: 'navigate', url: target }); } catch { /* 무시 */ }
            return client.focus();
        }

        if (self.clients.openWindow) return self.clients.openWindow(target);
    })());
});
