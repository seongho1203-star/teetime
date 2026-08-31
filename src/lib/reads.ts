/**
 * 읽음 표시 — 말풍선 옆의 **아직 안 읽은 사람 수**.
 *
 * 카톡과 같은 숫자다. 다 읽으면 사라진다.
 *
 * ── 왜 이렇게 담는가 ─────────────────────────────────────────
 *
 * **글마다 '누가 읽었나'를 적지 않는다.** 100명이 하루 100마디를 주고받으면
 * 그 기록만 하루 만 줄이다. 대신 **사람마다 어디까지 읽었는지** 시각 하나만
 * 남긴다(`room_reads`) — 100명이면 100줄이고 해가 지나도 안 늘어난다.
 * '이 글을 읽었나'는 `읽은 시각 >= 글 시각`으로 여기서 셈한다.
 *
 * **기기에 남기는 `lib/unread.ts`와는 다른 것이다.** 그쪽은 *내가* 어디까지
 * 봤나(탭바의 빨간 숫자)이고 남에게 안 보인다. 이쪽은 *남들이* 어디까지
 * 봤나라서 서버에 있어야 한다.
 */

/** `user_id` → 그 사람이 어디까지 읽었나. 없으면 한 번도 안 읽은 것이다. */
export type Reads = Record<string, string>;

/** 한 번도 안 읽은 사람. 어떤 글보다도 앞이라 늘 '안 읽음'이 된다. */
const NEVER = -Infinity;

function ms(iso?: string): number {
    if (!iso) return NEVER;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? NEVER : t;
}

/**
 * 오름차순으로 줄 세운 `times`에서 `t`보다 **작은** 것이 몇 개인가.
 *
 * 곧 '아직 그 글에 못 미친 사람 수'다. 글 하나당 이분탐색 한 번이라
 * 300마디 × 100명이어도 눈 깜짝할 새다.
 */
function countBefore(times: number[], t: number): number {
    let lo = 0, hi = times.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] < t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * 글마다 **아직 안 읽은 사람 수**를 센다. `{글 id: 수}`로 돌려준다.
 *
 * @param messages 화면에 그릴 글들
 * @param reads    사람마다 어디까지 읽었나
 * @param memberIds 셈에 넣을 사람들. **대기·추방은 빼고 넘길 것** —
 *                  대화를 볼 수 없는 사람이라 세면 숫자가 영영 안 준다.
 *
 * 안내 줄(`system`)은 세지 않는다 — 사람이 쓴 말이 아니다.
 * **보낸 사람은 늘 뺀다.** 제 글은 읽은 것이고, 다른 기기에서 보내
 * 읽은 시각이 아직 안 밀렸을 수도 있어서다.
 */
export function unreadCounts(
    messages: { id: string; created_at: string; user_id: string | null; system?: boolean }[],
    reads: Reads,
    memberIds: string[],
): Record<string, number> {
    const times = memberIds.map(id => ms(reads[id])).sort((a, b) => a - b);
    const member = new Set(memberIds);
    const out: Record<string, number> = {};

    for (const m of messages) {
        if (m.system) continue;
        const t = ms(m.created_at);
        let n = countBefore(times, t);
        if (m.user_id && member.has(m.user_id) && ms(reads[m.user_id]) < t) n -= 1;
        out[m.id] = Math.max(0, n);
    }
    return out;
}
