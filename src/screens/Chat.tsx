import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDate, formatTime, kstDate, kstMinute } from '../lib/format';
import type { Message, Profile, Room } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { shrinkImage } from '../lib/image';
import { markSeen } from '../lib/unread';
import './Chat.css';

/** 한 번에 불러오는 지난 대화 수. 위로 올리면 더 받는다. */
const PAGE = 50;

interface Loaded { room: Room | null; people: Profile[]; }

export function Chat() {
    const { session } = useAuth();
    const me = session!.user.id;
    const toast = useToast();

    const [messages, setMessages] = useState<Message[]>([]);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [focused, setFocused] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const chatRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);
    // 맨 아래를 보고 있을 때만 새 글에 따라 내려간다. 지난 대화를 읽는
    // 도중에 남이 글을 쓰면 화면이 튀어서는 안 된다.
    const atBottom = useRef(true);

    const { data, loading, error } = useAsync<Loaded>(async () => {
        const [room, people] = await Promise.all([
            supabase.from('rooms').select('*').is('round_id', null)
                    .order('created_at').limit(1).maybeSingle(),
            fetchProfiles(),
        ]);
        return { room: unwrap(room), people };
    }, []);

    const roomId = data?.room?.id;
    const names = byId(data?.people ?? []);

    // 첫 묶음을 불러온다. 최근 것부터 받아 뒤집는다.
    useEffect(() => {
        if (!roomId) return;
        let alive = true;
        (async () => {
            const { data: rows, error: err } = await supabase
                .from('messages').select('*').eq('room_id', roomId)
                .order('created_at', { ascending: false }).limit(PAGE);
            if (!alive) return;
            if (err) { toast(readableError(err), 'error'); return; }
            const list = (rows ?? []).slice().reverse();
            setMessages(list);
            setHasMore((rows ?? []).length === PAGE);
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId]);

    // 새 글은 통째로 다시 불러오지 않고 **들어온 행만 덧붙인다** —
    // 대화는 지난 것이 바뀌지 않으므로 이 방식이 맞고, 훨씬 가볍다.
    useEffect(() => {
        if (!roomId) return;
        const channel = supabase
            .channel(`chat:${roomId}`)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
                payload => {
                    const row = payload.new as Message;
                    setMessages(prev =>
                        // 내가 보낸 글은 이미 넣어 두었다. 두 번 그리지 않는다.
                        prev.some(m => m.id === row.id) ? prev : [...prev, row]);
                })
            .on('postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'messages' },
                payload => {
                    const gone = payload.old as { id?: string };
                    if (gone.id) setMessages(prev => prev.filter(m => m.id !== gone.id));
                })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [roomId]);

    /** 맨 아래를 보고 있었으면 다시 맨 아래로 붙인다. */
    const pinBottom = useCallback(() => {
        const el = listRef.current;
        if (el && atBottom.current) el.scrollTop = el.scrollHeight;
    }, []);

    // 그리기가 끝난 프레임에 해야 높이가 확정된다.
    useLayoutEffect(() => { pinBottom(); }, [messages, pinBottom]);

    // 이 화면을 보고 있으면 안 읽음이 쌓이지 않는다. 새 글이 들어올 때마다
    // 다시 남겨 두어야 탭바의 빨간 숫자가 곧바로 사라진다.
    useEffect(() => { markSeen('chat', me); }, [messages, me]);

    /**
     * 키보드가 올라온 만큼 화면을 줄인다.
     *
     * 이 화면만 `100dvh`로 제 안에서 스크롤하는데, `dvh`는 브라우저 막대는
     * 세어도 **키보드는 세지 않는다.** 그래서 키보드가 뜨면 iOS가 페이지를
     * 통째로 밀어 올리고, 바닥에 붙어 있던 탭바와 입력칸이 키보드 위에
     * 겹겹이 쌓여 **대화가 한 줄도 안 보였다.**
     *
     * `visualViewport`가 실제로 보이는 높이를 알려 주므로 그만큼을 `--kb`에
     * 담아 화면 높이에서 뺀다. 겹친 동안에는 탭바를 감춰(`kb-open`) 자리를
     * 되찾고, iOS가 밀어 올린 페이지는 되돌려 놓는다.
     * 키보드가 아닌 잔잔한 높이 변화(주소 막대가 접히는 것 등)에 걸리지
     * 않도록 120px 넘게 가릴 때만 키보드로 친다.
     *
     * **입력칸을 누른 것 자체도 신호로 쓴다.** `visualViewport`가 언제
     * 알려 줄지는 기기마다 다르고, iOS는 키보드가 다 올라온 뒤에야
     * 알려 주기도 한다. 누르는 순간 탭바부터 감춰 두면 그 사이에도
     * 대화가 가려지지 않는다. 높이는 알려 줄 때 채워 넣는다.
     */
    const kbRef = useRef({ typing: false, vh: 0, frame: 0, locked: false, width: 0 });

    /**
     * 대화 화면을 **지금 보이는 높이**에 맞춘다.
     *
     * **가린 높이(`innerHeight - vv.height`)로 키보드를 알아채면 안 된다.**
     * 아이폰 홈 화면 앱에서는 `window.innerHeight`까지 키보드만큼 줄어든다
     * (폰에서 707 → 333으로 쟀다). 그러면 그 뺄셈이 늘 0이라 '키보드가
     * 올라왔다'가 한 번도 참이 되지 않고, `--vvh`도 안 걸린다. 대화 화면이
     * `100dvh`(707)로 남으니 보이는 화면(333)보다 커져 **페이지가 스크롤되고**,
     * 그 스크롤을 iOS가 입력칸 쪽으로 도로 끌어당긴다 — 그 줄다리기가
     * 입력칸을 잡고 위로 끌 때 떨리던 정체였다(아래로는 이미 끝이라 멀쩡했다).
     *
     * 그래서 **키보드가 올라왔는지는 초점으로 알고**(이 화면에서 키보드를
     * 올리는 건 입력칸뿐이다), 높이는 `vv.height`를 그대로 쓴다.
     *
     * **자리를 잡으면 더는 재지 않는다(`locked`).** 끄는 동안 이 값들이
     * 크게 흔들리는데, 그때마다 다시 재면 그것이 또 떨림이 된다. 키보드는
     * 글을 쓰는 동안 크기가 바뀌지 않으므로 한 번 정하면 그만이다.
     */
    const applyKeyboard = useCallback((force = false) => {
        const vv = window.visualViewport;
        const s = kbRef.current;
        const vh = Math.round(vv ? vv.height : window.innerHeight);
        // **키보드 높이는 `documentElement.clientHeight`에서 잰다.** 이 값은
        // 문서가 놓인 자리(707)라 키보드가 떠도 안 줄어든다 —
        // `window.innerHeight`는 iOS 홈 화면 앱에서 함께 줄어들어 못 쓴다.
        // 초점은 그보다 먼저 오는 신호라 함께 본다.
        const gap = document.documentElement.clientHeight - vh;
        const open = s.typing || gap > 120;
        document.body.classList.toggle('kb-open', open);
        // 문서를 굴리는 주체는 브라우저마다 다르다(iOS는 html). 둘 다 잠근다.
        document.documentElement.classList.toggle('kb-open', open);

        // 붙박아 둔 동안에는 화면 크기를 건드리지 않는다. 가로세로를 돌리면
        // 그때는 다시 재야 하므로 폭이 바뀐 것은 예외로 둔다.
        if (s.locked && window.innerWidth === s.width) return;
        if (!force && Math.abs(vh - s.vh) < 8) return;
        s.vh = vh;
        s.width = window.innerWidth;

        const root = document.documentElement.style;
        if (open) {
            root.setProperty('--vvh', `${vh}px`);
            root.setProperty('--kb', `${Math.max(0, gap)}px`);
            // 대화 화면이 보이는 높이에 딱 맞으면 페이지는 굴러갈 데가 없다.
            // 그 전에 iOS가 밀어 둔 것만 한 번 되돌려 놓는다.
            if (window.scrollY) window.scrollTo(0, 0);
            const el = listRef.current;
            if (el && atBottom.current) el.scrollTop = el.scrollHeight;
        } else {
            // 키보드가 없을 때는 지운다 — 남겨 두면 옛 높이가 굳는다.
            root.removeProperty('--vvh');
            root.setProperty('--kb', '0px');
        }
    }, []);

    /* ── 진단 (임시) ────────────────────────────────────────────
     *
     * 끌 때 무엇이 움직이는지 폰에서 직접 재려고 둔 것이다. 헤드리스에는
     * 키보드가 없어 이 손짓을 흉내 낼 수 없고, 짐작으로 세 번 고쳤다가
     * 세 번 다 빗나갔다. 손을 뗀 뒤에도 남도록 **최솟값~최댓값**을 모은다
     * (끄는 동안에는 iOS가 화면을 다시 그리지 않을 수 있다).
     * **떨림을 잡으면 이 블록과 `.chat-diag`를 지울 것.**
     */
    const diagRef = useRef<HTMLDivElement>(null);
    const blank = () => ({ oT: [0, 0], fw: [0, 0], n: 0, ts: 0, tm: 0, first: true });
    const diag = useRef(blank());

    /** 손을 대는 순간부터 다시 잰다 — 그래야 **끄는 동안**만 남는다. */
    const resetDiag = useCallback(() => { diag.current = blank(); }, []);

    const noteDiag = useCallback(() => {
        const vv = window.visualViewport;
        if (!vv) return;
        const d = diag.current;
        const put = (a: number[], v: number) => {
            if (d.first) { a[0] = v; a[1] = v; return; }
            a[0] = Math.min(a[0], v); a[1] = Math.max(a[1], v);
        };
        // iOS가 민 양과, 우리가 상쇄하려고 실제로 발라 놓은 양. 이 둘이
        // 같은데도 화면이 움직인다면, 손짓이 도는 동안 iOS가 우리 그림을
        // 반영하지 않는다는 뜻이고 — 그건 웹앱이 손쓸 수 없는 자리다.
        put(d.oT, Math.round(vv.offsetTop));
        const t = chatRef.current?.style.transform ?? '';
        put(d.fw, Number(/translateY\((-?\d+)px\)/.exec(t)?.[1] ?? 0));
        d.first = false;
        d.n++;
        const el = diagRef.current;
        if (el) {
            const span = (a: number[]) => (a[0] === a[1] ? `${a[0]}` : `${a[0]}~${a[1]}`);
            const chat = Math.round(chatRef.current?.getBoundingClientRect().height ?? 0);
            el.textContent =
                `밀림 ${span(d.oT)} · 따라 ${span(d.fw)} · 대화 ${chat}`
                + ` · 목록손짓 ${d.ts}/${d.tm} · 초점 ${kbRef.current.typing ? 'O' : 'X'}`
                + ` · 신호 ${d.n}`;
        }
    }, []);

    /** 한 프레임에 한 번만 재도록 모은다. 끄는 동안 이벤트가 쏟아진다. */
    const syncKeyboard = useCallback(() => {
        const s = kbRef.current;
        if (s.frame) return;
        s.frame = requestAnimationFrame(() => { s.frame = 0; applyKeyboard(); });
    }, [applyKeyboard]);

    /**
     * 밀려 올라간 화면을 **손을 뗀 뒤에** 제자리로 돌린다.
     *
     * 대화 화면을 보이는 높이에 맞추고 나니 떨림은 멎었는데, 이번에는
     * iOS가 밀어 올린 화면이 그대로 남아 대화가 위로 사라졌다. 밀리는
     * 도중에 되돌리면 손가락과 서로 밀쳐 그게 다시 떨림이 되므로
     * (한때 `transform`으로 따라가 보았다가 더 나빠져 되돌렸다),
     * **움직임이 멎고 120ms 뒤에** 한 번만 되돌린다.
     */
    const settleTimer = useRef(0);

    /**
     * **밀린 만큼 따라 내려가던 것을 뺐다.**
     *
     * 폰에서 `따라 0~374`로 값이 제대로 발리는 것까지 확인했는데도 입력칸이
     * 그대로 움직였다. 키보드가 올라와 있을 때 iOS는 `position: fixed`를
     * 이미 **보이는 화면**에 붙여 놓는다 — 거기에 우리가 밀린 양을 또
     * 더하고 있었으니, 상쇄가 아니라 두 번 움직이게 만든 셈이다.
     * `.chat`은 `fixed`로만 두고 손대지 않는 것이 맞다.
     */
    const clearFollow = () => {
        const el = chatRef.current;
        if (el && el.style.transform) el.style.transform = '';
    };

    const watchViewport = useCallback(() => {
        clearFollow();
        noteDiag();
        if (!document.body.classList.contains('kb-open')) return;
        clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(() => {
            if (!document.body.classList.contains('kb-open')) return;
            if (window.scrollY) window.scrollTo(0, 0);
            const doc = document.scrollingElement;
            if (doc && doc.scrollTop) doc.scrollTop = 0;
        }, 120);
    }, [noteDiag]);

    useEffect(() => {
        const vv = window.visualViewport;
        const state = kbRef.current;
        applyKeyboard(true);
        vv?.addEventListener('resize', syncKeyboard);
        vv?.addEventListener('scroll', syncKeyboard);
        vv?.addEventListener('resize', watchViewport);
        vv?.addEventListener('scroll', watchViewport);
        // 문서가 굴러간 것은 창의 scroll로도 온다. iOS는 둘 중 어느 쪽으로
        // 밀지 정해져 있지 않아 양쪽을 다 듣는다.
        window.addEventListener('scroll', watchViewport, { passive: true });
        return () => {
            window.removeEventListener('scroll', watchViewport);
            clearTimeout(settleTimer.current);
            vv?.removeEventListener('resize', syncKeyboard);
            vv?.removeEventListener('scroll', syncKeyboard);
            vv?.removeEventListener('resize', watchViewport);
            vv?.removeEventListener('scroll', watchViewport);
            cancelAnimationFrame(state.frame);
            document.documentElement.style.removeProperty('--kb');
            document.documentElement.style.removeProperty('--vvh');
            document.body.classList.remove('kb-open');
            document.documentElement.classList.remove('kb-open');
        };
    }, [applyKeyboard, syncKeyboard, watchViewport]);

    const blurTimer = useRef(0);

    const onComposerFocus = () => {
        clearTimeout(blurTimer.current);
        const s = kbRef.current;
        s.typing = true;
        s.locked = false;
        setFocused(true);
        applyKeyboard(true);
        noteDiag();
        // 키보드가 올라오는 동안에도 높이가 여러 번 바뀐다. 다 올라온 뒤에
        // **한 번 붙박아 두고** 그 뒤로는 다시 재지 않는다.
        setTimeout(() => { applyKeyboard(true); noteDiag(); }, 120);
        setTimeout(() => { applyKeyboard(true); noteDiag(); }, 400);
        setTimeout(() => {
            applyKeyboard(true);
            s.locked = true;
            noteDiag();
        }, 650);
    };

    /**
     * 초점이 떠도 **곧바로 접지 않는다.**
     *
     * 보내기 버튼을 누를 때 잠깐 초점이 떴다가 돌아오는 기기가 있는데,
     * 그때마다 화면을 접었다 폈다 하면 대화가 껑충 뛴다. 조금 기다렸다가
     * 그래도 안 돌아오면 그때 접는다.
     */
    const onComposerBlur = () => {
        clearTimeout(blurTimer.current);
        // **붙박기는 곧바로 푼다.** 키보드는 0.25초쯤 미끄러져 내려가는데,
        // 그동안 보이는 높이가 333에서 707로 조금씩 커진다. 붙박아 둔 채로
        // 두면 그 끝에서 화면이 한 번에 툭 늘어나 뚝뚝 끊겨 보인다.
        // 풀어 두면 매 단계 따라 늘어나 카톡처럼 함께 내려간다.
        kbRef.current.locked = false;
        blurTimer.current = window.setTimeout(() => {
            kbRef.current.typing = false;
            setFocused(false);
            applyKeyboard(true);
        }, 150);
    };

    useEffect(() => () => clearTimeout(blurTimer.current), []);

    /** 진단 전용. 손짓이 우리에게 오는지 보려고 남겨 둔 자리다. */
    useEffect(() => {
        const chat = chatRef.current;
        if (!chat) return;

        // 진단: 손을 대면 다시 잰다. 예전에는 여기서 `touchmove`를 삼켜
        // 보려고도 했는데, 입력칸 위의 손짓은 iOS가 가져가 버려 이 핸들러가
        // 한 번도 안 불렸다(폰에서 `이동 0`으로 확인). 그래서 뺐다.
        const start = () => { resetDiag(); noteDiag(); };
        const moved = () => { noteDiag(); };

        chat.addEventListener('touchstart', start, { passive: true, capture: true });
        chat.addEventListener('touchmove', moved, { passive: true, capture: true });
        return () => {
            chat.removeEventListener('touchstart', start, true);
            chat.removeEventListener('touchmove', moved, true);
        };
    }, [roomId, noteDiag, resetDiag]);

    /**
     * **대화를 아래로 끌면 키보드가 함께 내려간다** — 카톡이 그렇다.
     *
     * 목록 위의 손짓은 우리에게 온다(입력칸 위의 것만 iOS가 가져간다).
     * 손가락이 40px 넘게 내려오면 초점을 놓아 키보드를 내린다. 카톡처럼
     * 대화를 훑어 내리는 동작이 곧 키보드를 치우는 동작이 된다.
     */
    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        let y0 = 0;
        let x0 = 0;
        const start = (e: TouchEvent) => {
            y0 = e.touches[0].clientY;
            x0 = e.touches[0].clientX;
            diag.current.ts++;
            noteDiag();
        };
        const move = (e: TouchEvent) => {
            diag.current.tm++;
            noteDiag();
            if (!kbRef.current.typing) return;
            const dy = e.touches[0].clientY - y0;
            const dx = Math.abs(e.touches[0].clientX - x0);
            // 세로로 내려가는 손짓일 때만. 좌우로 그은 것은 아니다.
            if (dy > 40 && dy > dx) taRef.current?.blur();
        };
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchmove', move, { passive: true });
        return () => {
            el.removeEventListener('touchstart', start);
            el.removeEventListener('touchmove', move);
        };
        // **`roomId`가 있어야 한다.** 대화를 불러오는 동안에는 화면에
        // 스피너만 있어 `.chat-list`가 없다. 그때 한 번 돌고 마는 효과는
        // ref가 비어 있어 그냥 돌아가고, 다시 돌 일이 없어 **손짓 듣기가
        // 영영 안 붙었다** (폰에서 `목록손짓 0/0`으로 드러났다).
    }, [roomId, noteDiag]);

    const onScroll = () => {
        const el = listRef.current;
        if (!el) return;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };

    const loadMore = async () => {
        const el = listRef.current;
        if (!roomId || !messages.length || !el) return;
        setLoadingMore(true);
        const before = messages[0].created_at;
        const prevHeight = el.scrollHeight;

        const { data: rows } = await supabase
            .from('messages').select('*').eq('room_id', roomId)
            .lt('created_at', before)
            .order('created_at', { ascending: false }).limit(PAGE);

        setMessages(prev => [...(rows ?? []).slice().reverse(), ...prev]);
        setHasMore((rows ?? []).length === PAGE);
        setLoadingMore(false);

        // 위에 글이 붙은 만큼 스크롤을 내려 읽던 자리를 지킨다.
        requestAnimationFrame(() => {
            atBottom.current = false;
            el.scrollTop = el.scrollHeight - prevHeight;
        });
    };

    /**
     * 입력칸을 비운다.
     *
     * **입력칸은 일부러 `value`로 묶지 않았다**(아래 textarea 주석 참고).
     * 그래서 비울 때 칸의 값도 손으로 지워야 한다.
     */
    const clearDraft = () => {
        if (taRef.current) taRef.current.value = '';
        setDraft('');
    };

    /** 지금 칸에 적힌 글. 칸이 값의 주인이므로 보낼 때는 칸에서 직접 읽는다 —
     *  한글 마지막 글자가 조합 중이면 `draft`에는 아직 안 와 있을 수 있다. */
    const currentDraft = () => (taRef.current?.value ?? draft).trim();

    /** 글 한 줄(또는 사진 한 장)을 보낸다. 보내기와 사진 올리기가 같이 쓴다. */
    const push = async (body: string, imageUrl: string | null) => {
        if (!roomId) return false;
        const { data: row, error: err } = await supabase
            .from('messages')
            // **사진이 없으면 image_url을 아예 보내지 않는다.** DB에 그 칸을
            // 아직 안 만들었어도(스키마를 다시 안 돌렸어도) 글은 그대로
            // 오가게 하려는 것이다. 사진만 그때 실패한다.
            .insert({ room_id: roomId, user_id: me, body, ...(imageUrl ? { image_url: imageUrl } : {}) })
            .select('*').single();
        if (err) { toast(readableError(err), 'error'); return false; }

        clearDraft();
        atBottom.current = true;
        // 실시간 이벤트가 오기 전에 먼저 그린다. 내 글이 늦게 뜨면 답답하다.
        if (row) setMessages(prev =>
            prev.some(m => m.id === (row as Message).id) ? prev : [...prev, row as Message]);
        return true;
    };

    /**
     * 보내고 나서도 **키보드를 내리지 않는다.**
     *
     * 버튼을 누르면 입력칸이 초점을 잃고, 그러면 키보드가 함께 내려간다 —
     * 한 마디 보낼 때마다 다시 눌러야 해서 카톡처럼 이어 치기가 안 됐다.
     * 막는 곳이 두 군데다: 버튼의 `onMouseDown`에서 기본 동작을 막아
     * **초점이 애초에 넘어가지 않게** 하고(이게 본체다), 그래도 넘어가는
     * 기기를 위해 여기서 손짓 안에서 **곧바로** 되돌린다.
     * 되돌리기는 반드시 `await` 앞이어야 한다 — 응답을 기다린 뒤에
     * `focus()`를 부르면 iOS가 사용자 손짓으로 안 쳐서 키보드가 안 올라온다.
     */
    const send = async () => {
        const body = currentDraft();
        if (!body || !roomId) return;
        taRef.current?.focus();
        setSending(true);
        await push(body, null);
        setSending(false);
        taRef.current?.focus();
    };

    /**
     * 사진을 골라 보낸다.
     *
     * 줄여서 Storage에 올린 뒤 **주소만** 글로 남긴다. 적어 둔 글이 있으면
     * 사진에 같이 붙는다 (카톡처럼 사진 밑에 한 줄).
     * 올리다 실패하면 글은 그대로 두어 다시 시도할 수 있게 한다.
     */
    const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // 같은 사진을 연달아 고를 수 있게 비워 둔다.
        e.target.value = '';
        if (!file || !roomId) return;
        if (!file.type.startsWith('image/')) {
            toast('사진만 올릴 수 있습니다.', 'error');
            return;
        }

        setUploading(true);
        try {
            const blob = await shrinkImage(file);
            const path = `${roomId}/${crypto.randomUUID()}.jpg`;
            const { error: upErr } = await supabase.storage
                .from('chat-photos')
                .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
            if (upErr) throw upErr;

            const { data: pub } = supabase.storage.from('chat-photos').getPublicUrl(path);
            await push(currentDraft(), pub.publicUrl);
        } catch (err) {
            toast(readableError(err), 'error');
        } finally {
            setUploading(false);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // PC에서는 Enter로 보내고 Shift+Enter로 줄을 바꾼다.
        // 모바일 키보드는 Enter가 줄바꿈이어야 해서 화면 폭으로 가른다.
        if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 640) {
            e.preventDefault();
            send();
        }
    };

    if (loading) return <div className="page center-fill"><div className="spinner" /></div>;
    if (error || !data?.room) {
        return (
            <div className="page">
                <h1 className="page-title">대화</h1>
                <div className="notice danger">
                    {error ?? '대화방을 찾지 못했습니다. schema.sql을 실행했는지 확인해 주세요.'}
                </div>
            </div>
        );
    }

    return (
        <div className="chat" ref={chatRef}>
            {/* 카톡처럼 제목 한 줄만 가운데 세운다. 설명 줄을 두었더니
                머리말이 두 겹이 되어 대화가 그만큼 내려앉았다. */}
            <div className="chat-head">
                <h1 className="chat-title">{data.room.name}</h1>
            </div>

            {/* 임시 진단 줄. 키보드가 올라와 있을 때만 보인다. 떨림을 잡으면 지운다. */}
            <div className="chat-diag" ref={diagRef} />

            <div className="chat-list" ref={listRef} onScroll={onScroll}>
                {hasMore && (
                    <button className="btn ghost sm chat-more" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? '불러오는 중…' : '지난 대화 더 보기'}
                    </button>
                )}
                {messages.length === 0 && (
                    <div className="empty">첫 마디를 남겨 보세요.</div>
                )}
                {messages.map((m, i) => {
                    const prev = messages[i - 1];
                    const next = messages[i + 1];
                    const newDay = !prev || kstDate(prev.created_at) !== kstDate(m.created_at);
                    // 카톡이 대화를 묶는 단위는 **같은 사람 · 같은 분**이다.
                    // 5분으로 묶어 봤는데 9시 09분과 9시 10분 글이 한 덩어리가
                    // 되어, 카톡이라면 이름이 다시 붙을 자리가 비어 보였다.
                    const sameBlock = (a?: Message, b?: Message) =>
                        !!a && !!b && a.user_id === b.user_id
                        && kstMinute(a.created_at) === kstMinute(b.created_at);
                    const grouped = !newDay && sameBlock(prev, m);
                    // **시각은 덩어리의 마지막 줄에만 적는다.** 카톡이 그렇다 —
                    // 줄마다 붙이면 같은 시각이 서너 번 되풀이돼 지저분하다.
                    const showTime = !sameBlock(m, next);
                    return (
                        <div key={m.id}>
                            {newDay && <div className="chat-day">{formatDate(m.created_at)}</div>}
                            <Bubble
                                message={m}
                                who={names[m.user_id ?? '']}
                                mine={m.user_id === me}
                                grouped={grouped}
                                showTime={showTime}
                                onImageLoad={pinBottom}
                            />
                        </div>
                    );
                })}
            </div>

            <div className="chat-input">
                <input
                    ref={fileRef} type="file" accept="image/*"
                    onChange={onPickPhoto} hidden
                />
                <button className="btn ghost chat-photo" onClick={() => fileRef.current?.click()}
                        disabled={uploading} aria-label="사진 보내기">
                    {uploading
                        ? <span className="spinner sm" />
                        : <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9"
                               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 5.5v13M5.5 12h13" />
                          </svg>}
                </button>
                {/* **`value`로 묶지 않는다.** React가 값을 되돌려 쓰면 한글
                    조합 중인 글자를 iOS가 놓친다. 값은 칸이 스스로 들고 있고,
                    우리는 보내기 단추를 띄우려고 따로 적어 둘 뿐이다
                    (비울 때는 `clearDraft()`가 칸까지 지운다).

                    **안내 글씨도 브라우저의 `placeholder`를 쓰지 않는다.**
                    한글은 한 글자가 여러 번에 걸쳐 조합되는데, iOS는 그
                    조합 중인 글자를 '내용 없음'으로 봐서 첫 글자를 칠 때
                    `메시지`가 한 번 번쩍였다. 우리가 직접 그리고 **초점이
                    가는 순간 치운다** — 그러면 번쩍일 틈 자체가 없다. */}
                <div className="chat-field grow">
                    <textarea
                        ref={taRef}
                        className="textarea"
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        onFocus={onComposerFocus}
                        onBlur={onComposerBlur}
                        rows={1} maxLength={1000}
                        aria-label="메시지 입력"
                    />
                    {!focused && !draft && <span className="chat-hint">메시지</span>}
                </div>
                {/* 보내기 버튼은 **적은 게 있을 때만** 나온다 — 카톡이 그렇다.
                    늘 놓아 두면 눌리지도 않는 버튼이 자리만 차지한다.
                    onMouseDown을 막아야 입력칸이 초점을 안 놓친다 — 키보드가
                    내려가지 않는 이유가 이 한 줄이다. 누르는 것 자체는 그대로
                    onClick으로 온다. */}
                {draft.trim() && (
                    <button className="btn primary chat-send" onClick={send}
                            onMouseDown={e => e.preventDefault()}
                            disabled={sending} aria-label="보내기">
                        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 12h15M13 6l6 6-6 6" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
}

function Bubble({
    message, who, mine, grouped, showTime, onImageLoad,
}: {
    message: Message;
    who?: Profile;
    mine: boolean;
    grouped: boolean;
    /** 덩어리의 마지막 줄에만 시각을 적는다. */
    showTime: boolean;
    /** 사진은 늦게 뜨면서 목록을 밀어낸다. 다 뜨면 다시 바닥에 붙이라고 알린다. */
    onImageLoad: () => void;
}) {
    return (
        <div className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}>
            {!mine && (
                <div className="chat-avatar">
                    {!grouped && <Avatar name={who?.name} url={who?.avatar_url} />}
                </div>
            )}
            <div className="chat-col">
                {!mine && !grouped && (
                    <span className="xs faint chat-who">{who?.name ?? '알 수 없음'}</span>
                )}
                <div className="chat-line">
                    {message.image_url
                        // 사진은 말풍선 없이 그 자체로 보여 준다. 눌러서 원본을
                        // 새 창에 띄운다 — 저장은 거기서 길게 눌러 한다.
                        ? <a className="chat-photo-link" href={message.image_url}
                             target="_blank" rel="noreferrer">
                              <img className="chat-image" src={message.image_url}
                                   alt="보낸 사진" loading="lazy" onLoad={onImageLoad} />
                          </a>
                        : <div className="chat-bubble">{message.body}</div>}
                    {showTime && (
                        <span className="chat-time">{formatTime(message.created_at)}</span>
                    )}
                </div>
                {/* 사진에 글을 함께 보냈으면 그 아래 한 줄로 붙인다. */}
                {message.image_url && message.body && (
                    <div className="chat-bubble">{message.body}</div>
                )}
            </div>
        </div>
    );
}
