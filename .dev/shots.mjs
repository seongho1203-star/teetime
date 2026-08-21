/* 헤드리스로 화면을 훑어 스크린샷을 남긴다.
 *
 * 진짜 Supabase 대신 **네트워크 층에서** 응답을 만들어 준다 —
 * 앱 코드(supabase-js 호출, 필터 조립, 로딩 처리)는 그대로 돌아간다.
 *
 *   node .dev/shots.mjs            (미리 `npm run dev -- --port 5199` 실행)
 */

import { chromium } from 'playwright-core';
import { tables, ME } from './fixtures.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5199';
const OUT = '.dev/shots';

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

    const limit = url.searchParams.get('limit');
    if (limit) rows = rows.slice(0, Number(limit));

    // .single() / .maybeSingle() 은 객체 하나를 기대한다.
    const wantsOne = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    return wantsOne ? (rows[0] ?? null) : rows;
}

const SESSION = {
    access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: {
        id: ME, aud: 'authenticated', role: 'authenticated',
        email: 'seongho@example.com', app_metadata: {}, user_metadata: { name: '신성호' },
        created_at: new Date().toISOString(),
    },
};

const shots = [
    ['login',        '/#/',            { anon: true } ],
    ['home',         '/#/'                            ],
    ['rounds',       '/#/rounds'                      ],
    ['round-detail', '/#/rounds/r1'                   ],
    ['round-new',    '/#/rounds/new'                  ],
    ['polls',        '/#/polls'                       ],
    ['poll-new',     '/#/polls/new'                   ],
    ['board',        '/#/board'                       ],
    ['post',         '/#/board/b1'                    ],
    ['chat',         '/#/chat'                        ],
    ['me',           '/#/me'                          ],
    ['members',      '/#/members'                     ],
];

const errors = [];

const browser = await chromium.launch({ executablePath: CHROME });

for (const [name, path, opts = {}] of shots) {
    const page = await browser.newPage({
        viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
        locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    });

    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => {
        if (m.type() === 'error' && !/WebSocket|realtime|Failed to load resource/i.test(m.text()))
            errors.push(`${name}: ${m.text()}`);
    });

    await page.route('**/rest/v1/**', async route => {
        const url = new URL(route.request().url());
        const body = handleRest(url, route.request());
        await route.fulfill({
            status: 200, contentType: 'application/json',
            headers: { 'content-range': '0-0/*' },
            body: JSON.stringify(body),
        });
    });
    await page.route('**/auth/v1/**', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
    await page.route('**/realtime/v1/**', route => route.abort());

    if (!opts.anon) {
        await page.addInitScript(s => {
            localStorage.setItem('sb-demo-auth-token', JSON.stringify(s));
        }, SESSION);
    }

    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

    const heading = await page.evaluate(() =>
        (document.querySelector('.page-title, .chat-title, .login-brand h1')?.textContent || '').trim());
    console.log(`  ${name.padEnd(14)} → ${heading || '(제목 없음)'}`);

    await page.close();
}

await browser.close();

if (errors.length) {
    console.log('\n⚠️ 오류:');
    for (const e of [...new Set(errors)]) console.log('   ' + e);
    process.exitCode = 1;
} else {
    console.log('\n✅ 자바스크립트 오류 없음');
}
