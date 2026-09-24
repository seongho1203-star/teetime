/* 눈으로는 안 보이는 **동작**을 확인한다.
 *
 * 스크린샷은 '어떻게 생겼나'만 말해 준다. 여기서 보는 것은 '눌렀을 때 무엇을
 * 보내나' · '쓰기가 몇 번 나가나'처럼 **화면에 안 나타나는 것**이다.
 * 둘 다 조용히 깨져서 한참 뒤에나 들통나는 자리라 숫자로 붙들어 둔다.
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/behave.mjs
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { tables, ME, uid } from './fixtures.mjs';
import { handleRest, restRoute, stubOutside } from './rest.mjs';

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

/* **움직이는 이모티콘을 일부러 늦출 수 있는 문**(아래 `이모티콘` 칸).
   첫 묶음이 3.1MB짜리 `.webp`라 LTE에서는 서랍을 열고 한참을 기다리는데,
   여기서는 몇 ms에 끝나 **고치기 전 코드도 초록으로 뜬다.** 늦춰야 그
   사이가 만들어진다. 평소(0)에는 그냥 지나간다. */
let slowSticker = 0;
await ctx.route('**/stickers/*.webp', async route => {
    if (slowSticker) await new Promise(r => setTimeout(r, slowSticker));
    await route.fallback();
});

await ctx.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await stubOutside(ctx);
await ctx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));

/* **화면이 밀려 들어오는 동안에는 앞(또는 떠나는) 화면 사본이 함께 있다.**
   찍어 둔 죽은 그림이라 눈에는 한 화면으로 보이지만, 글자로 찾으면 같은
   것이 **둘로 잡힌다**(`다시 열기`가 실제로 그랬다 — strict mode violation).
   `page.goto`가 해시만 바꾸면 문서를 새로 안 받고 **뒤로 가기로 잡혀**
   그 사본이 깔린다. 그래서 **움직임이 끝날 때까지 기다린다.** */
const settleScreen = (p) => p.waitForFunction(
    () => !document.querySelector('.back-ghost, .exit-ghost, .exit-dim'),
    null, { timeout: 4000 }).catch(() => {});

const go = async (hash, wait = 500) => {
    await page.goto(BASE + hash, { waitUntil: 'networkidle' });
    await settleScreen(page);
    await page.waitForTimeout(wait);
};

/* 길게 누른 창을 닫는다. **`닫기` 줄이 없다** — 창이 누른 말풍선 옆에
   뜨면서 카톡처럼 바탕을 눌러 닫는 것으로 바뀌었다. 가운데를 누르면
   창 자체가 맞으므로 **왼쪽 위 구석**을 누른다(거기는 늘 바탕이다). */
const shutHold = async (p) => {
    await p.click('.chat-menu-back.soft', { position: { x: 4, y: 4 } });
    await p.waitForTimeout(200);
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

/* ── 2-1. 투표 목록이 길어지지 않는가 ───────────────────────────
 *
 * 사용자 제보 — `투표에서 항목이 많아지거나 투표 진행하는게 많아지면
 * 화면이 너무 길어져`. 100명·1년치로 재 보니 목록이 **화면 4.5장**이었다
 * (`node .dev/scale.mjs 100 --shots`).
 *
 * 두 곳을 접어 절반으로 줄였고, 그 둘을 여기서 붙들어 둔다:
 *  - **진행중 카드는 항목을 다섯까지만 편다**(`OPTIONS_SHOWN`).
 *    나머지는 `항목 N개 더 보기`로 그 자리에서 펴진다 — 목록에서 표를
 *    던지는 것이 이 화면의 핵심이라 상세로 보내지 않는다.
 *  - **마감된 카드는 항목을 아예 안 편다.** 1위 한 줄로 줄인다 — 끝난
 *    투표에서 할 일은 없고 무엇으로 정해졌는지만 궁금하다.
 *
 * **`내가 고른 것이 접힌 자리에 있으면 아예 펴 둔다`도 함께 본다** —
 * 안 그러면 이미 던져 놓고 무엇을 골랐는지 몰라 또 들어가게 된다.
 */
/* ── 2-0. 키보드가 댓글 칸을 가리지 않는가 ──────────────────────
 *
 * 사용자 제보 — `투표와 라운드에서 댓글을 쓰려고 누르면 키보드가 올라오는데
 * 댓글쓰는창이 키보드가 가려서 볼수가없어`.
 *
 * **브라우저는 초점이 갈 때 한 번 굴려 주는데, 화면이 줄어드는 것은 그
 * 뒤다** — 앱은 `resize: 'native'`라 웹뷰가 나중에 줄고(플러그인이 0.45초
 * 늦춘다) 그때 다시 굴려 주지는 않는다. 그래서 누를 때는 보이던 칸이
 * 키보드가 다 올라오고 나면 그 아래로 내려간다. 고치기 전에 재니 댓글
 * 칸이 보이는 화면보다 **165px 아래**에 있었다.
 *
 * **여기서는 창을 줄여 키보드를 흉내 낸다** — 헤드리스에 키보드는 없지만
 * `resize: 'native'`가 하는 일은 그것뿐이라 같은 길을 탄다.
 * `lib/keyboard.ts`의 `reveal`을 빼면 두 줄이 다시 빨갛게 뜬다.
 */
console.log('\n── 키보드가 댓글 칸을 안 가린다 ──');
{
    const KB = 336;   // 아이폰 한글 자판 높이쯤
    for (const [what, route] of [['투표 상세', '/#/polls/p1'], ['라운드 상세', '/#/rounds/r1']]) {
        await page.setViewportSize({ width: 390, height: 844 });
        await go(route, 800);
        const look = () => page.evaluate(() => {
            const t = document.querySelector('.comment-field .textarea').getBoundingClientRect();
            const btn = document.querySelector('.comment-write .btn')?.getBoundingClientRect();
            const H = window.innerHeight;
            return {
                칸: [Math.round(t.top), Math.round(t.bottom)], 창높이: H,
                칸보임: t.top >= 0 && t.bottom <= H,
                등록보임: !btn || (btn.top >= 0 && btn.bottom <= H),
            };
        });
        const ta = await page.$('.comment-field .textarea');
        await ta.scrollIntoViewIfNeeded();
        await ta.click();
        await page.waitForTimeout(80);
        /* **아직 창을 안 줄였다.** 그런데도 칸이 키보드가 설 자리 위로
           올라와 있어야 한다 — 줄어들기를 기다리면 그 0.45초가 그대로
           눈에 보인다(사용자 제보 — `순간 댓글창이 안보여서 뭐지?`). */
        const 먼저 = await look();
        ok(먼저.칸[1] <= 844 - KB,
           `${what} — 창이 줄기 전에 이미 키보드 자리 위로 올라와 있다 (실제 ${JSON.stringify(먼저)})`);

        // 이제 키보드가 다 올라와 웹뷰가 줄어든다.
        await page.setViewportSize({ width: 390, height: 844 - KB });
        await page.waitForTimeout(800);
        const v = await look();
        ok(v.칸보임, `${what} — 댓글 칸이 키보드 위로 올라온다 (실제 ${JSON.stringify(v)})`);
        ok(v.등록보임, `${what} — 옆의 \`등록\`까지 함께 보인다 (실제 ${JSON.stringify(v)})`);
        /* **줄어든 뒤에 또 움직이면 안 된다** — 그 흔들림이 곧 `늦게 뜬다`는
           느낌이다. 미리 굴려 둔 자리가 그대로 답이어야 한다. */
        ok(Math.abs(v.칸[1] - 먼저.칸[1]) <= 2,
           `${what} — 키보드가 다 올라온 뒤에 다시 안 움직인다 (실제 ${먼저.칸[1]} → ${v.칸[1]})`);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    /* **네이티브 바가 떠 있는 동안에는 웹 칸이 안 보여야 한다**
       (사용자 제보 — `댓글쓰는데가 2군데야`). 헤드리스에는 그 바가
       없으므로 표시(`nc-typing`)만 손으로 붙여 규칙 자체를 잰다.
       **자리는 그대로 있어야 한다** — 지워 버리면 읽던 글이 밀리고
       `openBar`가 끌어 올릴 자리도 함께 사라진다. */
    const twin = await page.evaluate(() => {
        const el = document.querySelector('.comment-form');
        const before = { h: el.offsetHeight, vis: getComputedStyle(el).visibility };
        document.body.classList.add('nc-typing');
        const during = { h: el.offsetHeight, vis: getComputedStyle(el).visibility };
        document.body.classList.remove('nc-typing');
        const after = getComputedStyle(el).visibility;
        return { before, during, after };
    });
    ok(twin.before.vis === 'visible' && twin.during.vis === 'hidden',
       `바가 떠 있으면 웹 댓글 칸이 안 보인다 (${twin.before.vis} → ${twin.during.vis})`);
    ok(twin.during.h === twin.before.h,
       `그래도 자리는 그대로 차지한다 (${twin.before.h}px → ${twin.during.h}px)`);
    ok(twin.after === 'visible', '바를 닫으면 도로 보인다');

    /* **화면을 옮기면 탭바를 감추던 표시가 걷혀야 한다**(사용자 제보 —
       `뒤로가기하면 가끔 탭바가 사라지는 경우가있어`).
       글칸에 초점을 둔 채 뒤로 가면 탭바가 사라진 채로 굳었다 — 웹킷은
       초점이 있던 요소가 화면에서 사라질 때 `focusout`을 안 보내 주고,
       걷는 효과는 `[onChat]`으로 걸려 있어 폼 화면끼리 오갈 때는 아예
       다시 돌지 않았다. 감추는 표시가 넷이라 한 곳씩 챙기지 않고
       **화면이 바뀌면 넷을 통째로 걷는다.**
       헤드리스에는 키보드가 없으므로 그 표시들을 손으로 붙여 규칙을 잰다.

       **`kb-typing`은 고치기 전 코드로도 초록으로 뜬다** — 크로미움은
       사라진 요소에 `focusout`을 보내 주므로 옛 길(`mark(false)`)이 그때
       돌아 준다. **폰에서 나던 그 자국이 여기서는 안 보인다**는 뜻이니,
       이 줄이 초록이라고 그 자리가 멀쩡한 것으로 읽지 말 것(깜빡임에서
       얻은 교훈 그대로다). 나머지 셋은 빼면 그대로 빨개진다. */
    const stuck = ['kb-typing', 'nc-typing', 'kb-open', 'kb-bar'];
    for (const cls of stuck) {
        await go('/#/rounds/r1', 500);
        await page.evaluate(c => document.body.classList.add(c), cls);
        const gone = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.tabbar')).display === 'none');
        await go('/#/', 600);
        const back = await page.evaluate(c => ({
            표: document.body.classList.contains(c),
            탭바: document.querySelector('.tabbar')
                ? getComputedStyle(document.querySelector('.tabbar')).display : '없음',
        }), cls);
        ok(gone && !back.표 && back.탭바 !== 'none',
           `\`${cls}\`가 남아 있어도 뒤로 가면 탭바가 돌아온다 (${JSON.stringify(back)})`);
    }

    /* **`focusout`이 아예 안 와도 걷힌다**(사용자 제보 — `정산에서 계좌나
       금액을 입력하고 홈으로 되돌아오면 탭바가 사라지는 오류가있어`).
       위 줄이 막아 주는 것은 **길이 바뀌는** 자리뿐인데, 폼이 접히는 것은
       같은 길에서 일어난다 — 아이폰은 단추가 초점을 안 가져가므로 글칸이
       초점을 쥔 채로 사라지고, 웹킷은 그때 `focusout`을 안 준다.
       여기서는 **`focusout`을 통째로 막아** 그 상태를 그대로 만든다.
       0.4초마다 다시 재는 줄을 빼면 이 칸이 빨개진다. */
    await go('/#/rounds/r1', 600);
    await page.evaluate(() => {
        window.__noFocusOut = e => e.stopImmediatePropagation();
        window.addEventListener('focusout', window.__noFocusOut, true);
    });
    await page.getByRole('button', { name: '＋ 정산' }).click();
    await page.waitForTimeout(400);
    await page.click('#s-total');
    await page.waitForTimeout(200);
    const typing = await page.evaluate(() => ({
        표: document.body.classList.contains('kb-typing'),
        탭바: getComputedStyle(document.querySelector('.tabbar')).display,
    }));
    await page.getByRole('button', { name: '닫기', exact: true }).first().click();
    await page.waitForTimeout(1000);
    const closed = await page.evaluate(() => ({
        표: document.body.classList.contains('kb-typing'),
        탭바: getComputedStyle(document.querySelector('.tabbar')).display,
        빈자리: document.body.style.getPropertyValue('--kb-pad'),
    }));
    await page.evaluate(() => window.removeEventListener('focusout', window.__noFocusOut, true));
    ok(typing.표 && typing.탭바 === 'none',
       `정산 칸을 누르면 탭바가 감춰진다 (${JSON.stringify(typing)})`);
    ok(!closed.표 && closed.탭바 !== 'none' && !closed.빈자리,
       `폼이 접히면 \`focusout\`이 안 와도 탭바가 돌아온다 (${JSON.stringify(closed)})`);
}

console.log('\n── 투표 목록이 길어지지 않는다 ──');
await go('/#/polls', 700);
{
    const v = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.poll-card')];
        const live = cards.find(c => !c.classList.contains('closed'));
        const done = cards.find(c => c.classList.contains('closed'));
        return {
            편항목: live.querySelectorAll('.poll-option').length,
            더보기: live.querySelector('.poll-more')?.textContent ?? null,
            마감항목: done.querySelectorAll('.poll-option').length,
            마감1위: done.querySelector('.poll-won')?.textContent ?? null,
            /* 표가 있는 마감 투표는 **무엇이 1위였는지**까지 적어야 한다 —
               표가 하나도 없는 것(p3)만 보면 그 줄이 늘 빈 채로 지나간다. */
            이긴것: cards.filter(c => c.classList.contains('closed'))
                .map(c => c.querySelector('.poll-won')?.textContent)
                .find(t => t?.includes('1위')) ?? null,
            높이: document.documentElement.scrollHeight,
        };
    });
    ok(v.편항목 === 5, `진행중 카드는 항목을 다섯까지만 편다 (실제 ${v.편항목}개)`);
    ok(v.더보기 === '항목 2개 더 보기',
       `나머지는 몇 개인지 적어 접는다 (실제 ${JSON.stringify(v.더보기)})`);
    ok(v.마감항목 === 0, `마감된 카드는 항목을 아예 안 편다 (실제 ${v.마감항목}개)`);
    ok(!!v.마감1위, `대신 1위 한 줄을 적는다 (실제 ${JSON.stringify(v.마감1위)})`);
    ok(!!v.이긴것 && v.이긴것.includes('제주'),
       `표가 있으면 무엇이 1위였는지 적는다 (실제 ${JSON.stringify(v.이긴것)})`);

    await page.click('.poll-more');
    await page.waitForTimeout(200);
    const after = await page.$$eval('.poll-card:not(.closed) .poll-option', e => e.length);
    ok(after === 7, `누르면 그 자리에서 다 펴진다 — 상세로 안 보낸다 (실제 ${after}개)`);

    /* **내가 고른 것이 접힌 자리에 있으면 처음부터 펴져 있다.**
       마지막 항목(o9)에 표를 던져 놓고 다시 들어와 본다. */
    await page.click('.poll-card:not(.closed) .poll-option:last-of-type');
    await page.waitForTimeout(400);
    await go('/#/polls', 700);
    const kept = await page.evaluate(() => ({
        편항목: document.querySelectorAll('.poll-card:not(.closed) .poll-option').length,
        더보기: !!document.querySelector('.poll-more'),
    }));
    ok(kept.편항목 === 7 && !kept.더보기,
       `내가 고른 것이 접힌 자리에 있으면 아예 펴 둔다 (실제 ${JSON.stringify(kept)})`);
}

/* **마감 시각만 빨강이다**(사용자 요청). 클래스 이름만 보면 CSS가
   뒤집혀도 초록으로 뜨므로 **칠을 잰다.** 곁의 `0명 참여`와 `마감` 단추가
   함께 빨개지지 않았는지도 같이 본다 — 그것이 이 고침의 경계다.
   목록과 상세가 같은 클래스를 쓰므로 둘 다 잰다. */
console.log('\n── 투표 마감 시각은 빨강이다 ──');
{
    const RED = 'rgb(226, 64, 42)';
    await go('/#/polls', 700);
    const v = await page.evaluate(() => {
        const card = document.querySelector('.poll-card:not(.closed)');
        const at = card?.querySelector('.poll-close-at');
        const foot = card?.querySelector('.poll-foot .grow');
        const badge = card?.querySelector('.badge.live');
        const btn = [...(card?.querySelectorAll('.poll-foot button') ?? [])]
            .find(b => b.textContent.trim() === '마감');
        const c = el => (el ? getComputedStyle(el).color : null);
        return { 글: at?.textContent ?? null, 시각: c(at), 참여줄: c(foot), 상태표: c(badge), 단추: c(btn) };
    });
    ok(!!v.글 && v.글.includes('마감'), `목록 카드에 마감 시각이 있다 (실제 ${JSON.stringify(v.글)})`);
    ok(v.시각 === RED, `그 줄만 빨강이다 (실제 ${v.시각})`);
    ok(v.참여줄 !== RED, `곁의 \`N명 참여\`는 그대로다 (실제 ${v.참여줄})`);
    ok(v.상태표 !== RED, `\`진행중\` 상태표에 안 번진다 (실제 ${v.상태표})`);
    ok(v.단추 !== RED, `\`마감\` 단추에 안 번진다 (실제 ${v.단추})`);

    await go('/#/polls/p1', 700);
    const d = await page.evaluate(() => {
        const at = document.querySelector('.poll-close-at');
        return { 글: at?.textContent ?? null, 시각: at ? getComputedStyle(at).color : null };
    });
    ok(!!d.글 && d.시각 === RED,
       `상세도 같은 빨강이다 (실제 ${JSON.stringify(d)})`);
}

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

/* ── 6-0. 정산 — `그 외`도 명단을 보고 고른다 ────────────────────
 *
 * 사용자 요청 — `다른 사람 추가할 때 … 언급처럼 회원 목록이 보이고
 * 거기에서 다중 선택할 수 있게 … 일일이 한 명씩 찾으려면 힘들잖아`.
 * 예전에는 열둘(`FIND_AT`)을 넘으면 **검색칸만 두고 목록을 통째로
 * 감췄다** — 이름을 아는 사람만 넣을 수 있었다. 지금은 늘 늘어놓고
 * **굴러가는 칸(`.settle-pick.tall`)에 담아** 높이만 잡는다.
 *
 * **고정 자료는 회원이 아홉이라 그 갈래를 통째로 지나친다** — 여기서만
 * 열다섯을 더 넣어 띄우고, 끝나면 도로 걷는다.
 * **클래스 이름만 보면 감춰 놓아도 초록으로 뜨므로 개수와 높이를 잰다.**
 */
console.log('\n── 정산 — 그 외 명단 ──');
{
    const when = new Date(Date.now() - 86400000 * 20).toISOString();
    const extra = Array.from({ length: 15 }, (_, i) => ({
        id: uid(40 + i), name: `손님${i}`, avatar_url: null, role: 'member',
        joined_at: when, memo: '', region: '광산구', gender: 'm',
        birth_year: 1990, created_at: when,
    }));
    tables.profiles.push(...extra);

    const sCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await sCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(sCtx);
    await sCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const sp = await sCtx.newPage();
    await sp.goto(BASE + '/#/rounds/r1', { waitUntil: 'networkidle' });
    await sp.waitForTimeout(700);
    await sp.getByRole('button', { name: '＋ 정산' }).click();
    await sp.waitForTimeout(400);
    await sp.click('.settle-more');
    await sp.waitForTimeout(300);

    const box = await sp.evaluate(() => {
        const tall = document.querySelector('.settle-pick.tall');
        if (!tall) return null;
        return {
            알약: tall.querySelectorAll('.settle-pill').length,
            높이: Math.round(tall.getBoundingClientRect().height),
            굴림: tall.scrollHeight > tall.clientHeight + 4,
            찾기: !!document.querySelector('.settle-find input'),
        };
    });
    ok(box && box.알약 >= 15,
       `찾기 전에도 \`그 외\` 명단이 다 보인다 (실제 ${box?.알약 ?? '칸이 없음'}명)`);
    ok(box && box.높이 <= 210,
       `그래도 화면을 안 먹는다 — 굴러가는 칸이다 (실제 ${box?.높이}px)`);
    ok(box && box.굴림, '넘치는 만큼은 굴려서 본다');
    ok(box && box.찾기,
       '찾기 칸은 거르개로 남는다 — 이름을 아는 사람에게는 그게 빠르다');

    /* **눌러서 여럿 고르고, 다시 누르면 빠진다.** */
    const pills = await sp.$$('.settle-pick.tall .settle-pill');
    await pills[0].click();
    await pills[1].click();
    await sp.waitForTimeout(200);
    const on2 = await sp.$$eval('.settle-pick.tall .settle-pill.on', e => e.length);
    ok(on2 === 2, `목록에서 여럿을 고를 수 있다 (실제 ${on2}명)`);
    await pills[0].click();
    await sp.waitForTimeout(200);
    const on1 = await sp.$$eval('.settle-pick.tall .settle-pill.on', e => e.length);
    ok(on1 === 1, `고른 것을 다시 누르면 빠진다 (실제 ${on1}명)`);

    /* 찾기 칸은 **거르개**다 — 치면 그 사람만 남는다(고른 사람은 그대로). */
    await sp.fill('.settle-find input', '손님7');
    await sp.waitForTimeout(400);
    const few = await sp.$$eval('.settle-pick.tall .settle-pill', e => e.length);
    ok(few > 0 && few < box.알약, `이름을 치면 그만큼 좁혀진다 (실제 ${few}명)`);

    await sCtx.close();
    tables.profiles.splice(tables.profiles.length - extra.length, extra.length);
}

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
/* 게임비는 **금액 칸**이라 보이는 값에 쉼표가 붙는다(`25,000`).
   값 자체는 숫자만 든 글자이고 쉼표는 보여 줄 때만 붙이므로, 저장되는
   것은 예나 지금이나 `25000`이다 — 아래 `금액은 100,000원으로 보인다` 참고. */
ok(await page.inputValue('#f-cap') === '6' && await page.inputValue('#f-fee') === '25,000',
   `정원·게임비도 함께 온다 (실제 ${JSON.stringify(await page.inputValue('#f-fee'))})`);
/* 티오프 칸은 이제 **누르면 달력이 펴지는 단추**다(`components/DateTimeField`).
   진짜 입력칸이 아니라 값은 `data-value`에 실려 있다. */
ok(await page.getAttribute('#f-tee', 'data-value') === '',
   `시각만 비어 있다 (실제 ${JSON.stringify(await page.getAttribute('#f-tee', 'data-value'))})`);
ok((await page.textContent('.form-actions') ?? '').includes('모집 열기'),
   '단추가 `수정 저장`이 아니라 `모집 열기`다 — 원본을 안 건드린다');

/* ── 6-1-0. 금액은 100,000원으로 보인다 ─────────────────────────
 *
 * 사용자 요청 — `금액 입력부분을 100,000원 이런식으로 표현되게해줘`.
 * 쓰는 곳이 셋이고(`components/WonField.tsx`) 규칙이 셋이다:
 * **보여 줄 때만 쉼표를 붙이고**(값은 숫자만 든 글자다) · **`원`은 칸
 * 안에 서되 값이 아니고** · **가운데에 끼워 넣어도 커서가 안 튄다.**
 * 클래스 이름만 보면 다 초록으로 뜨는 자리라 **값과 자리를 잰다.**
 */
console.log('\n── 금액은 100,000원으로 보인다 ──');
await go('/#/rounds/new', 600);
await page.fill('#f-fee', '');
await page.type('#f-fee', '100000', { delay: 15 });
ok(await page.inputValue('#f-fee') === '100,000',
   `그린피 칸이 100,000 (실제 ${JSON.stringify(await page.inputValue('#f-fee'))})`);
const wonLook = await page.evaluate(() => {
    const el = document.querySelector('#f-fee');
    const mark = el.parentElement.querySelector('.won-mark');
    if (!mark) return null;
    const eb = el.getBoundingClientRect(), mb = mark.getBoundingClientRect();
    return {
        text: mark.textContent,
        inside: mb.right <= eb.right + 0.5 && mb.left > eb.left,
        align: getComputedStyle(el).textAlign,
    };
});
ok(wonLook?.text === '원' && wonLook.inside && wonLook.align === 'right',
   `\`원\`이 칸 안 오른쪽에 서고 숫자가 그 옆에 붙는다 (실제 ${JSON.stringify(wonLook)})`);
/* **앞의 0을 떼지 않으면 `0100,000`이 된다.** */
await page.fill('#f-fee', '');
await page.type('#f-fee', '05', { delay: 15 });
ok(await page.inputValue('#f-fee') === '5',
   `0 뒤에 5를 치면 5 (실제 ${JSON.stringify(await page.inputValue('#f-fee'))})`);
/* **커서를 글자 수로 세면 쉼표가 늘 때마다 한 칸씩 밀린다.**
   `1|23,456` 자리에서 `9`를 치면 `1,9|23,456`이라야 한다. */
await page.fill('#f-fee', '');
await page.type('#f-fee', '123456', { delay: 15 });
await page.evaluate(() => document.querySelector('#f-fee').setSelectionRange(1, 1));
await page.keyboard.type('9');
const caretAt = await page.evaluate(() => ({
    v: document.querySelector('#f-fee').value,
    at: document.querySelector('#f-fee').selectionStart,
}));
ok(caretAt.v === '1,923,456' && caretAt.at === 3,
   `가운데에 끼워 넣어도 커서가 제자리다 (실제 ${JSON.stringify(caretAt)})`);

/* 정산도 같은 칸을 쓴다 — 총금액과 1/N 몫 둘 다. */
await go('/#/rounds/r1', 700);
await page.getByRole('button', { name: '＋ 정산' }).click();
await page.waitForTimeout(400);
await page.type('#s-total', '240000', { delay: 15 });
ok(await page.inputValue('#s-total') === '240,000',
   `정산 총금액도 240,000 (실제 ${JSON.stringify(await page.inputValue('#s-total'))})`);
const allIn = page.getByRole('button', { name: '모두 넣기' });
if (await allIn.count()) { await allIn.first().click(); await page.waitForTimeout(400); }
const shareShown = await page.$$eval('.settle-row .won-field input', e => e.map(x => x.value));
ok(shareShown.length > 0 && shareShown.every(v => /^\d{1,3}(,\d{3})*$/.test(v)),
   `1/N 몫에도 쉼표가 붙는다 (실제 ${JSON.stringify(shareShown)})`);

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

/* ── 6-1-1-2. 공지를 대화방에 공유 ──────────────────────────────
 *
 * 사용자 요청 — `공지도 대화창 공유 기능 만들어 줘`. 공지를 올리면
 * `📢 새 공지`가 한 번 나가고 끝이라, 그 알림을 놓치면 공지 탭에 들어가
 * 보기 전까지 모른다. **라운드 공유와 완전히 같은 짜임이다** — 한쪽만
 * 고치면 두 단추가 다르게 굴러간다.
 */
console.log('\n── 공지를 대화방에 공유 ──');
await go('/#/board/b1', 700);
ok((await page.textContent('.page') ?? '').includes('대화방에 공유'),
   '공지 상세에 공유 단추가 있다');

writes.length = 0;
await page.getByText('📣 대화방에 공유').click();
await page.getByText('올리기', { exact: true }).click();
await page.waitForTimeout(600);
const shared = writes.find(([w]) => w === 'messages POST')?.[1];
ok(shared?.post_id === 'b1' && shared?.system === true,
   `그 공지를 단 안내 글로 들어간다 (실제 ${JSON.stringify(shared)})`);
ok(String(shared?.body ?? '').startsWith('신성호님이 공지를 공유했습니다\n9월 회비 안내'),
   `머리말 다음 줄이 제목이다 (실제 ${JSON.stringify(shared?.body?.split('\n').slice(0, 2))})`);
/* **본문은 첫 줄만 붙인다.** 긴 공지를 통째로 옮기면 그 카드가 대화방을
   덮는데, 어차피 눌러서 읽는 자리다. 고정 자료의 b1은 본문이 네 줄이다. */
ok(String(shared?.body ?? '').split('\n').length === 3,
   `본문은 첫 줄만 곁줄로 붙는다 (실제 ${String(shared?.body ?? '').split('\n').length}줄)`);
ok(shared?.notify === true,
   `사람이 올린 공유에는 알림 표가 선다 (실제 ${JSON.stringify(shared?.notify)})`);

/* 칸이 없는 저장소에서도 올라간다 — 라운드에서 겪은 그 자리다
   (`schema.sql`이 앱보다 늦게 올라가는 사이가 있다). */
missingColumns = ['notify', 'post_id'];
await go('/#/board/b1', 700);
writes.length = 0;
await page.getByText('📣 대화방에 공유').click();
await page.getByText('올리기', { exact: true }).click();
await page.waitForTimeout(800);
const postTries = writes.filter(([w]) => w === 'messages POST').map(([, v]) => v);
ok(postTries.length === 3 && !('notify' in (postTries[2] ?? {})) && !('post_id' in (postTries[2] ?? {})),
   `둘 다 없으면 하나씩 빼며 세 번째에 들어간다 (실제 ${postTries.length}번)`);
ok((await page.textContent('body') ?? '').includes('대화방에 올렸습니다'),
   '`post_id`가 없는 저장소에서도 공유가 통째로 실패하지 않는다');
missingColumns = [];

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
/* **공지 공유도 같은 카드다**(사용자 요청 — 라운드에 있던 그 단추를 공지에도).
   눌러서 그 공지로 바로 들어가야 대화방에 올리는 뜻이 산다. */
ok(chatCards.some(h => h?.includes('/board/b1')),
   `공지 공유도 눌리는 카드다 (실제 ${JSON.stringify(chatCards)})`);
/* 갈 곳에 맞는 말이 붙는가 — 라운드 카드에 `투표 보러 가기`가 붙으면
   눌러 놓고 딴 데로 간 줄 안다. */
const goes = await page.$$eval('.chat-result', e => e.map(x => [
    x.getAttribute('href'), x.querySelector('.chat-result-go')?.textContent]));
const wordFor = h => h?.includes('/rounds/') ? '라운드'
    : h?.includes('/polls/') ? '투표' : '공지';
ok(goes.every(([h, g]) => g?.includes(wordFor(h))),
   `카드마다 갈 곳에 맞는 말이 붙는다 (실제 ${JSON.stringify(goes)})`);
/* **머리에 그림 배지가 선다**(사용자 요청 — `공유될 때 나오는 창을 예쁘게
   바꿔줘`). 셋이 똑같이 생겨 글을 읽어야 무엇인지 알았다.
   **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다.
   클래스 이름만 보면 CSS가 뒤집혀도 초록으로 뜨므로 **값을 잰다.** */
const cardLook = await page.evaluate(() => {
    const c = document.querySelector('.chat-result');
    if (!c) return null;
    const icon = c.querySelector('.chat-result-icon');
    const cs = getComputedStyle(c);
    return {
        배지: icon ? Math.round(icon.getBoundingClientRect().width) : 0,
        그림: !!icon?.querySelector('svg'),
        모서리: parseFloat(cs.borderTopLeftRadius),
        테두리: parseFloat(cs.borderTopWidth),
        그림자: cs.boxShadow !== 'none',
    };
});
ok(cardLook && cardLook.배지 >= 24 && cardLook.그림,
   `카드 머리에 선 SVG 배지가 선다 (실제 ${JSON.stringify(cardLook)})`);
