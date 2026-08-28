import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatFullDate, formatTime, formatWon, ddayLabel, daysUntil } from '../lib/format';
import {
    CADDIE_SHORT, CART_SHORT, FEE_LABEL, KIND_ICON, KIND_LABEL, TEE_LABEL, roundKind,
    type Round, type RoundComment, type Signup, type Profile,
    type Settlement, type SettlementShare,
} from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { Comments } from '../components/Comments';
import { Settlements } from '../components/Settlement';
import { readableError } from '../lib/errors';
import './Rounds.css';

interface Loaded {
    round: Round | null;
    signups: Signup[];
    comments: RoundComment[];
    settlements: Settlement[];
    shares: SettlementShare[];
    people: Profile[];
}

export function RoundDetail() {
    const { id } = useParams<{ id: string }>();
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const nav = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        const [round, signups, comments, settlements, people] = await Promise.all([
            supabase.from('rounds').select('*').eq('id', id!).maybeSingle(),
            supabase.from('signups').select('*').eq('round_id', id!).order('seq'),
            supabase.from('round_comments').select('*').eq('round_id', id!)
                    .order('created_at'),
            supabase.from('settlements').select('*').eq('round_id', id!)
                    .order('created_at', { ascending: false }),
            fetchProfiles(),
        ]);
        /* 몫은 정산을 받아 온 **뒤에** 그 id들로 부른다. 라운드 id로는
           못 걸러서다 — 몫 표에는 라운드가 안 적혀 있다. */
        const list = (unwrap(settlements) ?? []) as Settlement[];
        const shares = list.length
            ? unwrap(await supabase.from('settlement_shares').select('*')
                     .in('settlement_id', list.map(x => x.id)).order('created_at')) ?? []
            : [];
        return {
            round: unwrap(round),
            signups: unwrap(signups) ?? [],
            comments: unwrap(comments) ?? [],
            settlements: list,
            shares: shares as SettlementShare[],
            people,
        };
    }, [id]);

    useRealtime(
        ['signups', 'rounds', 'round_comments', 'settlements', 'settlement_shares'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (error || !data?.round) {
        return (
            <div className="page">
                <TopBar title="라운드" fallback="/rounds" />
                <div className="notice danger">{error ?? '없는 라운드입니다.'}</div>
            </div>
        );
    }

    const r = data.round;
    const kind = roundKind(r);
    const names = byId(data.people);
    const confirmed = data.signups.filter(s => s.state === 'confirmed');
    const waiting = data.signups.filter(s => s.state === 'waitlist');
    const my = data.signups.find(s => s.user_id === me);
    const openSlots = Math.max(0, r.capacity - confirmed.length);

    const isPast = daysUntil(r.tee_at) < 0;
    /* **`opens_at`은 더 안 본다.** `신청 시작` 칸을 없앴으므로 새로 정할
       길이 없는데, 예전에 적힌 값이 남아 있으면 풀 방법도 없이 신청이
       잠긴 채로 굳는다. DB의 칸은 기록으로 남겨 두고 화면만 무시한다. */
    const canSignUp = r.status === 'open' && !isPast;

    /* 신청 ─ 정원 계산은 DB(join_round)가 한다. 여기서 세지 않는다. */
    const join = async () => {
        setBusy(true);
        const { data: row, error: err } = await supabase.rpc('join_round', {
            p_round: r.id, p_note: '',
        });
        setBusy(false);
        if (err) { toast(readableError(err), 'error'); return; }
        toast(
            (row as Signup)?.state === 'confirmed'
                ? '참가가 확정되었습니다.'
                : '자리가 차서 대기자로 올렸습니다.',
            'ok'
        );
        reload();
    };

    const leave = async () => {
        const ok = await confirm({
            title: '신청을 취소할까요?',
            detail: my?.state === 'confirmed' && waiting.length > 0
                ? <>내 자리는 대기 1번인 <b>{names[waiting[0].user_id]?.name ?? '다음 분'}</b>에게 넘어갑니다.</>
                : '다시 신청하면 순번은 맨 뒤가 됩니다.',
            confirmLabel: '취소하기',
            danger: true,
        });
        if (!ok) return;

        setBusy(true);
        const { error: err } = await supabase.rpc('leave_round', { p_round: r.id });
        setBusy(false);
        if (err) { toast(readableError(err), 'error'); return; }
        toast('신청을 취소했습니다.');
        reload();
    };

    const kick = async (userId: string) => {
        const ok = await confirm({
            title: `${names[userId]?.name ?? '이 분'}을 뺄까요?`,
            detail: '대기자가 있으면 맨 앞 사람이 자동으로 올라갑니다.',
            confirmLabel: '빼기',
            danger: true,
        });
        if (!ok) return;
        const { error: err } = await supabase.rpc('kick_signup', { p_round: r.id, p_user: userId });
        if (err) { toast(readableError(err), 'error'); return; }
        toast('명단에서 뺐습니다.');
        reload();
    };

    const removeRound = async () => {
        const ok = await confirm({
            title: '이 라운드를 지울까요?',
            detail: <>
                {r.course || r.title}<br />
                <b style={{ color: 'var(--danger)' }}>
                    신청 {data.signups.length}건
                    {data.comments.length > 0 && `과 댓글 ${data.comments.length}개`}이
                    함께 사라집니다.
                </b><br />
                되돌릴 수 없습니다. 모집만 멈추려면 <b>마감</b>을 쓰세요.
            </>,
            confirmLabel: '지우기',
            danger: true,
        });
        if (!ok) return;
        const { error: err } = await supabase.from('rounds').delete().eq('id', r.id);
        if (err) { toast(readableError(err), 'error'); return; }
        toast('지웠습니다.');
        nav('/rounds', { replace: true });
    };

    const setStatus = async (status: Round['status']) => {
        const { error: err } = await supabase.from('rounds').update({ status }).eq('id', r.id);
        if (err) { toast(readableError(err), 'error'); return; }
        reload();
    };

    return (
        <div className="page">
            <TopBar
                title="라운드"
                fallback="/rounds"
                right={(isAdmin || r.created_by === me) && (
                    <Link to={`/rounds/${r.id}/edit`} className="btn ghost sm">수정</Link>
                )}
            />

            <div className="round-hero">
                <div className="row" style={{ gap: 'var(--gap-xs)' }}>
                    <span className={`badge kind ${kind}`}>
                        {KIND_ICON[kind]} {KIND_LABEL[kind]}
                    </span>
                    {r.status === 'cancelled'
                        ? <span className="badge danger">취소됨</span>
                        : isPast
                            ? <span className="badge done">종료</span>
                            : r.status === 'closed'
                                ? <span className="badge done">모집 마감</span>
                                /* 자리가 다 차면 목록과 같은 말로 적는다.
                                   대기 신청은 아래 단추가 따로 말해 준다. */
                                : openSlots === 0
                                    ? <span className="badge done">모집 마감</span>
                                    : <span className="badge live">모집중</span>}
                    {!isPast && r.status !== 'cancelled' && (
                        <span className={`badge ${daysUntil(r.tee_at) <= 3 ? 'warn' : 'dim'}`}>
                            {ddayLabel(r.tee_at)}
                        </span>
                    )}
                </div>
                <h2>
                    <span className="round-kind-mark" aria-hidden="true">{KIND_ICON[kind]}</span>
                    {r.course || r.title || (kind === 'screen' ? '매장 미정' : '골프장 미정')}
                </h2>
                {r.title && r.course && <div className="sm dim">{r.title}</div>}
            </div>

            <dl className="info-grid">
                <div className="info-cell">
                    <dt>날짜</dt>
                    <dd>{formatFullDate(r.tee_at)}</dd>
                </div>
                <div className="info-cell">
                    <dt>{TEE_LABEL[kind]}</dt>
                    <dd>{formatTime(r.tee_at)}</dd>
                </div>
                <div className="info-cell">
                    <dt>정원</dt>
                    <dd>{r.capacity}명</dd>
                </div>
                <div className="info-cell">
                    <dt>{FEE_LABEL[kind]}</dt>
                    <dd>{r.fee > 0 ? formatWon(r.fee) : '미정'}</dd>
                </div>
                {/* **캐디와 카트를 따로 놓는다.** 한 칸에 묶으면 옆칸이
                    비어 표가 이 빠진 것처럼 보인다. 필드면 둘 다 자리를
                    지키고(안 정했으면 `미정`) 스크린이면 둘 다 없다 —
                    그래야 칸 수가 늘 짝수라 빈자리가 안 생긴다.
                    참가비도 예전부터 이렇게 `미정`을 적어 왔다. */}
                {kind === 'field' && (
                    <>
                        <div className="info-cell">
                            <dt>캐디</dt>
                            <dd>{r.caddie ? CADDIE_SHORT[r.caddie] : '미정'}</dd>
                        </div>
                        <div className="info-cell">
                            <dt>카트</dt>
                            <dd>{r.cart ? CART_SHORT[r.cart] : '미정'}</dd>
                        </div>
                    </>
                )}
            </dl>

            {/* 흰 카드가 이어지면 안내가 묻힌다. 모이는 곳·계좌처럼 **꼭
                읽어야 할 줄**이라 노란 쪽지처럼 띄운다 — 공지가 노랑인 것과
                같은 결이다(색 규칙은 CLAUDE.md 참고). */}
            {r.note && (
                <div className="card note-card">
                    <div className="section-title">전달 내용</div>
                    <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{r.note}</p>
                </div>
            )}

            {/* ── 참가자 ── */}
            <div className="card">
                <div className="row between">
                    <div className="section-title">
                        참가 확정 {confirmed.length}/{r.capacity}
                    </div>
                    {openSlots > 0 && !isPast && (
                        <span className="badge brand">{openSlots}자리 남음</span>
                    )}
                </div>

                <div className="signup-list">
                    {confirmed.map((s, i) => (
                        <PersonRow
                            key={s.id} seq={i + 1} profile={names[s.user_id]}
                            isMe={s.user_id === me}
                            onKick={isAdmin && s.user_id !== me ? () => kick(s.user_id) : undefined}
                        />
                    ))}
                    {/* 남은 자리를 빈 줄로 그려 둔다 — 몇 자리인지 세지 않아도 보인다. */}
                    {!isPast && Array.from({ length: openSlots }, (_, i) => (
                        <div key={`slot-${i}`} className="signup-row empty-slot">
                            <span className="signup-seq">{confirmed.length + i + 1}</span>
                            <span>빈 자리</span>
                        </div>
                    ))}
                </div>
            </div>

            {waiting.length > 0 && (
                <div className="card">
                    <div className="section-title">대기 {waiting.length}명</div>
                    <div className="signup-list">
                        {waiting.map((s, i) => (
                            <PersonRow
                                key={s.id} seq={i + 1} profile={names[s.user_id]}
                                isMe={s.user_id === me} waiting
                                onKick={isAdmin && s.user_id !== me ? () => kick(s.user_id) : undefined}
                            />
                        ))}
                    </div>
                    <p className="xs faint">확정자가 빠지면 위에서부터 자동으로 올라갑니다.</p>
                </div>
            )}

            {/* ── 신청 버튼 ── */}
            {!isPast && r.status !== 'cancelled' && (
                <div className="round-actions">
                    {my ? (
                        <button className="btn danger block" onClick={leave} disabled={busy}>
                            {my.state === 'confirmed' ? '참가 취소' : '대기 취소'}
                        </button>
                    ) : (
                        <button
                            className="btn primary block"
                            onClick={join}
                            disabled={busy || !canSignUp}
                        >
                            {!canSignUp
                                ? '신청 마감'
                                : openSlots > 0 ? '참가 신청' : '대기 신청'}
                        </button>
                    )}
                </div>
            )}

            {/* ── 정산 ──
                **총무와 운영진만 만든다**(`canSettle`). 정산이 있으면
                회원 모두에게 보인다 — 자기 몫이 얼마인지 봐야 한다.
                댓글보다 위에 둔다: 돈은 먼저 눈에 들어와야 한다. */}
            <Settlements
                roundId={r.id}
                people={data.people.filter(p => p.role !== 'pending' && p.role !== 'banned')}
                /* **명단은 회원 전체로 두고, 참가자만 앞세운다.** 라운드는
                   안 하고 뒷풀이만 온 사람도 정산에 넣어야 하기 때문이다 —
                   여기서 참가자로 좁히면 그 사람을 넣을 길이 없어진다. */
                joined={confirmed.map(s => s.user_id)}
                list={data.settlements}
                shares={data.shares}
                onChange={reload}
            />

            {/* ── 모집을 연 사람과 운영진만 ── */}
            {(isAdmin || r.created_by === me) && (
                <div className="card">
                    <div className="section-title">{isAdmin ? '운영' : '내가 연 모집'}</div>
                    <div className="row wrap" style={{ gap: 'var(--gap-sm)' }}>
                        {r.status === 'open' && (
                            <button className="btn ghost sm" onClick={() => setStatus('closed')}>
                                모집 마감
                            </button>
                        )}
                        {r.status === 'closed' && (
                            <button className="btn ghost sm" onClick={() => setStatus('open')}>
                                모집 다시 열기
                            </button>
                        )}
                        {r.status !== 'cancelled' ? (
                            <button className="btn ghost sm" onClick={() => setStatus('cancelled')}>
                                라운드 취소
                            </button>
                        ) : (
                            <button className="btn ghost sm" onClick={() => setStatus('open')}>
                                취소 되돌리기
                            </button>
                        )}
                        <button className="btn danger sm" onClick={removeRound}>지우기</button>
                    </div>
                </div>
            )}

            {/* ── 댓글 ──
                **신청 버튼보다 아래**에 둔다. 그 버튼은 바닥에 붙어 있다가
                (`position: sticky`) 제자리에 닿으면 물러나므로, 댓글을 읽으러
                내려가면 저절로 비켜 준다. 위에 두면 적는 내내 버튼이 칸을
                가린다. */}
            <Comments
                comments={data.comments} names={names}
                target={{ table: 'round_comments', parent: { round_id: r.id } }}
                onChange={reload}
            />
        </div>
    );
}

function PersonRow({
    seq, profile, isMe, waiting, onKick,
}: {
    seq: number;
    profile?: Profile;
    isMe: boolean;
    waiting?: boolean;
    onKick?: () => void;
}) {
    return (
        <div className={`signup-row${isMe ? ' is-me' : ''}${waiting ? ' is-wait' : ''}`}>
            <span className="signup-seq">{seq}</span>
            <Avatar name={profile?.name} url={profile?.avatar_url} size="sm" />
            <span className="signup-name grow truncate">
                {profile?.name ?? '알 수 없음'}
                {isMe && <span className="xs brand-tag"> (나)</span>}
            </span>
            {/* 명단에서는 차량번호가 쓸모 있다 — 골프장 입구에서 확인하고
                카풀을 맞출 때 본다(핸디캡을 대신해 받는 값이다). */}
            {profile?.car && <span className="xs faint">{profile.car}</span>}
            {onKick && (
                <button className="btn ghost sm" onClick={onKick} aria-label="명단에서 빼기">✕</button>
            )}
        </div>
    );
}
