/* 사람이 늘면 어디가 먼저 부러지는지 잰다.
 *
 * 무료 통신량은 **월 5GB**다. 화면 한 번 여는 데 몇 KB가 오가는지는
 * 사람 수와 쌓인 기록에 따라 달라지므로, **가짜로 1년치를 만들어 놓고**
 * 화면마다 실제로 오간 바이트를 센다 (네트워크 층에서 가로채 크기를 잰다).
 *
 * 예전에 50명으로 재서 홈을 367KB → 7KB로 줄였다. 이 도구는 그때 쓴 것을
 * 다시 쓸 수 있게 남긴 것이다.
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/scale.mjs          # 기본 100명
 *   node .dev/scale.mjs 50       # 50명으로
 *   node .dev/scale.mjs 100 --shots   # 그 상태의 화면도 .dev/shots/ 에
 */
import { chromium } from 'playwright-core';
import { restRoute, stubOutside } from './rest.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5199';
const N = Number(process.argv[2] || 100);
/* `--shots`를 주면 화면도 함께 찍는다. */
const SHOTS = process.argv.includes('--shots');

/* ── 1년치 가짜 기록 ──────────────────────────────────────────
 * 100명 모임이 한 해 동안 쌓았을 만한 양이다. 넉넉하게 잡는다 —
 * 모자라게 잡으면 괜찮다고 잘못 판단한다. */
const YEAR = 365;
const ROUNDS = 156;          // 주 3회 (필드 2 · 스크린 1)
const PER_ROUND = 8;         // 확정 + 대기
const POLLS = 24;            // 달에 두 번
const OPTS = 4;
const POSTS = 24;
const MSGS = 300 * YEAR / 3; // 하루 100마디 — 100명이면 이보다 많을 수도 있다
const SETTLES = 104;         // 필드 라운드마다

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = uid(1);
const iso = d => new Date(Date.now() + d * 864e5).toISOString();

const NAMES = ['신성호', '이관교', '김지명', '박승수', '정우성', '한도현', '조민석', '최민수'];
const COURSES = ['무등산CC', '함평엘리체CC', '광주CC', '레이크힐스순천', '골프존파크 상무점'];

const tables = {};

tables.profiles = Array.from({ length: N }, (_, i) => ({
    id: uid(i + 1),
    name: i < NAMES.length ? NAMES[i] : `회원${i + 1}`,
    avatar_url: i % 3 ? `https://x.supabase.co/storage/v1/object/public/avatars/${uid(i + 1)}/1712345678901.jpg` : null,
    role: i === 0 ? 'superadmin' : i === 1 ? 'admin' : i === 2 ? 'staff' : i === 3 ? 'treasurer'
        : i % 37 === 0 ? 'pending' : 'member',
    joined_at: iso(-YEAR + i), car: `${10 + (i % 80)}가 ${1000 + i}`,
    phone: `010-${String(1000 + i).slice(0, 4)}-${String(5678 + i).slice(0, 4)}`,
    memo: '', created_at: iso(-YEAR + i),
}));

tables.rounds = Array.from({ length: ROUNDS }, (_, i) => {
    // 절반은 지난 것, 절반은 앞으로 — 실제 저장소는 늘 이 언저리다.
    const day = Math.round(-YEAR + (i / ROUNDS) * (YEAR + 30));
    const screen = i % 3 === 2;
    return {
        id: `r${i}`, title: '', course: COURSES[i % COURSES.length],
        lat: screen ? null : 35.1 + (i % 10) / 100, lon: screen ? null : 126.9 + (i % 10) / 100,
        tee_at: iso(day), capacity: screen ? 6 : 4, fee: screen ? 25000 : 120000,
        status: day < 0 ? 'done' : 'open', opens_at: null,
        kind: screen ? 'screen' : 'field',
        caddie: screen ? null : 'caddie', cart: screen ? null : 'included',
        note: '6시 30분 동광주 IC 앞 집합입니다.\n카풀 가능하신 분은 대화방에 남겨 주세요.',
        created_by: uid(1 + (i % N)), created_at: iso(day - 14),
    };
});

