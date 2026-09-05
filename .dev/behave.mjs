/* 눈으로는 안 보이는 **동작**을 확인한다.
 *
 * 스크린샷은 '어떻게 생겼나'만 말해 준다. 여기서 보는 것은 '눌렀을 때 무엇을
 * 보내나' · '쓰기가 몇 번 나가나'처럼 **화면에 안 나타나는 것**이다.
 * 둘 다 조용히 깨져서 한참 뒤에나 들통나는 자리라 숫자로 붙들어 둔다.
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/behave.mjs
 */
import { chromium } from 'playwright-core';
import { tables, ME, uid } from './fixtures.mjs';
import { restRoute, stubOutside } from './rest.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5199';

const SESSION = {
    access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

let pass = 0, fail = 0;
const ok = (cond, msg) => {
    if (cond) pass++; else fail++;
    console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
};

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });

/* 무엇이 오갔는지 잡아 둔다. **일반 규칙을 먼저 걸고 좁은 규칙을 나중에**
   걸어야 한다 — playwright는 나중에 건 규칙을 먼저 본다. */
await ctx.route('**/rest/v1/**', restRoute(tables));

const rpc = [];
await ctx.route('**/rest/v1/rpc/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    rpc.push([name, route.request().postDataJSON() ?? null]);
    /* **값을 쓰는 함수는 흉내에 맡긴다.** 여기서 `null`로 답하면 화면이
       빈 값을 그리게 되어, 앱이 아니라 이 스텁 때문에 검사가 빨개진다
       (참석 횟수가 실제로 그랬다). 부른 횟수는 위에서 이미 세어 두었다. */
    if (name === 'attendance_counts') return route.fallback();
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
});
const calls = name => rpc.filter(([c]) => c === name);

