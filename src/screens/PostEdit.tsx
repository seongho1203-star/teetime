import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import type { Post } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Hinted } from '../components/Hinted';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { Switch } from '../components/Switch';
import './Polls.css';

export function PostEdit() {
    const { id } = useParams<{ id: string }>();
    const { isAdmin, session } = useAuth();
    const nav = useNavigate();
    const toast = useToast();

    const { data, loading } = useAsync<Post | null>(async () => {
        if (!id) return null;
        return unwrap(await supabase.from('posts').select('*').eq('id', id).maybeSingle());
    }, [id]);

    const me = session!.user.id;
    const mayEdit = isAdmin || (data ? data.author_id === me : isAdmin);

    if (id && loading) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (!mayEdit) {
        return (
            <div className="page">
                <TopBar title="공지" fallback="/board" />
                <div className="notice danger">
                    {id ? '내가 쓴 글만 고칠 수 있습니다.' : '운영진만 공지를 쓸 수 있습니다.'}
                </div>
            </div>
        );
    }

    return <Form key={data?.id ?? 'new'} post={data} me={me} isAdmin={isAdmin}
                 nav={nav} toast={toast} />;
}

function Form({
    post, me, isAdmin, nav, toast,
}: {
    post: Post | null;
    me: string;
    isAdmin: boolean;
    nav: ReturnType<typeof useNavigate>;
    toast: (t: string, k?: 'ok' | 'error' | 'info') => void;
}) {
    const [title, setTitle] = useState(post?.title ?? '');
    const [body, setBody] = useState(post?.body ?? '');
    const [pinned, setPinned] = useState(post?.pinned ?? false);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        const t = title.trim();
        if (!t) { toast('제목을 적어 주세요.', 'error'); return; }

        setSaving(true);
        const res = post
            ? await supabase.from('posts')
                .update({ title: t, body: body.trim(), pinned, updated_at: new Date().toISOString() })
                .eq('id', post.id).select('id').single()
            : await supabase.from('posts')
                .insert({ title: t, body: body.trim(), pinned, author_id: me })
                .select('id').single();
        setSaving(false);

        if (res.error) { toast(readableError(res.error), 'error'); return; }
        toast(post ? '수정했습니다.' : '올렸습니다.', 'ok');
        nav(`/board/${(res.data as { id: string }).id}`, { replace: true });
    };

    return (
        <div className="page">
            <TopBar title={post ? '공지 수정' : '공지 쓰기'} fallback="/board" />

            <div className="card">
                <div className="field">
                    <label htmlFor="b-title">제목</label>
                    <Hinted hint="예) 9월 회비 안내" empty={!title}>
                        <input id="b-title" className="input" value={title}
                               onChange={e => setTitle(e.target.value)} maxLength={100} />
                    </Hinted>
                </div>
                <div className="field">
                    <label htmlFor="b-body">내용</label>
                    <textarea id="b-body" className="textarea" value={body}
                              onChange={e => setBody(e.target.value)}
                              style={{ minHeight: 220 }} maxLength={5000} />
                </div>
            </div>

            {isAdmin && (
                <div className="card">
                    <div className="switch-row" style={{ padding: 0 }}>
                        <div className="grow">
                            <div className="switch-label">맨 위에 고정</div>
                            <div className="switch-desc">새 글이 올라와도 목록 맨 위에 남습니다</div>
                        </div>
                        <Switch label="맨 위에 고정" on={pinned} onChange={setPinned} />
                    </div>
                </div>
            )}

            <div className="form-actions">
                <button className="btn primary block" onClick={save} disabled={saving}>
                    {saving ? '저장 중…' : post ? '수정 저장' : '올리기'}
                </button>
            </div>
        </div>
    );
}
