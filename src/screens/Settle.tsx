import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchPeople, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatWon, timeAgo } from '../lib/format';
import {
    canSettle,
    type Person, type Settlement, type SettlementShare, type SettleReminder,
} from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
/* 이름표와 카드 모양은 라운드 상세의 정산 칸과 **같은 것을 쓴다** — 같은
   정산인데 화면마다 다르게 생기면 같은 것인 줄 모른다. */
import '../components/Settlement.css';
import './Settle.css';

/**
 * 정산을 몇 건까지 받아 올까.
 *
 * **페이지 넘기기가 없으므로 한도를 정한다** — 없으면 해가 갈수록 목록도
 * 통신량도 함께 분다(라운드 목록의 `PAST_ROUNDS`와 같은 규칙이다).
 * 100명이면 한 정산에 몫이 수십 줄이라 여기가 특히 크다.
 */
const RECENT = 30;

type Row = Settlement & { settlement_shares: SettlementShare[] };

interface Loaded {
    list: Row[];
    people: Person[];
    /** 정산 id → 마지막으로 독촉을 보낸 시각. */
    lastSent: Record<string, string>;
    /** 정산 id → 라운드 이름. */
    where: Record<string, string>;
}

/**
 * 정산 현황.
 *
 * **라운드마다 들어가 보지 않아도 되게 하는 자리다.** 정산은 라운드에
 * 붙어 있어서, 지금까지 "누가 안 냈지"를 보려면 라운드를 하나씩 열어야
 * 했다. 여기 모아 놓으면 한 화면에서 끝난다.
 *
 * **기본은 `내가 올린 정산`이다.** 돈은 올린 사람 계좌로 들어가므로
 * 챙길 사람도 그 사람이다 — 라운드를 여럿이 나눠 여는 모임에서 남이 걷는
 * 돈까지 한 화면에 깔리면, 누구 것인지 헷갈리고 남의 정산에 독촉을
 * 눌러 버리는 자리가 된다(사용자가 짚어 준 것이다).
 * `전체`로 넘기는 길은 남겨 둔다 — 올린 사람이 한동안 안 들어올 때
 * 총무가 대신 챙길 자리가 없으면 이 화면을 만든 뜻이 반쯤 없어진다.
 * 어차피 정산은 회원 누구나 라운드에서 볼 수 있어(`settlements_read`)
 * 감추는 것이 아니라 **눈을 좁혀 주는 것**이다.
 *
 * **탭바에는 안 넣는다** — 탭 다섯의 순서는 사용자가 정한 것이고, 이
 * 화면 때문에 모두의 탭을 늘릴 이유가 없다. 문은 `내 정보`에 있고
 * **회원 누구나 들어온다** — 정산을 만드는 것이 누구나이므로 걷는 사람도
 * 누구나다. 만든 것이 없으면 빈 화면에 '라운드에서 정산 만들기를 누르라'고
 * 적힌다.
 */
