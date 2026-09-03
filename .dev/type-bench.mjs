/* 글칸이 **한 글자에 얼마나 일하는가**를 잰다.
 *
 * "치면 좀 끊긴다"는 제보는 스크린샷으로도 `behave.mjs`로도 안 잡힌다 —
 * 화면은 멀쩡히 그려지고 보내는 값도 맞기 때문이다. 여기서 보는 것은
 * **글자 하나를 칠 때 브라우저가 다음 프레임을 그리기까지 걸리는 시간**이다.
 *
 * 재는 방법: 칸에 `input`이 오면 그때를 적어 두고, 바로 다음
 * `requestAnimationFrame`에서 다시 재 그 차이를 모은다. 그 사이에 리액트가
 * 다시 그리고 브라우저가 배치를 다시 잡는 일이 전부 들어간다.
 *
 * **긴 목록 위에 얹힌 칸일수록 커진다.** 글자마다 목록이 통째로 다시
 * 그려지기 때문이다 — 그래서 100명·말풍선 잔뜩인 상태로 잰다.
 * 대화 입력칸이 실제로 그랬다(19글자 중 9글자가 한 프레임을 넘겼다).
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/type-bench.mjs           # 위험한 칸을 전부
 *   node .dev/type-bench.mjs 대화       # 이름에 그 글자가 든 것만
 */
import { chromium } from 'playwright-core';
import { tables as base, ME, uid } from './fixtures.mjs';
import { handleRest } from './rest.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5199';
const ONLY = process.argv[2] || '';
/** 회원 수. 사용자가 정해 준 전제가 50~100명이다. */
const PEOPLE = 100;
/** 대화방에 쌓아 둘 말 수. 쉰 명이 떠들면 하루에 100~200개다. */
const BULK = 120;
/** 한 프레임. 이걸 넘긴 글자가 곧 '끊긴 글자'다. */
const FRAME = 16;

