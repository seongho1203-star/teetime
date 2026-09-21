/**
 * 음력 ↔ 양력.
 *
 * **표를 안 들고 천문 계산으로 낸다.** 음력 달력은 `신월(합삭)이 드는 날이
 * 그 달 1일`이고 `중기(中氣)가 없는 달이 윤달`이라는 규칙 둘로 정해진다 —
 * 그 둘만 셈하면 어느 해든 나온다. 몇 년치 표를 박아 두면 **그 범위가 끝나는
 * 날 조용히 틀린 값을 내놓으므로**(아무도 안 알려 준다) 그 길로 가지 말 것.
 *
 * 셈은 Meeus `Astronomical Algorithms` 49장(합삭)과 25장(태양 황경)이다.
 * 합삭 시각은 몇 분 안쪽, 황경은 0.01° 안쪽이라 **날짜로 끊으면 어긋날 자리가
 * 사실상 없다**(아래 확인 참고).
 *
 * **한국 시각으로 끊는다.** 음력 날짜는 그 나라 시각으로 정해지는 것이라
 * (중국과 하루 어긋나는 해가 실제로 있다) 합삭 시각을 KST로 옮겨 그 날짜를
 * 초하루로 삼는다. 기기 시간대를 따르면 해외에 있는 사람만 하루 어긋난다 —
 * `lib/format.ts`가 모든 날짜를 한국 시각으로 다루는 것과 같은 규칙이다.
 *
 * **확인은 `node .dev/lunar-check.mjs`가 한다** — 설날·추석·부처님오신날처럼
 * 널리 알려진 날과 윤달이 든 해를 스물 몇 가지 맞춰 본다. 셈을 고칠 일이
 * 생기면 그걸 먼저 돌려 볼 것.
 */

const DEG = Math.PI / 180;
const sin = (d: number) => Math.sin(d * DEG);

/** 0 이상 360 미만으로 접는다. */
function wrap360(d: number): number {
    const x = d % 360;
    return x < 0 ? x + 360 : x;
}

/**
 * 역학시(TT)와 세계시(UT)의 차이(초). Espenak–Meeus의 2005~2050년 식이다.
 * 그 밖의 해에는 값이 조금 어긋나지만, 우리가 쓰는 것은 **날짜**뿐이라
 * 몇십 초는 아무 데도 안 걸린다.
 */
function deltaT(year: number): number {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
}

/** 율리우스일(JD)에서 그레고리력 연도를 어림한다. ΔT를 고를 때만 쓴다. */
const jdYear = (jd: number) => 2000 + (jd - 2451545) / 365.25;

/**
 * `k`번째 합삭의 율리우스일(UT). Meeus 49장 그대로다.
 * `k = 0`이 2000년 1월 6일의 합삭이고, 한 해에 12~13번 는다.
 */
function newMoonJd(k: number): number {
    const T = k / 1236.85;
    const T2 = T * T, T3 = T2 * T, T4 = T3 * T;

    let jde = 2451550.09766 + 29.530588861 * k
        + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4;

    const E = 1 - 0.002516 * T - 0.0000074 * T2;
    const M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3;
    const Mp = 201.5643 + 385.81693528 * k
        + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
    const F = 160.7108 + 390.67050284 * k
        - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
    const O = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;

    jde += -0.40720 * sin(Mp)
        + 0.17241 * E * sin(M)
        + 0.01608 * sin(2 * Mp)
        + 0.01039 * sin(2 * F)
        + 0.00739 * E * sin(Mp - M)
        - 0.00514 * E * sin(Mp + M)
        + 0.00208 * E * E * sin(2 * M)
        - 0.00111 * sin(Mp - 2 * F)
        - 0.00057 * sin(Mp + 2 * F)
        + 0.00056 * E * sin(2 * Mp + M)
        - 0.00042 * sin(3 * Mp)
        + 0.00042 * E * sin(M + 2 * F)
        + 0.00038 * E * sin(M - 2 * F)
        - 0.00024 * E * sin(2 * Mp - M)
        - 0.00017 * sin(O)
        - 0.00007 * sin(Mp + 2 * M)
        + 0.00004 * sin(2 * Mp - 2 * F)
        + 0.00004 * sin(3 * M)
        + 0.00003 * sin(Mp + M - 2 * F)
        + 0.00003 * sin(2 * Mp + 2 * F)
        - 0.00003 * sin(Mp + M + 2 * F)
        + 0.00003 * sin(Mp - M + 2 * F)
        - 0.00002 * sin(Mp - M - 2 * F)
        - 0.00002 * sin(3 * Mp + M)
        + 0.00002 * sin(4 * Mp);

    /* 행성이 끌어당기는 몫. 한 번에 0.0003일(26초)이 안 되지만 열넷을 더하면
       자정 언저리에서 날짜를 가를 수 있어 그대로 적어 둔다. */
    const A: [number, number][] = [
        [299.77 + 0.107408 * k - 0.009173 * T2, 0.000325],
        [251.88 + 0.016321 * k, 0.000165],
        [251.83 + 26.651886 * k, 0.000164],
        [349.42 + 36.412478 * k, 0.000126],
        [84.66 + 18.206239 * k, 0.000110],
        [141.74 + 53.303771 * k, 0.000062],
        [207.14 + 2.453732 * k, 0.000060],
        [154.84 + 7.306860 * k, 0.000056],
        [34.52 + 27.261239 * k, 0.000047],
        [207.19 + 0.121824 * k, 0.000042],
        [291.34 + 1.844379 * k, 0.000040],
        [161.72 + 24.198154 * k, 0.000037],
        [239.56 + 25.513099 * k, 0.000035],
        [331.55 + 3.592518 * k, 0.000023],
    ];
    for (const [ang, amp] of A) jde += amp * sin(ang);

    return jde - deltaT(jdYear(jde)) / 86400;
}

