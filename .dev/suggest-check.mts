/* 치는 글에 이모티콘을 골라 주는 규칙을 붙들어 둔다 (브라우저가 필요 없다).
 *
 *   node --experimental-strip-types .dev/suggest-check.mts
 *
 * **여기서 잡는 것이 하나 있다** — 표(`SUGGEST_TOPICS`)의 이모티콘 이름을
 * 잘못 적으면 **조용히 아무것도 안 걸린다.** 화면에는 줄이 안 뜰 뿐이라
 * 눈으로는 '원래 그런가 보다'로 지나간다. 표를 고쳤으면 먼저 돌려 볼 것.
 */
import { SUGGEST_TOPICS, SUGGEST_MAX, SUGGEST_MIN, SUGGEST_ANIM, suggestFor, suggestTable, labelKey }
    from '../src/lib/suggest.ts';
import { STICKERS } from '../src/lib/stickers.ts';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
    if (cond) pass++; else fail++;
    console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
};

/** 친 글에 그 이름이 든 이모티콘이 하나라도 나오는가. */
const has = (draft: string, label: string) =>
    suggestFor(draft).some(s => labelKey(s.label) === labelKey(label));

/* ── 1. 표에 적은 이름이 실제로 있는가 ──────────────────────────
   이 검사가 이 파일의 핵심이다. 이모티콘을 지웠거나 이름을 바꿨는데
   표를 안 고치면 그 꼭지가 통째로 죽는다. */
console.log('\n── 표에 적은 이모티콘 이름 ──');
const keys = new Set(STICKERS.map(s => labelKey(s.label)));
for (const topic of SUGGEST_TOPICS) {
    const miss = topic.labels.filter(l => !keys.has(l));
    ok(miss.length === 0, `${topic.words[0]} … ${miss.length ? `없는 이름: ${miss.join(', ')}` : '다 있다'}`);
}

/* ── 2. 한 글자 말을 넣지 않았는가 ─────────────────────────────
   `굿` 하나를 넣으면 `굿모닝`까지 걸려 인사 자리에 엉뚱한 것이 섞인다.
   `밥`처럼 그 자체로 또렷한 것만 예외로 둔다. */
console.log('\n── 치는 말 ──');
const ONE_OK = new Set(['밥', '헉', '춤', '헐']);
for (const topic of SUGGEST_TOPICS) {
    const bad = topic.words.filter(w => w.length < SUGGEST_MIN && !ONE_OK.has(w));
    ok(bad.length === 0, `${topic.words[0]} … ${bad.length ? `한 글자: ${bad.join(', ')}` : '괜찮다'}`);
}

/* ── 3. 사용자가 말한 그 자리 ──────────────────────────────────
   `굿모닝하면 관련 이모티콘이뜨는거말이야` */
console.log('\n── 사용자가 말한 자리 ──');
ok(has('굿모닝', '안녕~'), '`굿모닝` → 인사 이모티콘');
ok(has('굿모닝입니다', '안녕~'), '`굿모닝입니다`처럼 뒤에 붙어도 걸린다');
ok(has('좋은 아침', '안녕~'), '`좋은 아침` — 공백은 지우고 본다');

/* ── 4. 자주 칠 말들 ───────────────────────────────────────── */
console.log('\n── 자주 칠 말 ──');
ok(has('감사합니다', '감사합니다'), '`감사합니다`');
ok(has('ㄱㅅ', '감사합니다'), '`ㄱㅅ`');
ok(has('오늘 나이스샷 많이 치세요', '나이스샷!'), '`나이스샷`');
ok(has('아 오비났네', '아..OB..'), '`오비` → OB');
ok(has('한잔해요 오늘', '한잔해요'), '`한잔`');
ok(has('내일 퇴근하고 봐요', '일하는 중'), '`퇴근`');
ok(has('ㅋㅋㅋ 웃겨', '빵터짐'), '`ㅋㅋ`');
ok(has('ㅠㅠ 아쉽다', '엉엉'), '`ㅠㅠ`');
ok(has('생일 축하해요', '축하해'), '`축하`');
ok(has('화이팅!!', '화이팅!'), '`화이팅`');

