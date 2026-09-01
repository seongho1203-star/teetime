import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap, fetchPeople, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDate, formatTime, kstDate, kstMinute } from '../lib/format';
import { personLabel, type Gender, type Message, type Person, type Room } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { shrinkImage } from '../lib/image';
import { lastSeen, markSeen, NEVER } from '../lib/unread';
import { unreadCounts, type Reads } from '../lib/reads';
import { ALL_MENTION, mentionQuery, splitMentions } from '../lib/mention';
import { emojiOnly } from '../lib/emoji';
import './Chat.css';

/** 한 번에 불러오는 지난 대화 수. 위로 올리면 더 받는다. */
const PAGE = 50;

/**
 * 안 읽은 게 많으면 **그만큼 더 받는다.**
 *
 * 쉰 명이 떠들면 하루에 100~200개가 쌓인다. 50개만 받으면 `여기까지
 * 읽으셨습니다` 줄이 그 안에 없어 아예 안 뜬다 — 정작 필요할 때 안 나오는 셈이다.
 * 그래서 안 읽은 개수를 먼저 세어 보고 그것보다 조금 더 받는다.
 *
 * 여기까지가 한 번에 받는 최대다. 이걸 넘도록 밀렸으면 어차피 다 읽지 않고
 * 최근 것부터 볼 테니, 줄은 못 긋더라도 화면이 무거워지지 않는 편이 낫다.
 */
const MAX_CATCHUP = 300;
/** 줄 위로 몇 개쯤 보이게 할지. 앞뒤 맥락 없이 줄부터 나오면 뚝 끊겨 보인다. */
const CATCHUP_MARGIN = 10;

interface Loaded { room: Room | null; people: Person[]; }

