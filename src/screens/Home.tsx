import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchProfiles } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDateTime, ddayLabel, daysUntil, timeAgo } from '../lib/format';
import { lastSeen } from '../lib/unread';
import { fetchWeather, type Weather } from '../lib/weather';
import type { Poll, PollVote, Post, Profile, Round, Signup } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { canInstall, onInstallChange, promptInstall } from '../lib/install';
import './Home.css';

interface Loaded {
    rounds: Round[];
    signups: Signup[];
    people: Profile[];
    posts: Post[];
    /** 내가 아직 표를 안 던진 투표 */
    openPolls: Poll[];
    pendingCount: number;
    unreadChat: number;
}

/**
 * 첫 화면.
 *
 * **위에서부터 급한 순서로 쌓는다.** 해당 없는 칸은 통째로 사라지므로
 * 한가한 주에는 저절로 단출해진다 — 빈 상태를 크게 알릴 이유가 없다.
 *
 *   1 다음 라운드   화면의 주인공. 언제·어디·날씨·자리, 그리고 **내 상태**
 *   2 내가 할 일     안 한 투표 · 안 읽은 대화 · (운영진) 승인 대기
 *   3 모집중         다음 것 말고 열려 있는 라운드
 *   4 고정 공지      흘러가지 않고 쌓이는 것이라 맨 아래
 *
 * 예전에는 공지만 두었는데, 정작 이 앱을 만든 이유인 라운드를 보려면
 * 탭을 하나 더 눌러야 했다.
 */
export function Home() {
    const { session, profile, isAdmin } = useAuth();
    const me = session!.user.id;

    // 설치 안내는 홈에 띄운다. 내 정보 안에 두었더니 아무도 못 찾았다.
    const [installable, setInstallable] = useState(canInstall());
    useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);

    const { data, loading, reload } = useAsync<Loaded>(async () => {
        const seenChat = lastSeen('chat', me);
        const [rounds, signups, people, posts, polls, votes, pending, chat] = await Promise.all([
            supabase.from('rounds').select('*')
                    .neq('status', 'cancelled').order('tee_at', { ascending: true }),
            supabase.from('signups').select('*'),
            fetchProfiles(),
            supabase.from('posts').select('*')
                    .eq('pinned', true).order('created_at', { ascending: false }).limit(3),
            supabase.from('polls').select('*').eq('closed', false),
            supabase.from('poll_votes').select('poll_id').eq('user_id', me),
            isAdmin
                ? supabase.from('profiles').select('id', { count: 'exact', head: true })
                          .eq('role', 'pending')
                : Promise.resolve({ count: 0, error: null }),
            supabase.from('messages').select('id', { count: 'exact', head: true })
                    .gt('created_at', seenChat).neq('user_id', me),
        ]);

        const now = Date.now();
        const voted = new Set(((unwrap(votes) ?? []) as Pick<PollVote, 'poll_id'>[])
            .map(v => v.poll_id));
        const openPolls = ((unwrap(polls) ?? []) as Poll[])
            .filter(p => !p.closes_at || new Date(p.closes_at).getTime() > now)
            .filter(p => !voted.has(p.id));

        return {
            rounds: unwrap(rounds) ?? [],
            signups: unwrap(signups) ?? [],
            people,
            posts: unwrap(posts) ?? [],
            openPolls,
            pendingCount: pending.count ?? 0,
            unreadChat: chat.count ?? 0,
        };
    }, [me, isAdmin]);

    useRealtime(['rounds', 'signups', 'posts', 'polls', 'poll_votes', 'profiles', 'messages'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }

    const rounds = data?.rounds ?? [];
    const signups = data?.signups ?? [];
    const posts = data?.posts ?? [];
    const polls = data?.openPolls ?? [];
    const pendingCount = data?.pendingCount ?? 0;
    const unreadChat = data?.unreadChat ?? 0;

    // 오늘(한국 날짜) 이후만. 가장 가까운 것이 주인공, 나머지는 아래 목록.
    const upcoming = rounds.filter(r => daysUntil(r.tee_at) >= 0);
    const [next, ...others] = upcoming;

    const todo = polls.length + (isAdmin ? pendingCount : 0) + (unreadChat ? 1 : 0);

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

            {next
                ? <NextRound round={next} signups={signups} people={data!.people} me={me} />
                : (
                    <Link to="/rounds/new" className="next-empty">
                        <span className="b">열린 라운드가 없습니다</span>
                        <span className="sm faint">먼저 모집을 열어 보세요</span>
                        <span className="badge brand">+ 모집 열기</span>
                    </Link>
                )}

            {todo > 0 && (
                <div className="home-block">
                    <div className="section-title">내가 할 일</div>
                    {polls.map(p => (
                        <Link key={p.id} to="/polls" className="home-row">
                            <span className="badge">투표</span>
                            <span className="grow b truncate">{p.title}</span>
                            <span className="faint">›</span>
                        </Link>
                    ))}
                    {isAdmin && pendingCount > 0 && (
                        <Link to="/members" className="home-row">
                            <span className="badge warn">승인</span>
                            <span className="grow b">가입 신청 {pendingCount}명</span>
                            <span className="faint">›</span>
                        </Link>
                    )}
                    {unreadChat > 0 && (
                        <Link to="/chat" className="home-row">
                            <span className="badge danger">대화</span>
                            <span className="grow b">안 읽은 메시지 {unreadChat}개</span>
                            <span className="faint">›</span>
                        </Link>
                    )}
                </div>
            )}

            {others.length > 0 && (
                <div className="home-block">
                    <div className="section-title">모집중</div>
                    {others.map(r => (
                        <OtherRound key={r.id} round={r} signups={signups} me={me} />
                    ))}
                </div>
            )}

            {posts.length > 0 && (
                <div className="home-block">
                    <div className="section-title">공지</div>
                    {posts.map(p => (
                        <Link key={p.id} to={`/board/${p.id}`} className="home-row">
                            <span className="badge warn">고정</span>
                            <span className="grow b truncate">{p.title}</span>
                            <span className="xs faint">{timeAgo(p.created_at)}</span>
                        </Link>
                    ))}
                </div>
            )}

            {installable && (
                <button className="home-row tappable" onClick={() => promptInstall()}>
                    <span className="grow">
                        <span className="b">앱으로 설치하기</span>
                        <br />
                        <span className="xs faint">홈 화면에 놓고 알림도 받으세요</span>
                    </span>
                    <span className="faint">›</span>
                </button>
            )}
        </div>
    );
}

