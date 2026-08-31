/**
 * "여기까지 봤다"를 **이 기기에** 남긴다.
 *
 * 탭바의 빨간 숫자와 대화의 `여기까지 읽으셨습니다` 줄이 이걸 본다.
 * **기기마다 따로 기억한다** — 폰과 PC를 오가면 각각 센다. 내 눈에만
 * 보이는 값이라 그편이 오히려 맞고, 쓰기가 서버로 안 나간다.
 *
 * **말풍선 옆의 `안 읽은 사람 수`와 헷갈리지 말 것**(`lib/reads.ts`).
 * 그쪽은 *남들이* 어디까지 읽었나라서 **서버에 있어야** 하고, 여기 것은
 * *내가* 어디까지 봤나라 기기에 있으면 된다. 둘은 따로 움직인다.
 *
 * 사람이 바뀌면 다른 열쇠를 쓴다. 한 기기를 둘이 쓸 때 남의 안 읽음이
 * 넘어오지 않게 하려는 것이다.
 */

const key = (name: string, me: string) => `teetime:seen:${name}:${me}`;

/** 아주 옛날. 한 번도 안 봤으면 전부 안 읽음이 된다. */
export const NEVER = new Date(0).toISOString();

export function lastSeen(name: string, me: string): string {
    try {
        return localStorage.getItem(key(name, me)) ?? NEVER;
    } catch {
        // 사파리 비공개 모드 등에서 막힐 수 있다. 그때는 안 읽음이 안 쌓인다.
        return NEVER;
    }
}

/**
 * 지금까지 본 것으로 표시한다.
 *
 * 표시를 지우는 쪽(대화·공지 화면)과 세는 쪽(탭바)이 서로 남남이라,
 * 창 안에서 도는 이벤트로 알린다 — `storage` 이벤트는 **다른 탭에서만**
 * 오기 때문에 같은 화면에서는 안 온다.
 */
export function markSeen(name: string, me: string, at: string = new Date().toISOString()) {
    try {
        localStorage.setItem(key(name, me), at);
    } catch { /* 저장이 막혀도 화면은 그대로 돌아야 한다 */ }
    window.dispatchEvent(new Event(SEEN_EVENT));
}

export const SEEN_EVENT = 'teetime:seen';
