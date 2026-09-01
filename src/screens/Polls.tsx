import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchPeople, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, timeAgo } from '../lib/format';
import {
    personLabel, pollClosed,
    type Poll, type PollOption, type PollVoteLite, type Person,
} from '../lib/types';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { useConfirm } from '../components/Confirm';
import './Polls.css';

interface Loaded {
    polls: Poll[];
    options: PollOption[];
    votes: PollVoteLite[];
    people: Person[];
}

/**
 * 목록이 받아 오는 양의 한도.
 *
 * **투표 한 건이 곧 표 수백 줄이다.** 100명 모임에서 날짜를 고르면 예순 명이
 * 두 개씩 골라 120줄이 된다. 예전에는 `poll_votes`를 통째로 받았고, 한 해치가
 * 쌓이자 **목록 한 번 여는 데 546KB**가 나갔다 — 무료 통신량(월 5GB)을 이
 * 화면 하나가 다 먹는다.
 *
 * 그래서 **투표 수를 묶고**, 항목·표는 그 투표에 딸려서만 오게 했다.
 * 끝난 투표를 목록에서 훑는 일은 거의 없다(결과는 눌러서 상세에서 본다).
 * 아직 안 끝난 것은 놓치면 안 되므로 넉넉히 둔다.
 */
const LIVE_POLLS = 20;
const DONE_POLLS = 5;

/** 투표 하나에 딸려 오는 항목과 표. */
type PollRow = Poll & { poll_options?: PollOption[]; poll_votes?: PollVoteLite[] };

