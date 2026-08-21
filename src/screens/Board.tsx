import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import type { Post, Profile } from '../lib/types';
import './Board.css';

interface Loaded { posts: Post[]; people: Profile[]; }

export function Board() {
    const { isAdmin } = useAuth();

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        const [posts, people] = await Promise.all([
            supabase.from('posts').select('*')
                .order('pinned', { ascending: false })
                .order('created_at', { ascending: false }),
            fetchProfiles(),
        ]);
        return { posts: unwrap(posts) ?? [], people };
    }, []);

    useRealtime('posts', reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (error) {
        return <div className="page"><div className="notice danger">{error}</div></div>;
    }

    const posts = data?.posts ?? [];
    const names = byId(data?.people ?? []);

    return (
        <div className="page">
            <div className="page-head">
                <h1 className="page-title">공지</h1>
                {isAdmin && <Link to="/board/new" className="btn primary sm">+ 글쓰기</Link>}
            </div>

            {posts.length === 0 && (
                <div className="empty">
                    아직 공지가 없습니다.<br />
                    <span className="xs">
                        중요한 것만 여기 남기세요. 대화는 <b>대화</b> 탭에서 합니다.
                    </span>
                </div>
            )}

            {posts.map(p => (
                <Link key={p.id} to={`/board/${p.id}`} className="card tappable post-row">
                    <div className="row between">
                        <div className="row" style={{ gap: 'var(--gap-xs)', minWidth: 0 }}>
                            {p.pinned && <span className="badge warn">고정</span>}
                            <span className="post-title truncate">{p.title}</span>
                        </div>
                    </div>
                    {p.body && <p className="sm dim post-preview">{p.body}</p>}
                    <div className="xs faint">
                        {names[p.author_id ?? '']?.name ?? '알 수 없음'} · {timeAgo(p.created_at)}
                    </div>
                </Link>
            ))}
        </div>
    );
}
