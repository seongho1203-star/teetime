import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { formatWon, timeAgo } from '../lib/format';
import { readableError } from '../lib/errors';
import { canSettle, FIND_AT, type Person, type Settlement, type SettlementShare } from '../lib/types';
import { Avatar } from './Avatar';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';
import './Settlement.css';

/**
 * 라운드 정산.
 *
 * **1/N은 화면이 계산하고, DB에는 사람마다 낼 돈을 그대로 적는다.**
 * 중간에 들어온 사람은 금액이 다르기 때문이다 — "신성호 1만원, 나머지
 * 2만원씩". 계산식을 DB에 두면 그런 예외를 담을 자리가 없다.
 *
 * 만드는 것은 **총무와 운영진**만 한다(`can_settle`). 총무라는 자리를
 * 둔 이유가 이것이다. 읽기는 회원 모두 — 자기 몫이 얼마인지 봐야 한다.
 *
 * 만들면 **고른 사람에게만 알림이 간다.** 사람마다 금액이 달라서
 * 발송기가 각자의 몫을 실어 보낸다(`settlement_shares` 웹훅).
 */

/** 남는 원 단위를 어떻게 할지. 1/N이 딱 안 떨어지면 마지막 사람이 더 낸다. */
function splitEvenly(total: number, ids: string[], fixed: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    // 금액을 따로 적어 둔 사람(예외)은 그 값을 쓰고, 총액에서 뺀다.
    const free = ids.filter(id => fixed[id] == null);
    const used = ids.reduce((sum, id) => sum + (fixed[id] ?? 0), 0);
    const rest = Math.max(0, total - used);

    for (const id of ids) if (fixed[id] != null) out[id] = fixed[id];
    if (!free.length) return out;

    // 10원 단위로 맞춘다 — 1원 단위까지 나누면 계좌이체가 지저분하다.
    const each = Math.floor(rest / free.length / 10) * 10;
    free.forEach(id => { out[id] = each; });
    // 나누고 남은 것은 **맨 앞 사람이 떠안는다.** 아무도 안 내는 돈이
    // 생기면 총액이 안 맞는다.
    const left = rest - each * free.length;
    if (left > 0) out[free[0]] += left;
    return out;
}

export function Settlements({
    roundId, people, joined, list, shares, onChange,
}: {
    roundId: string;
    /** 고를 수 있는 사람들. 대기·추방은 빠진 회원 명단이다. */
    people: Person[];
    /**
     * 이 라운드에 **확정으로 참가한 사람**의 id.
     *
     * 정산은 대개 이 사람들끼리 하지만 **거기서 끝나지 않는다** —
     * 라운드는 안 하고 뒷풀이만 온 사람이 있다. 그래서 참가자를 앞에
     * 세워 두고, 나머지 회원은 `그 외`로 접어 두었다가 필요할 때 편다.
     * 목록을 참가자로 **좁히지는 말 것** — 그러면 뒷풀이만 온 사람을
     * 넣을 길이 아예 없어진다.
     */
    joined: string[];
    list: Settlement[];
    shares: SettlementShare[];
    onChange: () => void;
}) {
    const { profile, session } = useAuth();
    const me = session!.user.id;
    const toast = useToast();
    const confirm = useConfirm();
    /* **만드는 것은 회원 누구나**(사용자가 정한 것이다) — 라운드를 여는 사람이
       제각각인데 총무 한 사람이 100명분 돈을 다 걷는 것은 무리다.
       **고치고 지우는 것은 만든 사람과 총무·운영진뿐**이라, 그 잣대는 정산
       한 건마다 따로 본다(`mayEditOne`). DB도 같게 막혀 있다. */
    const canAll = canSettle(profile?.role);
    const mayEditOne = (s: Settlement) => canAll || s.created_by === me;

    const [open, setOpen] = useState(false);

    return (
        <div className="card">
            <div className="row between">
                <div className="section-title">정산 {list.length || ''}</div>
                <button className="btn ghost sm" onClick={() => setOpen(o => !o)}>
                    {open ? '닫기' : '＋ 정산'}
                </button>
            </div>

            {open && (
                <SettlementForm
                    roundId={roundId} people={people} joined={joined}
                    onDone={() => { setOpen(false); onChange(); }}
                />
            )}

            {!list.length && !open && (
                <p className="xs faint">아직 정산이 없습니다.</p>
            )}

            {list.map(s => (
                <SettlementCard
                    key={s.id} settlement={s} people={people}
                    shares={shares.filter(x => x.settlement_id === s.id)}
                    me={me} mayEdit={mayEditOne(s)} onChange={onChange}
                    toast={toast} confirm={confirm}
                />
            ))}
        </div>
    );
}

