import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchPeople, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, formatFullDate, formatTime, formatWon, ddayLabel, daysUntil } from '../lib/format';
import {
    CADDIE_SHORT, CART_SHORT, FEE_LABEL, KIND_ICON, KIND_LABEL, TEE_LABEL,
    personLabel, roundKind,
    type Person, type Round, type RoundComment, type RoundGroup, type Signup,
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
import './Groups.css';

interface Loaded {
    round: Round | null;
    signups: Signup[];
    comments: RoundComment[];
    settlements: Settlement[];
    shares: SettlementShare[];
    people: Person[];
    groups: RoundGroup | null;
}

export function RoundDetail() {
    const { id } = useParams<{ id: string }>();
    const { session, isAdmin, profile } = useAuth();
    const me = session!.user.id;
    const nav = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    const [busy, setBusy] = useState(false);

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        const [round, signups, comments, settlements, people, groups] = await Promise.all([
            supabase.from('rounds').select('*').eq('id', id!).maybeSingle(),
            supabase.from('signups').select('*').eq('round_id', id!).order('seq'),
            supabase.from('round_comments').select('*').eq('round_id', id!)
                    .order('created_at'),
            supabase.from('settlements').select('*').eq('round_id', id!)
                    .order('created_at', { ascending: false }),
            fetchPeople(),
            /* 조별 시각만 여기 있다. 조 번호는 `signups.grp`라 위에서 함께
               왔으므로, 편성이 없으면 이 줄이 없을 뿐 나머지는 멀쩡하다. */
            supabase.from('round_groups').select('*').eq('round_id', id!).maybeSingle(),
        ]);
        /* **여기서 `unwrap`을 쓰지 않는다.** 스키마를 아직 다시 안 돌린
           저장소에는 이 표가 아예 없어 오류가 돌아오는데, 그걸 던지면
           **라운드 상세가 통째로 안 열린다.** 조 편성은 있으면 좋은 것이지
           라운드를 못 보게 할 만한 것이 아니다 — 대화의 `image_url`을 안
           보내는 것, `roundKind()`가 없는 칸을 필드로 보는 것과 같은 규칙이다. */
        const groupRow = (groups.error ? null : groups.data) as RoundGroup | null;
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
            groups: groupRow,
        };
    }, [id], `round:${id}`);

    useRealtime(
        ['signups', 'rounds', 'round_comments', 'settlements', 'settlement_shares',
         'round_groups'], reload);

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
    const mayEditGroups = isAdmin || r.created_by === me;

    /* 조별로 묶은 확정자. **조가 하나도 없으면 빈 배열**이고, 그때는 아래에서
       예전처럼 한 줄로 그린다 — 조를 안 짜는 라운드가 대부분이라 그게 기본이다.
       미배정(`null`)은 늘 맨 뒤에 온다: 자리가 나서 나중에 올라온 사람이다. */
    const grouped: [number | null, Signup[]][] = (() => {
        if (!confirmed.some(s => s.grp != null)) return [];
        const bag = new Map<number | null, Signup[]>();
        for (const s of confirmed) {
            const key = s.grp ?? null;
            if (!bag.has(key)) bag.set(key, []);
            bag.get(key)!.push(s);
        }
        return [...bag.entries()].sort(([a], [b]) =>
            a === null ? 1 : b === null ? -1 : a - b);
    })();

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

    /* ── 대화방에 공유 ──
     *
     * **모집을 열면 저절로 한 줄이 남지만, 그때 한 번뿐이다.** 대화가 하루에
     * 백 마디씩 쌓이면 그 줄은 위로 밀려 사라지고, 자리가 남아도 아무도 모른다.
     * 이 단추가 그 라운드를 대화방 맨 아래로 다시 올려 준다.
     *
     * **`system` 글로 넣는다** — 말풍선이 아니라 눌리는 카드로 그려지고
     * (`RoundCard` in Chat.tsx), 다른 안내 줄과 같은 자리에 선다.
     *
     * **폰 알림도 함께 간다**(`notify: true`). `system` 줄은 원래 안 울리는데
     * (모집을 열 때 저절로 남는 줄은 `⛳ 새 모집`이 이미 나간 뒤다) 이것만
     * 뚫는다 — **자리가 남았다고 다시 알리는 것이 이 단추의 목적**이라,
     * 대화방에만 남으면 묻히는 그 문제가 그대로 되풀이된다.
     * **알림 문구는 발송기가 라운드에서 다시 짠다** — 여기서 만든 글은
     * 대화방에 보이는 카드 몫이다.
     *
     * **`notify` 칸이 없는 저장소에서도 올라가야 한다.** 앱은 푸시하면 몇 분
     * 뒤 올라가지만 `schema.sql`은 사람이 손으로 붙여넣으므로 그 사이가 있다 —
     * 42703(그런 칸 없음)이면 그 칸을 빼고 한 번 더 넣는다. 알림만 안 가고
     * 공유는 된다.
     *
     * **글은 여기서 만든다.** 날짜 문구를 SQL에 또 적으면 화면과 두 벌이 된다.
     */
    const canShare = !isPast && r.status !== 'cancelled';

    const share = async () => {
        const when = formatDateTime(r.tee_at);
        const ok = await confirm({
            title: '대화방에 올릴까요?',
            detail: <>
                전체 대화방에 이 {KIND_LABEL[kind]} 카드가 올라가고,
                회원들에게 알림도 갑니다.<br />
                <b>{r.course || r.title}</b> · {when}
            </>,
            confirmLabel: '올리기',
        });
        if (!ok) return;

        setBusy(true);
        /* 전체 대화방은 **`round_id`가 없는 방 중 가장 먼저 만든 것**이다
           (DB의 `chat_notice`와 같은 잣대 — 두 벌이 되면 언젠가 어긋난다). */
        const room = await supabase.from('rooms').select('id')
            .is('round_id', null).order('created_at').limit(1).maybeSingle();
        const roomId = (room.data as { id: string } | null)?.id;
        if (!roomId) {
            setBusy(false);
            toast('전체 대화방이 없습니다.', 'error');
            return;
        }

        /* **`필드를` / `스크린을`** — 받침이 있으면 `을`이다. 한 글자로
           굳혀 두면 둘 중 하나는 늘 어색하다(`스크린를`). */
        const label = KIND_LABEL[kind];
        const josa = (label.charCodeAt(label.length - 1) - 0xac00) % 28 ? '을' : '를';

        const body = [
            `${profile?.name || '누군가'}님이 ${label}${josa} 공유했습니다`,
            r.course || r.title || KIND_LABEL[kind],
            `${when} · 정원 ${r.capacity}명`
                + (openSlots > 0 ? ` · ${openSlots}자리 남음` : ' · 자리 참'),
        ].join('\n');

        /* **없는 칸을 하나씩 빼면서 다시 넣는다.**
           `notify`(알림)와 `round_id`(눌리는 카드)는 **있으면 좋은 것**이지
           공유 자체를 막을 것이 아니다. 앱은 푸시하면 몇 분 뒤 올라가는데
           `schema.sql`은 사람이 손으로 붙여넣으므로 그 사이가 있고,
           실제로 그 사이에 `round_id`가 없어 공유가 통째로 실패했다.
           **오류 코드가 둘이다** — Postgres는 `42703`을 주지만 PostgREST는
           칸 목록을 제가 들고 있어서 DB에 닿기도 전에 `PGRST204`로 물린다.
           하나만 보면 안 걸린다. */
        const extra = { round_id: r.id, notify: true };
        // 뺄 차례 — 덜 아쉬운 것부터다(알림 먼저, 눌리는 카드는 마지막).
        const drops: (keyof typeof extra)[] = ['notify', 'round_id'];
        let err = null;
        for (let i = 0; i <= drops.length; i++) {
            const opt = { ...extra };
            for (const k of drops.slice(0, i)) delete opt[k];
            ({ error: err } = await supabase.from('messages')
                .insert({ room_id: roomId, user_id: me, body, system: true, ...opt }));
            if (!err || (err.code !== '42703' && err.code !== 'PGRST204')) break;
        }
        setBusy(false);
        if (err) { toast(readableError(err), 'error'); return; }
        toast('대화방에 올렸습니다.', 'ok');
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

            {/* **공유는 누구나, 베끼는 것은 스크린만.**
                공유는 이 라운드를 대화방에 다시 띄우는 일이라 필드·스크린이
                같고, 자리가 안 차면 누구든 부를 수 있어야 한다.
                베끼기는 스크린만이다 — 같은 매장에서 같은 게임비로 되풀이해
                열리므로 매번 처음부터 치는 것이 낭비였고, 필드는 갈 때마다
                골프장이 달라 베낄 것이 없다. */}
            {(canShare || kind === 'screen') && (
                <div className="row wrap" style={{ justifyContent: 'flex-end', gap: 'var(--gap-sm)' }}>
                    {canShare && (
                        <button className="btn ghost sm" onClick={share} disabled={busy}>
                            📣 대화방에 공유
                        </button>
                    )}
                    {kind === 'screen' && (
                        <Link className="btn ghost sm" to={`/rounds/new?from=${r.id}`}>
                            📋 같은 조건으로 새로 열기
                        </Link>
                    )}
                </div>
            )}

            {/* 흰 카드가 이어지면 안내가 묻힌다. 모이는 곳·계좌처럼 **꼭
                읽어야 할 줄**이라 노란 쪽지처럼 띄운다 — 공지가 노랑인 것과
                같은 결이다(색 규칙은 CLAUDE.md 참고). */}
            {r.note && (
                <div className="card note-card">
                    <div className="section-title">전달 내용</div>
                    <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{r.note}</p>
                </div>
            )}

            {/* ── 참가자 ──
                조가 짜여 있으면 **조별로 묶어 그린다.** 명단은 그대로인데
                순서만 조 순서가 되므로, 내 조가 어디인지 훑을 필요가 없다. */}
            <div className="card">
                <div className="row between">
                    <div className="section-title">
                        참가 확정 {confirmed.length}/{r.capacity}
                    </div>
                    {openSlots > 0 && !isPast && (
                        <span className="badge brand">{openSlots}자리 남음</span>
                    )}
                </div>

                {grouped.length > 0 ? (
                    <>
                        {grouped.map(([no, list]) => (
                            <div key={no ?? 'none'} className="grp-block">
                                <div className="grp-head">
                                    <span className="grp-no">
                                        {no === null ? '미배정' : `${no}조`}
                                    </span>
                                    {/* **내 조는 작은 표로만 알린다.** 칸을 통째로
                                        분홍으로 칠해 봤는데, 분홍은 '지금 눌러야
                                        할 것' 자리라 명단이 그 색을 덮으면 뜻이
                                        무너진다. 내 줄은 어차피 `(나)`로 도드라진다. */}
                                    {list.some(s => s.user_id === me) && (
                                        <span className="badge brand">내 조</span>
                                    )}
                                    {no !== null && data.groups?.tees?.[no] && (
                                        <span className="xs faint">
                                            {TEE_LABEL[kind]} {formatTime(data.groups.tees[no])}
                                        </span>
                                    )}
                                </div>
                                <div className="signup-list">
                                    {list.map((s, i) => (
                                        <PersonRow
                                            key={s.id} seq={i + 1} profile={names[s.user_id]}
                                            isMe={s.user_id === me}
                                            onKick={isAdmin && s.user_id !== me
                                                ? () => kick(s.user_id) : undefined}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </>
                ) : (
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
                )}

                {/* **조 편성으로 들어가는 문.** 명단 바로 밑이라 눈이 가는
                    자리다 — 운영 칸에 넣으면 화면 맨 아래라 못 찾는다.
                    **말은 `조 편성` 하나로 통일한다**(사용자가 정한 것이다) —
                    여기만 `조 짜기`였는데, 눌러 들어간 화면 제목은 `조 편성`이라
                    같은 것인지 한 번 더 생각하게 된다. */}
                {mayEditGroups && confirmed.length > 0 && (
                    <div className="row" style={{ marginTop: 'var(--gap-sm)' }}>
                        <Link className="btn ghost sm" to={`/rounds/${r.id}/groups`}>
                            🚩 {grouped.length > 0 ? '조 편성 고치기' : '조 편성'}
                        </Link>
                    </div>
                )}
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
    profile?: Person;
    isMe: boolean;
    waiting?: boolean;
    onKick?: () => void;
}) {
    return (
        <div className={`signup-row${isMe ? ' is-me' : ''}${waiting ? ' is-wait' : ''}`}>
            <span className="signup-seq">{seq}</span>
            <Avatar name={profile?.name} url={profile?.avatar_url}
                    gender={profile?.gender} size="sm" />
            {/* **차량번호는 여기 없다**(사용자 요청). 회원 명단에서 운영진에게만
                보인다 — 골프장에 차를 미리 등록하는 일이 거기서 끝나고,
                참가자 줄에까지 두면 남의 차량번호가 여러 화면에 흩어진다. */}
            <span className="signup-name grow truncate">
                {personLabel(profile) || '알 수 없음'}
                {isMe && <span className="xs brand-tag"> (나)</span>}
            </span>
            {onKick && (
                <button className="btn ghost sm" onClick={onKick} aria-label="명단에서 빼기">✕</button>
            )}
        </div>
    );
}