ok(cardLook && cardLook.모서리 >= 13 && cardLook.테두리 === 0 && cardLook.그림자,
   `테두리 대신 그림자 · 통통한 모서리 (실제 ${JSON.stringify(cardLook)})`);
/* **사용자가 올린 그림의 짜임인가**(`채팅창 공유팝업을 내가 올린 사진형태로
   바꿔줘`). 라운드 공유 카드에서 곳 이름은 **알약**, 날짜는 **큰 제목**,
   시각·정원·자리는 **그림 붙은 칩**이고 `○○님이 …했습니다`는 **맨 아래**다.
   **클래스 이름만 보면 배정이 뒤집혀도 초록으로 뜨므로 글자와 자리를 잰다.** */
const shareCard = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.chat-result')]
        .find(x => x.getAttribute('href')?.includes('/rounds/r4'));
    if (!c) return null;
    const box = el => el?.getBoundingClientRect();
    const title = c.querySelector('.chat-result-title');
    const foot = c.querySelector('.chat-result-by');
    const chips = [...c.querySelectorAll('.chat-result-chip')];
    return {
        알약: c.querySelector('.chat-result-pill')?.textContent ?? null,
        제목: title?.textContent ?? null,
        칩: chips.map(x => x.textContent),
        그림달린칩: chips.filter(x => x.querySelector('svg')).length,
        아래글: foot?.textContent ?? null,
        // 아래글이 제목보다 밑에 있는가(그림의 그 차례다).
        아래인가: !!foot && !!title && box(foot).top > box(title).bottom,
        // 단추가 꽉 찬 알약인가(그림처럼) — 투명이면 예전 글자 링크다.
        단추칠: getComputedStyle(c.querySelector('.chat-result-go')).backgroundColor,
    };
});
ok(shareCard && shareCard.알약 === '골프존파크 상무점'
    && shareCard.제목 === '9월 8일 (화)',
   `곳 이름은 알약 · 날짜가 큰 제목 (실제 ${JSON.stringify(shareCard)})`);
ok(shareCard && shareCard.칩.length === 3 && shareCard.그림달린칩 === 3,
   `시각·정원·자리가 그림 붙은 칩이 된다 (실제 ${JSON.stringify(shareCard?.칩)})`);
ok(shareCard && shareCard.아래인가
    && shareCard.아래글 === '신성호님이 스크린을 공유했습니다',
   `\`○○님이 …했습니다\`는 맨 아래 줄이다 (실제 ${JSON.stringify(shareCard)})`);
ok(shareCard && !/rgba\(0, 0, 0, 0\)|transparent/.test(shareCard.단추칠),
   `\`보러 가기\`가 꽉 찬 알약 단추다 (실제 ${shareCard?.단추칠})`);
/* **카드 폭은 글 길이와 상관없이 늘 같다** — 앱 목록의 `cardWidth()`
   (목록 폭 − 36 · 320 중 작은 쪽)와 같은 셈이다. 한동안 `fit-content`라
   글이 짧은 카드만 좁아져 아랫줄이 두 줄로 접혔고, 뒤로 끌어 대화방으로
   돌아오는 동안(웹 카드를 찍은 그림)만 모양이 바뀌었다 돌아왔다
   (사용자 제보 · 사진 두 장). 클래스 이름만 보면 안 잡히므로 **값을 잰다.** */
const cardWidths = await page.evaluate(() => {
    const list = document.querySelector('.chat-list');
    const cs = list && getComputedStyle(list);
    const inner = list ? list.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : 0;
    return {
        기대: Math.round(Math.min(inner - 18, 320)),
        폭: [...document.querySelectorAll('.chat-result')]
            .map(x => Math.round(x.getBoundingClientRect().width)),
    };
});
ok(cardWidths.폭.length >= 3
    && cardWidths.폭.every(w => Math.abs(w - cardWidths.기대) <= 1),
   `카드 폭이 글 길이와 상관없이 앱 목록과 같다 (실제 ${JSON.stringify(cardWidths)})`);
/* **투표·공지는 줄 수를 안 센다** — 둘째 줄이 제목이고 나머지는 있는 대로
   곁줄이다. 라운드 규칙(알약)을 여기까지 끌고 오면 **공지의 본문 첫 줄이
   제목 자리에 앉는다**(실제로 그렇게 짜 봤다가 갈아엎은 자리다). */
const postCard = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.chat-result')]
        .find(x => x.getAttribute('href')?.includes('/board/b1'));
    return c && {
        알약: !!c.querySelector('.chat-result-pill'),
        제목: c.querySelector('.chat-result-title')?.textContent,
        곁줄: c.querySelector('.chat-result-note')?.textContent,
    };
});
ok(postCard && !postCard.알약 && postCard.제목 === '9월 회비 안내'
    && (postCard.곁줄 ?? '').startsWith('9월 회비는'),
   `공지 카드는 제목이 크고 본문이 곁줄이다 (실제 ${JSON.stringify(postCard)})`);
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
ok(stickerShots.length === 5 && stickerShots.every(s => s?.includes('/stickers/')),
   `보낸 이모티콘은 그림으로 그려진다 (실제 ${JSON.stringify(stickerShots)})`);
ok((await page.$$eval('.chat-bubble', e => e.map(x => x.textContent))).every(t => t?.trim()),
   '글 없이 보낸 이모티콘에는 빈 말풍선이 안 붙는다');
/* 글을 함께 보낸 것은 **그림 아래 한 줄**로 붙는다(사진과 같은 자리). */
ok(await page.$('.chat-sticker') !== null
   && (await page.textContent('.chat-list'))?.includes('내일 봬요!'),
   '이모티콘에 함께 적은 글이 그림 아래에 붙는다');

/* 서랍은 **닫힌 채로 시작한다** — 열려 있으면 대화가 반쯤 가린 채 열린다. */
ok(await page.$('.sticker-tray') === null, '이모티콘 서랍은 닫힌 채로 시작한다');

/* **움직이는 판이 오기 전에도 빈 칸이 없어야 한다**(사용자 제보 —
   `이모티콘을 누르면 바로 안뜨고 골프공이나 다른걸 누른후에 떠`).
   첫 묶음은 통째로 움직이는 `.webp`라 3.1MB인데, 그동안 칸만 그려지고
   그림은 빈 네모였다. `TrayImg`가 함께 있는 `<id>.png`(다 합쳐 1.4MB)를
   칸의 바탕으로 먼저 깔아 둔다. **늦춰 놓고 재지 않으면 여기서는 몇 ms에
   다 받아져 고치기 전 코드도 초록으로 뜬다.** */
slowSticker = 2500;
await page.click('[aria-label="이모티콘"]');
await page.waitForTimeout(400);
const trayCount = await page.$$eval('.sticker-btn', e => e.length);
ok(trayCount > 0, `서랍을 열면 첫 묶음의 이모티콘이 늘어선다 (실제 ${trayCount}장)`);

const early = await page.$$eval('.sticker-btn img', e => ({
    칸: e.length,
    /* 멈춘 그림이 깔렸거나(아직 안 온 것) 이미 움직이는 판이 온 것 —
       **둘 중 하나여야 빈 칸이 아니다.** */
    찬칸: e.filter(x => getComputedStyle(x).backgroundImage.includes('.png')
                     || (x.complete && x.naturalWidth > 0)).length,
    /* **첫 칸을 그냥 집지 말 것** — 대화에 이미 올라와 있는 이모티콘은
       미리 받아 둔 것이라 곧바로 움직이는 판이 와서 바탕이 걷혀 있다.
       아직 깔려 있는 칸을 골라야 그 파일을 확인할 수 있다. */
    still: (e.map(x => getComputedStyle(x).backgroundImage)
             .find(b => b.includes('.png')) ?? '').replace(/^url\("?|"?\)$/g, ''),
}));
ok(early.칸 > 0 && early.찬칸 === early.칸,
   `움직이는 판이 오기 전에도 빈 칸이 없다 (실제 ${early.찬칸}/${early.칸})`);
/* 주소만 적어 두고 **그 파일이 없으면** 아무것도 안 보인다 — 실제로 받아
   지는지까지 본다(움직이는 것에는 `<id>.png`가 늘 함께 있다). */
const stillOk = early.still.endsWith('.png')
    && await page.evaluate(u => fetch(u).then(r => r.ok, () => false), early.still);
ok(stillOk, `깔아 둔 멈춘 그림이 진짜로 받아진다 (${early.still.split('/').pop()})`);

/* 움직이는 판이 오면 **바탕을 반드시 걷는다** — 우리 이모티콘은 배경이
   투명이라, 안 걷으면 움직이는 그림 뒤로 멈춘 그림이 비쳐 두 겹이 된다. */
await page.waitForTimeout(2600);
slowSticker = 0;
const late = await page.$$eval('.sticker-btn img', e =>
    e.filter(x => getComputedStyle(x).backgroundImage !== 'none').length);
ok(late === 0, `움직이는 판이 오면 깔아 둔 그림을 걷는다 (남은 ${late}장)`);

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
    /* **장수로 견주지 말 것** — 묶음 둘이 우연히 같은 장수일 수 있다(`프렌즈
       감정`·`프렌즈 일상`이 둘 다 열둘이라 실제로 그래서 헛돌았다).
       그려진 그림의 주소를 본다. */
    const shown = () => page.$$eval('.sticker-btn img', e => e.map(i => i.getAttribute('src')));
    const first = await shown();
    await page.click('.sticker-tab:nth-child(2)');
    await page.waitForTimeout(300);
    const moved = await shown();
    ok(moved.length > 0 && !moved.some(s => first.includes(s)),
       `탭을 옮기면 그 묶음만 보인다 (실제 ${first.length}장 → ${moved.length}장 · 겹침 ${moved.filter(s => first.includes(s)).length})`);
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
ok(chatText.includes('가려진 메시지입니다'),
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
ok(!menuOther.includes('삭제'), '남의 글에는 삭제가 안 나온다 — 되돌릴 수 없는 일이다');
await page.click('.chat-menu-item:text-is("가리기")');
await page.waitForTimeout(300);
ok(await page.$('.confirm-box') !== null, '가리기를 고르면 한 번 더 묻는다');
/* **확인창이 떠 있다는 표가 뿌리에 선다**(`html.confirm-up` · `lib/overlay.ts`).
   앱에서 대화 목록과 입력칸은 웹뷰 **위에 얹힌 앱 부품**이라 이 창이 그
   뒤에 통째로 깔린다 — `가리기`·`삭제`가 **눌러도 아무 일이 없어 보이던**
   자리가 그것이다(사용자 제보). 대화 화면이 이 값을 `overlayUp`에 얹어
   앱 부품을 물린다. **헤드리스에 앱 부품은 없지만 표가 서는지는 그대로
   잡힌다** — 그 줄을 빼면 여기가 빨갛게 뜬다. */
ok(await page.evaluate(() => document.documentElement.classList.contains('confirm-up')),
   '확인창이 뜨면 앱 부품을 물리라는 표가 선다 — 안 그러면 창이 그 뒤에 깔린다');
await page.click('.confirm-actions .btn:not(.ghost)');
await page.waitForTimeout(400);
const patched = writes.filter(([w]) => w === 'messages PATCH').map(([, v]) => v);
ok(patched.length === before + 1 && !!patched.at(-1)?.hidden_at,
   `가리기를 누르면 hidden_at을 세워 보낸다 (실제 ${JSON.stringify(patched.at(-1))})`);
ok((await page.textContent('[data-mid="m5"]') ?? '').includes('가려진 메시지입니다'),
   '가리면 그 자리에서 바로 덮인다 — 다시 들어와 볼 일이 없다');
/* **가린 글은 날짜 칸처럼 가운데 한 줄이다**(사용자 요청 — `가릴때
   누가썼는지 모르게 프로필도 없애고 … 가운데로 표시해줘`).
   얼굴·이름·시각·안 읽은 수가 통째로 빠지고 안내 줄과 같은 칩이 된다 —
   **누가 썼는지를 지우는 것이 이 줄의 뜻**이라 옆에 얼굴이 남으면 안 된다.
   **클래스 이름만 보면 CSS가 뒤집혀도 초록으로 뜨므로 자리와 값을 잰다.** */
const hidBox = await page.evaluate(() => {
    const row = document.querySelector('[data-mid="m5"] .chat-row');
    const el = document.querySelector('[data-mid="m5"] .chat-hidden');
    if (!el || !row) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const list = document.querySelector('.chat-list').getBoundingClientRect();
    const day = document.querySelector('.chat-day');
    return {
        말풍선: el.classList.contains('chat-bubble'),
        칠: cs.backgroundColor,
        얼굴: !!row.querySelector('.chat-face, .chat-avatar'),
        이름: !!row.querySelector('.chat-who'),
        시각: !!row.querySelector('.chat-stamp, .chat-time'),
        치우침: Math.round(Math.abs((r.left + r.right) / 2 - (list.left + list.right) / 2)),
        날짜칠: day ? getComputedStyle(day).backgroundColor : null,
    };
});
ok(hidBox && !hidBox.말풍선, '가린 글에는 말풍선을 안 두른다');
ok(hidBox && !hidBox.얼굴 && !hidBox.이름,
   `얼굴도 이름도 안 붙는다 — 누가 썼는지를 지우는 줄이다 (실제 얼굴 ${hidBox?.얼굴} · 이름 ${hidBox?.이름})`);
ok(hidBox && !hidBox.시각, '시각·안 읽은 수도 안 붙는다');
ok(hidBox && hidBox.치우침 <= 2,
   `목록 가운데에 선다 (실제 ${hidBox?.치우침}px 치우침)`);
ok(hidBox && hidBox.칠 === hidBox.날짜칠,
   `날짜 칸과 같은 칩이다 (실제 ${hidBox?.칠} · 날짜 ${hidBox?.날짜칠})`);
ok(!await page.evaluate(() => document.documentElement.classList.contains('confirm-up')),
   '닫으면 그 표가 걷힌다 — 남겨 두면 입력칸이 영영 안 돌아온다');

/* **네이티브 바가 아래를 덮고 있으면 토스트가 머리말 자리로 올라간다**
   (`components/Toast.css`). 화면 아래는 앱 목록과 네이티브 바가 덮는
   자리라 거기 두면 `복사했습니다`·`가렸습니다`가 **한 줄도
   안 보인다** — 웹의 `z-index`로는 앱 부품을 못 덮는다.
   **헤드리스에는 그 부품이 없으므로 표만 손으로 붙여 규칙을 본다**
   (댓글 바의 `nc-typing`에서 쓴 그 수다).

   **잣대 둘을 다 본다** — 29판부터 앱이 직접 띄우므로 여기는 예비 길인데,
   그 잣대(`canNativeToast()`)는 `html.nc`·`body.nc-typing`이다. */
const toastY = await page.evaluate(() => {
    const el = document.querySelector('.toast-stack');
    if (!el) return null;
    const y = () => Math.round(el.getBoundingClientRect().top);
    const root = document.documentElement;
    const out = { off: y(), h: window.innerHeight };
    for (const [k, node, cls] of [['nc', root, 'nc'],
                                  ['typing', document.body, 'nc-typing']]) {
        node.classList.add(cls);
        out[k] = y();
        node.classList.remove(cls);
    }
    return out;
});
/* **클래스 이름만 보면 CSS가 뒤집혀도 초록으로 뜬다** — 실제 자리를 잰다.
   평소에는 화면 아래(탭바 위)이고, 표가 붙으면 머리말 자리로 올라간다. */
ok(toastY !== null && toastY.off > toastY.h / 2
   && toastY.nc < 60 && toastY.typing < 60,
   `바가 덮고 있으면 토스트가 머리말 자리로 올라간다 (실제 ${JSON.stringify(toastY)})`);

/* 이미 가린 글은 **푸는 쪽**이 나온다. 지운 것이 아니므로 되돌릴 수 있다. */
await page.click('[data-mid="m17"] .chat-hidden', { button: 'right' });
await page.waitForTimeout(300);
ok((await page.textContent('.chat-menu') ?? '').includes('가리기 풀기'),
   '이미 가린 글은 푸는 쪽이 나온다');
await shutHold(page);

/* **내 글(m3)에는 지우기가 붙는다.** 운영진이라 가리기도 함께 나온다. */
const delBefore = writes.filter(([w]) => w === 'messages DELETE').length;
await page.click('[data-mid="m3"] .chat-bubble', { button: 'right' });
await page.waitForTimeout(300);
ok((await page.textContent('.chat-menu') ?? '').includes('삭제'),
   '내가 쓴 글에는 삭제가 나온다');
await page.click('.chat-menu-item:text-is("삭제")');
await page.waitForTimeout(300);
ok((await page.textContent('.confirm-box') ?? '').includes('지울까요'),
   '삭제도 한 번 더 묻는다 — 되돌릴 수 없기 때문이다');
await page.click('.confirm-actions .btn:not(.ghost)');
await page.waitForTimeout(400);
const deleted = writes.filter(([w]) => w === 'messages DELETE').map(([, v]) => v);
ok(deleted.length === delBefore + 1 && !!deleted.at(-1)?.includes('id=eq.m3'),
   `삭제를 누르면 그 줄만 지운다 (실제 ${deleted.at(-1)})`);
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
ok(menuTheirs.includes('복사') && menuTheirs.includes('댓글'),
   '남의 글에서도 창은 뜬다 — 복사와 댓글은 누구나 한다');
ok(!menuTheirs.includes('가리기') && !menuTheirs.includes('삭제'),
   '남의 글에는 가리기도 삭제도 안 붙는다');
await shutHold(hPage);
/* 제 글(m5)에는 지우기만 나온다 — 운영진이 아니라 가리기는 없다. */
await hPage.click('[data-mid="m5"] .chat-bubble', { button: 'right' });
await hPage.waitForTimeout(300);
const menuMine = await hPage.textContent('.chat-menu') ?? '';
ok(menuMine.includes('삭제'), '일반회원도 제 글은 지울 수 있다');
ok(!menuMine.includes('가리기'), '가리기는 운영진 몫이라 일반회원에게는 안 나온다');
ok((await hPage.textContent('.chat-list') ?? '').includes('가려진 메시지입니다'),
   '가려진 글은 일반회원에게도 똑같이 덮여 보인다');
await hCtx.close();

/* ── 6-1-1-3-1-11-1. 대화 화면의 크기 — 카톡에서 잰 값 ──────────
 *
 * 사용자 제보(`오픈톡을 거의 옮겼다 싶을 정도로 · 지금은 뭔가 어색해`).
 * 같은 폰에서 찍은 두 사진을 견줘 얻은 값들이다. 눈으로는 `좀 다르네`
 * 정도로만 보이는 자리라 숫자로 붙들어 둔다.
 * 다시 잴 일이 생기면 `node .dev/ktalk.mjs`를 쓴다.
 *
 * **글자 크기는 앱이 실기기에 깔린 뒤 다시 쟀다**(사용자 요청 —
 * `실제 앱이니 카톡과 채팅창 글씨크기를 똑같이해줘`). 예전 값(13px)은
 * 헤드리스 사진으로 견줘 정한 것인데 **거기서는 우리 글꼴이 CDN에서
 * 안 와** 잉크가 부풀어 보였고, 그래서 두 단계나 작게 잡혀 있었다.
 * 새로 잰 것은 iPhone 16 Pro(1206×2622, 우리 아바타 29px이 87픽셀이라
 * **배율 3.0**)에서 카톡과 우리 앱을 잇따라 찍은 것이다:
 *   줄 간격 54픽셀 = 18.0px · 한 줄 말풍선 105픽셀 = 35.0px
 * `15px × 1.2 = 18`, `18 + 7.5×2 + 테두리 2 = 35`으로 맞춰 두었다.
 */
console.log('\n── 대화 화면의 크기 (카톡에서 잰 값) ──');
await go('/#/chat', 1200);
{
    const v = await page.evaluate(() => {
        const C = (s, k) => getComputedStyle(document.querySelector(s))[k];
        const bub = document.querySelector('[data-mid="m1"] .chat-bubble');
        const av = document.querySelector('[data-mid="m1"] .avatar');
        let wide = 0;
        for (const e of document.querySelectorAll('.chat-bubble'))
            wide = Math.max(wide, e.getBoundingClientRect().width);
        return {
            목록여백: C('.chat-list', 'paddingLeft'),
            말풍선바탕: C('[data-mid="m1"] .chat-bubble', 'backgroundColor'),
            /* **아래쪽 모서리로 잰다.** 위 왼쪽은 꼬리가 붙는 자리라
               일부러 3px으로 줄여 두었다(아래 `말풍선 꼬리` 칸 참고) —
               말풍선의 둥글기 자체는 여전히 11px이다. */
            모서리: C('[data-mid="m1"] .chat-bubble', 'borderBottomLeftRadius'),
            줄간격: C('[data-mid="m1"] .chat-bubble', 'lineHeight'),
            칸최대: C('.chat-col', 'maxWidth'),
            아바타: Math.round(av.getBoundingClientRect().width),
            한줄: +bub.getBoundingClientRect().height.toFixed(1),
            넓은말풍선: Math.round(wide),
        };
    });
    ok(v.목록여백 === '9px', `목록 좌우 여백 9px — 카톡 8.6 (실제 ${v.목록여백})`);
    ok(v.말풍선바탕 === 'rgb(245, 245, 245)',
       `말풍선은 순백이 아니라 #f5f5f5 — 카톡에서 뽑은 값 (실제 ${v.말풍선바탕})`);
    ok(v.모서리 === '11px', `말풍선 모서리 11px — 카톡 11.1 (실제 ${v.모서리})`);
    ok(v.줄간격 === '18px', `줄 간격 18px — 실기기에서 잰 카톡 18.0 (실제 ${v.줄간격})`);
    ok(v.칸최대 === '87%', `말풍선 칸 87% — 78%면 한 글자가 넘어간다 (실제 ${v.칸최대})`);
    ok(v.아바타 === 29, `아바타 29px — 카톡 29.1 (실제 ${v.아바타})`);
    ok(v.한줄 > 34 && v.한줄 < 36, `한 줄 말풍선 35px — 실기기에서 잰 카톡 35.0 (실제 ${v.한줄})`);

    /* **줄 위 자리는 앱 목록도 같이 쓴다.** 웹이 `top`으로 넘겨 주는 값이
       `lib/chatlist.ts`의 `ROW_TOP`·`GROUPED_TOP`인데, `Chat.css`가 딴
       값으로 흘러가면 **길게 누르는 창이 뜰 때**(앱 목록을 감추고 웹
       목록으로 바꿔치기한다) 줄이 통째로 틀어진다 — 사용자 제보 · 사진
       두 장(`팝업이 있을때와 없을때 프로필이나 말풍선 위치가 틀어져`).
       앱이 모든 줄에 4px을 박아 두어 줄마다 6px씩 밀렸던 자리다. */
    /* **고정 자료에 그런 줄이 있는지에 기대지 말 것** — 같은 사람이 같은
       분에 잇따라 보낸 줄이 없으면 그 칸이 늘 초록으로 뜬다. 규칙 자체를
       재려고 빈 칸을 잠깐 붙였다 뗀다. */
    const gap = await page.evaluate(() => {
        const list = document.querySelector('.chat-list');
        const mk = (cls) => {
            const d = document.createElement('div');
            d.className = cls;
            list.appendChild(d);
            const v = getComputedStyle(d).marginTop;
            d.remove();
            return v;
        };
        return { 보통: mk('chat-row'), 잇따라: mk('chat-row grouped') };
    });
    ok(gap.보통 === '10px',
       `줄 위 자리 10px — 앱 목록의 \`top\`과 같은 값 (실제 ${gap.보통})`);
    ok(gap.잇따라 === '2px',
       `같은 사람이 잇따라 보낸 줄은 2px (실제 ${gap.잇따라})`);

    /* **얼굴 자리와 이름 줄 높이도 앱 목록(38판)이 그대로 베낀 값이다.**
       웹의 `.chat-row`는 `align-items: flex-start`라 얼굴이 **이름과 같은
       높이(줄 맨 위)**에 서고, 이름 줄은 `13.5 × 1.5`(뿌리 line-height)에
       `.chat-col`의 `gap 2px`을 더한 만큼 말풍선을 밀어 내린다. 앱이
       얼굴을 말풍선 옆에 두고 이름 줄을 3.75px 짧게 잡아, 뒤로 끌어
       돌아올 때 웹 그림 → 앱 목록으로 바뀌는 순간 **얼굴이 내려가고
       말풍선이 밀려 두 화면이 오가는 것처럼** 보였다(사용자 제보 —
       `채팅 프로필도 닉네임에있었는데 말풍선옆에있어`). 줄 높이는 글꼴과
       무관한 배율이라 헤드리스에서 잰 값이 폰에서도 같다. */
    const face = await page.evaluate(() => {
        const row = [...document.querySelectorAll('.chat-row:not(.mine):not(.grouped)')]
            .find(r => r.querySelector('.chat-who') && r.querySelector(':scope > .chat-col > .chat-line > .chat-bubble'));
        if (!row) return null;
        const top = row.getBoundingClientRect().top;
        return {
            얼굴: +(row.querySelector('.avatar').getBoundingClientRect().top - top).toFixed(2),
            이름: +(row.querySelector('.chat-who').getBoundingClientRect().top - top).toFixed(2),
            말풍선: +(row.querySelector('.chat-line > .chat-bubble').getBoundingClientRect().top - top).toFixed(2),
        };
    });
    ok(face && Math.abs(face.얼굴) <= 1 && Math.abs(face.이름) <= 1,
       `얼굴은 줄 맨 위, 이름과 나란히 선다 — 앱 목록의 \`rowTop\` (실제 ${JSON.stringify(face)})`);
    ok(face && Math.abs(face.말풍선 - (13.5 * 1.5 + 2)) <= 1,
       `이름 줄이 말풍선을 22.25px 밀어 내린다 — 앱 목록의 \`nameLine\` (실제 ${face?.말풍선})`);
}

/* ── 6-1-1-3-1-11-2. 말풍선 꼬리 ──────────────────────────────
 *
 * 카톡 말풍선의 **왼쪽 위로 삐져나온 작은 뿔**(내 글은 오른쪽).
 * 5×4px짜리라 작지만 '카톡 같다'는 인상에는 크게 든다.
 * 눈으로는 있는지 없는지도 잘 안 보이는 자리라 숫자로 붙들어 둔다.
 *
 * **붙는 곳과 안 붙는 곳이 규칙의 전부다** — 덩어리의 첫 말풍선에만 붙고,
 * 이모지만 보낸 글(말풍선을 벗긴다)과 사진 아래 딸린 글(위가 사진으로
 * 막혀 있다)에는 안 붙는다.
 */
console.log('\n── 말풍선 꼬리 ──');
{
    const t = await page.evaluate(() => {
        const tail = el => {
            const c = getComputedStyle(el, '::before');
            return c.content === 'none' ? null
                 : { w: c.width, h: c.height, l: c.left, r: c.right, bg: c.backgroundColor };
        };
        const pick = sel => document.querySelector(sel);
        const them = pick('.chat-row:not(.mine):not(.grouped) .chat-bubble:not(.emoji-only):not(.chat-cap)');
        const mine = pick('.chat-row.mine:not(.grouped) .chat-bubble:not(.emoji-only):not(.chat-cap)');
        return {
            남: tail(them), 남모서리: getComputedStyle(them).borderTopLeftRadius,
            내: tail(mine), 내모서리: getComputedStyle(mine).borderTopRightRadius,
            이모지: tail(pick('.chat-bubble.emoji-only')),
            사진글: tail(pick('.chat-bubble.chat-cap')),
            // 가로로 넘치지 않는가 — 뿔은 목록의 좌우 여백(9px) 안에 든다.
            넘침: document.querySelector('.chat-list').scrollWidth
                - document.querySelector('.chat-list').clientWidth,
        };
    });
    ok(t.남 && t.남.w === '8px' && t.남.h === '5px' && t.남.l === '-6px',
       `남의 말풍선은 왼쪽 위로 뿔이 난다 (실제 ${JSON.stringify(t.남)})`);
    ok(t.남모서리 === '3px', `뿔이 붙는 모서리만 3px으로 줄인다 — 11px이면 뿔과 몸통 사이가 벌어진다 (실제 ${t.남모서리})`);
    /* `left`는 `auto`로 적어도 실제로 쓰인 값(픽셀)으로 돌아온다 —
       `right`가 `-6px`인 것으로 뒤집혔음을 가린다. */
    ok(t.내 && t.내.r === '-6px' && t.내.bg === 'rgb(255, 223, 71)',
       `내 말풍선은 오른쪽 위로 뒤집힌다 (실제 ${JSON.stringify(t.내)})`);
    ok(t.내모서리 === '3px', `내 말풍선도 뿔 쪽 모서리만 줄인다 (실제 ${t.내모서리})`);
    ok(t.이모지 === null, '이모지만 보낸 글에는 안 붙는다 — 말풍선 자체가 없다');
    ok(t.사진글 === null, '사진 아래 딸린 글에는 안 붙는다 — 위가 사진으로 막혀 있다');
    ok(t.넘침 === 0, `뿔이 가로 스크롤을 만들지 않는다 (실제 ${t.넘침}px)`);
}

/* ── 6-1-1-3-1-11-2-1. `최근 대화로` 동그라미 ─────────────────
 *
 * 사용자 요청 — `최근대화로 가는 버튼을 카톡처럼 바꿔줘`(카톡 사진을 받아
 * 픽셀로 맞췄다. 1206×2622 · 배율 3.0 → 지름 38 · 오른쪽 10 · 바까지 8).
 * 한동안 **얼굴 · 이름 · 미리보기를 펼친 한 줄**이라 말풍선 한 줄을 통째로
 * 덮었다 — **그 줄로 되돌리지 말 것.**
 *
 * **클래스 이름만 보면 CSS가 뒤집혀도 초록으로 뜨는 자리라 값을 잰다.**
 */
console.log('\n── 최근 대화로 동그라미 ──');
{
    await page.evaluate(() => {
        const el = document.querySelector('.chat-list');
        el.scrollTop = 0; el.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(400);
    const j = await page.evaluate(() => {
        const b = document.querySelector('.chat-jump');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        const bar = document.querySelector('.chat-input')?.getBoundingClientRect();
        const mid = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
            w: Math.round(r.width), h: Math.round(r.height),
            right: Math.round(innerWidth - r.right),
            gap: bar ? Math.round(bar.top - r.bottom) : null,
            radius: cs.borderRadius, bg: cs.backgroundColor, border: cs.borderTopWidth,
            svg: !!b.querySelector('svg'), 글자: b.textContent.trim(),
            눌림: !!mid?.closest('.chat-jump'),
        };
    });
    ok(j !== null, '위로 훑으면 `최근 대화로` 단추가 뜬다');
    if (j) {
        ok(j.w === 38 && j.h === 38 && j.radius === '50%',
           `카톡에서 잰 지름 38px 동그라미다 (실제 ${j.w}×${j.h} · ${j.radius})`);
        ok(j.right === 10 && j.gap === 8,
           `오른쪽 10px · 입력칸까지 8px (실제 ${j.right} · ${j.gap})`);
        ok(j.bg === 'rgb(255, 255, 255)' && j.border === '0px',
           `흰 칠에 테두리가 없다 (실제 ${j.bg} · ${j.border})`);
        ok(j.svg && j.글자 === '',
           `꺾쇠는 그려서 넣는다 — 그림글자를 쓰면 기기에 따라 두부가 된다 (글자 \`${j.글자}\`)`);
        ok(j.눌림, '그 자리를 누르면 이 단추가 잡힌다');
    }
}

/* ── 6-1-1-3-1-11-3. 답장 인용 — 말풍선 안에 든다 ──────────────
 *
 * 사용자 요청 — `답장 기능을 카카오톡처럼 만들어주고`(카톡 사진을 받아
 * 맞췄다). 예전에는 말풍선 **위에** 따로 뜬 쪽지라 한 마디가 두 덩어리로
 * 보였다. 카톡은 머리말(`○○에게 댓글`) · 원문 · 가는 선을 **말풍선 안에**
 * 넣고 그 아래에 답장 글을 놓는다.
 *
 * **눈으로는 `좀 다르네` 정도로만 보이는 자리**라 자리와 값을 재서 붙든다 —
 * 인용의 아래변이 말풍선 안에 있는가, 가르는 선이 있는가, 말이 `댓글`인가.
 * 고정 자료의 m7(내 글)·m8(남의 글)이 답장이다.
 */
console.log('\n── 답장 인용 ──');
/* **문서를 새로 연다** — `#`만 바뀌는 이동은 화면을 새로 안 만들어서,
   앞의 `가리기` 칸이 화면에만 덮어 둔 m5가 그대로 살아 있다. 그러면
   인용이 `가려진 메시지` 네 글자로 줄어 **긴 글 검사가 헛돈다**
   (`countPosts`·방 공지와 같은 자리다). */
await go('/#/chat', 300);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
{
    const q = await page.evaluate(() => {
        const box = sel => {
            const e = document.querySelector(sel);
            return e ? e.getBoundingClientRect() : null;
        };
        const quote = document.querySelector('[data-mid="m8"] .chat-quote');
        const bubble = box('[data-mid="m8"] .chat-bubble');
        const qb = quote?.getBoundingClientRect();
        const cs = quote ? getComputedStyle(quote) : null;
        return {
            글: quote?.textContent ?? '',
            안에: !!(qb && bubble) && qb.bottom <= bubble.bottom && qb.top >= bubble.top,
            선: cs?.borderBottomWidth,
            /* 말풍선 글자(15px)보다 작아야 인용이 답장만큼 커 보이지 않는다. */
            글자: cs?.fontSize,
            /* 내 노란 말풍선에서도 선이 보이는가 — `--line`으로 두면 안 보인다. */
            내선: getComputedStyle(
                document.querySelector('[data-mid="m7"] .chat-quote')).borderBottomColor,
            /* **긴 글에 답장한 말풍선이 화면 안에 드는가.** 인용은 한 줄로
               자르느라 `nowrap`인데, 그 글의 min-content가 flex의
               `min-width: auto`를 타고 말풍선·줄로 올라가 `.chat-col`의
               87%를 넘겼다 — `mine`은 오른쪽 정렬이라 넘친 만큼이 **화면
               왼쪽 밖으로** 나가 머리말이 통째로 안 보였다(사용자 제보).
               `.chat-line`의 `max-width: 100%`와 `.chat-bubble`의
               `min-width: 0`이 한 쌍으로 막는다 — 둘 중 하나만 빼도
               여기가 빨갛게 뜬다. */
            내왼쪽: Math.round(box('[data-mid="m7"] .chat-bubble').left),
            내오른쪽: Math.round(box('[data-mid="m7"] .chat-bubble').right),
            내폭: Math.round(box('[data-mid="m7"] .chat-bubble').width),
            머리말왼쪽: Math.round(box('[data-mid="m7"] .chat-quote-who').left),
            칸폭: Math.round(box('[data-mid="m7"] .chat-col').width),
            창: innerWidth,
        };
    });
    ok(q.내왼쪽 >= 0 && q.내오른쪽 <= q.창,
       `긴 글에 답장해도 말풍선이 화면 안에 든다 (실제 ${q.내왼쪽}~${q.내오른쪽} / 창 ${q.창})`);
    ok(q.내폭 <= q.칸폭 + 1,
       `말풍선이 이름 칸(87%)을 안 넘는다 (실제 ${q.내폭} ≤ ${q.칸폭})`);
    ok(q.머리말왼쪽 >= 0,
       `\`○○에게 댓글\` 머리말이 잘려 나가지 않는다 (실제 x ${q.머리말왼쪽})`);
    ok(q.안에, '인용이 말풍선 안에 든다 — 위에 따로 뜬 쪽지가 아니다');
    ok(q.글.includes('에게 댓글'),
       `머리말이 \`○○에게 댓글\`이다 — 길게 누르는 창의 그 말과 같다 (실제 ${JSON.stringify(q.글.slice(0, 20))})`);
    ok(q.선 === '1px', `원문과 답장을 가는 선으로 가른다 (실제 ${q.선})`);
    ok(parseFloat(q.글자) < 15, `인용 글자는 말풍선보다 작다 (실제 ${q.글자})`);
    ok(q.내선 === 'rgba(0, 0, 0, 0.1)',
       `노란 말풍선에서도 같은 선을 쓴다 — \`--line\`은 거기서 안 보인다 (실제 ${q.내선})`);
}

/* ── 6-1-1-3-1-12. 길게 누른 창의 크기 ─────────────────────────
 *
 * **카톡 화면을 픽셀로 재서 맞춘 값이다**(사용자 제보 — `우리껀 너무커`).
 * **배율을 몰라도 되는 방법으로 잰다** — 같은 폰에서 우리 창과 카톡 창을
 * 잇따라 찍어, **우리의 아는 값으로 카톡 쪽을 환산한다.** 우리 한 줄
 * 34px이 사진에서 77픽셀이고 카톡이 91.5픽셀이었으므로
 * `34 × 91.5 ÷ 77 ≈ 40px`이다. 눈에는 `좀 크네` 정도로만 보이는 자리라
 * 숫자로 붙들어 둔다.
 */
console.log('\n── 길게 누른 창의 크기 ──');
await go('/#/chat', 1200);
{
    const bubble = await page.$('[data-mid="m1"] .chat-bubble');
    await bubble.click({ button: 'right' });
    await page.waitForTimeout(300);
    const box = await page.evaluate(() => {
        const items = [...document.querySelectorAll('.chat-menu > .chat-menu-item')]
            .map(e => Math.round(e.getBoundingClientRect().height));
        const align = getComputedStyle(document.querySelector('.chat-menu > .chat-menu-item')).textAlign;
        const line = getComputedStyle(document.querySelectorAll('.chat-menu > .chat-menu-item')[1]).borderTopWidth;
        return { items, align, line };
    });
    ok(box.items.every(h => h === 40),
       `한 줄이 40px이다 — 카톡에서 잰 값 (실제 ${JSON.stringify(box.items)})`);
    ok(box.align === 'left', `창의 줄은 왼쪽 정렬이다 (실제 ${box.align})`);
    ok(box.line === '1px', `줄 사이를 띄우지 않고 선으로 가른다 (실제 ${box.line})`);
    await shutHold(page);
}

/* ── 6-1-1-3-1-13. 창이 누른 자리에서 뜬다 ──────────────────────
 *
 * 사용자 요청(`누른 자리에서 나오도록해줘`). 예전에는 화면 아래에서
 * 올라와서 **어느 글을 누른 것인지 창만 봐서는 몰랐고**, 그래서 미리보기
 * 머리말을 한 줄 얹어야 했다.
 *
 * **자리는 `HoldAt`(Chat.tsx)이 재서 정한다** — 스크린샷으로는 '대충
 * 말풍선 옆이네' 정도로만 보여 조용히 어긋나도 모른다. 숫자로 붙들어 둔다.
 *
 * 넷을 본다:
 *  - 남의 글은 **말풍선 왼쪽 끝**에, 내 글은 **오른쪽 끝**에 맞는다.
 *  - 창이 말풍선 바로 위나 아래에 붙는다(멀리 떨어지지 않는다).
 *  - **반응 알약이 언제나 맨 아래다**(사용자 요청 — `이모티콘도 하단에`).
 *  - 화면 밖으로 안 나간다.
 */
console.log('\n── 창이 누른 자리에서 뜬다 ──');
{
    const at = async (mid) => {
        await page.click(`[data-mid="${mid}"] .chat-bubble`, { button: 'right' });
        await page.waitForTimeout(300);
        const v = await page.evaluate((id) => {
            const b = document.querySelector(`[data-mid="${id}"] .chat-bubble`).getBoundingClientRect();
            const hold = document.querySelector('.chat-hold').getBoundingClientRect();
            const menu = document.querySelector('.chat-menu').getBoundingClientRect();
            const pill = document.querySelector('.chat-menu-reacts').getBoundingClientRect();
            return {
                말풍선: [Math.round(b.left), Math.round(b.right), Math.round(b.top), Math.round(b.bottom)],
                창: [Math.round(hold.left), Math.round(hold.right), Math.round(hold.top), Math.round(hold.bottom)],
                알약이아래: pill.top >= menu.bottom,
                안잘림: hold.left >= 0 && hold.top >= 0
                        && hold.right <= window.innerWidth && hold.bottom <= window.innerHeight,
                보임: getComputedStyle(document.querySelector('.chat-hold')).visibility,
            };
        }, mid);
        await shutHold(page);
        return v;
    };
    /** 말풍선 위나 아래에 6px쯤 띄워 붙었는가(둘 중 하나면 된다). */
    const 붙었나 = (v) => Math.abs(v.창[2] - v.말풍선[3]) < 20 || Math.abs(v.창[3] - v.말풍선[2]) < 20;

    const them = await at('m1');
    ok(them.보임 === 'visible', `창이 보인다 — 재기 전에 숨겨 둔 것이 안 풀리면 안 뜬 것처럼 보인다 (실제 ${them.보임})`);
    ok(Math.abs(them.창[0] - them.말풍선[0]) <= 1,
       `남의 글은 말풍선 왼쪽 끝에 맞는다 (실제 창 ${them.창[0]} · 말풍선 ${them.말풍선[0]})`);
    ok(붙었나(them), `창이 말풍선 바로 위나 아래에 붙는다 (실제 ${JSON.stringify(them)})`);
    ok(them.알약이아래, '반응 알약이 메뉴 아래에 선다 — 누른 말풍선에 가장 가까운 쪽이다');
    ok(them.안잘림, `창이 화면 밖으로 안 나간다 (실제 ${JSON.stringify(them.창)})`);

    // **m3이 아니라 m7이다** — 앞의 `삭제` 칸이 m3을 지워 버려 여기서는 없다.
    const mine = await at('m7');
    ok(Math.abs(mine.창[1] - mine.말풍선[1]) <= 1,
       `내 글은 말풍선 오른쪽 끝에 맞는다 (실제 창 ${mine.창[1]} · 말풍선 ${mine.말풍선[1]})`);
    ok(mine.알약이아래, '내 글에서도 알약은 맨 아래다');
    ok(mine.안잘림, `내 글에서도 창이 화면 밖으로 안 나간다 (실제 ${JSON.stringify(mine.창)})`);
}

/* ── 6-1-1-3-1-14. 메뉴에 무엇이 붙는가 · 선택 복사 ─────────────
 *
 * 줄 차례는 사용자가 정해 준 그대로다 —
 * `복사 · 선택 복사 · 댓글 · 공유`에 운영진의 `가리기`, 쓴 사람의
 * `삭제`가 뒤에 붙는다. **`댓글`은 왼쪽으로 밀면
 * 걸리는 그 답장과 같은 일이다**(사용자가 정한 이름이다).
 *
 * **`선택 복사`는 말풍선에서 못 하는 일을 되돌리는 자리다** — 말풍선에는
 * `user-select: none`이 걸려 있어(iOS 글자 고르기가 길게 누르기를 덮지
 * 않게) 글의 일부만 가져갈 길이 아예 없다. 그 창에서만 켜 둔다.
 */
console.log('\n── 메뉴 줄과 선택 복사 ──');
{
    await page.click('[data-mid="m1"] .chat-bubble', { button: 'right' });
    await page.waitForTimeout(300);
    const rows = await page.$$eval('.chat-menu > .chat-menu-item', es => es.map(e => e.textContent));
    ok(JSON.stringify(rows.slice(0, 4)) === JSON.stringify(['복사', '선택 복사', '댓글', '공유']),
       `앞 네 줄은 사용자가 정해 준 차례 그대로다 (실제 ${JSON.stringify(rows)})`);
    /* **`캡쳐`는 없앴다**(사용자 요청 — `캡쳐기능은 삭제해줘`).
       되살아나면 여기서 빨갛게 뜬다. */
    ok(!rows.includes('캡쳐'), '`캡쳐`는 없앴다 — 창에 안 선다');
    const icons = await page.$$eval('.chat-menu > .chat-menu-item', es => es.map(e => !!e.querySelector('svg')));
    ok(icons.every(Boolean), '줄마다 오른쪽에 그림이 선다 — 카톡과 같은 배치다');

    await page.click('.chat-menu-item:text-is("선택 복사")');
    await page.waitForTimeout(300);
    const pick = await page.evaluate(() => {
        const box = document.querySelector('.chat-pick-body');
        if (!box) return null;
        return { 글: box.textContent, 고를수있나: getComputedStyle(box).webkitUserSelect || getComputedStyle(box).userSelect };
    });
    ok(pick && pick.글 === '이번 주 무등산 날씨 어떤가요?',
       `선택 복사는 그 글을 그대로 펼친다 (실제 ${JSON.stringify(pick?.글)})`);
    ok(pick && pick.고를수있나 === 'text',
       `거기서는 글자를 끌어서 고를 수 있다 — 말풍선에서는 막혀 있다 (실제 ${pick?.고를수있나})`);
    await page.click('.chat-pick-foot .btn.ghost');
    await page.waitForTimeout(200);
}

/* ── 6-1-1-3-1-15. 공유 ─────────────────────────────────────────
 *
 * **폰이 해 주는 일을 부르는 것**이라 되는지 안 되는지가 기기마다 다르다.
 * 여기서 붙들어 두는 것은 하나다 — **공유창이 없는 기기에서 아무 일도
 * 안 일어나면 안 된다.** 헤드리스 크로미움에는 `navigator.share`가
 * 없는데, 그때 조용히 돌아서면 사람 눈에는 고장이다 — 복사로 물러나고
 * 그 사실을 알려야 한다.
 *
 * **아이폰에서는 공유창으로 간다** — 그 길은 여기서 못 잰다.
 *
 * (곁에 `캡쳐`가 있었는데 **사용자 요청으로 통째로 걷어냈다** —
 * `html-to-image`와 `shareImage`도 함께 지웠다. 되살리지 말 것.)
 */
console.log('\n── 공유 ──');
{
    await page.click('[data-mid="m1"] .chat-bubble', { button: 'right' });
    await page.waitForTimeout(300);
    await page.click('.chat-menu-item:text-is("공유")');
    await page.waitForTimeout(500);
    const said = await page.$$eval('.toast', es => es.map(e => e.textContent).join(' | '));
    ok(said.length > 0,
       `공유창이 없는 기기에서는 복사로 물러나고 그 사실을 알린다 (실제 ${said || '아무 말도 없음'})`);
    await page.waitForTimeout(300);
}

/* **폰에서는 이모티콘·사진에도 길게 누르기가 먹어야 한다**(사용자 제보 —
 * `이모티콘은 그런 기능들이 안되네`).
 *
 * 창을 여는 코드는 `.chat-row`에 붙어 있어 어느 말풍선에서나 도는데,
 * 그림에는 **iOS가 제 `이미지 저장 / 복사 / 공유` 시트**를 띄워 우리
 * 손짓을 통째로 덮는다(사진은 `<a>`라 링크 미리보기까지 뜬다).
 * 막는 CSS가 `.chat-bubble`에만 걸려 있어서, 폰에서만 이모티콘·사진의
 * 반응·댓글·삭제가 아예 안 먹었다.
 *
 * **여기서 창이 열리는지를 봐야 소용없다** — 크로미움에는 그 시트가
 * 없어서 고치기 전 코드도 초록으로 뜬다(깜빡임에서 얻은 교훈 그대로다).
 * 그래서 **막는 값 자체를 잰다.** 손가락 기기에서만 거는 규칙이라
 * `hasTouch`인 창이 따로 필요하다. */
console.log('\n── 폰에서 그림을 길게 누르기 ──');
const tCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    hasTouch: true, isMobile: true });
await tCtx.route('**/rest/v1/**', restRoute(tables));
await tCtx.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
await stubOutside(tCtx);
await tCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
const tPage = await tCtx.newPage();
await tPage.goto(BASE + '/#/chat', { waitUntil: 'networkidle' });
await tPage.waitForTimeout(1200);
for (const [sel, what] of [
    ['.chat-bubble', '말풍선'], ['.chat-sticker', '이모티콘'],
    ['.chat-image', '사진'], ['.chat-photo-link', '사진 링크'],
]) {
    const v = await tPage.$eval(sel, el => getComputedStyle(el).userSelect).catch(() => null);
    ok(v === 'none', `${what}에 iOS 제 메뉴를 막아 둔다 (실제 ${v})`);
}
await tCtx.close();

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