/** 정산 한 건 보기. 내 몫이 맨 위에 온다 — 제일 궁금한 값이다. */
function SettlementCard({
    settlement: s, people, shares, me, mayEdit, onChange, toast, confirm,
}: {
    settlement: Settlement;
    people: Person[];
    shares: SettlementShare[];
    me: string;
    mayEdit: boolean;
    onChange: () => void;
    toast: ReturnType<typeof useToast>;
    confirm: ReturnType<typeof useConfirm>;
}) {
    const names = useMemo(
        () => Object.fromEntries(people.map(p => [p.id, p])), [people]);
    const mine = shares.find(x => x.user_id === me);
    const paidCount = shares.filter(x => x.paid).length;

    const togglePaid = async (share: SettlementShare) => {
        const { error } = await supabase.from('settlement_shares')
            .update({ paid: !share.paid }).eq('id', share.id);
        if (error) { toast(readableError(error), 'error'); return; }
        onChange();
    };

    const remove = async () => {
        const ok = await confirm({
            title: '이 정산을 지울까요?',
            detail: <>{s.title}<br />
                <b style={{ color: 'var(--danger)' }}>{shares.length}명의 몫이 함께 사라집니다.</b></>,
            confirmLabel: '지우기', danger: true,
        });
        if (!ok) return;
        const { error } = await supabase.from('settlements').delete().eq('id', s.id);
        if (error) { toast(readableError(error), 'error'); return; }
        toast('지웠습니다.');
        onChange();
    };

    return (
        <div className="settle">
            <div className="row between">
                <span className="b">{s.title}</span>
                <span className="xs faint">{timeAgo(s.created_at)}</span>
            </div>
            {/* **누가 걷는지 적는다.** 회원 누구나 정산을 만들게 열면서
                한 라운드에 여러 사람의 정산이 붙을 수 있게 됐다 — 계좌만
                덩그러니 있으면 그게 누구 것인지 물어보러 가야 한다. */}
            {s.created_by && (
                <div className="xs faint">
                    {names[s.created_by]?.name ?? '알 수 없음'}님이 걷습니다
                </div>
            )}

            {s.body && <p className="sm dim settle-body">{s.body}</p>}

            {/* **낼 돈을 맨 위에 크게.** 목록을 훑어 내 이름을 찾게 하지 않는다.
                **금액과 단추를 갈라 놓는다.** 예전에는 줄 하나가 통째로
                눌리는 단추였는데, 단추처럼 안 생겨서 **눌리는 줄인지조차
                몰랐다**(사용자 제보). 금액은 읽는 곳, 단추는 누르는 곳으로
                나누고 단추는 단추답게 그린다. */}
            {mine && (
                <div className={`settle-mine${mine.paid ? ' paid' : ''}`}>
                    <div className="row between settle-mine-top">
                        <span className="settle-mine-label">입금금액</span>
                        <b className="settle-mine-won">{formatWon(mine.amount)}</b>
                    </div>
                    <button className={`btn block settle-done${mine.paid ? ' on' : ''}`}
                            onClick={() => togglePaid(mine)}>
                        {mine.paid ? '입금완료 ✓' : '입금완료'}
                    </button>
                    {mine.paid && (
                        <p className="xs faint settle-undo">
                            잘못 누르셨으면 한 번 더 누르면 취소됩니다.
                        </p>
                    )}
                </div>
            )}

            {(s.bank || s.account) && (
                <div className="settle-account">
                    {/* **계좌번호는 자르지 않는다.** `...`으로 끝나면 옮겨 적을 수도,
                        복사된 것이 맞는지 확인할 수도 없다 — 돈이 가는 자리다.
                        좁은 화면(320px)에서 실제로 `국민 123456-78-90...`이 됐다.
                        은행 이름을 윗줄로 올려 번호가 한 줄을 통째로 쓰게 했다 —
                        한 줄에 이어 붙이면 번호 가운데서 끊겨 옮겨 적기 나쁘다. */}
                    <span className="grow settle-account-no">
                        {s.bank && <span className="settle-bank">{s.bank}</span>}
                        {s.account}
                    </span>
                    <button className="btn ghost sm" onClick={() => {
                        navigator.clipboard?.writeText(`${s.bank} ${s.account}`.trim())
                            .then(() => toast('계좌를 복사했습니다.', 'ok'))
                            .catch(() => toast('복사가 안 됩니다. 길게 눌러 주세요.', 'error'));
                    }}>복사</button>
                </div>
            )}

            <div className="settle-people">
                {shares.map(x => (
                    <span key={x.id} className={`settle-chip${x.paid ? ' paid' : ''}`}>
                        <Avatar name={names[x.user_id]?.name} url={names[x.user_id]?.avatar_url} size="sm" />
                        <span className="truncate">{names[x.user_id]?.name ?? '알 수 없음'}</span>
                        <b>{formatWon(x.amount)}</b>
                    </span>
                ))}
            </div>

            <div className="row between">
                <span className="xs faint">
                    총 {formatWon(s.total)} · {paidCount}/{shares.length}명 보냄
                </span>
                {mayEdit && (
                    <button className="btn danger sm" onClick={remove}>지우기</button>
                )}
            </div>
        </div>
    );
}

