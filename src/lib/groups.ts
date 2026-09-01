/**
 * 조를 어떤 규칙으로 나눌까.
 *
 * **화면이 아니라 여기 있다.** 규칙이 넷이고 앞으로 더 늘 수 있는데,
 * 화면 안에 두면 눈으로만 확인하게 된다 — 여기 있으면 브라우저 없이
 * 숫자로 붙들어 둘 수 있다(`.dev/groups-check.mts`).
 *
 * 넷 다 **자리 수를 먼저 정하고 사람을 담는다.** 규칙이 다른 것은
 * '누구를 먼저 담느냐'뿐이라, 조 인원이 고르게 나뉘는 규칙은 한 곳에만 있다.
 */

import type { Gender, GroupPerson } from './types';

/** 조를 나누는 규칙. 화면의 단추 순서와 같다. */
export type GroupMode = 'seq' | 'random' | 'gender' | 'age';

export const MODE_LABEL: Record<GroupMode, string> = {
    seq:    '신청 순서',
    random: '랜덤',
    gender: '성별 조합',
    age:    '나이 조합',
};

export const MODE_HINT: Record<GroupMode, string> = {
    seq:    '신청한 순서대로 끊어서 나눕니다.',
    random: '섞어서 나눕니다. 누를 때마다 달라집니다.',
    gender: '남녀가 고르게 섞이도록 나눕니다 (남남여여 · 남남남여).',
    age:    '나이가 고르게 섞이도록 나눕니다 (신구 조화).',
};

/**
 * 조 개수와 조마다 몇 자리인지.
 *
 * **`size`는 한 조의 최대 인원이다.** 아홉 명을 `4명씩`으로 나누면
 * `4·4·1`이 아니라 `3·3·3`이다 — 골프에서 한 명이 혼자 도는 조는 없다.
 * 조 개수만 `올림`으로 정하고 사람은 고르게 흩는다.
 */
export function groupSizes(total: number, size: number): number[] {
    if (total <= 0 || size <= 0) return [];
    const count = Math.ceil(total / size);
    const base = Math.floor(total / count);
    const extra = total % count;                 // 앞에서부터 한 명씩 더
    return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** 자리가 남은 조 중 **가장 적게 찬 곳**. 없으면 -1. */
function roomiest(filled: number[], caps: number[]): number {
    let best = -1;
    for (let i = 0; i < caps.length; i++) {
        if (filled[i] >= caps[i]) continue;
        if (best === -1 || filled[i] < filled[best]) best = i;
    }
    return best;
}

/**
 * 정해진 순서대로 사람을 담는다.
 *
 * **앞에서부터 자리가 남은 조에 하나씩 돌려 담는다**(라운드로빈). 그래서
 * 어떤 묶음이든 여러 조에 고르게 흩어진다 — `성별 조합`이 여자를 먼저
 * 이 함수에 넣는 것이 그 방법이다.
 */
function deal(order: GroupPerson[], caps: number[]): Record<string, number> {
    const filled = caps.map(() => 0);
    const out: Record<string, number> = {};
    for (const p of order) {
        const g = roomiest(filled, caps);
        if (g === -1) break;                     // 자리보다 사람이 많을 수는 없다
        filled[g]++;
        out[p.id] = g + 1;                       // 조 번호는 1부터
    }
    return out;
}

/** 끊어 담기 — 앞에서부터 조를 하나씩 채운다(`신청 순서`가 쓴다). */
function chunk(order: GroupPerson[], caps: number[]): Record<string, number> {
    const out: Record<string, number> = {};
    let i = 0;
    caps.forEach((cap, g) => {
        for (let k = 0; k < cap && i < order.length; k++, i++) out[order[i].id] = g + 1;
    });
    return out;
}

/**
 * 뱀 모양으로 담기 — `1 2 3 / 3 2 1 / 1 2 3 …`.
 *
 * **줄 세운 것을 고르게 흩는 데는 라운드로빈보다 낫다.** 나이순으로
 * 세워 놓고 라운드로빈으로 돌리면 1조가 늘 조금씩 더 많고 마지막 조가
 * 조금씩 더 적다. 뱀 모양은 그 치우침이 서로 상쇄된다
 * (여덟 명·두 조로 재 보면 평균 나이가 52.5 대 52.5로 같아진다).
 */
function snake(order: GroupPerson[], caps: number[]): Record<string, number> {
    const filled = caps.map(() => 0);
    const out: Record<string, number> = {};
    const g = caps.length;
    let i = 0, row = 0;
    while (i < order.length) {
        const seq = Array.from({ length: g }, (_, k) => (row % 2 === 0 ? k : g - 1 - k));
        let placed = false;
        for (const j of seq) {
            if (i >= order.length) break;
            if (filled[j] >= caps[j]) continue;
            filled[j]++;
            out[order[i++].id] = j + 1;
            placed = true;
        }
        if (!placed) break;                      // 자리가 다 찼다
        row++;
    }
    return out;
}

/** 섞기 — 자리를 바꿔 가며(Fisher–Yates). 원본은 안 건드린다. */
function shuffled<T>(list: T[]): T[] {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** 성별을 모르는 사람은 `?`로 따로 센다. */
function genderOf(p: GroupPerson): Gender | '?' {
    return p.gender === 'm' || p.gender === 'f' ? p.gender : '?';
}

/**
 * 조를 나눈다. 돌려주는 것은 `{사람 id: 조 번호}`.
 *
 * `people`은 **신청한 순서**로 들어온다(`신청 순서`가 그걸 그대로 쓴다).
 *
 * **모르는 사람을 빼지 않는다.** 성별이나 태어난 해가 비어 있어도 조에는
 * 들어간다 — 이 기능을 만들기 전에 가입한 사람이 전부 그렇고, 빠지면
 * 그분들만 `미배정`에 남아 손으로 넣어야 한다.
 */
export function splitGroups(
    people: GroupPerson[], size: number, mode: GroupMode,
): Record<string, number> {
    const caps = groupSizes(people.length, size);
    if (!caps.length) return {};

    if (mode === 'seq')    return chunk(people, caps);
    if (mode === 'random') return chunk(shuffled(people), caps);

    if (mode === 'gender') {
        /* **적은 쪽을 먼저 담는다.** 여자 둘·남자 여섯을 두 조로 나눌 때
           여자를 먼저 흩어야 각 조에 하나씩 가고, 남자가 그 뒤를 채워
           `남남남여`가 된다. 남자를 먼저 담으면 한 조가 남자로 다 차 버린다.
           **모르는 사람은 맨 뒤**다 — 아는 쪽을 먼저 맞춰 놓고 나머지를 채운다. */
        const bag: Record<string, GroupPerson[]> = { m: [], f: [], '?': [] };
        for (const p of people) bag[genderOf(p)].push(p);
        const known = [bag.f, bag.m].sort((a, b) => a.length - b.length);
        return deal([...known[0], ...known[1], ...bag['?']], caps);
    }

    /* 나이 — 태어난 해로 줄을 세우고 뱀 모양으로 흩는다.
       **모르는 사람은 맨 뒤**로 보내고, 그들끼리는 신청 순서를 지킨다. */
    const order = [...people].sort((a, b) => {
        const x = a.birth_year ?? Infinity;
        const y = b.birth_year ?? Infinity;
        return x - y;                            // 태어난 해가 이르면 = 나이가 많다
    });
    return snake(order, caps);
}