/* ── 6-1-1-3-1-8. 참여자 목록과 프로필 ──────────────────────────
 *
 * 카톡 오픈톡의 ☰다. 방에 누가 있는지 볼 길이 없었고, 말풍선 옆 얼굴을
 * 눌러도 아무 일이 없었다 — 100명 방에서 `83/신성호/광산구`만 보고는
 * 누군지 떠올리기 어렵다.
 */
console.log('\n── 참여자 목록과 프로필 ──');
await go('/#/chat', 1200);
ok(await page.$('.chat-who-btn') !== null, '머리말에 참여자 단추가 있다');
await page.click('.chat-who-btn');
await page.waitForTimeout(400);
const inRoom = await page.$$eval('.chat-person', els => els.map(e => e.textContent));
ok(inRoom.length > 0, `방에 있는 사람이 늘어선다 (실제 ${inRoom.length}명)`);
/* **대기·추방은 빠진다** — 그분들은 대화를 아예 못 본다. 고정 자료의
   `대기중`(가입 신청)이 섞여 들어오면 이 줄이 빨갛게 뜬다. */
ok(!inRoom.some(t => t?.includes('대기중')),
   '대기·추방은 안 나온다 — 대화를 못 보는 사람이다');
ok(inRoom.some(t => t?.includes('나')), '내 줄에는 `나` 표가 붙는다');
ok((await page.textContent('.chat-people-n') ?? '').includes('명'),
   '몇 명인지 머리말에 적는다');

/* **차례는 운영진 먼저, 그다음 나이순이다**(사용자 요청 — `운영진이 맨위에
   오고 그 다음은 나이순으로 정렬되게해줘`). 고정 자료로 세 가지가 한꺼번에
   걸린다 — 운영진 셋이 앞, 그 안에서도 연장자 먼저(68 → 72 → 80),
   총무는 운영진 뒤 일반회원 앞, 태어난 해를 안 적은 사람은 맨 뒤.
   **이름만 보면 CSS도 정렬도 안 보므로 차례 자체를 적어 둔다.** */
const order = ['이관교', '신성호', '김지명', '박승수',
               '임채원', '정우성', '장동건', '오세훈'];
const seen = inRoom.map(t => order.find(n => t?.includes(n))).filter(Boolean);
ok(seen.join(' ') === order.join(' '),
   `운영진 먼저 · 그다음 나이순 (실제 ${seen.join(' ')})`);

/* **직책은 글자가 아니라 얼굴에 붙는 표다**(사용자 요청 — `운영진은 글씨로
   앱관리자 이렇게 표시하지말고 사진처럼 표시해줘`). 클래스 이름만 보면
   글자표가 그대로 남아 있어도 초록으로 뜨므로 **둘을 함께 본다** —
   표가 붙은 사람 수(고정 자료로 넷: 앱관리자·운영자·부운영자·총무)와,
   글자표가 한 줄도 안 남았는가. **색만으로 가르지 않으므로** 표에
   직책 이름이 `aria-label`로 달려 있는지도 잰다. */
const rank = await page.$$eval('.chat-person .chat-rank',
    els => els.map(e => e.getAttribute('aria-label')));
ok(rank.length === 4, `직책은 얼굴에 붙는 표다 (실제 ${rank.length}명)`);
ok(!await page.$('.chat-person .role-tag'),
   '이름 뒤에 `앱관리자` 같은 글자표를 안 붙인다');
ok(rank.includes('앱관리자') && rank.includes('총무'),
   `표에 직책 이름이 달려 있다 — 색만으로 가르지 않는다 (실제 ${rank.join('·')})`);
/* **`나`는 이름 앞이다**(카톡과 같다). 뒤에 두면 긴 이름표에 밀린다. */
ok(await page.$eval('.chat-person-me', e => {
    const b = x => x.getBoundingClientRect();
    return b(e).left < b(e.parentElement.querySelector('.chat-person-name')).left;
}), '`나` 표는 이름 앞에 온다');

/* **서랍 맨 위에 `최근 사진`이 있다**(사용자 요청 — `메뉴누르면 사진처럼
   사진/동영상 만들어줘` · 카톡 서랍 사진을 받아 맞췄다). 올린 사진을
   되짚으려면 대화를 위로 계속 올리는 것 말고는 길이 없었다.
   **이모티콘이 안 섞이는지가 핵심이다** — 사진과 같은 칸(`image_url`)을
   쓰므로 서버에서 걸러 내는 조건(`not.ilike.sticker:%`)이 빠지면 우리
   대화방은 대부분이 이모티콘이라 서른 칸이 죄다 이모티콘으로 찬다.
   (고정 자료는 사진 한 장 · 이모티콘 다섯이라 그 한 줄로 갈린다.) */
const shots = await page.$$eval('.chat-shot img', els => els.map(e => e.src));
ok(shots.length > 0, `서랍에 최근 사진이 늘어선다 (실제 ${shots.length}장)`);
ok(!shots.some(s => s.includes('/stickers/')),
   '이모티콘은 사진 줄에 안 섞인다');
ok(await page.evaluate(() => {
    const b = e => e.getBoundingClientRect().top;
    return b(document.querySelector('.chat-shots-h'))
         < b(document.querySelector('.chat-people-n'));
}), '사진 줄이 참여자 목록보다 위에 온다');
/* **누르면 앱 안에서 크게 뜬다** — 서랍(z-index 6) 위로 제대로 덮이는지가
   자리다. 클래스만 보면 뒤에 깔려 있어도 초록으로 뜨므로 **그 자리를
   실제로 누르면 무엇이 잡히는가**를 본다. */
await page.click('.chat-shot');
await page.waitForTimeout(400);
ok(await page.evaluate(() => {
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return !!hit?.closest('.photo-zoom');
}), '썸네일을 누르면 서랍 위로 크게 뜬다');
await page.click('.photo-zoom-x');
await page.waitForTimeout(300);

/* 줄을 누르면 그 사람 프로필이 **전체화면**으로 뜬다(사용자 요청 —
   카톡처럼). 예전에는 아래에서 올라오는 작은 카드였다. */
await page.click('.chat-person');
await page.waitForTimeout(400);
const cardText = await page.textContent('.profile-full');
ok(!!cardText, '줄을 누르면 프로필이 뜬다');
ok(/올해 \d+회/.test(cardText ?? ''),
   `참석 횟수를 적는다 (실제 ${(cardText ?? '').match(/올해 \d+회/)?.[0]})`);
/* **전화번호·차량번호는 여기 안 적는다** — 회원 명단 하나에서
   운영진에게만 보이기로 정해 둔 값이다. */
ok(!/010-|\d{2,3}[가-힣]\d{4}/.test(cardText ?? ''),
   '전화번호·차량번호는 프로필에 안 적는다 — 회원 명단 몫이다');
/* **화면을 통째로 덮는다.** 클래스만 보면 작은 카드로 되돌아가도 초록으로
   뜨므로 **실제로 차지하는 자리**를 잰다(가운데를 눌렀을 때 잡히는 것까지). */
ok(await page.evaluate(() => {
    const el = document.querySelector('.profile-full-sheet');
    if (!el) return false;
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return b.width >= innerWidth - 1 && b.height >= innerHeight - 1
        && !!hit?.closest('.profile-full');
}), '프로필이 화면을 통째로 덮는다');
await page.click('.profile-full-x');
await page.waitForTimeout(300);
ok(await page.$('.profile-full') === null, '✕를 누르면 닫힌다');

/* **말풍선 옆 얼굴을 눌러도 같은 화면이 뜬다**(카톡과 같다). */
await page.click('.chat-search-x');            // 목록을 닫는다
await page.waitForTimeout(300);
ok(await page.$('.chat-face') !== null, '말풍선 옆 얼굴이 눌리는 곳이다');
await page.click('.chat-face');
await page.waitForTimeout(400);
ok(await page.$('.profile-full') !== null, '얼굴을 누르면 그 사람 프로필이 뜬다');

/* **아래로 내리면 사라진다**(사용자 요청 — 뒤로 가기 손짓과 같은 결).
   **조금 내린 것은 제자리로 돌아와야 한다** — 안 그러면 굴리려다
   닫히는 것처럼 느껴진다. 손짓을 잡는 것이 우리 코드라 헤드리스로 잡힌다. */
const dragSheet = (from, to) => page.evaluate(async ([y0, y1]) => {
    const el = document.querySelector('.profile-full');
    const mk = (x, y) => new Touch({ identifier: 1, target: el,
        clientX: x, clientY: y, pageX: x, pageY: y });
    const fire = (type, x, y) => el.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [mk(x, y)],
        targetTouches: type === 'touchend' ? [] : [mk(x, y)],
        changedTouches: [mk(x, y)] }));
    /* **시간을 두고 흘려야 한다** — 한 프레임에 몰아 던지면 어떤 거리든
       빠르기가 무한이 되어 **튕김으로 읽힌다**(실제로 40px에서 닫혔다).
       손가락은 240ms에 걸쳐 움직이므로 그만큼 나눠 준다. */
    fire('touchstart', 180, y0);
    const step = (y1 - y0) / 8;
    for (let i = 1; i <= 8; i++) {
        await new Promise(r => setTimeout(r, 30));
        fire('touchmove', 180, y0 + step * i);
    }
    fire('touchend', 180, y1);
}, [from, to]);

await dragSheet(300, 340);                      // 40px — 안 닫힐 만큼
await page.waitForTimeout(400);
ok(await page.$('.profile-full') !== null, '조금 내린 것으로는 안 닫힌다');
ok(await page.evaluate(() => {
    const el = document.querySelector('.profile-full-sheet');
    return !el || new DOMMatrixReadOnly(getComputedStyle(el).transform).f < 1;
}), '놓으면 제자리로 돌아온다');

/* **`🎁 선물하기`는 카카오 페이지를 여는 지름길이다**(사용자 요청 —
   `그 선물하기를 누르면 카카오 선물하기 페이지가 열리고 거기에서 …
   상대를 선택하고 선물을 보낼 수 있게`). 우리가 선물을 보내는 것이
   아니라 주소 하나를 여는 것뿐이라, **`<a>`로 새 탭에 열리는가**와
   **분홍이 아닌가**를 잰다 — 클래스 이름만 보면 둘 다 초록으로 뜬다. */
const giftBtn = await page.$('.profile-full-btn.gift');
ok(!!giftBtn, '프로필에 `🎁 선물하기`가 있다');
if (giftBtn) {
    const g = await page.$eval('.profile-full-btn.gift', el => ({
        tag: el.tagName,
        href: el.getAttribute('href'),
        target: el.getAttribute('target'),
        bg: getComputedStyle(el).backgroundColor,
        pink: getComputedStyle(document.documentElement)
            .getPropertyValue('--brand').trim(),
        h: el.getBoundingClientRect().height,
        w: el.getBoundingClientRect().width,
    }));
    ok(g.tag === 'A' && (g.href ?? '').startsWith('https://gift.kakao.com'),
       `카카오 선물하기 주소를 연다 (실제 ${g.tag} ${JSON.stringify(g.href)})`);
    /* 홈 화면 앱에는 주소창도 뒤로 가기도 없다 — 같은 창으로 나가면
       앱을 껐다 켜야 돌아온다(대화 글 안의 주소와 같은 잣대다). */
    ok(g.target === '_blank', `새 탭으로 연다 (실제 ${JSON.stringify(g.target)})`);
    ok(!g.bg.includes('236, 72') && g.bg !== g.pink,
       `분홍을 안 쓴다 (실제 ${g.bg})`);
    ok(g.h >= 30 && g.w >= 30,
       `누름 자리가 30px 위다 (실제 ${Math.round(g.w)}×${Math.round(g.h)})`);
}

/* 프로필의 `@언급하기`를 누르면 입력칸에 `@이름 `이 들어간다.
   **`.profile-full-btn` 하나로 집지 말 것** — `🎁 선물하기`가 같은
   클래스라 그때그때 다른 단추가 잡힌다. */
const hasMention = await page.$('.profile-full-btn.mention');
if (hasMention) {
    await hasMention.click();
    await page.waitForTimeout(300);
    const draft = await page.$eval('.chat-input .textarea', el => el.value);
    ok(draft.startsWith('@') && draft.endsWith(' '),
       `@언급하기를 누르면 입력칸에 이름이 들어간다 (실제 ${JSON.stringify(draft)})`);
    await page.$eval('.chat-input .textarea', el => { el.value = ''; });
} else if (await page.$('.profile-full-x')) {
    await page.click('.profile-full-x');
}
await page.waitForTimeout(250);

/* ── 언급 목록 뒤에 판이 하나 더 깔리지 않는다 ────────────────────
 *
 * 사용자 요청 — `언급 기능 사용할 때 이름 목록 팝업창 뜨는 뒷면에
 * 배경화면 같은 게 하나 있는데 그거 삭제해줘`. `.chat-input`의 밝은 칠이
 * 목록 둘레에 띠로 남아 있던 것이다. 지금은 `.chat-over`가 그 자리를
 * **대화 바탕색**으로 덮어 목록이 대화 위에 그냥 떠 있는 것으로 읽힌다.
 *
 * **클래스 이름만 보면 CSS가 뒤집혀도 초록으로 뜨므로 값을 잰다** —
 * 칠이 대화 목록과 같은가 · 화면 끝까지 닿는가 · 목록 위에 밝은 띠가
 * 남지 않는가(윗변이 `.chat-input`의 테두리까지 먹는가).
 */
await page.click('.chat-input .textarea');
await page.type('.chat-input .textarea', '@');
await page.waitForTimeout(400);
const over = await page.evaluate(() => {
    const box = document.querySelector('.chat-over');
    const list = document.querySelector('.mention-list');
    const inp = document.querySelector('.chat-input');
    const chat = document.querySelector('.chat-list');
    if (!box || !list) return null;
    const b = box.getBoundingClientRect(), l = list.getBoundingClientRect();
    return {
        칠: getComputedStyle(box).backgroundColor,
        대화칠: getComputedStyle(chat).backgroundColor,
        왼쪽: Math.round(b.left), 폭: Math.round(b.width),
        위여백: Math.round(l.top - b.top),
        넘침: Math.round(inp.getBoundingClientRect().top - b.top),
        목록왼쪽: Math.round(l.left),
    };
});
ok(over && over.칠 === over.대화칠,
   `언급 목록 뒤가 대화 바탕색이다 (실제 ${over?.칠} · 대화 ${over?.대화칠})`);
ok(over && over.왼쪽 === 0 && over.폭 === 390,
   `화면 끝까지 덮는다 — 옆에 밝은 띠가 안 남는다 (실제 ${over?.왼쪽}·${over?.폭})`);
/* **위로는 `.chat-input`의 여백과 테두리까지만 먹는다.** 더 먹으면 앱
   목록이 그린 말풍선을 덮고, 덜 먹으면 밝은 띠가 한 줄 남는다. */
ok(over && over.넘침 >= 0 && over.넘침 <= 12,
   `위로 여백과 테두리까지만 먹는다 (실제 ${over?.넘침}px)`);
ok(over && over.목록왼쪽 === 16,
   `목록은 예전 여백 그대로다 — 화면 끝에 닿아 보이면 안 된다 (실제 ${over?.목록왼쪽}px)`);
