import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, timeAgo } from '../lib/format';
import {
    pollClosed,
    type Poll, type PollComment, type PollOption, type PollVote, type Profile,
} from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { Comments } from '../components/Comments';
import { readableError } from '../lib/errors';
import { PollOptions } from './Polls';
import './Polls.css';

interface Loaded {
    poll: Poll | null;
    options: PollOption[];
    votes: PollVote[];
    comments: PollComment[];
    people: Profile[];
}

/** 현황을 보는 세 가지 눈. 사람이 많아지면 하나로는 못 본다. */
type Tab = 'option' | 'member' | 'yet';
const TAB_LABEL: Record<Tab, string> = {
    option: '항목별', member: '멤버별', yet: '미참여',
};

/**
 * 투표 하나를 펼쳐 본다.
 *
 * 목록 카드는 이름을 `외 12명`으로 접는다 — 한 줄에 다 못 넣기 때문이다.
 * **여기가 그 전부를 보는 자리다.**
 *
 * 서른 명이 넘으면 한 가지 배열로는 답이 안 나와서 **현황을 셋으로 나눈다** —
 * 항목마다 누가 골랐나(`항목별`), 사람마다 무엇을 골랐나(`멤버별`),
 * 그리고 아직 안 한 사람(`미참여`). 마지막 것이 날짜를 정할 때 정작
 * 궁금한 쪽이라 탭 이름에 수를 함께 적는다.
 */
export function PollDetail() {
    const { id } = useParams<{ id: string }>();
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const nav = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    const [tab, setTab] = useState<Tab>('option');

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        const [poll, options, votes, comments, people] = await Promise.all([
            supabase.from('polls').select('*').eq('id', id!).maybeSingle(),
            supabase.from('poll_options').select('*').eq('poll_id', id!).order('sort'),
            supabase.from('poll_votes').select('*').eq('poll_id', id!),
            supabase.from('poll_comments').select('*').eq('poll_id', id!)
                    .order('created_at'),
            fetchProfiles(),
        ]);
        return {
            poll: unwrap(poll),
            options: unwrap(options) ?? [],
            votes: unwrap(votes) ?? [],
            comments: unwrap(comments) ?? [],
            people,
        };
    }, [id]);

    useRealtime(['polls', 'poll_options', 'poll_votes', 'poll_comments'], reload);

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
    /* 표를 던져야 할 사람 = 이 앱에 들어와 있는 사람. 대기·추방된 사람은
       애초에 투표 화면에 못 들어오므로 세지 않는다. */
    const members = data.people.filter(p => p.role !== 'pending' && p.role !== 'banned');
    const yet = members.filter(p => !voted.has(p.id));
    const done = members.filter(p => voted.has(p.id));

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
                {data.votes.length}표{data.comments.length > 0 && `와 댓글 ${data.comments.length}개`}가
                함께 사라집니다.</b></>,
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

            {/* 표를 던지는 자리. 현황과 섞지 않는다 — 아래는 읽는 곳이다. */}
            <div className="card">
                <PollOptions poll={poll} options={data.options} votes={data.votes}
                             names={names} me={me} onChange={reload} hideVoters />
                <span className="xs faint">
                    {voted.size}명 참여 · 전체 {members.length}명
                    {poll.closes_at && !poll.closed && (
                        <> · {formatDateTime(poll.closes_at)} 마감</>
                    )}
                </span>
            </div>

            {/* ── 현황 ──
                익명 투표에서는 누가 무엇을 골랐는지가 통째로 감춰진다.
                미참여도 마찬가지다 — 안 한 사람을 알려 주면 나머지가 곧
                한 사람이 되어 익명이 깨진다. */}
            {!poll.anonymous && (
                <div className="card">
                    <div className="tabs" role="tablist" aria-label="투표 현황">
                        {(['option', 'member', 'yet'] as const).map(t => (
                            <button key={t} role="tab" aria-selected={tab === t}
                                    className={`tab-btn${tab === t ? ' on' : ''}`}
                                    onClick={() => setTab(t)}>
                                {TAB_LABEL[t]}
                                {t === 'yet' && yet.length > 0 && ` ${yet.length}`}
                            </button>
                        ))}
                    </div>

                    {tab === 'option' && (
                        data.options.map(o => {
                            const on = data.votes.filter(v => v.option_id === o.id);
                            return (
                                <div className="tally" key={o.id}>
                                    <div className="tally-head">
                                        {o.label} <span className="faint">· {on.length}명</span>
                                    </div>
                                    {on.length === 0
                                        ? <p className="xs faint">고른 사람이 없습니다.</p>
                                        : <PeopleGrid
                                            people={on.map(v => names[v.user_id]).filter(Boolean)} />}
                                </div>
                            );
                        })
                    )}

                    {tab === 'member' && (
                        done.length === 0
                            ? <p className="xs faint">아직 아무도 안 했습니다.</p>
                            : done.map(p => {
                                /* **항목 순서대로 적는다.** 표가 들어온 순서로
                                   늘어놓으면 사람마다 차례가 달라져 읽기 나쁘다. */
                                const picks = data.options
                                    .filter(o => data.votes.some(
                                        v => v.user_id === p.id && v.option_id === o.id))
                                    .map(o => o.label);
                                return (
                                    <div className="member-pick" key={p.id}>
                                        <Avatar name={p.name} url={p.avatar_url} size="sm" />
                                        <span className="sm b">{p.name}</span>
                                        <span className="sm dim grow">{picks.join(', ')}</span>
                                    </div>
                                );
                            })
                    )}

                    {tab === 'yet' && (
                        yet.length === 0
                            ? <p className="xs faint">모두 표를 던졌습니다.</p>
                            : <PeopleGrid people={yet} />
                    )}
                </div>
            )}

            <Comments
                comments={data.comments} names={names}
                target={{ table: 'poll_comments', parent: { poll_id: poll.id } }}
                onChange={reload}
            />

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

/** 얼굴 + 이름을 두 칸으로 늘어놓는다. 서른 명이 되어도 줄로 흘러간다. */
function PeopleGrid({ people }: { people: Profile[] }) {
    return (
        <div className="people-grid">
            {people.map(p => (
                <span className="people-cell" key={p.id}>
                    <Avatar name={p.name} url={p.avatar_url} size="sm" />
                    <span className="sm truncate">{p.name}</span>
                </span>
            ))}
        </div>
    );
}
