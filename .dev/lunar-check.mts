/**
 * 음력 셈이 맞는가 — 브라우저 없이 숫자로 붙들어 둔다.
 *
 *     node --experimental-strip-types .dev/lunar-check.mts
 *
 * **널리 알려진 날로 맞춰 본다.** 음력 계산은 눈으로 봐서는 맞는지 알 수가
 * 없어서, 달력에 빨갛게 적혀 있는 날(설날·추석·부처님오신날·정월대보름)과
 * **윤달이 든 해**를 잣대로 삼았다. 하나라도 어긋나면 셈이 틀린 것이다.
 *
 * `lib/groups.ts`를 `groups-check.mts`가 붙들어 두는 것과 같은 자리다.
 */
import { toLunar, lunarToSolar } from '../src/lib/lunar.ts';

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => {
    if (cond) { pass++; console.log(`  ✅ ${msg}`); }
    else { fail++; console.log(`  ❌ ${msg}`); }
};

const iso = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** 양력 하루 → `음력 M월 D일` 글자. */
function lu(s: string): string {
    const [y, m, d] = s.split('-').map(Number);
    const r = toLunar(y, m, d);
    return `${r.leap ? '윤' : ''}${r.month}월 ${r.day}일`;
}

console.log('\n── 설날은 음력 1월 1일이다 ──');
for (const [d] of [
    ['2023-01-22'], ['2024-02-10'], ['2025-01-29'], ['2026-02-17'],
    ['2027-02-07'], ['2028-01-27'], ['2029-02-13'], ['2030-02-03'],
] as [string][]) {
    ok(lu(d) === '1월 1일', `${d} → 1월 1일 (실제 ${lu(d)})`);
}

console.log('\n── 추석은 음력 8월 15일이다 ──');
for (const d of ['2023-09-29', '2024-09-17', '2025-10-06',
                 '2026-09-25', '2027-09-15', '2028-10-03']) {
    ok(lu(d) === '8월 15일', `${d} → 8월 15일 (실제 ${lu(d)})`);
}

console.log('\n── 부처님오신날은 음력 4월 8일이다 ──');
for (const d of ['2023-05-27', '2024-05-15', '2025-05-05',
                 '2026-05-24', '2027-05-13']) {
    ok(lu(d) === '4월 8일', `${d} → 4월 8일 (실제 ${lu(d)})`);
}

console.log('\n── 정월대보름은 음력 1월 15일이다 ──');
for (const d of ['2025-02-12', '2026-03-03', '2024-02-24']) {
    ok(lu(d) === '1월 15일', `${d} → 1월 15일 (실제 ${lu(d)})`);
}

console.log('\n── 윤달이 든 해 ──');
/* 중기가 없는 달이 윤달이다. 아래 셋은 달력에 그렇게 적혀 있는 해다 —
   윤달을 못 세면 그 뒤의 달 번호가 통째로 하나씩 밀린다. */
ok(lu('2023-03-25').startsWith('윤2월'), `2023-03-25 → 윤2월 (실제 ${lu('2023-03-25')})`);
ok(lu('2025-07-28').startsWith('윤6월'), `2025-07-28 → 윤6월 (실제 ${lu('2025-07-28')})`);
ok(lu('2028-06-25').startsWith('윤5월'), `2028-06-25 → 윤5월 (실제 ${lu('2028-06-25')})`);

console.log('\n── 윤달이 아닌 달은 윤달로 안 센다 ──');
for (const d of ['2024-03-25', '2026-07-28', '2030-06-25']) {
    ok(!lu(d).startsWith('윤'), `${d}는 평달이다 (실제 ${lu(d)})`);
}

console.log('\n── 되돌려도 같은 날이다 (음력 → 양력) ──');
for (const [y, m, d, want] of [
    [2025, 1, 1, '2025-01-29'], [2026, 1, 1, '2026-02-17'],
    [2025, 8, 15, '2025-10-06'], [2026, 8, 15, '2026-09-25'],
    [2025, 4, 8, '2025-05-05'],
] as [number, number, number, string][]) {
    const got = lunarToSolar(y, m, d);
    const s = got ? iso(got.y, got.m, got.d) : '없음';
    ok(s === want, `${y}년 음력 ${m}월 ${d}일 → ${want} (실제 ${s})`);
}

console.log('\n── 한 해를 통째로 훑어도 어긋나지 않는다 ──');
{
    /* 날마다 하루씩 늘어나고, 달이 바뀌면 1일로 돌아가는가.
       **이 검사가 윤달·큰달·작은달을 한꺼번에 잡는다** — 규칙이 한 군데만
       틀려도 날짜가 건너뛰거나 되돌아간다. */
    let bad = '';
    let prev = toLunar(2025, 1, 1);
    for (let i = 1; i < 730 && !bad; i++) {
        const t = new Date(Date.UTC(2025, 0, 1 + i));
        const cur = toLunar(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
        const sameMonth = cur.month === prev.month && cur.leap === prev.leap;
        if (sameMonth ? cur.day !== prev.day + 1 : cur.day !== 1) {
            bad = `${t.toISOString().slice(0, 10)} — ${prev.month}/${prev.day} 다음이 ${cur.month}/${cur.day}`;
        }
        if (!sameMonth && (prev.day < 29 || prev.day > 30)) {
            bad = `${t.toISOString().slice(0, 10)} — 한 달이 ${prev.day}일이다`;
        }
        prev = cur;
    }
    ok(!bad, `2025~2026년 730일이 하루씩 이어진다 ${bad && `(${bad})`}`);
}

console.log(`\n${pass + fail}개 중 ${pass}개 통과 · ${fail}개 실패\n`);
process.exit(fail ? 1 : 0);
