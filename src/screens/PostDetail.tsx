import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, unwrap, fetchPeople, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatStamp } from '../lib/format';
import { personLabel, type Person, type Post, type PostComment } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { Comments } from '../components/Comments';
import { readableError } from '../lib/errors';
import './Board.css';

interface Loaded {
    post: Post | null;
    comments: PostComment[];
    people: Person[];
}

export function PostDetail() {
    const { id } = useParams<{ id: string }>();
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const nav = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    /** 대화방에 올리는 동안 단추를 잠근다 — 두 번 눌러 두 줄이 서지 않게. */
    const [busy, setBusy] = useState(false);

    const { data, loading, error, reload } = useAsync<Loaded>(async () => {
        const [post, comments, people] = await Promise.all([
            supabase.from('posts').select('*').eq('id', id!).maybeSingle(),
            supabase.from('post_comments').select('*').eq('post_id', id!)
                    .order('created_at'),
            fetchPeople(),
        ]);
        return { post: unwrap(post), comments: unwrap(comments) ?? [], people };
    }, [id], `post:${id}`);

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

    /* ── 대화방에 공유 ──
     *
     * **공지를 올리면 `📢 새 공지`가 한 번 나가고 끝이다**(사용자 요청 —
     * 라운드에 있던 그 단추를 공지에도 달아 달라고 했다). 그런데 사람들이
     * 실제로 사는 곳은 대화방이고, 거기에는 그 공지가 한 줄도 안 남는다 —
     * 알림을 놓치면 공지 탭에 들어가 보기 전까지 모른다.
     * 이 단추가 그 공지를 **대화방 맨 아래로 올려** 눌리는 카드로 남긴다.
     *
     * **라운드 공유와 완전히 같은 짜임이다**(`RoundDetail`의 `share`) —
     * `system` 글로 넣고, `post_id`가 붙어 카드가 되고, `notify`가 서서
     * 폰도 한 번 울린다. 한쪽만 고치지 말 것.
     *
     * **글은 여기서 만들고, 알림 문구는 발송기가 공지에서 다시 짠다** —
     * 대화 글은 회원이 손으로도 넣을 수 있는 값이라 그대로 100명의
     * 알림창에 띄우지 않는다.
     *
     * **누구나 누른다.** 공지는 회원 누구나 읽는 것이고, 묻힌 것을 다시
     * 올리는 일에 등급을 따질 이유가 없다(라운드 공유와 같은 잣대다).
     */
    const share = async () => {
        const ok = await confirm({
            title: '대화방에 올릴까요?',
            detail: <>
                전체 대화방에 이 공지 카드가 올라가고, 회원들에게 알림도 갑니다.<br />
                <b>{post.title}</b>
            </>,
            confirmLabel: '올리기',
        });
        if (!ok) return;

        setBusy(true);
        /* 전체 대화방은 **`round_id`가 없는 방 중 가장 먼저 만든 것**이다
           (DB의 `chat_notice`와 같은 잣대 — 두 벌이 되면 언젠가 어긋난다). */
        const room = await supabase.from('rooms').select('id')
            .is('round_id', null).order('created_at').limit(1).maybeSingle();
        const roomId = (room.data as { id: string } | null)?.id;
        if (!roomId) {
            setBusy(false);
            toast('전체 대화방이 없습니다.', 'error');
            return;
        }

        /* 첫 줄이 흐린 머리말, 둘째 줄이 제목이다(`LinkCard`). 본문은
           **첫 줄만 곁줄로 붙인다** — 긴 공지를 통째로 옮기면 대화방에서
           그 카드가 화면을 덮고, 어차피 눌러서 읽는 자리다. */
        const lead = (post.body || '').split('\n').find(Boolean)?.trim();
        const body = [
            `${names[me]?.name || '누군가'}님이 공지를 공유했습니다`,
            post.title,
            ...(lead ? [lead.length > 60 ? `${lead.slice(0, 60)}…` : lead] : []),
        ].join('\n');

        /* **없는 칸을 하나씩 빼면서 다시 넣는다**(라운드 공유와 같다).
           앱은 밀면 몇 분 뒤 올라가는데 `schema.sql`은 그보다 늦을 수 있어
           그 사이에는 `post_id`가 없는 DB에 새 앱이 붙는다 — 그때 통째로
           실패하면 단추가 고장 난 것으로 보인다. **오류 코드가 둘이다**:
           Postgres는 `42703`, PostgREST는 칸 목록을 제가 들고 있어
           DB에 닿기도 전에 `PGRST204`로 물린다. */
        const extra = { post_id: post.id, notify: true };
        // 뺄 차례 — 덜 아쉬운 것부터다(알림 먼저, 눌리는 카드는 마지막).
        const drops: (keyof typeof extra)[] = ['notify', 'post_id'];
        let err = null;
        for (let i = 0; i <= drops.length; i++) {
            const opt = { ...extra };
            for (const k of drops.slice(0, i)) delete opt[k];
            ({ error: err } = await supabase.from('messages')
                .insert({ room_id: roomId, user_id: me, body, system: true, ...opt }));
            if (!err || (err.code !== '42703' && err.code !== 'PGRST204')) break;
        }
        setBusy(false);
        if (err) { toast(readableError(err), 'error'); return; }
        toast('대화방에 올렸습니다.', 'ok');
    };

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
                    {personLabel(names[post.author_id ?? '']) || '알 수 없음'} · {formatStamp(post.created_at)}
                </div>
            </div>

            {post.body && <p className="post-body">{post.body}</p>}

            {/* **누구나 누른다** — 공지는 회원 누구나 읽는 것이고, 묻힌 것을
                대화방에 다시 올리는 일에 등급을 따질 이유가 없다.
                라운드 상세의 그 단추와 같은 자리·같은 모양이다. */}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost sm" onClick={share} disabled={busy}>
                    📣 대화방에 공유
                </button>
            </div>

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