/* **보이는 것은 이름표, 넣는 것은 닉네임이다**(사용자 요청 — `언급했을때
   나오는 닉네임이 다르게나와. 회원목록에있는거처럼 해줘`). 100명 모임에서
   `@악마제리`만 봐서는 누군지 몰라 회원 명단과 같은 이름표를 적는다. */
const mNames = await page.$$eval('.mention-item .truncate', els => els.map(e => e.textContent));
ok(mNames.includes('68/이관교/북구'),
   `언급 목록은 회원 명단과 같은 이름표다 (실제 ${mNames.join(' · ') || '없음'})`);
await page.$eval('.chat-input .textarea', el => { el.value = ''; });
await page.keyboard.press('Backspace');
await page.waitForTimeout(300);
ok(await page.$('.chat-over') === null,
   '하나도 없으면 칸째 안 그린다 — 빈 보라 띠가 남으면 안 된다');

/* ── 입력칸 뒤에도 판이 없다 ───────────────────────────────────
 *
 * 사용자 요청 — `메시지입력하는 창 뒷배경을 카톡처럼 삭제해줘`.
 * 예전에는 `.chat-input`이 밝은 칠(`--bg`)에 위쪽 선까지 있어 목록 아래에
 * **판이 하나 더 깔린 것처럼** 보였다. 지금은 대화 바탕색 그대로이고,
 * 그 위에 글칸 알약 하나만 떠 있다(카톡의 그 줄이다).
 *
 * **클래스 이름만 보면 CSS가 뒤집혀도 초록으로 뜨므로 칠을 잰다** —
 * 바탕이 대화 목록과 같은가 · 글칸이 말풍선과 같은 흰 알약인가 ·
 * 위쪽 선이 안 보이는가 · `+`의 획이 그 위에서 읽히는 흰색인가.
 */
const barPaint = await page.evaluate(() => {
    const inp = document.querySelector('.chat-input');
    const chat = document.querySelector('.chat-list');
    const field = document.querySelector('.chat-input .textarea');
    const plus = document.querySelector('.chat-photo');
    if (!inp || !chat || !field) return null;
    const cs = getComputedStyle(inp);
    const fs = getComputedStyle(field);
    return {
        칠: cs.backgroundColor,
        대화칠: getComputedStyle(chat).backgroundColor,
        선: cs.borderTopColor,
        한줄: Math.round(field.getBoundingClientRect().height),
        둥글기: Math.round(parseFloat(fs.borderBottomLeftRadius)),
        글칸: getComputedStyle(field).backgroundColor,
        말풍선: getComputedStyle(document.querySelector('.chat')).getPropertyValue('--chat-bubble').trim(),
        더하기: plus ? getComputedStyle(plus).color : '',
    };
});
ok(barPaint && barPaint.칠 === barPaint.대화칠,
   `입력칸 뒤가 대화 바탕색이다 (실제 ${barPaint?.칠} · 대화 ${barPaint?.대화칠})`);
ok(barPaint && /rgba\(0, 0, 0, 0\)|transparent/.test(barPaint.선),
   `위쪽 선이 없다 — 판을 가르는 줄이 남으면 안 된다 (실제 ${barPaint?.선})`);
ok(barPaint && barPaint.글칸 === 'rgb(245, 245, 245)' && barPaint.말풍선 === '#f5f5f5',
   `글칸은 말풍선과 같은 흰 알약이다 (실제 ${barPaint?.글칸} · 토큰 ${barPaint?.말풍선})`);
ok(barPaint && /rgba?\(255, 255, 255/.test(barPaint.더하기),
   `\`+\`의 획은 보라 위에서 읽히는 흰색이다 (실제 ${barPaint?.더하기})`);
/* **글칸 한 줄 높이는 카톡을 픽셀로 재서 맞춘 값이다**(사용자 요청 —
   `메시지입력창 크기를 카톡하고 똑같이해주고`). 1206×2622 · 배율 3.0에서
   카톡 알약이 145픽셀 = 48px이었고 우리 것은 114픽셀 = 38px이었다.
   **클래스 이름만 보면 CSS가 뒤집혀도 초록으로 뜨므로 값을 잰다.** */
ok(barPaint && barPaint.한줄 === 48,
   `글칸 한 줄은 카톡과 같은 48px이다 (실제 ${barPaint?.한줄}px)`);
ok(barPaint && barPaint.둥글기 === 24,
   `그 알약은 꽉 둥글다 — 반지름이 높이의 절반 (실제 ${barPaint?.둥글기}px)`);

/* **골라서 들어가는 글자는 이름표가 아니라 닉네임이다.** 발송기의
   `mentionedIds`가 글에서 `@<닉네임>`을 찾아 누구를 부른 것인지 가리므로,
   이름표가 들어가면 **부르긴 했는데 알림이 안 가는** 글이 된다. */
await page.click('.chat-input .textarea');
await page.type('.chat-input .textarea', '@이관');
await page.waitForTimeout(400);
await page.click('.mention-item:not(.is-all)');
await page.waitForTimeout(200);
const putIn = await page.$eval('.chat-input .textarea', el => el.value);
ok(putIn === '@이관교 ', `넣는 글자는 닉네임 그대로다 (실제 ${JSON.stringify(putIn)})`);

/* ── 고른 뒤에도 목록이 남고, 다시 누르면 빠진다 ────────────────
 *
 * 사용자 요청 — `언급도 … 선택했던 사람을 다시 누르게 되면 또 선택되는
 * 게 아니고 선택 해제 될수 있게 바꿔줘`. 앱 목록(`MentionList`)은 벌써
 * 이어 고르고 있었는데 **웹은 한 사람을 고르면 목록이 닫혀서**
 * '다시 누르기'라는 것이 성립조차 안 했다.
 *
 * **클래스 이름만 보면 초록으로 뜨는 자리라 글자를 잰다.**
 */
ok(await page.$('.mention-list') !== null,
   '고른 뒤에도 언급 목록이 남는다 — 여럿을 이어 고르는 자리다');
ok(await page.$$eval('.mention-item.on .mention-check', e => e.length) === 1,
   '이미 부른 사람 줄에 체크가 붙는다');
await page.click('.mention-item:not(.is-all):not(.on)');
await page.waitForTimeout(250);
const twoIn = await page.$eval('.chat-input .textarea', el => el.value);
ok(/^@이관교 @\S+ $/.test(twoIn),
   `이어서 또 고르면 둘이 들어간다 (실제 ${JSON.stringify(twoIn)})`);
/* 목록은 **이름 가나다순**이라 어느 줄이 먼저 걸릴지는 자료가 정한다 —
   그래서 이름을 못박지 않고 **둘이던 것이 하나가 되는지**를 본다. */
await page.click('.mention-item.on');
await page.waitForTimeout(250);
const offOne = await page.$eval('.chat-input .textarea', el => el.value);
const left = offOne.trim().split(' ').filter(Boolean);
ok(left.length === 1 && twoIn.trim().split(' ').includes(left[0]),
   `이미 부른 사람을 다시 누르면 그 한 사람만 빠진다 (실제 ${JSON.stringify(offOne)})`);

await page.$eval('.chat-input .textarea', el => { el.value = ''; });
await page.keyboard.press('Backspace');
await page.waitForTimeout(200);

/* 멀리 내리면 닫힌다 — 위에서 닫아 버렸으면 한 번 더 연다. */
if (await page.$('.profile-full') === null) {
    await page.click('.chat-face');
    await page.waitForTimeout(400);
}
await dragSheet(200, 520);                      // 320px — 넉넉히 넘긴다
await page.waitForTimeout(500);
ok(await page.$('.profile-full') === null, '아래로 내리면 사라진다');

/* ── 6-1-1-3-1-9. 방 공지는 없앴다 ─────────────────────────────
 *
 * **사용자 요청으로 걷어냈다**(`채팅방 공지는 삭제해 줘`) — 되살리지 말 것.
 * DB 칸(`messages.pinned_at`·`pinned_by`)만 기록으로 남아 있고 화면은
 * 더는 읽지도 쓰지도 않는다.
 *
 * **없어진 것을 재는 칸이다.** 지운 코드가 되돌아오면 여기서 빨갛게 뜬다.
 */
console.log('\n── 방 공지는 없앴다 ──');
await go('/#/chat', 1200);
ok(await page.$('.chat-pin') === null, '대화 맨 위에 공지 줄이 없다');
const noPin = await page.$('[data-mid="m1"] .chat-bubble');
await noPin.click({ button: 'right' });
await page.waitForTimeout(300);
const pinMenu = await page.textContent('.chat-menu');
ok(!pinMenu?.includes('공지로 올리기') && !pinMenu?.includes('공지 내리기'),
   `창에도 공지 줄이 없다 (실제 ${JSON.stringify(pinMenu)})`);
await shutHold(page);

/* ── 6-1-1-3-1-10. 말풍선 반응 (카톡의 `😄 2`) ──────────────────
 *
 * 한마디마다 `네` `ㅋㅋ`로 답하면 하루 백 마디가 이백 마디가 된다.
 * **다는 곳은 길게 누르는 창이고**, 붙는 곳은 말풍선 아래 칩 줄이다.
 */
console.log('\n── 말풍선 반응 ──');
const reChips = await page.$$eval('[data-mid="m5"] .chat-react',
    els => els.map(e => e.textContent + (e.classList.contains('on') ? '*' : '')));
ok(JSON.stringify(reChips) === JSON.stringify(['👍3*', '❤️1']),
   `그림글자별로 묶어 세고 내가 누른 것만 갈라 보인다 (실제 ${JSON.stringify(reChips)})`);
/* **하나도 없으면 줄 자체가 없다** — 빈 자리를 늘 비워 두면 말풍선 사이가
   성겨진다. */
ok(await page.$('[data-mid="m1"] .chat-reacts') === null,
   '반응이 없는 글에는 줄 자체가 없다');
/* 창의 반응 줄. 다섯이 한 줄에 선다 — 늘리면 두 줄로 접혀 흐려진다. */
const plain = await page.$('[data-mid="m1"] .chat-bubble');
await plain.click({ button: 'right' });
await page.waitForTimeout(300);
const picks = await page.$$eval('.chat-menu-react', els => els.map(e => e.textContent));
ok(picks.length === 5, `창 맨 위에 고를 그림글자가 다섯 선다 (실제 ${picks.length})`);
/* 고르면 창이 닫히고 그 자리에 칩이 붙는다. */
await page.click('.chat-menu-react >> nth=0');
await page.waitForTimeout(500);
ok(await page.$('.chat-menu') === null, '고르면 창이 닫힌다');
const added = await page.textContent('[data-mid="m1"] .chat-react').catch(() => null);
ok(added === '👍1', `고른 그림글자가 그 말풍선에 붙는다 (실제 ${added})`);
/* **누른 것을 다시 누르면 떼어진다.** 칩을 눌러도 같다. */
await page.click('[data-mid="m1"] .chat-react');
await page.waitForTimeout(500);
ok(await page.$('[data-mid="m1"] .chat-reacts') === null,
   '칩을 다시 누르면 떼어지고, 마지막 하나가 빠지면 줄도 사라진다');
/* **가린 글에는 안 붙인다** — 덮어 둔 글에 좋다고 누를 일이 없다
   (복사·답장을 안 붙이는 것과 같은 잣대다). */
const hid = await page.$('[data-mid="m17"] .chat-hidden');
await hid.click({ button: 'right' });
await page.waitForTimeout(300);
ok(await page.$('.chat-menu-react') === null, '가린 글에는 반응 줄이 없다');
await shutHold(page);

/* ── 6-1-1-3-1-11. 머리말 — 카톡 오픈톡과 같은 배치 ──────────────
 *
 * 왼쪽에 제목과 사람 수, 오른쪽에 🔍와 ☰. **`←`(뒤로)는 안 둔다** —
 * 이 앱에서 대화는 탭이라 뒤로 갈 데가 없다.
 */
console.log('\n── 머리말 배치 ──');
const head = await page.evaluate(() => {
    const box = el => el?.getBoundingClientRect();
    const t = box(document.querySelector('.chat-title'));
    const f = box(document.querySelector('.chat-find'));
    const w = box(document.querySelector('.chat-who-btn'));
    return { t: t && Math.round(t.left), f: f && Math.round(f.left),
             w: w && Math.round(w.left), n: document.querySelector('.chat-title-n')?.textContent };
});
ok(head.t < head.f && head.f < head.w,
   `제목이 왼쪽, 🔍 ☰가 그 오른쪽에 선다 (제목 ${head.t} · 🔍 ${head.f} · ☰ ${head.w})`);
ok(Number(head.n) > 0, `사람 수는 제목 옆에 적는다 (실제 ${head.n})`);

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

/* ── 6-1-1-1-9. 접었다 펴면 그 사이 온 글이 붙는다 ──────────────
 *
 * 사용자 제보 — `채팅배너알림이 와서 그걸 눌러서 들어가면 채팅으로
 * 들어는가지는데 새로운 내용이 안나와. 그래서 투표눌렀다 다시 대화들어가면
 * 그제서야 나와`.
 *
 * 실시간은 **보고 있는 동안**만 맡는다. 앱을 접으면 그 연결이 끊기고
 * 다시 이어져도 그동안 들어온 글은 안 받아 오는데, **대화 알림을 눌러
 * 들어오는 길이 바로 그것**이라(껐다 켜는 게 아니라 접은 것을 펴는 것)
 * 화면도 새로 안 만들어져 첫 묶음 조회가 한 번도 다시 안 돌았다.
 * 탭을 옮겼다 오면 나오던 것은 그때 화면이 새로 만들어져서다.
 *
 * **여기서는 실시간이 아예 막혀 있어**(`stubOutside`) 접어 둔 폰과 같은
 * 상태가 된다 — `useRefreshOnShow`를 빼면 실제로 빨갛게 뜬다.
 * 알림함 칸의 그 검사와 같은 자리다.
 */
console.log('\n── 접었다 펴면 그 사이 온 글 ──');
{
    const rCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await rCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(rCtx);
    await rCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const rp = await rCtx.newPage();
    await rp.goto(BASE + '/#/chat', { waitUntil: 'networkidle' });
    await rp.waitForTimeout(1400);

    const before = await rp.$$eval('[data-mid]', e => e.length);
    ok(before > 0, `대화가 떴다 (말풍선 ${before}개)`);

    /* **가장 늦은 글보다 뒤에 둔다** — 화면은 마지막 글 뒤엣것만 받아 온다.
       고정 시각을 적으면 도구를 돌리는 시각에 따라 앞뒤가 뒤집힌다. */
    const newest = tables.messages
        .filter(m => m.room_id === 'room1')
        .reduce((a, m) => (m.created_at > a ? m.created_at : a), '');
    tables.messages.push({
        id: 'mAway', room_id: 'room1',
        // **남이 보낸 글로 둔다** — 내 글은 보낼 때 이미 넣어 두는 자리다.
        user_id: tables.messages.find(m => m.id === 'm1').user_id,
        body: '접어 둔 사이에 온 글입니다',
        created_at: new Date(Date.parse(newest) + 60_000).toISOString(),
    });

    await rp.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await rp.waitForTimeout(900);

    ok(await rp.$('[data-mid="mAway"]') !== null,
       '접어 두었다 펴면 그 사이 온 글이 붙는다');
    ok((await rp.textContent('.chat-list') ?? '').includes('접어 둔 사이에 온 글입니다'),
       '그 글의 내용이 그려진다');
    /* **통째로 다시 받지 않는다** — 지난 글이 그대로 남아 있어야 굴려 둔
       자리도, `여기까지 읽으셨습니다` 줄도 안 잃는다. */
    const after = await rp.$$eval('[data-mid]', e => e.length);
    ok(after === before + 1,
       `지난 글은 그대로 두고 새 글만 덧붙인다 (${before} → ${after})`);

    // 고정 자료를 되돌린다 — 뒤에 오는 칸들이 개수를 센다.
    tables.messages.pop();
    await rCtx.close();
}

/* ── 6-1-1-1-10. 누르는 즉시 올라가고, 두 번 눌러도 한 번만 ────────
 *
 * 사용자 제보 — `전송 버튼을 누르면 채팅이 올라가는데 딜레이가 생겨.
 * 그래서 혹시 멈췄나 싶어서 다시 누르면 두 번이 올라갈 때가 있어.`
 *
 * 예전에는 **서버에 넣고 답이 온 뒤에야** 말풍선을 그리고 글칸을 비웠다 —
 * 그 왕복이 인터넷 한 바퀴라, 그동안 화면에는 아무 일도 안 일어나고
 * 친 글도 칸에 그대로 남아 있었다.
 *
 * **여기서는 그 왕복을 일부러 900ms로 늘린다** — 빠른 서버에서는 둘이
 * 구별이 안 되기 때문이다(`jank.mjs`에서 CPU를 느리게 거는 것과 같은 결).
 * 고치기 전 코드로 되돌리면 네 줄이 다 빨갛게 뜬다.
 *
 * **창을 넓게 잡아 Enter로 보낸다**(640px부터가 그 길이다). 단추로
 * 누르면 `disabled={sending}`에 막혀 **웹에서는 두 번째가 애초에 안
 * 눌리는데**, 정작 문제가 난 앱에서는 보내기가 **네이티브 단추**라
 * 그 막이 없다 — 단추를 눌러 재면 고치기 전 코드도 초록으로 떠서
 * 아무 뜻이 없다. Enter는 `send()`를 곧바로 부르므로 앱과 같은 길이다.
 */
console.log('\n── 보내면 바로 올라간다 ──');
{
    const sCtx2 = await browser.newContext({
        viewport: { width: 700, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await sCtx2.route('**/rest/v1/**', restRoute(tables));
    let posts = 0;
    await sCtx2.route('**/rest/v1/messages**', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        posts++;
        const sent = route.request().postDataJSON();
        // 느린 인터넷인 척한다 — 답이 오기 전의 화면을 봐야 한다.
        await new Promise(r => setTimeout(r, 900));
        await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                id: `sent${posts}`, created_at: new Date().toISOString(), ...sent }),
        });
    });
    await stubOutside(sCtx2);
    await sCtx2.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const sp = await sCtx2.newPage();
    await sp.goto(BASE + '/#/chat', { waitUntil: 'networkidle' });
    await sp.waitForTimeout(1400);

    const had = await sp.$$eval('[data-mid]', e => e.length);
    await sp.click('.chat-input .textarea');
    await sp.fill('.chat-input .textarea', '지금 바로 올라가야 합니다');
    await sp.press('.chat-input .textarea', 'Enter');
    /* **멈춘 줄 알고 곧바로 한 번 더 누른다** — 답이 오기 전이다.
       고치기 전에는 글칸이 안 비워져 같은 글을 다시 읽어 두 줄이 나갔다. */
    await sp.press('.chat-input .textarea', 'Enter');
    // 서버가 답하기 한참 전이다(900ms 중 250ms).
    await sp.waitForTimeout(250);

    ok((await sp.textContent('.chat-list') ?? '').includes('지금 바로 올라가야 합니다'),
       '답을 기다리지 않고 말풍선이 먼저 올라간다');
    ok(await sp.$eval('.chat-input .textarea', el => el.value) === '',
       '글칸도 그 자리에서 비워진다');

    await sp.waitForTimeout(1600);
    ok(posts === 1, `두 번 눌러도 한 줄만 나간다 (${posts}번)`);

    const now = await sp.$$eval('[data-mid]', e => e.length);
    ok(now === had + 1, `말풍선도 하나만 남는다 (${had} → ${now})`);

    await sCtx2.close();
}

/* ── 6-1-1-2. 앱 가이드로 들어가는 문 ───────────────────────────
 *
 * **`내 정보` 메뉴에 있다**(사용자 요청 — 홈 머리말의 그 자리를 🔔 알림에
 * 내주었다). 한동안 홈 머리말에 있었는데, 거기 단추를 둘 세우면 얼굴까지
 * 셋이라 이름이 긴 분의 화면에서 줄이 접힌다.
 *
 * **두 자리를 함께 본다** — 메뉴에 있는가, 그리고 홈 머리말에서
 * **빠졌는가**(양쪽에 두면 어디로 들어갔는지가 헷갈린다).
 */
console.log('\n── 앱 가이드로 들어가는 문 ──');
await go('/#/', 900);
const guide = await page.$$eval('.page-head a', e => e.map(x => x.getAttribute('href')));
ok(!guide.some(h => h?.includes('/help')),
   `홈 머리말에는 없다 — 그 자리는 🔔이다 (실제 ${JSON.stringify(guide)})`);
ok(guide.some(h => h?.includes('/alerts')), '그 자리에 알림함으로 가는 종이 있다');
ok(guide.some(h => h?.includes('/me')), '얼굴은 그대로 내 정보로 간다');

/* **얼굴이 이름 왼쪽, 종이 오른쪽이다**(사용자 요청 — `종 옆에 프로필을
   … 왼쪽으로 옮기고 기존 프로필 자리에 알림을 옮겨줘`).
   자리를 재서 붙들어 둔다 — 클래스만 보면 CSS가 뒤집혀도 초록으로 뜬다. */
const headPos = await page.evaluate(() => {
    const r = s => document.querySelector(s)?.getBoundingClientRect();
    const mid = b => b && b.top + b.height / 2;
    const face = r('.head-me .avatar'), name = r('.head-me .page-title');
    return {
        face: face?.left, name: name?.left,
        bell: r('.head-side .bell')?.left,
        sideLinks: document.querySelectorAll('.head-side a').length,
        // 인사말은 얼굴 옆이 아니라 **그 위, 왼쪽 끝**이다.
        greet: r('.head-me > .sm.faint')?.left,
        // 얼굴과 이름의 세로 가운데가 맞는가.
        gap: Math.abs(mid(face) - mid(name)),
    };
});
ok(headPos.face != null && headPos.name != null && headPos.face < headPos.name,
   `얼굴이 이름 왼쪽에 있다 (얼굴 ${headPos.face} < 이름 ${headPos.name})`);
ok(headPos.bell != null && headPos.bell > headPos.name,
   '종은 오른쪽 끝에 홀로 선다');
ok(headPos.sideLinks === 1,
   `오른쪽에는 종 하나뿐이다 (${headPos.sideLinks}개)`);

/* **인사말은 얼굴 위, 왼쪽 끝이다**(사용자 요청 — `안녕하세요는 왼쪽으로
   당기고`). 얼굴 옆 묶음에 넣으면 그 너비만큼 안으로 밀린다 — 그때는
   `안녕하세요`가 얼굴보다 오른쪽에서 시작해 여기가 빨갛게 뜬다. */
ok(headPos.greet != null && headPos.greet <= headPos.face,
   `인사말이 얼굴과 같은 왼쪽 끝에서 시작한다 (인사말 ${headPos.greet} ≤ 얼굴 ${headPos.face})`);

/* **얼굴은 이름 줄과 나란히 선다**(사용자 요청 — `프로필을 조금 내려서
   악마제리님과 정렬을 맞춰주고`). 인사말까지 아우르는 가운데에 두면
   두 줄 사이에 걸쳐 **13px쯤 위로 뜬다** — 그 자국을 숫자로 잡는다. */
ok(headPos.gap != null && headPos.gap <= 2,
   `얼굴 가운데가 이름 줄과 맞는다 (어긋남 ${headPos.gap?.toFixed(1)}px)`);
await go('/#/me', 900);
ok((await page.textContent('.page') ?? '').includes('앱 사용자 가이드'),
   '내 정보 메뉴에 가이드가 있다');
await go('/#/help', 900);
ok((await page.textContent('.page') ?? '').includes('앱 사용자 가이드'),
   '눌러 들어가면 가이드가 열린다');

/* ── 6-1-1-3. 홈 `내가 할 일`의 투표 줄 ────────────────────────
 *
 * **누르면 그 투표로 들어가야 한다**(사용자 제보 — `투표를 누르면 해당
 * 투표로 가야 되는데 그냥 투표 택바 메뉴로만 가지고`). 밑의 라운드 줄은
 * 진작 그 라운드로 들어갔는데 투표만 `/polls`(목록)로 하드코딩돼 있었다 —
 * 마감된 것이 쌓인 주에는 어느 것이었는지 다시 찾아야 한다. **알림을
 * 누르면 목록이 아니라 그 건으로 가는 것과 같은 잣대다.**
 *
 * **고정 자료에서는 내가 p1에 이미 표를 던져 놓아** 이 줄이 안 뜬다
 * (`v7`). 그래서 여기서만 **내 표를 빈손으로 돌려준다** — 아직 안 한
 * 투표가 있는 상태를 만드는 것이지 다른 칸은 그대로다.
 */
