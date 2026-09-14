import { useSyncExternalStore } from 'react';

/**
 * **지금 확인창이 떠 있는가** — 대화 화면이 네이티브 부품을 물릴지 가리는 값.
 *
 * ## 왜 있는가
 *
 * 확인창(`components/Confirm.tsx`)은 **웹이 그리는 창**인데, 앱에서 대화
 * 목록과 입력칸은 **웹뷰 위에 얹힌 앱 부품**이다 — **웹의 `z-index`로는
 * 앱 부품을 못 덮는다**(사진 크게 보기·전체화면 프로필에서 이미 겪은 그
 * 자리다). 그래서 `가리기` · `삭제`처럼 한 번 더 묻는 일은 **창이 앱
 * 목록 뒤에 통째로 깔려** 눌러도 아무 일이 안 일어나는 것처럼 보였다
 * (사용자 제보 — `가리기가 안되네`).
 *
 * ## 왜 확인창이 직접 안 감추는가
 *
 * **감췄다 도로 내보이는 일의 주인이 둘이 되면 안 된다.** 대화 화면은
 * 이미 `overlayUp`·`listCovered`로 그 값을 적고 있는데(사진·프로필·선택
 * 복사·서랍·검색), 확인창이 제멋대로 `hidden: false`를 보내면 **사진을
 * 크게 본 채로 뜬 확인창을 닫을 때 그 위로 입력칸이 도로 올라온다.**
 * 그래서 여기서는 **'떠 있다'는 사실만 알리고**, 무엇을 감출지는 대화
 * 화면이 제 값에 얹어 정한다(`--composer`의 주인을 하나로 둔 그 규칙과
 * 같은 결이다).
 *
 * ## 헤드리스로 확인할 수 있다
 *
 * 앱 부품이 없는 웹에서도 **이 값이 서는지**는 그대로 잡힌다 —
 * `.dev/behave.mjs`의 `확인창이 앱 부품에 안 가린다` 칸이 `html`의
 * `confirm-up` 표를 재서 붙들어 둔다.
 */

let up = false;
const subs = new Set<() => void>();

/** 확인창이 떴다/닫혔다를 알린다. 부르는 곳은 `ConfirmProvider` 하나다. */
export function setConfirmUp(next: boolean) {
    if (up === next) return;
    up = next;
    /* **`html`에도 적어 둔다.** 헤드리스에서 재는 값이자, CSS로 무엇을
       물릴 일이 생겼을 때의 손잡이다(지금은 CSS 규칙이 없다). */
    try {
        document.documentElement.classList.toggle('confirm-up', next);
    } catch { /* 문서가 없는 자리(시험 등) — 값만 들고 간다 */ }
    for (const fn of subs) fn();
}

const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
const snapshot = () => up;

/** 확인창이 떠 있는가. 대화 화면이 `overlayUp`에 얹어 쓴다. */
export const useConfirmUp = () => useSyncExternalStore(subscribe, snapshot, () => false);
