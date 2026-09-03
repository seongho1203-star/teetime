/* 대화 입력칸이 **한 글자에 얼마나 일하는가**를 잰다.
 *
 * "치면 좀 끊긴다"는 제보는 스크린샷으로도 `behave.mjs`로도 안 잡힌다 —
 * 화면은 멀쩡히 그려지고 보내는 값도 맞기 때문이다. 여기서 보는 것은
 * **글자 하나를 칠 때 브라우저가 다음 프레임을 그리기까지 걸리는 시간**이다.
 *
 * 재는 방법: 입력칸에 `input`이 오면 그때를 적어 두고, 바로 다음
 * `requestAnimationFrame`에서 다시 재 그 차이를 모은다. 그 사이에 리액트가
 * 다시 그리고 브라우저가 배치를 다시 잡는 일이 전부 들어간다.
 * **긴 대화방일수록 커진다** — 그래서 일부러 말풍선을 잔뜩 만들어 놓고 잰다.
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/type-bench.mjs
 */
import { chromium } from 'playwright-core';
import { tables, ME, uid } from './fixtures.mjs';
import { handleRest } from './rest.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5199';
/** 몇 마디가 쌓인 방에서 잴 것인가. 쉰 명이 떠들면 하루에 100~200개다. */
const BULK = Number(process.argv[2] || 120);
/** 몇 글자를 쳐 볼 것인가. */
const KEYS = 24;

const SESSION = {
    access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

/* 말풍선을 잔뜩 만들어 둔다. 짧은 글·긴 글·`@언급`을 섞는다 — 언급이 든
   글은 그릴 때 이름 목록과 맞춰 보므로 더 무겁다. */
const bulk = [];
for (let i = 0; i < BULK; i++) {
    const who = uid((i % 4) + 1);
    const body = i % 7 === 0
        ? `@신성호 ${i}번째 글입니다. 내일 몇 시에 모이나요?`
        : i % 3 === 0
            ? `${i}번째 글입니다. 조금 긴 글도 섞어 두어야 실제와 비슷합니다. 카트비는 각자 부담입니다.`
            : `${i}번째`;
    const d = new Date();
    d.setUTCMinutes(d.getUTCMinutes() - (BULK - i));
    bulk.push({ id: `b${i}`, room_id: 'room1', user_id: who, body,
                image_url: null, reply_to: null, system: false,
                created_at: d.toISOString() });
}
const withBulk = { ...tables, messages: [...tables.messages, ...bulk] };

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    locale: 'ko-KR', timezoneId: 'Asia/Seoul',
});
await page.route('**/rest/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(handleRest(withBulk, new URL(r.request().url()), r.request())) }));
await page.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await page.route('**/realtime/v1/**', r => r.abort());
await page.route('**fonts.googleapis.com/**', r => r.abort());
await page.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

await page.goto(`${BASE}/#/chat`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const drawn = await page.$$eval('.chat-row', e => e.length);

/* 한 글자마다 `input` → 다음 프레임까지 걸린 시간을 모은다. */
await page.evaluate(() => {
    const el = document.querySelector('.chat-input .textarea');
    window.__lag = [];
    el.addEventListener('input', () => {
        const t0 = performance.now();
        requestAnimationFrame(() => window.__lag.push(performance.now() - t0));
    });
});

await page.click('.chat-input .textarea');
await page.waitForTimeout(300);
for (const ch of '오늘 저녁에 만나서 한잔하시죠 다들'.slice(0, KEYS)) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(35);
}
await page.waitForTimeout(300);

const raw = await page.evaluate(() => window.__lag);
console.log('글자마다:', raw.map((v, i) => `${i + 1}:${v.toFixed(0)}`).join(' '));
const lag = [...raw].sort((a, b) => a - b);
const mid = lag[Math.floor(lag.length / 2)];
const worst = lag[lag.length - 1];
const avg = lag.reduce((s, v) => s + v, 0) / lag.length;

console.log(`말풍선 ${drawn}개가 그려진 방에서 ${lag.length}글자`);
console.log(`  가운데값 ${mid.toFixed(1)}ms · 평균 ${avg.toFixed(1)}ms · 가장 느린 것 ${worst.toFixed(1)}ms`);
console.log(`  16ms(60프레임) 넘긴 글자 ${lag.filter(v => v > 16).length}개 · ` +
            `50ms 넘긴 글자 ${lag.filter(v => v > 50).length}개`);

await browser.close();