export function Chat() {
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const toast = useToast();

    const [messages, setMessages] = useState<Message[]>([]);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [focused, setFocused] = useState(false);
    /** 사람마다 어디까지 읽었나. 말풍선 옆의 숫자를 세는 데 쓴다. */
    const [reads, setReads] = useState<Reads>({});
    /** 앱을 보고 있는가. 안 보고 있으면 읽은 것으로 치지 않는다. */
    const [watching, setWatching] = useState(() =>
        typeof document === 'undefined' || !document.hidden);
    /** 지금 답장하려는 글. 입력칸 위에 인용으로 떠 있다. */
    const [replyTo, setReplyTo] = useState<Message | null>(null);
    /** 캐럿 앞에 `@무엇`을 치고 있으면 그 글자. 아니면 null. */
    const [mention, setMention] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const chatRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);
    // 맨 아래를 보고 있을 때만 새 글에 따라 내려간다. 지난 대화를 읽는
    // 도중에 남이 글을 쓰면 화면이 튀어서는 안 된다.
    const atBottom = useRef(true);

    /* ── `여기까지 읽으셨습니다` ──
       **들어온 순간의 '여기까지 봤다'를 얼려 둔다.** 아래 `markSeen`이 새 글이
       올 때마다 그 값을 지금으로 밀어 버리므로, 그 뒤에 읽으면 늘 '안 읽음
       없음'이 된다. 첫 렌더에서(효과보다 먼저) 한 번만 집는다. */
    const enteredSeen = useRef<string | null>(null);
    if (enteredSeen.current === null) enteredSeen.current = lastSeen('chat', me);
    /** 줄을 그을 글. **한 번 정하면 안 바꾼다** — 보고 있는 동안 들어온 글이
        '안 읽음'으로 잡혀 줄이 자꾸 내려가면 그게 더 성가시다. */
    const [unreadFrom, setUnreadFrom] = useState<string | null>(null);
    const unreadDone = useRef(false);

    const { data, loading, error } = useAsync<Loaded>(async () => {
        const [room, people] = await Promise.all([
            supabase.from('rooms').select('*').is('round_id', null)
                    .order('created_at').limit(1).maybeSingle(),
            fetchPeople(),
        ]);
        return { room: unwrap(room), people };
    }, []);

    const roomId = data?.room?.id;
    const names = byId(data?.people ?? []);
    const myName = names[me]?.name ?? '';
    /** 언급에 쓸 이름들. 회원 이상만 — 대기·추방된 사람은 대화를 못 본다. */
    const mentionable = (data?.people ?? [])
        .filter(p => p.name && p.role !== 'pending' && p.role !== 'banned');
    /* `@전체`는 운영진만 쓴다. **쓴 사람이 누구인지로 가른다** — 내가
       운영진이라고 남이 친 `@전체`까지 도드라져서는 안 된다. */
    const staffIds = new Set(
        (data?.people ?? [])
            .filter(p => p.role === 'admin' || p.role === 'staff' || p.role === 'superadmin')
            .map(p => p.id));

    /* 첫 묶음을 불러온다. 최근 것부터 받아 뒤집는다.
       **안 읽은 개수를 먼저 세어 그만큼 더 받는다** — 그러지 않으면 밀린
       사람에게는 `여기까지 읽으셨습니다` 줄이 아예 안 뜬다.
       줄 자리도 여기서 함께 정한다. 나중에 효과로 정하면 그 사이에
       `pinBottom`이 화면을 맨 아래로 붙여 버려 한 번 튄다. */
    useEffect(() => {
        if (!roomId) return;
        let alive = true;
        (async () => {
            const at = enteredSeen.current;
            const fresh = !at || at === NEVER;

            let limit = PAGE;
            if (!fresh) {
                const { count } = await supabase
                    .from('messages').select('id', { count: 'exact', head: true })
                    .eq('room_id', roomId).gt('created_at', at);
                if (!alive) return;
                limit = Math.min(MAX_CATCHUP, Math.max(PAGE, (count ?? 0) + CATCHUP_MARGIN));
            }

            const { data: rows, error: err } = await supabase
                .from('messages').select('*').eq('room_id', roomId)
                .order('created_at', { ascending: false }).limit(limit);
            if (!alive) return;
            if (err) { toast(readableError(err), 'error'); return; }
            const list = (rows ?? []).slice().reverse();

            /* 줄을 그을 글. **내가 쓴 글은 세지 않는다**(다른 기기에서 보낸 것) —
               내 글 위에 '여기까지 읽었다'가 붙으면 말이 안 된다.
               맨 첫 줄이면 긋지 않는다: 위가 비어 있어 뜻이 없고, 이 기기로
               처음 들어온 경우도 여기서 함께 걸러진다. */
            const i = fresh ? -1 : list.findIndex(m => m.created_at > at! && m.user_id !== me);
            if (i > 0) {
                // 아래로 붙이지 않는다. 줄 자리로 옮길 참이다.
                atBottom.current = false;
                setUnreadFrom(list[i].id);
            }
            setMessages(list);
            setHasMore((rows ?? []).length === limit);
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

    /* ── 읽음 표시 ──────────────────────────────────────────────
     *
     * 카톡처럼 말풍선 옆에 **아직 안 읽은 사람 수**를 적는다.
     * 사람마다 '어디까지 읽었나' 시각 하나만 오간다(`lib/reads.ts` 참고).
     */

    // 들어올 때 한 번 받는다. 100명이라도 100줄, 7KB 남짓이다.
    useEffect(() => {
        if (!roomId) return;
        let alive = true;
        supabase.from('room_reads').select('user_id, last_read_at').eq('room_id', roomId)
            .then(({ data: rows }) => {
                if (!alive || !rows) return;
                setReads(Object.fromEntries(rows.map(r => [r.user_id, r.last_read_at])));
            });
        return () => { alive = false; };
    }, [roomId]);

    /* **들어온 행을 그대로 갈아 끼운다 — 다시 불러오지 않는다.**
       `useRealtime`은 다시 불러오는데, 읽음은 사람이 볼 때마다 바뀌므로
       그러면 100명분 명단을 하루에도 수백 번 다시 받게 된다(무료 통신량이
       월 5GB다). 읽음은 **줄끼리 서로 얽히지 않아** 온 줄만 반영하면 맞다 —
       대화 글을 덧붙이기만 하는 것과 같은 이유다. */
    useEffect(() => {
        if (!roomId) return;
        const channel = supabase
            .channel(`reads:${roomId}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'room_reads',
                  filter: `room_id=eq.${roomId}` },
                payload => {
                    const row = payload.new as { user_id?: string; last_read_at?: string };
                    if (!row?.user_id || !row.last_read_at) return;
                    setReads(prev => ({ ...prev, [row.user_id!]: row.last_read_at! }));
                })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [roomId]);

    // 앱을 덮어 두면 읽고 있는 게 아니다. 돌아오면 그때 밀어 준다.
    useEffect(() => {
        const on = () => setWatching(!document.hidden);
        document.addEventListener('visibilitychange', on);
        return () => document.removeEventListener('visibilitychange', on);
    }, []);

    /* **어디까지 읽었는지 서버에 남긴다.**
       시각은 서버가 찍는다(`mark_room_read`) — 폰 시계가 몇 초 어긋나면
       방금 온 글보다 앞선 시각이 박혀 읽었는데도 숫자가 안 준다.
       마지막 글이 밀렸을 때만, 그것도 잠깐 모았다가 한 번 보낸다 —
       한 마디마다 쓰기가 나가면 100명이 떠들 때 그것만으로 시끄러워진다. */
    const reportedRef = useRef('');
    useEffect(() => {
        if (!roomId || !watching) return;
        const newest = messages[messages.length - 1]?.created_at;
        if (!newest || newest <= reportedRef.current) return;
        const t = setTimeout(() => {
            reportedRef.current = newest;
            supabase.rpc('mark_room_read', { p_room: roomId })
                    .then(() => { /* 실패해도 화면은 그대로 돌아야 한다 */ });
        }, 700);
        return () => clearTimeout(t);
    }, [roomId, messages, watching]);

    /** 글마다 아직 안 읽은 사람 수. 대기·추방은 세지 않는다 — 못 보는 사람이다. */
    const unreadBy = useMemo(() => {
        const ids = (data?.people ?? [])
            .filter(p => p.role !== 'pending' && p.role !== 'banned')
            .map(p => p.id);
        return unreadCounts(messages, reads, ids);
    }, [messages, reads, data?.people]);

    /** 맨 아래를 보고 있었으면 다시 맨 아래로 붙인다. */
    const pinBottom = useCallback(() => {
        const el = listRef.current;
        if (el && atBottom.current) el.scrollTop = el.scrollHeight;
    }, []);

    // 그리기가 끝난 프레임에 해야 높이가 확정된다.
    useLayoutEffect(() => { pinBottom(); }, [messages, pinBottom]);

    /* **줄이 그어진 자리로 옮겨 준다.** 100~200개가 밀린 사람을 맨 아래에
       내려놓으면 어디부터 읽어야 할지 스스로 찾아 올라가야 한다.
       줄을 화면 위쪽에 두어 거기서부터 아래로 읽게 한다.
       `pinBottom`보다 **뒤에** 선언해야 이쪽이 나중에 돌아 이긴다. */
    useLayoutEffect(() => {
        const el = listRef.current;
        if (!unreadFrom || unreadDone.current || !el) return;
        const line = el.querySelector<HTMLElement>('.chat-unread');
        if (!line) return;
        unreadDone.current = true;
        atBottom.current = false;
        /* 줄 위로 한 뼘 남겨 둔다 — 마지막으로 읽은 글이 한 줄 보여야
           '여기서부터'가 어디인지 눈에 들어온다. */
        el.scrollTop = line.offsetTop - 100;
    }, [unreadFrom, messages]);

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

    const watchViewport = useCallback(() => {
        if (!document.body.classList.contains('kb-open')) return;
        clearTimeout(settleTimer.current);
        settleTimer.current = window.setTimeout(() => {
            if (!document.body.classList.contains('kb-open')) return;
            if (window.scrollY) window.scrollTo(0, 0);
            const doc = document.scrollingElement;
            if (doc && doc.scrollTop) doc.scrollTop = 0;
        }, 120);
    }, []);

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
        // 키보드가 올라오는 동안에도 높이가 여러 번 바뀐다. 다 올라온 뒤에
        // **한 번 붙박아 두고** 그 뒤로는 다시 재지 않는다.
        setTimeout(() => applyKeyboard(true), 120);
        setTimeout(() => applyKeyboard(true), 400);
        setTimeout(() => {
            applyKeyboard(true);
            s.locked = true;
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
            setMention(null);
            applyKeyboard(true);
        }, 150);
    };

    useEffect(() => () => clearTimeout(blurTimer.current), []);

    /**
     * 입력칸 높이를 `--composer`에 적어 둔다.
     *
     * 키보드가 올라오면 입력칸이 흐름에서 빠져 화면에 직접 붙으므로
     * (Chat.css 참고), 목록이 그 아래로 숨지 않게 그만큼 자리를 비워야
     * 한다. 여러 줄을 적으면 높이가 늘어나니 재서 넣는다.
     */
    useEffect(() => {
        const el = barRef.current;
        if (!el) return;
        const write = () => {
            const h = Math.round(el.getBoundingClientRect().height);
            if (h) document.documentElement.style.setProperty('--composer', `${h}px`);
        };
        write();
        const ro = new ResizeObserver(write);
        // **`border-box`로 봐야 한다.** 키보드가 올라오면 이 칸은 아래
        // 여백만 68px에서 10px로 줄어드는데, 기본값(`content-box`)으로는
        // 안쪽 글자 칸이 그대로라 관찰자가 깨어나지 않는다 — 옛 높이가
        // 그대로 남아 목록이 필요 이상으로 잘렸다.
        ro.observe(el, { box: 'border-box' });
        return () => {
            ro.disconnect();
            document.documentElement.style.removeProperty('--composer');
        };
        // 키보드가 오르내릴 때도 다시 잰다.
    }, [roomId, focused]);

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
        };
        const move = (e: TouchEvent) => {
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
    }, [roomId]);

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
    /**
     * 적은 글에 맞춰 입력칸을 늘린다.
     *
     * `textarea`는 스스로 안 늘어난다 — 놔두면 한 줄 높이에 갇혀 안에서
     * 스크롤돼서, 여러 줄 적으면 **앞줄이 위로 잘려 안 보인다.**
     * 높이를 `auto`로 되돌렸다가 내용 높이(`scrollHeight`)로 다시 준다.
     * 되돌리지 않으면 한 번 커진 뒤로 줄어들지 않는다.
     *
     * 위 한도(`max-height` 120px)는 CSS가 잡고, 거기 닿으면 그때부터
     * 안에서 스크롤된다. 늘어난 만큼 목록이 밀리므로 바닥에 다시 붙인다.
     */
    const growDraft = useCallback(() => {
        const el = taRef.current;
        if (!el) return;
        el.style.height = 'auto';
        /* `box-sizing: border-box`라 height에 테두리가 포함된다. `scrollHeight`는
           안 그래서 그냥 넣으면 2px이 모자라 잔스크롤이 남는다. 그 차이를 잰다. */
        const border = el.offsetHeight - el.clientHeight;
        el.style.height = `${el.scrollHeight + border}px`;
        pinBottom();
    }, [pinBottom]);

    const clearDraft = () => {
        if (taRef.current) {
            taRef.current.value = '';
            // 보내고 나면 한 줄로 돌아와야 한다.
            taRef.current.style.height = '';
        }
        setDraft('');
        setMention(null);
    };

    /**
     * 캐럿 앞에 `@무엇`을 치고 있는지 본다.
     *
     * 입력칸이 값의 주인이라(uncontrolled) 칸에서 직접 읽는다. 글자를 칠
     * 때뿐 아니라 **캐럿만 옮겨도** 다시 봐야 해서 `onSelect`에서도 부른다.
     */
    const syncMention = () => {
        const el = taRef.current;
        if (!el) return;
        const found = mentionQuery(el.value, el.selectionStart ?? 0);
        setMention(found ? found.q : null);
    };

    /** 언급 목록에서 고른 사람을 `@이름 `으로 끼워 넣는다. */
    const insertMention = (name: string) => {
        const el = taRef.current;
        if (!el) return;
        const caret = el.selectionStart ?? el.value.length;
        const found = mentionQuery(el.value, caret);
        if (!found) return;
        const inserted = `@${name} `;
        const head = el.value.slice(0, found.at) + inserted;
        el.value = head + el.value.slice(caret);
        el.setSelectionRange(head.length, head.length);
        setDraft(el.value);
        setMention(null);
        growDraft();
        // 고르고 나서도 키보드가 그대로 있어야 이어 칠 수 있다.
        el.focus();
    };

    /* 목록. 운영진에게는 **맨 위에 `전체`**를 얹는다 — 서른 명에게 한
       번에 알릴 일(모집 마감·집합 시각 바뀜)이 운영진 몫이라 제일 자주
       고를 것이 그것이다. */
    const norm = (s2: string) => s2.replace(/\s/g, '');
    const mentionHits = mention === null ? [] : [
        ...(isAdmin && norm(ALL_MENTION).includes(norm(mention))
            ? [{ id: '__all__', name: ALL_MENTION, avatar_url: null,
                gender: null as Gender | null, all: true }] : []),
        ...mentionable
            .filter(p => p.id !== me && norm(p.name).includes(norm(mention)))
            .map(p => ({ id: p.id, name: p.name, avatar_url: p.avatar_url,
                         gender: p.gender ?? null, all: false })),
    ].slice(0, 6);

    /** 인용을 누르면 원본으로 간다. 지난 묶음에 있으면 아직 화면에 없다. */
    const jumpTo = (id: string) => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
        if (!el) { toast('지난 대화에 있습니다. 위로 올려 주세요.'); return; }
        atBottom.current = false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1300);
    };

    /** 답장을 시작한다. 밀어서든 눌러서든 여기로 온다. */
    const startReply = useCallback((m: Message) => {
        setReplyTo(m);
        taRef.current?.focus();
    }, []);

    /** id → 글. 인용할 원본을 찾는다. 지난 묶음에 있으면 없을 수 있다. */
    const byMid = new Map(messages.map(m => [m.id, m]));
    const mentionNames = mentionable.map(p => p.name);

    /** 지금 칸에 적힌 글. 칸이 값의 주인이므로 보낼 때는 칸에서 직접 읽는다 —
     *  한글 마지막 글자가 조합 중이면 `draft`에는 아직 안 와 있을 수 있다. */
    const currentDraft = () => (taRef.current?.value ?? draft).trim();

    /** 글 한 줄(또는 사진 한 장)을 보낸다. 보내기와 사진 올리기가 같이 쓴다. */
    const push = async (body: string, imageUrl: string | null) => {
        if (!roomId) return false;
        const { data: row, error: err } = await supabase
            .from('messages')
            // **사진이 없으면 image_url을, 답장이 아니면 reply_to를 아예
            // 보내지 않는다.** DB에 그 칸을 아직 안 만들었어도(스키마를
            // 다시 안 돌렸어도) 글은 그대로 오가게 하려는 것이다.
            .insert({
                room_id: roomId, user_id: me, body,
                ...(imageUrl ? { image_url: imageUrl } : {}),
                ...(replyTo ? { reply_to: replyTo.id } : {}),
            })
            .select('*').single();
        if (err) { toast(readableError(err), 'error'); return false; }

        setReplyTo(null);
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
                    const quoted = m.reply_to ? byMid.get(m.reply_to) : undefined;
                    return (
                        // `data-mid`는 인용을 눌렀을 때 원본을 찾는 표다.
                        <div key={m.id} data-mid={m.id}>
                            {newDay && <div className="chat-day">{formatDate(m.created_at)}</div>}
                            {/* **앱이 스스로 남긴 줄**(라운드·투표 안내).
                                말풍선으로 그리면 누가 말을 건 것처럼 보이고
                                답장·밀기까지 붙는다 — 안내는 가운데 한 줄이다. */}
                            {m.system && (
                                <div className="chat-notice">{m.body}</div>
                            )}
                            {m.id === unreadFrom && (
                                <div className="chat-unread">여기까지 읽으셨습니다</div>
                            )}
                            {!m.system && <Bubble
                                message={m}
                                who={names[m.user_id ?? '']}
                                mine={m.user_id === me}
                                grouped={grouped}
                                showTime={showTime}
                                unread={unreadBy[m.id] ?? 0}
                                onImageLoad={pinBottom}
                                quoted={quoted}
                                quotedWho={quoted ? names[quoted.user_id ?? '']?.name : undefined}
                                lostQuote={!!m.reply_to && !quoted}
                                onJump={jumpTo}
                                onReply={startReply}
                                mentionNames={mentionNames}
                                myName={myName}
                                allowAll={staffIds.has(m.user_id ?? '')}
                            />}
                        </div>
                    );
                })}
            </div>

            <div className="chat-input" ref={barRef}>
                {/* 답장할 글을 입력칸 위에 물려 둔다. ✕로 뗀다.
                    입력칸 안이라 키보드가 올라와도 함께 따라 올라간다. */}
                {replyTo && (
                    <div className="reply-bar">
                        <div className="grow" style={{ minWidth: 0 }}>
                            <div className="xs b">
                                {(names[replyTo.user_id ?? '']?.name ?? '알 수 없음')}에게 답장
                            </div>
                            <div className="xs faint truncate">{preview(replyTo)}</div>
                        </div>
                        <button className="reply-x" onClick={() => setReplyTo(null)}
                                onMouseDown={e => e.preventDefault()}
                                aria-label="답장 그만두기">✕</button>
                    </div>
                )}

                {/* `@`를 치는 동안만 나온다. 누를 때 입력칸이 초점을 놓으면
                    키보드가 내려가므로 `onMouseDown`을 막는다 — 보내기
                    단추와 같은 이유다. */}
                {mentionHits.length > 0 && (
                    <div className="mention-list">
                        {mentionHits.map(p => (
                            <button key={p.id} className={`mention-item${p.all ? ' is-all' : ''}`}
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => insertMention(p.name)}>
                                {p.all
                                    ? <span className="mention-all-icon" aria-hidden="true">📢</span>
                                    : <Avatar name={p.name} url={p.avatar_url} gender={p.gender} size="sm" />}
                                <span className="truncate">{p.name}</span>
                                {p.all && <span className="xs faint">모두에게 알림</span>}
                            </button>
                        ))}
                    </div>
                )}

                <input
                    ref={fileRef} type="file" accept="image/*"
                    onChange={onPickPhoto} hidden
                />

                {/* 사진 · 입력칸 · 보내기 한 줄. 위의 인용과 언급 목록이
                    같은 상자 안에 쌓이므로 이 줄만 따로 묶는다. */}
                <div className="chat-bar">
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
                        onChange={e => { setDraft(e.target.value); syncMention(); growDraft(); }}
                        onSelect={syncMention}
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
        </div>
    );
}

/** 인용에 보일 한 줄. 사진만 보낸 글은 글자가 없다. */
function preview(m: Message): string {
    const text = m.body.trim();
    if (text) return text.length > 60 ? text.slice(0, 60) + '…' : text;
    return m.image_url ? '사진' : '';
}

/**
 * 말풍선 옆에 붙는 것 — **안 읽은 사람 수**와 시각.
 *
 * 카톡과 같은 자리다. 둘을 한 덩어리로 세로로 쌓아 두어, 숫자가 생기거나
 * 사라져도 말풍선이 위아래로 흔들리지 않는다.
 * **다 읽으면 숫자가 사라진다** — 0을 적어 두면 아무 뜻이 없다.
 */
function Stamp({ at, showTime, unread }: { at: string; showTime: boolean; unread: number }) {
    if (!unread && !showTime) return null;
    return (
        <span className="chat-stamp">
            {unread > 0 && (
                <span className="chat-unread-n" aria-label={`${unread}명이 안 읽음`}>{unread}</span>
            )}
            {showTime && <span className="chat-time">{formatTime(at)}</span>}
        </span>
    );
}

/** 왼쪽으로 이만큼 밀면 답장이 걸린다. 되돌아가는 최대 거리도 이 근처다. */
const SWIPE_TRIGGER = 55;
const SWIPE_MAX = 72;

function Bubble({
    message, who, mine, grouped, showTime, unread, onImageLoad,
    quoted, quotedWho, lostQuote, onJump, onReply, mentionNames, myName, allowAll,
}: {
    message: Message;
    who?: Person;
    mine: boolean;
    grouped: boolean;
    /** 덩어리의 마지막 줄에만 시각을 적는다. */
    showTime: boolean;
    /** 아직 안 읽은 사람 수. 0이면 아무것도 안 적는다(다 읽었다는 뜻이다). */
    unread: number;
    /** 사진은 늦게 뜨면서 목록을 밀어낸다. 다 뜨면 다시 바닥에 붙이라고 알린다. */
    onImageLoad: () => void;
    /** 답장이면 원본. 아직 안 불러온 지난 글이면 없다. */
    quoted?: Message;
    quotedWho?: string;
    /** 답장이긴 한데 원본을 못 찾은 경우(지난 묶음이거나 지워졌다). */
    lostQuote: boolean;
    onJump: (id: string) => void;
    onReply: (m: Message) => void;
    mentionNames: string[];
    myName: string;
    /** 쓴 사람이 운영진인가. `@전체`는 그때만 부른 것으로 본다. */
    allowAll: boolean;
}) {
    const rowRef = useRef<HTMLDivElement>(null);
    /* 이모지만 보낸 짧은 글은 말풍선 없이 크게 그린다(카톡이 그렇다).
       사진에 함께 적은 글은 그대로 둔다 — 사진 아래 붙는 한 줄이라
       거기서만 글자가 커지면 짜임이 무너진다. */
    const big = !message.image_url && emojiOnly(message.body);
    /** 사진에 함께 적은 글. 있으면 그 줄이 이 덩어리의 마지막 줄이 된다. */
    const caption = !!message.image_url && !!message.body;
    /* 밀기 상태. **React state로 두지 않는다** — 손가락을 따라 매 프레임
       다시 그리면 긴 대화에서 눈에 띄게 끊긴다. 요소를 직접 움직인다. */
    const g = useRef({ x0: 0, y0: 0, dx: 0, decided: false, active: false });

    const paint = (dx: number) => {
        const el = rowRef.current;
        if (!el) return;
        el.style.transform = dx ? `translateX(${dx}px)` : '';
        // 화살표가 얼마나 짙어질지. 밀린 만큼 드러난다.
        el.style.setProperty('--swipe', String(Math.min(1, Math.abs(dx) / SWIPE_TRIGGER)));
    };

    const onTouchStart = (e: React.TouchEvent) => {
        const t = e.touches[0];
        g.current = { x0: t.clientX, y0: t.clientY, dx: 0, decided: false, active: false };
    };

    /* `touch-action: pan-y`라 세로 스크롤은 브라우저가 그대로 가져간다.
       우리는 가로로 그은 것만 집는다 — `preventDefault`는 부르지 않는다
       (React의 touchmove는 passive라 어차피 안 먹는다). */
    const onTouchMove = (e: React.TouchEvent) => {
        const t = e.touches[0];
        const dx = t.clientX - g.current.x0;
        const dy = Math.abs(t.clientY - g.current.y0);
        if (!g.current.decided) {
            if (Math.abs(dx) < 8 && dy < 8) return;
            g.current.decided = true;
            // 왼쪽으로, 세로보다 가로로 더 많이 그었을 때만 답장 손짓이다.
            g.current.active = dx < 0 && Math.abs(dx) > dy;
        }
        if (!g.current.active) return;
        g.current.dx = Math.max(-SWIPE_MAX, Math.min(0, dx));
        paint(g.current.dx);
    };

    const onTouchEnd = () => {
        const el = rowRef.current;
        const hit = g.current.active && g.current.dx <= -SWIPE_TRIGGER;
        if (el && g.current.active) {
            // 손을 떼면 제자리로. transform만 움직이므로 값이 싸다.
            el.style.transition = 'transform 0.18s ease';
            setTimeout(() => { if (el) el.style.transition = ''; }, 220);
        }
        g.current.dx = 0;
        g.current.active = false;
        paint(0);
        if (hit) onReply(message);
    };

    const quote = (quoted || lostQuote) && (
        <button className="chat-quote"
                onClick={() => quoted && onJump(quoted.id)}
                disabled={!quoted}>
            <span className="chat-quote-who">{quoted ? (quotedWho ?? '알 수 없음') : '지난 대화'}</span>
            <span className="chat-quote-text truncate">
                {quoted ? preview(quoted) : '원본을 찾지 못했습니다'}
            </span>
        </button>
    );

    return (
        <div className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}
             ref={rowRef}
             onTouchStart={onTouchStart} onTouchMove={onTouchMove}
             onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
            {!mine && (
                <div className="chat-avatar">
                    {!grouped && <Avatar name={who?.name} url={who?.avatar_url} gender={who?.gender} />}
                </div>
            )}
            <div className="chat-col">
                {/* 이름표는 `83/신성호/광산구`다 — 100명 방에서는 닉네임만으로
                    누군지 모른다. **`@언급`은 여전히 닉네임 그대로다.** */}
                {!mine && !grouped && (
                    <span className="xs faint chat-who">
                        {personLabel(who) || '알 수 없음'}
                    </span>
                )}
                {quote}
                <div className="chat-line">
                    {message.image_url
                        // 사진은 말풍선 없이 그 자체로 보여 준다. 눌러서 원본을
                        // 새 창에 띄운다 — 저장은 거기서 길게 눌러 한다.
                        ? <a className="chat-photo-link" href={message.image_url}
                             target="_blank" rel="noreferrer">
                              <img className="chat-image" src={message.image_url}
                                   alt="보낸 사진" loading="lazy" onLoad={onImageLoad} />
                          </a>
                        : <div className={`chat-bubble${big ? ' emoji-only' : ''}`}>
                              <Body text={message.body} names={mentionNames} me={myName} allowAll={allowAll} />
                          </div>}
                    {/* 시각은 **덩어리의 마지막 줄**에 붙는다. 사진에 글을 함께
                        보냈으면 그 글이 마지막 줄이므로 여기서는 비운다 —
                        안 그러면 사진 옆에 시각이 찍히고 그 아래로 글이 더 온다.
                        **안 읽은 사람 수는 글마다 붙는다**(카톡이 그렇다) —
                        같은 분에 보낸 글이라도 읽힌 정도가 다를 수 있다. */}
                    {!caption && <Stamp at={message.created_at} showTime={showTime} unread={unread} />}
                </div>
                {/* 사진에 글을 함께 보냈으면 그 아래 한 줄로 붙인다.
                    **`.chat-line`으로 감싸야 한다** — 그냥 두면 `.chat-col`이
                    늘여서(`align-items: stretch`) 짧은 글도 사진보다 넓게
                    퍼진다. 감싸면 글 길이만큼만 차지하고, 내 글은 오른쪽으로
                    붙으며, 시각도 이 줄 끝에 온다. */}
                {caption && (
                    <div className="chat-line">
                        <div className="chat-bubble">
                            <Body text={message.body} names={mentionNames} me={myName} allowAll={allowAll} />
                        </div>
                        <Stamp at={message.created_at} showTime={showTime} unread={unread} />
                    </div>
                )}
            </div>

            {/* 밀면 드러나는 답장 표. 손가락이 없는 기기에서는 말풍선 위에
                손을 얹으면 나온다 — PC로도 답장할 수 있어야 한다. */}
            <button className="chat-reply-btn" aria-label="답장"
                    onClick={() => onReply(message)}>
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10 9V5l-7 7 7 7v-4c5 0 8 1.5 10 5-1-5-4-10-10-11z" />
                </svg>
            </button>
        </div>
    );
}

/** 글 한 덩어리. `@이름`만 도드라지게 그린다. */
function Body({ text, names, me, allowAll }: {
    text: string; names: string[]; me: string; allowAll: boolean;
}) {
    const pieces = splitMentions(text, names, allowAll);
    if (pieces.length === 1 && !pieces[0].name) return <>{text}</>;
    return (
        <>
            {pieces.map((p, i) =>
                p.name
                    // 나를 부른 것은 더 눈에 띄어야 한다. 대화가 길어지면
                    // 내 이름만 찾게 되기 때문이다. `@전체`는 나까지 부른
                    // 것이므로 같은 대접을 한다.
                    ? <span key={i}
                            className={`mention${p.name === me || p.name === ALL_MENTION ? ' me' : ''}`}>
                          {p.text}
                      </span>
                    : <span key={i}>{p.text}</span>)}
        </>
    );
}
