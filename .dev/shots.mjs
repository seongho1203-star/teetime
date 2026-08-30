/* 헤드리스로 화면을 훑어 스크린샷을 남긴다.
 *
 * 진짜 Supabase 대신 **네트워크 층에서** 응답을 만들어 준다 —
 * 앱 코드(supabase-js 호출, 필터 조립, 로딩 처리)는 그대로 돌아간다.
 *
 *   node .dev/shots.mjs            (미리 `npm run dev -- --port 5199` 실행)
 */

import { chromium } from 'playwright-core';
import { tables, ME } from './fixtures.mjs';
import { handleRest } from './rest.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5199';
const OUT = '.dev/shots';

/* PostgREST 흉내 — 앱이 실제로 쓰는 필터만 처리한다. */

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
    ['poll-detail',  '/#/polls/p1'                    ],
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
        const req = route.request();
        const url = new URL(req.url());
        const body = handleRest(tables, url, req);

        // 개수만 세는 조회(head:true, count:'exact')는 몸통이 아니라
        // **content-range 헤더**로 답한다. 여기서 진짜 수를 넣어 주지 않으면
        // 탭바의 안 읽음 숫자가 헤드리스에서만 0으로 보인다.
        const n = Array.isArray(body) ? body.length : body ? 1 : 0;
        const head = req.method() === 'HEAD';
        await route.fulfill({
            status: 200, contentType: 'application/json',
            headers: {
                'content-range': n ? `0-${n - 1}/${n}` : `*/0`,
                // 다른 출처의 응답이라 이걸 안 붙이면 브라우저가 위 헤더를
                // 자바스크립트에 안 보여 준다 — 개수가 늘 0으로 읽힌다.
                // 진짜 Supabase는 이 헤더를 붙여서 보낸다.
                'access-control-expose-headers': 'content-range',
            },
            body: head ? '' : JSON.stringify(body),
        });
    });
    await page.route('**/auth/v1/**', route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
    await page.route('**/realtime/v1/**', route => route.abort());

    /* 제목 글꼴(Jua)은 확인 도구에서 받지 않는다. 화면마다 구글에 다녀오면
       열두 장을 찍는 데 몇 분이 걸린다. 실제 앱에서는 `display=swap`이라
       글꼴이 늦게 와도 화면이 먼저 뜬다. */
    await page.route('**fonts.googleapis.com/**', r => r.abort());
    await page.route('**fonts.gstatic.com/**', r => r.abort());
    // Pretendard도 밖에서 받는다. 화면마다 다녀오면 열두 장 찍는 데 오래 걸린다.
    await page.route('**cdn.jsdelivr.net/**', r => r.abort());

    /* 날씨(Open-Meteo)도 흉내 낸다. 진짜로 부르면 화면마다 요청이 나가고,
       망이 막힌 곳에서는 날씨칸이 통째로 빠져 확인이 안 된다. */
    await page.route('**api.open-meteo.com/**', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ daily: {
            weather_code: [1], temperature_2m_max: [31.4], temperature_2m_min: [21.8],
            precipitation_probability_max: [10],
        } }),
    }));

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
