import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import './TopBar.css';

/** 상세·작성 화면의 머리말. 뒤로 가기 + 제목 + 오른쪽 버튼 자리. */
export function TopBar({
    title, right, fallback = '/', onBack,
}: {
    title: string;
    right?: ReactNode;
    /** 바로 들어온 링크라 돌아갈 곳이 없을 때 갈 곳. */
    fallback?: string;
    /**
     * 뒤로 갈 때 할 일을 직접 정한다.
     *
     * **승인 대기 화면처럼 라우터 바깥에서 띄우는 곳**을 위한 것이다.
     * 거기서는 어디로 옮겨 봐야 같은 화면이 다시 나와서, 주소를 바꾸는
     * 대신 띄운 쪽이 닫아야 한다.
     */
    onBack?: () => void;
}) {
    const nav = useNavigate();

    const back = () => {
        if (onBack) { onBack(); return; }
        if (window.history.length > 1) nav(-1);
        else nav(fallback, { replace: true });
    };

    return (
        <div className="topbar">
            <button className="topbar-back" onClick={back} aria-label="뒤로">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 5l-7 7 7 7" />
                </svg>
            </button>
            <div className="topbar-title truncate">{title}</div>
            <div className="topbar-right">{right}</div>
        </div>
    );
}