tables.signups = [];
for (let i = 0; i < ROUNDS; i++) {
    for (let j = 0; j < PER_ROUND; j++) {
        tables.signups.push({
            id: `s${i}_${j}`, round_id: `r${i}`, user_id: uid(1 + ((i * 7 + j) % N)),
            state: j < 4 ? 'confirmed' : 'waitlist', seq: j + 1,
            grp: j < 4 ? 1 : null, created_at: iso(-YEAR + i),
        });
    }
}
/* 조 편성은 라운드 하나에 한 줄이라 통신량에는 거의 안 잡힌다. 그래도
   상세 화면이 실제로 그 줄을 받아 그리는 상태에서 재야 값이 맞다. */
tables.round_groups = Array.from({ length: ROUNDS }, (_, i) => ({
    round_id: `r${i}`, tees: { 1: iso(-YEAR + i) },
    posted_by: uid(1), posted_at: iso(-YEAR + i),
}));

tables.polls = Array.from({ length: POLLS }, (_, i) => ({
    id: `p${i}`, title: `${(i % 12) + 1}월 정기 라운드 날짜`,
    body: '되는 날 모두 골라 주세요.', multi: true, anonymous: false,
    closed: i > 2, closes_at: iso(-YEAR + i * 15 + 7),
    created_by: uid(1), created_at: iso(-YEAR + i * 15),
}));

tables.poll_options = [];
tables.poll_votes = [];
for (let i = 0; i < POLLS; i++) {
    for (let o = 0; o < OPTS; o++) {
        tables.poll_options.push({ id: `o${i}_${o}`, poll_id: `p${i}`, label: `9월 ${o * 7 + 6}일 (토)`, sort: o });
        // 그 투표에 참여한 사람의 절반쯤이 이 항목을 골랐다고 본다.
        for (let v = 0; v < Math.floor(N * 0.3); v++) {
            tables.poll_votes.push({
                id: `v${i}_${o}_${v}`, poll_id: `p${i}`, option_id: `o${i}_${o}`,
                user_id: uid(1 + ((v * 3 + o) % N)), created_at: iso(-YEAR + i * 15 + 1),
            });
        }
    }
}

tables.posts = Array.from({ length: POSTS }, (_, i) => ({
    id: `b${i}`, title: `${(i % 12) + 1}월 회비 안내`,
    body: '9월 회비는 8월 31일까지 입금 부탁드립니다.\n\n국민 123456-78-901234 (신성호)\n금액: 50,000원',
    pinned: i === 0, author_id: uid(1), created_at: iso(-YEAR + i * 15),
}));

tables.rooms = [{ id: 'room1', round_id: null, name: '전체 대화', created_at: iso(-YEAR) }];
tables.messages = Array.from({ length: MSGS }, (_, i) => ({
    id: `m${i}`, room_id: 'room1', user_id: uid(1 + (i % N)),
    body: '오늘 라운드 좋았습니다. 다음에 또 뵙겠습니다!',
    image_url: null, reply_to: null, system: false,
    created_at: iso(-YEAR + (i / MSGS) * YEAR),
}));

tables.settlements = Array.from({ length: SETTLES }, (_, i) => ({
    id: `t${i}`, round_id: `r${i}`, title: '무등산CC 그린피 + 카트비',
    note: '캐디피는 현장에서 각자 냅니다.', bank: '국민', account: '123456-78-901234',
    total: 480000, created_by: uid(4), created_at: iso(-YEAR + i * 3),
}));
tables.settlement_shares = [];
for (let i = 0; i < SETTLES; i++) {
    for (let j = 0; j < 4; j++) {
        tables.settlement_shares.push({
            id: `sh${i}_${j}`, settlement_id: `t${i}`, user_id: uid(1 + ((i + j) % N)),
            amount: 120000,
            /* **다 걷힌 것만 두면 총무 화면이 빈 채로 재어진다.** 최근 다섯
               건에는 안 낸 사람을 남겨 실제로 그리게 한다. */
            paid: !(i >= SETTLES - 5 && j % 2 === 0),
            created_at: iso(-YEAR + i * 3),
        });
    }
}
tables.settle_reminders = [{
    id: 'sr0', settlement_id: `t${SETTLES - 1}`, created_by: uid(4), created_at: iso(-0.5),
}];
/* 읽음 표시 — **사람마다 한 줄**이다. 글마다가 아니라서 대화가 3만 개여도
   100줄로 끝난다. 8할은 최근까지 읽었고 나머지는 뒤처져 있다고 본다. */
