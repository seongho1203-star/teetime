/* 조를 나누는 규칙을 숫자로 붙들어 둔다 (브라우저가 필요 없다).
 *
 *   node --experimental-strip-types .dev/groups-check.mts
 *
 * **눈으로는 확인이 안 되는 것들이다** — 남녀가 정말 고르게 갈렸는지,
 * 조 평균 나이가 붙어 있는지, 정보가 빈 사람이 안 빠졌는지.
 */
import { splitGroups, groupSizes, type GroupMode } from '../src/lib/groups.ts';
import type { GroupPerson } from '../src/lib/types.ts';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
    if (cond) pass++; else fail++;
    console.log(`  ${cond ? '✅' : '❌'} ${msg}`);
};

const P = (id: string, gender: 'm' | 'f' | null, birth: number | null): GroupPerson =>
    ({ id, name: id, avatar_url: null, gender, birth_year: birth });

/** `{id: 조}`를 조별 사람 목록으로 뒤집는다. */
function byGroup(map: Record<string, number>, people: GroupPerson[]) {
    const out = new Map<number, GroupPerson[]>();
    for (const p of people) {
        const g = map[p.id];
        if (g == null) continue;
        if (!out.has(g)) out.set(g, []);
        out.get(g)!.push(p);
    }
    return [...out.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
}

const modes: GroupMode[] = ['seq', 'random', 'gender', 'age'];

/* ── 1. 조 인원은 고르게 ────────────────────────────────────────
   아홉 명을 `4명씩`이면 `4·4·1`이 아니라 `3·3·3`이다 — 골프에서 한 명이
   혼자 도는 조는 없다. `size`는 한 조의 **최대** 인원이라는 뜻이다. */
console.log('\n── 조 인원 나누기 ──');
ok(groupSizes(8, 4).join(',') === '4,4', `여덟 명·4명씩 → ${groupSizes(8, 4)}`);
ok(groupSizes(9, 4).join(',') === '3,3,3', `아홉 명·4명씩 → ${groupSizes(9, 4)} (4,4,1이 아니다)`);
ok(groupSizes(10, 4).join(',') === '4,3,3', `열 명·4명씩 → ${groupSizes(10, 4)}`);
ok(groupSizes(7, 3).join(',') === '3,2,2', `일곱 명·3명씩 → ${groupSizes(7, 3)}`);
ok(groupSizes(3, 4).join(',') === '3', `세 명·4명씩 → ${groupSizes(3, 4)} (한 조)`);
ok(groupSizes(0, 4).length === 0, '아무도 없으면 조도 없다');

/* ── 2. 넷 다 아무도 안 빠뜨린다 ────────────────────────────────
   **이게 제일 중요하다.** 한 사람이라도 빠지면 그 사람만 `미배정`에 남아
   손으로 넣어야 하는데, 화면만 봐서는 알아채기 어렵다. */
console.log('\n── 아무도 안 빠진다 ──');
const mixed = [
    P('a', 'm', 1970), P('b', 'f', 1985), P('c', 'm', 1990), P('d', null, null),
    P('e', 'f', 1965), P('f', 'm', null), P('g', null, 2000), P('h', 'm', 1978),
    P('i', 'f', 1995), P('j', 'm', 1955), P('k', null, null),
];
for (const mode of modes) {
    const map = splitGroups(mixed, 4, mode);
    const sizes = byGroup(map, mixed).map(g => g.length);
    ok(Object.keys(map).length === mixed.length && sizes.join(',') === '4,4,3',
       `${mode}: 열한 명이 다 들어가고 조 인원도 고르다 (${sizes})`);
}

/* ── 3. 성별 조합 ───────────────────────────────────────────────
   사용자가 말한 그대로다 — `남남여여` 또는 `남남남여`.
   **적은 쪽을 먼저 흩어야** 된다. 남자를 먼저 담으면 한 조가 남자로 다 찬다. */
console.log('\n── 성별 조합 ──');
const g2f6m = [
    P('f1', 'f', null), P('f2', 'f', null),
    P('m1', 'm', null), P('m2', 'm', null), P('m3', 'm', null),
    P('m4', 'm', null), P('m5', 'm', null), P('m6', 'm', null),
];
const gs1 = byGroup(splitGroups(g2f6m, 4, 'gender'), g2f6m)
    .map(g => g.filter(p => p.gender === 'f').length);
ok(gs1.join(',') === '1,1', `여자 둘·남자 여섯 → 조마다 여자 ${gs1} (남남남여)`);

const g4f4m = [
    P('f1', 'f', null), P('f2', 'f', null), P('f3', 'f', null), P('f4', 'f', null),
    P('m1', 'm', null), P('m2', 'm', null), P('m3', 'm', null), P('m4', 'm', null),
];
const gs2 = byGroup(splitGroups(g4f4m, 4, 'gender'), g4f4m)
    .map(g => g.filter(p => p.gender === 'f').length);
ok(gs2.join(',') === '2,2', `여자 넷·남자 넷 → 조마다 여자 ${gs2} (남남여여)`);

// 성별을 모르는 사람이 섞여도 아는 쪽부터 맞춘다.
const gMix = [
    P('f1', 'f', null), P('f2', 'f', null), P('u1', null, null), P('u2', null, null),
    P('m1', 'm', null), P('m2', 'm', null), P('m3', 'm', null), P('m4', 'm', null),
];
const gs3 = byGroup(splitGroups(gMix, 4, 'gender'), gMix)
    .map(g => g.filter(p => p.gender === 'f').length);
ok(gs3.join(',') === '1,1', `성별 모르는 사람이 섞여도 여자는 고르게 ${gs3}`);

// 전부 남자면 그냥 나뉘기만 하면 된다(오류가 안 나야 한다).
const allM = Array.from({ length: 7 }, (_, i) => P(`m${i}`, 'm', null));
ok(Object.keys(splitGroups(allM, 4, 'gender')).length === 7, '전부 남자여도 다 들어간다');

/* ── 4. 나이 조합 ───────────────────────────────────────────────
   **신구 조화** — 조마다 나이가 골고루 섞여야 한다. 조 평균 나이가
   서로 붙어 있는지로 본다. 라운드로빈이면 1조가 늘 더 나이 많아진다. */
console.log('\n── 나이 조합 ──');
const ages = [1955, 1960, 1965, 1970, 1975, 1980, 1985, 1990];
const byAge = ages.map((y, i) => P(`p${i}`, null, y));
const avgs = byGroup(splitGroups(byAge, 4, 'age'), byAge)
    .map(g => g.reduce((s, p) => s + (p.birth_year ?? 0), 0) / g.length);
const spread = Math.max(...avgs) - Math.min(...avgs);
ok(spread === 0, `여덟 명·두 조 → 조 평균 태어난 해가 같다 (${avgs.join(' · ')})`);

// 한 조 안에 나이 많은 사람과 적은 사람이 함께 있어야 한다.
const wide = byGroup(splitGroups(byAge, 4, 'age'), byAge)
    .map(g => Math.max(...g.map(p => p.birth_year!)) - Math.min(...g.map(p => p.birth_year!)));
ok(wide.every(w => w >= 20), `조마다 나이 폭이 넓다 — 신구가 섞였다 (${wide.join(' · ')}년)`);

// 태어난 해를 모르는 사람은 맨 뒤로 가되 빠지지는 않는다.
const someKnown = [
    P('k1', null, 1960), P('k2', null, 1970), P('u1', null, null),
    P('k3', null, 1980), P('u2', null, null), P('k4', null, 1990),
];
ok(Object.keys(splitGroups(someKnown, 3, 'age')).length === 6,
   '태어난 해를 몰라도 조에는 들어간다');

/* ── 5. 랜덤은 정말 달라지는가 ─────────────────────────────────
   같은 결과만 나오면 `랜덤`이라고 적어 놓고 신청 순서인 셈이다. */
console.log('\n── 랜덤 ──');
const seen = new Set<string>();
for (let i = 0; i < 30; i++) {
    seen.add(JSON.stringify(splitGroups(mixed, 4, 'random')));
}
ok(seen.size > 1, `서른 번 돌리면 여러 모양이 나온다 (${seen.size}가지)`);
const one = splitGroups(mixed, 4, 'seq');
ok(JSON.stringify(one) === JSON.stringify(splitGroups(mixed, 4, 'seq')),
   '`신청 순서`는 몇 번을 눌러도 같다');

console.log(`\n${fail ? '❌' : '✅'} ${pass}개 통과 · ${fail}개 실패`);
process.exitCode = fail ? 1 : 0;
