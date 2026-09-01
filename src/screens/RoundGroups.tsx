import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap, fetchPeople, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { toKstInput, fromKstInput, formatFullDate } from '../lib/format';
import {
    GROUP_SIZE, MAX_GROUPS, TEE_LABEL, roundKind,
    type Person, type Round, type RoundGroup, type Signup,
} from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import './Groups.css';

interface Loaded {
    round: Round | null;
    signups: Signup[];
    groups: RoundGroup | null;
    people: Person[];
}

/**
 * 조 편성.
 *
 * 카톡에서 `1조 누구누구` 하고 적던 것을 옮긴 자리다. 그 글은 대화에
 * 묻히고, 묻히면 당일 아침에 다시 묻게 된다.
 *
 * **끌어서 옮기지 않는다.** 손가락으로 끄는 것은 폰에서 잘 안 잡히고
 * 헤드리스로 확인할 수도 없다. 대신 사람마다 조 번호 칩을 놓고 **눌러서
 * 옮긴다** — 지금 몇 조인지가 곧 눌린 칩이라 따로 읽을 것이 없다.
 *
 * **확정자만 짠다.** 대기자는 아직 나올지 모르는 사람이라 조에 넣어 봐야
 * 하루 뒤에 다시 짜야 한다. 자리가 나서 올라오면 `미배정`으로 뜬다.
 */
export function RoundGroups() {
    const { id } = useParams<{ id: string }>();
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const nav = useNavigate();

    const { data, loading } = useAsync<Loaded>(async () => {
        const [round, signups, groups, people] = await Promise.all([
            supabase.from('rounds').select('*').eq('id', id!).maybeSingle(),
            supabase.from('signups').select('*').eq('round_id', id!).order('seq'),
            supabase.from('round_groups').select('*').eq('round_id', id!).maybeSingle(),
            fetchPeople(),
        ]);
        return {
            round: unwrap(round),
            signups: unwrap(signups) ?? [],
            groups: unwrap(groups),
            people,
        };
    }, [id]);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    const r = data?.round;
    if (!r) {
        return (
            <div className="page">
                <TopBar title="조 편성" fallback="/rounds" />
                <div className="notice danger">없는 라운드입니다.</div>
            </div>
        );
    }
    /* 라운드를 고칠 수 있는 사람과 같은 잣대다. **DB도 같게 막혀 있다**
       (`set_round_groups`) — 화면에서 감추는 것만으로는 부족하다. */
    if (!isAdmin && r.created_by !== me) {
        return (
            <div className="page">
                <TopBar title="조 편성" fallback={`/rounds/${r.id}`} />
                <div className="notice danger">모집을 연 사람과 운영진만 조를 짤 수 있습니다.</div>
            </div>
        );
    }

    return (
        <Editor
            key={r.id}
            round={r}
            signups={data!.signups}
            groups={data!.groups}
            people={data!.people}
            onDone={() => nav(`/rounds/${r.id}`, { replace: true })}
        />
    );
}

