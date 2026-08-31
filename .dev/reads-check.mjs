/* 읽음 표시가 제대로 도는지 본다.
 *
 * **'읽었다' 쓰기가 한 번만 나가야 한다.** 한 마디마다 나가면 100명이
 * 떠들 때 그것만으로 쓰기가 쏟아진다 — 대화 화면의 효과가 마지막 글이
 * 밀렸을 때만, 그것도 700ms 모았다가 보내는 것이 그 장치다.
 * 의존성을 잘못 건드리면 조용히 깨지므로 숫자로 확인한다.
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/reads-check.mjs
 */
import { chromium } from 'playwright-core';
import { tables, ME } from './fixtures.mjs';
import { restRoute, stubOutside } from './rest.mjs';

const SESSION = { access_token: 'f', token_type: 'bearer', refresh_token: 'f',
    expires_in: 999999, expires_at: Math.floor(Date.now()/1000)+999999,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });

const calls = [];
/* **일반 규칙을 먼저 걸고 rpc를 나중에 건다.** playwright는 나중에 건
   규칙을 먼저 보므로, 순서를 뒤집으면 rpc가 일반 규칙에 먹혀 안 잡힌다. */
await ctx.route('**/rest/v1/**', restRoute(tables));
await ctx.route('**/rest/v1/rpc/**', route => {
    calls.push(new URL(route.request().url()).pathname.split('/').pop());
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
});
await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await stubOutside(ctx);
await ctx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto('http://localhost:5199/#/chat', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
console.log('document.hidden =', await page.evaluate(() => document.hidden));
console.log('대화를 열었을 때 나간 rpc:', JSON.stringify(calls));
console.log('  → mark_room_read 가 정확히 1번이어야 한다:',
    calls.filter(c => c === 'mark_room_read').length);

// 다른 탭으로 옮겼다가 돌아와도 쏟아지지 않는가
calls.length = 0;
await page.goto('http://localhost:5199/#/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.goto('http://localhost:5199/#/chat', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
console.log('나갔다 돌아왔을 때:', calls.filter(c => c === 'mark_room_read').length, '번 (1이어야 함)');

if (errs.length) console.log('❌ 오류:', errs.slice(0,3));
else console.log('✅ 자바스크립트 오류 없음');
await b.close();
