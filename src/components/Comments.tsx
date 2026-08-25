import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { readableError } from '../lib/errors';
import type { Profile } from '../lib/types';
import { Avatar } from './Avatar';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';

/** 세 댓글 표가 공통으로 가진 칸. 무엇에 달렸는지만 표마다 다르다. */
export type AnyComment = {
    id: string;
    author_id: string | null;
    body: string;
    created_at: string;
};

/** 댓글이 달리는 곳. 표 이름과 부모를 가리키는 칸이 짝이다. */
type Target =
    | { table: 'post_comments';  parent: { post_id: string } }
    | { table: 'poll_comments';  parent: { poll_id: string } }
    | { table: 'round_comments'; parent: { round_id: string } };

/**
 * 댓글 목록과 적는 칸. **공지·투표·라운드가 같이 쓴다.**
 *
 * 표만 셋으로 나뉘어 있을 뿐(`post_comments`·`poll_comments`·`round_comments`)
 * 모양도 정책도 하는 일도 같아서, 화면마다 따로 두면 한쪽만 고치는 일이
 * 생긴다 — 실제로 안내 글씨가 번쩍이는 것을 두 곳에서 따로 고칠 뻔했다.
 * 넣고 지우는 것까지 여기서 한다. 화면은 `onChange`로 다시 불러오기만 한다.
 */
export function Comments({
    comments, names, target, onChange,
}: {
    comments: AnyComment[];
    names: Record<string, Profile>;
    target: Target;
    onChange: () => void;
}) {
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const toast = useToast();
    const confirm = useConfirm();

    const add = async (body: string) => {
        const { error } = await supabase.from(target.table)
            .insert({ ...target.parent, author_id: me, body });
        if (error) { toast(readableError(error), 'error'); return false; }
        onChange();
        return true;
    };

    const remove = async (c: AnyComment) => {
        const ok = await confirm({ title: '댓글을 지울까요?', confirmLabel: '지우기', danger: true });
        if (!ok) return;
        const { error } = await supabase.from(target.table).delete().eq('id', c.id);
        if (error) { toast(readableError(error), 'error'); return; }
        onChange();
    };

    return (
        <div className="card">
            <div className="section-title">댓글 {comments.length}</div>

            {comments.length === 0 && <p className="xs faint">아직 댓글이 없습니다.</p>}

            {comments.map(c => {
                const who = names[c.author_id ?? ''];
                return (
                    <div className="comment" key={c.id}>
                        <Avatar name={who?.name} url={who?.avatar_url} size="sm" />
                        <div className="grow" style={{ minWidth: 0 }}>
                            <div className="row" style={{ gap: 6 }}>
                                <span className="sm b">{who?.name ?? '알 수 없음'}</span>
                                <span className="xs faint">{timeAgo(c.created_at)}</span>
                            </div>
                            <div className="sm comment-body">{c.body}</div>
                        </div>
                        {(isAdmin || c.author_id === me) && (
                            <button className="btn ghost sm" onClick={() => remove(c)}
                                    aria-label="댓글 지우기">✕</button>
                        )}
                    </div>
                );
            })}

            <CommentForm onSubmit={add} />
        </div>
    );
}

/**
 * 댓글 한 줄을 적는 칸.
 *
 * 대화 입력칸에서 겪은 것을 그대로 옮겨 왔다 — 여기도 한글을 치는 자리라
 * 같은 증상이 났다:
 *
 * - **`value`로 묶지 않는다(uncontrolled).** 값은 칸이 들고 있고 `draft`는
 *   곁에 적어 두는 사본일 뿐이다. 보낼 때는 `ref`에서 직접 읽는다 —
 *   조합 중인 마지막 글자가 `draft`엔 아직 없을 수 있다.
 * - **안내 글씨에 브라우저의 `placeholder`를 안 쓴다.** 한글은 한 글자가
 *   여러 번에 걸쳐 조합되는데 iOS는 그 조합 중인 글자를 '내용 없음'으로 봐서
 *   첫 글자를 칠 때 `댓글 남기기`가 번쩍인다. 직접 그리고 **초점이 가는 순간
 *   치운다** — 글자가 들어왔는지가 아니라 초점이 기준이라 번쩍일 틈이 없다.
 * - **`등록`이 켜지고 꺼지는 기준도 초점이다.** 적은 글자로 정하면 조합 중에
 *   값이 잠깐 비어 보이는 순간마다 단추 색이 오가 **깜빡인다**(첫 글자를 칠 때
 *   실제로 그랬다). 초점이 있으면 켜 두고, 비어 있으면 눌러도 아무 일이
 *   없게 한다 — 색이 바뀔 틈 자체를 없앤다.
 * - **`등록`은 `onMouseDown`을 막는다.** 안 막으면 단추가 초점을 가져가
 *   입력칸이 풀리고, 폰에서는 키보드가 함께 내려간다.
 *
 * `onSubmit`이 `true`를 돌려주면 칸을 비운다. 실패했으면 적은 글을 남겨
 * 다시 쓰지 않게 한다.
 */
function CommentForm({ onSubmit }: { onSubmit: (body: string) => Promise<boolean> }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [draft, setDraft] = useState('');
    const [focused, setFocused] = useState(false);
    const [sending, setSending] = useState(false);

    const submit = async () => {
        const body = (ref.current?.value ?? '').trim();
        if (!body || sending) return;
        setSending(true);
        const ok = await onSubmit(body);
        setSending(false);
        if (!ok) return;
        if (ref.current) ref.current.value = '';
        setDraft('');
    };

    return (
        <div className="comment-form">
            <div className="comment-field grow">
                <textarea
                    ref={ref}
                    className="textarea"
                    onChange={e => setDraft(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    rows={1} maxLength={500}
                    aria-label="댓글 입력"
                />
                {!focused && !draft && <span className="comment-hint">댓글 남기기</span>}
            </div>
            <button className="btn primary" onClick={submit}
                    onMouseDown={e => e.preventDefault()}
                    disabled={sending || (!focused && !draft.trim())}>
                등록
            </button>
        </div>
    );
}