console.log('\n── 홈의 `내가 할 일` 투표 줄 ──');
{
    const hCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await hCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(hCtx);
    // 내 표만 빈손으로 — `내가 할 일`에 안 한 투표가 서게 한다.
    await hCtx.route('**/rest/v1/poll_votes**', route => {
        const u = route.request().url();
        if (route.request().method() !== 'GET' || !u.includes(`user_id=eq.${ME}`))
            return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await hCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const hp = await hCtx.newPage();
    await hp.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await hp.waitForTimeout(900);

    const pollRow = await hp.$$eval('.home-row', els => els
        .filter(e => e.querySelector('.badge')?.textContent === '투표')
        .map(e => e.getAttribute('href')));
    ok(pollRow.length > 0, `\`내가 할 일\`에 안 한 투표가 선다 (${pollRow.length}줄)`);
    /* **목록(`#/polls`)이 아니라 `#/polls/<id>`여야 한다.** 옛 코드로
       되돌리면 여기가 빨갛게 뜬다. */
    ok(pollRow.every(h => /#\/polls\/[^/]+$/.test(h ?? '')),
       `투표 줄이 그 투표로 간다 (실제 ${JSON.stringify(pollRow)})`);

    // 진짜로 눌러서 상세가 열리는지까지 본다.
    await hp.click('.home-row:has(.badge:text-is("투표"))');
    await hp.waitForTimeout(700);
    ok((await hp.evaluate(() => location.hash)).startsWith('#/polls/p'),
       `눌러 들어가면 그 투표다 (${await hp.evaluate(() => location.hash)})`);
    ok((await hp.textContent('.page') ?? '').includes('9월 정기 라운드 날짜'),
       '그 투표의 제목이 보인다');
    await hCtx.close();
}

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
 * 오타도 난다. **달력은 우리가 직접 그린다**(`components/DayCal`) — 날을
 * 누르면 그 자리에서 항목이 되고, 다시 누르면 빠진다. 보는 것이 넷이다:
 *   ① **열어만 두면 아무 항목도 안 생긴다** — 브라우저 날짜 칸을 쓰면
 *      아이폰이 누르는 순간 오늘을 던져 **고르기도 전에 오늘이 항목이
 *      된다**(실제 제보). 직접 그린 달력에는 그 신호 자체가 없다.
 *   ② 누르면 요일까지 붙어 항목이 된다.
 *   ③ **빈 줄부터 채운다** — 새 투표는 빈 칸 두 개로 시작하는데 아래에 새
 *      줄을 붙이면 화면에 빈 칸이 남아 안 적은 것처럼 보인다.
 *   ④ 같은 날짜를 다시 누르면 빠진다(두 번 안 들어간다).
 */
console.log('\n── 투표에 날짜 넣기 ──');
const dayCells = () => page.$$eval('.option-row .input', e => e.map(x => x.value));
await go('/#/polls/new', 600);
ok((await dayCells()).every(v => !v),
   `칸을 열어만 두면 아무 항목도 안 생긴다 (실제 ${JSON.stringify(await dayCells())})`);

const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const lab = d => {
    const x = new Date(now.getFullYear(), now.getMonth(), d);
    return `${x.getMonth() + 1}월 ${d}일 (${'일월화수목금토'[x.getDay()]})`;
};
const tapDay = async d => {
    await page.evaluate(n => [...document.querySelectorAll('.poll-date .cal-day')]
        .find(b => b.textContent.trim() === String(n))?.click(), d);
    await page.waitForTimeout(150);
};

await tapDay(5);
await tapDay(12);
const opts = await dayCells();
ok(opts[0] === lab(5) && opts[1] === lab(12),
   `고른 날이 요일까지 붙어 항목이 된다 (실제 ${JSON.stringify(opts)})`);
ok(opts.length === 2, `빈 줄부터 채운다 — 줄이 늘지 않는다 (실제 ${opts.length}줄)`);
ok(await page.$$eval('.poll-date .cal-day.on', e => e.length) === 2,
   '고른 날이 달력에도 칠해진다');

await tapDay(12);
const off = await dayCells();
ok(off.filter(v => v).length === 1 && off.includes(lab(5)),
   `같은 날을 다시 누르면 빠진다 (실제 ${JSON.stringify(off)})`);

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
 * **보이는 사람은 운영진뿐이다**(사용자 요청) — 고정 자료의 나(ME)는
 * 앱관리자라 여기서는 보이고, 아래 일반회원 칸에서는 안 보여야 한다.
 */
console.log('\n── 회원 명단의 참석 횟수 ──');
await go('/#/members', 800);
const rows = await page.$$eval('.member-row', e => e.map(x => x.textContent));
const line = n => rows.find(t => t.includes(n)) ?? '';
ok(line('신성호').includes('올해 1회'), `나간 사람은 횟수가 붙는다 (실제 ${JSON.stringify(line('신성호'))})`);
ok(line('정우성').includes('올해 0회'),
   `앞으로의 라운드만 신청한 사람은 0회다 (실제 ${JSON.stringify(line('정우성'))})`);

/* **생년월일도 운영진만 본다**(사용자 요청 — `개인정보는 운영진만 확인할
   수 있게`). 해는 `profiles`(공개)에, 달·날은 `profile_private`(운영진만)에
   있어 **화면이 둘을 합쳐야 한 줄이 된다**(`birthLabel`).
   **글자를 잰다** — 클래스만 보면 해만 적혀 있어도 초록으로 뜬다. */
ok(line('신성호').includes('1972년 5월 10일'),
   `운영진에게는 생년월일이 보인다 (실제 ${JSON.stringify(line('신성호').match(/양력[^·]*|음력[^·]*/)?.[0] ?? '없음')})`);
ok(line('이관교').includes('음력'),
   `음력으로 적은 사람은 음력이라고 적는다 (실제 ${JSON.stringify(line('이관교').match(/[양음]력[^\n]*/)?.[0] ?? '없음')})`);
ok(!line('오세훈').includes('🎂'),
   '안 적은 사람은 그 줄을 아예 안 그린다 — 해만 덩그러니 적지 않는다');

/* **참석 횟수는 운영진만 본다**(사용자 요청). 화면에서 감추는 것만으로
   끝내지 않고 DB도 막아 두었지만(`attendance_counts`가 `is_admin()`을 본다),
   **일반회원은 애초에 안 부른다** — 헛조회를 내보낼 이유가 없다.
   **흉내는 누가 불러도 숫자를 돌려주므로** 화면에서 안 막으면 그대로
   보인다 — 막는 줄을 빼면 실제로 세 줄이 빨갛게 뜬다. */
const aCtx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const aSession = { ...SESSION, user: { ...SESSION.user, id: uid(5) } };  // 정우성 — 일반회원
const aRpc = [];
await aCtx.route('**/rest/v1/**', restRoute(tables));
await aCtx.route('**/rest/v1/rpc/**', route => {
    aRpc.push(new URL(route.request().url()).pathname.split('/').pop());
    route.fallback();
});
await aCtx.route('**/auth/v1/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(aSession) }));
await stubOutside(aCtx);
await aCtx.addInitScript(s =>
    localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), aSession);

const aPage = await aCtx.newPage();
await aPage.goto(BASE + '/#/members', { waitUntil: 'networkidle' });
await aPage.waitForTimeout(900);
const aRows = (await aPage.$$eval('.member-row', e => e.map(x => x.textContent))).join(' ');
ok(!/올해 \d+회/.test(aRows),
   `일반회원 명단에는 참석 횟수가 없다 (실제 ${JSON.stringify(aRows.match(/올해 \d+회/)?.[0] ?? '없음')})`);
ok(!aRpc.includes('attendance_counts'), '일반회원은 그 조회를 아예 안 보낸다');

/* **생년월일도 같은 잣대다.** 흉내는 누가 불러도 달·날을 돌려주므로
   (진짜는 정책이 자기 한 줄만 준다) **화면에서 안 막으면 그대로 보인다** —
   `isAdmin &&`를 빼면 여기가 빨갛게 뜬다. */
ok(!/\d+년 \d+월 \d+일/.test(aRows),
   `일반회원 명단에는 생년월일이 없다 (실제 ${JSON.stringify(aRows.match(/\d+년 \d+월 \d+일/)?.[0] ?? '없음')})`);

/* **대화의 프로필 화면도 같은 잣대다** — 한쪽만 고치면 명단에서 감춰 놓고
   대화에서 그대로 보여 준다. */
await aPage.goto(BASE + '/#/chat', { waitUntil: 'networkidle' });
await aPage.waitForTimeout(1200);
await aPage.click('.chat-who-btn');
await aPage.waitForTimeout(400);
await aPage.click('.chat-person');
await aPage.waitForTimeout(400);
const aCard = (await aPage.textContent('.profile-full')) ?? '';
ok(!!aCard && !/올해 \d+회/.test(aCard),
   `대화 프로필 화면에도 안 적는다 (실제 ${JSON.stringify(aCard.slice(0, 40))})`);
await aCtx.close();

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

/* **`참석`을 걷어내고 그 자리에 `성별`을 넣었다**(사용자 요청).
   참석 횟수는 줄마다 `올해 N회`로 그대로 보이지만, 성별은 그 줄에 글자로
   안 적혀 있어(얼굴 테두리 색으로만 갈린다) 모아 보려면 차례밖에 없다. */
const byGender = await pick('성별');
ok(byGender.slice(0, 5).join() === ['김지명', '박승수', '신성호', '이관교', '장동건'].join(),
   `성별은 남자가 먼저, 그 안에서 이름순이다 (실제 ${JSON.stringify(byGender.slice(0, 5))})`);
ok(byGender.slice(5, 7).join() === ['임채원', '정우성'].join(),
   `그다음이 여자다 (실제 ${JSON.stringify(byGender.slice(5, 7))})`);
ok(byGender.at(-1) === '오세훈',
   '성별을 안 적은 사람은 맨 뒤다 — 모르는 값은 늘 뒤로 보낸다');

/* 고른 차례가 **눌린 것으로 보이는가.** 안 보이면 지금 무슨 차례인지
   알 수 없어 같은 칩을 또 누르게 된다. */
const on = await page.$$eval('.sort-chip[aria-pressed="true"]', e => e.map(x => x.textContent));
ok(on.length === 1 && on[0] === '성별',
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
await bPage.waitForTimeout(300);
/* **생일의 달·날도 필수다**(사용자 요청 — `첫 가입때 음력 또는 양력
   생년월일을 받고`). 해만 받던 칸이 `생년월일` 한 줄이 되면서 늘었다. */
ok(bWrites.length === 0, '생일의 달·날이 비면 저장을 안 보낸다');

const bPriv = [];
await bCtx.route('**/rest/v1/profile_private**', route => {
    if (route.request().method() === 'GET') return route.fallback();
    bPriv.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});
await bPage.fill('[aria-label="태어난 달"]', '5');
await bPage.fill('[aria-label="태어난 날"]', '10');
await bPage.locator('.opt', { hasText: '음력' }).first().click();
await bPage.getByText('저장하고 시작하기', { exact: true }).click();
await bPage.waitForTimeout(500);
ok(bWrites.length === 1 && bWrites[0].gender === 'm' && bWrites[0].birth_year === 1985
   && bWrites[0].region === '광산구',
   `다 적으면 저장한다 (보낸 값 ${JSON.stringify(bWrites[0])})`);
/* **해와 달·날이 다른 표로 갈라져 나간다** — 해는 공개(`profiles`),
   달·날은 운영진만 보는 표(`profile_private`)다. 한쪽만 고치면 생년월일이
   반쪽만 남는다. */
ok(bPriv.length === 1 && bPriv[0].birth_md === '05-10' && bPriv[0].birth_cal === 'lunar',
   `달·날과 양력/음력은 다른 표로 간다 (보낸 값 ${JSON.stringify(bPriv[0])})`);
/* **전화번호·차량번호를 빈 값으로 덮어쓰지 않는다** — 여기서 안 물어본
   칸이라, `upsert`가 보낸 칸만 고치는 것이 그 장치다. */
ok(bPriv[0] && !('phone' in bPriv[0]) && !('car' in bPriv[0]),
   '안 물어본 칸은 저장에 안 끼워 넣는다');
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
const MISSING = ['round_groups', 'settle_reminders', 'profile_private',
                 'message_reactions'];
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
    /* **고르는 칸만 보면 안 된다 — 거르는 칸도 400이다.**
       `select('*')`로 받으면서 없는 칸으로 거르는 조회가 있으면, 여기서
       안 걸러 주면 그 길을 아예 안 타서 **시험은 통과하는데 실기기에서는
       화면이 통째로 안 열린다**(진짜 PostgREST는 없는 칸이면 고르든
       거르든 400이다). 없앤 `방 공지`가 그 길을 만들었던 자리다 —
       `pinned_at`을 목록에 남겨 둔 것은 **아무 조회도 그 칸을 다시 묻지
       않는지** 여기서 함께 붙들어 두려는 것이다. */
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

/* ── 12. 늦게 뜬 사진이 읽던 자리를 밀어내지 않는가 ───────────────
 *
 * **앱에 처음 들어가 대화를 위로 올릴 때만 유독 끊긴다**는 제보에서 나온
 * 것이다(두 번째부터는 멀쩡했다). 사진은 화면에 보일 때가 되어야 받아
 * 오고(`loading="lazy"`) 받기 전에는 높이가 거의 0이라, 위로 훑는 도중에
 * 화면 위쪽 사진이 도착하면 그만큼 글이 통째로 아래로 밀린다.
 *
 * **크로미움은 알아서 메워 주고(scroll anchoring) 사파리는 안 한다.**
 * 그래서 `.chat-list`에서 브라우저 것을 끄고(`overflow-anchor: none`)
 * `onImageLoad`가 직접 메운다 — 그 덕에 **헤드리스로 잰 것이 폰에서도 맞는다.**
 *
 * 재는 법: 한 프레임에 60px씩 올리며 붙박아 둔 말풍선이 딱 60px씩
 * 내려오는지 본다. 메우는 줄을 빼면 여기서 125px씩 네 번 튄다.
 */
console.log('\n── 늦게 뜬 사진 ──');
{
    const at = i => new Date(new Date().setHours(9, 0, 0, 0) + i * 60000).toISOString();
    const others = tables.profiles.filter(p => p.id !== ME).map(p => p.id);
    const long = [];
    /* **미리 받아 두는 몫(`WARM_PHOTOS`)보다 사진이 훨씬 많아야 한다.**
       적으면 스크롤 전에 다 받아져 목록이 안 자라고, 그러면 이 검사가
       확인하려던 자리를 아예 안 지나간다(실제로 그렇게 헛돌았다). */
    for (let i = 0; i < 120; i++) {
        const photo = i % 2 === 0;   // 예순 장이 화면 위쪽에서 늦게 뜬다
        long.push({ id: `x${i}`, room_id: 'room1',
            user_id: i % 4 === 0 ? ME : others[i % others.length],
            body: photo ? '' : `${i}번째 이야기입니다 오늘 라운드 좋았습니다`,
            image_url: photo ? `http://photo.test/${i}.svg` : null,
            created_at: at(i) });
    }
    const pCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await pCtx.route('**/rest/v1/**', restRoute({ ...tables, messages: long }));
    // 사진은 **늦게** 온다 — 그게 이 자리의 전부다.
    await pCtx.route('**photo.test/**', async route => {
        await new Promise(r => setTimeout(r, 150));
        route.fulfill({ status: 200, contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">'
                + '<rect width="640" height="420" fill="#2c7a52"/></svg>' });
    });
    await pCtx.route('**/auth/v1/**', r => r.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
    await stubOutside(pCtx);
    await pCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const pPage = await pCtx.newPage();
    await pPage.goto(BASE + '/#/chat', { waitUntil: 'networkidle' });
    await pPage.waitForSelector('.chat-list .chat-row', { timeout: 15000 });
    await pPage.waitForTimeout(300);

    const climb = () => pPage.evaluate(async () => {
        const el = document.querySelector('.chat-list');
        const frame = () => new Promise(r => requestAnimationFrame(r));
        const rows = [...el.querySelectorAll('[data-mid]')];
        const mark = (rows.find(r => {
            const t = r.getBoundingClientRect().top;
            return t > 300 && t < 600;
        }) ?? rows[rows.length - 1]).getAttribute('data-mid');
        const moves = [];
        let prev = el.querySelector(`[data-mid="${mark}"]`).getBoundingClientRect().top;
        const grew0 = el.scrollHeight;
        /* **미리 받아 둔 자리를 지나 더 올라가야 한다** — 짧게 훑으면 사진이
           이미 다 받아져 있어 목록이 안 자라고, 검사가 헛돈다. */
        for (let i = 0; i < 130; i++) {
            el.scrollTop = Math.max(0, el.scrollTop - 60);
            await frame();
            const node = el.querySelector(`[data-mid="${mark}"]`);
            if (!node) break;
            const top = node.getBoundingClientRect().top;
            moves.push(top - prev);
            prev = top;
            if (el.scrollTop === 0) break;
        }
        // 맨 위에 닿은 마지막 프레임은 60px을 다 못 올리므로 뺀다.
        return { off: moves.slice(0, -1).filter(m => Math.abs(m - 60) > 2).length,
                 grew: el.scrollHeight - grew0 };
    });

    const first = await climb();
    ok(first.grew > 0, `첫 스크롤에서 사진이 늦게 떠 목록이 자란다 (${first.grew}px — 안 자라면 이 검사가 뜻이 없다)`);
    /* **한 프레임은 봐준다.** 0으로 못박아 두었더니 세 번에 한 번쯤
       빨갛게 떴다 — 프레임마다 재는 검사라 서버가 바쁘면 한 번씩 어긋난다
       (`jank.mjs`가 `한 번만 재지 말 것`이라고 적어 둔 것과 같은 결이다).
       메우는 줄을 빼면 **125px씩 네 번** 튀므로 이 여유로도 그대로 잡힌다. */
    ok(first.off <= 1, `늦게 뜬 사진이 읽던 자리를 밀어내지 않는다 (튄 프레임 ${first.off}개)`);

    await pPage.evaluate(() => {
        const el = document.querySelector('.chat-list');
        el.scrollTop = el.scrollHeight;
    });
    await pPage.waitForTimeout(800);
    const again = await climb();
    ok(again.off === 0 && again.grew === 0,
       `두 번째 스크롤은 사진이 다 받아져 있어 자라지도 튀지도 않는다 (${again.grew}px · ${again.off}개)`);
    await pCtx.close();
}

/* ── 13. 사진을 크게 보면 벌려서 키울 수 있는가 ────────────────────
 *
 * 앱 안 웹뷰는 화면 자체를 벌려 키우는 것을 안 받아 준다(받아 준들
 * 입력칸·탭바까지 같이 커진다). 그래서 **사진만 우리가 키운다**
 * (`PhotoZoom` in Chat.tsx) — 웹과 앱이 같은 길을 타므로 여기서 잰
 * 것이 폰에서도 맞는다.
 *
 * **손가락 둘은 직접 만들어야 한다** — playwright의 `touchscreen`은
 * `tap`뿐이라 벌리는 손짓이 없다. `new Touch`로 지어 던진다.
 *
 * **닫는 규칙이 여기 걸려 있다** — 사진을 한 번 누른 그 자리에서
 * 닫아 버리면 두 번 누르기가 아예 성립하지 않는다(첫 누름에서 창이
 * 사라진다). 그래서 닫는 것은 사진 **바깥**과 `✕`가 맡는다.
 */
console.log('\n── 사진 크게 보기 ──');
{
    const zCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR',
        timezoneId: 'Asia/Seoul', hasTouch: true, isMobile: true });
    await zCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(zCtx);
    await zCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const zp = await zCtx.newPage();
    await zp.goto(`${BASE}/#/chat`);
    await zp.waitForSelector('.chat-list', { timeout: 20000 });

    const IMG = '.photo-zoom img';
    const openZ = async () => {
        if (await zp.$('.photo-zoom-view')) return;
        await zp.click('.chat-photo-link');
        await zp.waitForSelector('.photo-zoom-view', { timeout: 5000 });
    };
    const at = () => zp.$eval(IMG, el => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return { s: +m.a.toFixed(2), x: Math.round(m.e), y: Math.round(m.f) };
    });
    const alive = async () => !!(await zp.$('.photo-zoom'));
    /* 두 손가락을 `from`px 벌린 데서 `to`px까지 벌린다(가운데 고정). */
    const pinch = (from, to) => zp.evaluate(([f, t]) => {
        const el = document.querySelector('.photo-zoom-view');
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const mk = (id, x, y) => new Touch({ identifier: id, target: el,
            clientX: x, clientY: y, pageX: x, pageY: y });
        const fire = (type, d) => {
            const a = mk(1, cx - d / 2, cy), c = mk(2, cx + d / 2, cy);
            el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
                touches: type === 'touchend' ? [] : [a, c],
                targetTouches: type === 'touchend' ? [] : [a, c],
                changedTouches: [a, c] }));
        };
        fire('touchstart', f);
        for (let i = 1; i <= 8; i++) fire('touchmove', f + (t - f) * (i / 8));
        fire('touchend', t);
    }, [from, to]);

    await openZ();
    ok((await at()).s === 1, '열면 1배다');

    await zp.dblclick(IMG);
    await zp.waitForTimeout(100);
    const twice = await at();
    ok(twice.s > 1, `두 번 누르면 커진다 (${twice.s}배)`);

    await zp.waitForTimeout(400);
    await zp.click(IMG);
    await zp.waitForTimeout(150);
    ok(await alive(), '키워 둔 동안에는 눌러도 안 닫힌다');

    await zp.waitForTimeout(400);
    await zp.dblclick(IMG);
    await zp.waitForTimeout(100);
    ok((await at()).s === 1, '다시 두 번 누르면 1배로 되돌아온다');

    await zp.waitForTimeout(400);
    await pinch(100, 300);
    const wide = await at();
    ok(wide.s > 1.5, `손가락으로 벌리면 커진다 (${wide.s}배)`);

    await pinch(300, 60);
    const home = await at();
    ok(home.s === 1 && home.x === 0 && home.y === 0,
       '오므리면 1배·가운데로 되돌아온다');

    /* **넘칠 만큼 키워 두고 재야 뜻이 있다** — 사진이 창보다 작으면
       옮길 자리가 없어 한도가 0이라 검사가 헛돈다. */
    await pinch(60, 400);
    await pinch(60, 400);
    await zp.evaluate(() => {
        const el = document.querySelector('.photo-zoom-view');
        const mk = (x, y) => new Touch({ identifier: 1, target: el,
            clientX: x, clientY: y, pageX: x, pageY: y });
        const fire = (type, x, y) => el.dispatchEvent(new TouchEvent(type, {
            bubbles: true, cancelable: true,
            touches: type === 'touchend' ? [] : [mk(x, y)],
            targetTouches: type === 'touchend' ? [] : [mk(x, y)],
            changedTouches: [mk(x, y)] }));
        fire('touchstart', 195, 400);
        for (let i = 1; i <= 10; i++) fire('touchmove', 195, 400 - i * 200);
        fire('touchend', 195, -1600);
    });
    const moved = await at();
    const cap = await zp.evaluate(() => {
        const v = document.querySelector('.photo-zoom-view');
        const i = document.querySelector('.photo-zoom img');
        const m = new DOMMatrixReadOnly(getComputedStyle(i).transform);
        return Math.max(0, (i.offsetHeight * m.a - v.clientHeight) / 2);
    });
    ok(cap > 20 && moved.y < -20 && Math.abs(moved.y) <= cap + 1,
       `끌면 옮겨지되 테두리 안에 머문다 (${moved.s}배 · y ${moved.y} · 한도 ${Math.round(cap)})`);

    /* 닫는 길 — 사진을 누르는 것이 아니라 바깥과 `✕`다. */
    await pinch(400, 60);
    await zp.waitForTimeout(400);
    await zp.click(IMG);
    await zp.waitForTimeout(200);
    ok(await alive(), '1배에서 사진을 누르는 것으로는 안 닫힌다');

    await zp.waitForTimeout(400);
    await zp.click('.photo-zoom-view', { position: { x: 6, y: 120 } });
    await zp.waitForTimeout(200);
    ok(!(await alive()), '사진 바깥을 누르면 닫힌다');

    /* 저장·공유가 도는 동안 잠긴다 — 저장은 몇 초 걸리는데 그동안
       아무 말이 없어 또 눌러 **같은 사진이 여러 장 저장됐다**(제보).
       웹 갈래는 눈 깜짝할 새라 느린 공유창을 흉내 내 그 사이를 본다. */
    await openZ();
    await zp.evaluate(() => {
        navigator.share = () => new Promise(r => setTimeout(r, 1200));
        navigator.canShare = () => true;
    });
    await zp.click('.photo-zoom-btn >> nth=0');
    await zp.waitForTimeout(250);
    const locked = await zp.$$eval('.photo-zoom-btn', els => els.map(e => e.disabled));
    ok(locked[0] && locked[1], '저장이 도는 동안 단추가 잠긴다');
    const label = await zp.$eval('.photo-zoom-btn', e => e.textContent.trim());
    ok(label.startsWith('저장 중'), `도는 동안 \`저장 중…\`으로 바뀐다 (${label})`);

    /* **토스트가 이 창보다 위여야 한다.** 900으로 두었더니 `저장했습니다`가
       사진(1000) 밑에 깔려 안 보였고, 그것이 곧 여러 장 저장된 원인이었다. */
    const layer = await zp.evaluate(() => {
        const zoom = +getComputedStyle(document.querySelector('.photo-zoom')).zIndex;
        const el = document.createElement('div');
        el.className = 'toast-stack';
        document.body.appendChild(el);
        const t = +getComputedStyle(el).zIndex;
        el.remove();
        return { zoom, t };
    });
    ok(layer.t > layer.zoom,
       `알림 말풍선이 사진 화면보다 위다 (토스트 ${layer.t} · 사진 ${layer.zoom})`);

    /* **지워진 사진 자리.** 무료 저장 공간이 쌓이기만 해서 90일이 지난
       사진은 걷어 낸다(`lib/photos.ts`) — 그 뒤에 그 글을 열면 그림을
       못 받아 오므로, 카톡처럼 `저장 기간이 만료되었습니다`로 바뀌어야
       한다. 안 그러면 깨진 그림 표만 남아 고장으로 보인다.
       **자리는 그대로 차지해야 한다** — 줄어들면 읽던 자리가 튄다
       (이모티콘 조각에서 겪은 그 자리다). */
    const before = await zp.$eval('.chat-image',
        el => Math.round(el.getBoundingClientRect().height));
    await zp.$eval('.chat-image', el => {
        el.dispatchEvent(new Event('error'));   // 사진이 지워진 것과 같은 자리
    });
    await zp.waitForTimeout(200);
    const gone = await zp.$eval('.chat-photo-gone', el => ({
        글: el.textContent.replace(/\s+/g, ' ').trim(),
        높이: Math.round(el.getBoundingClientRect().height),
    })).catch(() => null);
    ok(gone?.글?.includes('만료'), `못 받아 온 사진은 만료로 바뀐다 (${gone?.글 ?? '안 바뀜'})`);
    ok(gone != null && Math.abs(gone.높이 - before) < before,
       `그 자리도 사진만큼 차지한다 (${before}px → ${gone?.높이}px)`);

    await zCtx.close();
}

/* ── 14. 손가락을 따라 뒤로 가는가 ────────────────────────────────
 *
 * 아이폰의 그 손짓이다(사용자 요청 — `아이폰처럼 손가락따라가면서
 * 뒤로가기`). **앞 화면은 떠날 때 찍어 둔 죽은 그림이다**(`lib/tabs.ts`의
 * `snap`) — 리액트로 한 번 더 그리면 읽음 찍기·결과 알리기 같은 딸린
 * 일까지 다시 돈다.
 *
 * **여기서 잡은 것이 둘이다:**
 *  1. 이 앱은 **해시 라우팅**이라 `pathname`이 늘 `/`다. 그것으로 가리면
 *     모든 길이 탭으로 보여 **그림을 한 장도 안 찍는다**(앞 화면이 늘 빈
 *     채로 깔렸다). `routeOf`가 해시를 본다.
 *  2. 끌다가 **멈추고 놓았는데도 넘어갔다** — 마지막 빠르기를 그대로
 *     들고 있었기 때문이다. `STALE`이 그걸 없던 것으로 본다.
 *
 * **손짓은 천천히 던져야 한다** — 한 번에 몰아 던지면 눈 깜짝할 새라
 * 빠르기가 무한대가 되어 전부 '튕김'으로 읽힌다.
 */
console.log('\n── 손가락을 따라 뒤로 가기 ──');
{
    const bCtx2 = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR',
        timezoneId: 'Asia/Seoul', hasTouch: true, isMobile: true });
    await bCtx2.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(bCtx2);
    await bCtx2.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const bp = await bCtx2.newPage();

    const touchAt = (type, x, y) => bp.evaluate(([type, x, y]) => {
        const el = document.querySelector('.app > :first-child');
        const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y,
                              pageX: x, pageY: y });
        el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
            touches: type === 'touchend' ? [] : [t],
            targetTouches: type === 'touchend' ? [] : [t],
            changedTouches: [t] }));
    }, [type, x, y]);
    const draw = async (dx, dy = 0, hold = false, steps = 8, gap = 24) => {
        const x0 = 8, y0 = 420;
        await touchAt('touchstart', x0, y0);
        for (let i = 1; i <= steps; i++) {
            await bp.waitForTimeout(gap);
            await touchAt('touchmove', x0 + dx * i / steps, y0 + dy * i / steps);
        }
        if (!hold) await touchAt('touchend', x0 + dx, y0 + dy);
    };
    const shift = () => bp.evaluate(() => {
        const el = document.querySelector('.app > :first-child');
        const g = document.querySelector('.back-ghost');
        return {
            page: Math.round(new DOMMatrixReadOnly(getComputedStyle(el).transform).e),
            ghost: g ? Math.round(new DOMMatrixReadOnly(getComputedStyle(g).transform).e) : null,
            있나: !!g,
        };
    });
    const at = () => bp.evaluate(() => location.hash);
    const dive = async () => {
        await bp.click('.round-card a, .round-card', { timeout: 5000 }).catch(() => {});
        await bp.waitForTimeout(700);
    };

    await bp.goto(`${BASE}/#/rounds`);
    await bp.waitForSelector('.app', { timeout: 20000 });
    await bp.waitForTimeout(600);
    await dive();
    ok((await at()).startsWith('#/rounds/'), `상세로 들어간다 (${await at()})`);

    await draw(120, 0, true);
    const mid = await shift();
    ok(mid.page >= 100 && mid.page <= 130, `끄는 만큼 화면이 따라온다 (${mid.page}px)`);
    ok(mid.있나 && mid.ghost < 0 && mid.ghost > -100,
       `앞 화면이 뒤에서 어긋나 따라온다 (${mid.ghost}px)`);
    const ghost = await bp.evaluate(() => {
        const g = document.querySelector('.back-ghost');
        return { 장: g.querySelectorAll('.page').length, 눌림: getComputedStyle(g).pointerEvents };
    });
    /* **여기가 해시 라우팅에 걸렸던 자리다** — 0장이면 그림을 안 찍은 것이다. */
    ok(ghost.장 === 1, `앞 화면 그림이 실제로 들어 있다 (${ghost.장}장)`);
    ok(ghost.눌림 === 'none', '그 그림은 눌리지 않는다(죽은 그림이다)');
    /* **탭바도 손끝을 따라온다**(사용자 요청 — `끌기나 뒤로가기할때 탭바도
       같이 밀리도록해줘`). 탭바는 `position: fixed`라 화면만 밀면 제자리에
       남아 뒤에 깔린 그림 위에 얹힌다. */
    const barMid = await bp.evaluate(() => {
        const b = document.querySelector('.app > .tabbar');
        return { 있나: !!b, x: b ? Math.round(new DOMMatrixReadOnly(getComputedStyle(b).transform).e) : null,
                 뒤탭바: !!document.querySelector('.back-ghost .tabbar') };
    });
    ok(barMid.있나 && barMid.x === mid.page, `끄는 동안 탭바가 화면과 같이 밀린다 (탭바 ${barMid.x}px · 화면 ${mid.page}px)`);
    ok(barMid.뒤탭바, '뒤에 깔린 앞 화면에도 제 탭바가 있다');

    /* 끌다가 멈추고 놓으면 되돌아온다 — 위 `STALE`이 지키는 자리다. */
    const stay = await at();
    await touchAt('touchend', 128, 420);
    await bp.waitForTimeout(600);
    ok((await at()) === stay, '조금 끌다 멈추고 놓으면 안 넘어간다');
    const home = await shift();
    ok(home.page === 0 && !home.있나, '제자리로 돌아오고 그림도 걷힌다');
    const barHome = await bp.evaluate(() => document.querySelector('.app > .tabbar')?.style.transform ?? 'none');
    ok(barHome === '', `탭바도 제자리로 돌아온다 (${barHome || '빈 값'})`);

    await draw(300);
    await bp.waitForTimeout(700);
    ok((await at()) === '#/rounds', `충분히 끌면 뒤로 간다 (${await at()})`);
    const done = await shift();
    ok(done.page === 0 && !done.있나, '넘어간 뒤에 옛 자리가 안 남는다');
    const barDone = await bp.evaluate(() => document.querySelector('.app > .tabbar')?.style.transform ?? 'none');
    ok(barDone === '', `넘어간 뒤에 탭바에도 옛 자리가 안 남는다 (${barDone || '빈 값'})`);

    await dive();
    const before = await at();
    await draw(20, 160);
    await bp.waitForTimeout(400);
    ok((await at()) === before && (await shift()).page === 0,
       '세로로 그으면 뒤로 안 가고 화면도 안 움직인다');

    await bp.goto(`${BASE}/#/rounds`);
    await bp.waitForTimeout(600);
    await draw(300);
    await bp.waitForTimeout(500);
    ok((await at()) === '#/rounds', '탭 화면에서는 미는 손짓을 안 받는다');

    /* ── 남아 버린 그림을 걷는가 ──────────────────────────────
       **깔아 둔 앞 화면이 그대로 남는 일이 실제로 있었다**(사용자 제보 —
       `뒤로가기하면서 오류가나더니 저렇게됐어`). 걷는 일이 rAF에만 매달려
       있으면 앱을 덮어 뒀을 때·무엇이 던져졌을 때 영영 안 걷힌다. */
    await dive();
    await draw(120, 0, true);
    /* **`touchend`가 안 온 채로 새 손짓이 시작된 상태다** — iOS는 시스템
       손짓에 가로채이면 그것을 아예 안 준다. 그때 앞 그림을 놓아 버리면
       화면에 영영 남는다. */
    await draw(120, 0, true);
    const two = await bp.evaluate(() => document.querySelectorAll('.back-ghost').length);
    ok(two === 1, `손짓이 끊겨도 그림이 겹쳐 쌓이지 않는다 (${two}장)`);
    await touchAt('touchend', 128, 420);
    await bp.waitForTimeout(600);

    /* 무슨 까닭으로든 남았다면 — 앱으로 돌아올 때 훑어 걷는다. */
    await bp.evaluate(() => {
        const g = document.createElement('div');
        g.className = 'back-ghost';
        document.body.insertBefore(g, document.body.firstChild);
        document.documentElement.classList.add('back-drag', 'back-ease');
        const el = document.querySelector('.app > :first-child');
        if (el) el.style.transform = 'translate3d(390px,0,0)';
    });
    await bp.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await bp.waitForTimeout(200);
    const swept = await bp.evaluate(() => ({
        남음: document.querySelectorAll('.back-ghost').length,
        끌기: document.documentElement.className,
        page: document.querySelector('.app > :first-child')?.style.transform || '',
    }));
    ok(swept.남음 === 0, `남아 버린 앞 화면 그림을 걷는다 (${swept.남음}장)`);
    ok(!swept.끌기.includes('back-drag') && !swept.끌기.includes('back-ease')
       && swept.page === '', '밀려 나간 화면도 제자리로 돌아온다');

    /* 화면을 옮길 때도 훑는다 — 그림이 남아 있어도 눌러서 빠져나올 수 있다
       (그림은 `pointer-events: none`이라 탭바가 그대로 눌린다). */
    await bp.evaluate(() => {
        const g = document.createElement('div');
        g.className = 'back-ghost';
        document.body.insertBefore(g, document.body.firstChild);
    });
    await bp.evaluate(() => { location.hash = '#/polls'; });
    await bp.waitForTimeout(500);
    const moved = await bp.evaluate(() => document.querySelectorAll('.back-ghost').length);
    ok(moved === 0, `화면을 옮기면 남은 그림이 걷힌다 (${moved}장)`);

    /* ── 대화방으로 돌아올 때 뒷배경에 말풍선이 들어 있는가 ─────────
       대화방을 떠날 때 찍는 그림은 **굴린 자리를 안 가져온다**(`cloneNode`) —
       안 적어 두면 그 그림이 늘 맨 위 글부터 보인다. `Shot.list`에 그때의
       `scrollTop`을 적고 `placeChatList()`가 붙인 뒤에 굴려 놓는다. */
    await bp.goto(`${BASE}/#/chat`);
    await bp.waitForSelector('.chat-list [data-mid]', { timeout: 20000 });
    await bp.waitForTimeout(500);
    /* **카드를 눌러 들어간다** — 해시만 바꾸면 `pushState`를 안 거쳐 그림이
       안 찍힌다. */
    await bp.evaluate(() => {
        const a = [...document.querySelectorAll('.chat-list .chat-result')]
            .map(c => c.closest('a') || c.querySelector('a') || c).find(Boolean);
        a?.click();
    });
    await bp.waitForTimeout(900);
    ok(bp.url().includes('/rounds/'), `대화방에서 카드를 눌러 들어간다 (${bp.url().split('#')[1]})`);
    await draw(120, 0, true);
    const back = await bp.evaluate(() => {
        const list = document.querySelector('.back-ghost .chat-list');
        if (!list) return { 있나: false };
        const r = list.getBoundingClientRect();
        return {
            있나: true,
            줄: list.querySelectorAll('[data-mid]').length,
            아래: Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop),
            높이: Math.round(r.height),
        };
    });
    ok(back.있나 && back.줄 > 0,
       `대화방 그림에 말풍선이 들어 있다 (${back.줄}줄)`);
    ok(back.있나 && back.높이 > 100 && back.아래 <= 2,
       `그 목록은 보던 자리(맨 아래)로 굴려져 있다 (끝에서 ${back.아래}px)`);
    await touchAt('touchend', 128, 420);
    await bp.waitForTimeout(600);

    await bCtx2.close();
}

/* ── 대화는 탭이 아니라 들어갔다 나오는 화면이다 ────────────────────
 *
 * 사용자 요청 — `채팅에서 탭바없애고 오른쪽에서 왼쪽으로 채팅화면이 나오고
 * 뒤로가기처럼 나올수있게해줘`(카톡의 대화방 사진을 받아 맞췄다).
 *
 * **클래스 이름만 보면 다 초록으로 뜨는 자리라 값을 잰다** — 탭바가 정말
 * 없는지 · 탭바 자리를 안 비워 두는지(입력칸이 바닥에 닿는지) · `←`가
 * 실제로 앞 화면으로 돌려놓는지. `TAB_PATHS`에 `/chat`을 도로 넣으면
 * 미끄러져 들어오는 줄이 빨갛게 뜬다.
 */
