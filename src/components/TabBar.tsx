import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap } from '../lib/db';
import { daysUntil } from '../lib/format';
import type { Poll, Round } from '../lib/types';
import './TabBar.css';

/* 아이콘은 파일을 더 받지 않으려고 인라인 SVG로 둔다. 24×24 stroke. */
const icons = {
    home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
    round: 'M12 3v13M12 3l7 3-7 3M6.5 21h11',
    poll: 'M5 20V10M12 20V4M19 20v-7',
    board: 'M4 5.5h16M4 12h16M4 18.5h10',
    chat: 'M20.5 12c0 4-3.8 7.2-8.5 7.2-1 0-2-.15-2.9-.42L4 20.5l1.4-3.6C4.2 15.6 3.5 13.9 3.5 12c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2Z',
};

/**
 * 지금 몇 건이 열려 있는지 센다.
 *
 * 홈에서 라운드·투표를 걷어내면서 이 숫자가 그 자리를 대신한다 —
 * 무엇이 열려 있는지는 탭 위의 숫자로 알고, 내용은 눌러서 본다.
 *
 * **숫자는 각 탭의 목록과 뜻이 같아야 한다.** 눌러서 들어갔는데 그만큼이
 * 없으면 숫자를 믿을 수 없게 된다. 그래서 `Rounds`·`Polls`가 목록을
 * 가르는 기준을 그대로 쓴다:
 *   라운드 — 아직 지나지 않았고 취소되지 않은 것 (= '예정' 칸에 있는 것)
 *   투표   — 닫히지 않았고 마감 시각도 지나지 않은 것 (= '진행중' 칸)
 * 지난 것을 서버에서 거르려면 시각 비교가 필요한데 기기 시간대에 따라
 * 하루가 어긋나므로, 받아 와서 한국 날짜로 센다.
 *
 * **실시간만 믿지 않는다.** 이 막대는 화면이 바뀌어도 살아 있어서, 알림을
 * 한 번 놓치면 틀린 숫자가 계속 남는다(실제로 라운드를 지웠는데 1이 남았다).
 * 그래서 화면을 옮길 때와 앱으로 돌아왔을 때 다시 센다 — 작은 조회 둘이다.
 */
function useLiveCounts() {
    const { pathname } = useLocation();

    const { data, reload } = useAsync(async () => {
        const [rounds, polls] = await Promise.all([
            supabase.from('rounds').select('tee_at, status').neq('status', 'cancelled'),
            supabase.from('polls').select('closes_at').eq('closed', false),
        ]);
        const now = Date.now();
        const r = (unwrap(rounds) ?? []) as Pick<Round, 'tee_at' | 'status'>[];
        const p = (unwrap(polls) ?? []) as Pick<Poll, 'closes_at'>[];
        return {
            rounds: r.filter(x => daysUntil(x.tee_at) >= 0).length,
            polls: p.filter(x => !x.closes_at || new Date(x.closes_at).getTime() > now).length,
        };
    }, [pathname]);

    useRealtime(['rounds', 'polls'], reload);

    // 홈 화면에 띄워 두고 한참 뒤에 돌아오면 그 사이 것을 놓친다.
    useEffect(() => {
        const onShow = () => { if (!document.hidden) reload(); };
        document.addEventListener('visibilitychange', onShow);
        return () => document.removeEventListener('visibilitychange', onShow);
    }, [reload]);

    return data;
}

export function TabBar() {
    const counts = useLiveCounts();

    const tabs = [
        { to: '/',       label: '홈',     icon: icons.home,  end: true },
        { to: '/rounds', label: '라운드', icon: icons.round, count: counts?.rounds },
        { to: '/polls',  label: '투표',   icon: icons.poll,  count: counts?.polls },
        { to: '/board',  label: '공지',   icon: icons.board },
        { to: '/chat',   label: '대화',   icon: icons.chat },
    ];

    return (
        <nav className="tabbar">
            {tabs.map(t => (
                <NavLink
                    key={t.to}
                    to={t.to}
                    end={t.end}
                    className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
                >
                    <span className="tab-icon">
                        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9"
                             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d={t.icon} />
                        </svg>
                        {!!t.count && (
                            <span className="tab-count" aria-label={`${t.count}건 진행중`}>
                                {t.count > 99 ? '99+' : t.count}
                            </span>
                        )}
                    </span>
                    <span>{t.label}</span>
                </NavLink>
            ))}
        </nav>
    );
}
