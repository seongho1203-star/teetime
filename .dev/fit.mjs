/* 화면이 한 눈에 들어오는지 잰다.
 *
 * **보통 크기(390×844)에서만 맞춰 두면 안 된다.** 저장소 주인 폰은
 * iOS `화면 확대`가 켜져 있어 CSS 화면이 320×693으로 좁아진다 — 거기서는
 * 같은 화면이 100px 넘게 넘쳤다(모집 열기에서 실제로 그랬다).
 * 두 크기에서 문서 높이를 재고, 넘치면 몇 px인지 적는다.
 *
 * **다만 '한 화면'이 목표는 아니다.** 폰마다 크기가 달라 어느 하나에 맞추면
 * 다른 데서 어긋난다 — 저장 단추는 `.form-actions`로 바닥에 붙여 두었으므로
 * 넘쳐도 손에 닿는다. 이 숫자는 **여백이 헤픈지 보는 눈금**으로 쓴다.
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/fit.mjs
 */
import { chromium } from 'playwright-core';
import { tables, ME } from '/home/user/teetime/.dev/fixtures.mjs';

function rest(url, req) {
    const t = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
    let rows = tables[t] ? [...tables[t]] : [];
    for (const [k, raw] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
        const [op, v] = raw.split(/\.(.*)/s);
        rows = rows.filter(r => op === 'eq' ? String(r[k]) === v
            : op === 'neq' ? String(r[k]) !== v
            : op === 'is' ? (v === 'null' ? r[k] === null : String(r[k]) === v) : true);
    }
    const one = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    return one ? (rows[0] ?? null) : rows;
}

const SESSION = {
    access_token: 'f', token_type: 'bearer', refresh_token: 'f', expires_in: 9e5,
    expires_at: Math.floor(Date.now() / 1000) + 9e5,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: { name: '신성호' }, created_at: new Date().toISOString() },
};

/* 한 화면에 들었으면 좋은 것들 — **적어 넣는 화면**이다.
   목록·상세는 글과 명단이 늘어나는 만큼 길어지는 게 맞으므로 뺐다
   (늘 ❌가 뜨면 그 표시를 안 보게 된다). */
const ROUTES = [
    ['모집 열기',   '/#/rounds/new'],
    ['투표 만들기', '/#/polls/new'],
    ['공지 쓰기',   '/#/board/new'],
    ['내 정보',     '/#/me'],
];
const SIZES = [['보통', 390, 844], ['확대', 320, 693]];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let over = 0;

for (const [label, w, h] of SIZES) {
    console.log(`\n── ${label} ${w}×${h} ──`);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2,
                                         locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await page.route('**/rest/v1/**', r => r.fulfill({
        status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/*' },
        body: JSON.stringify(rest(new URL(r.request().url()), r.request())) }));
    await page.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
    await page.route('**/realtime/v1/**', r => r.abort());
    await page.route('**fonts.g**', r => r.abort());
    await page.route('**api.open-meteo.com/**', r => r.abort());
    await page.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

    for (const [name, route] of ROUTES) {
        await page.goto('http://localhost:5199' + route, { waitUntil: 'networkidle' });
        await page.waitForTimeout(450);
        const doc = await page.evaluate(() => Math.round(document.documentElement.scrollHeight));
        const diff = doc - h;
        if (diff > 1) over++;
        console.log(`  ${name.padEnd(7)} ${String(doc).padStart(4)}px` +
                    (diff > 1 ? `  ❌ ${diff}px 넘침` : '  ✅'));
    }
    await page.close();
}
await browser.close();
console.log(over ? `\n${over}곳이 한 화면을 넘는다.` : '\n모두 한 화면에 든다.');