console.log('\n── 대화는 들어갔다 나오는 화면이다 ──');
{
    await go('/#/', 700);
    await page.click('.tabbar a:last-child');
    await page.waitForTimeout(120);
    /* **대화도 이제 통째로 밀려 들어온다**(위 칸 참고). 그때는 표가
       `.app`이 아니라 **뿌리**에 붙으므로 둘 다 본다 — 앱이 목록을 그리는
       판에서는 예전 40px짜리(`slide-in`)로 물러난다. */
    const slid = await page.evaluate(() => ({
        app: document.querySelector('.app').className,
        뿌리: document.documentElement.className,
    }));
    ok(slid.뿌리.includes('screen-push') || slid.app.includes('slide-in'),
       `오른쪽에서 미끄러져 들어온다 (${slid.뿌리 || slid.app || '없음'})`);

    await page.waitForSelector('.chat-list', { timeout: 10000 });
    await page.waitForTimeout(600);
    const room = await page.evaluate(() => {
        const i = document.querySelector('.chat-input');
        return {
            탭바: !!document.querySelector('.tabbar'),
            탭바자리: getComputedStyle(document.querySelector('.chat'))
                .getPropertyValue('--tabbar-h').trim(),
            입력칸아래: Math.round(innerHeight - i.getBoundingClientRect().bottom),
            뒤로: !!document.querySelector('.chat-back'),
        };
    });
    ok(!room.탭바, '대화방에는 탭바가 없다');
    ok(room.탭바자리 === '0px', `탭바 자리를 안 비워 둔다 (${room.탭바자리})`);
    ok(room.입력칸아래 === 0, `입력칸이 화면 맨 아래에 붙는다 (아래 ${room.입력칸아래}px)`);
    ok(room.뒤로, '머리말 왼쪽에 `←`가 있다');

    await page.click('.chat-back');
    await page.waitForTimeout(700);
    const out = await page.evaluate(() => ({
        길: location.hash, 탭바: !!document.querySelector('.tabbar'),
    }));
    ok(out.길 === '#/', `\`←\`를 누르면 앞 화면으로 돌아간다 (${out.길})`);
    ok(out.탭바, '나오면 탭바가 돌아온다');

}

/* ── 읽던 자리로 돌아온다 ────────────────────────────────────
 *
 * 사용자 제보 — `채팅방으로 공유된 알림을 눌러서 라운드나 투표로 들어갔다가
 * 뒤로가기하면 그 화면으로 와야 하는데 최근대화로 넘어와`.
 *
 * 대화는 `useAsync` 기억해 두기를 안 쓰므로 나갔다 오면 화면이 통째로 새로
 * 만들어지고 첫 묶음을 다시 받는다 — 그러면 `pinBottom`이 맨 아래로
 * 내려놓아 **옛 대화를 되짚다가 카드를 눌러 들어간 사람은 읽던 자리를 잃는다.**
 *
 * **클래스 이름으로는 못 본다 — 자리를 잰다.** 화면 맨 위에 걸린 글과 그
 * 글이 위로 지나간 만큼(`off`)이 돌아왔을 때도 같아야 한다.
 * **맨 아래를 보고 있었으면 맨 아래 그대로여야 하는 것**도 함께 본다 —
 * 그 자리를 글 id로 못박아 두면 그 사이 온 새 글을 안 따라간다.
 */