let patch = null;
const writes = [];
await ctx.route('**/rest/v1/polls**', route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    patch = route.request().postDataJSON();
    writes.push(['polls PATCH', patch]);
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await ctx.route('**/rest/v1/poll_options**', route => {
    const m = route.request().method();
    if (m === 'GET') return route.fallback();
    writes.push([`poll_options ${m}`, route.request().postDataJSON() ?? null]);
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
/* 대화방에 올리는 글은 따로 잡는다 — `.select().single()`로 받으므로
   빈 배열을 돌려주면 화면이 오류로 본다. 넣은 값 그대로 한 줄을 준다. */
/* 여기 적은 칸이 아직 없는 저장소인 척한다. 그 칸을 실어 보내면
   **진짜 PostgREST처럼 `PGRST204`로 물린다** — PostgREST는 칸 목록을 제가
   들고 있어서 DB에 닿기도 전에 거절하므로, Postgres의 `42703`이 아니라
   이 코드가 온다(실기기에서 `round_id`가 이 코드로 막혀 공유가 통째로
   실패했다). 앱이 그 칸만 빼고 다시 넣는지를 본다. */
let missingColumns = [];
await ctx.route('**/rest/v1/messages**', route => {
    // 가리기·가리기 풀기는 PATCH로 나간다. 무엇을 보냈는지만 잡아 둔다.
    if (route.request().method() === 'PATCH') {
        writes.push(['messages PATCH', route.request().postDataJSON()]);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    // 지우기는 DELETE다. 어느 줄을 지웠는지는 주소(`?id=eq.…`)에 실린다.
    if (route.request().method() === 'DELETE') {
        writes.push(['messages DELETE', route.request().url()]);
        return route.fulfill({ status: 204, contentType: 'application/json', body: '' });
    }
    if (route.request().method() !== 'POST') return route.fallback();
    const sent = route.request().postDataJSON();
    writes.push(['messages POST', sent]);
    const bad = missingColumns.find(c => sent && c in sent);
    if (bad) {
        return route.fulfill({
            status: 400, contentType: 'application/json',
            body: JSON.stringify({
                code: 'PGRST204',
                message: `Could not find the '${bad}' column of 'messages' in the schema cache` }),
        });
    }
    route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: 'new1', created_at: new Date().toISOString(), ...sent }),
    });
});
for (const t of ['settle_reminders', 'settlement_shares']) {
    await ctx.route(`**/rest/v1/${t}**`, route => {
        const m = route.request().method();
        if (m === 'GET') return route.fallback();
        writes.push([`${t} ${m}`, route.request().postDataJSON() ?? null]);
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
}

await ctx.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await stubOutside(ctx);
await ctx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

const go = async (hash, wait = 500) => {
    await page.goto(BASE + hash, { waitUntil: 'networkidle' });
    await page.waitForTimeout(wait);
};

/* ── 1. 읽음 쓰기는 **한 번만** 나간다 ──────────────────────────
   한 마디마다 나가면 100명이 떠들 때 그것만으로 쓰기가 쏟아진다.
   대화 화면이 '마지막 글이 밀렸을 때만, 700ms 모아서' 보내는 것이 그 장치다.
   의존성을 잘못 건드리면 조용히 깨진다. */
console.log('\n── 읽음 표시 ──');
rpc.length = 0;
await go('/#/chat', 2000);
ok(calls('mark_room_read').length === 1,
   `대화를 열면 mark_room_read 가 한 번 나간다 (실제 ${calls('mark_room_read').length}번)`);

rpc.length = 0;
await go('/#/', 400);
await go('/#/chat', 2000);
ok(calls('mark_room_read').length === 1,
   `나갔다 돌아와도 한 번이다 (실제 ${calls('mark_room_read').length}번)`);

/* ── 2. 투표 `다시 열기` ────────────────────────────────────────
   **마감 시각이 지나 끝난 투표**는 `closed`가 아직 false다. 그 값만 보면
   단추에 `마감`이라고 적히고(이미 끝난 것을 또 마감한다), 그 뒤에 눌러도
   지난 마감 시각이 그대로라 열리지 않는다. */
console.log('\n── 투표 마감 · 다시 열기 ──');

/* **끝난 투표의 결과를 대화방에 알리게 하는가.**
   손으로 마감한 것은 DB 트리거가 하지만, **마감 시각이 지나 끝난 것은 DB에서
   아무 일도 안 일어나므로** 앱이 봐 주지 않으면 영영 안 남는다.
   p3가 그런 것이고(`result_at`이 null), p2는 이미 알린 것이다 — 그건 다시
   부르면 안 된다(헛걸음이 100명분 쌓인다).

   **잴 때마다 문서를 새로 열어야 한다.** `go()`는 주소의 `#`만 바뀌면
   화면을 새로 만들지 않아서, **같은 투표는 한 번만** 부른다는 규칙에 걸려
   두 번째 화면에서는 늘 0번이 나온다(실제로 그렇게 짰다가 빨갛게 떴다).
   그래서 갈 곳으로 옮긴 **뒤에** 세기를 비우고 `reload()`로 다시 연다. */
const countPosts = async hash => {
    await go(hash, 200);
    rpc.length = 0;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    return calls('post_poll_result').map(([, b]) => b?.p_poll);
};

/* **홈에서도 부른다.** 홈은 모두가 처음 닿는 화면이라, 투표 탭에서만
   부르면 아무도 그 탭을 안 여는 날 결과가 하루 종일 안 남는다. */
const athome = await countPosts('/#/');
ok(athome.includes('p3'), `홈만 열어도 끝난 투표의 결과를 남기게 한다 (실제 ${JSON.stringify(athome)})`);
ok(!athome.includes('p2'), '이미 알린 투표는 다시 안 부른다');

const posted = await countPosts('/#/polls');
ok(posted.includes('p3'), `투표 탭에서도 결과를 남기게 한다 (실제 ${JSON.stringify(posted)})`);

for (const [id, label, want] of [
    ['p1', '마감 시각이 앞으로 남은 투표', '마감'],
    ['p2', '손으로 마감한 투표', '다시 열기'],
    ['p3', '마감 시각이 지나 끝난 투표', '다시 열기'],
]) {
    await go(`/#/polls/${id}`, 400);
    const btns = await page.$$eval('.card .btn.ghost.sm', e => e.map(x => x.textContent.trim()));
    const got = btns.find(t => t === '마감' || t === '다시 열기');
    ok(got === want, `${label} → 단추가 \`${want}\` (실제 \`${got}\`)`);
}

await go('/#/polls/p3', 400);
patch = null;
await page.getByText('다시 열기', { exact: true }).click();
await page.waitForTimeout(500);
ok(patch?.closed === false && patch?.closes_at === null,
   `지난 마감 시각은 함께 지운다 — 안 그러면 열자마자 다시 닫힌다 (보낸 값 ${JSON.stringify(patch)})`);

await go('/#/polls/p2', 400);
patch = null;
await page.getByText('다시 열기', { exact: true }).click();
await page.waitForTimeout(500);
ok(patch && !('closes_at' in patch),
   `마감 시각이 없던 투표는 그 칸을 안 건드린다 (보낸 값 ${JSON.stringify(patch)})`);

/* ── 3. 투표 수정 ───────────────────────────────────────────────
   **표가 들어온 뒤에는 잠기는 것이 둘이다** — `익명`을 끄면 비밀인 줄 알고
   고른 사람이 드러나고, `복수 선택`을 끄면 이미 여러 개 고른 사람의 표가
   남아 '하나만 고르는 투표'에 두 표를 가진 사람이 생긴다.
   안 바뀐 항목에는 쓰기를 안 보내는지도 함께 본다. */
console.log('\n── 투표 수정 ──');
await go('/#/polls/p1/edit', 700);
const sw = await page.$$eval('.switch', e => e.map(x => x.disabled));
ok(sw.length === 2 && sw.every(Boolean), `표가 있는 투표는 스위치 둘이 잠긴다 (실제 ${JSON.stringify(sw)})`);
const tallies = await page.$$eval('.option-votes', e => e.map(x => x.textContent));
ok(tallies.length > 0, `항목마다 받은 표를 적어 준다 (${JSON.stringify(tallies)})`);

writes.length = 0;
await page.fill('#v-title', '9월 정기 라운드 날짜 (수정)');
await page.getByText('저장', { exact: true }).click();
await page.waitForTimeout(700);
ok(writes.some(([w, b]) => w === 'polls PATCH' && b.title === '9월 정기 라운드 날짜 (수정)'),
   '제목만 고치면 polls 만 고친다');
ok(!writes.some(([w]) => w.startsWith('poll_options')),
   `안 바뀐 항목에는 쓰기를 안 보낸다 (실제 ${JSON.stringify(writes.map(w => w[0]))})`);

// 표가 없는 투표(p3는 표가 없다)에서는 스위치가 열려 있어야 한다
await go('/#/polls/p3/edit', 700);
const sw2 = await page.$$eval('.switch', e => e.map(x => x.disabled));
ok(sw2.length === 2 && sw2.every(d => !d), `표가 없으면 스위치가 열려 있다 (실제 ${JSON.stringify(sw2)})`);

/* ── 4. 조 편성 ─────────────────────────────────────────────────
   **여덟 명을 옮겨도 쓰기는 한 번이다.** 한 줄씩 고치면 쓰기가 여덟 번이고
   실시간 이벤트도 여덟 번이라 보는 사람 화면이 그만큼 다시 그려진다.
   보내는 값이 `{사람: 조}` 통째인지도 함께 본다 — 목록에 없는 사람은
   DB가 조에서 빼므로, 확정자 전원을 실어 보내지 않으면 남이 조에서 사라진다. */
console.log('\n── 조 편성 ──');
await go('/#/rounds/r2/groups', 700);
rpc.length = 0;
await page.getByText('저장', { exact: true }).click();
await page.waitForTimeout(600);
const saved = calls('set_round_groups');
ok(saved.length === 1, `여덟 명이어도 쓰기는 한 번이다 (실제 ${saved.length}번)`);
const body = saved[0]?.[1] ?? {};
ok(Object.keys(body.p_grps ?? {}).length === 8,
   `확정자 전원을 실어 보낸다 (실제 ${Object.keys(body.p_grps ?? {}).length}명)`);
ok(Object.values(body.p_grps ?? {}).filter(v => v === null).length === 1,
   `미배정인 사람은 null로 보낸다 (실제 ${JSON.stringify(Object.values(body.p_grps ?? {}))})`);
ok(Object.keys(body.p_tees ?? {}).join(',') === '1,2',
   `사람이 있는 조의 시각만 보낸다 — 빈 3조는 안 보낸다 (실제 ${JSON.stringify(Object.keys(body.p_tees ?? {}))})`);

/* ── 조 편성 조건 넷 ────────────────────────────────────────────
   **규칙 자체는 `.dev/groups-check.mts`가 숫자로 붙들어 둔다**(브라우저 없이).
   여기서 보는 것은 그 규칙이 **화면에 제대로 이어져 있는가**다 — 단추가
   눌리는가, 고른 인원수가 먹는가, 사람이 안 빠지는가. */
const groupsOf = () => page.$$eval('.grp-card', cards => cards
    .map(c => ({
        head: c.querySelector('.section-title')?.textContent.trim() ?? '',
        who: [...c.querySelectorAll('.grp-row .grow')].map(x => x.textContent.trim()),
    }))
    .filter(g => g.who.length));

await go('/#/rounds/r2/groups', 700);
await page.selectOption('#g-size', '3');
await page.locator('.grp-mode', { hasText: '신청 순서' }).click();
await page.waitForTimeout(300);
const heads = (await groupsOf()).map(g => g.head);
ok(heads.length === 3 && heads[0].startsWith('1조'),
   `3명씩 고르면 여덟 명이 세 조가 된다 (실제 ${JSON.stringify(heads)})`);

/* 넷 다 **아무도 안 빠뜨린다.** 한 명이라도 빠지면 그 사람만 `미배정`에
   남는데, 조를 훑어보지 않으면 알아채기 어렵다. */
/* **인원수를 매번 정해 준다.** 같은 주소로 다시 가는 것은 브라우저가
   아무 일도 안 하는 것으로 봐서 화면이 새로 안 그려진다 — 앞 시험에서
   고른 `3명`이 그대로 남아 있었다(여기서 한 번 헛짚었다). */
for (const mode of ['신청 순서', '랜덤', '성별 조합', '나이 조합']) {
    await page.selectOption('#g-size', '4');
    await page.locator('.grp-mode', { hasText: mode }).click();
    await page.waitForTimeout(300);
    const gs = await groupsOf();
    const n = gs.reduce((s, g) => s + g.who.length, 0);
    ok(n === 8 && gs.length === 2,
       `${mode}: 여덟 명이 두 조로 다 들어간다 (실제 ${gs.map(g => g.who.length)})`);
}

/* **성별 조합은 정말 갈라 놓는가.** 여덟 중 여자가 둘이라 조마다 하나씩
   가야 한다(남남남여). 화면에 `여`가 적혀 있으므로 그걸로 센다. */
await page.selectOption('#g-size', '4');
await page.locator('.grp-mode', { hasText: '성별 조합' }).click();
await page.waitForTimeout(300);
const women = (await groupsOf()).map(g => g.who.filter(w => w.includes('여 ·')).length);
ok(women.join(',') === '1,1', `성별 조합 → 조마다 여자 ${women} (남남남여)`);

/* **정보가 빈 사람이 몇인지 알려 준다.** 안 알려 주면 왜 이렇게 갈렸는지
   물어볼 데가 없다. 가짜 자료에서 오세훈만 둘 다 비어 있다. */
ok((await page.textContent('.grp-missing') ?? '').includes('1명'),
   '성별·태어난 해를 안 적은 사람 수를 알려 준다');

/* ── 5. 총무의 정산 현황 ────────────────────────────────────────
   **안 낸 사람만 세운다.** 다 걷힌 정산(st2)은 목록에 없어야 하고,
   `입금 알림 보내기`는 `settle_reminders`에 한 줄만 넣어야 한다 —
   누구에게 보낼지는 발송기가 고른다(화면이 사람을 고르면 두 벌이 된다). */
console.log('\n── 총무의 정산 현황 ──');
await go('/#/settle', 700);
const chips = await page.$$eval('.settle-unpaid .settle-chip', e => e.map(x => x.textContent));
ok(chips.length === 2, `안 낸 두 사람만 나온다 (실제 ${JSON.stringify(chips)})`);
const cards = await page.$$eval('.card .settle-link .b', e => e.map(x => x.textContent));
ok(cards.length === 1 && !cards[0].includes('뒤풀이'),
   `다 걷힌 정산은 목록에 없다 (실제 ${JSON.stringify(cards)})`);

/* **기본은 `내가 올린 것`이다.** 돈은 올린 사람 계좌로 들어가므로 챙길
   사람도 그 사람이다 — 남이 걷는 돈까지 기본으로 깔리면 누구 것인지
   헷갈리고 남의 정산에 독촉을 눌러 버린다(사용자가 짚어 준 것이다). */
ok(!cards.some(t => t.includes('함평엘리체')),
   `기본은 내가 올린 것만 — 남이 올린 정산은 안 나온다 (실제 ${JSON.stringify(cards)})`);
ok((await page.$$('.settle-by')).length === 0,
   '내 것에는 올린 사람 줄을 안 붙인다');

await page.getByText('전체', { exact: true }).click();
await page.waitForTimeout(300);
const allCards = await page.$$eval('.card .settle-link .b', e => e.map(x => x.textContent));
ok(allCards.length === 2 && allCards.some(t => t.includes('함평엘리체')),
   `전체로 넘기면 남이 올린 것도 나온다 (실제 ${JSON.stringify(allCards)})`);
const bys = await page.$$eval('.settle-by', e => e.map(x => x.textContent));
ok(bys.length === 1 && bys[0].includes('박승수'),
   `남이 올린 것에는 누구 것인지 적는다 (실제 ${JSON.stringify(bys)})`);
await page.getByText('내가 올린 것', { exact: true }).click();
await page.waitForTimeout(300);

writes.length = 0;
await page.getByText('입금 알림 보내기', { exact: true }).click();
await page.waitForTimeout(300);
await page.getByText('보내기', { exact: true }).click();
await page.waitForTimeout(500);
ok(writes.filter(([w]) => w === 'settle_reminders POST').length === 1,
   `독촉은 한 줄만 넣는다 (실제 ${JSON.stringify(writes.map(w => w[0]))})`);
ok(!JSON.stringify(writes).includes('user_id'),
   '받을 사람을 화면이 고르지 않는다 — 발송기가 안 낸 사람을 고른다');

/* **현금으로 받았을 때 총무가 대신 눌러 준다.** `paid: true`만 보내야 한다 —
   금액까지 실어 보내면 `shares_amount_locked()`가 막는다(총무가 아닌
   운영진이 누를 때). */
writes.length = 0;
await page.locator('.settle-unpaid .settle-chip').first().click();
await page.waitForTimeout(400);
const [what, sent] = writes[0] ?? [];
ok(what === 'settlement_shares PATCH' && JSON.stringify(sent) === '{"paid":true}',
   `이름을 누르면 입금완료만 보낸다 (실제 ${what} ${JSON.stringify(sent)})`);

/* ── 6. 일반회원 눈으로 본 정산 ─────────────────────────────────
 *
 * **정산은 회원 누구나 만든다**(사용자가 정한 것이다). 다만 `전체` 탭은
 * 남의 정산까지 챙기는 자리라 총무·운영진 몫이다 — 일반회원에게 열면
 * 남의 돈 서른 건이 깔릴 뿐이다. 화면에서 감추는 것만으로 끝내지 않고
 * DB도 같게 막혀 있다(`settlements_own` · `settle_reminders_add`).
 */
console.log('\n── 일반회원 눈으로 ──');
const MEMBER = uid(5);                       // 정우성 — role: 'member'
const mCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const mSession = { ...SESSION, user: { ...SESSION.user, id: MEMBER } };
await mCtx.route('**/rest/v1/**', restRoute(tables));
await mCtx.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(mSession) }));
await stubOutside(mCtx);
await mCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), mSession);

const mPage = await mCtx.newPage();
await mPage.goto(BASE + '/#/rounds/r1', { waitUntil: 'networkidle' });
await mPage.waitForTimeout(700);
ok(await mPage.getByText('＋ 정산', { exact: true }).count() === 1,
   '일반회원도 라운드에서 정산을 만들 수 있다');

await mPage.goto(BASE + '/#/settle', { waitUntil: 'networkidle' });
await mPage.waitForTimeout(700);
ok((await mPage.$$('.settle-tabs')).length === 0,
   '일반회원에게는 `전체` 탭이 없다 — 남의 정산까지 볼 자리가 아니다');
const mText = await mPage.textContent('.page');
ok(mText.includes('아직 만든 정산이 없습니다'),
   `내가 올린 것이 없으면 만들라고 알려 준다 (실제 ${JSON.stringify(mText.slice(0, 60))})`);
await mCtx.close();

/* ── 6-1. 스크린 모집 베껴 열기 ─────────────────────────────────
 *
 * **스크린만 베낀다.** 같은 매장에서 같은 게임비로 되풀이해 열리므로
 * 매번 처음부터 치는 것이 낭비였다 — 필드는 갈 때마다 골프장이 달라
 * 베낄 것이 없다. 베낀 것은 **새 모집**이라 원본을 안 건드려야 하고,
 * **시각만 비어 있어야** 한다(지난 날짜가 채워져 있으면 그대로 저장한다).
 */
