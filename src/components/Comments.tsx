import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { readableError } from '../lib/errors';
import { personLabel, type Person } from '../lib/types';
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
    names: Record<string, Person>;
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
                        <Avatar name={who?.name} url={who?.avatar_url}
                                gender={who?.gender} size="sm" />
                        <div className="grow" style={{ minWidth: 0 }}>
                            <div className="row" style={{ gap: 6 }}>
                                <span className="sm b">{personLabel(who) || '알 수 없음'}</span>
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
/* 아래 화면은 `hasText`를 **그리는 중에** 읽는다. 일부러다 — 안내 글씨와
   `등록` 단추는 둘 다 **초점이 오갈 때만** 다시 그려지고, 그때 읽는 값은
   늘 최신이다. 글자마다 state에 넣으면 댓글 목록이 통째로 다시 그려져
   치는 것이 끊긴다(Chat.tsx의 `hasText`와 같은 방식이다). */
/* oxlint-disable react/refs */
function CommentForm({ onSubmit }: { onSubmit: (body: string) => Promise<boolean> }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [focused, setFocused] = useState(false);
    const [sending, setSending] = useState(false);
    /** 적은 글이 있는가. **state가 아니라 곁에 적어 둔다** — 글자마다
        state에 넣으면 댓글 목록이 통째로 다시 그려진다. 읽는 곳(안내
        글씨·`등록` 단추)은 둘 다 초점이 오갈 때만 본다. */
    const hasText = useRef(false);
    /** 한글을 조합하는 중인가. 그동안에는 칸을 읽지도 쓰지도 않는다. */
    const composing = useRef(false);
    /** 지난번 글자 수. 줄어들 때만 되돌려 다시 잰다. */
    const lastLen = useRef(0);

    /**
     * 적은 글에 맞춰 칸을 늘린다. `textarea`는 스스로 안 늘어나서, 놔두면
     * 여러 줄을 적을 때 앞줄이 위로 잘려 안 보인다.
     * **대화 입력칸(`growDraft` in Chat.tsx)과 같은 방식이다** — 조합
     * 중에는 손을 떼고, 늘 때는 넘칠 때만 한 번 늘리고, 지웠을 때만
     * `auto`로 되돌려 다시 잰다. 한쪽만 고치지 말 것.
     * `box-sizing: border-box`라 테두리 두께를 더해 줘야 잔스크롤이 안 남는다.
     * 위 한도는 CSS(`max-height`)가 잡는다.
     */
    const grow = () => {
        const el = ref.current;
        if (!el) return;
        if (composing.current) return;
        const border = () => el.offsetHeight - el.clientHeight;

        const len = el.value.length;
        const shrank = len < lastLen.current;
        lastLen.current = len;

        if (!shrank) {
            const need = el.scrollHeight + border();
            if (need > el.offsetHeight) el.style.height = `${need}px`;
            return;
        }
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight + border()}px`;
    };

    const submit = async () => {
        const body = (ref.current?.value ?? '').trim();
        if (!body || sending) return;
        setSending(true);
        const ok = await onSubmit(body);
        setSending(false);
        if (!ok) return;
        if (ref.current) {
            ref.current.value = '';
            ref.current.style.height = '';   // 한 줄로 돌아온다
        }
        hasText.current = false;
        lastLen.current = 0;
        composing.current = false;
    };

    return (
        <div className="comment-form">
            <div className="comment-field grow">
                <textarea
                    ref={ref}
                    className="textarea"
                    onChange={e => { hasText.current = e.target.value.trim() !== ''; grow(); }}
                    onCompositionStart={() => { composing.current = true; }}
                    onCompositionEnd={() => { composing.current = false; grow(); }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    rows={1} maxLength={500}
                    aria-label="댓글 입력"
                />
                {!focused && !hasText.current && <span className="comment-hint">댓글 남기기</span>}
            </div>
            <button className="btn primary" onClick={submit}
                    onMouseDown={e => e.preventDefault()}
                    disabled={sending || (!focused && !hasText.current)}>
                등록
            </button>
        </div>
    );
}
