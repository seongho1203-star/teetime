/* 화면 전체를 훑어 '눈에 안 띄는 어긋남'을 숫자로 잡는다.
 *
 * 스크린샷은 사람이 봐야 알지만, 아래 넷은 기계가 더 잘 본다:
 *   1. 가로로 삐져나온 것 (화면이 좌우로 밀린다)
 *   2. 글자가 제 칸을 넘은 것 (동그란 아바타에서 실제로 났다)
 *   3. 너무 작은 누름 자리 (손가락은 44px이 기준이다)
 *   4. 바닥 탭바에 가린 것
 * 두 크기에서 모두 본다 — 저장소 주인 폰은 화면 확대가 켜져 있어 320px이다.
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/audit.mjs
 */
import { chromium } from 'playwright-core';
import { tables, ME } from './fixtures.mjs';
import { handleRest } from './rest.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5199';


const SESSION = {
    access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: {
        id: ME, aud: 'authenticated', role: 'authenticated',
        email: 'seongho@example.com', app_metadata: {}, user_metadata: { name: '신성호' },
        created_at: new Date().toISOString(),
    },
};

const ROUTES = [
    ['홈',        '/#/'],
    ['라운드',     '/#/rounds'],
    ['라운드 상세', '/#/rounds/r1'],
    ['조 편성된 라운드', '/#/rounds/r2'],
    ['조 편성',    '/#/rounds/r2/groups'],
    ['모집 열기',   '/#/rounds/new'],
    ['투표',       '/#/polls'],
    ['투표 만들기', '/#/polls/new'],
    ['투표 상세',   '/#/polls/p1'],
    ['공지',       '/#/board'],
    ['공지 상세',   '/#/board/b1'],
    ['대화',       '/#/chat'],
    ['내 정보',     '/#/me'],
    ['멤버',       '/#/members'],
    ['정산 현황',   '/#/settle'],
    ['사용법',      '/#/help'],
];

/* 페이지 안에서 도는 검사. 셋 다 '보이는 요소'만 본다. */
const CHECK = (vw) => {
    const out = { wide: [], clipped: [], small: [], hidden: [] };
    const seen = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    const where = (el) => {
        const id = el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase();
        return id + ' 〈' + (el.textContent || '').trim().slice(0, 18) + '〉';
    };

    for (const el of document.querySelectorAll('body *')) {
        if (!seen(el)) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);

        // 1. 화면 밖으로 삐져나온 것 (좌우 스크롤이 생기는 원인)
        if (r.right > vw + 1 || r.left < -1) {
            if (cs.position !== 'fixed' && !el.closest('[data-scroll-x]')) {
                out.wide.push(where(el) + ' → ' + Math.round(r.left) + '~' + Math.round(r.right));
            }
        }

        // 2. 글자가 제 칸을 넘은 것 — 넘치는데 가리지도 스크롤되지도 않는 자리
        const overW = el.scrollWidth - el.clientWidth;
        const overH = el.scrollHeight - el.clientHeight;
        const canScroll = /auto|scroll/.test(cs.overflowX + cs.overflowY);
        // 몇 줄까지만 보이게 일부러 자른 것(`-webkit-line-clamp`)은 넘치는 게
        // 맞다. 공지 목록의 미리보기가 그렇다 — 여기서 세면 늘 걸린다.
        const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
        if (!canScroll && !clamped && el.children.length === 0 && (overW > 1 || overH > 1)) {
            out.clipped.push(where(el) + ' → 가로 +' + overW + ' 세로 +' + overH
                + ' (' + cs.overflow + ')');
        }

        /* 3. 누름 자리가 너무 작은 것.
              애플이 말하는 기준은 44px이지만 그대로 재면 뱃지만 한 단추가
              전부 걸려 쓸모가 없다. **30px을 바닥선으로 둔다** — 지우기(✕)
              처럼 일부러 작게 둔 것(누르면 한 번 더 묻는다)은 여기서 통과하고,
              그보다 작은 것만 남는다.
              스위치(`.switch`)는 뺀다 — 손이 닿는 곳은 스위치가 아니라
              그 줄 전체이고, 크기는 iOS 토글에 맞춰 둔 값이다. */
        const tappable = el.matches('button, a[href], input[type=checkbox], [role=button]')
            && !el.closest('.switch');
        if (tappable && (r.height < 30 || r.width < 30)) {
            out.small.push(where(el) + ' → ' + Math.round(r.width) + '×' + Math.round(r.height));
        }
    }

    /* 4. 바닥의 탭바에 본문 끝이 가리지 않는가.
          본문 아래 여백이 탭바 높이보다 작으면 마지막 줄이 가린다.
          (fullPage 스크린샷은 탭바를 맨 아래에 그려서 늘 가린 것처럼
           보이므로, 여기서는 숫자로 본다.) */
    const bar = document.querySelector('.tabbar');
    const page = document.querySelector('.page');
    if (bar && page) {
        const barH = bar.getBoundingClientRect().height;
        const pad = parseFloat(getComputedStyle(page).paddingBottom) || 0;
        if (pad < barH) {
            out.hidden.push('본문 아래 여백 ' + Math.round(pad)
                + 'px < 탭바 ' + Math.round(barH) + 'px');
        }
    }
    return out;
};

