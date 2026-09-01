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

/* ── 7. 스키마를 아직 다시 안 돌린 저장소 ───────────────────────
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
const MISSING = ['round_groups', 'settle_reminders'];

const oldCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
await oldCtx.route('**/rest/v1/**', async route => {
    const t = new URL(route.request().url()).pathname.split('/rest/v1/')[1]?.split('?')[0];
    // 없는 표에는 진짜 PostgREST처럼 404를 준다.
    if (MISSING.includes(t)) {
        return route.fulfill({ status: 404, contentType: 'application/json',
            body: JSON.stringify({ message: `relation "public.${t}" does not exist` }) });
    }
    return restRoute(oldTables)(route);
});
await oldCtx.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await stubOutside(oldCtx);
await oldCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

const oldPage = await oldCtx.newPage();
for (const [name, hash, must] of [
    ['라운드 상세 (조가 짜여 있던 라운드)', '/#/rounds/r2', '함평엘리체CC'],
    ['라운드 상세 (조를 안 짠 라운드)',   '/#/rounds/r1', '무등산CC'],
    ['총무 정산 현황',                  '/#/settle',    '무등산CC 그린피'],
]) {
    await oldPage.goto(BASE + hash, { waitUntil: 'networkidle' });
    await oldPage.waitForTimeout(700);
    const txt = await oldPage.textContent('.page').catch(() => '');
    ok(txt.includes(must) && !txt.includes('does not exist'),
       `${name} — 그대로 열린다${txt.includes('does not exist') ? ` (${txt.slice(0, 80)})` : ''}`);
}

await browser.close();

if (errors.length) {
    console.log('\n❌ 자바스크립트 오류');
    [...new Set(errors)].slice(0, 5).forEach(e => console.log('   ' + e.slice(0, 160)));
    fail += errors.length;
}
console.log(`\n${fail ? '❌' : '✅'} ${pass}개 통과 · ${fail}개 실패`);
process.exitCode = fail ? 1 : 0;
