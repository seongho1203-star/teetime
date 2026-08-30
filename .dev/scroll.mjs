/* 화면을 실제 뷰포트 크기로, 위/가운데/아래를 나눠 찍는다.
 * fullPage 캡처는 sticky·fixed 요소를 엉뚱한 자리에 그려서 판단할 수가 없다. */

import { chromium } from 'playwright-core';
import { tables, ME } from './fixtures.mjs';
import { handleRest } from './rest.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5199';
const path = process.argv[2] || '/#/rounds/r1';
const tag = process.argv[3] || 'view';
/* 넷째 인자로 화면 크기를 준다 — `320x693`처럼. 저장소 주인 폰은 iOS
   `화면 확대`가 켜져 있어 320px이라, 거기서만 어긋나는 자리가 있다. */
const [VW, VH] = (process.argv[4] || '390x844').split('x').map(Number);


const SESSION = {
    access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({
    viewport: { width: VW, height: VH }, deviceScaleFactor: 2,
    locale: 'ko-KR', timezoneId: 'Asia/Seoul',
});
await page.route('**/rest/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(handleRest(tables, new URL(r.request().url()), r.request())),
}));
await page.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await page.route('**/realtime/v1/**', r => r.abort());

    /* 제목 글꼴(Jua)은 확인 도구에서 받지 않는다. 화면마다 구글에 다녀오면
       열두 장을 찍는 데 몇 분이 걸린다. 실제 앱에서는 `display=swap`이라
       글꼴이 늦게 와도 화면이 먼저 뜬다. */
    await page.route('**fonts.googleapis.com/**', r => r.abort());
    await page.route('**fonts.gstatic.com/**', r => r.abort());
    // Pretendard도 밖에서 받는다. 화면마다 다녀오면 열두 장 찍는 데 오래 걸린다.
    await page.route('**cdn.jsdelivr.net/**', r => r.abort());
await page.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

await page.goto(BASE + path, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const h = await page.evaluate(() => document.documentElement.scrollHeight);
console.log('문서 높이', h, '· 화면', VW + '×' + VH);

for (const [name, y] of [['top', 0], ['mid', Math.round((h - VH) / 2)], ['bottom', h]]) {
    await page.evaluate(v => window.scrollTo(0, v), y);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `.dev/shots/${tag}-${name}.png` });
}
await browser.close();
console.log('찍었습니다');