export function Polls() {

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        /* **항목과 표를 딸려 받는다**(`poll_options(*)` · `poll_votes(...)`).
           따로 부르면 지난 투표 것까지 다 온다 — 홈이 신청 기록을 라운드에
           딸려 받는 것과 같은 이유다.
           표는 세 칸만 받는다: 화면이 보는 것은 **어느 투표의 · 어느 항목을 ·
           누가** 골랐나뿐이다.

           **진행중과 마감을 따로 부른다.** 한 번에 최근 것부터 받으면, 끝난
           투표가 여러 개 쌓인 주에 **아직 안 끝난 투표가 목록에서 밀려난다.**
           `closed=false`인데 마감 시각이 지난 것은 아래에서 `pollClosed()`가
           다시 갈라 `마감된 투표` 칸으로 보낸다 — 그래서 두 조회의 잣대가
           화면의 잣대와 달라도 괜찮다. */
        const cols = '*, poll_options(*), poll_votes(poll_id, option_id, user_id)';
        const [live, done, people] = await Promise.all([
            supabase.from('polls').select(cols).eq('closed', false)
                    .order('created_at', { ascending: false }).limit(LIVE_POLLS),
            supabase.from('polls').select(cols).eq('closed', true)
                    .order('created_at', { ascending: false }).limit(DONE_POLLS),
            fetchPeople(),
        ]);

        /* 화면 코드는 예전처럼 평평한 배열을 본다. `types.ts`의 `Database`에
           표 사이의 관계가 안 적혀 있어 타입은 `unknown`을 거쳐 바꾼다 —
           실행에는 문제가 없다(홈도 같은 방식이다). */
        const rows = [...(unwrap(live) ?? []), ...(unwrap(done) ?? [])] as unknown as PollRow[];
        rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

        return {
            polls: rows.map(({ poll_options: _o, poll_votes: _v, ...p }) => p as Poll),
            // 딸려 온 항목은 순서가 없다. `sort`는 여기서 매긴다.
            options: rows.flatMap(r => r.poll_options ?? []).sort((a, b) => a.sort - b.sort),
            votes: rows.flatMap(r => r.poll_votes ?? []),
            people,
        };
    }, [], 'polls');

    useRealtime(['poll_votes', 'polls', 'poll_options'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (error) {
        return <div className="page"><div className="notice danger">{error}</div></div>;
    }

    const polls = data?.polls ?? [];
    const live = polls.filter(p => !pollClosed(p));
    const done = polls.filter(p => pollClosed(p));

    return (
        <div className="page">
            <div className="page-head">
                <h1 className="page-title">투표</h1>
                <Link to="/polls/new" className="btn primary sm">+ 투표 만들기</Link>
            </div>

            {polls.length === 0 && (
                <div className="empty">
                    아직 투표가 없습니다.
                    <br />날짜 정하기, 골프장 고르기 같은 걸 올려 보세요.
                </div>
            )}

            {live.map(p => (
                <PollCard key={p.id} poll={p} data={data!} onChange={reload} />
            ))}

            {done.length > 0 && (
                <>
                    <div className="section-title" style={{ marginTop: 'var(--gap)' }}>
                        마감된 투표
                    </div>
                    {done.map(p => (
                        <PollCard key={p.id} poll={p} data={data!} onChange={reload} />
                    ))}
                </>
            )}
        </div>
    );
}

/** 목록 카드에서 이름을 몇까지 적고 나머지는 세어 줄지. 한 줄에 들어갈 만큼만. */
const NAMES_SHOWN = 3;

/**
 * `이관교, 김지명, 박승수 외 12명`.
 *
 * 이 줄은 한 줄로 잘리는데(`.truncate`), 그냥 두면 `정우…`에서 끝나
 * **몇 명인지도 모른다.** 우리 모임이 서른 명 남짓이라 실제로 그렇게 된다.
 * 앞의 몇만 적고 나머지는 수로 알려 준다.
 * **전부 보고 싶으면 제목을 눌러 상세로 간다**(`PollDetail`).
 */
function votersLine(list: string[]): string {
    return list.length <= NAMES_SHOWN
        ? list.join(', ')
        : `${list.slice(0, NAMES_SHOWN).join(', ')} 외 ${list.length - NAMES_SHOWN}명`;
}

/**
 * 항목 목록 + 표 던지기. **목록 카드와 상세가 같이 쓴다.**
 *
 * 다른 것은 이름을 어디까지 적느냐뿐이다 — 카드는 한 줄로 접고(`외 N명`),
 * 상세(`full`)는 다 편다. 투표하는 길이 두 벌이 되면 한쪽만 고치는 일이
 * 생기므로 여기 하나로 둔다.
 */
export function PollOptions({
    poll, options, votes, names, me, onChange, hideVoters,
}: {
    poll: Poll;
    options: PollOption[];
    votes: PollVoteLite[];
    names: Record<string, Person>;
    me: string;
    onChange: () => void;
    /** 상세에서는 이름을 여기 안 적는다 — 아래 `현황` 탭이 그 일을 한다. */
    hideVoters?: boolean;
}) {
    const toast = useToast();
    const closed = pollClosed(poll);
    const voters = new Set(votes.map(v => v.user_id)).size;
    const mine = new Set(votes.filter(v => v.user_id === me).map(v => v.option_id));
    /* **누가 골랐는지 줄은 항목마다 다 있거나 다 없어야 한다.**
       표를 받은 항목에만 붙이면 그 줄만 키가 커져 칸들이 들쭉날쭉해진다.
       한 표라도 들어온 뒤에 모든 항목에 자리를 잡아 준다 — 아무도 안
       골랐을 때까지 빈 줄을 깔면 새 투표가 괜히 길어진다. */
    const showVoters = !poll.anonymous && votes.length > 0 && !hideVoters;

    const pick = async (optionId: string) => {
        if (closed) return;
        const err = mine.has(optionId)
            ? (await supabase.rpc('retract_vote', { p_option: optionId })).error
            : (await supabase.rpc('cast_vote', { p_option: optionId })).error;
        if (err) { toast(readableError(err), 'error'); return; }
        onChange();
    };

    return (
        <div className="poll-options">
            {options.map(o => {
                const on = votes.filter(v => v.option_id === o.id);
                const pct = voters ? Math.round((on.length / voters) * 100) : 0;
                const chosen = mine.has(o.id);
                const who = on.map(v => personLabel(names[v.user_id]) || '?');
                return (
                    <button
                        key={o.id}
                        className={`poll-option${chosen ? ' chosen' : ''}`}
                        onClick={() => pick(o.id)}
                        disabled={closed}
                    >
                        {/* 막대는 배경으로 깔린다 — 글자를 밀지 않는다. */}
                        <span className="poll-bar" style={{ width: `${pct}%` }} aria-hidden="true" />
                        <span className="poll-option-body">
                            <span className="poll-check" aria-hidden="true">{chosen ? '✓' : ''}</span>
                            <span className="grow truncate">{o.label}</span>
                            <span className="poll-count">{on.length}</span>
                        </span>
                        {showVoters && (
                            <span className="poll-voters truncate">{votersLine(who)}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

function PollCard({
    poll, data, onChange,
}: {
    poll: Poll;
    data: Loaded;
    onChange: () => void;
}) {
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const toast = useToast();
    const confirm = useConfirm();

    const options = data.options.filter(o => o.poll_id === poll.id);
    const votes = data.votes.filter(v => v.poll_id === poll.id);
    const names = byId(data.people);
    const closed = pollClosed(poll);

    /* 투표한 사람 수 (복수 선택이면 표 수와 다르다).
       **지금 회원인 사람만 센다** — 표를 던진 뒤 추방되거나 대기로 내려간
       사람의 표가 남아 있어, 그냥 세면 상세의 `전체 N명`·`미참여`와 합이
       안 맞는다(실제로 `91명 참여 · 전체 98명 · 미참여 9`가 나왔다). */
    const members = new Set(data.people
        .filter(p => p.role !== 'pending' && p.role !== 'banned').map(p => p.id));
    const voters = new Set(votes.map(v => v.user_id).filter(id => members.has(id))).size;

    const close = async () => {
        const { error } = await supabase.from('polls').update({ closed: true }).eq('id', poll.id);
        if (error) { toast(readableError(error), 'error'); return; }
        onChange();
    };

    const remove = async () => {
        const ok = await confirm({
            title: '이 투표를 지울까요?',
            detail: <>{poll.title}<br /><b style={{ color: 'var(--danger)' }}>
                {votes.length}표가 함께 사라집니다.</b></>,
            confirmLabel: '지우기',
            danger: true,
        });
        if (!ok) return;
        const { error } = await supabase.from('polls').delete().eq('id', poll.id);
        if (error) { toast(readableError(error), 'error'); return; }
        toast('지웠습니다.');
        onChange();
    };

    return (
        <div className={`card poll-card${closed ? ' closed' : ''}`}>
            <div className="row between">
                <div className="row" style={{ gap: 'var(--gap-xs)' }}>
                    {/* 라운드와 같은 한 쌍 — 잔디=열림, 회색=끝남. */}
                    {closed
                        ? <span className="badge done">마감</span>
                        : <span className="badge live">진행중</span>}
                    {poll.multi && <span className="badge dim">복수 선택</span>}
                    {poll.anonymous && <span className="badge dim">익명</span>}
                </div>
                <span className="xs faint">{timeAgo(poll.created_at)}</span>
            </div>

            {/* 제목을 누르면 상세로 간다 — 표를 던진 사람 **전부**와
                아직 안 한 사람은 거기서 본다. 항목 칸을 누르는 것은
                곧 투표라 그 자리에 겹칠 수가 없다. */}
            <Link to={`/polls/${poll.id}`} className="poll-title-link">
                <span className="poll-title grow">{poll.title}</span>
                <span className="chev" aria-hidden="true">›</span>
            </Link>
            {poll.body && (
                <p className="sm dim" style={{ whiteSpace: 'pre-wrap' }}>{poll.body}</p>
            )}

            <PollOptions poll={poll} options={options} votes={votes}
                         names={names} me={me} onChange={onChange} />

            <div className="row between poll-foot">
                <span className="xs faint grow">
                    {voters}명 참여
                    {poll.closes_at && !poll.closed && (
                        // 마감 시각은 **한 덩어리로 접힌다.** 그냥 두면 좁은 줄에서
                        // `마감`만 다음 줄로 떨어져, 바로 옆 `마감` 단추와 나란히
                        // 놓여 무엇이 단추인지 헷갈렸다.
                        <> · <span className="nowrap">{formatDateTime(poll.closes_at)} 마감</span></>
                    )}
                </span>
                {/* 마감·지우기는 만든 사람과 운영진만. 남의 투표는 못 건드린다. */}
                {(isAdmin || poll.created_by === me) && (
                    <span className="row" style={{ gap: 'var(--gap-xs)' }}>
                        {!closed && (
                            <button className="btn ghost sm" onClick={close}>마감</button>
                        )}
                        <button className="btn ghost sm" onClick={remove}>지우기</button>
                    </span>
                )}
            </div>
        </div>
    );
}
