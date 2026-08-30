import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, timeAgo } from '../lib/format';
import { pollClosed, type Poll, type PollOption, type PollVote, type Profile } from '../lib/types';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { useConfirm } from '../components/Confirm';
import './Polls.css';

interface Loaded {
    polls: Poll[];
    options: PollOption[];
    votes: PollVote[];
    people: Profile[];
}

export function Polls() {

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        const [polls, options, votes, people] = await Promise.all([
            supabase.from('polls').select('*').order('created_at', { ascending: false }),
            supabase.from('poll_options').select('*').order('sort'),
            supabase.from('poll_votes').select('*'),
            fetchProfiles(),
        ]);
        return {
            polls: unwrap(polls) ?? [],
            options: unwrap(options) ?? [],
            votes: unwrap(votes) ?? [],
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
    votes: PollVote[];
    names: Record<string, Profile>;
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
                const who = on.map(v => names[v.user_id]?.name ?? '?');
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

    // 투표한 사람 수 (복수 선택이면 표 수와 다르다)
    const voters = new Set(votes.map(v => v.user_id)).size;

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
