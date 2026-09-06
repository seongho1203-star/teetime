/* **대화를 위로 훑을 때 끊기는가**를 숫자로 바꾼다.
 *
 *   npm run dev -- --port 5199 &
 *   node .dev/jank.mjs            # SLOW=12 REPS=3 으로 바꿔 가며
 *
 * `앱에 처음 들어가서 채팅창을 위로 올리면 끊기면서 올라간다. 한 번 올리고
 * 난 뒤에는 괜찮다`는 제보에서 나온 도구다. 스크린샷으로도 `behave.mjs`로도
 * 안 잡히는 자리다 — 화면은 멀쩡히 그려지고 보내는 값도 맞다.
 *
 * **무엇이 무겁게 하는지 갈라 보려고 방을 넷 만든다**: 글만 · 사진 · 움짤
 * (움직이는 이모티콘) · 섞임. 각 방에서 위로 한 번 훑고(첫 스크롤), 맨
 * 아래로 돌린 뒤 다시 훑는다. **첫 번째만 크면 '그때 처음 하는 일'이
 * 범인이다** — 그림을 그때 받아 오는 것이 그랬다.
 *
 * **서버는 폰보다 빠르므로 CPU를 느리게 걸어 놓고 잰다**(`SLOW`, 기본 12배).
 * 안 걸면 넷 다 0으로 나와 아무것도 안 보인다.
 * **한 번만 재지 말 것** — 실행마다 서너 개씩 튄다. 기본 세 번 재서 평균을
 * 낸다(`REPS`). 이 숫자는 합격선이 아니라 **자리끼리·고치기 전후를 견주는
 * 눈금**이다(`type-bench.mjs`와 같은 결이다).
 *
 * 재 둔 값 (SLOW=12 · REPS=3, 첫 스크롤에 밀린 프레임):
 *   미리 받아 두기 전   글만 1.0 · 사진 6.0 · 움짤 6.3 · 섞임 12.0 (최대 133ms)
 *   넣은 뒤            글만 1.0 · 사진 2.0 · 움짤 1.0 · 섞임  3.7 (최대  50ms)
 */
import { chromium } from 'playwright-core';
import * as fx from './fixtures.mjs';
import { restRoute, stubOutside } from './rest.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:5199';
const ME = fx.ME;
const SLOW = Number(process.env.SLOW ?? 6);   // CPU를 몇 배 느리게

const SESSION = {
    access_token: 'fake', token_type: 'bearer', refresh_token: 'fake',
    expires_in: 999999, expires_at: Math.floor(Date.now() / 1000) + 999999,
    user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'a@b.c',
            app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

const ANIM = ['mvkkk', 'mvfighting', 'mvyay', 'mvogu', 'mvcry', 'mvblove',
              'mvbfight', 'mvbthanks', 'mvbcry', 'mvbyay'];

const base = new Date();
base.setHours(9, 0, 0, 0);
const at = i => new Date(base.getTime() + i * 60000).toISOString();
const others = fx.profiles.filter(p => p.id !== ME).map(p => p.id);

/** 70마디짜리 방. `mix`가 몇 번째마다 무엇을 끼울지 정한다. */
function room(kind) {
    const out = [];
    for (let i = 0; i < 70; i++) {
        let img = null;
        if ((kind === 'photo' || kind === 'mix') && i % 5 === 2) img = `http://photo.test/${i}.jpg`;
        if ((kind === 'anim' || kind === 'mix') && i % 5 === 4) img = `sticker:${ANIM[i % ANIM.length]}`;
        out.push({ id: `x${i}`, room_id: 'room1',
            user_id: i % 4 === 0 ? ME : others[i % others.length],
            body: img ? '' : `${i}번째 이야기입니다 오늘 라운드 좋았습니다`,
            image_url: img, created_at: at(i) });
    }
    return out;
}

const browser = await chromium.launch({ executablePath: CHROME });

/* 폰 사진만 한 JPEG을 브라우저에서 한 장 만들어 쓴다 — 저장소에 그림 파일을
   두지 않으려는 것이다. **작은 그림으로 바꾸지 말 것**: 밀린 프레임 수는
   그대로여도 가장 긴 프레임이 짧아져 눈금이 무뎌진다(1600px 117ms · 480px 83ms). */
const shot = await browser.newPage();
const PHOTO = Buffer.from(await shot.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1200;
    const g = c.getContext('2d');
    for (let y = 0; y < 1200; y += 8) for (let x = 0; x < 1600; x += 8) {
        g.fillStyle = `rgb(${(x * 7) % 256},${(y * 11) % 256},${(x + y) % 256})`;
        g.fillRect(x, y, 8, 8);
    }
    return c.toDataURL('image/jpeg', 0.82).split(',')[1];
}), 'base64');
await shot.close();

const REPS = Number(process.env.REPS ?? 3);
for (const [label, kind] of [['글만', 'text'], ['사진', 'photo'],
                             ['움짤', 'anim'], ['섞임', 'mix']]) {
  const firsts = [], seconds = [], maxes = [];
  for (let rep = 0; rep < REPS; rep++) {
    const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await ctx.route('**/rest/v1/**', restRoute({ ...fx.tables, messages: room(kind) }));
    await ctx.route('**photo.test/**', route =>
        route.fulfill({ status: 200, contentType: 'image/jpeg', body: PHOTO }));
    await ctx.route('**/auth/v1/**', r => r.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) }));
    await stubOutside(ctx);
    await ctx.addInitScript(s => localStorage.setItem('sb-demo-auth-token', JSON.stringify(s)), SESSION);

    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${BASE}/#/chat`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.chat-list .chat-row', { timeout: 20000 });
    await page.waitForTimeout(3000);   // 사람이 몇 초 읽는 동안
    // 폰처럼 느리게. **화면을 다 그린 뒤에 건다** — 첫 그리기까지 느려지면
    // 스크롤과 상관없는 시간이 섞인다.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });

    const climb = () => page.evaluate(async () => {
        const el = document.querySelector('.chat-list');
        const frames = [];
        let last = performance.now(), stop = false;
        const tick = t => { frames.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        // 손가락으로 훑듯 30프레임에 걸쳐 올린다.
        for (let i = 0; i < 30; i++) {
            el.scrollTop = Math.max(0, el.scrollTop - 110);
            await new Promise(r => requestAnimationFrame(r));
        }
        await new Promise(r => setTimeout(r, 300));
        stop = true;
        frames.shift();
        return { over: frames.filter(f => f > 32).length,
                 max: Math.round(Math.max(...frames)),
                 n: frames.length };
    });

    const a = await climb();
    await page.evaluate(() => {
        const el = document.querySelector('.chat-list');
        el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(1500);
    const b = await climb();
    firsts.push(a.over); seconds.push(b.over); maxes.push(a.max);
    await ctx.close();
  }
  const avg = v => (v.reduce((x, y) => x + y, 0) / v.length).toFixed(1);
  console.log(`${label.padEnd(4)}  첫 스크롤 밀린 프레임 ${String(avg(firsts)).padStart(5)}개 `
            + `[${firsts.join(' ')}] (최대 ${Math.max(...maxes)}ms)   ·   두 번째 ${avg(seconds)}개`);
}

await browser.close();
