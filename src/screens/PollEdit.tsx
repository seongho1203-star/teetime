import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import { toKstInput, fromKstInput, dateLabel, kstDate } from '../lib/format';
import type { Poll, PollOption } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Hinted } from '../components/Hinted';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { Switch } from '../components/Switch';
import './Polls.css';

/** 화면이 들고 있는 항목 한 줄. `id`가 없으면 이번에 새로 적은 것이다. */
interface Row {
    id?: string;
    label: string;
    /** 이 항목이 받은 표 수. 지울 때 무엇이 함께 사라지는지 알려 주려고 센다. */
    votes: number;
}

interface Loaded {
    poll: Poll | null;
    options: PollOption[];
    /** 항목 id → 받은 표 수. */
    votes: Record<string, number>;
}

/**
 * 투표 만들기 / 수정. 회원 누구나 올리고, 고치는 것은 **올린 사람과 운영진**이다
 * (DB의 `polls_upd`·`poll_options_own`·`*_admin`이 같은 규칙을 다시 본다).
 *
 * **표가 하나라도 들어온 뒤에는 잠기는 것이 있다.** 아래 `Form` 참고 —
 * 고쳐 놓고 보니 사람들이 고른 뜻이 달라져 있으면 투표를 다시 해야 한다.
 */
export function PollEdit() {
    const { id } = useParams<{ id: string }>();
    const editing = Boolean(id);
    const { isAdmin, session } = useAuth();
    const nav = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();

    const { data, loading } = useAsync<Loaded>(async () => {
        if (!id) return { poll: null, options: [], votes: {} };
        const [poll, options, votes] = await Promise.all([
            supabase.from('polls').select('*').eq('id', id).maybeSingle(),
            supabase.from('poll_options').select('*').eq('poll_id', id).order('sort'),
            supabase.from('poll_votes').select('option_id').eq('poll_id', id),
        ]);
        const tally: Record<string, number> = {};
        for (const v of (unwrap(votes) ?? []) as { option_id: string }[]) {
            tally[v.option_id] = (tally[v.option_id] ?? 0) + 1;
        }
        return { poll: unwrap(poll), options: unwrap(options) ?? [], votes: tally };
    }, [id]);

    if (editing && loading) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }

    const poll = data?.poll ?? null;
    if (editing && poll && poll.created_by !== session!.user.id && !isAdmin) {
        return (
            <div className="page">
                <TopBar title="투표" fallback="/polls" />
                <div className="notice danger">올린 사람만 고칠 수 있습니다.</div>
            </div>
        );
    }

    return (
        <Form
            key={poll?.id ?? 'new'}
            poll={poll}
            rows={(data?.options ?? []).map(o => ({
                id: o.id, label: o.label, votes: data?.votes[o.id] ?? 0,
            }))}
            onDone={pid => nav(pid ? `/polls/${pid}` : '/polls', { replace: true })}
            authorId={session!.user.id}
            toast={toast}
            confirm={confirm}
        />
    );
}

/**
 * 날짜를 고르는 작은 달력.
 *
 * **브라우저의 `<input type="date">`를 안 쓴다.** 아이폰은 그 칸을 누르는
 * 순간 값을 **오늘로 정하고 `change`를 한 번 던진다** — 사용자가 고르기도
 * 전에 오늘 날짜가 항목으로 들어갔다(실제 제보). `placeholder`를 안 쓰는
 * 것과 같은 종류의 iOS 버릇이고, 짐작으로는 못 거르는 자리다.
 *
 * 직접 그리면 그 틈이 아예 없고, 덤으로 **여러 날을 눌러 담는 일**이
 * 훨씬 낫다 — 고른 날이 그대로 칠해져 보여서 몇 개를 넣었는지 세지 않아도 된다.
 *
 * 고른 날인지는 **항목 글자로 견준다**(`10월 4일 (토)`). 항목이 곧 진실이라
 * 따로 목록을 들고 있지 않아 서로 어긋날 자리가 없다.
 */