console.log('\n── 스크린 모집 베껴 열기 ──');
await go('/#/rounds/r4', 600);
ok((await page.textContent('.page') ?? '').includes('같은 조건으로 새로 열기'),
   '스크린 상세에는 베껴 여는 단추가 있다');
await go('/#/rounds/r1', 600);
ok(!(await page.textContent('.page') ?? '').includes('같은 조건으로 새로 열기'),
   '필드 상세에는 없다 — 골프장이 매번 달라 베낄 것이 없다');

await go('/#/rounds/new?from=r4', 700);
ok(await page.inputValue('#f-course') === '골프존파크 상무점',
   `매장을 베껴 온다 (실제 ${JSON.stringify(await page.inputValue('#f-course'))})`);
ok(await page.inputValue('#f-cap') === '6' && await page.inputValue('#f-fee') === '25000',
   '정원·게임비도 함께 온다');
ok(await page.inputValue('#f-tee') === '',
   `시각만 비어 있다 (실제 ${JSON.stringify(await page.inputValue('#f-tee'))})`);
ok((await page.textContent('.form-actions') ?? '').includes('모집 열기'),
   '단추가 `수정 저장`이 아니라 `모집 열기`다 — 원본을 안 건드린다');

/* ── 6-1-1. 라운드를 대화방에 공유 ──────────────────────────────
 *
 * **모집을 열면 저절로 한 줄이 남지만 그때 한 번뿐이다.** 대화가 하루에
 * 백 마디씩 쌓이면 그 줄은 위로 밀려 사라진다 — 이 단추가 그 라운드를
 * 대화방 맨 아래로 다시 올린다.
 * 보는 것 셋: **지난 라운드에는 없다**(부를 이유가 없다) · `system` 글로
 * 들어간다(말풍선이 아니라 눌리는 카드다) · **`round_id`가 붙는다**
 * (그게 없으면 눌러도 아무 데도 안 간다).
 */
console.log('\n── 라운드를 대화방에 공유 ──');
await go('/#/rounds/r1', 700);
ok((await page.textContent('.page') ?? '').includes('대화방에 공유'),
   '열려 있는 라운드에는 공유 단추가 있다');

writes.length = 0;
await page.getByText('📣 대화방에 공유').click();
await page.getByText('올리기', { exact: true }).click();
await page.waitForTimeout(600);
const posted2 = writes.find(([w]) => w === 'messages POST')?.[1];
ok(posted2?.round_id === 'r1' && posted2?.system === true,
   `그 라운드를 단 안내 글로 들어간다 (실제 ${JSON.stringify(posted2)})`);
ok(String(posted2?.body ?? '').split('\n').length === 3,
   `머리말·골프장·시각 세 줄이다 (실제 ${JSON.stringify(posted2?.body)})`);
ok(String(posted2?.body ?? '').startsWith('신성호님이 필드를 공유했습니다'),
   '받침에 맞는 조사를 붙인다 — 스크린이면 `스크린을`이다');
/* **이 줄만 폰을 울린다.** `system` 줄은 원래 안 울리는데(모집을 열 때
   저절로 남는 줄은 `⛳ 새 모집`이 이미 나갔다), 사람이 눌러 올린 이것은
   자리가 남았다고 다시 알리는 것이 목적이라 뚫는다. */
ok(posted2?.notify === true,
   `사람이 올린 공유에는 알림 표가 선다 (실제 ${JSON.stringify(posted2?.notify)})`);

await go('/#/rounds/r4', 700);
writes.length = 0;
await page.getByText('📣 대화방에 공유').click();
await page.getByText('올리기', { exact: true }).click();
await page.waitForTimeout(600);
ok(String(writes.find(([w]) => w === 'messages POST')?.[1]?.body ?? '')
    .startsWith('신성호님이 스크린을 공유했습니다'),
   `스크린은 \`스크린을\`이다 (실제 ${JSON.stringify(
       writes.find(([w]) => w === 'messages POST')?.[1]?.body?.split('\n')[0])})`);

/* **칸이 없는 저장소에서도 공유는 된다.** 앱은 푸시하면 몇 분 뒤 올라가지만
   `schema.sql`은 사람이 손으로 붙여넣으므로 그 사이가 있다 — 그때 통째로
   실패하면 단추가 고장 난 것처럼 보인다(실기기에서 `round_id`가 없어 실제로
   그랬다). 알림과 눌리는 카드만 빠지고 글은 올라간다. */
const share = async (round) => {
    await go(`/#/rounds/${round}`, 700);
    writes.length = 0;
    await page.getByText('📣 대화방에 공유').click();
    await page.getByText('올리기', { exact: true }).click();
    await page.waitForTimeout(800);
    return writes.filter(([w]) => w === 'messages POST').map(([, v]) => v);
};

missingColumns = ['notify'];
let tries = await share('r1');
ok(tries.length === 2 && !('notify' in (tries[1] ?? {})) && 'round_id' in (tries[1] ?? {}),
   `알림 칸만 없으면 그것만 뺀다 — 눌리는 카드는 살린다 (실제 ${
       JSON.stringify(tries.map(t => Object.keys(t ?? {}).filter(k => k === 'notify' || k === 'round_id')))})`);
ok((await page.textContent('body') ?? '').includes('대화방에 올렸습니다'),
   '옛 저장소에서도 공유는 성공으로 끝난다');

/* 둘 다 없는 저장소 — 여기서 통째로 실패하던 것이 사용자가 겪은 그 오류다. */
missingColumns = ['notify', 'round_id'];
tries = await share('r1');
ok(tries.length === 3 && !('notify' in (tries[2] ?? {})) && !('round_id' in (tries[2] ?? {})),
   `둘 다 없으면 하나씩 빼며 세 번째에 들어간다 (실제 ${tries.length}번)`);
ok((await page.textContent('body') ?? '').includes('대화방에 올렸습니다'),
   '`round_id`도 없는 저장소에서 공유가 통째로 실패하지 않는다');
missingColumns = [];

await go('/#/rounds/r3', 700);
ok(!(await page.textContent('.page') ?? '').includes('대화방에 공유'),
   '지난 라운드에는 없다 — 이제 와서 부를 이유가 없다');

/* 대화방에서 그 줄이 **눌러서 들어가는 카드**인가. 예전에는 가운데 한 줄이라
   보려면 라운드·투표 탭으로 건너가 목록에서 다시 찾아야 했다(사용자 제보 —
   대화를 보다가 바로 들어가지는 것이 이 카드의 전부다). */
await go('/#/chat', 1200);
const chatCards = await page.$$eval('.chat-result',
    e => e.map(x => x.getAttribute('href')));
ok(chatCards.some(h => h?.includes('/rounds/r4')),
   `사람이 올린 공유가 카드다 (실제 ${JSON.stringify(chatCards)})`);
ok(chatCards.some(h => h?.includes('/rounds/r2')), '저절로 남은 모집 안내도 카드다');
ok(chatCards.some(h => h?.includes('/polls/p1')), '투표를 올린 안내도 카드다');
ok(chatCards.some(h => h?.includes('/polls/p2')), '투표 결과도 그대로 카드다');
/* 갈 곳에 맞는 말이 붙는가 — 라운드 카드에 `투표 보러 가기`가 붙으면
   눌러 놓고 딴 데로 간 줄 안다. */
const goes = await page.$$eval('.chat-result', e => e.map(x => [
    x.getAttribute('href'), x.querySelector('.chat-result-go')?.textContent]));
ok(goes.every(([h, g]) => h?.includes('/rounds/') ? g?.includes('라운드') : g?.includes('투표')),
   `카드마다 갈 곳에 맞는 말이 붙는다 (실제 ${JSON.stringify(goes)})`);
/* **지운 것은 카드가 아니다** — 갈 곳이 이미 없다. */
const notices = await page.$$eval('.chat-notice', e => e.map(x => x.textContent));
ok(notices.some(t => t?.includes('지웠습니다')),
   `지운 안내는 가운데 한 줄로 남는다 (실제 ${JSON.stringify(notices)})`);

/* ── 6-1-1-1. 이모티콘 ──────────────────────────────────────────
 *
 * **사진이 쓰던 `messages.image_url`을 같이 쓴다** — `sticker:<id>`로
 * 시작하면 이모티콘이다. DB에 칸을 새로 만들지 않으려는 것이라, 그 약속이
 * 깨지면 보내는 쪽과 그리는 쪽이 조용히 어긋난다.
 * 화면으로는 안 보이는 것 셋을 여기서 붙든다.
 */
/* ── 6-1-1-0. 보내기 단추는 늘 그 자리에 있다 ───────────────────
 *
 * **붙였다 떼면 두 가지가 같이 나빠진다**(사용자 제보 — 카톡은 부드러운데
 * 여기는 깜빡였다): 단추가 생길 때마다 글칸이 44px 좁아져 **치던 글이 옆으로
 * 밀리고**, 한글 조합 중에 값이 잠깐 비어 보이는 순간마다 **깜빡인다**.
 * 그래서 늘 두고 흐려질 뿐이며, 켜지는 기준은 **초점**이다(댓글의 `등록`과 같다).
 */
console.log('\n── 보내기 단추 ──');
await go('/#/chat', 1200);
const width = () => page.evaluate(
    () => Math.round(document.querySelector('.chat-input .textarea').getBoundingClientRect().width));

ok(await page.isVisible('.chat-send'), '아무것도 안 적어도 단추는 그 자리에 있다');
ok(await page.getAttribute('.chat-send', 'disabled') !== null,
   '보낼 것이 없으면 꺼져 있다');

const w0 = await width();
await page.click('.chat-input .textarea');
await page.waitForTimeout(300);
ok(await page.getAttribute('.chat-send', 'disabled') === null,
   '글칸을 누르면 켜진다 — 글자로 정하면 한글 조합 중에 깜빡인다');

/* **치는 동안 글칸 너비가 안 바뀌어야 한다.** 예전에는 첫 글자에서
   314 → 270으로 튀었고 그게 '치던 글이 밀리는' 정체였다. */
const widths = [w0];
for (const ch of '무등산에서 만나요') {
    await page.type('.chat-input .textarea', ch);
    await page.waitForTimeout(40);
    widths.push(await width());
}
ok(widths.every(w => w === widths[0]),
   `치는 동안 글칸 너비가 안 바뀐다 (실제 ${[...new Set(widths)].join('→')})`);

/* 딴 데 눌렀다 와도 적어 둔 글이 있으면 켜져 있어야 한다. */
await page.click('.chat-list');
await page.waitForTimeout(500);
ok(await page.getAttribute('.chat-send', 'disabled') === null,
   '초점이 떠도 적어 둔 글이 있으면 켜져 있다');
await page.fill('.chat-input .textarea', '');
await page.waitForTimeout(200);

