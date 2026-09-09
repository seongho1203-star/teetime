import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { readableError } from '../lib/errors';
import { personLabel, type Person } from '../lib/types';
import { Avatar } from './Avatar';
import { useConfirm } from './Confirm';
import { useToast } from './Toast';
import { NativeComposer, composerReady, composerSkin, hush, ncLog } from '../lib/composer';

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
    /** 바의 글칸에 초점이 갔는가(= 키보드가 올라왔는가). 아래 `openBar`의
        되풀이가 언제 멈출지를 이 값으로 정한다. */
    const barFocused = useRef(false);
    /** 초점을 **되찾아도 되는 때**가 언제까지인가(연 뒤 잠깐).
        그 안에 초점이 떠나면 사람이 내린 것이 아니라 웹뷰가 뺏어 간 것이다. */
    const grabUntil = useRef(0);

    /**
     * **임시 진단 줄(앱에서만).** 3판에서 `댓글창이 안 올라와`(키보드는
     * 뜨는데 바가 안 보인다)는 제보를 코드만 봐서는 못 가려서, 폰에서 값을
     * 읽어 오려고 붙였다 — `kb-probe`와 같은 방식이다. 바가 알려 오는 것
     * (높이·자리·초점)과 우리가 부른 것(attach)을 시각과 함께 적는다.
     * 원인이 갈리면 함께 지운다.
     */
    const probeRef = useRef<HTMLPreElement>(null);
    const probeT0 = useRef(0);
    const probeRows = useRef<string[]>([]);
    const log = (s: string) => {
        const el = probeRef.current;
        if (!el) return;
        const t = Math.round(performance.now() - probeT0.current);
        const vv = Math.round(window.visualViewport?.height ?? 0);
        probeRows.current.push(`${String(t).padStart(4)} ${s} vv${vv} c${document.documentElement.clientHeight}`);
        if (probeRows.current.length > 14) probeRows.current.shift();
        el.textContent = `댓글 nc${document.documentElement.classList.contains('nc2') ? '2+' : '1'}\n`
            + probeRows.current.join('\n');
    };

    const closeBar = () => {
        log('닫음');
        barRef.current = false;
        barFocused.current = false;
        grabUntil.current = 0;
        setBarUp(false);
        document.body.classList.remove('nc-typing');
        /* 미리 세워 둔 것이면 **떼지 않고 도로 감춘다** — 다음에 또 빨리 뜬다. */
        if (warm.current) void hush(NativeComposer.setState({ hidden: true }));
        else void hush(NativeComposer.detach());
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
                NativeComposer.addListener('kb', e => {
                    log(`키보드${e.on ? '올림' : '내림'} 늦음${Math.round(Date.now() - e.at)}`);
                }),
                NativeComposer.addListener('focus', e => {
                    log(`초점${e.on ? 'O' : 'X'}`);
                    barFocused.current = e.on;
                    clearTimeout(closeAt.current);
                    if (e.on) return;
                    /* **연 직후에 떠난 것이면 그 자리에서 도로 잡는다.**
                       아이폰은 손을 떼는 순간 웹뷰가 first responder를 도로
                       가져가는데, 그때 사람은 아무것도 안 한 것이므로 접을
                       일이 아니다. **기다렸다 잡으면 그 사이가 그대로 보인다** —
                       키보드가 올라오다 내려갔다 다시 올라온다(실기기 제보).
                       3판 앱은 아예 안 놓으므로(`holdFocus`) 여기까지 안 온다.
                       이 줄은 **그 판이 없는 옛 앱** 몫이다. */
                    if (Date.now() < grabUntil.current) {
                        void hush(NativeComposer.focus());
                        return;
                    }
                    // 초점이 떠도 **곧바로 접지 않는다** — 보내기를 누를 때
                    // 잠깐 떴다 돌아오는 기기가 있다(웹 칸에서 겪은 그것이다).
                    closeAt.current = window.setTimeout(closeBar, 250);
                }),
                NativeComposer.addListener('height', e => {
                    const h = Math.round(e.height);
                    /* 3판부터 `y`(바 윗변, 화면 기준)·`fr`(초점)·`kb`도 실려 온다 —
                       바가 **어디에** 섰는지를 보려는 진단값이다. */
                    const x = e as { y?: number; fr?: boolean; kb?: boolean };
                    log(`바 h${h}` + (x.y !== undefined ? ` y${Math.round(x.y)} fr${x.fr ? 1 : 0} kb${x.kb ? 1 : 0}` : ''));
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

    /**
     * **바를 미리 세워 두고 감춰 둔다**(6판부터).
     *
     * 누를 때 세우면 그때 `UITextView`를 만들고 자리를 잡느라 **바가 서기까지
     * 50ms**가 걸린다(진단 — `누름 0` → `바 51`. 사용자 제보 — `뜨는게
     * 텀이있는데`). 화면이 뜰 때 미리 세워 감춰 두면, 누를 때는 **감춘 것만
     * 뒤집으면 되어** 다리를 한 번만 건넌다.
     *
     * **감춰 둔 바는 아무 일도 안 한다** — 그리지도, 손짓을 받지도 않는다.
     * `hidden`을 모르는 앱은 미리 세우면 바가 그대로 **보이므로**
     * **7판부터만** 한다(그 값이 들어간 판이다).
     */
    const warm = useRef(false);
    useEffect(() => {
        if (!canNative || ncLog.v < 7) return;
        let dead = false;
        void (async () => {
            await hush(NativeComposer.attach(composerSkin({
                showPlus: false, showIcon: false,
                hintText: '댓글 남기기', tabH: 0, hidden: true, focus: false,
            })));
            if (!dead) warm.current = true;
        })();
        return () => {
            dead = true;
            warm.current = false;
            if (!barRef.current) void hush(NativeComposer.detach());
        };
    }, [canNative]);

    /** 웹 칸을 누르면 네이티브 바를 세우고 거기에 초점을 준다. */
    const openBar = () => {
        void (async () => {
            clearTimeout(closeAt.current);
            barFocused.current = false;
            probeT0.current = performance.now();
            probeRows.current = [];
            log('누름');
            /* 잠시 동안은 초점이 떠나도 **사람이 내린 것으로 안 본다**
               (위 `focus` 듣는 곳 참고). */
            grabUntil.current = Date.now() + 800;
            let attached = true;
            /* **미리 세워 뒀으면 내보이기만 한다** — 다리를 한 번만 건넌다
               (위 `warm` 주석). 글은 `text`로 함께 넘겨 웹 칸의 것을 옮긴다. */
            if (warm.current) {
                await NativeComposer.setState({
                    hidden: false, focus: true, text: ref.current?.value ?? '',
                }).catch(() => { attached = false; });
                log(attached ? '내보임' : '내보이기 실패');
            } else {
            await NativeComposer.attach(composerSkin({
                showPlus: false, showIcon: false,
                hintText: '댓글 남기기',
                /* **여기서는 탭바 자리를 안 비운다.** 이 바는 적는 동안,
                   곧 키보드가 올라와 있는 동안에만 뜨는데 그때는 탭바가
                   이미 감춰져 있다(`nc-typing`). 비워 두면 iOS가 키보드
                   프레임을 그만큼 크게 재어 웹뷰가 더 줄고, 목록 아래에
                   검은 띠가 남는다(대화에서 실제로 그랬다). */
                tabH: 0,
                text: ref.current?.value ?? '',
                /* **세우면서 그 자리에서 초점을 준다.** 세운 뒤에 `focus()`를
                   따로 부르면 그때는 바가 아직 창에 안 붙어 있어 조용히
                   실패한다 — 바는 떴는데 키보드가 안 올라오던 자리다
                   (`NativeComposerPlugin`의 `grabFocus` 주석). */
                focus: true,
            })).catch((err: unknown) => {
                attached = false;
                log(`attach 실패 ${String((err as { message?: string })?.message ?? err).slice(0, 24)}`);
            });
            if (attached) log('attach 됨');
            }
            barRef.current = true;
            setBarUp(true);
            document.body.classList.add('nc-typing');
            /* **초점이 올 때까지 몇 번 더 조른다.** 초점 주기는 `attach`가
               그 자리에서 맡지만(위 `focus: true`), 그 되풀이는 **앱 안에**
               있어서 아직 새 앱을 안 깐 폰에는 없다 — 웹은 밀면 바로
               올라가므로 여기서도 같은 일을 해 두면 옛 앱에서도 키보드가 뜬다.
               **왔다가 뺏기는 것은 여기서 안 본다** — 그건 위 `focus` 듣는
               곳이 그 자리에서 도로 잡는다(여기서 보면 한 박자 늦어 키보드가
               오르내리는 것이 눈에 보인다). */
            for (let i = 0; i < 10 && barRef.current && !barFocused.current; i++) {
                await hush(NativeComposer.focus());
                await new Promise(r => setTimeout(r, 80));
            }
            /* 바에 가리지 않게 칸을 끌어 올린다. **여러 번 부른다** —
               웹뷰가 줄어드는 것은 키보드보다 0.45초 늦어서(플러그인의
               그 타이밍이다) 한 번만 하면 줄기 전 크기로 계산된다. */
            const up = () => { log('끌어올림'); wrapRef.current?.scrollIntoView({ block: 'end' }); };
            requestAnimationFrame(up);
            setTimeout(up, 300);
            setTimeout(up, 650);
            /* **창이 줄어드는 그 순간에도 한 번 더.** 앱은 웹뷰를 키보드보다
               0.45~0.8초 늦게 줄이는데(실기기 진단 — `c512`가 800ms에 찍혔다),
               위 셋은 그 전에 다 돌아서 **줄기 전 크기로 굴린 것이 키보드
               뒤로 들어갔다** — 키보드는 뜨는데 댓글 칸은 안 올라오던 자리다
               (사용자 제보 — `댓글창이 안올라와`). 창이 줄면 `resize`가 오므로
               그때 굴리면 맞다. 1.5초만 듣는다. */
            window.addEventListener('resize', up);
            setTimeout(() => window.removeEventListener('resize', up), 1500);
        })();
    };

    return (
        <div className="comment-form" ref={wrapRef}>
            {/* 임시 진단 줄 — 위 `probeRef` 주석. 원인이 갈리면 함께 지운다. */}
            {canNative && <pre className="kb-probe fixed" ref={probeRef} />}
            <div className="comment-field grow">
                <textarea
                    ref={ref}
                    className="textarea"
                    onChange={e => { hasText.current = e.target.value.trim() !== ''; grow(); }}
                    /* 네이티브 바를 쓰는 판에서 이 칸에 초점이 오면 **곧바로
                       뗀다.** 웹 칸이 초점을 쥐면 웹뷰가 first responder가 되어
                       네이티브 바의 글칸에서 키보드를 빼앗는다 — 실기기에서
                       키보드 위에 웹 글칸용 `∧ ∨ ✓` 줄이 뜬 것이 그 자국이다
                       (`댓글창은 키보드가 안 올라오다가 여러 번 시도하면
                       올라오긴 하는데 이상해`). */
                    onFocus={e => { if (canNative) e.target.blur(); else setFocused(true); }}
                    onBlur={() => setFocused(false)}
                    /* 네이티브 바를 쓰는 판에서는 이 칸이 **누르는 자리**일
                       뿐이다. 손짓은 위에 얹은 `.comment-tap`이 받는다 —
                       `readOnly`·`preventDefault`로는 아이폰이 초점 주는 것을
                       못 막았다(위 `onFocus` 주석). */
                    readOnly={canNative}
                    tabIndex={canNative ? -1 : undefined}
                    rows={1} maxLength={500}
                    aria-label="댓글 입력"
                />
                {/* **누르는 자리를 웹 칸 위에 따로 얹는다.** 웹 칸을 직접
                    누르면 아이폰이 `readOnly`여도 초점을 주고 키보드를
                    웹 쪽으로 가져간다. 이 덮개가 손짓을 먼저 받아 웹 칸에는
                    아예 안 닿게 한다. **`pointerdown`이다** — `click`은 손을
                    뗄 때쯤에야 와서 한 박자 쉬고 바가 뜬다. */}
                {canNative && (
                    <div className="comment-tap" role="button" aria-label="댓글 적기"
                         onPointerDown={e => { e.preventDefault(); openBar(); }} />
                )}
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
