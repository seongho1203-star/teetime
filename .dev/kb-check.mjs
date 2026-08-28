/* 키보드가 올라온 대화 화면을 확인한다.
 *
 * 헤드리스에는 키보드가 없으므로 **키보드가 가린 높이를 직접 넣어** 흉내 낸다
 * (`--kb` + `body.kb-open` — Chat.tsx가 visualViewport를 보고 하는 일과 같다).
 * 실기기에서 대화가 한 줄도 안 보이던 것을 고치며 만들었다.
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/kb-check.mjs
 */

import { chromium } from 'playwright-core';
import { tables, ME } from '/home/user/teetime/.dev/fixtures.mjs';

/* PostgREST 흉내 — 앱이 실제로 쓰는 필터만 처리한다. */
function handleRest(url, req) {
    const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
    let rows = tables[table] ? [...tables[table]] : [];

    for (const [key, raw] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        const [op, value] = raw.split(/\.(.*)/s);
        rows = rows.filter(r => {
            const v = r[key];
            switch (op) {
                case 'eq':  return String(v) === value;
                case 'neq': return String(v) !== value;
                case 'is':  return value === 'null' ? v === null : String(v) === value;
                case 'lt':  return String(v) < value;
                case 'gt':  return String(v) > value;
                case 'gte': return String(v) >= value;
                case 'lte': return String(v) <= value;
                case 'in':  return value.replace(/[()]/g, '').split(',').includes(String(v));
                default:    return true;
            }
        });
    }

    for (const spec of url.searchParams.getAll('order').reverse()) {
        const [col, ...mods] = spec.split('.');
        const desc = mods.includes('desc');
        rows.sort((a, b) => {
            const x = a[col], y = b[col];
            const c = x === y ? 0 : (x ?? '') < (y ?? '') ? -1 : 1;
            return desc ? -c : c;
        });
    }

    /* **딸려 받기(embed) 흉내.** `select=*,signups(*)` 처럼 적으면
       PostgREST 가 외래키를 보고 채워 준다 — 홈이 신청 기록을 이렇게 받는다. */
    for (const m of (url.searchParams.get('select') ?? '').matchAll(/(\w+)\(\*\)/g)) {
        const child = m[1];
        const fk = table.replace(/s$/, '') + '_id';       // rounds → round_id
        rows = rows.map(r => ({ ...r, [child]: (tables[child] ?? []).filter(c => c[fk] === r.id) }));
    }

    const limit = url.searchParams.get('limit');
    if (limit) rows = rows.slice(0, Number(limit));

    // .single() / .maybeSingle() 은 객체 하나를 기대한다.
    const wantsOne = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    return wantsOne ? (rows[0] ?? null) : rows;
}


const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SESSION = {
    access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: { name: '신성호' }, created_at: new Date().toISOString() },
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
                                     locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
await page.route('**/rest/v1/**', async route => {
    const url = new URL(route.request().url());
    const body = handleRest(url, route.request());
    await route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'content-range': '0-0/*' }, body: JSON.stringify(body) });
});
await page.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await page.route('**/realtime/v1/**', r => r.abort());

    /* 제목 글꼴(Jua)은 확인 도구에서 받지 않는다. 화면마다 구글에 다녀오면
       열두 장을 찍는 데 몇 분이 걸린다. 실제 앱에서는 `display=swap`이라
       글꼴이 늦게 와도 화면이 먼저 뜬다. */
    await page.route('**fonts.googleapis.com/**', r => r.abort());
    await page.route('**fonts.gstatic.com/**', r => r.abort());
    // Pretendard도 밖에서 받는다. 화면마다 다녀오면 열두 장 찍는 데 오래 걸린다.
    await page.route('**cdn.jsdelivr.net/**', r => r.abort());
await page.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

await page.goto('http://localhost:5199/#/chat', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// 키보드가 336px 가린 상태를 흉내 낸다 (아이폰 한글 키보드 높이쯤).
// `--vvh`(실제로 보이는 높이)도 함께 넣어야 한다 — 진짜 키보드가 올라오면
// Chat.tsx가 둘 다 채우고, 화면 높이는 그중 --vvh를 본다.
await page.evaluate(() => {
    document.documentElement.style.setProperty('--kb', '336px');
    document.documentElement.style.setProperty('--vvh', `${window.innerHeight - 336}px`);
    document.body.classList.add('kb-open');
});
await page.waitForTimeout(300);

const m = await page.evaluate(() => {
    const chat = document.querySelector('.chat');
    const list = document.querySelector('.chat-list');
    const input = document.querySelector('.chat-input');
    const tab = document.querySelector('.tabbar');
    return {
        chatH: Math.round(chat.getBoundingClientRect().height),
        listH: Math.round(list.getBoundingClientRect().height),
        inputBottom: Math.round(input.getBoundingClientRect().bottom),
        tabVisible: !!tab && getComputedStyle(tab).display !== 'none',
    };
});
console.log('키보드 올라온 상태:', JSON.stringify(m));
console.log('  → 대화 목록 높이', m.listH, 'px / 입력칸 아래끝', m.inputBottom, '(키보드 위 508px 안이어야 함)');
await page.screenshot({ path: '.dev/shots/chat-keyboard.png' });
await browser.close();
