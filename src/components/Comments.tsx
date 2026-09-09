import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { readableError } from '../lib/errors';
import { personLabel, type Person } from '../lib/types';
import { Avatar } from './Avatar';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';
import { NativeComposer, composerReady, composerSkin, hush } from '../lib/composer';

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
    const wrapRef = useRef<HTMLDivElement>(null);
    const [focused, setFocused] = useState(false);
    const [sending, setSending] = useState(false);
    /** 앱에 네이티브 글칸이 있는가. 없으면 예전 웹 칸을 그대로 쓴다. */
    const [canNative, setCanNative] = useState(false);
    /** 지금 이 칸이 네이티브 바를 띄워 두고 있는가. */
    const [barUp, setBarUp] = useState(false);
    /** 적은 글이 있는가. **state가 아니라 곁에 적어 둔다** — 글자마다
        state에 넣으면 댓글 목록이 통째로 다시 그려진다. 읽는 곳(안내
        글씨·`등록` 단추)은 둘 다 초점이 오갈 때만 본다. */
    const hasText = useRef(false);
    /** 지난번 글자 수. 줄어들 때만 되돌려 다시 잰다. */
    const lastLen = useRef(0);
    /** 다음 프레임에 재기로 예약해 둔 것. 0이면 예약이 없다. */
    const growAt = useRef(0);

    /**
     * 적은 글에 맞춰 칸을 늘린다. `textarea`는 스스로 안 늘어나서, 놔두면
     * 여러 줄을 적을 때 앞줄이 위로 잘려 안 보인다.
     *
     * **대화 입력칸(`growDraft` in Chat.tsx)과 같은 방식이다. 한쪽만 고치지
     * 말 것.** 재는 일을 **다음 프레임으로 미루는 것이 핵심이다** — 글자를
     * 치는 그 순간에 `scrollHeight`를 읽으면, 한글을 고쳐 쓰느라 WebKit이
     * 칸을 비웠다 채우는 그 사이에 배치가 다시 잡혀 **빈 칸이 한 프레임
     * 그려진다**(글씨가 깜빡이는 것으로 보인다).
     * `box-sizing: border-box`라 테두리 두께를 더해 줘야 잔스크롤이 안 남는다.
     * 위 한도는 CSS(`max-height`)가 잡는다.
     */
    const measure = () => {
        const el = ref.current;
        if (!el) return;
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

    const grow = () => {
        if (growAt.current) return;
        growAt.current = requestAnimationFrame(() => {
            growAt.current = 0;
            measure();
        });
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
        // 예약해 둔 재기를 걷어낸다 — 안 그러면 비운 칸이 다시 늘어난다.
        if (growAt.current) { cancelAnimationFrame(growAt.current); growAt.current = 0; }
    };

    /* ── 네이티브 글칸 ──────────────────────────────────────────
     *
     * 앱에 그 플러그인이 있으면 **웹 칸 대신 화면 아래 네이티브 바에서
     * 적는다.** 대화 입력칸과 같은 바이고 같은 까닭이다 — 천지인 깜빡임과
     * 키보드 엇박자는 웹 글칸인 한 안 없어진다(`ComposerBar.swift` 머리말).
     *
     * **대화와 다른 점은 둘이다.** 여기서는 바가 **적는 동안만** 뜬다
     * (댓글 칸은 화면 가운데 있는 칸이지 붙박이 입력줄이 아니다), 그리고
     * `+`(사진)와 이모티콘 단추가 없다.
     *
     * **덤으로 `키보드가 댓글 칸을 가린다`가 아예 없어진다** — 적는 자리가
     * 키보드에 붙어 있으므로 가릴 것이 없다(`lib/keyboard.ts`의 `reveal`은
     * 웹 칸일 때만 돌게 남는다).
     */
    useEffect(() => { void composerReady().then(setCanNative); }, []);

    /** 늘 최신 것을 가리키게 해 둔다 — 듣기는 한 번만 거는데 `onSubmit`은
        화면이 다시 그려질 때마다 새 함수다. */
    const live = useRef({ onSubmit, sending });
    useEffect(() => { live.current = { onSubmit, sending }; });

    const closeAt = useRef(0);
    const barRef = useRef(false);

    const closeBar = () => {
        barRef.current = false;
        setBarUp(false);
        document.body.classList.remove('nc-typing');
        void hush(NativeComposer.detach());
    };

    useEffect(() => {
        if (!canNative) return;
        let dead = false;
        let drops: Array<() => void> = [];

        /** 바에서 적은 글을 웹 칸에도 옮겨 적어 둔다 — 바를 닫아도 적던
            글이 남아 있어야 한다. */
        const mirror = (text: string) => {
            hasText.current = text.trim() !== '';
            if (ref.current) ref.current.value = text;
            grow();
        };

        const sendIt = async (text: string) => {
            const body = text.trim();
            if (!body || live.current.sending) return;
            setSending(true);
            const ok = await live.current.onSubmit(body);
            setSending(false);
            if (!ok) return;            // 실패하면 적은 글을 남긴다
            void hush(NativeComposer.setText({ text: '', sel: 0 }));
            mirror('');
            if (ref.current) ref.current.style.height = '';
            lastLen.current = 0;
        };

        void (async () => {
            const hs = await Promise.all([
                NativeComposer.addListener('change', e => mirror(e.text)),
                NativeComposer.addListener('send', e => { void sendIt(e.text); }),
                NativeComposer.addListener('focus', e => {
                    clearTimeout(closeAt.current);
                    // 초점이 떠도 **곧바로 접지 않는다** — 보내기를 누를 때
                    // 잠깐 떴다 돌아오는 기기가 있다(웹 칸에서 겪은 그것이다).
                    if (!e.on) closeAt.current = window.setTimeout(closeBar, 250);
                }),
                NativeComposer.addListener('height', e => {
                    const h = Math.round(e.height);
                    if (h > 0) document.documentElement.style.setProperty('--composer', `${h}px`);
                }),
            ]);
            if (dead) { hs.forEach(h => { void h.remove(); }); return; }
            drops = hs.map(h => () => { void h.remove(); });
        })();

        return () => {
            dead = true;
            clearTimeout(closeAt.current);
            drops.forEach(f => f());
            drops = [];
            if (barRef.current) closeBar();
        };
        /* 듣기는 **한 번만** 건다. 안에서 쓰는 것들은 전부 ref이거나
           위의 `live`를 거치므로 다시 걸 이유가 없다. */
    }, [canNative]);

    /** 웹 칸을 누르면 네이티브 바를 세우고 거기에 초점을 준다. */
    const openBar = () => {
        void (async () => {
            await hush(NativeComposer.attach(composerSkin({
                showPlus: false, showIcon: false,
                hintText: '댓글 남기기',
                text: ref.current?.value ?? '',
            })));
            barRef.current = true;
            setBarUp(true);
            document.body.classList.add('nc-typing');
            await hush(NativeComposer.focus());
            /* 바에 가리지 않게 칸을 끌어 올린다. **여러 번 부른다** —
               웹뷰가 줄어드는 것은 키보드보다 0.45초 늦어서(플러그인의
               그 타이밍이다) 한 번만 하면 줄기 전 크기로 계산된다. */
            const up = () => wrapRef.current?.scrollIntoView({ block: 'end' });
            requestAnimationFrame(up);
            setTimeout(up, 300);
            setTimeout(up, 650);
        })();
    };

    return (
        <div className="comment-form" ref={wrapRef}>
            <div className="comment-field grow">
                <textarea
                    ref={ref}
                    className="textarea"
                    onChange={e => { hasText.current = e.target.value.trim() !== ''; grow(); }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    /* 네이티브 바를 쓰는 판에서는 이 칸이 **누르는 자리**일
                       뿐이다. `readOnly`라 아이폰이 키보드를 안 올리고,
                       `onMouseDown`을 막아 초점도 안 넘어간다. */
                    readOnly={canNative}
                    /* **`pointerdown`이다.** `mousedown`은 손을 뗄 때쯤에야
                       와서 누른 뒤 한 박자 쉬고 바가 뜬다 — 이 칸은 누르는
                       것이 곧 일의 시작이라 그 틈이 그대로 느껴진다. */
                    onPointerDown={canNative ? (e => { e.preventDefault(); openBar(); }) : undefined}
                    rows={1} maxLength={500}
                    aria-label="댓글 입력"
                />
                {!focused && !barUp && !hasText.current
                    && <span className="comment-hint">댓글 남기기</span>}
            </div>
            <button className="btn primary" onClick={submit}
                    onMouseDown={e => e.preventDefault()}
                    disabled={sending || (!focused && !barUp && !hasText.current)}>
                등록
            </button>
        </div>
    );
}