/* ── 5. 이름 그대로 친 것 ──────────────────────────────────── */
console.log('\n── 이름 그대로 ──');
ok(has('쿨쿨', '쿨쿨'), '`쿨쿨` — 표에 없어도 이름이 같으면 걸린다');
ok(has('꽃다발 보내요', '꽃다발'), '`꽃다발`');

/* ── 6. 아무 때나 뜨면 안 된다 ────────────────────────────────
   치는 내내 줄이 떠 있으면 말풍선 한 줄이 계속 가려진다. */
console.log('\n── 안 떠야 하는 자리 ──');
ok(suggestFor('').length === 0, '빈 글에는 안 뜬다');
ok(suggestFor('ㅋ').length === 0, `한 글자에는 안 뜬다 (${SUGGEST_MIN}글자부터)`);
ok(suggestFor('내일 몇 명이나 되나요').length === 0, '아무 말에나 안 뜬다');
ok(suggestFor('그래서 어떻게 할까').length === 0, '평범한 문장에는 안 뜬다');

/* ── 7. 줄이 길어지지 않는다 ─────────────────────────────────
   여덟을 넘기면 옆으로 한참을 굴려야 한다. */
console.log('\n── 몇 장까지 ──');
const many = suggestFor('하트');
ok(many.length <= SUGGEST_MAX, ``.concat(`\`하트\` → ${many.length}장 (${SUGGEST_MAX} 이하)`));
ok(new Set(many.map(s => s.id)).size === many.length, '같은 것이 두 번 안 나온다');

/* ── 8. 차례는 이모티콘 목록 그대로 ───────────────────────────
   묶음 차례가 곧 이 차례라 **움직이는 것이 맨 앞에 선다.**
   앱도 같은 차례를 쓰므로 웹과 앱이 같은 줄을 보여 준다. */
console.log('\n── 차례 ──');
const order = new Map(STICKERS.map((s, i) => [s.id, i]));
const hits = suggestFor('감사합니다');
ok(hits.every((s, i) => i === 0 || order.get(hits[i - 1].id)! < order.get(s.id)!),
   `목록 차례 그대로 (${hits.map(s => s.id).join(' → ')})`);
ok(hits[0]?.id.startsWith('mv') === true, '움직이는 것이 맨 앞에 선다');
/* **움직이는 것은 두 장까지다.** 차례가 묶음 차례라 그냥 두면 앞의 여덟이
   전부 움짤이 되는데, 한 장이 평균 105KB·열두 프레임이라 글자를 칠 때마다
   줄이 갈리는 자리에서 폰이 주저앉는다(`node .dev/type-bench.mjs`로 65ms를
   봤다). 멈춘 것은 7KB다. */
for (const draft of ['감사합니다', '하트', '안녕', '쿨쿨', '화이팅']) {
    const anim = suggestFor(draft).filter(s => s.id.startsWith('mv')).length;
    ok(anim <= SUGGEST_ANIM, `\`${draft}\` → 움직이는 것 ${anim}장 (${SUGGEST_ANIM} 이하)`);
}

/* ── 9. 앱에 실어 보내는 표 ──────────────────────────────────
   앱은 **글자가 들었는지만** 본다 — 규칙이 두 벌이 되지 않게 표를 통째로
   넘긴다. 빈 줄이 섞이면 앱에서 헛돌므로 여기서 막는다. */
console.log('\n── 앱에 넘기는 표 ──');
const table = suggestTable();
ok(table.length > 0, `${table.length}줄`);
ok(table.every(r => r.words.length > 0 && r.ids.length > 0), '빈 줄이 없다');
ok(table.every(r => r.words.every(w => w.length >= SUGGEST_MIN)), '한 글자짜리 말이 없다');
const ids = new Set(STICKERS.map(s => s.id));
ok(table.every(r => r.ids.every(id => ids.has(id))), '없는 이모티콘을 가리키지 않는다');

console.log(`\n${fail ? '❌' : '✅'} ${pass}개 통과 · ${fail}개 실패`);
process.exitCode = fail ? 1 : 0;