/* ── 6-1-1-1. 친 그 순간에는 칸을 재지도 고치지도 않는다 ──────────────
 *
 * `광`을 칠 때 **글씨가 깜빡인다**는 제보를 쫓아 세 번 만에 여기까지 왔다.
 *
 * 원인은 **글자를 치는 그 순간에 `scrollHeight`를 읽는 것**이다. 한글 한
 * 글자를 고쳐 쓸 때 WebKit은 칸을 **비웠다가 다시 채우는데**(실기기 영상에서
 * 깜빡이는 두 프레임 동안 커서가 맨 앞으로 돌아가는 것으로 확인했다), 그
 * 사이에 배치를 다시 잡게 하면 **빈 칸이 한 프레임 그대로 그려진다.**
 *
 * **`onCompositionStart`로 막는 것으로는 모자랐다** — 조합 이벤트를 안 주는
 * 자판이 있어서, 아이폰 쿼티는 멀쩡한데 **천지인에서 모음을 칠 때만**
 * 깜빡였다(판까지 확인하고도 그대로였다). 그래서 지금은 조합인지 아닌지를
 * 아예 안 보고, **재는 일을 다음 프레임으로 미룬다.**
 *
 * 그러니 여기서 볼 것은 `한 번도 안 잰다`가 아니라
 * **`입력 이벤트가 도는 그 순간에는 안 잰다`**이다. `input`을 window에서
 * 캡처(맨 처음)와 버블(맨 마지막)로 집어 그 사이를 표시해 두고, 그 안에서
 * 일어난 읽기·쓰기만 센다.
 *
 * 헤드리스에는 한글 IME가 없어 CDP의 조합 API로 흉내 낸다 — 쿼티 모양
 * (`ㄱ→고→과→광`, 내내 한 글자)과 천지인 모양(`ㄱ→ㄱ·→고`, 글자 수가
 * 1↔2를 오감) **둘 다** 본다. 자판마다 갈렸던 자리라 하나만 봐서는 못 잡는다. */
const ta = '.chat-input .textarea';
await page.evaluate(sel => {
    const el = document.querySelector(sel);
    window.__sync = false;        // 지금 입력 이벤트가 도는 중인가
    window.__hit = 0;             // 그 안에서 칸을 재거나 고친 횟수
    addEventListener('input', () => { window.__sync = true; }, true);   // 맨 처음
    addEventListener('input', () => { window.__sync = false; }, false); // 맨 마지막

    new MutationObserver(ms => { if (window.__sync) window.__hit += ms.length; })
        .observe(el, { attributes: true, attributeFilter: ['style'] });

    /* 배치를 강제로 다시 잡게 하는 읽기도 같은 잣대로 센다. 이쪽은 진짜
       접근자가 있어 가로채도 원래 것을 부를 수 있다(`style`과 다른 점이다). */
    for (const key of ['scrollHeight', 'offsetHeight', 'clientHeight']) {
        const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)
               ?? Object.getOwnPropertyDescriptor(Element.prototype, key);
        Object.defineProperty(el, key, {
            get() { if (window.__sync) window.__hit++; return d.get.call(this); } });
    }
}, ta);
const cdp = await page.context().newCDPSession(page);
const hits = () => page.evaluate(() => window.__hit);
/* 재는 김에 세지 않도록 관찰 대상이 아닌 길로 잰다. */
const boxH = () => page.evaluate(sel =>
    Math.round(document.querySelector(sel).getBoundingClientRect().height), ta);

const compose = async steps => {
    for (const t of steps) {
        await cdp.send('Input.imeSetComposition',
                       { text: t, selectionStart: t.length, selectionEnd: t.length });
        await page.waitForTimeout(60);
    }
};

await page.click(ta);
await page.waitForTimeout(250);

const h0 = await hits();
await compose(['ㄱ', '고', '과', '광']);
await cdp.send('Input.insertText', { text: '광' });
await page.waitForTimeout(200);
ok(await hits() - h0 === 0,
   `쿼티로 \`광\`을 칠 때 그 자리에서 칸을 안 건드린다 (실제 ${await hits() - h0}번)`);

await page.fill(ta, '');
await page.waitForTimeout(200);
await page.click(ta);
await page.waitForTimeout(200);

const h1 = await hits();
await compose(['ㄱ', 'ㄱ·', '고', '고·', '과', '광']);
await cdp.send('Input.insertText', { text: '광' });
await page.waitForTimeout(200);
ok(await hits() - h1 === 0,
   `천지인으로 칠 때도 안 건드린다 — 글자 수가 1↔2를 오간다 (실제 ${await hits() - h1}번)`);

const h2 = await hits();
await cdp.send('Input.insertText', { text: '주에서 만나요' });
await page.waitForTimeout(200);
ok(await hits() - h2 === 0, `이어 칠 때도 안 건드린다 (실제 ${await hits() - h2}번)`);

/* 길어지면 **늘어나기는 해야 한다** — 안 늘어나면 앞줄이 위로 잘려 안 보인다.
   한 프레임 미뤄 재므로 여기서 잠깐 기다렸다 본다. */
const oneLine = await boxH();
const h3 = await hits();
await cdp.send('Input.insertText', {
    text: '. 오늘은 바람이 많이 부니 겉옷을 꼭 챙겨 오시고 티오프보다 삼십 분 일찍 도착해 주세요.' });
await page.waitForTimeout(300);
const grown = await boxH();
ok(grown > oneLine, `여러 줄이 되면 칸이 늘어난다 (${oneLine} → ${grown}px)`);
ok(await hits() - h3 === 0,
   `늘어날 때도 그 자리에서가 아니라 다음 프레임에 잰다 (실제 ${await hits() - h3}번)`);

await page.fill(ta, '');
await page.waitForTimeout(300);
ok(await boxH() === oneLine,
   `다 지우면 한 줄로 돌아온다 (실제 ${await boxH()}px, 한 줄은 ${oneLine}px)`);

/* ── 6-1-1-2. 홈으로 나갔다 오면 키보드 자리가 안 남는가 ──────────
 *
 * 키보드를 올려 둔 채 홈으로 나갔다 돌아오면, 키보드는 사라졌는데
 * **입력칸이 그 자리에 그대로 떠 있고 아래가 텅 비었다**(실기기 제보).
 * 초점이 입력칸에 남아 `blur`가 안 오므로 `typing`이 계속 참이고,
 * 키보드가 다 올라온 뒤 붙박아 둔 탓에 다시 재지도 않아서다.
 *
 * 헤드리스에는 키보드가 없지만 **그 상태 자체는 그대로 만들 수 있다** —
 * 글칸을 눌러 `kb-open`이 서고 붙박일 때까지 기다린 뒤, 돌아온 것처럼
 * `visibilitychange`를 던진다. 되살아나면 `kb-open`이 걷혀야 한다. */
console.log('\n── 홈에 갔다 돌아오기 ──');
await go('/#/chat', 1200);
await page.click('.chat-input .textarea');
await page.waitForTimeout(800);                       // 붙박일 때까지(650ms)
ok(await page.evaluate(() => document.body.classList.contains('kb-open')),
   '글칸을 누르면 키보드 자리가 선다');

await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(500);                       // 두 번째 확인(250ms)까지
const stuck = await page.evaluate(() => ({
    open: document.body.classList.contains('kb-open'),
    kb: document.documentElement.style.getPropertyValue('--kb'),
    vvh: document.documentElement.style.getPropertyValue('--vvh'),
    focused: document.activeElement?.className ?? '',
}));
ok(!stuck.open,
   `돌아오면 키보드 자리가 걷힌다 (실제 ${stuck.open ? '그대로 남음' : '걷힘'})`);
ok(stuck.vvh === '',
   `돌아오면 옛 화면 높이가 안 남는다 (실제 ${JSON.stringify(stuck.vvh)})`);
ok(!stuck.focused.includes('textarea'),
   `돌아오면 글칸 초점도 뗀다 — 안 떼면 다음에 또 갇힌다 (실제 ${JSON.stringify(stuck.focused)})`);

/* ── 이모티콘 ────────────────────────────────────────────────────
 *
 * **한 장도 등록 안 된 때가 있다**(지금이 그렇다 — 배경이 투명한 것으로
 * 다시 만들어 넣기로 하고 다 지웠다). 그때 봐야 할 것은 서랍이 아니라
 * **없어도 안 깨지는가**이므로 갈래를 나눈다. 가르는 잣대는 앱이 쓰는
 * 것과 같다 — 이모티콘 단추가 그려졌는가(`STICKERS.length`).
 */
console.log('\n── 이모티콘 ──');
await go('/#/chat', 1200);

const hasStickers = await page.$('[aria-label="이모티콘"]') !== null;