/**
 * 다음 라운드 — 화면의 주인공.
 *
 * 짙은 페어웨이 녹색을 이 카드에만 깔아 주인공을 세운다. 강조색(--brand)을
 * 늘리지 않고 위계를 만드는 방법이다 — 초록은 아래 단추 하나에만 남는다.
 */
function NextRound({
    round: r, signups, people, me,
}: {
    round: Round;
    signups: Signup[];
    people: Profile[];
    me: string;
}) {
    const [weather, setWeather] = useState<Weather | null>(null);

    useEffect(() => {
        let alive = true;
        fetchWeather(r.lat, r.lon, r.tee_at).then(w => { if (alive) setWeather(w); });
        return () => { alive = false; };
    }, [r.lat, r.lon, r.tee_at]);

    const mine = signups.filter(s => s.round_id === r.id);
    const confirmed = mine.filter(s => s.state === 'confirmed');
    const my = mine.find(s => s.user_id === me);
    const left = Math.max(0, r.capacity - confirmed.length);
    const byId = new Map(people.map(p => [p.id, p]));

    return (
        <Link to={`/rounds/${r.id}`} className="next">
            <div className="next-top">
                <span className="next-label">다음 라운드</span>
                <span className="next-dday">{ddayLabel(r.tee_at)}</span>
            </div>

            <div>
                <div className="next-when">{formatDateTime(r.tee_at)}</div>
                <div className="next-where">{r.course || r.title}</div>
            </div>

            {weather && (
                <div className="next-weather">
                    <span aria-hidden="true">{weather.icon}</span>
                    <b>{weather.min}° / {weather.max}°</b>
                    <span>{weather.label}</span>
                    {weather.rain > 0 && <span>· 비 {weather.rain}%</span>}
                </div>
            )}

            <div className="next-who">
                {confirmed.length > 0 && (
                    <span className="next-faces">
                        {confirmed.slice(0, 5).map(s => (
                            <Avatar key={s.id} size="sm"
                                    name={byId.get(s.user_id)?.name}
                                    url={byId.get(s.user_id)?.avatar_url} />
                        ))}
                    </span>
                )}
                <span className="next-count">
                    {confirmed.length} / {r.capacity}명
                    {left > 0 ? ` · ${left}자리 남음` : ' · 자리 참'}
                </span>
            </div>

            {/* 내 상태가 곧 버튼 자리다. 신청했는지 보려고 들어갈 일이 없어진다. */}
            {my
                ? (
                    <span className={`next-state${my.state === 'waitlist' ? ' wait' : ''}`}>
                        {my.state === 'waitlist' ? `대기 ${my.seq}번` : '신청 완료'}
                    </span>
                )
                : <span className="next-go">{left > 0 ? '신청하기' : '대기 신청'}</span>}
        </Link>
    );
}

/** 모집중인 다른 라운드 — 자리가 남았는지만 보이면 된다. */
function OtherRound({ round: r, signups, me }: { round: Round; signups: Signup[]; me: string }) {
    const mine = signups.filter(s => s.round_id === r.id);
    const confirmed = mine.filter(s => s.state === 'confirmed').length;
    const my = mine.some(s => s.user_id === me);
    const left = Math.max(0, r.capacity - confirmed);

    return (
        <Link to={`/rounds/${r.id}`} className="home-row">
            <span className="grow b truncate">
                {formatDateTime(r.tee_at).replace(/\s\(.\)/, '')} {r.course || r.title}
            </span>
            {my
                ? <span className="badge dim">신청함</span>
                : left > 0
                    ? <span className="badge">{left}자리</span>
                    : <span className="badge dim">자리 참</span>}
        </Link>
    );
}