/** 태양의 겉보기 황경(도). Meeus 25장의 간이식 — 0.01° 안쪽이다. */
function sunLongitude(jd: number): number {
    const T = (jd - 2451545) / 36525;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
        + (0.019993 - 0.000101 * T) * sin(2 * M)
        + 0.000289 * sin(3 * M);
    const O = 125.04 - 1934.136 * T;
    return wrap360(L0 + C - 0.00569 - 0.00478 * sin(O));
}

/**
 * 그 시각이 **몇 번째 30° 칸**에 들어 있는가(0~11).
 * 중기(中氣)는 황경이 30의 배수가 되는 순간이라, 달의 처음과 끝에서 이 값이
 * 달라지면 **그 달에 중기가 들어 있다**는 뜻이다. 한 달은 29~30일이고 태양은
 * 그동안 29°쯤 가므로 한 달에 중기는 0개 아니면 1개다.
 */
const majorTerm = (jd: number) => Math.floor(sunLongitude(jd) / 30);

/* ── 날짜와 율리우스일 사이 ──────────────────────────────────── */

/** 한국 날짜(y·m·d) → 그 날 0시(KST)의 율리우스일. */
function kstJd(y: number, m: number, d: number): number {
    return Date.UTC(y, m - 1, d) / 86400000 + 2440587.5 - 9 / 24;
}

