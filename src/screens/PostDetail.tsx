import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatStamp } from '../lib/format';
import type { Post, PostComment, Profile } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { Comments } from '../components/Comments';
import { readableError } from '../lib/errors';
import './Board.css';

interface Loaded {
    post: Post | null;
    comments: PostComment[];
    people: Profile[];
}

export function PostDetail() {
    const { id } = useParams<{ id: string }>();
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const nav = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        const [post, comments, people] = await Promise.all([
            supabase.from('posts').select('*').eq('id', id!).maybeSingle(),
            supabase.from('post_comments').select('*').eq('post_id', id!)
                    .order('created_at'),
            fetchProfiles(),
        ]);
        return { post: unwrap(post), comments: unwrap(comments) ?? [], people };
    }, [id]);

    useRealtime(['posts', 'post_comments'], reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (error || !data?.post) {
        return (
            <div className="page">
                <TopBar title="공지" fallback="/board" />
                <div className="notice danger">{error ?? '없는 글입니다.'}</div>
            </div>
        );
    }

    const post = data.post;
    const names = byId(data.people);
    const canEdit = isAdmin || post.author_id === me;

    const removePost = async () => {
        const ok = await confirm({
            title: '이 글을 지울까요?',
            detail: data.comments.length > 0
                ? <>댓글 <b style={{ color: 'var(--danger)' }}>{data.comments.length}개</b>가 함께 사라집니다.</>
                : '되돌릴 수 없습니다.',
            confirmLabel: '지우기',
            danger: true,
        });
        if (!ok) return;
        const { error: err } = await supabase.from('posts').delete().eq('id', post.id);
        if (err) { toast(readableError(err), 'error'); return; }
        toast('지웠습니다.');
        nav('/board', { replace: true });
    };

    const togglePin = async () => {
        const { error: err } = await supabase.from('posts')
            .update({ pinned: !post.pinned }).eq('id', post.id);
        if (err) { toast(readableError(err), 'error'); return; }
        reload();
    };

    return (
        <div className="page">
            <TopBar
                title="공지"
                fallback="/board"
                right={canEdit && <Link to={`/board/${post.id}/edit`} className="btn ghost sm">수정</Link>}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap-xs)' }}>
                {post.pinned && <span className="badge warn" style={{ alignSelf: 'flex-start' }}>고정</span>}
                <h2 className="page-title" style={{ fontSize: 'var(--fs-lg)', wordBreak: 'keep-all' }}>
                    {post.title}
                </h2>
                <div className="xs faint">
                    {names[post.author_id ?? '']?.name ?? '알 수 없음'} · {formatStamp(post.created_at)}
                </div>
            </div>

            {post.body && <p className="post-body">{post.body}</p>}

            {isAdmin && (
                <div className="row" style={{ gap: 'var(--gap-sm)' }}>
                    <button className="btn ghost sm" onClick={togglePin}>
                        {post.pinned ? '고정 해제' : '맨 위에 고정'}
                    </button>
                    <button className="btn danger sm" onClick={removePost}>지우기</button>
                </div>
            )}

            <Comments
                comments={data.comments} names={names}
                target={{ table: 'post_comments', parent: { post_id: post.id } }}
                onChange={reload}
            />
        </div>
    );
}
