import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import type { Post, Profile } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { canInstall, onInstallChange, promptInstall } from '../lib/install';
import './Home.css';

interface Loaded {
    posts: Post[];
    pendingCount: number;
}

/**
 * 첫 화면. **공지만** 보여 준다.
 *
 * 예전에는 다음 라운드와 안 한 투표까지 여기 모았는데, 탭을 눌러 보면
 * 같은 것이 또 나와 화면이 두 번 겹쳤다. 지금은 라운드·투표가 몇 건
 * 진행중인지를 **탭바의 숫자**가 알려 주고(`TabBar`), 내용은 각 탭이 맡는다.
 * 여기 남는 것은 공지 — 흘러가지 않고 쌓이는 것 하나뿐이다.
 */
export function Home() {
    const { profile, isAdmin } = useAuth();

    // 설치 안내는 홈에 띄운다. 내 정보 안에 두었더니 아무도 못 찾았다.
    // 크롬이 설치할 만하다고 판단했을 때만 나타나고, 설치하면 사라진다.
    const [installable, setInstallable] = useState(canInstall());
    useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);

    const { data, loading, reload } = useAsync<Loaded>(async () => {
        const [posts, people] = await Promise.all([
            supabase.from('posts').select('*')
                    .order('pinned', { ascending: false })
                    .order('created_at', { ascending: false }).limit(10),
            supabase.from('profiles').select('id, role'),
        ]);
        const list = (unwrap(people) ?? []) as Pick<Profile, 'id' | 'role'>[];
        return {
            posts: unwrap(posts) ?? [],
            pendingCount: list.filter(p => p.role === 'pending').length,
        };
    }, []);

    useRealtime(['posts', 'profiles'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }

    const posts = data?.posts ?? [];

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

            {installable && (
                <button className="card tappable home-install" onClick={() => promptInstall()}>
                    <span className="grow">
                        <span className="b">앱으로 설치하기</span>
                        <br />
                        <span className="xs faint">
                            홈 화면에 놓고 알림도 받으세요
                        </span>
                    </span>
                    <span className="badge brand">설치</span>
                </button>
            )}

            {isAdmin && (data?.pendingCount ?? 0) > 0 && (
                <Link to="/members" className="card tappable home-alert">
                    <span className="badge warn">가입 신청</span>
                    <span className="grow b">{data!.pendingCount}명이 승인을 기다립니다</span>
                    <span className="faint">›</span>
                </Link>
            )}

            <div className="section-title">공지</div>
            {posts.length > 0
                ? posts.map(p => (
                    <Link key={p.id} to={`/board/${p.id}`} className="card tappable home-row">
                        {p.pinned && <span className="badge warn">고정</span>}
                        <span className="grow b truncate">{p.title}</span>
                        <span className="xs faint">{timeAgo(p.created_at)}</span>
                    </Link>
                ))
                : <div className="empty">아직 공지가 없습니다.</div>}
        </div>
    );
}