const sizes = [['보통', 390, 844], ['확대', 320, 693]];
const browser = await chromium.launch({ executablePath: CHROME });
let problems = 0;

for (const [label, W, H] of sizes) {
    console.log('\n═══ ' + label + ' ' + W + '×' + H + ' ═══');
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    await ctx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    await ctx.route('**/rest/v1/**', async route => {
        const req = route.request();
        const body = handleRest(tables, new URL(req.url()), req);
        const n = Array.isArray(body) ? body.length : body ? 1 : 0;
        await route.fulfill({
            status: 200, contentType: 'application/json',
            headers: {
                'content-range': n ? `0-${n - 1}/${n}` : '*/0',
                'access-control-expose-headers': 'content-range',
            },
            body: req.method() === 'HEAD' ? '' : JSON.stringify(body),
        });
    });
    await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(SESSION) }));
    await ctx.route('**/realtime/v1/**', r => r.abort());
    await ctx.route('**fonts.googleapis.com/**', r => r.abort());
    await ctx.route('**fonts.gstatic.com/**', r => r.abort());
    await ctx.route('**cdn.jsdelivr.net/**', r => r.abort());
    await ctx.route('**api.open-meteo.com/**', r => r.fulfill({ status: 200,
        contentType: 'application/json', body: JSON.stringify({
            daily: { weather_code: [1], temperature_2m_max: [31.4],
                     temperature_2m_min: [21.8], precipitation_probability_max: [10] } }) }));

    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource/i.test(m.text()))
            errors.push(m.text());
    });

    for (const [name, route] of ROUTES) {
        await page.goto(BASE + route, { waitUntil: 'networkidle' });
        await page.waitForTimeout(350);
        const r = await page.evaluate(CHECK, W);
        const doc = await page.evaluate(() => [
            document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
        const lines = [];
        if (doc[0] > W) lines.push('  ⚠︎ 좌우로 밀린다: 문서 폭 ' + doc[0] + 'px (화면 ' + W + ')');
        for (const s of r.wide.slice(0, 4))    lines.push('  ⚠︎ 삐져나옴 ' + s);
        for (const s of r.clipped.slice(0, 4)) lines.push('  ⚠︎ 글자 넘침 ' + s);
        for (const s of r.small.slice(0, 4))   lines.push('  ⚠︎ 누름 자리 작음 ' + s);
        for (const s of r.hidden)              lines.push('  ⚠︎ 탭바에 가림 ' + s);
        problems += lines.length;
        console.log('\n' + name.padEnd(12) + ' 높이 ' + doc[1] + 'px' + (lines.length ? '' : '  ✅'));
        lines.forEach(l => console.log(l));
    }
    if (errors.length) {
        console.log('\n❌ 자바스크립트 오류');
        [...new Set(errors)].slice(0, 8).forEach(e => console.log('   ' + e.slice(0, 160)));
        problems += errors.length;
    }
    await ctx.close();
}

await browser.close();
console.log('\n' + (problems ? '짚을 곳 ' + problems + '군데' : '✅ 깨끗함'));