if (!hasStickers) {
    /* **단추를 아예 안 그린다.** 눌러 봐야 빈 서랍이 열릴 뿐이라 그 자리를
       비워 두는 것이 맞다. */
    ok(await page.$('.chat-sticker-btn') === null,
       '한 장도 없으면 이모티콘 단추를 안 그린다');
    ok(await page.$('.sticker-tray') === null, '열릴 서랍도 없다');

    /* **글칸의 오른쪽 여백도 함께 없앤다.** 안 그러면 아무것도 없는 자리를
       40px 비워 둔 채로 글자가 일찍 접힌다. */
    const pad = await page.$eval('.chat-input .textarea',
        e => parseFloat(getComputedStyle(e).paddingRight));
    ok(pad < 20, `단추가 없으면 글칸 오른쪽 여백도 없앤다 (실제 ${pad}px)`);

    /* **예전 글에 남은 `sticker:` 값은 그대로 열려야 한다.** 그림이
       없어졌으므로 깨진 그림 자국이 아니라 작은 조각으로 물러난다
       (`StickerImg`). 안 그러면 지난 대화가 눈에 띄게 상한다. */
    await page.waitForTimeout(600);
    const gone = await page.$$eval('.chat-sticker-gone', e => e.map(x => x.textContent?.trim()));
    ok(gone.length === 3 && gone.every(t => t === '이모티콘'),
       `그림이 없어진 이모티콘은 작은 조각으로 물러난다 (실제 ${JSON.stringify(gone)})`);
    ok(!(await page.$$eval('.chat-sticker', e => e.some(x => x.complete && x.naturalWidth === 0))),
       '깨진 그림이 말풍선 자리에 남지 않는다');

    /* 함께 적은 글은 그대로 보인다 — 그림만 없어졌지 말은 남아 있다. */
    ok((await page.textContent('.chat-list'))?.includes('내일 봬요!'),
       '이모티콘에 함께 적은 글은 그대로 보인다');
} else {

/* 그린 것부터. 말풍선을 두르지 않는다(이모지만 보낸 글과 같은 결이다). */
const stickerShots = await page.$$eval('.chat-sticker', e => e.map(x => x.getAttribute('src')));
ok(stickerShots.length === 3 && stickerShots.every(s => s?.includes('/stickers/')),
   `보낸 이모티콘은 그림으로 그려진다 (실제 ${JSON.stringify(stickerShots)})`);
ok((await page.$$eval('.chat-bubble', e => e.map(x => x.textContent))).every(t => t?.trim()),
   '글 없이 보낸 이모티콘에는 빈 말풍선이 안 붙는다');
/* 글을 함께 보낸 것은 **그림 아래 한 줄**로 붙는다(사진과 같은 자리). */
ok(await page.$('.chat-sticker') !== null
   && (await page.textContent('.chat-list'))?.includes('내일 봬요!'),
   '이모티콘에 함께 적은 글이 그림 아래에 붙는다');

/* 서랍은 **닫힌 채로 시작한다** — 열려 있으면 대화가 반쯤 가린 채 열린다. */
ok(await page.$('.sticker-tray') === null, '이모티콘 서랍은 닫힌 채로 시작한다');

await page.click('[aria-label="이모티콘"]');
await page.waitForTimeout(400);
const trayCount = await page.$$eval('.sticker-btn', e => e.length);
ok(trayCount > 0, `서랍을 열면 첫 묶음의 이모티콘이 늘어선다 (실제 ${trayCount}장)`);

/* **첫 묶음은 움직이는 것이고 파일이 `.webp`다**(그 밖은 `.png`). 확장자를
   글이 아니라 `stickerSrc()`가 붙이므로, 여기가 어긋나면 그림만 조용히 안 뜬다. */
const firstSrc = await page.$$eval('.sticker-btn img', e => e.map(x => x.getAttribute('src') ?? ''));
ok(firstSrc.length > 0 && firstSrc.every(u => u.endsWith('.webp')),
   `움직이는 이모티콘은 .webp로 찾는다 (실제 ${JSON.stringify(firstSrc.map(u => u.split('/').pop()))})`);
ok(!(await page.$$eval('.sticker-btn img', e => e.some(x => !x.complete || x.naturalWidth === 0))),
   '서랍의 그림이 다 받아진다 — 확장자가 어긋나면 여기서 걸린다');

/* **묶음마다 탭이 하나다**(사용자 요청 — 카카오톡처럼). 백 장이 넘어가면
   한 줄로 늘어놓았을 때 아래쪽 것은 아무도 끝까지 굴려 보지 않는다.
   그림글자만 두지 않고 **이름을 함께 적는지**도 본다 — 그림글자가 없는
   기기에서는 두부만 남아 무슨 묶음인지 알 수 없다. */
const tabs = await page.$$eval('.sticker-tab', e => e.map(x => x.textContent?.trim() ?? ''));
ok(tabs.length >= 1 && tabs.every(t => /[가-힣]/.test(t)),
   `묶음마다 탭이 있고 이름이 적혀 있다 (실제 ${JSON.stringify(tabs)})`);

/* 묶음이 여럿일 때만 볼 수 있는 것 둘 — **옮기면 그 묶음만** 보이는가,
   그리고 **굴려 둔 자리가 안 남는가**(그림 칸의 `key`가 묶음이다).
   지금은 묶음이 하나라 건너뛴다. 묶음을 늘리면 저절로 다시 돈다. */
if (tabs.length >= 3) {
    await page.click('.sticker-tab:nth-child(2)');
    await page.waitForTimeout(300);
    const moved = await page.$$eval('.sticker-btn', e => e.length);
    ok(moved !== trayCount,
       `탭을 옮기면 그 묶음만 보인다 (실제 ${trayCount}장 → ${moved}장)`);
    await page.evaluate(() => { document.querySelector('.sticker-grid').scrollTop = 400; });
    await page.click('.sticker-tab:nth-child(3)');
    await page.waitForTimeout(300);
    ok(await page.$eval('.sticker-grid', e => e.scrollTop) === 0,
       '탭을 옮기면 굴려 둔 자리가 맨 위로 돌아간다');
    await page.click('.sticker-tab:nth-child(1)');
    await page.waitForTimeout(300);
}

/* **누르면 곧바로 안 나간다**(사용자 요청). 입력칸 위에 미리보기로
   물려 두고, 글을 마저 적어 **한 마디로 함께** 보낸다 — 예전에는 누르는
   즉시 나가서 `나이스 샷!`에 한마디 덧붙이려면 두 마디로 갈라야 했다. */
writes.length = 0;
await page.click('.sticker-btn');
await page.waitForTimeout(500);
ok(writes.filter(([w]) => w === 'messages POST').length === 0,
   `고르기만 해서는 안 나간다 (실제 ${writes.filter(([w]) => w === 'messages POST').length}번)`);
ok(await page.$('.sticker-peek') !== null, '고른 이모티콘이 입력칸 위에 뜬다');

/* 글을 마저 적고 보내면 **한 줄로 함께** 나간다. */
await page.fill('.chat-input .textarea', '이따 봬요');
await page.waitForTimeout(300);
writes.length = 0;
await page.click('.chat-send');
await page.waitForTimeout(600);
const both = writes.find(([w]) => w === 'messages POST')?.[1];
ok(both?.image_url?.startsWith('sticker:') && both?.body === '이따 봬요',
   `이모티콘과 글이 한 마디로 나간다 (실제 ${JSON.stringify(both?.image_url)} / ${JSON.stringify(both?.body)})`);
ok(await page.$('.sticker-peek') === null
   && (await page.inputValue('.chat-input .textarea')) === '',
   '보내고 나면 미리보기와 글칸이 함께 비워진다');

/* **`✕`로 뗄 수 있다.** 잘못 골랐을 때 되돌릴 길이 없으면 창을 나갔다
   와야 한다. */
await page.click('[aria-label="이모티콘"]');
await page.waitForTimeout(400);
await page.click('.sticker-btn');
await page.waitForTimeout(300);
await page.click('[aria-label="이모티콘 빼기"]');
await page.waitForTimeout(300);
ok(await page.$('.sticker-peek') === null, '✕로 골라 둔 이모티콘을 뗀다');

/* **서랍은 입력칸 아래, 키보드 자리에 뜬다**(사용자가 보여 준 카톡 모양).
   위에 두면 대화가 가려지고 글칸이 밀려 올라가 이어 칠 수가 없다.
   그리고 목록이 그만큼 줄어드니 **맨 아래로 다시 붙여** 방금 읽던 글이
   위로 밀려나지 않게 한다(높이가 한 번에 안 정해져 실제로 58px 어긋났다). */
const trayGeo = await page.evaluate(() => {
    const t = document.querySelector('.sticker-tray')?.getBoundingClientRect();
    const bar = document.querySelector('.chat-bar').getBoundingClientRect();
    const l = document.querySelector('.chat-list');
    return t ? { below: t.top >= bar.bottom - 1,
                 gap: Math.round(l.scrollHeight - l.scrollTop - l.clientHeight) } : null;
});
ok(trayGeo?.below === true, '서랍이 입력칸 아래에 선다');
ok((trayGeo?.gap ?? 999) <= 2,
   `서랍을 열면 대화가 맨 아래로 붙는다 (실제 ${trayGeo?.gap}px 남음)`);

}

/* ── 6-1-1-3. 길게 눌러 가리기 · 지우기 ─────────────────────────
 *
 * 손짓 하나에 할 일이 둘이라 **고르는 창**이 먼저 뜬다 —
 * `가리기`는 운영진 몫(덮어 두는 것이라 되돌릴 수 있다),
 * `지우기`는 쓴 사람 몫(되돌릴 수 없어 남의 글에는 안 붙인다).
 *
 * 넷을 본다 — 가려진 글이 정말 안 보이는가, 운영진이 남의 글을 가릴 수
 * 있는가, **쓴 사람이 제 글을 지울 수 있는가**, 그리고 **남의 글에는
 * 그 길이 아예 없는가.**
 */
console.log('\n── 메시지 가리기 · 지우기 ──');
await go('/#/chat', 1200);

const chatText = await page.textContent('.chat-list') ?? '';
ok(chatText.includes('운영진이 가린 메시지입니다'),
   '가려진 글은 내용 대신 안내 한 줄로 그려진다');
ok(!chatText.includes('여기 광고 글이 있었습니다'),
   '가려진 글의 내용은 화면 어디에도 안 실린다');

/* 남의 글(m5)을 길게 누른다. PC에서는 오른쪽 클릭이 같은 자리다.
   **가리기만 나온다** — 지우기는 쓴 사람에게만 붙는다. */
const before = writes.filter(([w]) => w === 'messages PATCH').length;
await page.click('[data-mid="m5"] .chat-bubble', { button: 'right' });
await page.waitForTimeout(300);
const menuOther = await page.textContent('.chat-menu') ?? '';
ok(menuOther.includes('가리기'), '운영진이 남의 글을 길게 누르면 가리기가 나온다');
ok(!menuOther.includes('지우기'), '남의 글에는 지우기가 안 나온다 — 되돌릴 수 없는 일이다');
await page.click('.chat-menu-item:text-is("가리기")');
await page.waitForTimeout(300);
ok(await page.$('.confirm-box') !== null, '가리기를 고르면 한 번 더 묻는다');
await page.click('.confirm-actions .btn:not(.ghost)');
await page.waitForTimeout(400);
const patched = writes.filter(([w]) => w === 'messages PATCH').map(([, v]) => v);
ok(patched.length === before + 1 && !!patched.at(-1)?.hidden_at,
   `가리기를 누르면 hidden_at을 세워 보낸다 (실제 ${JSON.stringify(patched.at(-1))})`);
ok((await page.textContent('[data-mid="m5"]') ?? '').includes('운영진이 가린 메시지입니다'),
   '가리면 그 자리에서 바로 덮인다 — 다시 들어와 볼 일이 없다');

/* 이미 가린 글은 **푸는 쪽**이 나온다. 지운 것이 아니므로 되돌릴 수 있다. */
await page.click('[data-mid="m17"] .chat-bubble', { button: 'right' });
await page.waitForTimeout(300);
ok((await page.textContent('.chat-menu') ?? '').includes('가리기 풀기'),
   '이미 가린 글은 푸는 쪽이 나온다');
await page.click('.chat-menu-item.ghost');
await page.waitForTimeout(200);

/* **내 글(m3)에는 지우기가 붙는다.** 운영진이라 가리기도 함께 나온다. */
const delBefore = writes.filter(([w]) => w === 'messages DELETE').length;
await page.click('[data-mid="m3"] .chat-bubble', { button: 'right' });
await page.waitForTimeout(300);
ok((await page.textContent('.chat-menu') ?? '').includes('지우기'),
   '내가 쓴 글에는 지우기가 나온다');
await page.click('.chat-menu-item:text-is("지우기")');
await page.waitForTimeout(300);
ok((await page.textContent('.confirm-box') ?? '').includes('지울까요'),
   '지우기도 한 번 더 묻는다 — 되돌릴 수 없기 때문이다');
