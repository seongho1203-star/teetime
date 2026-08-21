import { NavLink } from 'react-router-dom';
import './TabBar.css';

/* 아이콘은 파일을 더 받지 않으려고 인라인 SVG로 둔다. 24×24 stroke. */
const icons = {
    home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
    round: 'M12 3v13M12 3l7 3-7 3M6.5 21h11',
    poll: 'M5 20V10M12 20V4M19 20v-7',
    board: 'M4 5.5h16M4 12h16M4 18.5h10',
    chat: 'M20.5 12c0 4-3.8 7.2-8.5 7.2-1 0-2-.15-2.9-.42L4 20.5l1.4-3.6C4.2 15.6 3.5 13.9 3.5 12c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2Z',
};

const tabs = [
    { to: '/',      label: '홈',    icon: icons.home,  end: true },
    { to: '/rounds', label: '라운드', icon: icons.round },
    { to: '/polls',  label: '투표',   icon: icons.poll },
    { to: '/board',  label: '공지',   icon: icons.board },
    { to: '/chat',   label: '대화',   icon: icons.chat },
];

export function TabBar() {
    return (
        <nav className="tabbar">
            {tabs.map(t => (
                <NavLink
                    key={t.to}
                    to={t.to}
                    end={t.end}
                    className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9"
                         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d={t.icon} />
                    </svg>
                    <span>{t.label}</span>
                </NavLink>
            ))}
        </nav>
    );
}
