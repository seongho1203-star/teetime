import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import { daysUntil, timeAgo } from '../lib/format';
import type { Poll, PollVote, Post, Round, Signup, Profile } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { RoundCard } from './Rounds';
import './Home.css';

interface Loaded {
    rounds: Round[];
    signups: Signup[];
    polls: Poll[];
    votes: PollVote[];
    posts: Post[];
    pendingCount: number;
    people: Profile[];
}

/**
 * 첫 화면. **지금 내가 해야 할 것**만 모은다.
 * 목록을 다시 늘어놓는 곳이 아니다 — 그건 각 탭이 한다.
 */
export function Home() {
    const { profile, isAdmin, session } = useAuth();
    const me = session!.user.id;

    const { data, loading, reload } = useAsync<Loaded>(async () => {
        const [rounds, signups, polls, votes, posts, people] = await Promise.all([
            supabase.from('rounds').select('*').eq('status', 'open')
                    .order('tee_at', { ascending: true }),
            supabase.from('signups').select('*'),
            supabase.from('polls').select('*').eq('closed', false)
                    .order('created_at', { ascending: false }),
            supabase.from('poll_votes').select('*'),
            supabase.from('posts').select('*')
                    .order('pinned', { ascending: false })
                    .order('created_at', { ascending: false }).limit(3),
            supabase.from('profiles').select('*'),
        ]);
        const list = unwrap(people) ?? [];
        return {
            rounds: unwrap(rounds) ?? [],
            signups: unwrap(signups) ?? [],
            polls: unwrap(polls) ?? [],
            votes: unwrap(votes) ?? [],
            posts: unwrap(posts) ?? [],
            people: list,
            pendingCount: list.filter(p => p.role === 'pending').length,
        };
    }, []);

    useRealtime(['rounds', 'signups', 'polls', 'poll_votes', 'posts'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }

    const rounds = (data?.rounds ?? []).filter(r => daysUntil(r.tee_at) >= 0);
    const next = rounds[0];
    const signups = data?.signups ?? [];

    // 아직 한 표도 안 던진 진행중 투표 — 이게 카톡에서 가장 잘 묻히는 것이다.
    const voted = new Set((data?.votes ?? []).filter(v => v.user_id === me).map(v => v.poll_id));
    const todo = (data?.polls ?? []).filter(p =>
        !voted.has(p.id) && (!p.closes_at || new Date(p.closes_at) > new Date()));

    // 아직 신청하지 않은 모집중 라운드
    const notSignedUp = rounds.filter(r =>
        !signups.some(s => s.round_id === r.id && s.user_id === me));

    return (
        <div className="page">
            <div className="page-head">
                <div>
                    <div className="sm faint">안녕하세요</div>
                    <h1 className="page-title">{profile?.name || '회원'}님</h1>
                </div>
                <Link to="/me" aria-label="내 정보">
                    <Avatar name={profile?.name} url={profile?.avatar_url} />
                </Link>
            </div>

            {isAdmin && (data?.pendingCount ?? 0) > 0 && (
                <Link to="/members" className="card tappable home-alert">
                    <span className="badge warn">가입 신청</span>
                    <span className="grow b">{data!.pendingCount}명이 승인을 기다립니다</span>
                    <span className="faint">›</span>
                </Link>
            )}

            {/* ── 다음 라운드 ── */}
            <div className="section-title">다음 라운드</div>
            {next
                ? <RoundCard round={next} signups={signups} me={me} />
                : <div className="empty">예정된 라운드가 없습니다.</div>}

            {notSignedUp.length > 0 && (
                <div className="notice">
                    아직 신청하지 않은 모집이 <b>{notSignedUp.length}건</b> 있습니다.{' '}
                    <Link to="/rounds">보러 가기</Link>
                </div>
            )}

            {/* ── 해야 할 투표 ── */}
            {todo.length > 0 && (
                <>
                    <div className="section-title">아직 투표하지 않았습니다</div>
                    {todo.map(p => (
                        <Link key={p.id} to="/polls" className="card tappable home-row">
                            <span className="badge brand">투표</span>
                            <span className="grow b truncate">{p.title}</span>
                            <span className="faint">›</span>
                        </Link>
                    ))}
                </>
            )}

            {/* ── 최근 공지 ── */}
            {(data?.posts.length ?? 0) > 0 && (
                <>
                    <div className="section-title">공지</div>
                    {data!.posts.map(p => (
                        <Link key={p.id} to={`/board/${p.id}`} className="card tappable home-row">
                            {p.pinned && <span className="badge warn">고정</span>}
                            <span className="grow b truncate">{p.title}</span>
                            <span className="xs faint">{timeAgo(p.created_at)}</span>
                        </Link>
                    ))}
                </>
            )}
        </div>
    );
}