function Editor({
    round, signups, groups, people, onDone,
}: {
    round: Round;
    signups: Signup[];
    groups: RoundGroup | null;
    people: Person[];
    onDone: () => void;
}) {
    const toast = useToast();
    const confirm = useConfirm();
    const names = byId(people);
    const kind = roundKind(round);

    const confirmed = useMemo(
        () => signups.filter(s => s.state === 'confirmed'), [signups]);

    /** 사람 → 조 번호. null이면 아직 안 넣은 것이다. */
    const [grp, setGrp] = useState<Record<string, number | null>>(
        () => Object.fromEntries(confirmed.map(s => [s.user_id, s.grp ?? null])));
    /* 조 번호 → 시각. **시·분만 받는다**(`type="time"`).
       날짜는 라운드가 이미 들고 있어 조마다 또 고를 이유가 없고, 날짜까지
       받는 칸(`datetime-local`)은 `2026. 09. 12. 오전 07:30`처럼 길어
       조 제목 줄을 통째로 먹었다. 저장할 때 라운드 날짜에 붙인다. */
    const day = toKstInput(round.tee_at).slice(0, 10);   // YYYY-MM-DD (한국 날짜)
    const [tees, setTees] = useState<Record<string, string>>(
        () => Object.fromEntries(Object.entries(groups?.tees ?? {})
            .map(([k, v]) => [k, toKstInput(v).slice(11, 16)])));
    const [size, setSize] = useState(GROUP_SIZE);
    const [busy, setBusy] = useState(false);

    /* 조가 몇 개까지 보일까. **지금 쓰는 것보다 하나 더 보여 준다** —
       그 빈 조가 곧 '새 조 만들기'다. 단추를 따로 두면 누를 곳이 하나 더 는다. */
    const used = Object.values(grp).filter((g): g is number => g !== null);
    const highest = used.length ? Math.max(...used) : 0;
    const shown = Math.min(Math.max(highest + 1, 1), MAX_GROUPS);
    const numbers = Array.from({ length: shown }, (_, i) => i + 1);

    const inGroup = (n: number) => confirmed.filter(s => grp[s.user_id] === n);
    const unassigned = confirmed.filter(s => grp[s.user_id] == null);

    /** `size`명씩 신청 순서대로. 이미 짠 것이 있어도 통째로 다시 짠다. */
    const auto = () => {
        const next: Record<string, number | null> = {};
        confirmed.forEach((s, i) => { next[s.user_id] = Math.floor(i / size) + 1; });
        setGrp(next);
    };

    const clearAll = async () => {
        const ok = await confirm({
            title: '조 편성을 지울까요?',
            detail: '사람들 화면에서도 조가 사라집니다. 저장을 눌러야 반영됩니다.',
            confirmLabel: '지우기',
            danger: true,
        });
        if (!ok) return;
        setGrp(Object.fromEntries(confirmed.map(s => [s.user_id, null])));
        setTees({});
    };

    const save = async () => {
        setBusy(true);
        /* **쓰는 조의 시각만 보낸다.** 조를 넷에서 둘로 줄이면 3·4조의
           시각이 남아 있는데, 그대로 보내면 없는 조의 시각이 DB에 굳는다. */
        const keep: Record<string, string> = {};
        for (const n of numbers) {
            const hhmm = tees[n];
            if (!hhmm || inGroup(n).length === 0) continue;
            const iso = fromKstInput(`${day}T${hhmm}`);
            if (iso) keep[String(n)] = iso;
        }
        const { error } = await supabase.rpc('set_round_groups', {
            p_round: round.id, p_grps: grp, p_tees: keep,
        });
        setBusy(false);
        if (error) { toast(readableError(error), 'error'); return; }
        toast('조 편성을 저장했습니다.', 'ok');
        onDone();
    };

    return (
        <div className="page">
            <TopBar title="조 편성" fallback={`/rounds/${round.id}`} />

            <div className="card">
                <div className="section-title">
                    {round.course || round.title || '라운드'}
                </div>
                <div className="sm dim">
                    {formatFullDate(round.tee_at)} · 확정 {confirmed.length}명
                </div>
            </div>

            {confirmed.length === 0 ? (
                <div className="empty">
                    아직 확정된 참가자가 없습니다.<br />
                    신청이 들어오면 그때 조를 짜 주세요.
                </div>
            ) : (
                <>
                    {/* 대개 이 줄 하나로 끝난다. 손으로 옮기는 건 그 뒤의 손질이다. */}
                    <div className="card grp-auto">
                        <div className="row" style={{ gap: 'var(--gap-sm)' }}>
                            <label className="sm dim nowrap" htmlFor="g-size">한 조에</label>
                            <select id="g-size" className="select grp-size" value={size}
                                    onChange={e => setSize(Number(e.target.value))}>
                                {[2, 3, 4, 5].map(n => (
                                    <option key={n} value={n}>{n}명</option>
                                ))}
                            </select>
                            {/* **분홍은 `저장` 하나뿐이다.** 한 화면에 분홍이
                                둘이면 어느 쪽이 '지금 눌러야 할 것'인지가
                                흐려진다 — 이 단추는 손질을 시작하는 자리이고
                                일을 끝내는 것은 아래 `저장`이다. */}
                            <button className="btn grow" onClick={auto}>
                                자동으로 나누기
                            </button>
                        </div>
                        <p className="xs faint">
                            신청한 순서대로 나눕니다. 그다음 아래에서 손으로 옮기면 됩니다.
                        </p>
                    </div>

                    {numbers.map(n => {
                        const members = inGroup(n);
                        return (
                            <div key={n} className={`card grp-card${members.length ? '' : ' empty-grp'}`}>
                                <div className="row between">
                                    <div className="section-title">
                                        {n}조
                                        <span className="xs faint"> · {members.length}명</span>
                                    </div>
                                    {/* 조마다 티오프가 8분씩 밀리는 것이 흔하다.
                                        안 적으면 라운드의 시각 하나로 충분한 것이다.
                                        **빈 조에는 안 띄운다** — 아직 아무도 없는
                                        조의 시각을 정할 일이 없고, `--:--`만 놓여
                                        누를 수 있는 것처럼 보인다. */}
                                    {members.length > 0 && (
                                        <input
                                            type="time"
                                            className="input grp-tee"
                                            aria-label={`${n}조 ${TEE_LABEL[kind]}`}
                                            value={tees[n] ?? ''}
                                            onChange={e => setTees(
                                                { ...tees, [n]: e.target.value })}
                                        />
                                    )}
                                </div>
                                {members.length === 0 ? (
                                    <p className="xs faint">
                                        아래에서 사람을 이 조로 옮기면 채워집니다.
                                    </p>
                                ) : (
                                    <div className="grp-people">
                                        {members.map(s => (
                                            <Row
                                                key={s.id} person={names[s.user_id]}
                                                current={n} numbers={numbers}
                                                onPick={v => setGrp({ ...grp, [s.user_id]: v })}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {unassigned.length > 0 && (
                        <div className="card">
                            <div className="section-title">
                                미배정
                                <span className="xs faint"> · {unassigned.length}명</span>
                            </div>
                            <div className="grp-people">
                                {unassigned.map(s => (
                                    <Row
                                        key={s.id} person={names[s.user_id]}
                                        current={null} numbers={numbers}
                                        onPick={v => setGrp({ ...grp, [s.user_id]: v })}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="row" style={{ gap: 'var(--gap-sm)' }}>
                        <button className="btn ghost sm" onClick={clearAll}>조 편성 지우기</button>
                    </div>

                    <div className="form-actions">
                        <button className="btn primary block" onClick={save} disabled={busy}>
                            {busy ? '저장 중…' : '저장'}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

/**
 * 한 사람과, 그 사람을 옮기는 자리.
 *
 * **지금 조가 곧 눌린 칩이다** — 따로 적지 않아도 어디 있는지 보인다.
 * 눌린 칩을 다시 누르면 미배정으로 돌아간다(투표의 `한 줄에 하나만`과
 * 같은 손짓이다).
 *
 * **조가 여섯을 넘으면 고르는 칸으로 바꾼다.** 칩이 두 줄로 접히면 이름이
 * 밀려 누구를 옮기는 중인지가 안 보인다 — 320px 화면에서 실제로 그렇다.
 * 여섯까지는 칩 쪽이 훨씬 빠르므로 둘을 다 둔다.
 */
const CHIPS_UP_TO = 6;

function Row({
    person, current, numbers, onPick,
}: {
    person?: Person;
    current: number | null;
    numbers: number[];
    onPick: (v: number | null) => void;
}) {
    const name = person?.name ?? '알 수 없음';
    return (
        <div className="grp-row">
            <Avatar name={person?.name} url={person?.avatar_url} size="sm" />
            <span className="grow truncate">{name}</span>
            {numbers.length <= CHIPS_UP_TO ? (
                <div className="grp-chips">
                    {numbers.map(n => (
                        <button
                            key={n}
                            className={`grp-chip${current === n ? ' on' : ''}`}
                            aria-pressed={current === n}
                            aria-label={`${name} · ${n}조로 옮기기`}
                            onClick={() => onPick(current === n ? null : n)}
                        >
                            {n}
                        </button>
                    ))}
                </div>
            ) : (
                <select
                    className="select grp-pick"
                    aria-label={`${name}의 조`}
                    value={current ?? ''}
                    onChange={e => onPick(e.target.value === '' ? null : Number(e.target.value))}
                >
                    <option value="">미배정</option>
                    {numbers.map(n => <option key={n} value={n}>{n}조</option>)}
                </select>
            )}
        </div>
    );
}
