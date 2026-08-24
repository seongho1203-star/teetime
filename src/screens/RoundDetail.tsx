import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatFullDate, formatTime, formatWon, ddayLabel, daysUntil } from '../lib/format';
import {
    CADDIE_LABEL, CART_LABEL, KIND_ICON, KIND_LABEL, TEE_LABEL, roundKind,
    type Round, type Signup, type Profile,
} from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import './Rounds.css';

interface Loaded {
    round: Round | null;
    signups: Signup[];
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
        const [round, signups, people] = await Promise.all([
            supabase.from('rounds').select('*').eq('id', id!).maybeSingle(),
            supabase.from('signups').select('*').eq('round_id', id!).order('seq'),
            fetchProfiles(),
        ]);
        return { round: unwrap(round), signups: unwrap(signups) ?? [], people };
    }, [id]);

    useRealtime(['signups', 'rounds'], reload);

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
    const notYet = r.opens_at ? new Date(r.opens_at) > new Date() : false;
    const canSignUp = r.status === 'open' && !isPast && !notYet;

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
                    신청 {data.signups.length}건이 함께 사라집니다.
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
                    <span className="badge kind">{KIND_ICON[kind]} {KIND_LABEL[kind]}</span>
                    {r.status === 'cancelled'
                        ? <span className="badge danger">취소됨</span>
                        : isPast
                            ? <span className="badge dim">종료</span>
                            : <span className={`badge ${daysUntil(r.tee_at) <= 3 ? 'warn' : 'brand'}`}>
                                {ddayLabel(r.tee_at)}
                              </span>}
                    {r.status === 'closed' && <span className="badge dim">모집 마감</span>}
                    {notYet && <span className="badge wait">신청 대기</span>}
                </div>
                <h2>{r.course || r.title || (kind === 'screen' ? '매장 미정' : '골프장 미정')}</h2>
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
                    <dt>참가비</dt>
                    <dd>{r.fee > 0 ? formatWon(r.fee) : '미정'}</dd>
                </div>
                {kind === 'field' && (r.caddie || r.cart) && (
                    <div className="info-cell">
                        <dt>조건</dt>
                        <dd>
                            {[r.caddie && CADDIE_LABEL[r.caddie], r.cart && CART_LABEL[r.cart]]
                                .filter(Boolean).join(' · ')}
                        </dd>
                    </div>
                )}
            </dl>

            {notYet && (
                <div className="notice warn">
                    {formatFullDate(r.opens_at!)} {formatTime(r.opens_at!)}부터 신청할 수 있습니다.
                </div>
            )}

            {r.note && (
                <div className="card">
                    <div className="section-title">안내</div>
                    <p className="sm dim" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                        {r.note}
                    </p>
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
                                ? (notYet ? '아직 신청 전' : '신청 마감')
                                : openSlots > 0 ? '참가 신청' : '대기 신청'}
                        </button>
                    )}
                </div>
            )}

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
            {profile?.handicap != null && (
                <span className="xs faint">HC {profile.handicap}</span>
            )}
            {onKick && (
                <button className="btn ghost sm" onClick={onKick} aria-label="명단에서 빼기">✕</button>
            )}
        </div>
    );
}