function MonthPicker({ chosen, onPick }: {
    chosen: string[];
    onPick: (ymd: string) => void;
}) {
    const today = kstDate();
    const [y0, m0] = today.split('-').map(Number);
    const [at, setAt] = useState({ y: y0, m: m0 });

    const first = new Date(at.y, at.m - 1, 1);
    const days = new Date(at.y, at.m, 0).getDate();
    const lead = first.getDay();                    // 1일이 무슨 요일인가
    const picked = new Set(chosen);

    const move = (step: number) => setAt(p => {
        const n = p.m + step;
        return { y: p.y + Math.floor((n - 1) / 12), m: ((n - 1 + 12) % 12) + 1 };
    });

    return (
        <div className="cal">
            <div className="cal-head">
                <button type="button" className="cal-move" onClick={() => move(-1)}
                        aria-label="지난 달">‹</button>
                <span className="cal-month">{at.y}년 {at.m}월</span>
                <button type="button" className="cal-move" onClick={() => move(1)}
                        aria-label="다음 달">›</button>
            </div>
            <div className="cal-grid">
                {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                    <span key={d} className="cal-dow">{d}</span>
                ))}
                {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
                {Array.from({ length: days }, (_, i) => {
                    const d = i + 1;
                    const ymd = `${at.y}-${String(at.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const on = picked.has(dateLabel(ymd));
                    return (
                        <button
                            key={d} type="button"
                            className={`cal-day${on ? ' on' : ''}${ymd === today ? ' today' : ''}`}
                            aria-pressed={on}
                            onClick={() => onPick(ymd)}
                        >{d}</button>
                    );
                })}
            </div>
        </div>
    );
}

function Form({
    poll, rows: initial, onDone, authorId, toast, confirm,
}: {
    poll: Poll | null;
    rows: Row[];
    onDone: (id: string | null) => void;
    authorId: string;
    toast: (t: string, k?: 'ok' | 'error' | 'info') => void;
    confirm: ReturnType<typeof useConfirm>;
}) {
    const editing = Boolean(poll);
    const [title, setTitle] = useState(poll?.title ?? '');
    const [body, setBody] = useState(poll?.body ?? '');
    const [rows, setRows] = useState<Row[]>(
        initial.length ? initial : [{ label: '', votes: 0 }, { label: '', votes: 0 }]);
    const [multi, setMulti] = useState(poll?.multi ?? false);
    const [anonymous, setAnonymous] = useState(poll?.anonymous ?? false);
    const [closesAt, setClosesAt] = useState(toKstInput(poll?.closes_at ?? null));
    const [saving, setSaving] = useState(false);
    /** 지울 항목들. 저장할 때 한꺼번에 없앤다. */
    const [dropped, setDropped] = useState<string[]>([]);

    /* **표가 하나라도 들어오면 잠기는 것이 둘이다.**
       - `익명`을 끄면 **비밀인 줄 알고 고른 사람들이 그대로 드러난다.**
         나중에 마음을 바꿔서 될 일이 아니다.
       - `복수 선택`을 끄면 이미 여러 개 고른 사람의 표가 그대로 남아,
         '하나만 고르는 투표'인데 두 표를 가진 사람이 생긴다.
       제목·설명·마감 시각·항목 글자는 그대로 고칠 수 있다 — 오타를 바로잡는
       것이 수정의 대부분이고, 뜻이 뒤집히지 않는다. */
    const voted = initial.reduce((n, r) => n + r.votes, 0);
    const locked = editing && voted > 0;

    const setLabel = (i: number, v: string) =>
        setRows(prev => prev.map((r, j) => (j === i ? { ...r, label: v } : r)));

    const addRow = () => setRows(prev => [...prev, { label: '', votes: 0 }]);

    /**
     * 달력에서 고른 날짜를 항목으로 넣는다.
     *
     * **모임 투표의 거의 전부가 날짜 정하기다.** `10월 4일 (토)`를 손으로
     * 치면 요일을 세어 봐야 하고 오타도 난다 — 달력에서 고르면 요일이 저절로
     * 붙는다.
     *
     * **빈 줄부터 채운다.** 새 투표는 빈 칸 두 개로 시작하는데, 그걸 두고
     * 아래에 새 줄을 붙이면 저장할 때 빈 줄이 걸러지긴 해도 **화면에는 빈
     * 칸이 남아** 안 적은 것처럼 보인다.
     */
    const addDate = (ymd: string) => {
        if (!ymd) return;
        const label = dateLabel(ymd);
        if (rows.some(r => r.label.trim() === label)) return;
        setRows(prev => {
            const at = prev.findIndex(r => !r.label.trim());
            if (at < 0) return [...prev, { label, votes: 0 }];
            return prev.map((r, i) => (i === at ? { ...r, label } : r));
        });
    };

    /**
     * 항목 한 줄을 걷어낸다.
     *
     * **두 줄까지 줄면 지우는 대신 글자만 비운다.** 항목이 둘보다 적은 투표는
     * 뜻이 없어서 `✕`는 그때 아예 잠기는데, 달력에서 껐을 때도 잠기면
     * **껐는데 날짜가 그대로 남아** 고장 난 것처럼 보인다.
     */
    const dropRow = async (i: number) => {
        const row = rows[i];
        /* **표가 있는 항목을 지우면 그 표도 함께 사라진다**(DB가 딸려 지운다).
           몇 표가 없어지는지 세어 보여 준다 — 되돌릴 수 없는 일이다. */
        if (row.id && row.votes > 0) {
            const ok = await confirm({
                title: `'${row.label}' 항목을 지울까요?`,
                detail: <><b style={{ color: 'var(--danger)' }}>이 항목에 들어온 {row.votes}표가
                    함께 사라집니다.</b><br />되돌릴 수 없습니다.</>,
                confirmLabel: '지우기',
                danger: true,
            });
            if (!ok) return;
        }
        if (row.id) setDropped(prev => [...prev, row.id!]);
        setRows(prev => prev.length <= 2
            ? prev.map((r, j) => (j === i ? { label: '', votes: 0 } : r))
            : prev.filter((_, j) => j !== i));
    };

    const removeRow = async (i: number) => {
        if (rows.length <= 2) return;
        await dropRow(i);
    };

    /** 달력에서 날짜를 눌렀을 때. 없으면 넣고, 있으면 뺀다. */
    const toggleDate = async (ymd: string) => {
        const at = rows.findIndex(r => r.label.trim() === dateLabel(ymd));
        if (at < 0) addDate(ymd);
        else await dropRow(at);
    };

    const save = async () => {
        const t = title.trim();
        const labels = rows.map(r => r.label.trim());
        const kept = rows.filter((_, i) => labels[i]);
        if (!t) { toast('제목을 적어 주세요.', 'error'); return; }
        if (kept.length < 2) { toast('항목을 두 개 이상 적어 주세요.', 'error'); return; }
        const names = kept.map(r => r.label.trim());
        if (new Set(names).size !== names.length) {
            toast('같은 항목이 두 번 있습니다.', 'error'); return;
        }

        setSaving(true);
        const fields = {
            title: t,
            body: body.trim(),
            multi,
            anonymous,
            closes_at: fromKstInput(closesAt),
        };

        /* ── 고치기 ──
           `polls`를 고치고, 항목은 **셋으로 나눠** 처리한다 — 글자가 바뀐 것,
           새로 적은 것, 지운 것. 순서(`sort`)는 화면에 보이는 대로 다시 매긴다
           (가운데를 지우면 번호에 구멍이 나기 때문이다). */
        if (poll) {
            const { error: err } = await supabase.from('polls')
                .update(fields).eq('id', poll.id);
            if (err) { setSaving(false); toast(readableError(err), 'error'); return; }

            if (dropped.length) {
                const { error: delErr } = await supabase.from('poll_options')
                    .delete().in('id', dropped);
                if (delErr) { setSaving(false); toast(readableError(delErr), 'error'); return; }
            }

            for (let i = 0; i < kept.length; i++) {
                const r = kept[i];
                const label = r.label.trim();
                if (r.id) {
                    const before = initial.find(o => o.id === r.id);
                    // 안 바뀐 줄에는 쓰기를 안 보낸다.
                    if (before && before.label === label && initial.indexOf(before) === i) continue;
                    const { error: upErr } = await supabase.from('poll_options')
                        .update({ label, sort: i }).eq('id', r.id);
                    if (upErr) { setSaving(false); toast(readableError(upErr), 'error'); return; }
                } else {
                    const { error: insErr } = await supabase.from('poll_options')
                        .insert({ poll_id: poll.id, label, sort: i });
                    if (insErr) { setSaving(false); toast(readableError(insErr), 'error'); return; }
                }
            }
            setSaving(false);
            toast('고쳤습니다.', 'ok');
            onDone(poll.id);
            return;
        }

        /* ── 새로 올리기 ── */
        const { data, error } = await supabase.from('polls')
            .insert({ ...fields, created_by: authorId }).select('id').single();
        if (error || !data) {
            setSaving(false);
            toast(readableError(error), 'error');
            return;
        }
        const newId = (data as { id: string }).id;
        const { error: optErr } = await supabase.from('poll_options').insert(
            kept.map((r, sort) => ({ poll_id: newId, label: r.label.trim(), sort }))
        );
        setSaving(false);
        if (optErr) {
            // 항목이 없는 투표는 쓸모가 없다. 껍데기를 남기지 않고 되돌린다.
            await supabase.from('polls').delete().eq('id', newId);
            toast(readableError(optErr), 'error');
            return;
        }
        toast('투표를 올렸습니다.', 'ok');
        onDone(null);
    };

    return (
        <div className="page">
            <TopBar title={editing ? '투표 수정' : '투표 만들기'}
                    fallback={poll ? `/polls/${poll.id}` : '/polls'} />

            <div className="card">
                <div className="field">
                    <label htmlFor="v-title">무엇을 물어볼까요?</label>
                    <Hinted hint="예) 9월 정기 라운드 날짜" empty={!title}>
                        <input id="v-title" className="input" value={title}
                               onChange={e => setTitle(e.target.value)} maxLength={80} />
                    </Hinted>
                </div>
                <div className="field">
                    <label htmlFor="v-body">설명 <span className="faint">(선택)</span></label>
                    <textarea id="v-body" className="textarea" value={body}
                              onChange={e => setBody(e.target.value)}
                              style={{ minHeight: 70 }} maxLength={500} />
                </div>
            </div>

            <div className="card">
                <div className="section-title">항목</div>
                {rows.map((r, i) => (
                    <div className="option-row" key={r.id ?? `new-${i}`}>
                        <Hinted hint={`항목 ${i + 1}`} empty={!r.label}>
                            <input
                                className="input" value={r.label}
                                onChange={e => setLabel(i, e.target.value)}
                                maxLength={60}
                                aria-label={`항목 ${i + 1}`}
                            />
                        </Hinted>
                        {/* 몇 표가 들어와 있는지 옆에 적어 둔다 — 지우기 전에
                            무엇이 걸려 있는지 보이는 편이 낫다. */}
                        {r.votes > 0 && <span className="xs faint option-votes">{r.votes}표</span>}
                        <button
                            className="btn ghost sm"
                            onClick={() => removeRow(i)}
                            disabled={rows.length <= 2}
                            aria-label={`항목 ${i + 1} 지우기`}
                        >✕</button>
                    </div>
                ))}
                <button className="btn ghost block sm" onClick={addRow}>+ 항목 추가</button>

                {/* **날짜는 이 달력에서 고른다.** 누른 날이 그 자리에서
                    `10월 4일 (토)` 항목이 되고, 다시 누르면 빠진다.
                    `추가` 단추를 따로 두지 않은 것은 한 번 더 누르게 하지
                    않으려는 것이다 — 조 편성 조건을 누르면 바로 나뉘는 것과 같다. */}
                <div className="field poll-date">
                    <span className="poll-date-title">📅 날짜로 항목 넣기</span>
                    <MonthPicker
                        chosen={rows.map(r => r.label.trim()).filter(Boolean)}
                        onPick={toggleDate}
                    />
                    <span className="xs faint">
                        누르면 바로 항목이 됩니다. 다시 누르면 빠집니다.
                    </span>
                </div>
                {locked && (
                    <p className="xs faint">
                        항목 글자를 고치면 이미 그 항목을 고른 분들의 표가 그대로 따라갑니다.
                    </p>
                )}
            </div>

            <div className="card">
                <div className="switch-row">
                    <div className="grow">
                        <div className="switch-label">복수 선택</div>
                        <div className="switch-desc">
                            {locked ? '표가 들어와 바꿀 수 없습니다' : '되는 날짜를 여러 개 고르게 할 때'}
                        </div>
                    </div>
                    <Switch label="복수 선택" on={multi} onChange={setMulti} disabled={locked} />
                </div>
                <div className="switch-row">
                    <div className="grow">
                        <div className="switch-label">익명</div>
                        <div className="switch-desc">
                            {locked ? '표가 들어와 바꿀 수 없습니다' : '누가 무엇을 골랐는지 숨깁니다'}
                        </div>
                    </div>
                    <Switch label="익명" on={anonymous} onChange={setAnonymous} disabled={locked} />
                </div>
                <div className="field" style={{ marginTop: 'var(--gap-xs)' }}>
                    <label htmlFor="v-close">마감 시각 <span className="faint">(선택)</span></label>
                    <input id="v-close" className="input" type="datetime-local"
                           value={closesAt} onChange={e => setClosesAt(e.target.value)} />
                </div>
            </div>

            <div className="form-actions">
                <button className="btn primary block" onClick={save} disabled={saving}>
                    {saving ? '저장 중…' : editing ? '저장' : '투표 올리기'}
                </button>
            </div>
        </div>
    );
}