/**
 * `그 외`가 이보다 많으면 이름으로 찾게 한다.
 *
 * 열두 명까지는 네 줄이라 눈으로 훑을 만하다. 그 위로는 늘어놓는 것이
 * 오히려 방해가 된다 — 마흔여섯 명을 폈더니 목록만 602px였다.
 */

/** 고르는 알약 하나. 참가자와 `그 외`가 같이 쓴다 — 모양이 갈리면 안 된다. */
function PersonPill({ person, on, onClick }: {
    person: Person; on: boolean; onClick: () => void;
}) {
    return (
        <button type="button" className={`settle-pill${on ? ' on' : ''}`} onClick={onClick}>
            <Avatar name={person.name} url={person.avatar_url} size="sm" />
            <span className="truncate">{person.name}</span>
        </button>
    );
}

/** 정산 만들기. 사람을 고르면 1/N이 바로 보이고, 예외는 금액을 직접 적는다. */
function SettlementForm({
    roundId, people, joined, onDone,
}: {
    roundId: string;
    people: Person[];
    joined: string[];
    onDone: () => void;
}) {
    const { session } = useAuth();
    const toast = useToast();

    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [bank, setBank] = useState('');
    const [account, setAccount] = useState('');
    const [total, setTotal] = useState('');
    const [picked, setPicked] = useState<string[]>([]);
    /** 예외로 금액을 못박은 사람. 비면 1/N을 따른다. */
    const [fixed, setFixed] = useState<Record<string, number>>({});
    const [saving, setSaving] = useState(false);
    /** `그 외`를 펼쳤는가. 평소에는 접어 둔다 — 대개 참가자끼리 끝난다. */
    const [showRest, setShowRest] = useState(false);
    /** `그 외`에서 이름으로 찾기. 사람이 많을 때만 쓴다. */
    const [find, setFind] = useState('');

    /* 참가자와 그 외로 가른다. **참가자 순서는 명단 순서를 따른다** —
       고를 때마다 자리가 움직이면 누르기 어렵다. */
    const [players, rest] = useMemo(() => {
        const set = new Set(joined);
        return [people.filter(p => set.has(p.id)), people.filter(p => !set.has(p.id))];
    }, [people, joined]);

    /* 뒷풀이만 온 사람을 이미 골라 뒀다면 접어 버리면 안 된다 —
       고른 것이 화면에서 사라져 지운 것처럼 보인다. */
    const restOpen = showRest || rest.some(p => picked.includes(p.id));

    /* **쉰 명이면 이름을 늘어놓을 수가 없다.** 46명을 다 펴 봤더니 그
       목록만 602px로 화면의 3/4를 먹었고, 한 명 찾으려면 눈으로 다 훑어야
       했다. 그래서 사람이 많으면 **찾아서 고른다** — 적을 때는 예전처럼
       그냥 다 보여 준다(칸이 하나 더 생겨 봐야 성가시기만 하다). */
    const bigList = rest.length > FIND_AT;
    const shownRest = useMemo(() => {
        if (!bigList) return rest;
        const q = find.replace(/\s/g, '').toLowerCase();
        // 고른 사람은 검색어와 상관없이 남긴다 — 사라지면 뺀 것처럼 보인다.
        return rest.filter(p => picked.includes(p.id)
            || (!!q && String(p.name ?? '').replace(/\s/g, '').toLowerCase().includes(q)));
    }, [bigList, rest, find, picked]);

    const totalNum = Number(total.replace(/[^0-9]/g, '')) || 0;
    const amounts = useMemo(
        () => splitEvenly(totalNum, picked, fixed), [totalNum, picked, fixed]);

    const toggle = (id: string) => {
        setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
        // 뺀 사람의 예외 금액도 같이 지운다. 안 그러면 다시 넣을 때 살아난다.
        setFixed(prev => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
        });
    };

    const save = async () => {
        if (!title.trim()) { toast('정산 제목을 적어 주세요.', 'error'); return; }
        if (!picked.length) { toast('정산할 사람을 골라 주세요.', 'error'); return; }
        if (totalNum <= 0) { toast('총금액을 적어 주세요.', 'error'); return; }

        setSaving(true);
        try {
            const { data: row, error } = await supabase.from('settlements')
                .insert({
                    round_id: roundId, title: title.trim(), body: body.trim(),
                    bank: bank.trim(), account: account.trim(), total: totalNum,
                    created_by: session!.user.id,
                })
                .select('*').single();
            if (error) throw error;

            /* 몫은 **정산을 만든 뒤에** 넣는다. 이 행이 들어갈 때 발송기가
               사람마다 자기 금액을 실어 알림을 보낸다. */
            const { error: shareErr } = await supabase.from('settlement_shares')
                .insert(picked.map(id => ({
                    settlement_id: (row as Settlement).id,
                    user_id: id,
                    amount: amounts[id] ?? 0,
                })));
            if (shareErr) throw shareErr;

            toast(`${picked.length}명에게 정산을 보냈습니다.`, 'ok');
            onDone();
        } catch (e) {
            toast(readableError(e), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="settle-form">
            <div className="field">
                <label htmlFor="s-title">정산 제목</label>
                {/* **예시 글씨를 넣지 않는다**(사용자 요청). 칸 이름이 이미
                    무엇을 적는 자리인지 말해 주는데, 흐린 예시까지 다섯 칸에
                    깔리면 다 적은 화면인지 빈 화면인지 헷갈린다. */}
                <input id="s-title" className="input" value={title} maxLength={60}
                       onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="field">
                <label htmlFor="s-body">상세 내용 <span className="faint">(선택)</span></label>
                <textarea id="s-body" className="textarea" value={body} rows={2} maxLength={300}
                          onChange={e => setBody(e.target.value)} />
            </div>
            <div className="row" style={{ gap: 'var(--gap-sm)' }}>
                <div className="field grow">
                    <label htmlFor="s-bank">입금 은행</label>
                    <input id="s-bank" className="input" value={bank} maxLength={20}
                           onChange={e => setBank(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 2 }}>
                    <label htmlFor="s-acc">계좌번호</label>
                    <input id="s-acc" className="input" value={account} maxLength={40}
                           onChange={e => setAccount(e.target.value)} inputMode="numeric" />
                </div>
            </div>
            <div className="field">
                <label htmlFor="s-total">총금액</label>
                <input id="s-total" className="input" value={total} inputMode="numeric"
                       onChange={e => setTotal(e.target.value)} />
            </div>

            {/* **참가자를 앞에 세우고 나머지는 접어 둔다.** 대개 참가자끼리
                끝나지만, 라운드는 안 하고 뒷풀이만 온 사람이 있어 목록을
                참가자로 좁힐 수는 없다. */}
            <div className="field">
                <label>정산할 사람 <span className="faint">({picked.length}명)</span></label>

                {players.length > 0 && (
                    <>
                        <div className="row between settle-group">
                            <span className="xs faint">참가자 {players.length}명</span>
                            <button type="button" className="btn ghost sm"
                                    onClick={() => setPicked(prev => {
                                        const ids = players.map(p => p.id);
                                        const all = ids.every(id => prev.includes(id));
                                        return all
                                            ? prev.filter(id => !ids.includes(id))
                                            : [...new Set([...prev, ...ids])];
                                    })}>
                                {players.every(p => picked.includes(p.id)) ? '모두 빼기' : '모두 넣기'}
                            </button>
                        </div>
                        <div className="settle-pick">
                            {players.map(p => (
                                <PersonPill key={p.id} person={p}
                                            on={picked.includes(p.id)}
                                            onClick={() => toggle(p.id)} />
                            ))}
                        </div>
                    </>
                )}

                {rest.length > 0 && (restOpen ? (
                    <>
                        <div className="settle-group">
                            <span className="xs faint">
                                그 외 {rest.length}명 · 뒷풀이만 오신 분을 여기서 넣으세요
                            </span>
                        </div>
                        {/* **안내 글씨(placeholder)를 안 쓴다.** 한글을 치는
                            칸이라 iOS가 조합 중인 글자를 '내용 없음'으로 봐서
                            첫 글자에 한 번 번쩍인다 — 대화·댓글 칸에서 겪은
                            그것이다. 라벨로 세워 두면 그럴 틈이 없다. */}
                        {bigList && (
                            <div className="field settle-find">
                                <label htmlFor="s-find">이름으로 찾기</label>
                                <input id="s-find" className="input" value={find}
                                       onChange={e => setFind(e.target.value)} />
                            </div>
                        )}
                        {shownRest.length > 0 && (
                            <div className="settle-pick">
                                {shownRest.map(p => (
                                    <PersonPill key={p.id} person={p}
                                                on={picked.includes(p.id)}
                                                onClick={() => toggle(p.id)} />
                                ))}
                            </div>
                        )}
                        {bigList && !shownRest.length && (
                            <p className="xs faint settle-find-hint">
                                {find.trim()
                                    ? `'${find.trim()}' 님을 못 찾았습니다.`
                                    : '이름을 적으면 찾아 드립니다.'}
                            </p>
                        )}
                    </>
                ) : (
                    <button type="button" className="btn ghost sm settle-more"
                            onClick={() => setShowRest(true)}>
                        ＋ 참가자 외 다른 사람 추가
                    </button>
                ))}
            </div>

            {/* **1/N을 바로 보여 준다.** 사람마다 줄이 있고, 금액을 고쳐 적으면
                그 사람만 예외가 된다 — 나머지가 남은 돈을 다시 나눠 갖는다. */}
            {picked.length > 0 && (
                <div className="field">
                    <label>
                        1/N <span className="faint">— 고쳐 적으면 그 사람만 예외가 됩니다</span>
                    </label>
                    <div className="settle-rows">
                        {picked.map(id => {
                            const p = people.find(x => x.id === id);
                            return (
                                <div className="settle-row" key={id}>
                                    <span className="grow truncate">{p?.name ?? '알 수 없음'}</span>
                                    <input
                                        className="input settle-amount" inputMode="numeric"
                                        value={String(amounts[id] ?? 0)}
                                        onChange={e => {
                                            const v = Number(e.target.value.replace(/[^0-9]/g, ''));
                                            setFixed(prev => ({ ...prev, [id]: v || 0 }));
                                        }}
                                    />
                                    {fixed[id] != null && (
                                        <button className="btn ghost sm" onClick={() => setFixed(prev => {
                                            const next = { ...prev };
                                            delete next[id];
                                            return next;
                                        })}>1/N로</button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <span className="xs faint">
                        합계 {formatWon(Object.values(amounts).reduce((a, b) => a + b, 0))}
                        {' / 총 '}{formatWon(totalNum)}
                    </span>
                </div>
            )}

            <button className="btn primary block" onClick={save} disabled={saving}>
                {saving ? '보내는 중…' : '정산 보내기'}
            </button>
        </div>
    );
}