/** 율리우스일 → 그 시각이 든 한국 날짜. */
function jdKstDate(jd: number): { y: number; m: number; d: number } {
    const ms = Math.round((jd - 2440587.5 + 9 / 24) * 86400000);
    const t = new Date(ms);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 한국 날짜를 하루 단위 번호로. 날짜끼리 견주고 빼는 데만 쓴다. */
const dayNo = (y: number, m: number, d: number) =>
    Math.round(Date.UTC(y, m - 1, d) / 86400000);

/** 합삭이 든 **한국 날짜**의 번호 — 그 날이 그 달 초하루다. */
function newMoonDay(k: number): number {
    const { y, m, d } = jdKstDate(newMoonJd(k));
    return dayNo(y, m, d);
}

/** 그 날짜 0시(KST)의 율리우스일. 중기를 견줄 때 쓴다. */
const dayJd = (n: number) => n + 2440587.5 - 9 / 24;

/** 어느 해 12월의 동지(황경 270°) 율리우스일. */
function winterSolstice(year: number): number {
    // 동지는 12월 21~22일이다. 그 둘레를 반씩 좁혀 든다.
    let lo = kstJd(year, 12, 15), hi = kstJd(year, 12, 27);
    const f = (jd: number) => {
        const x = sunLongitude(jd) - 270;
        return x > 180 ? x - 360 : x < -180 ? x + 360 : x;
    };
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

/** 그 날짜가 든 달의 초하루(날짜 번호)를 내는 `k`를 찾는다. */
function kBefore(day: number): number {
    // k ≈ (날짜 − 2000-01-06) / 29.53
    let k = Math.floor((day - 10961) / 29.530588861);
    while (newMoonDay(k) > day) k--;
    while (newMoonDay(k + 1) <= day) k++;
    return k;
}

export type LunarDate = {
    /** 음력 달(1~12). */
    month: number;
    /** 음력 날(1~30). */
    day: number;
    /** 윤달인가. */
    leap: boolean;
};

/**
 * 양력(한국 날짜) → 음력.
 *
 * 달 번호는 **동지가 든 달이 11월**이라는 규칙으로 센다. 동지와 다음 동지
 * 사이에 달이 열셋이면 그 해에 윤달이 있고, **중기가 없는 첫 달**이 윤달이라
 * 앞 달의 번호를 그대로 쓴다.
 */
export function toLunar(y: number, m: number, d: number): LunarDate {
    const today = dayNo(y, m, d);
    const k = kBefore(today);
    const start = newMoonDay(k);

    /* 이 달이 어느 동지 묶음에 드는가. 동지가 든 달의 초하루 둘을 구해
       늦은 쪽이 이 달보다 앞서면 그쪽이 11월이다. */
    const solsticeMonth = (yy: number) => {
        const ws = winterSolstice(yy);
        const { y: wy, m: wm, d: wd } = jdKstDate(ws);
        return newMoonDay(kBefore(dayNo(wy, wm, wd)));
    };
    const thisYear = solsticeMonth(y);
    const from = start >= thisYear ? thisYear : solsticeMonth(y - 1);
    const to = start >= thisYear ? solsticeMonth(y + 1) : thisYear;

    // 두 동지 달 사이의 초하루들. 뒤 동지 달은 뺀다(그게 다음 묶음의 11월이다).
    const k0 = kBefore(from);
    const starts: number[] = [];
    for (let i = 0; ; i++) {
        const s = newMoonDay(k0 + i);
        if (s >= to) break;
        starts.push(s);
    }

    /* 달이 열셋이면 **중기가 없는 첫 달**이 윤달이다. 11월(0번)에는 동지가
       들어 있으므로 1번부터 본다. */
    let leapAt = -1;
    if (starts.length === 13) {
        for (let i = 1; i < starts.length; i++) {
            const end = i + 1 < starts.length ? starts[i + 1] : to;
            if (majorTerm(dayJd(starts[i])) === majorTerm(dayJd(end))) { leapAt = i; break; }
        }
    }

    let num = 11, leap = false;
    for (let i = 0; i < starts.length; i++) {
        if (i > 0) {
            if (i === leapAt) leap = true;
            else { num = num === 12 ? 1 : num + 1; leap = false; }
        }
        if (starts[i] === start) {
            return { month: num, day: today - start + 1, leap };
        }
    }
    // 여기 닿을 일은 없다(이 달은 반드시 묶음 안에 있다). 안전값만 돌려준다.
    return { month: 1, day: today - start + 1, leap: false };
}

/**
 * 음력 달·날이 **그 해 양력 며칠인가**. 못 찾으면 `null`이다
 * (음력 30일이 없는 달처럼 그 해에 아예 없는 날짜가 있다).
 *
 * **윤달은 안 본다** — 평달로 찾는다. 윤달에 난 사람도 평달에 생일을 쇠는
 * 것이 우리 관습이고, 윤달은 몇 해에 한 번만 오므로 그 해에만 축하받게
 * 두면 되레 이상하다.
 */
export function lunarToSolar(year: number, month: number, day: number)
    : { y: number; m: number; d: number } | null {
    // 그 해 양력 1월 1일 앞뒤로 달을 훑는다. 음력 설이 2월 하순까지 밀리므로
    // 넉넉히 앞에서 시작한다.
    let k = kBefore(dayNo(year - 1, 11, 1));
    for (let i = 0; i < 16; i++, k++) {
        const s = newMoonDay(k);
        const date = jdKstDate(dayJd(s));
        const lu = toLunar(date.y, date.m, date.d);
        if (lu.leap || lu.month !== month) continue;
        const hit = s + day - 1;
        if (hit >= newMoonDay(k + 1)) return null;   // 그 달에 없는 날이다
        const got = jdKstDate(dayJd(hit));
        if (got.y !== year) continue;
        return got;
    }
    return null;
}
