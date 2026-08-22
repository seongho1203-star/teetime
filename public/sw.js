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
   그냥 통과시키기만 한다. */
self.addEventListener('fetch', event => {
    if (event.request.mode === 'navigate') event.respondWith(fetch(event.request));
});

/* 알림창 맨 윗줄(`Teetime`)은 **우리가 넣는 게 아니다.** 폰이 앱 이름을
   붙인다 — 홈 화면 앱이면 manifest의 name, 브라우저 탭이면 사이트 주소다.
   주소가 뜨는 건 브라우저가 '어디서 온 알림인지' 밝히는 것이라 끌 수 없다.
   설치해서 쓰면 이름으로 바뀐다. 우리가 정할 수 있는 건 그 이름뿐이다. */
self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

    const title = data.title || 'Teetime';
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
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil((async () => {
        const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        // 이미 열려 있는 창이 있으면 그 창을 앞으로 가져온다.
        for (const client of list) {
            if ('focus' in client) {
                if ('navigate' in client && target) {
                    try { await client.navigate(target); } catch { /* 다른 출처면 그냥 둔다 */ }
                }
                return client.focus();
            }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
    })());
});
