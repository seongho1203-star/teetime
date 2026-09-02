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
    rpc.push([
        new URL(route.request().url()).pathname.split('/').pop(),
        route.request().postDataJSON() ?? null,
    ]);
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
 * 오타도 난다. **빈 줄부터 채우는지**가 핵심이다 — 새 투표는 빈 칸 두 개로
 * 시작하는데 아래에 새 줄을 붙이면 화면에 빈 칸이 남아 안 적은 것처럼 보인다.
 */
console.log('\n── 투표에 날짜 넣기 ──');
await go('/#/polls/new', 600);
await page.fill('#v-date', '2026-10-04');
await page.waitForTimeout(200);
await page.fill('#v-date', '2026-10-11');
await page.waitForTimeout(200);
const opts = await page.$$eval('.option-row .input', e => e.map(x => x.value));
ok(opts[0] === '10월 4일 (일)' && opts[1] === '10월 11일 (일)',
   `고른 날짜가 요일까지 붙어 항목이 된다 (실제 ${JSON.stringify(opts)})`);
ok(opts.length === 2, `빈 줄부터 채운다 — 줄이 늘지 않는다 (실제 ${opts.length}줄)`);
await page.fill('#v-date', '2026-10-04');
await page.waitForTimeout(300);
ok((await page.$$eval('.option-row .input', e => e.map(x => x.value))).length === 2,
   '같은 날짜를 또 고르면 안 늘어난다');

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
    messages: ['poll_id'],
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
    const sel = new URL(route.request().url()).searchParams.get('select') ?? '';
    const gone = (GONE_COLS[t] ?? []).find(c => sel.split(/[\s,()]+/).includes(c));
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

await browser.close();

if (errors.length) {
    console.log('\n❌ 자바스크립트 오류');
    [...new Set(errors)].slice(0, 5).forEach(e => console.log('   ' + e.slice(0, 160)));
    fail += errors.length;
}
console.log(`\n${fail ? '❌' : '✅'} ${pass}개 통과 · ${fail}개 실패`);
process.exitCode = fail ? 1 : 0;
