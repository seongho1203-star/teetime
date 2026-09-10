/* 알림을 받는 서비스워커.
 *
 * 앱이 닫혀 있어도 브라우저가 이 파일을 깨워 알림을 띄운다.
 * **일부러 캐시를 두지 않는다** — 캐시하면 코드를 고쳐도 예전 화면이 남는다.
 * 이 앱은 assets 파일 이름에 해시가 붙어 있어 캐시가 없어도 빠르다.
 */

self.addEventListener('install', () => self.skipWaiting());

/**
 * **이모티콘 그림 하나만 캐시에 남긴다.**
 *
 * 위에 적힌 '캐시를 두지 않는다'는 규칙의 **유일한 예외**다. 이유가 둘이다:
 *
 * 1. **GitHub Pages는 10분만 캐시하라고 보낸다**(`max-age=600`). 그래서
 *    움직이는 이모티콘(한 장 평균 239KB · 열여덟 장 4.3MB)이 **10분마다 다시
 *    받아진다.** 대화를 하루에 몇 번만 열어도 폰 데이터가 그만큼 나간다.
 * 2. 받아 오는 일이 하필 대화를 훑는 그 순간에 벌어지면 화면이 끊긴다
 *    (`CLAUDE.md`의 '미리 받아 두기'). 캐시에 있으면 아예 안 나간다.
 *
 * **앱 코드가 낡을 걱정이 없다** — 여기서 잡는 것은 `/stickers/` 아래뿐이고,
 * 그 그림들은 한 번 만들면 안 바뀐다(바꿀 일이 생기면 새 id로 넣는다).
 * **다른 주소로 넓히지 말 것** — index.html이 캐시에 남으면 고쳐도 옛 화면이
 * 그대로 뜬다.
 *
 * 그림을 정말 갈아 끼우면 `STICKER_CACHE`의 번호를 올린다. 그러면 앱을 다시
 * 열 때 옛 캐시가 통째로 버려진다.
 */
const STICKER_CACHE = 'stickers-v1';