console.log('\n── 읽던 자리로 돌아온다 ──');
{
    /** 화면 맨 위에 걸린 글과 그 글이 위로 지나간 만큼. */
    const spot = () => page.evaluate(() => {
        const el = document.querySelector('.chat-list');
        const top = el.getBoundingClientRect().top;
        const at = [...el.querySelectorAll('[data-mid]')]
            .find(r => r.getBoundingClientRect().bottom > top + 1);
        return {
            자리: Math.round(el.scrollTop),
            끝: Math.round(el.scrollHeight - el.clientHeight),
            글: at?.dataset.mid ?? null,
            위로: at ? Math.round(top - at.getBoundingClientRect().top) : null,
        };
    });
    /** 굴려 놓고 **굴리기 신호까지 준다** — 적어 두는 일이 거기에 달려 있다. */
    const scrollTo = async (fn) => {
        await page.evaluate(f => {
            const el = document.querySelector('.chat-list');
            el.scrollTop = new Function('el', `return ${f}`)(el);
            el.dispatchEvent(new Event('scroll'));
        }, fn);
        await page.waitForTimeout(400);
    };
    /** 대화방을 나갔다 들어온다. `tap`이 나가는 길이다. */
    const roundTrip = async (tap) => {
        await tap();
        await settleScreen(page);
        await page.waitForTimeout(500);
        await page.goBack();
        await settleScreen(page);
        await page.waitForSelector('.chat-list');
        await page.waitForTimeout(1200);
    };

    /** 눌리는 카드를 화면 위에서 200px 자리에 놓는다 — 그 자리에서 눌러야
     *  **누를 때 자리가 안 달라진다.** */
    const showCard = async (rest) => {
        await page.evaluate(() => {
            const el = document.querySelector('.chat-list');
            const card = el.querySelector('.chat-result');
            el.scrollTop += card.getBoundingClientRect().top
                - el.getBoundingClientRect().top - 200;
            el.dispatchEvent(new Event('scroll'));
        });
        await page.waitForTimeout(rest);
    };

    /** 보이는 카드를 **손가락처럼 그 자리에서** 누른다.
     *
     *  **`page.click`으로 누르지 말 것** — playwright가 누르기 전에 그 카드를
     *  화면 안으로 굴려 넣어, 방금 맞춰 둔 자리가 통째로 달라진다(재 보고
     *  잡았다). 보이지 않는 카드를 누르면 아무 데도 안 들어가므로
     *  `showCard()`로 먼저 올려 둔다. */
    const tapCard = async () => {
        const at = await page.evaluate(() => {
            const el = document.querySelector('.chat-list');
            const box = el.getBoundingClientRect();
            const card = [...el.querySelectorAll('.chat-result')].find(c => {
                const r = c.getBoundingClientRect();
                return r.top > box.top + 8 && r.bottom < box.bottom - 8;
            });
            if (!card) return null;
            const r = card.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (!at) throw new Error('보이는 카드가 없다');
        await page.mouse.click(at.x, at.y);
    };

    await go('/#/chat', 900);
    await page.waitForSelector('.chat-list');

    await showCard(400);
    const 전 = await spot();
    await roundTrip(tapCard);
    const 후 = await spot();
    ok(후.글 === 전.글 && Math.abs(후.위로 - 전.위로) <= 4,
       `카드를 눌러 들어갔다 오면 읽던 자리다 (${전.글}/${전.위로} → ${후.글}/${후.위로})`);
    ok(후.자리 < 후.끝 - 100, `맨 아래로 안 끌려간다 (${후.자리}/${후.끝})`);

    /* **굴리자마자 누르는 것이 진짜 자리다**(사용자 제보 — 고쳐 놓고도
       `최근대화로 넘어와`가 그대로였다). 카드를 찾으려고 굴린 사람은
       보이는 그 순간 누르므로, 적어 두기를 기다리는 150ms 안에 화면을
       떠난다 — 그때 기다리던 것을 뒷정리가 지워 **한 번도 안 적혔다.**
       위 칸은 400ms을 쉬므로 이 자리를 통째로 지나친다. */
    await scrollTo('el.scrollHeight');
    await showCard(40);
    const 급 = await spot();
    await roundTrip(tapCard);
    const 급후 = await spot();
    ok(급후.글 === 급.글 && Math.abs(급후.위로 - 급.위로) <= 4,
       `굴리자마자 눌러도 읽던 자리다 (${급.글}/${급.위로} → ${급후.글}/${급후.위로})`);

    /* 맨 아래에서는 카드가 화면에 없을 수 있으므로 **그냥 홈으로 나간다** —
       보는 것은 '나갔다 오면 맨 아래 그대로인가'이지 나가는 길이 아니다. */
    await scrollTo('el.scrollHeight');
    await roundTrip(() => page.goto(BASE + '/#/'));
    const 바닥 = await spot();
    ok(바닥.자리 >= 바닥.끝 - 4,
       `맨 아래를 보고 있었으면 맨 아래 그대로다 (${바닥.자리}/${바닥.끝})`);
}

/* ── 읽던 글이 첫 묶음 밖에 있어도 돌아온다 ──────────────────────
 *
 * 사용자 제보 — 두 번 고쳐 놓고도 `깜빡하면서 최근대화로되어있어`.
 *
 * **고정 자료의 대화가 짧아 위 칸이 이 자리를 통째로 지나쳤다.** 다시
 * 들어오면 마지막 `PAGE`(50)개만 받아 오는데, 옛 대화를 되짚다가(=`지난
 * 대화 더 보기`를 눌러 가며 올라가다가) 카드를 눌러 들어간 사람은 그 글이
 * 목록에 아예 없어 맨 아래로 떨어졌다 — 백 명이 하루 백 마디를 쌓는 방에서는
 * 이쪽이 오히려 흔한 길이다. 그래서 **글 140개짜리 방을 따로 띄워** 잰다.
 * 고침을 되돌리면 `끝 0`(맨 아래)으로 빨갛게 뜬다.
 */
console.log('\n── 읽던 글이 첫 묶음 밖에 있어도 ──');
{
    /* **반드시 지난 시각이어야 한다.** 이 파일은 노드(UTC)에서 도는데 화면은
       한국 시각이라, `setHours(8,…)`처럼 적으면 **앞으로 올 시각**이 되기
       쉽다 — 그러면 `안 읽은 개수만큼 더 받는다`가 걸려 140개가 통째로
       실려 오고, 여기서 보려던 `첫 묶음 밖` 상태가 아예 안 만들어진다
       (실제로 그렇게 헛돌았다). 어제부터 1분 간격으로 쌓아 둔다. */
    const 어제 = Date.now() - 864e5;
    const at = i => new Date(어제 + i * 60000).toISOString();
    const others = tables.profiles.filter(p => p.id !== ME).map(p => p.id);
    /* **카드는 맨 위에서 서른 번째다** — 뒤에서 세면 110번째라 첫 묶음(50)을
       한참 넘어간다. 가까이 두면 그냥 실려 와 검사가 헛돈다. */
    const CARD = 30;
    const long = [];
    for (let i = 0; i < 140; i++) {
        long.push(i === CARD
            ? { id: `x${i}`, room_id: 'room1', user_id: ME, system: true, round_id: 'r1',
                body: '신성호님이 라운드를 공유했습니다\n무등산CC\n9월 8일 (화)',
                created_at: at(i) }
            : { id: `x${i}`, room_id: 'room1', user_id: others[i % others.length],
                body: `${i}번째 이야기입니다 오늘도 좋은 하루 되세요`, created_at: at(i) });
    }
    const lCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await lCtx.route('**/rest/v1/**', restRoute({ ...tables, messages: long }));
    await lCtx.route('**/auth/v1/**', r => r.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
    await stubOutside(lCtx);
    await lCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const lPage = await lCtx.newPage();

    const lSpot = () => lPage.evaluate(() => {
        const el = document.querySelector('.chat-list');
        if (!el) return { 글: null, 위로: -1, 끝: -1 };
        const top = el.getBoundingClientRect().top;
        const row = [...el.querySelectorAll('[data-mid]')]
            .find(r => r.getBoundingClientRect().bottom > top + 1);
        return {
            글: row?.dataset.mid ?? null,
            위로: row ? Math.round(top - row.getBoundingClientRect().top) : -1,
            끝: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
        };
    });

    await lPage.goto(BASE + '/#/chat', { waitUntil: 'networkidle' });
    await lPage.waitForSelector('.chat-list .chat-row', { timeout: 15000 });
    await lPage.waitForTimeout(700);

    // `지난 대화 더 보기`를 눌러 올라간다 — 카드가 나올 때까지.
    for (let i = 0; i < 4; i++) {
        if (await lPage.evaluate(() => !!document.querySelector('.chat-result'))) break;
        const more = await lPage.$('.chat-more');
        if (!more) break;
        await more.click();
        await lPage.waitForTimeout(600);
    }
    ok(await lPage.evaluate(() => !!document.querySelector('.chat-result')),
       '더 보기를 눌러 올라가면 카드가 나온다');

    // 카드를 화면 위에서 200px 자리에 놓고 **그 자리를 손가락처럼** 누른다.
    await lPage.evaluate(() => {
        const el = document.querySelector('.chat-list');
        const card = el.querySelector('.chat-result');
        el.scrollTop += card.getBoundingClientRect().top
            - el.getBoundingClientRect().top - 200;
        el.dispatchEvent(new Event('scroll'));
    });
    await lPage.waitForTimeout(400);
    const 밖전 = await lSpot();
    const 점 = await lPage.evaluate(() => {
        const el = document.querySelector('.chat-list');
        const box = el.getBoundingClientRect();
        const card = [...el.querySelectorAll('.chat-result')].find(c => {
            const r = c.getBoundingClientRect();
            return r.top > box.top + 8 && r.bottom < box.bottom - 8;
        });
        const r = card.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await lPage.mouse.click(점.x, 점.y);
    await settleScreen(lPage);
    await lPage.waitForTimeout(600);
    /* **정말 들어갔는지 먼저 본다.** 안 들어갔으면 화면이 그대로 남아
       자리도 그대로라 **아무것도 안 고쳐도 초록으로 뜬다.** */
    ok(lPage.url().includes('/rounds/r1'), `카드를 누르면 그 라운드로 간다 (${lPage.url().split('#')[1]})`);
    await lPage.goBack();
    await settleScreen(lPage);
    await lPage.waitForSelector('.chat-list', { timeout: 15000 });
    await lPage.waitForTimeout(1200);
    const 밖후 = await lSpot();
    ok(밖후.글 === 밖전.글 && Math.abs(밖후.위로 - 밖전.위로) <= 4,
       `첫 묶음 밖의 글이어도 읽던 자리다 (${밖전.글}/${밖전.위로} → ${밖후.글}/${밖후.위로})`);
    ok(밖후.끝 > 100, `맨 아래로 안 끌려간다 (끝 ${밖후.끝})`);
    /* 목록이 그 언저리만 담고 있으므로 **돌아올 길이 있어야 한다** —
       검색으로 옮겨 갔을 때와 같은 자리다(`windowed`). */
    /* **빈 화면이 지나가지 않는다**(사용자 제보 — `되돌아가기하면 … 화면이
       깜빡이면서 나오는데`). 들고 있던 줄을 그대로 깔므로 스피너도, 줄
       하나 없는 빈 목록도 없어야 한다 — 위에서 이미 돌아와 있으므로
       여기서는 **한 번 더 다녀오며 프레임마다** 본다. */
    {
        const 본 = [];
        await lPage.evaluate(() => {
            const el = document.querySelector('.chat-list');
            const c = el.querySelector('.chat-result');
            if (c) el.scrollTop += c.getBoundingClientRect().top
                - el.getBoundingClientRect().top - 200;
            el.dispatchEvent(new Event('scroll'));
        });
        await lPage.waitForTimeout(400);
        /* **보이는 카드가 없으면 던지지 말 것** — 고침을 되돌려 보는 판에서
           목록이 맨 아래에 있으면 카드가 화면 밖이라, 그냥 죽으면 **뒤에 있는
           칸이 통째로 안 돈다.** 빨갛게 적고 넘어간다. */
        const 자리 = await lPage.evaluate(() => {
            const el = document.querySelector('.chat-list');
            const box = el.getBoundingClientRect();
            const c = [...el.querySelectorAll('.chat-result')].find(x => {
                const r = x.getBoundingClientRect();
                return r.top > box.top + 8 && r.bottom < box.bottom - 8;
            });
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (!자리) ok(false, '되돌아온 자리에 카드가 보인다');
        else await lPage.mouse.click(자리.x, 자리.y);
        await settleScreen(lPage);
        await lPage.waitForTimeout(600);
        void lPage.goBack();
        for (let i = 0; i < 8; i++) {
            await lPage.waitForTimeout(80);
            본.push(await lPage.evaluate(() => ({
                스피너: !!document.querySelector('.center-fill .spinner'),
                줄: document.querySelectorAll('.chat-list [data-mid]').length,
            })));
        }
        ok(본.every(f => !f.스피너), `되돌아올 때 스피너가 안 지나간다 (${본.filter(f => f.스피너).length}프레임)`);
        ok(본.every(f => f.줄 > 0), `되돌아올 때 빈 목록이 안 지나간다 (${본.filter(f => !f.줄).length}프레임)`);
    }

    await lCtx.close();
}

/* ── 들고 있던 줄이 없을 때는 언저리를 받아 온다 ──────────────────
 *
 * 위 칸은 **나갈 때 들고 있던 줄**(`KEPT`)로 돌아오므로 받아 오는 길을
 * 안 지나간다. 그 길은 **검색으로 옛 글에 가 있다가 나갔을 때** 쓰인다 —
 * 그때는 목록이 '지금'이 아니라 찾은 글 언저리라 들고 가지 않기 때문이다.
 * 되돌아올 때 그 글이 첫 묶음에 없으면 언저리를 받아 오고 `최근 대화로`가
 * 뜬다. 고침을 되돌리면 맨 아래로 떨어져 빨갛게 뜬다.
 */
console.log('\n── 들고 있던 줄이 없을 때 ──');
{
    const 어제 = Date.now() - 864e5;
    const others = tables.profiles.filter(p => p.id !== ME).map(p => p.id);
    const long = [];
    for (let i = 0; i < 140; i++) {
        long.push(i === 30
            ? { id: `y${i}`, room_id: 'room1', user_id: ME, system: true, round_id: 'r1',
                body: '신성호님이 라운드를 공유했습니다\n무등산CC\n9월 8일 (화)',
                created_at: new Date(어제 + i * 6e4).toISOString() }
            /* **찾을 말은 딱 한 줄에만 있어야 한다** — `29번째`처럼 두면
               `129번째`도 걸려 목록 맨 위에 최근 글이 오고, 그건 이미
               받아 둔 줄이라 `openHit`이 언저리를 안 받아 온다(그러면
               여기서 보려던 길을 통째로 지나친다). */
            : { id: `y${i}`, room_id: 'room1', user_id: others[i % others.length],
                body: i === 29 ? '그날 찾을말 이야기입니다' : `${i}번째 이야기입니다`,
                created_at: new Date(어제 + i * 6e4).toISOString() });
    }
    const wCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await wCtx.route('**/rest/v1/**', restRoute({ ...tables, messages: long }));
    await wCtx.route('**/auth/v1/**', r => r.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
    await stubOutside(wCtx);
    await wCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const wPage = await wCtx.newPage();
    await wPage.goto(BASE + '/#/chat', { waitUntil: 'networkidle' });
    await wPage.waitForSelector('.chat-list .chat-row', { timeout: 15000 });
    await wPage.waitForTimeout(700);

    /* 🔍로 옛 글에 가면 `windowed`가 선다 — 그러면 나갈 때 줄을 안 들고 간다. */
    await wPage.click('.chat-find');
    await wPage.waitForTimeout(200);
    await wPage.fill('.chat-search-in', '찾을말');
    await wPage.waitForTimeout(900);
    const 결과 = await wPage.$$('.chat-hit');
    ok(결과.length > 0, `검색으로 옛 글을 찾는다 (${결과.length}건)`);
    if (결과.length) {
        await 결과[0].click();
        await wPage.waitForTimeout(900);
        ok(await wPage.evaluate(() => !!document.querySelector('.chat-recent')),
           '찾아간 자리에서는 `최근 대화로`가 뜬다');

        // 그 언저리에 카드가 있다. 보이는 자리를 눌러 들어갔다 나온다.
        const 점 = await wPage.evaluate(() => {
            const el = document.querySelector('.chat-list');
            const box = el.getBoundingClientRect();
            const c = [...el.querySelectorAll('.chat-result')].find(x => {
                const r = x.getBoundingClientRect();
                return r.top > box.top + 8 && r.bottom < box.bottom - 8;
            });
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (!점) {
            ok(false, '찾아간 자리에 카드가 보인다');
        } else {
            const 전 = await wPage.evaluate(() => {
                const el = document.querySelector('.chat-list');
                const top = el.getBoundingClientRect().top;
                const row = [...el.querySelectorAll('[data-mid]')]
                    .find(r => r.getBoundingClientRect().bottom > top + 1);
                return { 글: row?.dataset.mid ?? null,
                         위로: row ? Math.round(top - row.getBoundingClientRect().top) : -1 };
            });
            await wPage.mouse.click(점.x, 점.y);
            await settleScreen(wPage);
            await wPage.waitForTimeout(600);
            ok(wPage.url().includes('/rounds/r1'), '카드를 누르면 그 라운드로 간다');
            await wPage.goBack();
            await settleScreen(wPage);
            await wPage.waitForSelector('.chat-list', { timeout: 15000 });
            await wPage.waitForTimeout(1500);
            const 후 = await wPage.evaluate(() => {
                const el = document.querySelector('.chat-list');
                const top = el.getBoundingClientRect().top;
                const row = [...el.querySelectorAll('[data-mid]')]
                    .find(r => r.getBoundingClientRect().bottom > top + 1);
                return {
                    글: row?.dataset.mid ?? null,
                    위로: row ? Math.round(top - row.getBoundingClientRect().top) : -1,
                    끝: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
                    돌아올단추: !!document.querySelector('.chat-recent'),
                };
            });
            ok(후.글 === 전.글 && Math.abs(후.위로 - 전.위로) <= 4,
               `언저리를 받아 와 읽던 자리로 온다 (${전.글}/${전.위로} → ${후.글}/${후.위로})`);
            ok(후.끝 > 100, `맨 아래로 안 끌려간다 (끝 ${후.끝})`);
            ok(후.돌아올단추, '`최근 대화로` 단추가 있다');
        }
    }
    await wCtx.close();
}

/* ── 뒤에 깔린 앞 화면의 얼굴이 다시 안 불러와진다 ──────────────
 *
 * 사용자 제보 — `홈에서 대화를 누르면 홈에있는 프로필이 깜빡이는 증상이있어.
 * 프로필 사진을 다시 불러오는 느낌이야`. 앞 화면 그림은 떠날 때 찍어 둔
 * **사본**인데, 사본의 `<img>`는 새 요소라 캐시에 있어도 다시 받아 풀었다.
 * 그 사이 얼굴 자리가 회색 동그라미로 비었다.
 *
 * **두 번째부터는 사진을 일부러 늦게 준다** — 빠른 서버에서는 다시 받아도
 * 거의 곧바로 와서 고치기 전 코드도 초록으로 뜬다(1.186이 그렇게
 * 헤드리스에서만 고쳐진 것처럼 보였다). 늦추면 다시 받는 순간이 드러난다.
 */
console.log('\n── 뒤에 깔린 앞 화면의 얼굴이 다시 안 불러와진다 ──');
{
    const faceTables = { ...tables,
        profiles: tables.profiles.map(p => p.id === ME ? { ...p, avatar_url: 'https://img.example.com/me.png' } : p) };
    const fCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await fCtx.route('**/rest/v1/**', restRoute(faceTables));
    await stubOutside(fCtx);
    /* 64×64 빨간 네모 한 장(PNG). */
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeUlEQVR4nO3PQQkAMAzAwMqpfz0TMxF7HINABFzm7H7dcEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFj13zk8EPp8weQAAAAABJRU5ErkJggg==', 'base64');
    let hits = 0;
    await fCtx.route('**img.example.com/**', async route => {
        if (hits++) await new Promise(r => setTimeout(r, 400));
        return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    });
    await fCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const fp = await fCtx.newPage();
    await fp.goto(BASE + '/#/');
    await fp.waitForSelector('.head-me img.avatar');
    await fp.waitForFunction(() => document.querySelector('.head-me img.avatar')?.naturalWidth > 0);
    await fp.evaluate(() => {
        window.__faces = [];
        new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
            if (!n.classList?.contains('back-ghost')) continue;
            const look = () => {
                const cv = n.querySelector('.head-me canvas.avatar');
                const im = n.querySelector('.head-me img.avatar');
                return cv ? { 그림: true, 둥금: getComputedStyle(cv).borderRadius, 폭: Math.round(cv.getBoundingClientRect().width) }
                     : { 그림: !!im && im.complete && im.naturalWidth > 0 };
            };
            window.__faces.push(look());
            requestAnimationFrame(() => window.__faces.push(look()));
        } }).observe(document.body, { childList: true });
    });
    await fp.locator('a[href*="rounds/"]').first().click();
    await fp.waitForTimeout(300);
    const faces = await fp.evaluate(() => window.__faces);
    ok(faces.length > 0, `앞 화면 그림이 깔린다 (${faces.length}번 봄)`);
    ok(faces.length > 0 && faces.every(f => f.그림),
       `깔리는 그 프레임부터 얼굴이 차 있다 (${JSON.stringify(faces)})`);
    ok(faces.length > 0 && faces[0].둥금 === '50%' && faces[0].폭 === 34,
       '옮겨 그린 얼굴이 원래 모양(둥근 34px) 그대로다');

    /* **돌아와서 새로 그려진 홈도 얼굴을 다시 안 불러온다**(사용자 제보 —
       `채팅에서 홈으로 갈때 프로필을 다시 불러드리는 것처럼 한번 깜빡이고`).
       한 번 받은 얼굴은 `Avatar`가 픽셀째 기억해 캔버스로 곧바로 그린다.
       **새 홈이 붙는 그 프레임을 본다** — 그 뒤에 보면 늦게 온 사진도 차 있다. */
    await fp.waitForTimeout(700);
    await fp.evaluate(() => {
        window.__home = null;
        new MutationObserver((ms, ob) => {
            const el = document.querySelector('.app > :first-child .head-me .avatar');
            if (!el) return;
            ob.disconnect();
            window.__home = el instanceof HTMLCanvasElement
                ? { 캔버스: true, 폭: el.width, 보임: Math.round(el.getBoundingClientRect().width) }
                : { 캔버스: false, 차있음: el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0 };
        }).observe(document.body, { childList: true, subtree: true });
    });
    const hitsBack = hits;
    await fp.evaluate(() => history.back());
    await fp.waitForTimeout(700);
    const home = await fp.evaluate(() => window.__home);
    ok(!!home && (home.캔버스 ? home.폭 > 0 : home.차있음),
       `돌아온 홈이 붙는 그 순간 얼굴이 차 있다 (${JSON.stringify(home)})`);
    ok(hits === hitsBack, `돌아올 때 얼굴을 다시 받지 않는다 (${hits - hitsBack}번 받음)`);
    await fCtx.close();
}

/* ── 회원 명단에서 얼굴을 누르면 전체화면 프로필이 뜬다 ─────────
 *
 * 사용자 요청 — `회원 명단에서 프로필을 누르면 채팅에서 프로필 눌렀을 때
 * 뜨는 것처럼 프로필을 띄워줘`. 대화와 **같은 조각**(`ProfileFull`)이다.
 * 명단에는 부를 대화가 없으므로 `@언급하기`·`선물하기`는 안 선다.
 */
console.log('\n── 회원 명단에서 얼굴을 누르면 전체화면 프로필이 뜬다 ──');
{
    await go('/#/members', 800);
    const n = await page.locator('.member-face').count();
    ok(n > 0, `얼굴이 누르는 단추다 (${n}개)`);
    const face = page.locator('.member-face').first();
    const box = await face.boundingBox();
    ok(!!box && box.width >= 30 && box.height >= 30, `누르는 자리가 30px 위다 (${box && Math.round(box.width)}px)`);
    const want = await face.evaluate(b => b.closest('.member-row')?.querySelector('.b.truncate')?.textContent?.trim() ?? '');
    await face.click();
    await page.waitForTimeout(250);
    const got = await page.evaluate(() => {
        const f = document.querySelector('.profile-full');
        if (!f) return null;
        const r = f.getBoundingClientRect();
        const at = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        return { 덮음: r.width >= innerWidth - 1 && r.height >= innerHeight - 1,
                 위: !!at && f.contains(at),
                 이름: f.querySelector('.profile-full-name')?.textContent?.trim() ?? '',
                 단추: f.querySelectorAll('.profile-full-btn').length };
    });
    ok(!!got && got.덮음 && got.위, `전체화면 프로필이 화면을 덮고 맨 위에 있다 (${JSON.stringify(got)})`);
    ok(!!got && got.이름 === want, `누른 사람의 이름표가 뜬다 (${got?.이름} / ${want})`);
    ok(!!got && got.단추 === 0, '명단에서는 `@언급하기`·`선물하기`가 안 선다');
    await page.click('.profile-full-x');
    await page.waitForTimeout(200);
    ok(await page.locator('.profile-full').count() === 0, '`✕`로 닫힌다');
}

/* ── 화면이 통째로 밀려 들어오고 나간다 ──────────────────────────
 *
 * 사용자 제보 — `카톡과 비교하면 아직도 엄청빨라`. **빠르게 느껴지던 것은
 * 시간이 아니라 거리였다**: 예전에는 40px(화면 폭의 1/10)만 움직여서,
 * 아무리 천천히 밀어도 '살짝 들썩'으로만 보였다.
 *
 * **클래스 이름만 보면 초록으로 뜨는 자리라 값을 잰다** — 움직임이
 * 0.35초뿐이라 밖에서 한 번 물어보면 거의 끝난 뒤의 값이 잡힌다.
 * 프레임마다 훑어 **가장 많이 밀린 값**을 본다.
 *
 * 넷을 본다:
 *  1. 들어갈 때 새 화면이 **화면 폭만큼** 밀려 들어오는가.
 *  2. 그 뒤에 앞 화면이 깔리는가(`.back-ghost`).
 *  3. 나올 때 **떠나는 화면**이 오른쪽으로 빠져나가는가(`.exit-ghost`).
 *  4. 끝나면 **남는 것이 없는가** — 죽은 그림이 남으면 앱이 통째로
 *     멈춘 것처럼 보인다.
 */
console.log('\n── 화면이 통째로 밀려 들어오고 나간다 ──');
{
    /** 프레임마다 훑어 가장 많이 밀린 값과 깔린 그림을 본다. */
    const watch = (p, ms) => p.evaluate(async (ms) => {
        const app = document.querySelector('.app');
        let 화면 = 0, 뒤 = false, 떠남 = 0, on = true;
        /* **탭바가 화면과 한 몸으로 움직이는가**(사용자 요청 — `끌기나
           뒤로가기할때 탭바도 같이 밀리도록해줘`). 프레임마다 두 자리의
           차이 중 가장 큰 것을 본다 — 같이 가면 0이다. */
        let 탭바 = 0, 어긋남 = 0, 뒤탭바 = false, 떠남탭바 = false;
        const tick = () => {
            if (!on) return;
            const kid = app?.firstElementChild;
            const bar = document.querySelector('.app > .tabbar');
            if (kid) {
                const x = new DOMMatrixReadOnly(getComputedStyle(kid).transform).e;
                if (Math.abs(x) > 화면) 화면 = Math.abs(x);
                if (bar) {
                    const bx = new DOMMatrixReadOnly(getComputedStyle(bar).transform).e;
                    if (Math.abs(bx) > 탭바) 탭바 = Math.abs(bx);
                    if (Math.abs(bx - x) > 어긋남) 어긋남 = Math.abs(bx - x);
                }
            }
            if (document.querySelector('.back-ghost')) 뒤 = true;
            if (document.querySelector('.back-ghost .tabbar')) 뒤탭바 = true;
            const gx = document.querySelector('.exit-ghost');
            if (gx) {
                const x = new DOMMatrixReadOnly(getComputedStyle(gx).transform).e;
                if (x > 떠남) 떠남 = x;
                if (gx.querySelector('.tabbar')) 떠남탭바 = true;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        await new Promise(r => setTimeout(r, ms));
        on = false;
        return { 화면: Math.round(화면), 뒤, 떠남: Math.round(떠남),
                 탭바: Math.round(탭바), 어긋남: Math.round(어긋남), 뒤탭바, 떠남탭바 };
    }, ms);

    const 남은것 = (p) => p.evaluate(() => ({
        그림: document.querySelectorAll('.back-ghost, .exit-ghost, .exit-dim').length,
        표: document.documentElement.className,
        자리: getComputedStyle(document.querySelector('.app > :first-child')).transform,
    }));

    await go('/#/rounds', 600);

    /* 1·2. 라운드 목록 → 상세 (들어감) */
    const inW = watch(page, 900);
    await page.waitForTimeout(60);
    await page.click('.round-card a, .round-card');
    const got = await inW;
    ok(got.화면 > 300, `들어갈 때 화면 폭만큼 밀려 들어온다 (가장 많이 ${got.화면}px)`);
    ok(got.뒤, '그 뒤에 앞 화면이 깔린다');
    ok(got.탭바 > 300 && got.어긋남 <= 1,
       `들어갈 때 탭바도 화면과 함께 밀려 들어온다 (탭바 ${got.탭바}px · 어긋남 ${got.어긋남}px)`);
    ok(got.뒤탭바, '뒤에 깔린 앞 화면 그림에도 탭바가 있다');

    await page.waitForTimeout(700);
    const 뒤끝 = await 남은것(page);
    ok(뒤끝.그림 === 0 && 뒤끝.자리 === 'none',
       `들어간 뒤에 남는 그림이 없다 (${뒤끝.그림}장 · ${뒤끝.자리})`);

    /* 3. 뒤로 (나감) */
    const outW = watch(page, 900);
    await page.waitForTimeout(60);
    await page.evaluate(() => history.back());
    const back = await outW;
    ok(back.떠남 > 300, `나올 때 떠나는 화면이 오른쪽으로 빠져나간다 (${back.떠남}px)`);
    ok(back.화면 > 40, `그 밑에서 앞 화면이 제자리로 돌아온다 (${back.화면}px에서)`);
    ok(back.떠남탭바, '떠나는 화면 그림이 제 탭바를 싣고 나간다');
    ok(back.탭바 > 40 && back.어긋남 <= 1,
       `목적지의 탭바도 화면과 함께 제자리로 온다 (탭바 ${back.탭바}px · 어긋남 ${back.어긋남}px)`);

    /* 4. 끝나면 남는 것이 없다. */
    await page.waitForTimeout(700);
    const 끝 = await 남은것(page);
    ok(끝.그림 === 0, `나온 뒤에 남는 그림이 없다 (${끝.그림}장)`);
    ok(!끝.표.includes('screen-'), `표도 함께 걷힌다 (${끝.표 || '없음'})`);

    /* **대화도 통째로 밀린다**(사용자 요청 — `카톡처럼`).
       예전에는 빼 두었는데, 걸리는 것은 **앱이 목록을 그리는 판** 하나뿐이라
       (`ChatList.slideIn`이 40px으로 못박혀 있다) 그 스위치를 켠 때만
       물러나게 좁혔다(`hasNative` → `listOn()`). 입력칸 바는 `Chat.tsx`가
       **전환이 끝난 뒤에** 세우므로 안 걸린다. */
    await go('/#/', 600);
    const chat = watch(page, 1200);
    await page.waitForTimeout(60);
    await page.click('.tabbar a:last-child');
    const c = await chat;
    ok(c.화면 > 300, `대화도 화면 폭만큼 밀려 들어온다 (가장 많이 ${c.화면}px)`);
    ok(c.뒤, '그 뒤에 앞 화면이 깔린다');
    await page.waitForSelector('.chat-list', { timeout: 10000 });
    await page.waitForTimeout(700);
    const 대화끝 = await 남은것(page);
    ok(대화끝.그림 === 0, `대화에 들어간 뒤에도 남는 그림이 없다 (${대화끝.그림}장)`);
}

/* ── 대화방에 들어갈 때와 나올 때 ────────────────────────────────
 *
 * 둘 다 사용자 제보로 잡은 자리다 — `우측에서 밀려오는게 아니고 화면이
 * 그냥 뜨고 화살표로 뒤로가기는되는데 손으로 우측으로 밀어도 뒤로가기가
 * 안먹혀`.
 *
 *  1. **들어갈 때** — 대화는 `useAsync` 기억해 두기를 안 쓰므로 첫 그림이
 *     늘 스피너 하나뿐이고, 왕복이 길면 창(500ms)이 끝난 뒤에 내용이
 *     들어앉아 **스피너만 미끄러지고 정작 대화는 툭 나타났다.**
 *     **왕복을 일부러 늦춰야 보인다** — 빠른 서버에서는 리액트가 같은 칸을
 *     다시 써서 돌고 있는 움직임이 내용을 그대로 싣고 간다.
 *  2. **나올 때** — `taken()`이 `.chat-row`에서 시작한 손짓을 통째로
 *     넘기고 있었는데 그 줄이 목록을 덮고 있어 **손짓이 시작조차 못 했다.**
 *     답장(왼쪽)과 뒤로 가기(오른쪽)는 방향이 달라 안 부딪힌다.
 *
 * **`hasTouch`인 창이 따로 필요하고**, 늦추는 규칙도 여기에만 건다(본 창에
 * 걸었다가 화면을 옮기는 순간 `Route is already handled!`로 죽었다).
 */
console.log('\n── 대화방에 들어갈 때와 나올 때 ──');
{
    const cCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR',
        timezoneId: 'Asia/Seoul', hasTouch: true, isMobile: true });
    await cCtx.route('**/rest/v1/**', restRoute(tables));
    /* **나중에 건 규칙을 먼저 본다** — 방 조회만 늦춰 스피너를 만든다.
       **`messages`를 늦춰서는 안 된다** — `loading`은 `rooms`와 명단으로
       정해지므로 대화 글을 아무리 늦춰도 화면은 51ms에 떠서 **고치기 전
       코드도 초록으로 뜬다**(실제로 그렇게 두었다가 잡았다). */
    /* **창(`SCREEN_MS`)보다 넉넉히 늦춰야 한다.** 창이 끝난 뒤에 내용이
       와야 '한 번 더 미는' 그 길을 타는데, 늦추는 값이 창과 비슷하면
       아슬아슬해 어느 날 그냥 초록으로 뜬다 — 창을 0.35 → 0.50초로
       늘리면서 여기도 함께 올렸다. */
    await cCtx.route('**/rest/v1/rooms**', async route => {
        await new Promise(r => setTimeout(r, 800));
        return route.fallback();
    });
    await stubOutside(cCtx);
    await cCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const cp = await cCtx.newPage();

    /* **말풍선 줄 위에서 시작해야 뜻이 있다** — `taken()`은 누른 자리에서
       위로 훑어 올라가므로, 목표가 `.chat-row` 안이 아니면 헛돈다. */
    const swipe = (dx, dy = 0) => cp.evaluate(([dx, dy]) => {
        const row = document.querySelector('.chat-row');
        if (!row) return '말풍선을 못 찾았다';
        const b = row.getBoundingClientRect();
        const x0 = Math.round(b.left + 6), y0 = Math.round(b.top + b.height / 2);
        const fire = (type, x, y) => {
            const t = new Touch({ identifier: 1, target: row, clientX: x, clientY: y,
                                  pageX: x, pageY: y });
            row.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
                touches: type === 'touchend' ? [] : [t],
                targetTouches: type === 'touchend' ? [] : [t],
                changedTouches: [t] }));
        };
        fire('touchstart', x0, y0);
        return new Promise(done => {
            let i = 0;
            const step = () => {
                i++;
                fire('touchmove', x0 + dx * i / 8, y0 + dy * i / 8);
                if (i < 8) return void setTimeout(step, 24);
                fire('touchend', x0 + dx, y0 + dy);
                done('ok');
            };
            setTimeout(step, 24);
        });
    }, [dx, dy]);

    await cp.goto(`${BASE}/#/`);
    await cp.waitForSelector('.tabbar', { timeout: 20000 });
    await cp.waitForTimeout(600);
    /* 1. 내용이 늦게 와도 그때 미끄러져 들어오는가.
       **한 번 재서는 안 된다** — 움직임이 0.30초뿐이라 밖에서 물어보면
       거의 끝난 뒤의 값이 잡힌다(실제로 3px이 나왔다). 프레임마다 훑어
       **대화가 첫 자식인 동안 가장 많이 밀린 값**을 본다. */
    const late = await cp.evaluate(async () => {
        const app = document.querySelector('.app');
        const t0 = performance.now();
        let most = 0, 봤나 = false, 나타남 = 0, on = true;
        const tick = () => {
            if (!on) return;
            const kid = app.firstElementChild;
            if (kid?.classList.contains('chat')) {
                if (!봤나) 나타남 = Math.round(performance.now() - t0);
                봤나 = true;
                const x = new DOMMatrixReadOnly(getComputedStyle(kid).transform).e;
                if (Math.abs(x) > most) most = Math.abs(x);
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        document.querySelector('.tabbar a:last-child').click();
        await new Promise(r => setTimeout(r, 1800));
        on = false;
        return { 봤나, 나타남, 밀림: Math.round(most) };
    });
    ok(late.봤나 && late.나타남 > 500,
       `대화가 창(500ms)이 끝난 뒤에 온다 (${late.나타남}ms)`);
    ok(late.밀림 > 20,
       `내용이 늦게 와도 그때 미끄러져 들어온다 (가장 많이 ${late.밀림}px)`);

    /* 2. 말풍선 위에서 오른쪽으로 밀면 나오는가. */
    await cp.waitForSelector('.chat-row', { timeout: 10000 });
    await cp.waitForTimeout(700);
    ok((await cp.evaluate(() => location.hash)) === '#/chat', '대화방에 들어와 있다');

    /* 세로로 그은 것은 굴리는 손짓이라 안 걸려야 한다. */
    await swipe(10, 90);
    await cp.waitForTimeout(500);
    ok((await cp.evaluate(() => location.hash)) === '#/chat',
       '세로로 굴리는 것으로는 안 나간다');

    await swipe(300);
    await cp.waitForTimeout(900);
    const back = await cp.evaluate(() => location.hash);
    ok(back === '#/', `말풍선 위에서 오른쪽으로 밀면 나온다 (${back})`);

    await cCtx.close();
}

/* ── 15. 사진·동영상을 원본 그대로 올리는가 ──────────────────────
 *
 * **줄이지 않는다**(사용자 요청 — `사진과 동영상을 원본으로
 * 올릴수있게해주고`). 예전에는 긴 변 2560px·JPEG 82%로 구워 올렸고
 * 이 칸이 `1.2MB 아래`를 붙들고 있었다 — **그 줄을 되살리지 말 것.**
 *
 * 대신 셋을 본다:
 *   ① 사진이 **원본 바이트 그대로** 올라간다(다시 굽지 않는다)
 *   ② 동영상도 올라가고 **끝이 `.mp4`다** — 받는 쪽은 주소 끝으로
 *      사진인지 동영상인지 가르므로(`lib/media.ts`) 그게 곧 갈래다
 *   ③ 50MB를 넘으면 **올리지 않고 사람 말로 알린다**
 *
 * **크기를 만질 때는 화질만 볼 것이 아니라 정말 올라가는지부터 볼 것** —
 * 2560px으로 키웠다가 사진이 통째로 안 올라간 적이 있다(사용자 제보 —
 * `사진 크기를 키운 후로 안돼`). 그 교훈은 그대로다.
 */
console.log('\n── 사진·동영상을 원본 그대로 올린다 ──');
{
    const uCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await uCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(uCtx);
    let sent = 0;
    /* **올라간 주소도 본다** — 끝(`.jpg`·`.mp4`)이 곧 사진·동영상의 갈래다. */
    let lastPath = '';
    await uCtx.route('**/storage/v1/object/**', route => {
        const body = route.request().postDataBuffer();
        if (body) sent = body.length;
        lastPath = new URL(route.request().url()).pathname;
        route.fulfill({ status: 200, contentType: 'application/json',
                        body: JSON.stringify({ Key: 'chat-photos/x.jpg' }) });
    });
    await uCtx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const up = await uCtx.newPage();
    await up.goto(`${BASE}/#/chat`);
    await up.waitForSelector('.chat-list', { timeout: 20000 });

    /* 폰 사진만 한 큰 그림을 지어 숨은 칸에 넣는다. */
    const big = await up.evaluate(async () => {
        const c = new OffscreenCanvas(4032, 3024);
        const x = c.getContext('2d');
        for (let i = 0; i < 4032; i += 8) {
            x.fillStyle = `hsl(${(i / 12) % 360} 60% 50%)`;
            x.fillRect(i, 0, 5, 3024);
        }
        const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
        return { size: b.size, bytes: Array.from(new Uint8Array(await b.arrayBuffer())) };
    });
    await up.setInputFiles('.file-anchor', {
        name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(big.bytes),
    });
    await up.waitForTimeout(2500);
    ok(sent > 0, `저장소로 올라간다 (원본 ${Math.round(big.size / 1024)}KB → ${Math.round(sent / 1024)}KB)`);
    /* **원본 바이트 그대로여야 한다** — 한 바이트라도 다르면 어딘가에서
       다시 굽고 있는 것이다. */
    /* **딱 같지는 않다** — 올리는 것이 `FormData`라 칸 이름과 경계선이
       몇백 바이트 얹힌다. 줄이면 절반 아래로 떨어지므로 **8KB 안이면
       원본 그대로**로 본다. */
    ok(sent >= big.size && sent < big.size + 8 * 1024,
       `사진은 원본 그대로 올라간다 (${sent}B / 원본 ${big.size}B)`);
    ok(lastPath.endsWith('.jpg'), `사진은 끝이 .jpg다 (${lastPath.split('/').pop()})`);

    /* ② 동영상 — **끝이 갈래다.** `.mp4`로 안 올라가면 받는 쪽이 사진으로
       그려 깨진 그림이 된다. */
    sent = 0; lastPath = '';
    await up.setInputFiles('.file-anchor', {
        name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(64 * 1024, 7),
    });
    await up.waitForTimeout(2000);
    ok(sent >= 64 * 1024 && sent < 64 * 1024 + 8 * 1024,
       `동영상도 원본 그대로 올라간다 (${sent}B / 원본 ${64 * 1024}B)`);
    ok(lastPath.endsWith('.mp4'), `동영상은 끝이 .mp4다 (${lastPath.split('/').pop()})`);

    /* ③ 50MB를 넘으면 올리지 않고 알린다.
       **파일로 만들어 넘긴다** — playwright는 50MB가 넘는 덩어리를
       바로 못 싣는다(그 한도가 우리 한도와 닮은 것은 우연이다). */
    sent = 0;
    const huge = path.join(os.tmpdir(), 'kkakkung-huge.mp4');
    await fs.writeFile(huge, Buffer.alloc(51 * 1024 * 1024, 7));
    await up.setInputFiles('.file-anchor', huge);
    await up.waitForTimeout(1500);
    const told = await up.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
    await fs.rm(huge, { force: true });
    ok(sent === 0 && /50MB/.test(told), `50MB를 넘으면 안 올리고 알린다 (${told || '아무 말도 없음'})`);

    await uCtx.close();
}

/* ── 15-1. 프로필 사진 고르기 ────────────────────────────────────
 *
 * **사용자 제보로 잡은 자리다** — 앱에서 프로필 사진을 바꾸려는데 아무
 * 일도 안 일어났다(`앱으로 올렸는데 프로필사진이 없어`). 웹 칸이
 * `hidden`이었던 것이 까닭이다: iOS는 고르는 창을 **그 칸이 있는 자리**에
 * 붙이는데, 자리가 없으면 화면 아무 데나 띄우거나 아예 안 띄운다.
 * 대화의 `+`에서 이미 겪고 `.file-anchor`로 고쳐 둔 자리인데
 * **여기만 남아 있었다.**
 *
 * 앱 쪽 길(`pickNativePhoto`)은 헤드리스로 못 본다 — 여기서 보는 것은
 * **웹으로 열었을 때와 옛 앱이 쓰는 되물러남**이고, 넷이다:
 *   ① 숨은 칸이 얼굴에 겹쳐 있다(자리가 있어야 창이 거기 붙는다)
 *   ② 44px보다 크다 — 그보다 작으면 iOS가 무시하고 제 맘대로 띄운다
 *   ③ 안 보이고 손짓도 안 가로챈다(얼굴을 눌러야 얼굴이 잡힌다)
 *   ④ 얼굴을 누르면 고르는 창이 실제로 열린다
 */
console.log('\n── 프로필 사진 고르기 ──');
{
    const aCtx = await browser.newContext({
        viewport: { width: 320, height: 693 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await aCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(aCtx);
    await aCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const ap = await aCtx.newPage();
    await ap.goto(`${BASE}/#/me`);
    await ap.waitForSelector('.avatar-slot .file-anchor', { timeout: 20000 });

    const box = await ap.evaluate(() => {
        const av = document.querySelector('.avatar-pick .avatar').getBoundingClientRect();
        const inp = document.querySelector('.avatar-slot .file-anchor');
        const r = inp.getBoundingClientRect();
        const s = getComputedStyle(inp);
        const hit = document.elementFromPoint(av.left + av.width / 2, av.top + av.height / 2);
        return {
            w: Math.round(r.width), h: Math.round(r.height),
            dx: Math.abs(r.left - av.left), dy: Math.abs(r.top - av.top),
            shown: s.display !== 'none' && s.visibility !== 'hidden',
            opacity: s.opacity, pe: s.pointerEvents,
            hit: hit?.className ?? '',
        };
    });
    ok(box.shown && box.dx < 2 && box.dy < 2,
       `숨은 칸이 얼굴에 겹쳐 있다 (어긋남 ${box.dx}·${box.dy}px)`);
    ok(box.w >= 44 && box.h >= 44,
       `44px보다 크다 — 작으면 iOS가 창을 제 맘대로 띄운다 (${box.w}×${box.h})`);
    ok(box.opacity === '0' && box.pe === 'none' && box.hit.includes('avatar'),
       `안 보이고 손짓도 안 가로챈다 (누르면 ${JSON.stringify(box.hit)})`);

    let opened = false;
    ap.on('filechooser', () => { opened = true; });
    await ap.click('.avatar-pick');
    await ap.waitForTimeout(400);
    ok(opened, '얼굴을 누르면 고르는 창이 열린다');

    /* 맨 아래 판 표시. **뒷자리가 앱 빌드 번호다**(`1.28`) — 워크플로가
       `VITE_APP_BUILD`로 넣는다. 여기(웹·개발 서버)에는 그 값이 없으므로
       `1.0`이어야 한다. `버전 1.`에서 끊기거나 `1.undefined`가 되는 것을
       잡는 자리다. */
    const ver = (await ap.textContent('.me-foot') ?? '').replace(/\s+/g, ' ').trim();
    ok(/버전 1\.0$/.test(ver), `웹에서는 판이 1.0으로 적힌다 (${ver})`);

    await aCtx.close();
}

/* ── 카톡 프사는 `https`로 올려 받는다 ────────────────────────────
 * **사용자 제보로 잡은 자리다** — 웹에서는 카톡 프사가 잘 뜨다가
 * **앱으로 감싼 뒤로 글자(이니셜)로 바뀌었다.** 카카오가 주는 주소가
 * `http://k.kakaocdn.net/…`이라서인데, 웹은 문서가 `https`라 브라우저가
 * 알아서 `https`로 올려 받아 주지만 앱은 문서가 `capacitor://localhost`라
 * 그 올림이 없고 iOS가 http를 통째로 막는다(App Transport Security).
 * 그래서 `Avatar`가 그릴 때 `https`로 바꾼다.
 *
 * **헤드리스로도 그대로 잡힌다** — 여기서 보는 것은 '어느 주소로
 * 받으러 갔는가'이고, 그 값이 곧 앱에서 막히느냐 마느냐를 가른다. */
console.log('\n── 카톡 프사는 https로 올려 받는다 ──');
{
    const PNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64');
    const kakao = {
        ...tables,
        profiles: tables.profiles.map(p => (p.name === '이관교'
            ? { ...p, avatar_url: 'http://k.kakaocdn.net/dn/test/img_640x640.jpg' }
            : p)),
    };
    const kCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await kCtx.route('**/rest/v1/**', restRoute(kakao));
    await stubOutside(kCtx);
    const asked = [];
    await kCtx.route('**kakaocdn.net/**', route => {
        asked.push(route.request().url());
        route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    });
    await kCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const kp = await kCtx.newPage();
    await kp.goto(`${BASE}/#/members`, { waitUntil: 'networkidle' });
    await kp.waitForTimeout(700);

    const src = await kp.$$eval('img.avatar',
        e => e.map(x => x.getAttribute('src')).find(u => u?.includes('kakaocdn')) ?? '');
    ok(src.startsWith('https://'),
       `얼굴 그림을 https로 건다 (${src || '그림이 아예 안 걸렸다'})`);
    ok(asked.length > 0 && asked.every(u => u.startsWith('https://')),
       `받으러 간 주소도 https다 (${asked[0] ?? '요청 없음'})`);

    await kCtx.close();
}

/* ── 알림을 누르면 그 화면으로 간다 ──────────────────────────────
 * **사용자 요청** — `알림이 왔을때 알림을 누르면 해당화면으로 이동할수있게`.
 *
 * 갈 곳은 발송기가 알림마다 실어 보내고 서비스워커가 적어 두는데
 * (`sw.js`의 `putNav`), 앱은 그걸 **켤 때 한 번만** 물어보고 있었다.
 * 아이폰 홈 화면 앱은 알림을 눌러도 대개 **껐다 켜는 게 아니라 접어 둔
 * 것을 도로 펴 주므로**, 그 한 번이 이미 지나간 뒤라 아무 데도 안 갔다.
 * 지금은 **화면으로 돌아올 때마다** 다시 묻는다.
 *
 * 헤드리스에는 서비스워커도 알림도 없지만 **주고받는 말은 그대로 흉내
 * 낼 수 있다** — `navigator.serviceWorker`를 가짜로 갈아 끼우고
 * `take-nav`에 답해 준다. 보는 것은 셋이다:
 *   ① 켤 때 한 번 묻는다  ② 돌아올 때 또 묻는다
 *   ③ 오래된 값에는 안 끌려간다(`NAV_FRESH`) — 돌아올 때마다 묻게 되면서
 *      지난주에 적히고 안 지워진 값이 오늘 화면을 끌고 갈 자리가 생겼다
 */
console.log('\n── 알림을 누르면 그 화면으로 간다 ──');
{
    const nCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await nCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(nCtx);
    await nCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    await nCtx.addInitScript(() => {
        window.__asked = 0;
        window.__reply = null;
        const active = {
            postMessage(msg, ports) {
                if (!msg || msg.type !== 'take-nav') return;
                window.__asked += 1;
                if (window.__reply && ports && ports[0]) ports[0].postMessage(window.__reply);
            },
        };
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                controller: null,
                register: () => Promise.resolve({}),
                addEventListener: () => {},
                removeEventListener: () => {},
                ready: Promise.resolve({ active }),
            },
        });
    });
    const np = await nCtx.newPage();
    await np.goto(`${BASE}/#/`, { waitUntil: 'networkidle' });
    await np.waitForTimeout(500);

    const asked = () => np.evaluate(() => window.__asked);
    ok(await asked() === 1, `켤 때 한 번 물어본다 (${await asked()}번)`);

    /* 방금 누른 알림. 돌아오는 그 순간에 물어보고 따라가야 한다. */
    await np.evaluate(u => {
        window.__reply = { url: u, at: Date.now() };
        document.dispatchEvent(new Event('visibilitychange'));
    }, `${BASE}/#/rounds/r1`);
    await np.waitForTimeout(400);
    ok(await asked() === 2, `돌아올 때 또 물어본다 (${await asked()}번)`);
    const gone = await np.evaluate(() => location.hash);
    ok(gone === '#/rounds/r1', `적어 둔 화면으로 옮겨 간다 (${gone})`);

    /* 지난주에 적히고 안 지워진 값. 끌려가면 안 된다. */
    await np.evaluate(u => {
        window.__reply = { url: u, at: Date.now() - 30 * 60 * 1000 };
        document.dispatchEvent(new Event('visibilitychange'));
    }, `${BASE}/#/polls`);
    await np.waitForTimeout(400);
    const stay = await np.evaluate(() => location.hash);
    ok(stay === '#/rounds/r1', `오래된 값에는 안 끌려간다 (${stay})`);

    await nCtx.close();
}

/* ── 알림 칸이 `확인 중…`에 안 멈춘다 ────────────────────────────
 * **사용자 제보** — `내정보에 이 기기로 받기 확인중..... 이렇게 떠있어`.
 *
 * 화면은 `pushState()`의 답이 오기 전까지 `확인 중…`을 적어 두는데,
 * 그 약속이 **던져지거나 답을 안 주면 그 자리에 영영 멈춘다** — 알림을
 * 켤 길이 통째로 사라지고 무엇이 막힌 것인지도 알 수 없다.
 * 실제로 던지는 자리가 있었다: **플러그인이 안 실린 앱**에서
 * `checkPermissions()`가 `not implemented`로 거절한다.
 *
 * 헤드리스에는 그 플러그인이 없지만 **같은 모양은 만들 수 있다** —
 * `navigator.serviceWorker`를 던지는 것과 답 없는 것으로 갈아 끼운다.
 * 던지는 쪽은 곧바로, 답 없는 쪽은 시간 제한(6초)에 걸려 풀려야 한다.
 */
console.log('\n── 알림 칸이 `확인 중…`에 안 멈춘다 ──');
for (const [what, how, wait] of [
    ['던지면', 'throw new Error("boom")', 1500],
    ['답이 없으면', 'return new Promise(() => {})', 8000],
]) {
    const sCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await sCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(sCtx);
    await sCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    await sCtx.addInitScript(body => {
        // eslint-disable-next-line no-new-func
        const broken = new Function(body);
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                controller: null,
                register: () => Promise.resolve({}),
                getRegistration: broken,
                addEventListener: () => {}, removeEventListener: () => {},
                ready: new Promise(() => {}),
            },
        });
    }, how);
    const sp = await sCtx.newPage();
    await sp.goto(`${BASE}/#/me`, { waitUntil: 'networkidle' });
    await sp.waitForTimeout(wait);

    const desc = await sp.evaluate(() => {
        const row = [...document.querySelectorAll('.switch-label')]
            .find(el => el.textContent.includes('이 기기로 받기'));
        return row?.parentElement?.querySelector('.switch-desc')?.textContent ?? '(없음)';
    });
    ok(!desc.includes('확인 중'), `${what} 확인 중에 안 멈춘다 (${desc})`);

    await sCtx.close();
}

console.log('\n── 지난 목록은 접어 두고 `더 보기`로 편다 ──');
{
    /* 고정 자료는 투표 셋·라운드 넷뿐이라 한도(10)에 안 닿아 **단추가 아예
       안 뜬다.** 지난 것을 스물다섯씩 지어 넣어야 이 자리가 보인다. */
    const day = n => new Date(Date.now() - n * 86400000).toISOString();
    const many = {
        ...tables,
        polls: [
            ...tables.polls,
            /* **마감 시각이 아예 없는 옛 투표.** 지금은 필수라 새로 안 생기지만
               이미 올라간 것이 목록에서 사라지면 안 된다 — 네 갈래로 나눠
               부르는 지금 방식에서 **제일 빠뜨리기 쉬운 자리**다. */
            { id: 'pold', title: '마감 시각 없는 옛 투표', body: '', multi: false,
              anonymous: false, closes_at: null, closed: false,
              created_by: uid(1), created_at: day(40) },
            ...Array.from({ length: 25 }, (_, i) => ({
                id: `pd${i}`, title: `지난 투표 ${i + 1}`, body: '', multi: false,
                anonymous: false, closes_at: day(i + 10), closed: true,
                result_at: day(i + 10), created_by: uid(1), created_at: day(i + 10),
            })),
        ],
        rounds: [
            ...tables.rounds,
            ...Array.from({ length: 25 }, (_, i) => ({
                id: `rd${i}`, title: `지난 라운드 ${i + 1}`, course: '무등산CC',
                lat: null, lon: null, tee_at: day(i + 10), capacity: 4, fee: 100000,
                status: 'open', opens_at: null, kind: 'field', caddie: null, cart: null,
                note: '', created_by: uid(1), created_at: day(i + 20),
            })),
        ],
    };

    const lCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await lCtx.route('**/rest/v1/**', restRoute(many));
    await stubOutside(lCtx);
    await lCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const lp = await lCtx.newPage();

    /** 글자로 단추를 찾아 누른다(클래스가 아니라 사람이 읽는 말로 잡는다). */
    const press = async label => lp.evaluate(t => [...document.querySelectorAll('button')]
        .find(b => b.textContent.includes(t))?.click(), label);
    const seen = async label => lp.evaluate(t => [...document.querySelectorAll('button')]
        .some(b => b.textContent.includes(t)), label);

    await lp.goto(`${BASE}/#/polls`);
    await lp.waitForSelector('.poll-card', { timeout: 20000 });
    await lp.waitForTimeout(700);
    const v1 = await lp.evaluate(() => ({
        마감: document.querySelectorAll('.poll-card.closed').length,
        옛것: [...document.querySelectorAll('.poll-card:not(.closed)')]
            .some(c => c.textContent.includes('마감 시각 없는 옛 투표')),
    }));
    ok(v1.마감 === 10, `마감된 투표는 열까지만 보인다 (${v1.마감}개)`);
    ok(v1.옛것, '마감 시각이 없는 옛 투표도 진행중에 그대로 있다');
    ok(await seen('지난 투표 더 보기'), '`지난 투표 더 보기`가 아래에 뜬다');

    await press('지난 투표 더 보기');
    await lp.waitForTimeout(900);
    const v2 = await lp.evaluate(() => document.querySelectorAll('.poll-card.closed').length);
    ok(v2 > 10, `누르면 지난 것이 더 나온다 (${v2}개)`);
    ok(!(await seen('지난 투표 더 보기')), '다 나오면 단추가 사라진다');

    await lp.goto(`${BASE}/#/rounds`);
    await lp.waitForSelector('.round-card', { timeout: 20000 });
    await lp.waitForTimeout(700);
    const r1 = await lp.evaluate(() =>
        document.querySelectorAll('.round-card.past').length);
    ok(r1 === 10, `지난 라운드도 열까지만 보인다 (${r1}개)`);
    ok(await seen('지난 라운드 더 보기'), '`지난 라운드 더 보기`가 아래에 뜬다');

    await press('지난 라운드 더 보기');
    await lp.waitForTimeout(900);
    const r2 = await lp.evaluate(() =>
        document.querySelectorAll('.round-card.past').length);
    ok(r2 > 10, `누르면 지난 것이 더 나온다 (${r2}개)`);

    await lCtx.close();
}

console.log('\n── 투표 마감 시각은 필수다 ──');
{
    const eCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await eCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(eCtx);
    let made = 0;
    await eCtx.route('**/rest/v1/polls*', route => {
        if (route.request().method() === 'POST') made++;
        return route.fallback();
    });
    await eCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const ep = await eCtx.newPage();
    await ep.goto(`${BASE}/#/polls/new`);
    await ep.waitForSelector('#v-close', { timeout: 20000 });

    /* 제목과 항목 둘을 채운다 — 그것 말고는 막을 것이 없어야, 안 나가는
       까닭이 **마감 시각 하나**로 좁혀진다. */
    await ep.evaluate(() => {
        const set = (el, v) => {
            const p = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
            p.set.call(el, v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const boxes = [...document.querySelectorAll('input.input, textarea.input')];
        set(boxes[0], '연습 투표');
        const opts = [...document.querySelectorAll('.option-row input')];
        set(opts[0], '토요일'); set(opts[1], '일요일');
    });
    /* 마감 시각도 라운드 티오프와 **같은 칸**이라 값이 `data-value`에 있다. */
    ok(await ep.$eval('#v-close', el => el.dataset.value === ''),
       '마감 시각은 비어 있는 채로 시작한다');
    ok(await ep.$eval('label[for="v-close"]', el => !el.textContent.includes('선택')),
       '`(선택)` 딱지가 없어졌다');

    await ep.evaluate(() => [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === '투표 올리기')?.click());
    await ep.waitForTimeout(600);
    ok(made === 0, `마감 시각을 안 적으면 안 올라간다 (보낸 횟수 ${made})`);
    ok(await ep.evaluate(() =>
        [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('마감 시각'))),
       '왜 안 되는지 문구로 알려 준다');

    await ep.evaluate(() => [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === '7일 후')?.click());
    const filled = await ep.$eval('#v-close', el => el.dataset.value);
    ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(filled), `바로누름이 칸을 채운다 (${filled})`);

    await ep.evaluate(() => [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === '투표 올리기')?.click());
    await ep.waitForTimeout(800);
    ok(made === 1, `채우고 나면 올라간다 (보낸 횟수 ${made})`);

    await eCtx.close();
}

/* ── 회원 탈퇴 ──────────────────────────────────────────────────
 * **스토어가 요구하는 자리다** — 계정을 만드는 앱은 그 계정을 **앱 안에서**
 * 지울 수 있어야 한다(애플 심사 5.1.1(v)). 없으면 그것만으로 반려된다.
 *
 * 보는 것은 셋이다:
 *   ① 단추가 **찾기 쉬운 자리**에 있는가 (메뉴 속에 숨기면 그것도 반려다)
 *   ② 확인창에서 **취소하면 아무것도 안 나가는가**
 *   ③ **순서** — 사진을 지우고 나서 계정을 지우는가.
 *      계정을 먼저 지우면 그다음 줄이 권한을 잃어 **사진이 저장소에
 *      영영 남는다.** 화면만 봐서는 안 보이는 자리라 여기서 붙든다.
 */
console.log('\n── 회원 탈퇴 ──');
{
    /* **일반회원으로 본다.** 고정 자료의 나는 앱관리자인데 그 사람에게는
       단추가 아예 안 보인다 — `delete_me()`가 앱관리자만은 막으므로
       (나가면 운영자를 임명할 사람이 없다) 단추를 두면 눌러도 오류만
       나는 자리가 된다. */
    const asMember = {
        ...tables,
        profiles: tables.profiles.map(p => (p.id === ME ? { ...p, role: 'member' } : p)),
    };
    const dCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await dCtx.route('**/rest/v1/**', restRoute(asMember));
    await stubOutside(dCtx);

    const order = [];
    await dCtx.route('**/storage/v1/object/list/avatars**', route => {
        order.push('사진 목록');
        route.fulfill({ status: 200, contentType: 'application/json',
                        body: JSON.stringify([{ name: '1.jpg' }]) });
    });
    await dCtx.route('**/storage/v1/object/avatars**', route => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        order.push('사진 지우기');
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await dCtx.route('**/rest/v1/rpc/delete_me**', route => {
        order.push('계정 지우기');
        route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    });
    await dCtx.route('**/auth/v1/logout**', route => {
        order.push('로그아웃');
        route.fulfill({ status: 204, body: '' });
    });

    await dCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const dp = await dCtx.newPage();
    await dp.goto(`${BASE}/#/me`, { waitUntil: 'networkidle' });
    await dp.waitForTimeout(700);

    const press = label => dp.evaluate(t => [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === t)?.click(), label);
    const seen = label => dp.evaluate(t => [...document.querySelectorAll('button')]
        .some(b => b.textContent.trim() === t), label);

    ok(await seen('회원 탈퇴'), '내 정보에 `회원 탈퇴`가 있다');
    /* 로그아웃 **바로 아래**에 있어야 한다 — 화면 맨 아래 어딘가가 아니라
       나가는 일끼리 모여 있어야 찾는다. */
    const gap = await dp.evaluate(() => {
        const all = [...document.querySelectorAll('button')];
        const i = all.findIndex(b => b.textContent.trim() === '로그아웃');
        const j = all.findIndex(b => b.textContent.trim() === '회원 탈퇴');
        return j - i;
    });
    ok(gap === 1, `로그아웃 바로 다음 단추다 (사이 ${gap - 1}개)`);

    /* **앱관리자에게는 안 보인다** — 위 `asMember`가 있는 까닭이다. */
    const sCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await sCtx.route('**/rest/v1/**', restRoute(tables));   // 고정 자료 = 앱관리자
    await stubOutside(sCtx);
    await sCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const sp = await sCtx.newPage();
    await sp.goto(`${BASE}/#/me`, { waitUntil: 'networkidle' });
    await sp.waitForTimeout(700);
    ok(await sp.evaluate(() => ![...document.querySelectorAll('button')]
        .some(b => b.textContent.trim() === '회원 탈퇴')),
       '앱관리자에게는 안 보인다 (눌러도 막히는 자리라)');
    await sCtx.close();

    await press('회원 탈퇴');
    await dp.waitForTimeout(300);
    ok(await dp.evaluate(() => !!document.querySelector('.confirm-box')),
       '누르면 확인창이 뜬다');
    ok(await dp.evaluate(() => document.querySelector('.confirm-detail')
        ?.textContent.includes('되돌릴 수 없습니다')),
       '무엇이 지워지는지·되돌릴 수 없다는 것을 적어 준다');

    await press('취소');
    await dp.waitForTimeout(400);
    ok(order.length === 0, `취소하면 아무것도 안 나간다 (${order.length}건)`);

    await press('회원 탈퇴');
    await dp.waitForTimeout(300);
    await press('탈퇴하기');
    await dp.waitForTimeout(1200);

    ok(order.filter(o => o === '계정 지우기').length === 1,
       `계정을 지우는 것은 한 번이다 (${order.filter(o => o === '계정 지우기').length}번)`);
    ok(order.indexOf('사진 지우기') !== -1
       && order.indexOf('사진 지우기') < order.indexOf('계정 지우기'),
       `사진을 먼저 지우고 계정을 지운다 (${order.join(' → ')})`);
    ok(order.indexOf('로그아웃') > order.indexOf('계정 지우기'),
       '지운 뒤에 로그아웃한다');

    await dCtx.close();
}

/* ── Apple로 로그인 ─────────────────────────────────────────────
 * **애플 심사 4.8이 요구하는 단추다** — 카카오 같은 남의 로그인만 쓰는
 * 앱에는 맞먹는 로그인을 하나 더 두라고 하고, **눈에 띄게** 두라고 한다.
 * 그래서 있는지만 보지 않고 **카카오 단추와 크기가 같은지**까지 잰다.
 */
console.log('\n── Apple로 로그인 ──');
{
    const lCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await lCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(lCtx);

    /* supabase-js는 주소를 만들어 **그리로 넘어간다**(fetch가 아니다).
       그 이동을 가로채면 어느 공급자로 가려 했는지가 그대로 보인다. */
    let went = '';
    await lCtx.route('**/auth/v1/authorize**', route => {
        went = route.request().url();
        route.abort();
    });

    const lp = await lCtx.newPage();          // 로그인 전이라 세션을 안 넣는다
    await lp.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await lp.waitForTimeout(600);

    const box = await lp.evaluate(() => {
        const one = s => document.querySelector(s)?.getBoundingClientRect();
        const k = one('.kakao-btn'), a = one('.apple-btn');
        return k && a ? { kw: Math.round(k.width), kh: Math.round(k.height),
                          aw: Math.round(a.width), ah: Math.round(a.height) } : null;
    });
    ok(!!box, '로그인 화면에 Apple 단추가 있다');
    ok(!!box && box.kw === box.aw && box.kh === box.ah,
       `카카오 단추와 크기가 같다 (${box ? `${box.kw}×${box.kh} / ${box.aw}×${box.ah}` : '없음'})`);

    await lp.click('.apple-btn');
    await lp.waitForTimeout(800);
    ok(went.includes('provider=apple'),
       `누르면 애플로 보낸다 (${went ? new URL(went).searchParams.get('provider') : '아무 데도 안 갔다'})`);

    await lCtx.close();
}

/* ── 이름이 없으면 닉네임부터 받는다 ────────────────────────────
 * **애플은 이름을 맨 처음 허락할 때 딱 한 번만 준다.** 우리는 그것을 아예
 * 안 받으므로(`signInWithApple`), 애플로 들어온 사람은 이름이 빈 채로
 * 앱에 닿는다. 그대로 두면 회원 명단에 이름 없는 줄이 서고 운영진이
 * 누구인지 몰라 승인할 수도 없다 — `needsProfile`이 그것도 본다.
 */
console.log('\n── 이름이 없으면 닉네임부터 받는다 ──');
{
    const noName = {
        ...tables,
        profiles: tables.profiles.map(p => (p.id === ME ? { ...p, name: '' } : p)),
    };
    const nCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await nCtx.route('**/rest/v1/**', restRoute(noName));
    await stubOutside(nCtx);
    await nCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

    const np = await nCtx.newPage();
    await np.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await np.waitForTimeout(800);

    ok(await np.evaluate(() => !!document.querySelector('#fp-name')),
       '이름이 비어 있으면 닉네임 칸이 뜬다');
    ok(await np.evaluate(() => !!document.querySelector('.tabbar')) === false,
       '적기 전에는 앱으로 못 들어간다');

    await nCtx.close();
}

/* ── 알림함 (🔔) ────────────────────────────────────────────────
 *
 * 사용자 요청 — `앱가이드 위치를 다른데로 옮기고 그 자리에 종모양 알림을
 * 만들어서 숫자2 표시를 해주고 그걸 누르면 정산,참가확정 내용을 알수있도록`.
 *
 * 폰 아이콘의 숫자에는 **대화까지** 들어 있어, 그중 무엇이 정산이고 무엇이
 * 자리가 난 것인지 앱 안에서 알 길이 없었다. 보는 것은 넷이다:
 *   ① 홈 머리말에 종과 **안 읽은 개수**가 뜨는가 (대화는 안 든다)
 *   ② 가이드가 **홈에서 빠지고** `내 정보`로 갔는가 (양쪽에 두지 않는다)
 *   ③ 종을 누르면 목록이 뜨고, **여는 순간 다 읽음**으로 나가는가
 *   ④ 줄을 누르면 그 화면으로 가는가
 */
/* ── 치는 글에 어울리는 이모티콘 줄 ────────────────────────────
 *
 * 사용자 요청 — `카톡처럼 메시지에 따라 이모티콘이 뜨는기능을 만들자.
 * 굿모닝하면 관련 이모티콘이뜨는거말이야`.
 *
 * **고르는 규칙은 여기서 안 본다** — 그건 브라우저가 필요 없어
 * `node --experimental-strip-types .dev/suggest-check.mts`가 92가지로
 * 붙들어 둔다. 여기서 보는 것은 **화면에서 정말 그렇게 도는가**다:
 * 줄이 뜨고 · 아무 때나 안 뜨고 · 누르면 미리보기로 물리고 · **글자를 칠 때
 * 화면이 다시 안 그려지는가**(그 마지막이 이 기능의 값이 달린 자리다).
 */
console.log('\n── 치는 글에 어울리는 이모티콘 ──');
{
    await go('/#/chat', 1200);
    const row = async () => page.evaluate(() => {
        const box = document.querySelector('.chat-suggest');
        if (!box || box.hidden) return 0;
        return box.querySelectorAll('.chat-suggest-btn').length;
    });
    /* **`type`으로 친다** — `fill`은 한 번에 값을 넣어 `onChange`가 한 번만
       돌므로 치는 중의 움직임이 안 잡힌다. */
    const type = async (text) => {
        await page.fill('.chat-input .textarea', '');
        await page.click('.chat-input .textarea');
        await page.type('.chat-input .textarea', text, { delay: 5 });
        await page.waitForTimeout(150);
    };

    ok(await row() === 0, '들어올 때는 안 뜬다');
    await type('내일 몇 명이나 되나요');
    ok(await row() === 0, '아무 말에나 안 뜬다');
    await type('굿모닝');
    const hit = await row();
    ok(hit > 0, `\`굿모닝\`을 치면 이모티콘이 뜬다 (${hit}장)`);
    ok(hit <= 8, `여덟 장을 안 넘는다 (${hit}장)`);

    /* **입력칸 위에 뜬다.** 클래스가 아니라 자리를 잰다 — 목록을 덮으면
       치는 동안 말풍선이 가린다. */
    const at = await page.evaluate(() => {
        const b = document.querySelector('.chat-suggest')?.getBoundingClientRect();
        const t = document.querySelector('.chat-input .textarea')?.getBoundingClientRect();
        const one = document.querySelector('.chat-suggest-btn')?.getBoundingClientRect();
        const st = document.querySelector('.chat-suggest')
            ? getComputedStyle(document.querySelector('.chat-suggest')) : null;
        return b && t && one && st
            ? { bot: Math.round(b.bottom), ta: Math.round(t.top),
                w: Math.round(one.width), h: Math.round(one.height),
                left: Math.round(b.left), right: Math.round(innerWidth - b.right),
                box: Math.round(b.height), r: parseFloat(st.borderTopLeftRadius),
                bg: st.backgroundColor, x: st.overflowX }
            : null;
    });
    ok(at && at.bot <= at.ta, `글칸보다 위에 있다 (줄 아래변 ${at?.bot} ≤ 글칸 윗변 ${at?.ta})`);
    ok(at && at.h >= 30 && at.w >= 30, `누를 만큼 크다 (실제 ${at?.w}×${at?.h})`);
    /* **흰 알약 판 위에 얹힌다**(사용자 요청 — 카톡처럼). 카톡 화면을
       픽셀로 재서 맞춘 값이라(화면 끝 10px · 높이 68 · 모서리 25 · 순백)
       **클래스 이름만 보면 CSS가 뒤집혀도 초록으로 뜨므로 값을 잰다.** */
    ok(at?.bg === 'rgb(255, 255, 255)', `흰 알약이다 (실제 ${at?.bg})`);
    ok(at && at.left === 10 && at.right === 10,
       `화면 끝에서 10px 띄운다 (실제 왼 ${at?.left} · 오 ${at?.right})`);
    ok(at && at.box === 68, `높이가 68px이다 (실제 ${at?.box})`);
    ok(at && Math.round(at.r) === 25, `모서리가 25px이다 (실제 ${at?.r})`);
    /* **가로로만 굴러간다** — 세로로 접히면 두 줄이 되어 말풍선을 덮는다. */
    ok(at?.x === 'auto' || at?.x === 'scroll', `가로로 굴러간다 (실제 ${at?.x})`);

    /* **고르면 곧바로 안 나가고 미리보기로 물린다**(서랍에서 고른 것과 같다). */
    const before = await page.$$eval('.chat-row', els => els.length);
    await page.click('.chat-suggest-btn');
    await page.waitForTimeout(300);
    ok(await page.$('.sticker-peek') !== null, '누르면 미리보기로 물린다');
    ok(await page.$$eval('.chat-row', els => els.length) === before,
       '누른 것만으로는 안 나간다');
    ok(await row() === 0, '고르고 나면 줄이 걷힌다 — 미리보기가 그 자리에 선다');

    /* **`@`를 치는 동안은 접는다** — 입력칸 위에 두 줄이 겹치면 말풍선이
       통째로 가린다(부르는 일이 먼저다). */
    await page.click('.sticker-peek-x');
    await type('굿모닝 @');
    ok(await row() === 0, '`@`를 치는 동안은 접는다');
    ok(await page.$('.mention-list') !== null, '그 자리는 언급 목록이 쓴다');

    /* **글자를 칠 때 화면이 다시 안 그려진다.** 이 줄이 이 기능에서 제일
       무거운 자리였다 — state로 두었더니 줄이 뜨는 그 한 글자에서
       **말풍선 쉰 개가 통째로 다시 맞춰져 65ms**가 났다(`type-bench`).
       지금은 DOM에 직접 그리므로 리액트가 아예 안 돈다.
       **클래스 이름만 보면 state로 되돌려도 초록으로 뜨므로**, 말풍선
       하나에 표를 심어 두고 그것이 살아남는지로 잰다. */
    await page.fill('.chat-input .textarea', '');
    await page.evaluate(() => {
        const el = document.querySelector('.chat-row');
        if (el) el.dataset.keep = '1';
    });
    await type('감사합니다');
    ok(await row() > 0, '`감사합니다`를 치면 뜬다');
    ok(await page.evaluate(() => document.querySelector('.chat-row')?.dataset.keep === '1'),
       '줄이 떠도 말풍선은 다시 안 그려진다 (state로 되돌리면 표가 날아간다)');
    await page.fill('.chat-input .textarea', '');
}

/* ── 축하 폭죽 ──────────────────────────────────────────────────
 *
 * 사용자 요청 — `ㅊㅋ,축하,ㅊㅋㅊㅋ,추카 문구를 입력하고 전송을하면
 * 메시지입력창 윗쪽에 카톡처럼 폭죽버튼이 나오고 그걸 누르면 카톡처럼
 * 화면에 폭죽이 나오는 기능`.
 *
 * **클래스 이름만 보면 초록으로 뜨는 자리가 아니다** — 단추가 정말
 * `뜨고/안 뜨고`가 갈리는지를 본다. 들어올 때 안 뜨는 것이 특히 그렇다:
 * 그 줄을 빼면 방을 열 때마다 지난달 축하로 단추가 떠 버린다.
 */
console.log('\n── 축하 폭죽 ──');
{
    await go('/#/chat', 1200);
    ok(await page.$('.cheer-btn') === null,
       '들어올 때는 안 뜬다 — 지난 축하로 단추가 떠서는 안 된다');

    /* **그냥 글에는 안 뜬다.** `ㅋㅋ`까지 걸리게 해 두면 웃는 말마다 단추가
       떠서 정작 축하할 때 아무도 안 누른다. */
    await page.fill('.chat-input .textarea', '오늘 날씨 좋네요 ㅋㅋ');
    await page.click('.chat-send');
    await page.waitForTimeout(700);
    ok(await page.$('.cheer-btn') === null,
       `보통 글에는 안 뜬다 (실제 ${await page.$('.cheer-btn') ? '떴다' : '안 떴다'})`);

    /* 사용자가 적어 준 넷 — `ㅊㅋ` · `축하` · `ㅊㅋㅊㅋ` · `추카`. */
    for (const word of ['ㅊㅋ', '축하합니다', 'ㅊㅋㅊㅋ', '추카추카']) {
        await page.evaluate(() => {
            document.querySelector('.cheer-btn')?.dispatchEvent(
                new MouseEvent('click', { bubbles: true }));
        });
        await page.waitForTimeout(200);
        await page.fill('.chat-input .textarea', word);
        await page.click('.chat-send');
        await page.waitForTimeout(700);
        ok(await page.$('.cheer-btn') !== null, `\`${word}\`를 보내면 단추가 뜬다`);
    }

    /* **입력칸 위에 뜬다**(사용자 요청 — `메시지입력창 윗쪽에`).
       클래스가 아니라 **자리를 잰다.** */
    const at = await page.evaluate(() => {
        const el = document.querySelector('.cheer-btn');
        const b = el?.getBoundingClientRect();
        const t = document.querySelector('.chat-input .textarea')?.getBoundingClientRect();
        const box = document.querySelector('.chat-over')?.getBoundingClientRect();
        return b && t && box
            ? { btn: Math.round(b.bottom), ta: Math.round(t.top), h: Math.round(b.height),
                w: Math.round(b.width), boxW: Math.round(box.width),
                mid: Math.round(b.left + b.width / 2), boxMid: Math.round(box.left + box.width / 2) }
            : null;
    });
    ok(at && at.btn <= at.ta, `글칸보다 위에 있다 (단추 아래변 ${at?.btn} ≤ 글칸 윗변 ${at?.ta})`);
    ok(at && at.h >= 30, `누를 만큼 크다 (실제 ${at?.h}px)`);

    /* **가로는 글자만큼만 쓰고 가운데에 선다**(사용자 요청 — `폭죽단추
       좌우크기를 글씨크기만큼 줄여서 가운데에 뜨게해줘`).
       **클래스 이름만 보면 `width: 100%`로 되돌려도 초록으로 뜨므로 잰다.** */
    ok(at && at.w < at.boxW - 40,
       `줄을 통째로 안 채운다 (단추 ${at?.w}px < 줄 ${at?.boxW}px)`);
    ok(at && Math.abs(at.mid - at.boxMid) <= 2,
       `줄 가운데에 선다 (어긋남 ${at ? Math.abs(at.mid - at.boxMid) : '?'}px)`);

    /* 누르면 그 자리에서 터지고 **단추는 사라진다.** 터지는 동안에도
       대화는 그대로 눌려야 하므로 `pointer-events`를 함께 잰다. */
    await page.click('.cheer-btn');
    await page.waitForTimeout(150);
    const burst = await page.evaluate(() => {
        const c = document.querySelector('.cheer-burst');
        if (!c) return null;
        const st = getComputedStyle(c);
        return { pe: st.pointerEvents, z: st.zIndex, w: c.width, h: c.height };
    });
    ok(!!burst, '누르면 폭죽이 터진다');
    ok(burst?.pe === 'none', `터지는 동안에도 대화가 눌린다 (실제 ${burst?.pe})`);
    ok(Number(burst?.z) < 1200, `토스트보다는 아래다 (실제 ${burst?.z})`);
    ok((burst?.w ?? 0) > 0 && (burst?.h ?? 0) > 0,
       `그릴 자리가 잡혀 있다 (실제 ${burst?.w}×${burst?.h})`);
    ok(await page.$('.cheer-btn') === null, '누르고 나면 단추가 사라진다');

    /* **스스로 끝난다.** 안 걷히면 그림이 화면에 그대로 남아 앱이 죽은
       것처럼 보인다(뒤로 가기 그림에서 겪은 그 자리다). */
    await page.waitForTimeout(3200);
    ok(await page.$('.cheer-burst') === null, '다 터지면 스스로 걷힌다');

    /* **단추도 10초 뒤에는 스스로 걷힌다**(사용자 요청 — `폭죽터트리기
       단추는 10초만 보이게해줘. 채팅을 가리니까`). 입력칸 위에 얹히는
       줄이라 남아 있으면 말풍선 한 줄을 계속 가린다.
       예전 값(1분)으로 되돌리면 여기서 빨갛게 뜬다. */
    await page.fill('.chat-input .textarea', '추카드려요');
    await page.click('.chat-send');
    await page.waitForTimeout(700);
    ok(await page.$('.cheer-btn') !== null, '걷히는 것을 보려고 단추를 다시 띄운다');
    await page.waitForTimeout(10_000);
    ok(await page.$('.cheer-btn') === null, '10초가 지나면 단추가 스스로 걷힌다');
}

/* ── 생일 칸이 없는 저장소에서도 열린다 ─────────────────────────
 *
 * **앱은 밀면 몇 분 뒤 올라가는데 폰에는 옛 화면이 남아 있을 수 있다.**
 * `needsBirthday`가 `null`(안 적음)과 `undefined`(칸이 아예 없음)를 안
 * 가르면, 저장도 안 되는 화면에 **회원 모두가 갇힌다** — `needsProfile`이
 * 그 둘을 가르는 것과 똑같은 자리다.
 */
console.log('\n── 생일 칸이 없는 저장소 ──');
{
    const nCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await nCtx.route('**/rest/v1/**', restRoute(tables));
    /* 진짜 PostgREST처럼 **그 칸이 아예 없는 줄**을 준다 — 지우고 주는 것이
       곧 `undefined`다. 빈 값(`null`)으로 주면 갈래가 안 갈린다. */
    await nCtx.route('**/rest/v1/profile_private**', route => {
        /* **`route.fetch()`로 받아 오지 말 것** — 그건 진짜 서버로 나가는데
           여기 주소(`demo.supabase.co`)는 닿을 데가 없어 그 자리에서 죽는다.
           흉내를 직접 불러 답을 만든 뒤 칸만 걷어낸다. */
        const req = route.request();
        const rows = handleRest(tables, new URL(req.url()), req);
        const out = (Array.isArray(rows) ? rows : [rows]).filter(Boolean).map(row => {
            const copy = { ...row };
            delete copy.birth_md; delete copy.birth_cal;
            return copy;
        });
        route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify(out) });
    });
    await nCtx.route('**/auth/v1/**', r => r.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
    await stubOutside(nCtx);
    await nCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

    const nPage = await nCtx.newPage();
    await nPage.goto(BASE + '/#/', { waitUntil: 'networkidle' });
    await nPage.waitForTimeout(900);
    ok((await nPage.$$('.tabbar')).length === 1,
       '칸이 없으면 안 막는다 — 앱으로 그대로 들어간다');
    ok(!(await nPage.textContent('.page') ?? '').includes('저장하고 시작하기'),
       '받는 화면으로 끌려가지 않는다');
    await nCtx.close();
}

console.log('\n── 알림함 (🔔) ──');
{
    const aCtx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await aCtx.route('**/rest/v1/**', restRoute(tables));
    await stubOutside(aCtx);

    /* 읽음 도장이 몇 번 나가는지 세고, **진짜로 찍어 준다.**
     *
     * 흉내(`rest.mjs`)는 고치기를 받아도 고정 자료를 안 건드리는데, 그러면
     * 다시 받아 온 줄이 여전히 `read_at`이 빈 채로 와서 **`read_at`으로
     * 그리는 옛 코드도 초록으로 뜬다** — 초록을 위한 검사가 되어 버린다
     * (깜빡임에서 얻은 교훈 그대로다). 진짜 PostgREST처럼 **찍고, 방금
     * 찍은 줄만 돌려준다.** */
    const marks = [];
    await aCtx.route('**/rest/v1/notifications**', route => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        marks.push(1);
        const hit = (tables.notifications ?? []).filter(n => !n.read_at);
        const now = new Date().toISOString();
        for (const n of hit) n.read_at = now;
        return route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify(hit.map(n => ({ id: n.id }))),
        });
    });

    await aCtx.addInitScript(s =>
        localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);
    const ap = await aCtx.newPage();
    await ap.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await ap.waitForTimeout(900);

    /* 고정 자료의 안 읽은 알림은 둘이다(정산 · 자리 났음) — 사용자가 든
       예시 그대로다. **대화는 안 든다**(그건 탭바 몫이다). */
    ok(await ap.evaluate(() => document.querySelector('.bell-dot')?.textContent) === '2',
       '홈 머리말의 종에 안 읽은 알림 수가 뜬다 (2)');

    ok(await ap.evaluate(() => !document.body.innerText.includes('앱 가이드')),
       '가이드는 홈 머리말에서 빠졌다');

    /* **접어 두었다 펴면 그 사이 온 것이 종에 붙는가**(사용자 제보 —
       `알림 후 앱에 들어가서보면 앱 종에 뱃지알림이 안생겨`).
       앱을 접으면 실시간 연결이 끊겨 그동안 들어온 것은 되받아 오지
       않는데, **폰 알림을 눌러 들어오는 길이 대개 접은 것을 펴는 것**이라
       화면이 새로 만들어지지도 않는다 — 조회가 한 번도 다시 안 돌았다.
       여기서는 실시간이 아예 막혀 있어(`stubOutside`) 그 상태가 그대로다.
       `useRefreshOnShow`를 빼면 `2`에 멈춰 빨갛게 뜬다. */
    tables.notifications.unshift({
        id: 'nNew', user_id: tables.notifications[0].user_id, kind: 'round_groups',
        title: '🚩 조 편성', body: '무등산CC · 3조',
        url: '#/rounds/r1', created_at: new Date().toISOString(), read_at: null,
    });
    await ap.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await ap.waitForTimeout(700);
    ok(await ap.evaluate(() => document.querySelector('.bell-dot')?.textContent) === '3',
       '접어 두었다 펴면 그 사이 온 알림이 종에 붙는다 (2 → 3)');

    await ap.evaluate(() => document.querySelector('.bell')?.click());
    await ap.waitForTimeout(700);

    ok(await ap.evaluate(() => location.hash) === '#/alerts', '종을 누르면 알림함으로 간다');
    ok(await ap.evaluate(() => document.querySelectorAll('.alert-row').length) === 4,
       '알림함에 왔던 알림이 쌓여 있다');

    /* **읽은 것과 안 읽은 것이 색으로 갈리는가**(사용자 요청 — `내가
       확인한건 색상을 다르게해서 확인한건지 안한건지 알수있게해줘`).
       **여는 순간 다 읽음으로 찍으므로** `read_at`으로 그리면 여기서
       넷 다 `seen`이 된다 — 화면이 얼려 둔 목록(`fresh`)을 빼면 실제로
       빨갛게 뜬다. 고정 자료는 안 읽은 것 셋(n1·n2·nNew)과 읽은 것 하나다. */
    const tone = await ap.evaluate(() => {
        const rows = [...document.querySelectorAll('.alert-row')];
        const bg = r => getComputedStyle(r).backgroundColor;
        const f = rows.filter(r => r.classList.contains('fresh'));
        const s = rows.filter(r => r.classList.contains('seen'));
        return {
            fresh: f.length, seen: s.length,
            freshBg: f[0] && bg(f[0]), seenBg: s[0] && bg(s[0]),
            mark: document.querySelectorAll('.alert-row.fresh .alert-new').length,
        };
    });
    ok(tone.fresh === 3 && tone.seen === 1,
       `안 읽은 셋과 읽은 하나로 갈린다 (안 읽음 ${tone.fresh} · 읽음 ${tone.seen})`);
    ok(tone.freshBg && tone.seenBg && tone.freshBg !== tone.seenBg,
       `바탕색이 실제로 다르다 (${tone.freshBg} vs ${tone.seenBg})`);
    ok(tone.mark === 3, `안 읽은 줄에만 표가 붙는다 (${tone.mark}개)`);
    /* **제목의 그림글자를 두 번 그리지 않는다** — 제목에 이미 붙어 있어
       아이콘을 따로 그리면 `💰 💰 정산`이 된다(찍어 보고 잡았다). */
    ok(await ap.evaluate(() =>
        !/(\p{Extended_Pictographic}).*\1/u.test(
            document.querySelector('.alert-row')?.innerText ?? '')),
       '같은 그림글자가 두 번 안 나온다');
    ok(marks.length === 1, `여는 순간 읽음이 한 번만 나간다 (${marks.length}번)`);

    // 줄을 누르면 그 건으로 간다 — 목록이 아니라.
    await ap.evaluate(() => document.querySelector('.alert-row')?.click());
    await ap.waitForTimeout(500);
    ok(/^#\/rounds\/r\d/.test(await ap.evaluate(() => location.hash)),
       '줄을 누르면 그 라운드로 간다');

    // 가이드는 `내 정보`에 있다.
    await ap.goto(`${BASE}/#/me`, { waitUntil: 'networkidle' });
    await ap.waitForTimeout(600);
    ok(await ap.evaluate(() => document.body.innerText.includes('앱 사용자 가이드')),
       '가이드는 `내 정보` 메뉴에 있다');

    await aCtx.close();
}

await browser.close();

if (errors.length) {
    console.log('\n❌ 자바스크립트 오류');
    [...new Set(errors)].slice(0, 5).forEach(e => console.log('   ' + e.slice(0, 160)));
    fail += errors.length;
}
console.log(`\n${fail ? '❌' : '✅'} ${pass}개 통과 · ${fail}개 실패`);
process.exitCode = fail ? 1 : 0;
