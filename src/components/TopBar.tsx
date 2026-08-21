import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import './TopBar.css';

/** 상세·작성 화면의 머리말. 뒤로 가기 + 제목 + 오른쪽 버튼 자리. */
export function TopBar({
    title, right, fallback = '/',
}: {
    title: string;
    right?: ReactNode;
    /** 바로 들어온 링크라 돌아갈 곳이 없을 때 갈 곳. */
    fallback?: string;
}) {
    const nav = useNavigate();

    const back = () => {
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
