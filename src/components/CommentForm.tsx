import { useRef, useState } from 'react';

/**
 * 댓글 한 줄을 적는 칸. **공지와 투표가 같이 쓴다.**
 *
 * 대화 입력칸에서 겪은 것을 그대로 옮겨 왔다 — 두 곳 다 한글을 치는
 * 자리라 같은 증상이 났다:
 *
 * - **`value`로 묶지 않는다(uncontrolled).** 값은 칸이 들고 있고 `draft`는
 *   `등록`을 켜고 끄려고 곁에 적어 두는 사본일 뿐이다. 보낼 때는
 *   `ref`에서 직접 읽는다 — 조합 중인 마지막 글자가 `draft`엔 아직 없을 수 있다.
 * - **안내 글씨에 브라우저의 `placeholder`를 안 쓴다.** 한글은 한 글자가
 *   여러 번에 걸쳐 조합되는데 iOS는 그 조합 중인 글자를 '내용 없음'으로 봐서
 *   첫 글자를 칠 때 `댓글 남기기`가 번쩍인다. 직접 그리고 **초점이 가는 순간
 *   치운다** — 글자가 들어왔는지가 아니라 초점이 기준이라 번쩍일 틈이 없다.
 * - **`등록`은 `onMouseDown`을 막는다.** 안 막으면 단추가 초점을 가져가
 *   입력칸이 풀리고, 폰에서는 키보드가 함께 내려간다.
 *
 * `onSubmit`이 `true`를 돌려주면 칸을 비운다. 실패했으면 적은 글을 남겨
 * 다시 쓰지 않게 한다.
 */
export function CommentForm({ onSubmit }: { onSubmit: (body: string) => Promise<boolean> }) {
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
                    disabled={sending || !draft.trim()}>
                등록
            </button>
        </div>
    );
}
