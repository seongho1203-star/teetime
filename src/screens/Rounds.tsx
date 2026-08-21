import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, ddayLabel, daysUntil, formatWon } from '../lib/format';
import type { Round, Signup } from '../lib/types';
import './Rounds.css';

interface Loaded {
    rounds: Round[];
    signups: Signup[];
}

export function Rounds() {
    const { isAdmin, session } = useAuth();
    const me = session!.user.id;

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        const [rounds, signups] = await Promise.all([
            supabase.from('rounds').select('*').order('tee_at', { ascending: true }),
            supabase.from('signups').select('*'),
        ]);
        return { rounds: unwrap(rounds) ?? [], signups: unwrap(signups) ?? [] };
    }, []);

    // 남이 신청하면 자리 수가 바뀐다. 보고 있는 동안 따라 움직여야 한다.
    useRealtime(['rounds', 'signups'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (error) {
        return <div className="page"><div className="notice danger">{error}</div></div>;
    }

    const rounds = data?.rounds ?? [];
    const signups = data?.signups ?? [];

    // 오늘(한국 날짜) 이후는 '예정', 그 전은 '지난'. 지난 것은 최근 순으로.
    const upcoming = rounds.filter(r => daysUntil(r.tee_at) >= 0 && r.status !== 'cancelled');
    const past = rounds
        .filter(r => daysUntil(r.tee_at) < 0 || r.status === 'cancelled')
        .reverse();

    return (
        <div className="page">
            <div className="page-head">
                <h1 className="page-title">라운드</h1>
                {isAdmin && (
                    <Link to="/rounds/new" className="btn primary sm">+ 모집 열기</Link>
                )}
            </div>

            {upcoming.length === 0 && (
                <div className="empty">
                    예정된 라운드가 없습니다.
                    {isAdmin && <><br />위의 <b>모집 열기</b>로 새 라운드를 올려 보세요.</>}
                </div>
            )}

            {upcoming.map(r => (
                <RoundCard key={r.id} round={r} signups={signups} me={me} />
            ))}

            {past.length > 0 && (
                <>
                    <div className="section-title" style={{ marginTop: 'var(--gap)' }}>
                        지난 라운드
                    </div>
                    {past.map(r => (
                        <RoundCard key={r.id} round={r} signups={signups} me={me} past />
                    ))}
                </>
            )}
        </div>
    );
}

export function RoundCard({
    round: r, signups, me, past,
}: {
    round: Round;
    signups: Signup[];
    me: string;
    past?: boolean;
}) {
    const mine = signups.filter(s => s.round_id === r.id);
    const confirmed = mine.filter(s => s.state === 'confirmed').length;
    const waiting = mine.filter(s => s.state === 'waitlist').length;
    const my = mine.find(s => s.user_id === me);
    const full = confirmed >= r.capacity;

    return (
        <Link to={`/rounds/${r.id}`} className={`card tappable round-card${past ? ' past' : ''}`}>
            <div className="row between">
                <div className="row" style={{ gap: 'var(--gap-xs)' }}>
                    {r.status === 'cancelled'
                        ? <span className="badge danger">취소됨</span>
                        : past
                            ? <span className="badge dim">종료</span>
                            : <span className={`badge ${daysUntil(r.tee_at) <= 3 ? 'warn' : 'brand'}`}>
                                {ddayLabel(r.tee_at)}
                              </span>}
                    {r.status === 'closed' && !past && <span className="badge dim">모집 마감</span>}
                </div>
                {my && (
                    <span className={`badge ${my.state === 'confirmed' ? 'brand' : 'wait'}`}>
                        {my.state === 'confirmed' ? '참가 확정' : '대기중'}
                    </span>
                )}
            </div>

            <div className="round-course truncate">{r.course || r.title || '골프장 미정'}</div>
            <div className="sm dim">{formatDateTime(r.tee_at)}</div>

            <div className="row between round-foot">
                <div className="capacity">
                    <div className="capacity-bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, (confirmed / r.capacity) * 100)}%` }} />
                    </div>
                    <span className={`sm b ${full ? 'faint' : ''}`}>
                        {confirmed}/{r.capacity}명
                        {waiting > 0 && <span className="wait-count"> · 대기 {waiting}</span>}
                    </span>
                </div>
                {r.fee > 0 && <span className="sm faint">{formatWon(r.fee)}</span>}
            </div>
        </Link>
    );
}
