import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, ddayLabel, daysUntil, formatWon } from '../lib/format';
import {
    CADDIE_LABEL, CART_LABEL, KIND_ICON, KIND_LABEL, roundKind,
    type Round, type RoundKind, type Signup,
} from '../lib/types';
import './Rounds.css';

interface Loaded {
    rounds: Round[];
    signups: Signup[];
}

export function Rounds() {
    const { session } = useAuth();
    const me = session!.user.id;
    const [only, setOnly] = useState<RoundKind | null>(null);

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

    const all = data?.rounds ?? [];
    const signups = data?.signups ?? [];

    /* **가리개는 둘이 섞여 있을 때만 나온다.** 필드만 올리는 달에는
       누를 일이 없는 단추 셋이 자리만 차지한다 — 이 앱은 해당 없는 칸을
       통째로 지우는 쪽을 택해 왔다. */
    const mixed = all.some(r => roundKind(r) === 'screen')
               && all.some(r => roundKind(r) === 'field');
    const rounds = only ? all.filter(r => roundKind(r) === only) : all;

    // 오늘(한국 날짜) 이후는 '예정', 그 전은 '지난'. 지난 것은 최근 순으로.
    const upcoming = rounds.filter(r => daysUntil(r.tee_at) >= 0 && r.status !== 'cancelled');
    const past = rounds
        .filter(r => daysUntil(r.tee_at) < 0 || r.status === 'cancelled')
        .reverse();

    return (
        <div className="page">
            <div className="page-head">
                <h1 className="page-title">라운드</h1>
                <Link to="/rounds/new" className="btn primary sm">+ 모집 열기</Link>
            </div>

            {mixed && (
                <div className="kind-filter" role="group" aria-label="종류 가리기">
                    <button type="button" className={`kind-chip${only === null ? ' on' : ''}`}
                            onClick={() => setOnly(null)} aria-pressed={only === null}>
                        전체
                    </button>
                    {(['field', 'screen'] as const).map(k => (
                        <button key={k} type="button" className={`kind-chip${only === k ? ' on' : ''}`}
                                onClick={() => setOnly(only === k ? null : k)} aria-pressed={only === k}>
                            {KIND_ICON[k]} {KIND_LABEL[k]}
                        </button>
                    ))}
                </div>
            )}

            {upcoming.length === 0 && (
                <div className="empty">
                    {only
                        ? <>예정된 {KIND_LABEL[only]} 라운드가 없습니다.</>
                        : <>예정된 라운드가 없습니다.
                           <br />위의 <b>모집 열기</b>로 새 라운드를 올려 보세요.</>}
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
    const kind = roundKind(r);

    return (
        <Link to={`/rounds/${r.id}`}
              className={`card tappable round-card${past ? ' past' : ''}` +
                         `${!past && (r.status === 'closed' || r.status === 'cancelled') ? ' shut' : ''}`}>
            <div className="row between">
                <div className="row" style={{ gap: 'var(--gap-xs)' }}>
                    {/* **둘 다 표시한다.** 스크린만 표를 달면 표가 없는 줄이
                        '필드'인지 '종류가 생기기 전 것'인지 헷갈린다. */}
                    <span className="badge kind">{KIND_ICON[kind]} {KIND_LABEL[kind]}</span>
                    {/* **맨 앞은 늘 '지금 어떤 상태인가'다.** 끝난 것과
                        열려 있는 것이 목록에 섞이므로 색으로 가른다 —
                        잔디=열림, 회색=끝남, 빨강=취소. D-day는 그 뒤에
                        붙는 알려 주는 값이고, 임박하면 노랑으로 세운다. */}
                    {r.status === 'cancelled'
                        ? <span className="badge danger">취소됨</span>
                        : past
                            ? <span className="badge done">종료</span>
                            : r.status === 'closed'
                                ? <span className="badge done">모집 마감</span>
                                : <span className="badge live">모집중</span>}
                    {!past && r.status !== 'cancelled' && (
                        <span className={`badge ${daysUntil(r.tee_at) <= 3 ? 'warn' : 'dim'}`}>
                            {ddayLabel(r.tee_at)}
                        </span>
                    )}
                </div>
                {my && (
                    <span className={`badge ${my.state === 'confirmed' ? 'dim' : 'wait'}`}>
                        {my.state === 'confirmed' ? '참가 확정' : '대기중'}
                    </span>
                )}
            </div>

            <div className="round-course truncate">
                {r.course || r.title || (kind === 'screen' ? '매장 미정' : '골프장 미정')}
            </div>
            <div className="sm dim">
                {formatDateTime(r.tee_at)}
                {r.caddie && ` · ${CADDIE_LABEL[r.caddie]}`}
                {r.cart && ` · ${CART_LABEL[r.cart]}`}
            </div>

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
