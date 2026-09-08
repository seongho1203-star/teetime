/**
 * 길게 누른 창의 오른쪽에 서는 그림들.
 *
 * **카톡처럼 글자는 왼쪽, 그림은 오른쪽이다.** 줄이 여덟까지 늘 수 있어
 * 글자만 있으면 어느 줄인지 눈으로 세게 되는데, 그림이 있으면 모양으로
 * 바로 짚힌다.
 *
 * **그림글자(이모지)를 쓰지 않는다.** 기기에 없는 그림글자는 네모난
 * 두부로 나온다(투표 결과 카드의 `🗳`에서 겪었다). 선으로 그린 SVG는
 * 어디서나 같게 나오고, 색도 글자색을 따라간다(`currentColor`).
 *
 * 크기는 20px 한 가지다 — `.chat-menu-icon`이 정한다.
 */

/** 창에 세울 수 있는 그림들. `.chat-menu-item`의 오른쪽 자리다. */
export type HoldIconName =
    | 'copy' | 'pick' | 'reply' | 'share' | 'capture'
    | 'hide' | 'notice' | 'trash';

const PATHS: Record<HoldIconName, React.ReactNode> = {
    // 복사 — 겹친 종이 두 장.
    copy: <>
        <rect x="9" y="9" width="11" height="11" rx="2.5" />
        <path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
    </>,
    // 선택 복사 — 글자를 고르는 자리라 `|T|`다(카톡과 같다).
    pick: <>
        <path d="M8 5h8M12 5v14M9.5 19h5" />
        <path d="M4.5 4.5v15M19.5 4.5v15" />
    </>,
    // 댓글 — 오른쪽 아래로 꺾이는 화살표(카톡의 그 그림이다).
    reply: <>
        <path d="M5 6v6a3 3 0 0 0 3 3h11" />
        <path d="M15.5 11.5 19 15l-3.5 3.5" />
    </>,
    // 공유 — 상자에서 위로 나가는 화살표(아이폰의 그 그림).
    share: <>
        <path d="M12 4v11" />
        <path d="M8.5 7.5 12 4l3.5 3.5" />
        <path d="M6.5 11H5.5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 18.5 11h-1" />
    </>,
    // 캡쳐 — 사진을 오릴 때의 그 표.
    capture: <>
        <path d="M7 3v14h14" />
        <path d="M3 7h14v14" />
    </>,
    // 가리기 — 그어진 눈.
    hide: <>
        <path d="M4 12s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6Z" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M4.5 19.5 19.5 4.5" />
    </>,
    // 공지 — 확성기.
    notice: <>
        <path d="M4 10v4a1 1 0 0 0 1 1h3l6 4V5L8 9H5a1 1 0 0 0-1 1Z" />
        <path d="M17.5 9.5a3.5 3.5 0 0 1 0 5" />
    </>,
    // 삭제 — 휴지통.
    trash: <>
        <path d="M4.5 6.5h15" />
        <path d="M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" />
        <path d="M6.5 6.5 7.4 19a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.9-12.5" />
        <path d="M10.5 10v6M13.5 10v6" />
    </>,
};

export function HoldIcon({ name }: { name: HoldIconName }) {
    return (
        <svg className="chat-menu-icon" viewBox="0 0 24 24" aria-hidden="true"
             fill="none" stroke="currentColor" strokeWidth="1.7"
             strokeLinecap="round" strokeLinejoin="round">
            {PATHS[name]}
        </svg>
    );
}