await page.click('.confirm-actions .btn:not(.ghost)');
await page.waitForTimeout(400);
const deleted = writes.filter(([w]) => w === 'messages DELETE').map(([, v]) => v);
ok(deleted.length === delBefore + 1 && !!deleted.at(-1)?.includes('id=eq.m3'),
   `지우기를 누르면 그 줄만 지운다 (실제 ${deleted.at(-1)})`);
ok(await page.$('[data-mid="m3"] .chat-bubble') === null,
   '지우면 그 자리에서 바로 사라진다');

/* **남의 글에는 이 길이 없다.** 화면에서 감추는 것으로 끝내지 않고
   DB도 같게 막혀 있다 — `messages`에는 회원용 update 정책이 아예 없고,
   지우기는 `messages_own`이 `user_id = auth.uid()`인 줄만 열어 둔다.
   총무는 운영진이 아니므로(`is_admin()`에 안 든다) 가리기도 없다. */
const hCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const hSession = { ...SESSION, user: { ...SESSION.user, id: uid(4) } };
await hCtx.route('**/rest/v1/**', restRoute(tables));
await hCtx.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(hSession) }));
await stubOutside(hCtx);
await hCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), hSession);
const hPage = await hCtx.newPage();
await hPage.goto(BASE + '/#/chat', { waitUntil: 'networkidle' });
await hPage.waitForTimeout(1200);
await hPage.click('[data-mid="m1"] .chat-bubble', { button: 'right' });
await hPage.waitForTimeout(300);
const menuTheirs = await hPage.textContent('.chat-menu') ?? '';
ok(menuTheirs.includes('복사') && menuTheirs.includes('답장'),
   '남의 글에서도 창은 뜬다 — 복사와 답장은 누구나 한다');
ok(!menuTheirs.includes('가리기') && !menuTheirs.includes('지우기'),
   '남의 글에는 가리기도 지우기도 안 붙는다');
await hPage.click('.chat-menu-item.ghost');
await hPage.waitForTimeout(200);
/* 제 글(m5)에는 지우기만 나온다 — 운영진이 아니라 가리기는 없다. */
await hPage.click('[data-mid="m5"] .chat-bubble', { button: 'right' });
await hPage.waitForTimeout(300);
const menuMine = await hPage.textContent('.chat-menu') ?? '';
ok(menuMine.includes('지우기'), '일반회원도 제 글은 지울 수 있다');
ok(!menuMine.includes('가리기'), '가리기는 운영진 몫이라 일반회원에게는 안 나온다');
ok((await hPage.textContent('.chat-list') ?? '').includes('운영진이 가린 메시지입니다'),
   '가려진 글은 일반회원에게도 똑같이 덮여 보인다');
await hCtx.close();

/* ── 6-1-1-3-1. 글 안의 주소 ────────────────────────────────────
 *
 * 카톡에서는 주소를 붙이면 그대로 눌러 들어간다. 우리는 그냥 글자였고,
 * 게다가 말풍선의 글자 고르기를 막아 두어 **복사할 길도 없었다.**
 * 셋을 본다 — 링크가 되는가, 새 탭으로 여는가, 그리고 **뒤에 붙은 한글에서
 * 끊기는가**(안 끊으면 문장 끝까지 통째로 링크가 된다).
 */
console.log('\n── 글 안의 주소 ──');
await go('/#/chat', 1200);
const link = await page.$eval('[data-mid="m18"] .chat-link',
    a => ({ text: a.textContent, href: a.getAttribute('href'),
            target: a.getAttribute('target'), rel: a.getAttribute('rel') }))
    .catch(() => null);
ok(link?.href === 'https://booking.example.com/mudeung',
   `주소가 눌리는 링크가 된다 (실제 ${link?.href})`);
ok(link?.text === 'https://booking.example.com/mudeung',
   `뒤에 붙은 한글에서 끊는다 (실제 ${JSON.stringify(link?.text)})`);
ok(link?.target === '_blank' && (link?.rel ?? '').includes('noopener'),
   '새 탭으로 연다 — 홈 화면 앱에서는 같은 창으로 나가면 돌아올 길이 없다');
ok((await page.textContent('[data-mid="m18"]') ?? '').includes('에서 하시면 됩니다'),
   '주소 뒤의 글은 그대로 남는다');
/* 주소가 없는 글에는 링크가 하나도 없어야 한다 — `9.30분`이 주소로
   둔갑하면 눌러 봐야 아무 데도 안 간다. */
ok(await page.$('[data-mid="m1"] .chat-link') === null,
   '주소가 없는 글에는 링크를 안 만든다');

/* ── 6-1-1-3-1-9. 방 공지 ───────────────────────────────────────
 *
 * 카톡 오픈톡에서 말풍선을 길게 눌러 맨 위에 붙박는 그것이다. 모임
 * 규칙·계좌·집합 장소가 하루 백 마디에 밀려 사라지지 않게 한다.
 *
 * **머리말과 대화 사이에 있어야 한다** — 대화 목록 안에 넣으면 굴릴 때
 * 함께 올라가 사라져서, 늘 보이라고 붙박은 뜻이 없어진다.
 */
console.log('\n── 방 공지 ──');
await go('/#/chat', 1200);
const pinText = await page.textContent('.chat-pin-text').catch(() => null);
ok(pinText?.includes('카풀'), `붙박아 둔 글이 맨 위에 뜬다 (실제 ${pinText})`);
/* 공지 줄이 **목록 밖에** 있어야 굴려도 안 사라진다. */
ok(await page.$('.chat-list .chat-pin') === null,
   '대화 목록 안이 아니라 그 위에 있다 — 굴려도 안 사라진다');
/* 접힌 한 줄이 기본이다. 긴 공지를 펴 놓고 시작하면 대화가 그만큼 가려진다. */
ok(await page.$('.chat-pin.open') === null, '기본은 접힌 한 줄이다');
await page.click('.chat-pin-main');
await page.waitForTimeout(250);
ok(await page.$('.chat-pin.open') !== null, '누르면 펴진다');
const footText = await page.textContent('.chat-pin-foot');
ok(footText?.includes('님이 올림'), `누가 올렸는지 적는다 (실제 ${footText?.trim()})`);
ok(footText?.includes('대화에서 보기'), '그 말이 오간 자리로 가는 길이 있다');

/* **누가 올리고 내릴 수 있는가가 규칙의 전부다** — 운영진만이다.
   고정 자료의 나(ME)는 앱관리자라 창에 그 줄이 있어야 한다. */
await page.click('.chat-pin-main');            // 도로 접는다
await page.waitForTimeout(200);
const bubble = await page.$('[data-mid="m1"] .chat-bubble');
await bubble.click({ button: 'right' });
await page.waitForTimeout(300);
const menu = await page.textContent('.chat-menu');
ok(menu?.includes('공지로 올리기'), '운영진에게는 창에 `공지로 올리기`가 있다');
/* 이미 공지인 글에서는 말이 뒤집힌다 — 같은 자리에서 내릴 수 있어야 한다. */
await page.click('.chat-menu-item.ghost');
await page.waitForTimeout(200);
const pinned = await page.$('[data-mid="m4"] .chat-bubble');
await pinned.click({ button: 'right' });
await page.waitForTimeout(300);
ok((await page.textContent('.chat-menu'))?.includes('공지 내리기'),
   '이미 공지인 글에서는 `공지 내리기`로 뒤집힌다');
/* **가린 글은 공지로 못 올린다** — 덮어 둔 내용이 맨 위로 샌다. */
await page.click('.chat-menu-item.ghost');
await page.waitForTimeout(200);
const hidden = await page.$('[data-mid="m17"] .chat-bubble');
await hidden.click({ button: 'right' });
await page.waitForTimeout(300);
ok(!(await page.textContent('.chat-menu'))?.includes('공지로 올리기'),
   '가린 글에는 안 붙인다 — 덮어 둔 내용이 맨 위로 샌다');
await page.click('.chat-menu-item.ghost');
await page.waitForTimeout(200);

/* ── 6-1-1-3-2. 대화 검색 ───────────────────────────────────────
 *
 * 카톡 오픈톡의 🔍다. 100명이 하루 100마디면 `무등산 몇 시라고 했지`를
 * 되짚을 길이 위로 계속 올리는 것 말고는 없었다.
 *
 * **찾는 일은 서버가 한다** — 받아 둔 것만 뒤지면 `지난 대화 더 보기`를
 * 누른 만큼만 찾아져서 정작 오래된 것을 못 찾는다. 그래서 조회가 나가는지,
 * 무엇을 실어 보내는지까지 본다.
 */
console.log('\n── 대화 검색 ──');
await go('/#/chat', 1200);
ok(await page.$('.chat-find') !== null, '머리말에 찾기 단추가 있다');
await page.click('.chat-find');
await page.waitForTimeout(200);
ok(await page.$('.chat-search-in') !== null, '누르면 찾는 칸이 열린다');
/* 한 글자로는 안 찾는다 — `아`만 쳐도 백 줄이 걸려 목록이 뜻이 없다. */
await page.fill('.chat-search-in', '무');
await page.waitForTimeout(500);
ok((await page.textContent('.chat-hits') ?? '').includes('두 글자 이상'),
   '한 글자로는 안 찾는다 — 너무 많이 걸려 목록이 뜻이 없다');

await page.fill('.chat-search-in', '무등산');
await page.waitForTimeout(700);
const hitTexts = await page.$$eval('.chat-hit', els => els.map(e => e.textContent));
ok(hitTexts.length > 0 && hitTexts.every(t => t?.includes('무등산')),
   `친 말이 든 글만 나온다 (실제 ${hitTexts.length}건)`);
/* **가려진 글은 결과에도 안 나온다** — 여기로 새면 가린 뜻이 없다. */
await page.fill('.chat-search-in', '광고');
await page.waitForTimeout(700);
ok(!(await page.textContent('.chat-hits') ?? '').includes('여기 광고 글이 있었습니다'),
   '가려진 글은 검색 결과에도 안 나온다');

/* 결과를 누르면 그 글로 옮겨 가고, 창이 닫힌다. */
await page.fill('.chat-search-in', '무등산');
await page.waitForTimeout(700);
await page.click('.chat-hit');
await page.waitForTimeout(600);
ok(await page.$('.chat-hits') === null, '결과를 누르면 찾는 창이 닫힌다');
ok(await page.$('.chat-list') !== null, '대화가 다시 보인다');

/* ── 6-1-1-2. 앱 가이드로 들어가는 문 ───────────────────────────
 *
 * **홈 머리말의 얼굴 옆에 있다**(사용자 요청). `내 정보` 메뉴 안에 있을
 * 때는 메뉴를 열어야 보여서 처음 들어온 분이 정작 못 찾았다 — 홈은
 * 모두가 처음 닿는 화면이다. 두 자리를 함께 본다: 홈에 있는가,
 * 그리고 `내 정보`에서 **빠졌는가**(양쪽에 두면 다시 헷갈린다).
 */
