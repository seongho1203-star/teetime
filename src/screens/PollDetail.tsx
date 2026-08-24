import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, timeAgo } from '../lib/format';
import { pollClosed, type Poll, type PollOption, type PollVote, type Profile } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { PollOptions } from './Polls';
import './Polls.css';

interface Loaded {
    poll: Poll | null;
    options: PollOption[];
    votes: PollVote[];
    people: Profile[];
}

/**
 * 투표 하나를 펼쳐 본다.
 *
 * 목록 카드는 이름을 `외 12명`으로 접는다 — 한 줄에 다 못 넣기 때문이다.
 * **여기가 그 전부를 보는 자리다.** 덤으로 목록에서는 알 수 없는 것 하나를
 * 더 알려 준다: **아직 표를 안 던진 사람.** 서른 명 남짓 모임에서 날짜를
 * 정할 때 정작 궁금한 건 그쪽이라, 목록 카드에는 없고 여기에만 있다.
 */
export function PollDetail() {
    const { id } = useParams<{ id: string }>();
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const nav = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        const [poll, options, votes, people] = await Promise.all([
            supabase.from('polls').select('*').eq('id', id!).maybeSingle(),
            supabase.from('poll_options').select('*').eq('poll_id', id!).order('sort'),
            supabase.from('poll_votes').select('*').eq('poll_id', id!),
            fetchProfiles(),
        ]);
        return {
            poll: unwrap(poll),
            options: unwrap(options) ?? [],
            votes: unwrap(votes) ?? [],
            people,
        };
    }, [id]);

    useRealtime(['polls', 'poll_options', 'poll_votes'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (error || !data?.poll) {
        return (
            <div className="page">
                <TopBar title="투표" fallback="/polls" />
                <div className="notice danger">{error ?? '없는 투표입니다.'}</div>
            </div>
        );
    }

    const poll = data.poll;
    const names = byId(data.people);
    const closed = pollClosed(poll);

    const voted = new Set(data.votes.map(v => v.user_id));
    /* 표를 던져야 할 사람 = 대화를 볼 수 있는 사람. 대기·추방된 사람은
       애초에 투표 화면에 못 들어오므로 세지 않는다. */
    const members = data.people.filter(p => p.role !== 'pending' && p.role !== 'banned');
    const yet = members.filter(p => !voted.has(p.id));

    const close = async () => {
        const { error: err } = await supabase.from('polls')
            .update({ closed: !poll.closed }).eq('id', poll.id);
        if (err) { toast(readableError(err), 'error'); return; }
        reload();
    };

    const remove = async () => {
        const ok = await confirm({
            title: '이 투표를 지울까요?',
            detail: <>{poll.title}<br /><b style={{ color: 'var(--danger)' }}>
                {data.votes.length}표가 함께 사라집니다.</b></>,
            confirmLabel: '지우기',
            danger: true,
        });
        if (!ok) return;
        const { error: err } = await supabase.from('polls').delete().eq('id', poll.id);
        if (err) { toast(readableError(err), 'error'); return; }
        toast('지웠습니다.');
        nav('/polls', { replace: true });
    };

    return (
        <div className="page">
            <TopBar title="투표" fallback="/polls" />

            <div className="round-hero">
                <div className="row" style={{ gap: 'var(--gap-xs)' }}>
                    {closed
                        ? <span className="badge done">마감</span>
                        : <span className="badge live">진행중</span>}
                    {poll.multi && <span className="badge dim">복수 선택</span>}
                    {poll.anonymous && <span className="badge dim">익명</span>}
                    <span className="xs faint">{timeAgo(poll.created_at)}</span>
                </div>
                <h2>{poll.title}</h2>
                {poll.body && (
                    <p className="sm dim" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                        {poll.body}
                    </p>
                )}
            </div>

            <div className="card">
                {/* 카드와 같은 조각이다. 다른 것은 이름을 다 편다는 것뿐. */}
                <PollOptions poll={poll} options={data.options} votes={data.votes}
                             names={names} me={me} onChange={reload} full />
                <span className="xs faint">
                    {voted.size}명 참여 · 전체 {members.length}명
                    {poll.closes_at && !poll.closed && (
                        <> · {formatDateTime(poll.closes_at)} 마감</>
                    )}
                </span>
            </div>

            {/* **아직 안 한 사람.** 날짜를 정할 때 정작 궁금한 쪽이다.
                익명 투표는 누가 했는지를 감추는 것이므로 이것도 안 보인다
                — 안 한 사람을 알려 주면 나머지가 곧 한 사람이 된다. */}
            {!poll.anonymous && !closed && yet.length > 0 && (
                <div className="card">
                    <div className="section-title">아직 안 한 사람 {yet.length}명</div>
                    <div className="yet-list">
                        {yet.map(p => (
                            <span key={p.id} className="yet-chip">
                                <Avatar name={p.name} url={p.avatar_url} size="sm" />
                                <span className="truncate">{p.name}</span>
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {!poll.anonymous && !closed && yet.length === 0 && (
                <div className="notice">모두 표를 던졌습니다.</div>
            )}

            {(isAdmin || poll.created_by === me) && (
                <div className="card">
                    <div className="section-title">{isAdmin ? '운영' : '내가 만든 투표'}</div>
                    <div className="row wrap" style={{ gap: 'var(--gap-sm)' }}>
                        <button className="btn ghost sm" onClick={close}>
                            {poll.closed ? '다시 열기' : '마감'}
                        </button>
                        <button className="btn danger sm" onClick={remove}>지우기</button>
                    </div>
                </div>
            )}
        </div>
    );
}