const SESSION = {
    access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

/* ── 100명·말풍선 120개짜리 상태를 만든다 ─────────────────────── */
const NAMES = ['신성호', '이관교', '김지명', '박승수', '정우성'];
const people = Array.from({ length: PEOPLE }, (_, i) => ({
    id: uid(i + 1),
    name: i < NAMES.length ? NAMES[i] : `회원${i + 1}`,
    avatar_url: null,
    role: i === 0 ? 'superadmin' : i === 1 ? 'admin' : i % 31 === 0 ? 'pending' : 'member',
    /* **앞의 다섯은 빠짐없이 채운다.** 나(uid 1)가 비어 있으면 로그인
       뒤의 `FillProfile`에 갇혀 어느 화면도 안 열린다 — 실제로 그래서
       칸을 하나도 못 찾았다. 뒤쪽 사람만 비워 실제와 비슷하게 둔다. */
    gender: i >= 5 && i % 5 === 0 ? null : (i % 4 === 0 ? 'f' : 'm'),
    birth_year: i >= 5 && i % 5 === 0 ? null : 1950 + (i * 7) % 45,
    region: i >= 5 && i % 6 === 0 ? null : ['광산구', '북구', '서구', '남구', '동구'][i % 5],
    joined_at: new Date(Date.now() - 864e5 * (PEOPLE - i)).toISOString(),
    memo: '', created_at: new Date(Date.now() - 864e5 * (PEOPLE - i)).toISOString(),
}));
const contacts = people.map((p, i) => ({
    id: p.id, phone: `010-${1000 + i}-${5678 + i}`, car: `${10 + (i % 80)}가 ${1000 + i}` }));

const bulk = [];
for (let i = 0; i < BULK; i++) {
    const body = i % 7 === 0
        ? `@신성호 ${i}번째 글입니다. 내일 몇 시에 모이나요?`
        : i % 3 === 0
            ? `${i}번째 글입니다. 조금 긴 글도 섞어 두어야 실제와 비슷합니다. 카트비는 각자 부담입니다.`
            : `${i}번째`;
    const d = new Date();
    d.setUTCMinutes(d.getUTCMinutes() - (BULK - i));
    bulk.push({ id: `b${i}`, room_id: 'room1', user_id: uid((i % 4) + 1), body,
                image_url: null, reply_to: null, system: false, created_at: d.toISOString() });
}
/* 라운드 하나에 확정자를 많이 붙여 둔다 — 정산 만들기의 `참가자` 묶음과
   `그 외` 찾기가 그만큼 길어진다. */
const manySignups = people.slice(0, 12).map((p, i) => ({
    id: `bs${i}`, round_id: 'r1', user_id: p.id, state: 'confirmed',
    seq: 100 + i, grp: null, note: '', created_at: new Date().toISOString(),
}));
const big = {
    ...base,
    profiles: people,
    profile_private: contacts,
    messages: [...base.messages, ...bulk],
    signups: [...base.signups, ...manySignups],
};

/* ── 잴 자리 ──────────────────────────────────────────────────
 * 긴 목록 위에 얹힌 칸만 고른다. 이름 몇 자짜리 폼(가입·내 정보)은
 * 뒤에 목록이 없어 글자마다 다시 그려도 쌀 수밖에 없다. */
const SPOTS = [
    { name: '대화 — 메시지', at: '/#/chat', sel: '.chat-input .textarea',
      why: '말풍선 50개가 뒤에 있다' },
    { name: '회원 명단 — 찾기', at: '/#/members', sel: '.member-find input',
      why: '100명이 뒤에 있다' },
    { name: '모집 열기 — 골프장', at: '/#/rounds/new', sel: '#f-course',
      why: '전국 574곳에서 찾는다' },
    { name: '모집 열기 — 안내', at: '/#/rounds/new', sel: '#f-note',
      why: '같은 화면의 긴 폼' },
    { name: '공지 쓰기 — 내용', at: '/#/board/new', sel: '#b-body',
      why: '' },
    { name: '투표 만들기 — 설명', at: '/#/polls/new', sel: '#v-body',
      why: '항목 줄과 달력이 함께 있다' },
    { name: '라운드 댓글', at: '/#/rounds/r1', sel: '.comment-field .textarea',
      why: '참가자 12명 · 정산이 함께 있다' },
    { name: '정산 만들기 — 사람 찾기', at: '/#/rounds/r1', sel: '#s-find',
      why: '100명에서 고른다',
      /* 정산 만들기를 열고 → `그 외`를 펼쳐야 찾기 칸이 나온다. */
      open: ['＋ 정산', '＋ 참가자 외 다른 사람 추가'] },
];

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    locale: 'ko-KR', timezoneId: 'Asia/Seoul',
});
await page.route('**/rest/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(handleRest(big, new URL(r.request().url()), r.request())) }));
await page.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await page.route('**/realtime/v1/**', r => r.abort());
await page.route('**fonts.googleapis.com/**', r => r.abort());
await page.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

const WORD = '무등산에서 저녁에 만나요';
let worstSpot = null;

for (const spot of SPOTS) {
    if (ONLY && !spot.name.includes(ONLY)) continue;
    await page.goto(BASE + spot.at, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    let reached = true;
    for (const label of [].concat(spot.open ?? [])) {
        const btn = page.getByText(label, { exact: true });
        if (await btn.count() === 0) {
            console.log(`\n${spot.name} — \`${label}\`을 못 찾았다`);
            reached = false; break;
        }
        await btn.first().click();
        await page.waitForTimeout(600);
    }
    if (!reached) continue;
    if (await page.$(spot.sel) === null) {
        console.log(`\n${spot.name} — 칸을 못 찾았다 (${spot.sel})`);
        continue;
    }

    await page.evaluate(sel => {
        const el = document.querySelector(sel);
        window.__lag = [];
        el.addEventListener('input', () => {
            const t0 = performance.now();
            requestAnimationFrame(() => window.__lag.push(performance.now() - t0));
        });
    }, spot.sel);

    await page.click(spot.sel);
    await page.waitForTimeout(250);
    for (const ch of WORD) {
        await page.keyboard.type(ch);
        await page.waitForTimeout(35);
    }
    await page.waitForTimeout(250);

    const raw = await page.evaluate(() => window.__lag);
    if (!raw.length) { console.log(`\n${spot.name} — 글자가 안 들어갔다`); continue; }
    const lag = [...raw].sort((a, b) => a - b);
    const mid = lag[Math.floor(lag.length / 2)];
    const worst = lag[lag.length - 1];
    const over = lag.filter(v => v > FRAME).length;
    const mark = over === 0 ? '✅' : over <= 2 ? '△' : '❌';

    console.log(`\n${mark} ${spot.name}${spot.why ? `  (${spot.why})` : ''}`);
    console.log(`   가운데값 ${mid.toFixed(1)}ms · 가장 느린 것 ${worst.toFixed(1)}ms · ` +
                `${FRAME}ms 넘긴 글자 ${over}/${lag.length}`);
    console.log(`   글자마다: ${raw.map(v => v.toFixed(0)).join(' ')}`);
    if (!worstSpot || over > worstSpot.over) worstSpot = { ...spot, over };
}

console.log('\n' + (worstSpot && worstSpot.over > 2
    ? `가장 나쁜 곳: ${worstSpot.name} (${worstSpot.over}글자가 한 프레임을 넘겼다)`
    : '한 프레임을 크게 넘기는 칸은 없다'));

await browser.close();
