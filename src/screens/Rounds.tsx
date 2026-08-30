import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, ddayLabel, daysUntil, formatWon, upcomingSince } from '../lib/format';
import {
    CADDIE_LABEL, CART_LABEL, KIND_ICON, KIND_LABEL, roundKind,
    type RoundLite, type RoundKind, type SignupLite,
} from '../lib/types';
import './Rounds.css';

interface Loaded {
    rounds: RoundLite[];
    signups: SignupLite[];
}

/**
 * `지난 라운드`를 몇 개까지 받아 올까.
 *
 * 목록에 페이지 넘기기가 없으므로 **받는 대로 다 그린다** — 한도가 없으면
 * 해가 갈수록 목록도 통신량도 함께 불어난다. 서른이면 100명 모임에서
 * 두 달치다. 그보다 옛것을 여기서 훑는 일은 없다(찾을 길이 필요해지면
 * 그때 `더 보기`를 붙인다).
 */
const PAST_ROUNDS = 30;

export function Rounds() {
    const { session } = useAuth();
    const me = session!.user.id;
    const [only, setOnly] = useState<RoundKind | null>(null);

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        /* **지난 것을 전부 받지 않는다.** 예전에는 라운드도 신청 기록도
           통째로 받았는데, 100명이 한 해 백쉰 번 라운드를 하면 신청이
           1,200줄이라 **목록 한 번 여는 데 479KB**가 나갔다.
           지금은 앞으로 올 것은 다 받고, 지난 것은 최근 것만 받는다.
           신청 기록은 라운드에 **딸려서** 온다(`signups(*)`) — 따로 부르면
           또 전부 오기 때문이다. 홈이 쓰는 방식과 같다. */
        const cut = upcomingSince();
        /* 목록 카드가 그리는 칸만 받는다(`RoundLite`) — `note`는 목록에
           안 나오는데 한 줄이 수백 글자다. 신청 기록도 자리 수와 내 상태만
           보므로 네 칸이면 된다(`SignupLite`). */
        const cols = 'id, course, title, tee_at, capacity, fee, status, kind, caddie, cart,'
                   + ' signups(round_id, user_id, state, seq)';
        const [next, past] = await Promise.all([
            supabase.from('rounds').select(cols)
                    .gte('tee_at', cut).order('tee_at', { ascending: true }),
            supabase.from('rounds').select(cols)
                    .lt('tee_at', cut).order('tee_at', { ascending: false })
                    .limit(PAST_ROUNDS),
        ]);

        const rows = [...(unwrap(next) ?? []), ...(unwrap(past) ?? [])] as unknown as
            (RoundLite & { signups?: SignupLite[] })[];
        return {
            rounds: rows.map(({ signups: _drop, ...r }) => r as RoundLite),
            signups: rows.flatMap(r => r.signups ?? []),
        };
    }, [], 'rounds');

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
    round: RoundLite;
    signups: SignupLite[];
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
                    <span className={`badge kind ${kind}`}>
                        {KIND_ICON[kind]} {KIND_LABEL[kind]}
                    </span>
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
                                /* **자리가 다 차도 마감으로 적는다.** 4/4인데
                                   `모집중`이라고 붙어 있으면 아직 들어갈 수
                                   있는 줄 알고 눌러 보게 된다. 대기 신청은
                                   그대로 열려 있고, 그건 안에서 단추가 말해 준다. */
                                : full
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

            {/* **제목 줄에도 종류를 세운다.** 위의 표는 작아서 다른 표들
                (모집중·D-day·참가 확정)과 섞여 보인다. 목록을 훑을 때 눈이
                가는 곳은 이름 줄이라, 거기서 갈려야 한 눈에 들어온다. */}
            <div className="round-course truncate">
                <span className="round-kind-mark" aria-hidden="true">{KIND_ICON[kind]}</span>
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