self.addEventListener('activate', e => e.waitUntil((async () => {
    for (const key of await caches.keys()) {
        if (key !== STICKER_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
})()));

/* **크롬이 '앱 설치'를 띄우는 조건**이라 있는 것이다(안드로이드).
   일부러 캐시를 두지 않는다 — 캐시하면 코드를 고쳐도 예전 화면이 남는다.

   `cache: 'no-store'`가 붙은 이유가 따로 있다. 우리가 캐시를 안 둬도
   **브라우저의 HTTP 캐시**가 index.html을 10분쯤 들고 있다(GitHub Pages가
   그렇게 보낸다). 그 문서가 옛 파일 이름을 가리키고 있으면 새로 배포해도
   폰에는 예전 화면이 그대로 뜬다 — 고친 게 안 먹는다고 여러 번 헤맸다.
   문서만은 늘 새로 받아 온다. 나머지 파일은 이름에 해시가 붙어 있어
   캐시돼도 문제가 없다. */
self.addEventListener('fetch', event => {
    // 이모티콘 그림은 캐시에 있으면 그걸 준다 (위 `STICKER_CACHE` 참고).
    const url = new URL(event.request.url);
    if (event.request.method === 'GET' && url.origin === self.location.origin
        && url.pathname.includes('/stickers/')) {
        event.respondWith((async () => {
            const cache = await caches.open(STICKER_CACHE);
            const hit = await cache.match(event.request);
            if (hit) return hit;
            const res = await fetch(event.request);
            // 실패한 답(404 등)은 남기지 않는다 — 그림을 새로 넣었을 때
            // 없다는 답이 캐시에 굳으면 영영 안 뜬다.
            if (res.ok) cache.put(event.request, res.clone());
            return res;
        })());
        return;
    }

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

/* ── 알림을 누르면 갈 곳을 적어 둔다 ─────────────────────────
 *
 * **앱이 꺼져 있을 때가 문제다.** 알림을 누르면 `openWindow`에 주소를
 * 주는데, **아이폰은 그걸 무시하고 앱을 첫 화면으로 띄우기도 한다.**
 * 그러면 알림을 눌렀는데 홈이 나온다.
 *
 * 그래서 갈 곳을 여기 적어 두고, 앱이 켜질 때 가져가게 한다
 * (`lib/push.ts`가 `take-nav`로 물어본다). 뱃지가 쓰는 그 저장소를
 * 같이 쓴다 — 값 하나 더 넣는 것뿐이라 따로 만들 이유가 없다.
 *
 * **가져가면 지운다.** 안 지우면 다음에 앱을 그냥 켤 때도 옛 알림 화면으로
 * 끌려간다.
 *
 * **누른 시각도 함께 적는다.** 앱은 이걸 켤 때만 묻는 게 아니라
 * **화면으로 돌아올 때마다** 묻는데(`lib/push.ts`), 시각이 없으면 며칠 전에
 * 적히고 안 지워진 값이 남아 있다가 엉뚱한 때 화면을 끌고 간다.
 * 앱 쪽이 방금 누른 것만 따라간다.
 */
async function putNav(url) {
    try {
        const db = await openDb();
        const st = db.transaction('n', 'readwrite').objectStore('n');
        st.put({ url, at: Date.now() }, 'nav');
    } catch { /* 저장이 안 돼도 알림 자체는 떠야 한다 */ }
}

async function takeNav() {
    try {
        const db = await openDb();
        return await new Promise((ok, no) => {
            const st = db.transaction('n', 'readwrite').objectStore('n');
            const get = st.get('nav');
            get.onsuccess = () => {
                st.delete('nav');
                const v = get.result;
                // 예전 판은 주소 하나만 적어 두었다 — 그것도 그대로 받는다.
                ok(typeof v === 'string' ? { url: v, at: 0 } : (v || null));
            };
            get.onerror = () => no(get.error);
        });
    } catch { return null; }
}

/* 앱이 "봤다"고 알려 오면 비운다. **화면에서 직접 세지 않고 여기로 넘기는**
   이유는 세는 곳을 하나로 두려는 것이다. */
self.addEventListener('message', event => {
    const kind = event.data && event.data.type;
    if (kind === 'badge-clear') event.waitUntil(bumpBadge(0));
    // `내 정보`가 "여기서 뱃지가 되느냐"고 물어 온다. **알림이 올 때 도는
    // 쪽이 여기라**, 화면에서 되는지 보는 것만으로는 알 수 없다.
    if (kind === 'badge-support' && event.ports[0]) {
        event.ports[0].postMessage({ badge: 'setAppBadge' in navigator });
    }
    // 앱이 켜지거나 **화면으로 돌아올 때마다** "눌린 알림이 있었나" 물어 온다.
    if (kind === 'take-nav' && event.ports[0]) {
        const port = event.ports[0];
        event.waitUntil(takeNav().then(nav => port.postMessage({
            url: nav && nav.url, at: nav && nav.at,
        })));
    }
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
    event.waitUntil((async () => {
        const seen = await isWatching();

        /* **앱을 보고 있으면 소리 없이 띄운다.**
           안 그러면 소리가 두 번 난다 — 폰의 기본 알림음과, 앱이 내는
           `까꿍`(`lib/sound.ts`)이 같이 울린다. 실제로 아이폰 홈 화면
           앱에서 그렇게 났다. 보고 있을 때 들려야 할 것은 `까꿍`이므로
           여기서 폰 소리를 죽인다.
           **알림 자체는 그대로 띄운다.** 웹푸시는 밀어 준 건마다 눈에
           보이는 알림을 하나 띄우기로 되어 있어서, 아예 안 띄우면
           브라우저가 '백그라운드에서 갱신됨' 같은 제 문구를 대신 띄운다. */
        options.silent = seen;

        /* 보고 있는 동안 온 것은 세지 않는다 — 그 자리에서 읽는 것이라
           숫자가 붙었다 바로 지워지는 깜빡임만 남는다. 겸사겸사 앱이 미처
           못 지운 옛 숫자도 여기서 바로잡힌다. */
        await Promise.all([
            self.registration.showNotification(title, options),
            bumpBadge(seen ? 0 : 1),
        ]);
    })());
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
        /* **먼저 적어 둔다.** 아래 셋 중 무엇이 통할지 기기마다 달라서,
           다 실패해도 앱이 켜질 때 스스로 찾아가게 하는 마지막 길이다. */
        await putNav(target);

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
