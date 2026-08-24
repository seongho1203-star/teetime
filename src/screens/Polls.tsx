import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, timeAgo } from '../lib/format';
import type { Poll, PollOption, PollVote, Profile } from '../lib/types';
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
    }, []);

    useRealtime(['poll_votes', 'polls', 'poll_options'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (error) {
        return <div className="page"><div className="notice danger">{error}</div></div>;
    }

    const polls = data?.polls ?? [];
    const live = polls.filter(p => !isClosed(p));
    const done = polls.filter(p => isClosed(p));

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

const isClosed = (p: Poll) =>
    p.closed || (p.closes_at !== null && new Date(p.closes_at) < new Date());

/** 이름을 몇까지 적고 나머지는 세어 줄지. 한 줄에 들어갈 만큼만. */
const NAMES_SHOWN = 3;

/**
 * `이관교, 김지명, 박승수 외 12명`.
 *
 * 이 줄은 한 줄로 잘리는데(`.truncate`), 그냥 두면 `정우…`에서 끝나
 * **몇 명인지도 모른다.** 우리 모임이 서른 명 남짓이라 실제로 그렇게 된다.
 * 앞의 몇만 적고 나머지는 수로 알려 준다.
 */
function votersLine(list: string[]): string {
    return list.length <= NAMES_SHOWN
        ? list.join(', ')
        : `${list.slice(0, NAMES_SHOWN).join(', ')} 외 ${list.length - NAMES_SHOWN}명`;
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
    const closed = isClosed(poll);

    // 투표한 사람 수 (복수 선택이면 표 수와 다르다)
    const voters = new Set(votes.map(v => v.user_id)).size;
    /* **누가 골랐는지 줄은 항목마다 다 있거나 다 없어야 한다.**
       표를 받은 항목에만 붙이면 그 줄만 키가 커져 칸들이 들쭉날쭉해진다.
       한 표라도 들어온 뒤에 모든 항목에 자리를 잡아 준다 — 아무도 안
       골랐을 때까지 빈 줄을 깔면 새 투표가 괜히 길어진다. */
    const showVoters = !poll.anonymous && votes.length > 0;
    const mine = new Set(votes.filter(v => v.user_id === me).map(v => v.option_id));

    const pick = async (optionId: string) => {
        if (closed) return;
        const err = mine.has(optionId)
            ? (await supabase.rpc('retract_vote', { p_option: optionId })).error
            : (await supabase.rpc('cast_vote', { p_option: optionId })).error;
        if (err) { toast(readableError(err), 'error'); return; }
        onChange();
    };

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

            <div className="poll-title">{poll.title}</div>
            {poll.body && (
                <p className="sm dim" style={{ whiteSpace: 'pre-wrap' }}>{poll.body}</p>
            )}

            <div className="poll-options">
                {options.map(o => {
                    const on = votes.filter(v => v.option_id === o.id);
                    const pct = voters ? Math.round((on.length / voters) * 100) : 0;
                    const chosen = mine.has(o.id);
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
                                <span className="poll-voters truncate">
                                    {votersLine(on.map(v => names[v.user_id]?.name ?? '?'))}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="row between poll-foot">
                <span className="xs faint grow">
                    {voters}명 참여
                    {poll.closes_at && !poll.closed && (
                        <> · {formatDateTime(poll.closes_at)} 마감</>
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