tables.room_reads = Array.from({ length: N }, (_, i) => ({
    room_id: 'room1', user_id: uid(i + 1),
    last_read_at: iso(i % 5 === 0 ? -30 : -0.01),
}));

tables.round_comments = [];
tables.post_comments = [];
tables.poll_comments = [];

const SESSION = { access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: {}, created_at: iso(-YEAR) } };

const SCREENS = [
    ['홈',        '/#/'],
    ['라운드 목록', '/#/rounds'],
    ['라운드 상세', '/#/rounds/r150'],
    ['투표 목록',   '/#/polls'],
    ['투표 상세',   '/#/polls/p0'],
    ['공지 목록',   '/#/board'],
    ['대화',       '/#/chat'],
    ['회원 명단',   '/#/members'],
    /* 총무 화면. **정산 서른 건을 몫까지 딸려 받는다** — 여기가 조용히
       무거워질 수 있는 자리라 함께 잰다. */
    ['정산 현황',   '/#/settle'],
];

const kb = n => (n / 1024).toFixed(1) + ' KB';

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
    locale: 'ko-KR', timezoneId: 'Asia/Seoul' });

let bytes = 0;
const perTable = {};
await ctx.route('**/rest/v1/**', restRoute(tables, (table, n) => {
    bytes += n;
    perTable[table] = (perTable[table] ?? 0) + n;
}));
await ctx.route('**/auth/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await ctx.route('**/storage/v1/**', r => r.fulfill({ status: 200, body: '' }));
await stubOutside(ctx);
await ctx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

console.log(`\n${N}명 · 1년치 (라운드 ${ROUNDS} · 신청 ${tables.signups.length}`
    + ` · 투표 ${POLLS}/표 ${tables.poll_votes.length} · 대화 ${MSGS} · 정산 ${SETTLES})\n`);
console.log('화면            받는 양      그린 시간   무엇이 큰가');
console.log('─'.repeat(74));

let worst = 0;
for (const [name, route] of SCREENS) {
    // **화면마다 새 탭**을 쓴다. 같은 탭이면 useAsync가 기억해 둔 것을 써서
    // 실제로 오가는 양이 안 잡힌다 — 처음 여는 사람 기준으로 재야 한다.
    const page = await ctx.newPage();
    bytes = 0;
    for (const k in perTable) delete perTable[k];
    const t0 = Date.now();
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const ms = Date.now() - t0;
    const top = Object.entries(perTable).sort((a, b) => b[1] - a[1])
        .slice(0, 2).map(([t, n]) => `${t} ${kb(n)}`).join(' · ');
    /* **눈으로도 보게 한다.** 통신량만 재고 끝내면, 사람이 백 명일 때
       화면이 어떻게 보이는지는 여전히 모른 채다 — 명단이 끝없이 늘어지거나
       고르는 목록이 화면을 다 먹는 일이 실제로 있었다. */
    if (SHOTS) {
        await page.screenshot({ path: `.dev/shots/scale-${name.replace(/ /g, '')}.png`,
                                fullPage: true });
    }
    worst = Math.max(worst, bytes);
    const flag = bytes > 100 * 1024 ? ' ❌' : bytes > 30 * 1024 ? ' ⚠️' : '';
    console.log(name.padEnd(14) + kb(bytes).padStart(10) + flag.padEnd(4)
        + String(ms + 'ms').padStart(8) + '   ' + top);
    await page.close();
}

console.log('\n한 달 통신량 어림 (10명이 하루 20번 열 때):');
const perOpen = worst;
const month = perOpen * 10 * 20 * 30;
console.log(`  가장 무거운 화면 ${kb(perOpen)} × 10명 × 20번 × 30일 = `
    + (month / 1024 / 1024 / 1024).toFixed(2) + ' GB / 월  (무료 한도 5GB)');

await browser.close();
