/* 치는 글에 이모티콘을 골라 주는 규칙을 붙들어 둔다 (브라우저가 필요 없다).
 *
 *   node --experimental-strip-types .dev/suggest-check.mts
 *
 * **어떤 말에 어떤 이모티콘이 뜨는지는 이제 DB(`sticker_words`)가 정한다**
 * (사용자 요청 — `이걸 내가 수동으로 입력해서 지정하고싶은데` · `자동 추천
 * 전부 끄기`). 그래서 여기서는 **말 자체를 안 본다** — 앱관리자가 무엇을
 * 적든 그건 사용자 몫이다. 보는 것은 **고르는 방식**이다: 깎는 자 ·
 * 두 글자부터 · 차례 · 몇 장까지 · 그리고 **이름으로 짐작하지 않는가.**
 */
import { SUGGEST_MAX, SUGGEST_MIN, SUGGEST_ANIM, suggestFor, buildRules, splitWords, norm }
    from '../src/lib/suggest.ts';
import { STICKERS } from '../src/lib/stickers.ts';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
    if (cond) pass++; else fail++;
    console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
};

/* 앱관리자가 적어 둔 것처럼 — DB 줄 그대로다. */
const anim = STICKERS.filter(s => s.id.startsWith('mv')).map(s => s.id);
const ROWS = [
    { sticker_id: 'ghi', word: '굿모닝' },
    { sticker_id: 'pnhi', word: '굿모닝' },
    { sticker_id: 'gthanks', word: '감사' },
    { sticker_id: 'wbeung', word: '응?' },
    { sticker_id: 'wbeung', word: '엥?' },
    /* 손으로 SQL로 넣어 깎이지 않은 채 들어온 줄 — 그래도 걸려야 한다. */
    { sticker_id: 'pnthanks', word: '땡 큐!' },
    /* 한 글자는 DB가 막지만 혹시 들어와도 안 걸려야 한다. */
    { sticker_id: 'ctthanks', word: 'ㅋ' },
    /* 없는 이모티콘을 가리키는 줄 — 그림을 지운 뒤에도 남을 수 있다. */
    { sticker_id: 'nope-gone', word: '굿모닝' },
    /* 한 말에 움직이는 것을 잔뜩 단 경우 — 몇 장까지만 섞이나. */
    ...anim.slice(0, 7).map(id => ({ sticker_id: id, word: '하트뿅' })),
    /* 멈춘 것까지 스무 장 — 여덟을 넘기지 않나. */
    ...STICKERS.filter(s => !s.id.startsWith('mv')).slice(0, 20)
        .map(s => ({ sticker_id: s.id, word: '많이많이' })),
];
const RULES = buildRules(ROWS);
const ids = (draft: string) => suggestFor(draft, RULES).map(s => s.id);

/* ── 1. 적어 둔 말이 걸리는가 ─────────────────────────────── */
console.log('\n── 적어 둔 말 ──');
ok(ids('굿모닝').includes('ghi') && ids('굿모닝').includes('pnhi'), '`굿모닝` → 적어 둔 둘이 다 뜬다');
ok(ids('굿모닝입니다').includes('ghi'), '뒤에 붙어도 걸린다');
ok(ids('굿 모닝!').includes('ghi'), '공백·문장부호는 지우고 본다');
ok(ids('감사합니다').includes('gthanks'), '`감사` → `감사합니다`에도 걸린다');
ok(ids('땡큐요').includes('pnthanks'), '깎이지 않은 채 들어온 줄도 걸린다');
ok(!ids('굿모닝').includes('nope-gone'), '없는 이모티콘은 조용히 빠진다');

/* ── 2. 이름으로 짐작하지 않는다 ──────────────────────────────
   사용자가 `자동 추천 전부 끄기`를 골랐다. 이모티콘 이름이 `감사합니다`인
   것이 여럿 있어도 **적어 둔 것만** 떠야 한다. */
console.log('\n── 이름으로 짐작하지 않는다 ──');
ok(!ids('감사합니다').includes('mvp42'), '이름이 `감사합니다`여도 안 적었으면 안 뜬다');
ok(ids('쿨쿨').length === 0, '이름 그대로 친 것도 안 걸린다(`쿨쿨`)');
ok(suggestFor('굿모닝', []).length === 0, '표가 비었으면 아무것도 안 뜬다');

/* ── 3. 물음표가 갈래를 가른다 ────────────────────────────── */
console.log('\n── 물음표 ──');
ok(ids('응?').includes('wbeung'), '`응?`');
ok(ids('응？').includes('wbeung'), '전각 `？`도 같다');
ok(!ids('응원합니다').includes('wbeung'), '`응원`에는 안 뜬다');
ok(ids('엥? 뭐야').includes('wbeung'), '`엥?`');

/* ── 4. 아무 때나 뜨면 안 된다 ────────────────────────────── */
console.log('\n── 안 떠야 하는 자리 ──');
ok(suggestFor('', RULES).length === 0, '빈 글에는 안 뜬다');
ok(ids('ㅋ').length === 0, `한 글자 말은 안 걸린다 (${SUGGEST_MIN}글자부터)`);
ok(ids('ㅋㅋㅋ').length === 0, '한 글자로 적힌 줄은 규칙에서 빠진다');
ok(ids('내일 몇 명이나 되나요').length === 0, '아무 말에나 안 뜬다');

/* ── 5. 몇 장까지 ─────────────────────────────────────────── */
console.log('\n── 몇 장까지 ──');
const many = ids('많이많이');
ok(many.length <= SUGGEST_MAX, `스무 장을 달아도 ${many.length}장 (${SUGGEST_MAX} 이하)`);
ok(new Set(many).size === many.length, '같은 것이 두 번 안 나온다');
const moving = ids('하트뿅').filter(id => id.startsWith('mv')).length;
ok(moving <= SUGGEST_ANIM && moving > 2, `움직이는 것 ${moving}장 (${SUGGEST_ANIM} 이하 · 예전 둘보다 넉넉히)`);

/* ── 6. 차례는 이모티콘 목록 그대로 ─────────────────────────── */
console.log('\n── 차례 ──');
const order = new Map(STICKERS.map((s, i) => [s.id, i]));
const both = ids('굿모닝 감사');
ok(both.every((id, i) => i === 0 || order.get(both[i - 1])! < order.get(id)!),
   `목록 차례 그대로 (${both.join(' → ')})`);

/* ── 7. 적어 넣는 말을 나누고 깎기 ─────────────────────────────
   앱관리자가 `굿모닝, 좋은 아침!, ㅋ, 굿모닝`처럼 적으면 — 쉼표로 나누고
   깎고, 한 글자·겹치는 것은 뺀다. **앱(Swift)의 같은 셈과 결과가 같아야
   한다**(`NativeChatViewController.splitWords`). */
console.log('\n── 적어 넣는 말 ──');
const split = splitWords('굿모닝, 좋은 아침!, ㅋ, 굿모닝\n응?，Hello');
ok(JSON.stringify(split) === JSON.stringify(['굿모닝', '좋은아침', '응?', 'hello']),
   `나누고 깎는다 (${split.join(' · ')})`);
ok(splitWords('').length === 0 && splitWords(' , ,').length === 0, '빈 것은 빈손이다');
ok(norm('화이팅!!') === '화이팅' && norm('응？') === '응?', '깎는 자 — 문장부호는 지우고 `?`는 남긴다');

console.log(`\n${fail ? '❌' : '✅'} ${pass}개 통과 · ${fail}개 실패`);
process.exitCode = fail ? 1 : 0;