console.log('\n── 앱 가이드로 들어가는 문 ──');
await go('/#/', 900);
const guide = await page.$$eval('.head-side a', e => e.map(x => x.getAttribute('href')));
ok(guide.some(h => h?.includes('/help')),
   `홈 머리말에 가이드 단추가 있다 (실제 ${JSON.stringify(guide)})`);
ok(guide.some(h => h?.includes('/me')), '얼굴은 그대로 내 정보로 간다');
await go('/#/me', 900);
ok(!(await page.textContent('.page') ?? '').includes('가이드'),
   '내 정보 메뉴에서는 빠졌다 — 두 자리에 두면 다시 헷갈린다');
await go('/#/help', 900);
ok((await page.textContent('.page') ?? '').includes('앱 사용자 가이드'),
   '눌러 들어가면 가이드가 열린다');

/* ── 6-1-2. 홈 카드의 내 조 ─────────────────────────────────────
 *
 * 새벽에 나가면서 몇 조인지·몇 시에 치는지 보려고 라운드 상세까지 들어갈
 * 일이 없어야 한다. **조 번호는 신청 기록에 딸려 오고 시각은 `round_groups`에
 * 따로 있다** — 둘 다 있어야 줄이 뜬다.
 *
 * **r1은 고정 자료에서 조를 안 짠 라운드다**(그 상태도 확인해야 하므로 그대로
 * 둔다). 그래서 여기서만 잠깐 조를 붙였다가 **되돌린다** — 안 되돌리면
 * 아래 `조를 안 짠 라운드` 검사가 헛돈다. */
console.log('\n── 홈 카드의 내 조 ──');
await go('/#/', 700);
ok(!(await page.textContent('.next') ?? '').includes('조 ·'),
   '조를 안 짠 라운드에는 이 줄이 아예 없다');

const mySignup = tables.signups.find(s => s.id === 's3');   // r1 · 나
const mate = tables.signups.find(s => s.id === 's4');       // r1 · 박승수
mySignup.grp = 2; mate.grp = 2;
/* 고정 자료의 r1은 사흘 뒤 한국 시각 7:30이다. 2조를 8분 뒤로 둔다 —
   라운드 시각(7:30)이 아니라 **조 시각**을 적는지 그래야 갈린다. */
const kst = (dayOffset, h, m) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + dayOffset);
    d.setUTCHours(h - 9, m, 0, 0);
    return d.toISOString();
};
tables.round_groups.push({
    round_id: 'r1', tees: { 1: kst(3, 7, 30), 2: kst(3, 7, 38) },
    posted_by: ME, posted_at: kst(-1, 12, 0),
});
/* **같은 주소로 `go()`하면 아무 일도 안 일어난다** — 이미 `/#/`에 있어서
   화면이 다시 안 만들어지고, 방금 붙인 조가 영영 안 보인다. 문서를 새로 연다. */
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const nextCard = await page.textContent('.next-grp') ?? '';
ok(nextCard.includes('2조'), `내 조를 적는다 (실제 ${JSON.stringify(nextCard)})`);
ok(nextCard.includes('7:38'), '내 조의 시각을 적는다 — 라운드 시각(7:30)이 아니다');
ok(nextCard.includes('박승수'), '같은 조 사람을 닉네임으로 적는다');
mySignup.grp = null; mate.grp = null;
tables.round_groups = tables.round_groups.filter(g => g.round_id !== 'r1');

/* ── 6-2. 투표에 날짜로 항목 넣기 ───────────────────────────────
 *
 * 모임 투표의 거의 전부가 날짜 정하기다. 손으로 치면 요일을 세어 봐야 하고
 * 오타도 난다. 보는 것이 넷이다:
 *   ① **아무것도 안 눌렀으면 아무 항목도 없다** — 브라우저의 날짜 칸을 쓰던
 *      때는 아이폰이 여는 순간 오늘을 던져 **고르기도 전에 오늘이 들어갔다**
 *      (실제 제보). 그래서 달력을 직접 그린다.
 *   ② **빈 줄부터 채운다** — 새 투표는 빈 칸 두 개로 시작하는데 아래에 새
 *      줄을 붙이면 화면에 빈 칸이 남아 안 적은 것처럼 보인다.
 *   ③ 다시 누르면 빠진다.
 *   ④ 달을 넘겨도 고른 것이 그대로 있다.
 */
console.log('\n── 투표에 날짜 넣기 ──');
const dayCells = () => page.$$eval('.option-row .input', e => e.map(x => x.value));
await go('/#/polls/new', 600);
ok((await dayCells()).every(v => !v),
   `달력을 열어만 두면 아무 항목도 안 생긴다 (실제 ${JSON.stringify(await dayCells())})`);

/* 이 달의 5일·12일을 누른다. 달력은 늘 이번 달로 열린다. */
const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const lab = d => {
    const x = new Date(now.getFullYear(), now.getMonth(), d);
    return `${x.getMonth() + 1}월 ${d}일 (${'일월화수목금토'[x.getDay()]})`;
};
await page.getByRole('button', { name: '5', exact: true }).click();
await page.getByRole('button', { name: '12', exact: true }).click();
await page.waitForTimeout(200);
const opts = await dayCells();
ok(opts[0] === lab(5) && opts[1] === lab(12),
   `누른 날이 요일까지 붙어 항목이 된다 (실제 ${JSON.stringify(opts)})`);
ok(opts.length === 2, `빈 줄부터 채운다 — 줄이 늘지 않는다 (실제 ${opts.length}줄)`);
ok((await page.$$eval('.cal-day.on', e => e.map(x => x.textContent))).join() === '5,12',
   '고른 날은 달력에서도 칠해진다');

await page.getByRole('button', { name: '5', exact: true }).click();
await page.waitForTimeout(200);
ok(!(await dayCells()).includes(lab(5)),
   `다시 누르면 빠진다 (실제 ${JSON.stringify(await dayCells())})`);

await page.getByRole('button', { name: '다음 달' }).click();
await page.waitForTimeout(200);
ok((await dayCells()).includes(lab(12)), '달을 넘겨도 고른 항목은 그대로다');

/* ── 6-3. 정산 송금 링크 ────────────────────────────────────────
 *
 * 계좌를 손으로 옮겨 적다 틀리면 돈이 엉뚱한 데로 간다. 이 주소로 열면
 * 은행·계좌·**내 몫**까지 채워진 채로 토스 송금 화면이 뜬다.
 * 은행 이름은 사람이 친 값이라 `국민은행`처럼 적히므로 끝의 `은행`을 뗀다.
 */
console.log('\n── 정산 송금 링크 ──');
await go('/#/rounds/r3', 800);
const toss = await page.getAttribute('.settle-toss a', 'href');
ok(toss?.startsWith('supertoss://send?'), `토스 송금 주소로 건다 (실제 ${toss})`);
const tq = new URLSearchParams((toss ?? '').split('?')[1] ?? '');
ok(tq.get('bank') === '국민', `은행 이름 끝의 \`은행\`을 뗀다 (실제 ${JSON.stringify(tq.get('bank'))})`);
ok(/^\d+$/.test(tq.get('accountNo') ?? ''), `계좌번호의 \`-\`는 뺀다 (실제 ${tq.get('accountNo')})`);
ok(Number(tq.get('amount')) > 0, `내 몫이 금액으로 들어간다 (실제 ${tq.get('amount')})`);

/* ── 6-4. 회원 명단의 참석 횟수 ─────────────────────────────────
 *
 * **세는 것은 DB가 한다**(`attendance_counts`). 화면이 신청 기록을 통째로
 * 받아 세면 100명·1년치가 수백 KB다.
 * **지난 라운드만 센다** — 앞으로의 라운드에 신청해 둔 것은 아직 나간 것이
 * 아니다. 고정 자료에서 지난 라운드는 r3 하나이고 세 사람이 나갔다.
 */
console.log('\n── 회원 명단의 참석 횟수 ──');
await go('/#/members', 800);
const rows = await page.$$eval('.member-row', e => e.map(x => x.textContent));
const line = n => rows.find(t => t.includes(n)) ?? '';
ok(line('신성호').includes('올해 1회'), `나간 사람은 횟수가 붙는다 (실제 ${JSON.stringify(line('신성호'))})`);
ok(line('정우성').includes('올해 0회'),
   `앞으로의 라운드만 신청한 사람은 0회다 (실제 ${JSON.stringify(line('정우성'))})`);

/* ── 6-4-1. 회원 명단 차례 고르기 ───────────────────────────────
 *
 * 100명 명단은 화면 여덟 장이라, 나이나 지역으로 묶어 보고 싶은 자리가
 * 있다(사용자 요청). **모르는 값은 늘 뒤로 보낸다** — 안 적은 사람이 맨
 * 앞에 몰리면 정렬이 고장 난 것처럼 보인다(오세훈이 그 사람이다).
 * 고정 자료의 회원 여덟 명으로 본다.
 */
console.log('\n── 회원 명단 차례 ──');
/* **회원 줄만 본다.** 화면에는 위에 `가입 신청`, 아래에 `추방` 묶음이 함께
   있고 셋 다 `.member-row`다 — 안 갈라내면 대기자가 맨 앞에 섞여 들어와
   앱이 멀쩡한데도 검사가 빨개진다(실제로 그렇게 짰다가 다섯 건이 떴다).
   차례를 매기는 것은 **회원 묶음뿐**이므로 고정 자료로 걸러 낸다. */
const memberNames = new Set(tables.profiles
    .filter(p => p.role !== 'pending' && p.role !== 'banned').map(p => p.name));
/** 지금 명단에 보이는 회원 이름들. 이름표가 `72/신성호/광산구`라 닉네임만 뽑는다. */
const names = async () => (await page.$$eval('.member-row .b.truncate',
    e => e.map(x => (x.textContent ?? '').split('/')[1] ?? x.textContent)))
    .filter(n => memberNames.has(n));
const pick = async label => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(250);
    return names();
};

await go('/#/members', 800);
const byNameOrder = await names();
ok(byNameOrder[0] === '김지명' && byNameOrder.at(-1) === '정우성',
   `기본은 이름 가나다순이다 (실제 ${JSON.stringify(byNameOrder)})`);

const byAge = await pick('나이');
ok(byAge[0] === '임채원' && byAge[1] === '이관교',
   `나이는 연장자가 앞이다 — 58년생·68년생 차례 (실제 ${JSON.stringify(byAge)})`);
