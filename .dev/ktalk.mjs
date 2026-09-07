/**
 * 카톡 오픈톡 화면과 **같은 자로** 우리 화면을 잰다.
 *
 * 사용자가 준 두 사진이 같은 폰·같은 순간이라, 우리 창의 좌우 여백
 * (`--gap` 16px)이 사진에서 56픽셀인 것으로 배율 3.5를 얻었다.
 * 그래서 여기서도 **345×844 · 배율 3.5**로 찍어 픽셀을 그대로 견준다.
 * 눈대중으로 고치지 말 것 — 이 파일을 돌려서 숫자로 맞춘다.
 */
import { chromium } from 'playwright-core';
import { handleRest } from './rest.mjs';
import { tables, ME } from './fixtures.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SESSION = {
    access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: { name: '신성호' },
            created_at: new Date().toISOString() },
};
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 345, height: 844 }, deviceScaleFactor: 3.5 });
await ctx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
await ctx.route('**/rest/v1/**', async route => {
    const req = route.request();
    const body = handleRest(tables, new URL(req.url()), req);
    const n = Array.isArray(body) ? body.length : body ? 1 : 0;
    await route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'content-range': n ? `0-${n - 1}/${n}` : '*/0',
                   'access-control-expose-headers': 'content-range' },
        body: req.method() === 'HEAD' ? '' : JSON.stringify(body) });
});
await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200,
    contentType: 'application/json', body: JSON.stringify(SESSION) }));
const p = await ctx.newPage();
await p.goto('http://localhost:5199/#/chat', { waitUntil: 'networkidle' });
await p.waitForTimeout(1800);

const m = await p.evaluate(() => {
    const R = s => { const e = document.querySelector(s); if (!e) return null;
        const b = e.getBoundingClientRect();
        return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const C = (s, ...ps) => { const e = document.querySelector(s); if (!e) return null;
        const c = getComputedStyle(e); const o = {}; ps.forEach(k => o[k] = c[k]); return o; };
    const row = document.querySelector('[data-mid="m1"]');
    const bub = row?.querySelector('.chat-bubble');
    return {
        말풍선: R('[data-mid="m1"] .chat-bubble'),
        말풍선글꼴: C('[data-mid="m1"] .chat-bubble', 'fontSize', 'lineHeight', 'padding', 'borderRadius'),
        아바타: R('[data-mid="m1"] .avatar'),
        이름: C('.chat-who', 'fontSize'),
        시각: C('.chat-time', 'fontSize') ?? C('.chat-stamp', 'fontSize'),
        목록여백: C('.chat-list', 'paddingLeft', 'paddingRight', 'paddingTop'),
        줄틈: C('.chat-row', 'marginTop', 'gap'),
        칸최대: C('.chat-col', 'maxWidth'),
        머리말: R('.chat-head'),
        입력줄: R('.chat-input'),
        한줄높이: bub ? +bub.getBoundingClientRect().height.toFixed(1) : null,
    };
});
console.log(JSON.stringify(m, null, 1));
const wide = await p.evaluate(() => {
    let best = 0, txt = '';
    for (const e of document.querySelectorAll('.chat-bubble')) {
        const w = e.getBoundingClientRect().width;
        if (w > best) { best = w; txt = e.textContent.slice(0, 18); }
    }
    const one = document.querySelector('[data-mid="m1"] .chat-bubble');
    return { 가장넓은말풍선: +best.toFixed(1), 글: txt,
             한줄높이: +one.getBoundingClientRect().height.toFixed(1),
             말풍선색: getComputedStyle(one).backgroundColor };
});
console.log(JSON.stringify(wide));
await p.evaluate(() => { const el = document.querySelector('.chat-list'); el.scrollTop = 0; });
await p.waitForTimeout(500);
await p.screenshot({ path: '.dev/shots/ours-345.png' });
await b.close();
