/**
 * `@언급` 다루기.
 *
 * **언급을 따로 저장하지 않는다.** 글 안에 `@이름`으로 적히고, 화면에
 * 그릴 때 회원 명단과 맞춰 본다 — 칸을 하나 더 두면 이름을 바꿨을 때
 * 둘이 어긋나고, 우리 규모(30~40명)에서는 맞춰 보는 값이 싸다.
 */

/**
 * 입력칸 캐럿 **바로 앞**의 `@무엇`을 찾는다. 언급 목록을 띄울지 정하는 값이다.
 *
 * `@`는 **줄 처음이거나 공백 뒤**에 있어야 한다 — 그러지 않으면 메일 주소를
 * 칠 때마다 목록이 뜬다. 이름에는 공백이 없으므로 뒤에 공백이 나오면
 * 이미 다 친 것으로 보고 접는다.
 */
export function mentionQuery(value: string, caret: number): { at: number; q: string } | null {
    const head = value.slice(0, caret);
    const at = head.lastIndexOf('@');
    if (at < 0) return null;
    if (at > 0 && !/\s/.test(head[at - 1])) return null;
    const q = head.slice(at + 1);
    // 이름이 길어야 얼마나 길겠나. 여기서 끊어 두면 글 한 편을 쳐도 안 걸린다.
    if (q.length > 12 || /\s/.test(q)) return null;
    return { at, q };
}

/**
 * 모두를 한 번에 부르는 이름.
 *
 * **운영진(운영자·부운영자)만 쓴다.** 이걸로 부르면 대화 알림을 꺼 둔
 * 기기에도 알림이 가므로, 아무나 쓰면 그 스위치가 있으나 마나가 된다.
 * 누가 썼는지는 **발송기가 다시 확인한다**(`supabase/functions/notify`) —
 * 화면에서 목록을 감추는 것만으로는 손으로 쳐 넣는 것을 못 막는다.
 */
export const ALL_MENTION = '전체';

/** 정규식에 이름을 그대로 끼워 넣기 전에 특수문자를 막아 둔다. */
function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 글 한 조각. `name`이 있으면 그 사람을 언급한 부분이다. */
export interface Piece { text: string; name?: string }

/**
 * 글을 `@이름`과 나머지로 나눈다.
 *
 * **긴 이름을 먼저 본다** — `김지`와 `김지명`이 함께 있을 때 뒤엣것이
 * 걸려야 한다. 명단에 없는 `@무엇`은 그냥 글자로 남는다.
 *
 * `allowAll`은 **쓴 사람이 운영진일 때만** 켠다. 회원이 손으로 `@전체`를
 * 쳐 넣어도 도드라지지 않는다 — 알림도 안 가는데 화면에서만 부른 것처럼
 * 보이면 불렀다고 여기게 된다.
 */
export function splitMentions(body: string, names: string[], allowAll = false): Piece[] {
    const list = [...new Set([...(allowAll ? [ALL_MENTION] : []), ...names])]
        .filter(Boolean).sort((a, b) => b.length - a.length);
    if (!list.length || !body.includes('@')) return [{ text: body }];

    const re = new RegExp(`@(${list.map(escapeRe).join('|')})`, 'g');
    const out: Piece[] = [];
    let last = 0;
    for (const m of body.matchAll(re)) {
        const i = m.index ?? 0;
        if (i > last) out.push({ text: body.slice(last, i) });
        out.push({ text: m[0], name: m[1] });
        last = i + m[0].length;
    }
    if (last < body.length) out.push({ text: body.slice(last) });
    return out;
}