ok(byAge.at(-1) === '오세훈',
   '태어난 해를 안 적은 사람은 맨 뒤다 — 모르는 값이 앞에 오면 고장 나 보인다');

const byRegion = await pick('지역');
ok(byRegion[0] === '신성호' && byRegion[1] === '박승수',
   `지역 가나다순이다 — 광산구·남구 차례 (실제 ${JSON.stringify(byRegion)})`);
ok(byRegion.at(-1) === '오세훈',
   '거주지역을 안 적은 사람도 맨 뒤다');

const byAttend = await pick('참석');
ok(byAttend.slice(0, 3).sort().join() === ['김지명', '신성호', '이관교'].sort().join(),
   `참석은 많이 나온 사람이 앞이다 — r3에 나간 셋 (실제 ${JSON.stringify(byAttend)})`);

/* 고른 차례가 **눌린 것으로 보이는가.** 안 보이면 지금 무슨 차례인지
   알 수 없어 같은 칩을 또 누르게 된다. */
const on = await page.$$eval('.sort-chip[aria-pressed="true"]', e => e.map(x => x.textContent));
ok(on.length === 1 && on[0] === '참석',
   `지금 고른 차례 하나만 켜져 보인다 (실제 ${JSON.stringify(on)})`);

/* ── 7. 성별·태어난 해를 안 적은 회원 ───────────────────────────
 *
 * **둘 다 필수라 로그인 뒤 한 번 막고 받는다**(`screens/FillProfile.tsx`).
 * 가입 화면은 승인 전에만 보이므로, 이미 승인된 분들은 그 길로는 못 받는다.
 * 여기서 보는 것은 **막히는가**와 **적으면 풀리는가** 둘이다.
 */
console.log('\n── 안 적은 회원은 로그인 뒤 막힌다 ──');
const BLANK = uid(9);                 // 오세훈 — 성별·태어난 해·거주지역이 빈 회원
const bCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const bSession = { ...SESSION, user: { ...SESSION.user, id: BLANK } };
const bWrites = [];
await bCtx.route('**/rest/v1/**', restRoute(tables));
await bCtx.route('**/rest/v1/profiles**', route => {
    if (route.request().method() === 'GET') return route.fallback();
    bWrites.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await bCtx.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(bSession) }));
await stubOutside(bCtx);
await bCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), bSession);

const bPage = await bCtx.newPage();
await bPage.goto(BASE + '/#/', { waitUntil: 'networkidle' });
await bPage.waitForTimeout(800);
ok((await bPage.textContent('.page') ?? '').includes('저장하고 시작하기'),
   '안 적은 회원은 앱 대신 받는 화면을 본다');
ok((await bPage.$$('.tabbar')).length === 0, '적기 전에는 탭바가 없다 — 앱으로 못 들어간다');

// 성별만 고르고 저장하면 나머지를 달라고 해야 한다(셋 다 필수다).
await bPage.locator('.opt', { hasText: '남' }).first().click();
await bPage.getByText('저장하고 시작하기', { exact: true }).click();
await bPage.waitForTimeout(300);
ok(bWrites.length === 0, '태어난 해가 비면 저장을 안 보낸다');

await bPage.fill('#fp-birth', '1985');
await bPage.getByText('저장하고 시작하기', { exact: true }).click();
await bPage.waitForTimeout(300);
ok(bWrites.length === 0, '거주지역이 비면 저장을 안 보낸다');

await bPage.fill('#fp-region', '광산구');
await bPage.getByText('저장하고 시작하기', { exact: true }).click();
await bPage.waitForTimeout(400);
ok(bWrites.length === 1 && bWrites[0].gender === 'm' && bWrites[0].birth_year === 1985
   && bWrites[0].region === '광산구',
   `셋 다 적으면 저장한다 (보낸 값 ${JSON.stringify(bWrites[0])})`);
await bCtx.close();

/* ── 8. 스키마를 아직 다시 안 돌린 저장소 ───────────────────────
 *
 * **앱은 배포되면 바로 올라가지만 `schema.sql`은 사람이 손으로 붙여넣는다.**
 * 그 사이에 새 표를 `unwrap`으로 읽으면 오류가 던져져 **화면이 통째로 안
 * 열린다** — 조 편성이 안 보이는 정도가 아니라 라운드 상세가 죽는다.
 * 실제로 그렇게 짰다가 여기서 잡았다.
 *
 * 새 표나 새 칸을 읽는 코드를 넣을 때마다 이 목록에 화면을 더할 것.
 * (같은 사정으로 이미 조심하고 있는 것들: 대화의 `image_url`,
 *  `roundKind()`의 `kind` 칸.)
 */
console.log('\n── 옛 스키마에서도 열리는가 ──');
const oldTables = { ...tables };
delete oldTables.round_groups;
delete oldTables.settle_reminders;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
oldTables.signups = tables.signups.map(({ grp, ...rest }) => rest);
/* **성별·태어난 해도 칸째 없앤다.** 여기가 이번에 제일 위험한 자리다 —
   그 칸이 없는데 '안 적었다'로 보고 막으면, 저장도 안 되는 화면에
   **회원 모두가 갇힌다**(`needsProfile`이 `null`과 `undefined`를 가르는 이유). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
oldTables.profiles = tables.profiles.map(({ gender, birth_year, region, ...rest }) => rest);
/* 투표 결과 알리기가 없던 때. `result_at`이 `undefined`면 앱이 아무것도
   안 불러야 한다 — 없는 함수를 부르면 오류만 쌓인다. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
oldTables.polls = tables.polls.map(({ result_at, ...rest }) => rest);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
oldTables.messages = tables.messages.map(({ poll_id, ...rest }) => rest);
const MISSING = ['round_groups', 'settle_reminders', 'profile_private'];
/* **없는 칸을 달라고 하면 진짜 PostgREST는 400을 준다.** 흉내가 그냥
   빼고 주면 `fetchPeople()`이 좁은 목록으로 물러나는 길을 아예 안 타서,
   이 시험이 통과해도 실제로는 명단을 받는 화면이 전부 죽는다. */
const GONE_COLS = {
    profiles: ['gender', 'birth_year', 'region'],
    polls:    ['result_at'],
    messages: ['poll_id', 'pinned_at'],
};

const oldRpc = [];
const oldCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
await oldCtx.route('**/rest/v1/**', async route => {
    const t = new URL(route.request().url()).pathname.split('/rest/v1/')[1]?.split('?')[0];
    // 없는 표에는 진짜 PostgREST처럼 404를 준다.
    if (MISSING.includes(t)) {
        return route.fulfill({ status: 404, contentType: 'application/json',
            body: JSON.stringify({ message: `relation "public.${t}" does not exist` }) });
    }
    const q = new URL(route.request().url()).searchParams;
    const sel = q.get('select') ?? '';
    /* **고르는 칸만 보면 안 된다 — 거르는 칸도 400이다.** 방 공지는
       `select('*')`로 받으면서 `pinned_at`으로 거르는데, 여기서 안 걸러
       주면 그 길을 아예 안 타서 시험이 통과해도 실제로는 대화 화면이
       통째로 안 열린다(진짜 PostgREST는 없는 칸이면 어디에 있든 400이다). */
    const asked = new Set([...sel.split(/[\s,()]+/), ...q.keys()]);
    const gone = (GONE_COLS[t] ?? []).find(c => asked.has(c));
    if (gone) {
        return route.fulfill({ status: 400, contentType: 'application/json',
            body: JSON.stringify({
                message: `column ${t}.${gone} does not exist`, code: '42703' }) });
    }
    /* 함수도 없다. 불렀으면 여기 걸려 아래 시험이 빨갛게 뜬다. */
    if (t?.startsWith('rpc/post_poll_result')) {
        oldRpc.push(t);
        return route.fulfill({ status: 404, contentType: 'application/json',
            body: JSON.stringify({ message: 'function post_poll_result does not exist' }) });
    }
    /* 참석 횟수를 세는 함수도 없다. **그때 `올해 0회`라고 적으면 거짓말이라**
       화면이 그 줄을 아예 안 적어야 한다(오류를 빈 목록으로 넘기면 모두가
       0회가 된다). */
    if (t === 'rpc/attendance_counts') {
        return route.fulfill({ status: 404, contentType: 'application/json',
            body: JSON.stringify({ message: 'function attendance_counts does not exist' }) });
    }
    return restRoute(oldTables)(route);
});
await oldCtx.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await stubOutside(oldCtx);
await oldCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

const oldPage = await oldCtx.newPage();
for (const [name, hash, must] of [
    ['앱이 열린다 — 프로필 받는 화면에 안 갇힌다', '/#/', '다음 라운드'],
    ['라운드 상세 (조가 짜여 있던 라운드)', '/#/rounds/r2', '함평엘리체CC'],
    ['라운드 상세 (조를 안 짠 라운드)',   '/#/rounds/r1', '무등산CC'],
    ['총무 정산 현황',                  '/#/settle',    '무등산CC 그린피'],
    /* 명단을 받는 화면들. `fetchPeople()`이 좁은 목록으로 물러나야 열린다 —
       안 물러나면 여기가 통째로 빈 화면이 된다. */
    ['투표 목록',                       '/#/polls',     '투표'],
    ['조 편성',                        '/#/rounds/r2/groups', '조 편성'],
    ['회원 명단',                       '/#/members',   '회원'],
    ['대화',                           '/#/chat',      ''],
]) {
    await oldPage.goto(BASE + hash, { waitUntil: 'networkidle' });
    await oldPage.waitForTimeout(700);
    // 대화 화면에는 `.page`가 없어 `body`로 본다.
    const txt = await oldPage.textContent('body').catch(() => '') ?? '';
    ok(txt.includes(must) && !txt.includes('does not exist'),
       `${name} — 그대로 열린다${txt.includes('does not exist') ? ` (${txt.slice(0, 80)})` : ''}`);
}

ok(oldRpc.length === 0,
   `칸이 없으면 결과 알리기를 아예 안 부른다 (실제 ${oldRpc.length}번)`);

// 세는 함수가 없으면 **횟수 줄을 아예 안 적는다** — `올해 0회`는 거짓말이다.
await oldPage.goto(BASE + '/#/members', { waitUntil: 'networkidle' });
await oldPage.waitForTimeout(700);
ok(!((await oldPage.textContent('body') ?? '').includes('올해')),
   '세는 함수가 없으면 참석 횟수를 안 적는다 — 모두 `올해 0회`가 되면 거짓말이다');

await browser.close();

if (errors.length) {
    console.log('\n❌ 자바스크립트 오류');
    [...new Set(errors)].slice(0, 5).forEach(e => console.log('   ' + e.slice(0, 160)));
    fail += errors.length;
}
console.log(`\n${fail ? '❌' : '✅'} ${pass}개 통과 · ${fail}개 실패`);
process.exitCode = fail ? 1 : 0;