export function Settle() {
    const { session, profile } = useAuth();
    const me = session!.user.id;
    /* **`전체`는 총무·운영진에게만.** 남의 정산까지 챙기는 자리라 일반
       회원에게는 남의 돈 서른 건이 깔릴 뿐이다. 내 것만 보면 된다. */
    const mayAll = canSettle(profile?.role);
    const [mineOnly, setMineOnly] = useState(true);

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {

        /* **몫을 딸려 받는다.** 따로 부르면 지난 정산 것까지 다 온다
           (홈이 신청 기록을 라운드에 매다는 것과 같다). */
        /* **안 쓰는 칸을 받지 않는다.** `body`(안내 글)·`bank`·`account`는 이
           화면에 안 나오는데, 정산 서른 건이면 그것만으로 수십 KB다.
           계좌는 독촉 알림이 실어 보내고, 자세한 것은 라운드에서 본다. */
        const [res, people] = await Promise.all([
            supabase.from('settlements')
                    .select('id, round_id, title, total, created_by, created_at,'
                            + ' settlement_shares(id, settlement_id, user_id, amount, paid)')
                    .order('created_at', { ascending: false })
                    .limit(RECENT),
            fetchPeople(),
        ]);
        const list = ((unwrap(res) ?? []) as unknown as Row[])
            .map(s => ({ ...s, settlement_shares: s.settlement_shares ?? [] }));

        if (!list.length) return { list, people, lastSent: {}, where: {} };

        const ids = list.map(s => s.id);
        const roundIds = [...new Set(list.map(s => s.round_id).filter(Boolean))];
        const [sent, rounds] = await Promise.all([
            supabase.from('settle_reminders').select('settlement_id, created_at')
                    .in('settlement_id', ids).order('created_at', { ascending: false }),
            supabase.from('rounds').select('id, course, title').in('id', roundIds),
        ]);

        /* 내림차순으로 받았으니 **처음 본 것이 가장 최근**이다.
           **여기서 `unwrap`을 쓰지 않는다** — 스키마를 아직 다시 안 돌린
           저장소에는 이 표가 없어 오류가 돌아오는데, 그걸 던지면 이 화면이
           통째로 안 열린다. `마지막 알림 …` 한 줄이 안 나올 뿐이어야 한다. */
        const lastSent: Record<string, string> = {};
        for (const x of ((sent.error ? [] : sent.data) ?? []) as SettleReminder[]) {
            if (!lastSent[x.settlement_id]) lastSent[x.settlement_id] = x.created_at;
        }
        const name: Record<string, string> = {};
        for (const r of (unwrap(rounds) ?? []) as { id: string; course: string; title: string }[]) {
            name[r.id] = r.course || r.title || '라운드';
        }
        const where: Record<string, string> = {};
        for (const s of list) where[s.id] = name[s.round_id] ?? '';

        return { list, people, lastSent, where };
    }, [], 'settle');

    useRealtime(['settlements', 'settlement_shares'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (error) {
        return (
            <div className="page">
                <TopBar title="정산 현황" fallback="/me" />
                <div className="notice danger">{error}</div>
            </div>
        );
    }

    const all = data?.list ?? [];
    const mine = all.filter(s => s.created_by === me);
    /** `전체` 탭을 쓸 수 있고, 남이 올린 것이 실제로 있을 때만 보여 준다. */
    const canToggle = mayAll && all.length > mine.length;
    const list = canToggle && !mineOnly ? all : mine;

    const open = list.filter(s => s.settlement_shares.some(x => !x.paid));
    const done = list.length - open.length;

    const owed = open.reduce(
        (sum, s) => sum + s.settlement_shares.filter(x => !x.paid)
                           .reduce((a, x) => a + x.amount, 0), 0);
    const owedPeople = new Set(
        open.flatMap(s => s.settlement_shares.filter(x => !x.paid).map(x => x.user_id))).size;

    return (
        <div className="page">
            <TopBar title="정산 현황" fallback="/me" />

            {/* **총무·운영진에게, 남이 올린 정산이 있을 때만 나온다.**
                일반회원에게는 남의 돈 서른 건이 깔릴 뿐이고, 혼자 걷는 달에는
                누를 일이 없는 단추 둘이 자리만 차지한다(라운드 목록의
                필드·스크린 가리개와 같은 규칙이다). */}
            {canToggle && (
                <div className="tabs settle-tabs" role="group" aria-label="보기 고르기">
                    <button className={`tab-btn${mineOnly ? ' on' : ''}`}
                            onClick={() => setMineOnly(true)}>
                        내가 올린 것
                    </button>
                    <button className={`tab-btn${mineOnly ? '' : ' on'}`}
                            onClick={() => setMineOnly(false)}>
                        전체
                    </button>
                </div>
            )}

            {/* **맨 위는 숫자 하나다.** 제일 먼저 알고 싶은 것은
                "얼마가 안 걷혔나"이지 목록이 아니다. */}
            <div className="card settle-sum">
                {open.length === 0 ? (
                    <div className="settle-sum-ok">다 걷혔습니다 👏</div>
                ) : (
                    <>
                        <div className="settle-sum-won">{formatWon(owed)}</div>
                        <div className="sm dim">
                            아직 안 걷힘 · {owedPeople}명 · 정산 {open.length}건
                        </div>
                    </>
                )}
            </div>

            {open.map(s => (
                <Card
                    key={s.id} s={s} people={data!.people}
                    where={data!.where[s.id]} lastSent={data!.lastSent[s.id]}
                    /* **남의 정산일 때만 올린 사람을 적는다.** 내 것에까지
                       내 이름을 붙이면 줄만 길어진다. */
                    by={s.created_by === me ? undefined : s.created_by}
                    onChange={reload}
                />
            ))}

            {done > 0 && (
                <p className="xs faint" style={{ textAlign: 'center' }}>
                    다 걷힌 정산 {done}건은 여기 안 나옵니다.
                </p>
            )}
            {list.length === 0 && (
                <div className="empty">
                    {canToggle ? (
                        <>내가 올린 정산이 없습니다.<br />
                        남이 올린 것은 위의 <b>전체</b>에서 봅니다.</>
                    ) : (
                        <>아직 만든 정산이 없습니다.<br />
                        라운드에 들어가 <b>＋ 정산</b>을 눌러 주세요.</>
                    )}
                </div>
            )}
        </div>
    );
}

function Card({
    s, people, where, lastSent, by, onChange,
}: {
    s: Row;
    people: Person[];
    where?: string;
    lastSent?: string;
    /** 남이 올린 정산이면 그 사람 id. 내 것이면 비어 있다. */
    by?: string | null;
    onChange: () => void;
}) {
    const toast = useToast();
    const confirm = useConfirm();
    const names = byId(people);
    const [busy, setBusy] = useState(false);

    const unpaid = s.settlement_shares.filter(x => !x.paid);
    const paid = s.settlement_shares.length - unpaid.length;

    /** 현금으로 받았을 때 총무가 대신 눌러 준다. 되돌릴 수 있으니 안 묻는다. */
    const togglePaid = async (share: SettlementShare) => {
        const { error } = await supabase.from('settlement_shares')
            .update({ paid: true }).eq('id', share.id);
        if (error) { toast(readableError(error), 'error'); return; }
        toast(`${names[share.user_id]?.name ?? '이 분'} 입금완료로 바꿨습니다.`, 'ok');
        onChange();
    };

    /* **한 줄 넣으면 발송기가 안 낸 사람만 골라 보낸다.**
       이미 낸 사람은 재촉받지 않는다 — 대화방에 적으면 그게 안 갈리는 것이
       가장 성가신 점이었다. */
    const remind = async () => {
        const ok = await confirm({
            title: '입금 알림을 보낼까요?',
            detail: <>
                아직 안 내신 <b>{unpaid.length}명</b>에게만 갑니다.<br />
                <span className="xs faint">이미 보내신 분에게는 가지 않습니다.</span>
                {/* **남의 정산이면 한 번 더 알려 준다.** 돈은 올린 사람
                    계좌로 들어가고 그 사람이 이미 보냈을 수도 있다 —
                    같은 날 두 사람이 각자 누르면 회원 폰은 두 번 울린다. */}
                {by && (
                    <><br /><br />
                    <b style={{ color: 'var(--warn)' }}>
                        {names[by]?.name ?? '다른 분'}님이 올린 정산입니다.
                    </b><br />
                    <span className="xs faint">돈은 그분 계좌로 들어갑니다.</span></>
                )}
            </>,
            confirmLabel: '보내기',
        });
        if (!ok) return;
        setBusy(true);
        const { error } = await supabase.from('settle_reminders')
            .insert({ settlement_id: s.id });
        setBusy(false);
        if (error) { toast(readableError(error), 'error'); return; }
        toast(`${unpaid.length}명에게 보냈습니다.`, 'ok');
        onChange();
    };

    return (
        <div className="card">
            {/* **제목 줄이 라운드로 가는 문이다.** 이름만 링크로 만들면 글자
                높이(18px)라 손가락에 안 잡히고, 그 한 낱말만 분홍이 되어
                아래 `입금 알림 보내기`와 색이 겹친다(투표 목록과 같은 방식이다). */}
            <Link to={`/rounds/${s.round_id}`} className="settle-link">
                <span className="b truncate grow">{s.title}</span>
                <span className="chev">›</span>
            </Link>
            <div className="sm dim">
                {where && `${where} · `}
                총 {formatWon(s.total)} · {paid}/{s.settlement_shares.length}명 보냄
                <span className="xs faint"> · {timeAgo(s.created_at)}</span>
            </div>
            {/* **남이 올린 것이면 누구 것인지 적는다.** 돈이 그 사람 계좌로
                들어가므로 챙길 사람도 그 사람이다 — 안 적으면 내 것과
                섞여 남의 정산에 독촉을 눌러 버린다. */}
            {by && (
                <div className="settle-by">
                    <Avatar name={names[by]?.name} url={names[by]?.avatar_url} size="sm" />
                    <span className="truncate">
                        <b>{names[by]?.name ?? '알 수 없음'}</b>님이 올림
                    </span>
                </div>
            )}

            {/* **안 낸 사람만 세운다.** 다 낸 사람 이름까지 늘어놓으면 100명
                모임에서 목록이 화면을 덮는데, 총무가 볼 것은 안 낸 쪽이다.
                누르면 입금완료가 된다 — 현금으로 받는 일이 흔하다.
                **누를 수 있다고 미리 적어 둔다.** 정산 줄이 눌리는 줄인 것을
                아무도 몰랐던 적이 있다(그래서 `입금완료`를 단추로 뺐다) —
                여기서도 이름표가 단추로는 안 보이므로 머리말로 말해 준다. */}
            <div className="settle-unpaid-head">
                안 내신 {unpaid.length}명
                <span className="xs faint"> · 눌러서 입금완료</span>
            </div>
            <div className="settle-people settle-unpaid">
                {unpaid.map(x => (
                    <button
                        key={x.id} className="settle-chip"
                        onClick={() => togglePaid(x)}
                        aria-label={`${names[x.user_id]?.name ?? '알 수 없음'} 입금완료로 바꾸기`}
                    >
                        <Avatar name={names[x.user_id]?.name}
                                url={names[x.user_id]?.avatar_url} size="sm" />
                        <span className="truncate">{names[x.user_id]?.name ?? '알 수 없음'}</span>
                        <b>{formatWon(x.amount)}</b>
                        <span className="settle-tick" aria-hidden="true">✓</span>
                    </button>
                ))}
            </div>

            <div className="row between settle-remind">
                <span className="xs faint">
                    {lastSent ? `마지막 알림 ${timeAgo(lastSent)}` : '아직 안 보냈습니다'}
                </span>
                <button className="btn ghost sm" onClick={remind} disabled={busy}>
                    {busy ? '보내는 중…' : '입금 알림 보내기'}
                </button>
            </div>
        </div>
    );
}
