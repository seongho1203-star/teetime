import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
         type Dispatch, type SetStateAction, type SyntheticEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { useAsync, unwrap, useRefreshOnShow, fetchPeople, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatChatDay, formatStamp, formatTime, kstDate, kstMinute } from '../lib/format';
import { FIND_AT, REACTIONS, ROLE_LABEL, ROLE_TAG, personLabel,
         type Gender, type Message, type MessageReaction,
         type Person, type Room } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { readableError } from '../lib/errors';
import { shrinkImage } from '../lib/image';
import { lastSeen, markSeen, NEVER } from '../lib/unread';
import { unreadCounts, type Reads } from '../lib/reads';
import { ALL_MENTION, mentionQuery, splitMentions } from '../lib/mention';
import { splitLinks } from '../lib/links';
import { IS_NATIVE } from '../lib/native';
import {
    NativeComposer, canPickNative, canSlide, composerReady, composerSkin, hush, ncLog,
    pickNativePhoto,
} from '../lib/composer';

/**
 * 네이티브 바가 마지막으로 알려 온 높이 — **화면을 나갔다 와도 남는다.**
 * 새로 들어올 때 바가 높이를 알려 오기까지 한 프레임쯤 예비값(60px)이
 * 쓰이고, 그 뒤 116으로 뛰면서 목록이 90px 줄어드는 것이 **들어갈 때
 * 글이 아래로 내려갔다 올라오는 것**으로 보였다(실기기 제보). 지난번
 * 값을 먼저 적어 두면 그 뜀이 없다.
 */
let lastBarH = 0;

/** 앱 쪽 바가 **`--chat-h`·`--composer`의 주인인가**(6판부터).
 *  판 번호는 앱에 물어봐야 알므로 **쓸 때마다 본다** — 값으로 잡아 두면
 *  아직 답이 오기 전이라 늘 거짓이 된다(실기기에서 그래서 6판 코드가
 *  통째로 안 돌았다). */
const owns6 = () => ncLog.v >= 6;

/** 네이티브 바의 `kb` 신호. 14판부터 끝값(`chatH`·`pad`·`s`)과 `slide`가 실린다. */
type KbSignal = {
    on: boolean; dur: number; at: number;
    chatH?: number; pad?: number; s?: number; slide?: boolean;
};
import { emojiOnly } from '../lib/emoji';
import { isSticker, stickerLabel, stickerRef, stickerSrc,
         STICKER_GROUPS, STICKERS } from '../lib/stickers';
import { HoldIcon } from '../components/HoldIcons';
import { captureNode, shareText, sharePhotoFile } from '../lib/share';
import { purgeOldPhotos } from '../lib/photos';
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

/** 검색 결과를 몇 개까지 보여 줄까. 더 필요하면 더 좁혀 치는 편이 빠르다. */
const SEARCH_HITS = 40;
/** 찾은 글 뒤로 몇 개를 함께 받아 둘까 — 그 뒤의 이야기가 조금은 보여야 한다. */
const WINDOW_AFTER = 20;
/** 바닥에서 이만큼 넘게 올라가 있으면 `맨 아래로` 화살표를 띄운다.
 *  **`atBottom`의 80px과 일부러 벌려 놓았다** — 두 잣대가 붙어 있으면
 *  바닥 언저리에서 단추가 떴다 사라졌다 깜빡인다. */
const JUMP_AT = 240;
/** 반응을 물어볼 때 한 번에 실을 글 개수. **늘리지 말 것** — 300개를
 *  한 줄에 다 실으면 주소가 11KB가 되어 중간에서 잘린다. */
const REACT_CHUNK = 60;

/**
 * **아직 서버에 안 닿은 내 글의 id 앞머리.**
 *
 * 보내기를 누르면 서버에 넣고 **답이 온 뒤에** 그리던 것을, 누르는 즉시
 * 먼저 그리도록 바꾸면서 생긴 값이다(사용자 제보 — `전송 버튼을 누르면
 * 채팅이 올라가는데 딜레이가 생겨`). 그 왕복이 인터넷 한 바퀴라
 * 0.3~1초인데, 그동안 **글칸에 글도 그대로 남아 있어** 안 눌린 줄 알고
 * 또 누르게 된다.
 *
 * 이 id를 단 줄은 화면에만 있으므로 **서버에 실어 보내면 안 된다** —
 * 진짜 id는 uuid라, 섞여 나가면 그 조회가 통째로 400으로 막힌다
 * (반응 받아 오는 자리가 그렇다).
 */
const TEMP_ID = 'tmp:';
const isTemp = (id: string) => id.startsWith(TEMP_ID);

type ReactSet = Dispatch<SetStateAction<Record<string, MessageReaction[]>>>;

/** 반응 한 줄을 더한다. **내가 든 글의 것만** — 실시간은 방을 안 가리고 온다. */
function addReact(set: ReactSet, r: MessageReaction, seen: Set<string>) {
    if (!r.message_id || !seen.has(r.message_id)) return;
    set(prev => {
        const had = prev[r.message_id] ?? [];
        if (had.some(x => x.user_id === r.user_id && x.emoji === r.emoji)) return prev;
        return { ...prev, [r.message_id]: [...had, r] };
    });
}

/** 반응 한 줄을 뗀다. 지울 때 오는 값은 기본키 셋뿐이라 그것만 본다. */
function dropReact(set: ReactSet, r: Partial<MessageReaction>) {
    const mid = r.message_id;
    if (!mid) return;
    set(prev => {
        const had = prev[mid];
        if (!had) return prev;
        const left = had.filter(x => !(x.user_id === r.user_id && x.emoji === r.emoji));
        if (left.length === had.length) return prev;
        const next = { ...prev };
        if (left.length) next[mid] = left; else delete next[mid];
        return next;
    });
}

/** ✕로 닫아 둔 공지를 **이 기기에** 적어 두는 열쇠.
 *  **소문자 `teetime:` 그대로 둘 것** — 저장 열쇠는 앱 이름이 바뀌어도
 *  안 바꾼다(바꾸면 닫아 둔 것이 도로 뜬다). */
const PIN_X_KEY = 'teetime:pin-x';
/* ── 곧 볼 그림을 미리 받아 두는 몫 (아래 `미리 받아 두기` 참고) ── */
/** 사진 몇 장까지. **함부로 늘리지 말 것** — 사진은 Supabase에서 오고 무료
 *  통신량이 월 5GB다(위 '지난 것은 받지 않는다'). 한 번 받으면 1년 동안
 *  캐시에 남으므로(`cacheControl`) 다시 들어올 때는 안 받는다. */
const WARM_PHOTOS = 8;
/** 멈춰 있는 이모티콘은 몇 장까지. 한 장 9KB이고 앱에 딸린 붙박이라
 *  Supabase가 아니라 GitHub Pages가 내준다 — 넉넉히 켠다.
 *  **30에서 80으로 올렸다**(실기기 제보 — 첫 스크롤이 아직 끊긴다).
 *  우리 대화방은 이모티콘이 대부분인데 서른 장에서 몫이 떨어지면 그 위쪽
 *  것들이 결국 굴리는 도중에 받아진다. 여든 장을 다 받아도 720KB이고
 *  1년 캐시라, 늘려서 잃는 것이 사실상 없다. */
const WARM_STICKERS = 80;
/** **움직이는 이모티콘은 따로 센다** — 한 장 평균 239KB로 멈춘 것의 서른
 *  배가 넘는다. 같은 몫으로 두면 대화를 열 때마다 7MB를 받아, 미리 받아
 *  두려다 폰이 더 느려진다(LTE에서는 더). 서비스워커가 한 번 받은 것을
 *  캐시에 남기므로(`public/sw.js`) 두 번째부터는 이 몫도 거의 안 쓴다. */
const WARM_ANIM = 6;
/** 한 번에 몇 장씩 — 한꺼번에 켜면 그 자체로 한 프레임을 먹는다. */
const WARM_BATCH = 3;
/**
 * 묶음 사이의 틈.
 *
 * **200ms에서 80ms로 줄였다**(실기기 제보 — `채팅창을 켜고 내용을 내리면
 * 화면이 끊겨` · `처음 한번만 나와`). '처음 한 번만'이라는 것이 곧
 * **아직 다 못 받아 둔 것이 굴리는 도중에 받아진다**는 뜻이다 — 200ms에
 * 세 장이면 쉰 장을 다 켜는 데 3.3초가 걸리는데, 대화를 열고 3초를
 * 가만히 있는 사람은 없다.
 *
 * **`한꺼번에 켜지 말 것`이라는 규칙은 그대로다** — 그때 잰 것은
 * '한 번에 다' 대 '나눠서'였지 200ms라는 값 자체가 아니었다. 여든에
 * 세 장씩이면 여전히 나눠서 켜는 것이고, 다 켜기까지가 1.3초로 줄어
 * 사람이 굴리기 전에 끝난다. **더 줄이지는 말 것** — 틈이 한 프레임
 * 아래로 내려가면 나눈 뜻이 없어진다.
 */
const WARM_GAP = 80;

interface Loaded { room: Room | null; people: Person[]; }

export function Chat() {
    const { session, isAdmin } = useAuth();
    const me = session!.user.id;
    const toast = useToast();
    const confirm = useConfirm();

    const [messages, setMessages] = useState<Message[]>([]);
    /**
     * **글자가 있는가.** `state`가 아니라 `ref`이고, 화면에는 입력칸 상자의
     * `has-text` 클래스로만 알린다.
     *
     * 예전에는 친 글을 통째로 state에 복사했다. 그러면 **한 글자마다 화면
     * 전체가 다시 그려져** 말풍선 쉰 개가 매번 다시 그려졌다 — 19글자 중
     * 9글자가 한 프레임(16ms)을 넘겼고 그게 '치면 끊긴다'는 제보였다.
     * 참/거짓으로 줄여도 **첫 글자에서 한 번은 다시 그려져**(빈칸 → 글 있음)
     * 거기서만 56ms가 났다 — 글을 치기 시작하는 바로 그 순간이라 제일
     * 눈에 띈다. 그래서 아예 리액트를 거치지 않는다.
     *
     * 이 값을 보는 곳은 둘 다 **다시 그려지는 순간에만** 본다 — 초점이
     * 떠날 때의 안내 글씨와, 초점이 오갈 때의 보내기 단추다. 그래서 글자를
     * 치는 동안에는 아무 일도 안 일어난다.
     * **state로 되돌리지 말 것.**
     */
    const hasText = useRef(false);
    /**
     * **보내는 중인가.** 잇따라 눌러도 한 줄만 나가게 하는 자물쇠다
     * (`send()` 참고 — 앱의 보내기 단추는 네이티브라 `disabled`가 안 걸린다).
     * 아래 `sending`은 **웹 단추를 흐리게 하는 몫**이라 둘 다 필요하다.
     */
    const sendBusy = useRef(false);
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
    /** 이모티콘 서랍이 열려 있는가. 열면 키보드를 내린다(아래 `toggleTray`). */
    const [tray, setTray] = useState(false);
    /** 서랍에서 보고 있는 묶음. **기억해 두지 않는다** — 나갔다 오면 첫
     *  묶음(골프)으로 돌아간다(회원 명단의 차례 고르기와 같은 결이다). */
    /* **한 장도 없으면 이모티콘 단추가 아예 안 나온다** — 눌러 봐야 빈
       서랍이 열릴 뿐이다. 그래서 `STICKER_GROUPS[0]`을 그냥 읽지 않는다. */
    const [group, setGroup] = useState(STICKER_GROUPS[0]?.id ?? '');
    /** 골라 둔 이모티콘. 곧바로 나가지 않고 **입력칸 위에 미리보기로 물려
     *  둔다** — 글을 마저 적어 함께 보낼 수 있어야 한다(사용자 요청). */
    const [picked, setPicked] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const chatRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const taRef = useRef<HTMLTextAreaElement>(null);
    /**
     * **네이티브 글칸을 쓰고 있는가.**
     *
     * 앱에 그 플러그인이 있을 때만 참이 된다(`lib/composer.ts`). 참이면
     * 웹 글칸은 안 그리고 값도 네이티브가 들고 있다 — 그래서 글을 읽고
     * 쓰는 곳이 전부 아래 `draftValue`·`setDraft`를 거친다.
     *
     * **state와 ref를 같이 둔다.** state는 화면을 다시 그리려고, ref는
     * `useCallback`으로 붙박아 둔 함수들이 의존성 없이 읽으려고 있다.
     */
    const [nativeBar, setNativeBar] = useState(false);
    const ncOn = useRef(false);
    /** 네이티브 바가 마지막으로 알려 준 제 높이. **`--composer`를 다시 적을
        때 쓴다** — 그 값을 지우는 곳이 따로 있어서다(아래 `write()` 주석). */
    const ncH = useRef(0);
    /** 네이티브 칸이 들고 있는 글의 사본. 칸이 값의 주인이라 읽기만 한다. */
    const ncText = useRef({ text: '', sel: 0 });
    // 맨 아래를 보고 있을 때만 새 글에 따라 내려간다. 지난 대화를 읽는
    // 도중에 남이 글을 쓰면 화면이 튀어서는 안 된다.
    const atBottom = useRef(true);
    /* 목록이 마지막으로 잰 높이. **늦게 뜬 사진이 얼마나 밀어냈는지**를
       이 값과 견줘 알아낸다(아래 `onImageLoad`). 굴릴 때마다 다시 적어
       두므로, 사진이 도착하는 순간의 차이가 곧 그 사진이 자란 만큼이다. */
    const listH = useRef(0);

    /* ── 맨 아래로 내려가는 화살표 (카톡의 그것) ──
       오랜만에 들어오면 `여기까지 읽으셨습니다` 줄로 옮겨 놓기 때문에, 밀린
       글이 많은 날에는 최근 대화까지 한참을 굴려 내려가야 했다.

       **굴릴 때마다 state를 건드리면 안 된다** — 말풍선이 `memo`라도 화면이
       매번 다시 그려지면 긴 대화에서 눈에 띄게 끊긴다(입력칸에서 겪은 것과
       같은 자리다). 그래서 참/거짓이 **뒤집힐 때만** 알린다.
       `atBottom`의 잣대(80px)와 **일부러 벌려 놓았다** — 그 사이가 없으면
       바닥 언저리에서 단추가 깜빡인다. */
    const [showJump, setShowJump] = useState(false);
    const jumpShown = useRef(false);

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
                    /* **검색으로 옛 글에 가 있으면 안 붙인다.** 그 목록은
                       '지금'이 아니라 찾은 글 언저리라, 새 글을 끝에 붙이면
                       한참 지난 글 바로 뒤에 오늘 글이 앉는다.
                       `최근 대화로` 단추가 통째로 다시 받아 온다. */
                    if (windowedRef.current) return;
                    const row = payload.new as Message;
                    setMessages(prev =>
                        // 내가 보낸 글은 이미 넣어 두었다. 두 번 그리지 않는다.
                        prev.some(m => m.id === row.id) ? prev : [...prev, row]);
                })
            // **가리기는 지우기가 아니라 고치기다.** 운영진이 가리거나 풀면
            // 그 줄만 갈아 끼운다 — 다시 불러오면 굴려 둔 자리를 잃는다.
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
                payload => {
                    const row = payload.new as Message;
                    setMessages(prev => prev.map(m => (m.id === row.id ? row : m)));
                    /* **방 공지도 여기서 따라온다 — 다시 물어보지 않는다.**
                       붙박는 것이 곧 가장 늦게 붙박은 줄이 되는 일이라,
                       들어온 줄만 보면 답이 나온다. 내린 줄은 그것이 지금
                       공지일 때만 치운다(남의 옛 글이 내려간 것일 수 있다).
                       칸이 없는 저장소에서는 `undefined`라 아래로 가는데,
                       거기서는 공지가 애초에 없어 아무 일도 안 일어난다. */
                    if (row.pinned_at) setPin(row);
                    else setPin(prev => (prev && prev.id === row.id ? null : prev));
                })
            .on('postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'messages' },
                payload => {
                    const gone = payload.old as { id?: string };
                    if (!gone.id) return;
                    setMessages(prev => prev.filter(m => m.id !== gone.id));
                    // 공지로 올려 둔 글을 쓴 사람이 지우면 그 줄도 함께 걷는다.
                    setPin(prev => (prev && prev.id === gone.id ? null : prev));
                })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [roomId]);

    /** 마지막 글을 화면 밖(아래 '접었다 펴면')에서도 읽어야 한다. */
    const msgsRef = useRef(messages);
    msgsRef.current = messages;

    /**
     * **접었다 펴면 그 사이 온 글을 받아 온다.**
     *
     * 위의 실시간은 **보고 있는 동안**만 맡는다 — 앱을 접으면 그 연결이
     * 끊기고, **다시 이어져도 그동안 들어온 글은 되받아 오지 않는다.**
     * 그런데 대화 알림을 눌러 들어오는 길이 바로 그것이라(껐다 켜는 게
     * 아니라 접어 둔 것을 펴는 것) 화면도 새로 안 만들어지고, 첫 묶음을
     * 받는 위 효과는 `roomId`가 그대로라 다시 안 돈다 — **알림을 눌러
     * 들어갔는데 그 글이 없었다**(사용자 제보 — `채팅배너알림이 와서 그걸
     * 눌러서 들어가면 채팅으로 들어는가지는데 새로운 내용이 안나와.
     * 그래서 투표눌렀다 다시 대화들어가면 그제서야 나와`). 탭을 옮겼다
     * 오면 나오던 것은 그때 화면이 새로 만들어져서다.
     *
     * **통째로 다시 받지 않는다 — 마지막 글 뒤엣것만 덧붙인다.**
     * 다시 받으면 굴려 둔 자리도, `여기까지 읽으셨습니다` 줄도 잃는다.
     * 실시간 덧붙이기와 같은 잣대라 **검색으로 옛 글에 가 있으면
     * 건너뛴다**(`windowed`) — 거기에 오늘 글을 붙이면 안 된다.
     *
     * **알림함·홈·탭바가 쓰는 `useRefreshOnShow`와 같은 자리다** —
     * 실시간으로 받는 화면은 이것이 늘 한 벌로 붙는다.
     */
    useRefreshOnShow(useCallback(() => {
        if (!roomId || windowedRef.current) return;
        const last = msgsRef.current[msgsRef.current.length - 1]?.created_at;
        if (!last) return;                     // 아직 첫 묶음도 안 왔다 — 그쪽이 받는다.
        (async () => {
            const { data: rows, error: err } = await supabase
                .from('messages').select('*').eq('room_id', roomId)
                .gt('created_at', last)
                .order('created_at', { ascending: true }).limit(MAX_CATCHUP);
            if (err || !rows?.length) return;  // 못 받으면 조용히 — 실시간이 이어 간다.
            setMessages(prev => {
                // 실시간이 먼저 붙여 둔 것과 겹칠 수 있다. id로 거른다.
                const have = new Set(prev.map(m => m.id));
                const add = (rows as Message[]).filter(m => !have.has(m.id));
                return add.length ? [...prev, ...add] : prev;
            });
        })();
    }, [roomId]));

    /* ── 말풍선 반응 (카톡의 `😄 2`) ────────────────────────────
     *
     * 한마디 한마디에 `네` `ㅋㅋ`로 답하면 하루 백 마디가 이백 마디가 된다.
     * 카톡이 그래서 둔 자리이고, 여기서도 같은 몫이다.
     *
     * **글 하나에 배열 하나로 담는다.** 바뀐 글의 몫만 갈아 끼우므로,
     * 말풍선에 넘기는 배열은 그 글의 반응이 바뀔 때만 새것이 된다 —
     * `Bubble`이 `memo`라 이게 어긋나면 쉰 개가 통째로 다시 그려진다.
     */
    const [reacts, setReacts] = useState<Record<string, MessageReaction[]>>({});
    /** 화면 밖에서 읽어야 하는 자리가 둘이다(누를 때 · 실시간). 같이 들고 있는다. */
    const reactsRef = useRef(reacts);
    reactsRef.current = reacts;
    /** 반응을 이미 받아 본 글. **실시간이 '내가 든 글인가'를 이걸로 가른다.** */
    const reactSeen = useRef<Set<string>>(new Set());

    /**
     * 새로 들어온 글들의 반응을 받아 온다.
     *
     * **글 id를 나눠서 묻는다.** 밀린 사람은 한 번에 300개까지 받는데,
     * 그 id를 한 줄에 다 실으면 주소가 11KB가 되어 중간에서 잘린다.
     * 보통은 50개라 한 번으로 끝난다.
     *
     * **오류를 그냥 삼킨다.** 표가 아직 없는 저장소에서 400이 나는데,
     * 그걸 던지면 대화가 통째로 안 열린다 — 앱은 밀면 몇 분 뒤 올라가지만
     * 스키마는 그보다 늦을 수 있다. 못 받으면 반응만 안 뜨고 대화는 멀쩡하다.
     */
    useEffect(() => {
        /* **아직 서버에 안 닿은 내 글은 빼고 묻는다**(`TEMP_ID`). 그 id는
           uuid가 아니라 한 줄만 섞여도 그 조회가 400으로 막히는데, 아래
           `if (err) return`이 **남은 묶음까지 통째로 건너뛴다.** */
        const missing = messages.map(m => m.id)
            .filter(id => !isTemp(id) && !reactSeen.current.has(id));
        if (!missing.length) return;
        missing.forEach(id => reactSeen.current.add(id));
        let alive = true;
        (async () => {
            for (let i = 0; i < missing.length; i += REACT_CHUNK) {
                const { data: rows, error: err } = await supabase
                    .from('message_reactions').select('*')
                    .in('message_id', missing.slice(i, i + REACT_CHUNK));
                if (!alive) return;
                if (err) return;                    // 표가 없는 저장소 — 조용히
                if (!rows?.length) continue;
                setReacts(prev => {
                    const next = { ...prev };
                    for (const r of rows as MessageReaction[]) {
                        const had = next[r.message_id] ?? [];
                        if (!had.some(x => x.user_id === r.user_id && x.emoji === r.emoji)) {
                            next[r.message_id] = [...had, r];
                        }
                    }
                    return next;
                });
            }
        })();
        return () => { alive = false; };
    }, [messages]);

    /**
     * 남이 단 반응을 받는다.
     *
     * **가려서 받지 않는다.** 실시간 거르개는 칸 하나만 볼 수 있는데
     * 이 표에는 방 번호가 없다 — 대신 **내가 든 글의 것만** 반영한다
     * (`reactSeen`). 100명 모임에서 오가는 양이라 이편이 싸다.
     *
     * **다시 불러오지 않는다.** 반응은 줄끼리 안 얽히므로 들어온 줄만
     * 갈아 끼우면 된다(읽음 표시와 같은 이유다).
     */
    useEffect(() => {
        if (!roomId) return;
        const channel = supabase
            .channel(`reacts:${roomId}`)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'message_reactions' },
                payload => addReact(setReacts, payload.new as MessageReaction, reactSeen.current))
            .on('postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'message_reactions' },
                payload => dropReact(setReacts, payload.old as Partial<MessageReaction>))
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [roomId]);

    /**
     * 반응을 달거나 뗀다. **누른 것을 다시 누르면 떼어진다.**
     *
     * **먼저 화면에 반영하고 나중에 보낸다.** 누르자마자 켜지지 않으면
     * 안 눌린 줄 알고 또 누른다. 실패하면 되돌리고 까닭을 알린다.
     */
    const toggleReact = useCallback(async (mid: string, emoji: string) => {
        const mine = (reactsRef.current[mid] ?? [])
            .some(r => r.user_id === me && r.emoji === emoji);
        const row: MessageReaction = {
            message_id: mid, user_id: me, emoji, created_at: new Date().toISOString(),
        };
        if (mine) dropReact(setReacts, row);
        else addReact(setReacts, row, reactSeen.current);

        const { error: err } = mine
            ? await supabase.from('message_reactions').delete()
                  .eq('message_id', mid).eq('user_id', me).eq('emoji', emoji)
            : await supabase.from('message_reactions').insert(row);
        if (err) {
            if (mine) addReact(setReacts, row, reactSeen.current);
            else dropReact(setReacts, row);
            toast(readableError(err), 'error');
        }
    }, [me, toast]);

    /* ── 읽음 표시 ──────────────────────────────────────────────
     *
     * 카톡처럼 말풍선 옆에 **아직 안 읽은 사람 수**를 적는다.
     * 사람마다 '어디까지 읽었나' 시각 하나만 오간다(`lib/reads.ts` 참고).
     */

    /* **오래된 사진을 걷는다**(카톡의 `저장 기간 만료` · `lib/photos.ts`).
       무료 저장 공간이 쌓이기만 해서 언젠가 사진을 아예 못 올리게 되는 것을
       막는 자리다. 기기마다 **하루 한 번**만 돌고, 실패해도 아무 말 없이
       지나간다 — 청소가 안 됐다고 대화가 안 열리면 안 된다.
       투표 결과를 대화방에 남기는 일과 같은 결이다(정해진 시각에 도는 것을
       새로 켜지 않는다). */
    useEffect(() => {
        if (roomId) void purgeOldPhotos(roomId);
    }, [roomId]);

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

    /**
     * **사진을 누르면 앱 안에서 크게 본다.**
     *
     * 예전에는 `<a target="_blank">`로 새 창에 띄웠는데, **앱에서는 그것이
     * 곧 사파리로 나가는 것**이라 앱을 떠나 버린다(사용자 제보 —
     * `사진을 올리면 사파리에서 열려`). 홈 화면 앱에서도 마찬가지였다.
     * 저장은 크게 본 화면에서 길게 눌러 한다 — 거기서는 iOS 기본 손짓을
     * 막지 않는다(`.photo-zoom img`).
     *
     * **말풍선마다 손잡이를 넘기지 않고 목록에서 한 번에 받는다** —
     * `Bubble`이 `memo`라 새 함수를 넘기면 쉰 개가 다시 그려진다.
     */
    const [zoom, setZoom] = useState<string | null>(null);
    /* 저장·공유가 도는 동안 단추를 잠근다. **저장은 끝나기까지 몇 초가
       걸리는데 그동안 아무 말이 없어**, 안 된 줄 알고 또 눌러 **같은
       사진이 여러 장 저장됐다**(사용자 제보). 토스트를 위로 올린 것과
       한 벌이다. */
    const [busy, setBusy] = useState<'save' | 'share' | null>(null);
    const onPhotoTap = useCallback((e: React.MouseEvent) => {
        const a = (e.target as HTMLElement).closest?.('.chat-photo-link');
        if (!(a instanceof HTMLAnchorElement)) return;
        e.preventDefault();
        setZoom(a.href);
    }, []);

    /**
     * 크게 본 사진을 **사진첩에 저장**한다(카톡의 그 단추다 · 사용자 요청).
     *
     * **앱에서는 앱이 맡는다** — 웹의 `<a download>`는 앱 안에서 아무 일도
     * 안 하고, 새 창으로 띄우면 사파리로 나간다. 옛 앱과 웹에서는 폰이
     * 띄워 주는 공유창으로 물러난다(거기에 `이미지 저장`이 들어 있다).
     */
    const savePhoto = async (url: string) => {
        if (busy) return;
        setBusy('save');
        try {
            if (ncOn.current && ncLog.v >= 8) {
                const r = await NativeComposer.savePhoto({ url }).catch(() => null);
                toast(r?.ok ? '사진첩에 저장했습니다.' : '저장하지 못했습니다.',
                      r?.ok ? 'ok' : 'error');
                return;
            }
            if (await sharePhotoFile(url)) return;
            toast('길게 눌러 저장해 주세요.', 'ok');
        } finally { setBusy(null); }
    };

    /** 크게 본 사진을 공유창에 넘긴다. 위 `savePhoto`와 같은 갈래다. */
    const sharePhoto = async (url: string) => {
        if (busy) return;
        setBusy('share');
        try {
            if (ncOn.current && ncLog.v >= 8) {
                const r = await NativeComposer.sharePhoto({ url }).catch(() => null);
                if (!r?.ok) toast('공유하지 못했습니다.', 'error');
                return;
            }
            if (!await sharePhotoFile(url)) toast('이 기기에서는 공유를 지원하지 않습니다.', 'error');
        } finally { setBusy(null); }
    };

    /** 맨 아래를 보고 있었으면 다시 맨 아래로 붙인다. */
    const pinBottom = useCallback(() => {
        const el = listRef.current;
        if (el && atBottom.current) el.scrollTop = el.scrollHeight;
        if (el) listH.current = el.scrollHeight;
    }, []);

    // 그리기가 끝난 프레임에 해야 높이가 확정된다.
    useLayoutEffect(() => { pinBottom(); }, [messages, pinBottom]);

    /**
     * **들어온 뒤 잠깐은 맨 아래를 붙들어 둔다.**
     *
     * 대화방을 열면 그림·글꼴이 뒤늦게 자리를 잡느라 목록 높이가 한동안
     * 바뀐다(실기기 진단 — 들어갈 때 내용 높이가 1089px 줄었다). 그때마다
     * 보던 자리가 어긋나 **글이 위아래로 순간 움직인다**(사용자 제보).
     * 가장 큰 몫이던 '그림 없는 이모티콘'은 자리를 같게 해서 없앴지만,
     * 늦게 오는 글꼴처럼 우리가 못 막는 것도 있어 여기서 한 번 더 받는다.
     *
     * - **맨 아래를 보고 있을 때만** 한다(`pinBottom`이 그것을 본다).
     *   `여기까지 읽으셨습니다` 줄로 옮겨 놓은 자리를 빼앗으면 안 된다.
     * - **1.5초만** 한다. 그 뒤는 사람이 굴리는 것이라 건드리면 안 된다.
     * - 높이가 **바뀔 때만** 붙인다 — 매 프레임 `scrollTop`을 적으면
     *   느린 폰에서 굴리는 것과 다툰다.
     */
    useEffect(() => {
        const el = listRef.current;
        if (!el || !roomId) return;
        let raf = 0;
        let last = el.scrollHeight;
        const until = performance.now() + 1500;
        const tick = () => {
            const h = el.scrollHeight;
            if (h !== last) { last = h; pinBottom(); }
            raf = performance.now() < until ? requestAnimationFrame(tick) : 0;
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [roomId, pinBottom]);

    /**
     * **늦게 뜬 사진이 읽던 자리를 밀어내지 않게 한다.**
     *
     * 사진은 화면에 보일 때가 되어야 받아 오고(`loading="lazy"`), 받기
     * 전에는 높이가 거의 0이다. 그래서 **위로 훑어 올라가는 도중에 화면
     * 위쪽 사진이 도착하면 그만큼 글이 통째로 아래로 밀린다** — 앱에 처음
     * 들어가 처음 올릴 때만 유독 끊겨 보이던 것이 이것이다(두 번째부터는
     * 이미 받아 둬서 높이가 안 변한다). 헤드리스로 재 보니 사진 한 장에
     * **125px씩 네 번** 튀었고, 사진이 없는 방에서는 한 번도 안 튀었다.
     *
     * **크로미움은 이걸 알아서 메워 주는데(scroll anchoring) 사파리는
     * 안 한다.** 그래서 우리가 메운다 — 자란 만큼 스크롤을 함께 내리면
     * 보고 있던 글이 제자리에 남는다.
     *
     * **화면 위쪽에서 자란 것만 메운다.** 보고 있는 자리 아래에서 자라는
     * 것은 원래 그렇게 밀리는 것이 맞다(크로미움도 그렇게 둔다).
     */
    const onImageLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
        const el = listRef.current;
        if (!el) return;
        if (atBottom.current) {          // 맨 아래를 보고 있었으면 도로 바닥에.
            el.scrollTop = el.scrollHeight;
            listH.current = el.scrollHeight;
            return;
        }
        const grew = el.scrollHeight - listH.current;
        listH.current = el.scrollHeight;
        if (grew <= 0 || !listH.current) return;
        // 사진의 **윗변**으로 본다. 자라는 것은 아래쪽이라 윗변은 안 움직인다.
        if (e.currentTarget.getBoundingClientRect().top < el.getBoundingClientRect().top)
            el.scrollTop += grew;
    }, []);

    /* **이모티콘 서랍이 열리면 목록이 그만큼 줄어든다.** 그대로 두면 방금
       읽던 마지막 글이 위로 밀려 안 보인다 — 자리가 좁아진 것이지 가려진
       것이 아니게 하려면 다시 맨 아래로 내려 줘야 한다.
       **`pinBottom`으로는 안 된다** — 목록이 줄어드는 순간 브라우저가 스크롤
       이벤트를 던지고 `onScroll`이 '맨 아래가 아니다'로 내려 버려서, 뒤이어
       도는 `pinBottom`이 아무 일도 안 한다(58px 모자란 채로 멈췄다).
       그래서 여기서는 **조건 없이** 내리고 표시도 함께 되돌린다. */
    useLayoutEffect(() => {
        const el = listRef.current;
        if (!tray || !el) return;
    /* **높이가 한 번에 정해지지 않는다.** 서랍이 붙는 프레임의 목록 높이는
       아직 중간값이라(492px), 거기서 맨 아래로 내려 봐야 최종 높이(434px)
       기준으로는 58px 모자란 자리에 멈춘다 — 실제로 그렇게 어긋났고,
       몇 프레임 따라 내리는 것으로도 안 잡혔다(글칸의 초점이 풀리며 도는
       일이 그보다 늦게 끝난다).
       그래서 **목록이 다시 재어질 때마다** 따라 내리고, 0.6초 뒤에 손을
       뗀다 — 그 뒤로는 사람이 굴리는 것이라 건드리면 안 된다. */
        const drop = () => { atBottom.current = true; el.scrollTop = el.scrollHeight; };
        drop();
        const ro = new ResizeObserver(drop);
        ro.observe(el);
        const off = window.setTimeout(() => ro.disconnect(), 600);
        return () => { ro.disconnect(); clearTimeout(off); };
    }, [tray]);

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
    /** 앱에서 **키보드가 올라오기 시작한다**고 미리 알려 주는 자리.
     *  아래 `앱: 키보드와 같은 박자로` 효과가 채워 넣고, 글칸에 초점이
     *  갈 때 부른다. 웹에서는 늘 비어 있다. */
    const kbHint = useRef<(() => void) | null>(null);

    /** 네이티브 바(3판)가 알려 주는 **키보드가 움직이기 시작한 그 순간**.
     *  아래 `앱: 키보드와 같은 박자로` 효과가 채워 넣고, 네이티브 글칸의
     *  `kb` 신호가 부른다. 옛 앱과 웹에서는 늘 비어 있다. */
    const kbBeat = useRef<((on: boolean, dur: number, at: number, e?: KbSignal) => void) | null>(null);
    /** 진단 — 마지막 키보드 신호를 **그리는 프레임에서** 잰 늦음(ms)과 그래서
     *  쓴 시간, 그리고 `kb`가 iOS 신호보다 얼마나 먼저/늦게 닿았나(음수면 먼저). */
    /** 네이티브 바(4판)가 **그려지는 자리를 프레임마다** 알려 준다. 아래
     *  `앱: 키보드와 같은 박자로` 효과가 채워 넣고, `frame` 신호가 부른다. */
    const kbFrame = useRef<((e: {
        bottom: number; h: number; p: number; end: boolean; chatH?: number; pad?: number;
    }) => void) | null>(null);
    /** 지금 바를 따라가는 중인가. 그동안은 높이를 **다른 데서 안 적는다.** */
    const kbFollow = useRef(false);

    const kbRef = useRef({ typing: false, vh: 0, frame: 0, locked: false, width: 0,
                          /** 바로 앞에 키보드가 올라와 있었는가. 내려가는 **그 순간**만
                           *  목록을 따라 내리려고 둔다 — 화면을 처음 열 때도 이 갈래를
                           *  지나는데, 거기서 따라 내리면 `여기까지 읽으셨습니다` 줄로
                           *  옮겨 놓은 자리를 도로 맨 아래로 끌어내린다. */
                          wasOpen: false });

    /**
     * **키보드가 내려가 목록이 커지면 굴러간 자리를 다시 앉힌다.**
     *
     * 키보드가 올라와 있는 동안 목록은 짧고(464px) 맨 아래까지 굴러가 있다
     * (`scrollTop`이 그 짧은 높이 기준의 끝값이다). 키보드가 내려가 목록이
     * 682px로 커지면 그 끝값은 **더는 갈 수 없는 자리**가 된다 — 크로미움은
     * 그때 알아서 끝으로 당겨 주는데 **iOS 사파리는 그냥 둔다.** 그러면
     * 보이는 창이 글 아래로 넘어가 앉아, 말풍선은 화면 위에 붙고 그 아래가
     * 통째로 비어 보인다(실기기 제보 — 사용자가 **대화를 한 번 굴리면
     * 제자리로 돌아온다**고 한 것이 바로 브라우저가 그때 당겨 주는 것이다).
     *
     * **맨 아래를 보고 있었으면 끝으로, 아니면 넘어간 만큼만 되돌린다** —
     * 옛 글을 읽으려고 올려 둔 자리를 키보드가 내려갔다고 빼앗으면 안 된다.
     *
     * **한 번만 앉히면 안 된다 — 높이가 한 번에 정해지지 않는다.**
     * 한 번만 앉혔더니 이번에는 반대로 **아래가 잘려 새 글이 안 보인다**는
     * 제보가 왔다(실기기 · 사진). 키보드가 내려가는 동안 목록 높이도,
     * 아래 여백(`--composer` 자리)도 여러 단계에 걸쳐 바뀌고, 그때마다 iOS가
     * 굴린 자리를 제 나름대로 손보기 때문이다.
     * 그래서 **이모티콘 서랍과 똑같이** `ResizeObserver`로 목록이 다시 재어질
     * 때마다 따라 내리고 0.6초 뒤에 손을 뗀다 — 그 뒤는 사람이 굴리는 것이라
     * 건드리면 안 된다.
     *
     * **맨 아래였는지는 맨 처음에 한 번만 집는다**(`stick`). 목록이 줄었다
     * 늘 때마다 브라우저가 스크롤 이벤트를 던져 `onScroll`이 '맨 아래가
     * 아니다'로 내려 버리므로, 따라가는 도중에 다시 보면 늘 거짓이 된다.
     */
    const settling = useRef<{ ro: ResizeObserver | null; off: number }>({ ro: null, off: 0 });

    /**
     * `force`를 주면 '맨 아래였는가'를 그 값으로 본다. **부르기 직전에
     * 목록이 이미 줄어들어 `atBottom`이 거짓으로 뒤집힌 자리**에서 쓴다
     * (네이티브 바가 자랄 때가 그렇다 — 위 `height` 주석).
     */
    const settleList = useCallback((force?: boolean) => {
        const el = listRef.current;
        if (!el) return;
        const stick = force ?? atBottom.current;
        const drop = () => {
            const box = listRef.current;
            if (!box) return;
            const max = box.scrollHeight - box.clientHeight;   // 안 넘치면 0이다
            if (stick) { atBottom.current = true; box.scrollTop = max; }
            else if (box.scrollTop > max) box.scrollTop = max;  // 넘어간 만큼만
        };
        drop();
        const s = settling.current;
        s.ro?.disconnect();
        clearTimeout(s.off);
        s.ro = new ResizeObserver(drop);
        s.ro.observe(el);
        s.off = window.setTimeout(() => {
            s.ro?.disconnect();
            s.ro = null;
            /* 손을 떼면서 '맨 아래인가'를 한 번 다시 잰다 — 앉히는 동안에는
               `onScroll`이 그 값을 안 고쳤으므로(위 주석) 여기서 맞춰 둔다. */
            const box = listRef.current;
            if (box) atBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        }, 600);
    }, []);

    useEffect(() => {
        const s = settling.current;
        return () => { s.ro?.disconnect(); clearTimeout(s.off); };
    }, []);

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
        /* **앱에서는 이 함수가 통째로 물러난다.** 키보드에 맞춰 화면을
           움직이는 일은 아래 `앱: 키보드와 같은 박자로` 효과가 혼자 맡는다 —
           두 곳이 같은 값을 건드리면 서로 엇박이 난다. */
        if (IS_NATIVE) return;
        const vv = window.visualViewport;
        const s = kbRef.current;
        const vh = Math.round(vv ? vv.height : window.innerHeight);
        // **키보드 높이는 `documentElement.clientHeight`에서 잰다.** 이 값은
        // 문서가 놓인 자리(707)라 키보드가 떠도 안 줄어든다 —
        // `window.innerHeight`는 iOS 홈 화면 앱에서 함께 줄어들어 못 쓴다.
        // 초점은 그보다 먼저 오는 신호라 함께 본다.
        const gap = document.documentElement.clientHeight - vh;
        const open = s.typing || gap > 120;
        // 키보드가 방금 내려갔는가. **아래 갈래까지 갔을 때만 지운다** —
        // 붙박여 있어 일찍 돌아서는 판에서 지워 버리면, 정작 크기를 다시
        // 재는 판이 왔을 때 '방금 내려갔다'를 놓친다.
        const closing = s.wasOpen && !open;
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
            s.wasOpen = true;
        } else {
            // 키보드가 없을 때는 지운다 — 남겨 두면 옛 높이가 굳는다.
            root.removeProperty('--vvh');
            root.setProperty('--kb', '0px');
            /* 목록이 커진 만큼 굴러간 자리를 다시 앉힌다. **여기서 한 번만
               부른다** — 뒤는 `settleList`가 목록이 다시 재어질 때마다 따라
               내린다. 두 번 부르면 그 사이 들어온 스크롤 이벤트 때문에
               '맨 아래였는가'를 거짓으로 다시 집어 따라가기가 멈춘다.
               **키보드가 방금 내려간 때만** 부른다 — 화면을 처음 열 때도
               이 갈래를 지나는데, 거기서 따라 내리면 안 읽은 줄로 옮겨 놓은
               자리를 도로 맨 아래로 끌어내린다. */
            if (closing) settleList();
            s.wasOpen = false;
        }
    }, [settleList]);

    /**
     * **앱: 키보드와 같은 박자로 대화 화면을 움직인다.**
     *
     * `resize: 'native'`는 키보드가 미는 문제를 없애 줬지만, **엇박자가
     * 남았다**(사용자 제보 — `메시지창을 누르면 키보드가 뜨고 그 후에
     * 메시지창이 떠 · 내려갈 때도 뭔가 엇박자야`).
     *
     * **원인은 우리 코드가 아니라 플러그인의 타이밍이다.** `Keyboard.m`을
     * 읽어 보면 그대로 적혀 있다:
     *
     *   열 때  `delay = 키보드 애니메이션 시간 + 0.2` 뒤에 창을 줄인다
     *   닫을 때 `delay = 0.01` — 거의 즉시 창을 늘린다
     *
     * 키보드는 0.25초에 걸쳐 올라오는데 창은 **0.45초 뒤에 툭** 줄어들고,
     * 내릴 때는 반대로 **창이 먼저 늘어나고** 키보드가 뒤늦게 사라진다.
     * 그 어긋남이 눈에 보인 것이다.
     *
     * 그래서 **플러그인이 창을 줄이기 전까지의 틈을 우리가 메운다.**
     * 플러그인은 `keyboardWillShow`를 **애니메이션이 시작하는 그 순간**
     * 알려 주므로(늦는 것은 창을 줄이는 일뿐이다) 그때 우리가 먼저 줄인다.
     *
     * 셈은 한 줄이다 — **아직 창이 안 먹은 만큼만 우리가 먹는다:**
     *
     *   메울 몫 = 키보드 높이 − (원래 높이 − 지금 창 높이)
     *
     * 열 때는 0.45초 동안 우리가 다 메우다가, 창이 줄어드는 순간 몫이 0이
     * 되어 **높이가 한 픽셀도 안 바뀐다**(그래서 그 자리에서 안 튄다).
     * 닫을 때는 창이 먼저 늘어나므로 높이가 한 번에 커지는데, CSS가 그것을
     * 0.25초에 걸쳐 펴 줘 키보드가 내려가는 속도와 맞는다.
     *
     * **높이를 한 값(`--chat-h`)으로만 몬다.** `100dvh`와 `--kb`를 함께
     * 쓰면 창이 줄어드는 그 프레임에 둘이 따로 바뀌어 한 번 튄다.
     * `Chat.css`의 `html.native .chat`과 한 쌍이다 — 한쪽만 고치지 말 것.
     */
    useEffect(() => {
        if (!IS_NATIVE) return;
        const root = document.documentElement;
        /** 키보드가 없을 때의 창 높이. 다 닫힌 뒤에 다시 잰다. */
        let base = root.clientHeight;
        /* **4판부터는 CSS가 부드럽게 하지 않는다.** 움직임은 바가 프레임마다
           보내는 자리(`kbFrame`)가 맡고, 그 밖의 값 변화(들어올 때 여백이
           정해지는 것 등)는 곧바로 자리를 잡는 것이 맞다 — 250ms에 걸쳐
           옮기면 들어갈 때 글이 내려갔다 올라오는 것으로 보인다. */
        /* **여기서도 판 번호를 값으로 잡으면 안 된다** — `owns6()`과 똑같은
           자리다. 화면이 열리는 순간에는 아직 앱에 안 물어봐서 늘 0이라,
           `--chat-anim`이 **250ms인 채로 남았다.** 그래서 앱이 준 값은 곧바로
           들어가는데 화면만 CSS로 0.25초 더 끌려갔다 — 진단 줄에 `h874 b150`은
           첫 줄부터 끝값인데 `L`만 348→618로 235ms에 걸쳐 자란 것이 그것이다
           (사용자 제보 — `늦게 따라와`). 지금은 바가 값을 보내오는 그 자리에서
           끈다(`kbFrame`). */
        const follows = () => ncLog.v >= 4;
        /* **6판부터는 바가 두 값의 주인이다**(`--chat-h`·`--composer`).
           5판까지는 움직이는 동안만 바가 적고 그 밖에는 여기서 셈했는데,
           **둘이 엇갈려 목록이 흔들렸다**(진단 — `--composer`가 116과 150을
           오가며 `L618↔652`). 값을 적는 곳을 하나로 몰면 그럴 자리가 없다.

           **부를 때마다 본다. 여기서 한 번 정해 두지 말 것** — 판 번호는
           `composerReady()`가 앱에 물어봐야 알 수 있고 그 답은 이 효과가
           도는 뒤에 온다. 값으로 잡아 두었더니 **늘 거짓이라 6판 코드가
           통째로 안 돌았다**(실기기 진단 — `틱70`이 도는데도 `b116↔150`이
           그대로였다). */
        const owns = owns6;
        /* 지난번 바 높이를 먼저 적어 둔다(`lastBarH` 주석). */
        if (lastBarH) root.style.setProperty('--composer', `${lastBarH}px`);
        /** 키보드가 가릴 높이(플러그인이 알려 준 값). */
        let want = 0;
        /**
         * **지난번 키보드 높이를 기억해 둔다.**
         *
         * `keyboardWillShow`는 네이티브에서 웹으로 한 번 건너오므로 한두
         * 프레임 늦게 도착한다. 0.25초짜리 움직임에서 그 30ms가 곧
         * `살짝 따로 노는` 느낌이다. 그래서 **글칸에 초점이 가는 순간**
         * (그건 우리 쪽 이벤트라 안 늦는다) 지난번 높이로 먼저 시작하고,
         * `keyboardWillShow`가 오면 값만 바로잡는다 — 대개 같은 값이라
         * 아무것도 안 바뀐다.
         * 폰을 처음 켠 판에서도 맞게 시작하도록 기기에 적어 둔다.
         */
        const MEMO = `teetime:kbh:${window.innerWidth}`;
        const recall = () => Number(localStorage.getItem(MEMO)) || 0;
        /** 마지막으로 받은 키보드 신호(3판 `kb`). `at`이 0이면 아직 안 쓴 것이 없다. */
        const beat = { at: 0, dur: 250 };
        let flushAt = 0;
        /**
         * **높이는 그리는 프레임에서 적는다**(`requestAnimationFrame`).
         *
         * 늦은 만큼을 빼는 셈(`--chat-anim`)을 신호가 **닿은 순간**에 하면
         * 다리를 건너온 시간만 잡힌다. 그런데 화면이 실제로 움직이기 시작하는
         * 것은 그다음 **그리는 프레임**이고, 그 사이에 React가 다시 그리고
         * 목록을 앉히는 일이 끼어든다 — 폰에서는 그것만으로 한두 프레임이다.
         * 그래서 여기서 재야 늦음이 다 잡힌다. 어차피 움직임은 이 프레임에
         * 시작하므로 미룬다고 늦어지는 것도 없다.
         */
        const flush = () => {
            flushAt = 0;
            if (owns() || kbFollow.current) return;   // 바가 적는다
            if (beat.at && !follows()) {        // 4판부터는 전환 시간을 안 쓴다(늘 0)
                const gone = Date.now() - beat.at;
                /* 신호가 한참 지난 것이면(그 움직임은 이미 끝났다) 원래 시간으로
                   되돌린다 — 안 그러면 다음 움직임이 엉뚱하게 짧아진다. */
                const late = gone < beat.dur ? Math.min(Math.max(0, gone), beat.dur * 0.6) : 0;
                root.style.setProperty('--chat-anim', `${Math.round(beat.dur - late)}ms`);
                beat.at = 0;
            }
            const now = root.clientHeight;
            const eaten = Math.max(0, base - now);       // 창이 이미 줄어든 만큼
            const gap = Math.max(0, want - eaten);       // 아직 우리가 메울 몫
            root.style.setProperty('--chat-h', `${now - gap}px`);
        };
        const paint = () => { if (!flushAt) flushAt = requestAnimationFrame(flush); };
        const open = (on: boolean) => {
            document.body.classList.toggle('kb-open', on);
            root.classList.toggle('kb-open', on);
        };
        /* **탭바는 따로 여닫는다.** `kb-open`을 내리는 순간 탭바가 도로
           튀어나오는데, 그때 입력칸은 아직 0.25초에 걸쳐 내려오는 중이라
           둘이 겹쳐 보인다. 탭바는 **다 내려간 뒤에**(`keyboardDidHide`)
           내놓는다 — 그 자리는 입력칸의 아래 여백이 이미 비워 둔 뒤다. */
        const bar = (on: boolean) => document.body.classList.toggle('kb-bar', on);

        /** 키보드가 내려간다. `keyboardWillHide`와 네이티브 바의 `kb`가
            같이 쓴다 — 먼저 닿은 쪽이 하고 나중 것은 같은 값이라 그냥 지나간다. */
        const hide = () => {
            want = 0;
            open(false);
            /* **2판부터는 탭바를 여기서 바로 내놓는다.** 바가 늘 화면
               아래에 서 있고 키보드만 내려가므로, 바가 탭바 자리(`tabH`)를
               도로 비워 주는 **바로 그 순간** 탭바가 있어야 한다.
               `keyboardDidHide`까지 미루면 그 사이가 빈 채로 남아
               **탭바가 사라졌다 나타나는 것처럼 보인다**(실기기 제보 —
               `키보드 내릴때 탭바가 사라졌다가 나타나고`).
               1판은 바가 키보드와 함께 내려가므로 그대로 미룬다. */
            if (root.classList.contains('nc2')) bar(false);
            paint();
            settleList();
        };

        paint();
        const onResize = () => paint();
        window.visualViewport?.addEventListener('resize', onResize);
        window.addEventListener('resize', onResize);

        let drop: Array<() => void> = [];
        let dead = false;
        void (async () => {
            /* `addListener`는 이름마다 형이 갈려 있어 **하나로 묶어 부를 수
               없다**(묶으면 타입 검사가 막는다). 넷을 그냥 나란히 건다. */
            const { Keyboard } = await import('@capacitor/keyboard');
            const hs = await Promise.all([
                Keyboard.addListener('keyboardWillShow', info => {
                    want = info?.keyboardHeight ?? 0;
                    if (want) localStorage.setItem(MEMO, String(want));
                    open(true);
                    bar(true);
                    paint();
                    /* **줄어드는 동안 목록을 따라 앉힌다. 이게 빠지면 맨 아래
                       글이 잘려 안 보인다**(사용자 제보 · 사진 — 키보드를 올리니
                       마지막 글이 사라졌다). 목록이 330px쯤 짧아지는데 굴러간
                       자리는 그대로라, 보고 있던 창이 글 아래로 넘어가 앉는다.
                       `settleList`는 **맨 아래를 보고 있었으면 끝으로, 아니면
                       넘어간 만큼만** 되돌리고, 높이가 0.25초에 걸쳐 바뀌므로
                       그 동안 따라간다(`ResizeObserver`). */
                    settleList();
                }),
                /* 탭바(`bar`)는 여기서 안 내놓는다 — 위 `bar` 주석 참고. */
                Keyboard.addListener('keyboardWillHide', hide),
                Keyboard.addListener('keyboardDidShow', () => paint()),
                /* 다 닫히고 나서 원래 높이를 다시 잰다 — 상태 막대나
                   가로세로가 바뀌었을 수 있다. 목록이 커진 만큼 굴러간
                   자리도 그때 앉힌다. */
                Keyboard.addListener('keyboardDidHide', () => {
                    want = 0;
                    base = root.clientHeight;
                    bar(false);
                    paint();
                    settleList();
                }),
            ]);
            if (dead) { hs.forEach(h => { void h.remove(); }); return; }
            drop = hs.map(h => () => { void h.remove(); });
        })();

        /* 글칸에 초점이 가는 순간 **지난번 높이로 먼저 시작한다**(위 `MEMO`
           주석). 아직 한 번도 안 겪은 판이면 아무것도 안 한다 — 그때는
           `keyboardWillShow`를 그대로 기다린다. */
        kbHint.current = () => {
            if (want) return;                 // 이미 올라와 있다
            const h = recall();
            if (!h) return;
            want = h;
            open(true);
            bar(true);
            paint();
            settleList();
        };

        /**
         * **늦게 받은 만큼 짧게 움직인다**(네이티브 바 3판).
         *
         * 화면이 키보드와 같은 시간(0.25초)·같은 곡선으로 움직이는데도
         * **늦게 따라오는 것처럼 보이는 까닭은 시작이 늦어서다**(사용자 제보 —
         * `키보드 나오고 내려갈때 채팅배경이 좀 늦게 따라와`). 소식이 앱에서
         * 웹으로 다리를 건너오느라 한두 프레임이 이미 지나가 있는데, 거기서
         * 0.25초를 **다 쓰면** 그만큼 늦게 도착한다.
         *
         * 그래서 바가 **보낸 시각**을 함께 실어 준다(`at`). `Date.now()`와
         * 견주면 늦은 만큼이 그대로 나오므로, 남은 시간만큼만 움직여
         * 키보드와 **같이 끝난다.**
         * 0.25초라는 값 자체는 그대로다 — 눈대중으로 줄인 것이 아니다.
         */
        /**
         * **앱이 목록 그림을 들고 움직이는 판**(14판 · `ListSlider.swift`).
         *
         * 사용자가 `카톡만큼 부드럽게`를 바라며 짚은 자리가 **키보드가
         * 오르내릴 때**였다. 아래 `kbFrame`까지가 웹이 프레임마다 따라가는
         * 길이었는데, 한 프레임마다 다리를 건너고 목록을 다시 배치하는
         * 일이라 아무리 맞춰도 고르게 안 나온다. 이제는 키보드가 움직이기
         * 시작하는 그 순간 앱이 웹뷰의 화면을 떠서 키보드와 **한 움직임**으로
         * 옮기고, 웹은 그 그림 뒤에서 **한 번만** 이렇게 한다:
         *
         * 1. 끝값(`chatH`·`pad`)을 곧바로 적는다 — 전환 없이.
         * 2. 굴린 자리를 `s`만큼 옮긴다. 목록 아랫변이 바 윗변에 붙어 있어
         *    목록은 `s`만큼 짧아지거나 길어지는데, 그만큼 굴려야 **화면에
         *    보이는 글이 그림과 같은 자리에 있다.** 카톡도 그렇게 움직인다 —
         *    위로 올려 둔 채 글칸을 눌러도 글이 키보드와 함께 올라간다.
         *    (예전 `settleList`는 맨 아래일 때만 끝으로 붙이고 아니면 그대로
         *    두었다 — 그러면 그림을 걷을 때 `s`만큼 튄다.)
         * 3. 다 그린 뒤(`requestAnimationFrame` 두 번) `settled`로 알린다.
         *    **실제로 옮긴 거리(`dy`)를 실어 보낸다** — 내려갈 때 맨 위
         *    가까이 있었으면 그만큼 못 옮기는데, 앱이 그 값으로 그림의 끝
         *    자리를 맞춘다. 앱은 이 신호를 받아야 그림을 걷는다.
         *
         * `frame`은 이때 안 온다(앱이 안 보낸다). 바가 자리를 잡을 때마다
         * 보내는 끝값 보고(`end: true`)는 그대로 오는데 같은 값이라 아무
         * 일도 안 한다.
         */
        const slideKb = (e: KbSignal) => {
            const el = listRef.current;
            const s = Math.round(e.s ?? 0);
            root.style.setProperty('--chat-anim', '0ms');
            root.style.setProperty('--chat-h', `${Math.round(e.chatH ?? 0)}px`);
            root.style.setProperty('--composer', `${Math.round(e.pad ?? 0)}px`);
            if (!kbFollow.current) {
                kbFollow.current = true;
                root.classList.add('kb-follow');
            }
            open(e.on);
            bar(e.on);
            want = e.on ? (want || recall()) : 0;
            let dy = 0;
            if (el) {
                /* 여기서 `scrollTop`을 적고 다시 읽는 것이 곧 **한 번의 배치**다 —
                   높이를 바꿔 둔 뒤라 브라우저가 그 자리에서 배치하고 끝값으로
                   자른다. 그래서 `dy`가 실제로 옮긴 거리가 된다. */
                const before = el.scrollTop;
                el.scrollTop = before + s;
                dy = Math.round(el.scrollTop - before);
                /* 맨 아래였으면 옮긴 뒤에도 맨 아래다(`s`만큼 짧아지며 끝도
                   `s`만큼 내려간다). 아니었으면 그대로 아니다 — 값을 안 건드린다. */
            }
            requestAnimationFrame(() => requestAnimationFrame(() => {
                void hush(NativeComposer.settled({ dy }));
            }));
        };

        kbBeat.current = (on, dur, at, e) => {
            /* 14판 — 앱이 그림을 들고 움직인다고 하면 끝값을 한 번에 적는 길로.
               `slide`가 거짓이면(서랍·검색 중이라 웹이 꺼 두었거나, 그림을
               못 떴거나) 13판처럼 프레임마다 따라간다. */
            if (e?.slide && e.chatH !== undefined && e.pad !== undefined && canSlide()) {
                slideKb(e);
                return;
            }
            /* 시각만 담아 두고 **재는 것은 그리는 프레임에서** 한다(`flush`).
               그다음은 여느 신호와 같다 — 먼저 닿은 쪽이 하고 나중 것은
               같은 값이라 그냥 지나간다. */
            beat.at = at;
            beat.dur = Math.round((dur || 0.25) * 1000);
            if (on) kbHint.current?.();
            else hide();
        };

        /**
         * **바가 그려지는 자리를 그대로 따라간다**(네이티브 바 4판).
         *
         * 위 `kbBeat`까지가 곡선을 **흉내 내는** 길이었다 — 시간을 iOS가
         * 알려 준 값(실기기에서 0.383초였다. 0.25초가 아니다)으로 맞추고
         * 늦은 만큼을 빼도 실기기에서는 `아직 늦다`가 남았다. 곡선 자체가
         * 다른 것이다. 바는 iOS가 키보드와 한 움직임으로 옮기므로 **바의
         * 실제 자리가 곧 키보드의 자리**다. 그 값을 프레임마다 받아 화면
         * 높이로 그대로 쓴다 — 전환(`--chat-anim`)은 0으로 두어 CSS가
         * 저 알아서 부드럽게 하려 들지 않게 한다. 한 번 건너오는 데 10ms쯤이다.
         *
         * 홈 인디케이터 몫(`--safe-b`)은 키보드가 내려가 있을 때만 화면
         * 안에 있으므로 `p`(0~1)로 섞는다 — 다 내려가면 34, 다 올라가면 0.
         * 그동안 입력칸 아래 여백은 `--composer` 하나로 몬다(`Chat.css`의
         * `kb-follow`). 끝나면 여느 때의 셈(`paint`)으로 돌아간다.
         */
        const safeB = () => {
            const v = parseFloat(getComputedStyle(root).getPropertyValue('--safe-b'));
            return Number.isFinite(v) ? v : 0;
        };
        kbFrame.current = e => {
            /* **6판은 늘 바가 적는다** — 움직이는 동안인지 가리지 않는다.
               `end`는 '이번 움직임이 끝났다'는 뜻일 뿐이라, 거기서 웹 셈으로
               돌아가면 그때부터 둘이 엇갈린다(위 `owns` 주석). */
            if (owns()) {
                if (e.chatH === undefined || e.pad === undefined) return;
                /* **값을 먼저 다 적고, 그 뒤에 다른 일을 한다.** 사이에
                   `settleList()`처럼 배치를 읽는 것이 끼면 그 한 프레임만
                   **반쯤 적힌 값으로 그려진다**(진단 — `b116`인데 `L652`).
                   `kb-follow`는 바를 세울 때 이미 붙여 두었다. */
                root.style.setProperty('--chat-h', `${Math.round(e.chatH)}px`);
                root.style.setProperty('--composer', `${Math.round(e.pad)}px`);
                /* **값을 적은 뒤에 붙인다.** 이 표가 붙으면 `--composer`가
                   '바 높이'가 아니라 '가리는 자리'라는 뜻이 되므로, 먼저
                   붙이면 옛 값(34px 작은 것)으로 한 프레임이 그려진다.
                   바를 세울 때 붙이던 것을 여기로 옮긴 까닭이다. */
                if (!kbFollow.current) {
                    kbFollow.current = true;
                    /* **CSS가 부드럽게 하려 드는 것을 끈다.** 움직임은 바가
                       프레임마다 보내 주는 값이 맡으므로, 여기에 전환 시간이
                       남아 있으면 그만큼 **한 번 더 늦게** 따라간다. */
                    root.style.setProperty('--chat-anim', '0ms');
                    root.classList.add('kb-follow');
                }
                if (e.end) settleList();
                return;
            }
            if (!e.end) {
                if (!kbFollow.current) {
                    kbFollow.current = true;
                    root.classList.add('kb-follow');
                    root.style.setProperty('--chat-anim', '0ms');
                    /* 따라가는 내내 맨 아래를 붙들어 둔다 — 신호 처리
                       (`hide`·`kbHint`)의 600ms가 끝나기 전에 시작하는 것이
                       보통이지만, 여기서 다시 걸어 두면 늦게 시작해도 된다. */
                    settleList();
                }
                /* **5판은 둘을 자리 하나에서 셈해 보낸다**(`chatH`·`pad`).
                   4판은 바의 그려지는 높이를 따로 줬는데, 자리와 높이의 곡선이
                   달라 목록이 넘쳤다 돌아왔다(실기기 제보 — `내려갔다가 다시
                   올라와`). 4판이면 예전 셈으로 물러난다. */
                if (e.chatH !== undefined && e.pad !== undefined) {
                    root.style.setProperty('--chat-h', `${Math.round(e.chatH)}px`);
                    root.style.setProperty('--composer', `${Math.round(e.pad)}px`);
                    return;
                }
                const extra = safeB() * (1 - e.p);
                root.style.setProperty('--chat-h', `${Math.round(e.bottom + extra)}px`);
                root.style.setProperty('--composer', `${Math.round(e.h + extra)}px`);
                return;
            }
            if (!kbFollow.current) return;
            kbFollow.current = false;
            root.classList.remove('kb-follow');
            if (ncH.current) root.style.setProperty('--composer', `${ncH.current}px`);
            paint();
            settleList();
        };

        return () => {
            dead = true;
            kbHint.current = null;
            kbBeat.current = null;
            kbFrame.current = null;
            kbFollow.current = false;
            root.classList.remove('kb-follow');
            cancelAnimationFrame(flushAt);
            root.style.removeProperty('--chat-anim');
            drop.forEach(f => f());
            drop = [];
            window.visualViewport?.removeEventListener('resize', onResize);
            window.removeEventListener('resize', onResize);
            root.style.removeProperty('--chat-h');
            open(false);
            bar(false);
        };
    }, [settleList]);

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
            /* **`kb-bar`도 함께 걷는다.** 이것만 남으면 대화를 떠난 뒤에도
               탭바가 사라진 채로 굳는다 — `kb-open`과 하는 일이 같은데
               여기서 빠져 있었다(사용자 제보 — `뒤로가기하면 가끔 탭바가
               사라지는 경우가있어`). 그 표는 키보드가 **다 내려간 뒤에**
               내놓으려고 따로 둔 것이라, 내려가는 도중에 화면을 옮기면
               내놓을 사람이 없어진다. */
            document.body.classList.remove('kb-bar');
        };
    }, [applyKeyboard, syncKeyboard, watchViewport]);

    /**
     * **홈으로 나갔다 돌아오면 키보드 자리가 그대로 남던 것.**
     *
     * 키보드를 올려 둔 채 홈으로 나갔다 조금 있다 돌아오면, 키보드는
     * 사라졌는데 **입력칸이 키보드가 있던 자리에 그대로 떠 있고** 그
     * 아래가 텅 빈 채로 굳었다(실기기 제보 · 사진으로 확인).
     *
     * 우리가 그 사실을 알 길이 없어서다 — 초점은 입력칸에 그대로 남아
     * `blur`가 안 오므로 `typing`이 계속 참이고, 게다가 키보드가 다
     * 올라온 뒤 **붙박아 둔(`locked`)** 상태라 크기가 바뀌어도 다시 안 잰다.
     * 그래서 `--kb`·`--vvh`가 옛 키보드 높이 그대로 남는다.
     *
     * 돌아오는 순간 **붙박기를 풀고 실제 높이로 다시 판단한다.** 키보드가
     * 정말로 내려가 있으면 초점도 함께 뗀다 — 안 떼면 `typing`이 계속
     * 거짓말을 해서 다음에 또 같은 자리에 갇힌다.
     *
     * **두 번 본다.** 돌아온 첫 프레임에는 iOS가 아직 크기를 되돌리는
     * 중이라, 0.25초 뒤에 한 번 더 봐야 제 높이가 나온다.
     */
    useEffect(() => {
        const check = () => {
            const s = kbRef.current;
            const vv = window.visualViewport;
            const vh = Math.round(vv ? vv.height : window.innerHeight);
            const gap = document.documentElement.clientHeight - vh;
            if (gap <= 120) {              // 키보드가 정말로 없다
                s.typing = false;
                setFocused(false);
                if (document.activeElement === taRef.current) taRef.current?.blur();
            }
            applyKeyboard(true);
        };
        const back = () => {
            if (document.visibilityState !== 'visible') return;
            kbRef.current.locked = false;   // 먼저 풀어야 다시 잰다
            check();
            setTimeout(check, 250);
        };
        document.addEventListener('visibilitychange', back);
        // 뒤로 가기로 되살아난 화면(bfcache)에도 같은 일이 생긴다.
        window.addEventListener('pageshow', back);
        return () => {
            document.removeEventListener('visibilitychange', back);
            window.removeEventListener('pageshow', back);
        };
    }, [applyKeyboard]);

    const blurTimer = useRef(0);

    const onComposerFocus = () => {
        clearTimeout(blurTimer.current);
        // **글칸을 누르면 서랍이 닫힌다** — 키보드가 그 자리에 올라오므로
        // 열어 둔 채로는 둘이 겹친다. 카톡도 그렇게 맞바뀐다.
        setTray(false);
        const s = kbRef.current;
        s.typing = true;
        s.locked = false;
        setFocused(true);
        /* **앱에서는 여기가 제일 이른 신호다.** 네이티브가 알려 주는
           `keyboardWillShow`는 한 번 건너오느라 한두 프레임 늦는데,
           0.25초짜리 움직임에서 그 30ms가 곧 `살짝 따로 노는` 느낌이다. */
        kbHint.current?.();
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
            // 네이티브 바를 쓰는 판에서는 **그쪽이 제 높이를 알려 준다** —
            // 여기서 재면 감춰 둔 웹 글칸의 높이로 덮어쓴다. 대신 그쪽이
            // 마지막으로 알려 준 값을 **다시 적어 둔다**(아래 주석).
            if (ncOn.current) {
                /* **6판부터는 여기서 아무것도 안 적는다.** 바가 `frame`으로
                   **가리는 자리**를 알려 주는데(홈 인디케이터·탭바 몫까지 든
                   값이다), 여기서 적는 `ncH`는 **바의 높이**라 34px 작다 —
                   둘이 섞이면 목록이 그만큼 흔들린다(실기기 — `b116↔150`).
                   이 관찰자는 초점이 오갈 때마다 깨어나므로 그때마다 튀었다. */
                if (owns6()) return;
                if (ncH.current) {
                    document.documentElement.style.setProperty('--composer', `${ncH.current}px`);
                }
                return;
            }
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
            /* **네이티브 바가 쓰는 값은 여기서 안 지운다.**
             *
             * 이 효과는 `focused`가 바뀔 때마다 다시 도는데, 지우고 나서
             * 다시 적는 일은 위 `write()`가 `ncOn`에서 되돌아서므로 **영영
             * 안 채워졌다** — 그러면 CSS의 예비값(60px)이 쓰이는데 실제 바는
             * 116px이라 **목록 아래 56px이 바 뒤로 숨어 마지막 글이 안 보인다**
             * (실기기 · 진단 줄에 `b0 L674`로 찍혔다).
             *
             * 키보드를 **내릴** 때만 걸린 것도 그 때문이다 — 올릴 때는
             * `setFocused(true)` 뒤에 바가 높이(58)를 알려 와 도로 채워지는데,
             * 내릴 때는 `onComposerBlur`가 150ms 기다렸다 `setFocused(false)`를
             * 부르므로 **바가 알려 준 116이 먼저 오고 그다음에 지워진다.**
             *
             * 화면을 떠날 때는 네이티브 효과의 뒷정리가 지운다(그쪽이
             * `ncOn`을 내린 뒤에 지우므로 순서도 맞는다). */
            if (!ncOn.current) document.documentElement.style.removeProperty('--composer');
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
            /* 네이티브 글칸을 쓰는 판에서는 그쪽에 내리라고 한다.
               (`blurDraft`는 아래에 있어 여기서 못 쓴다.) */
            if (dy > 40 && dy > dx) {
                if (ncOn.current) void hush(NativeComposer.blur());
                else taRef.current?.blur();
            }
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

    /**
     * **곧 볼 그림을 쉬는 동안 미리 받아 둔다.**
     *
     * 사진과 이모티콘은 화면에 보일 때가 되어야 받아 온다(`loading="lazy"`).
     * 데이터를 아끼는 옳은 규칙인데, 그 바람에 **받아 오고 푸는 일이 손가락이
     * 움직이는 바로 그 순간에 벌어진다** — 앱에 처음 들어가 대화를 위로 올릴
     * 때만 유독 끊기던 것이 이것이다. 두 번째부터 멀쩡한 것은 이미 받아 둬서
     * 할 일이 없기 때문이다.
     *
     * 폰만큼 느리게 해 놓고 재 보니(CPU 12배 · `.dev/jank.mjs`) 사진과
     * 이모티콘이 섞인 방에서 **첫 스크롤에 프레임이 12번 밀렸고**(가장 긴 것
     * 133ms) 글만 있는 방은 1번이었다. 그림을 **언제** 받느냐가 전부였다.
     * 사람이 읽고 있는 동안 미리 켜 두니 **12 → 3번**으로 떨어졌다.
     *
     * 넷을 지킬 것 — 하나씩 다 재서 얻은 것이다:
     * - **진짜 요소의 `loading`을 바꾼다.** 따로 만든 `new Image()`로 받아
     *   두는 길도 해 봤는데 **전혀 안 줄었다**(15개 그대로) — 그렇게 받은
     *   것은 화면에 걸린 그림과 따로 논다.
     * - **그림 자리를 재지 말 것.** '화면에서 얼마나 떨어졌나'로 고르게 했다가
     *   **되레 나빠졌다**(12 → 14.7). `getBoundingClientRect()`가 그때마다
     *   배치를 다시 잡게 하는데, 그게 하필 굴리는 중에 돈다. 지금은 자리를
     *   안 보고 **아래에서부터 차례로** 켠다 — 대화는 위로 훑어 올라간다.
     * - **굴릴 때 부르지 말 것.** 같은 이유다. 여기서 하는 일은 사람이
     *   읽는 동안 끝나야 한다.
     * - **한 번에 세 장씩, 200ms 띄워서.** 한꺼번에 켜면 그 자체로 한
     *   프레임을 먹어 미리 받는 뜻이 없어진다.
     *
     * 몫(`WARM_PHOTOS`·`WARM_STICKERS`)은 방을 옮길 때 새로 준다. `지난 대화
     * 더 보기`를 누른 것은 옛 글을 읽겠다는 뜻이라 그때도 다시 채운다.
     */
    const freshWarm = () => ({ photo: WARM_PHOTOS, sticker: WARM_STICKERS, anim: WARM_ANIM });
    const warmLeft = useRef(freshWarm());
    useEffect(() => { warmLeft.current = freshWarm(); }, [roomId]);

    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        let timer = 0;
        const step = () => {
            timer = 0;
            const left = warmLeft.current;
            const imgs = el.querySelectorAll<HTMLImageElement>('.chat-image, .chat-sticker');
            let n = 0;
            for (let i = imgs.length - 1; i >= 0 && n < WARM_BATCH; i--) {
                const img = imgs[i];
                if (img.loading !== 'lazy' || img.complete) continue;
                /* 셋으로 가른다 — 사진 · 멈춘 이모티콘 · 움직이는 이모티콘.
                   움직이는 것만 파일이 서른 배라 몫을 따로 준다. */
                const kind = !img.classList.contains('chat-sticker') ? 'photo'
                    : img.src.endsWith('.webp') ? 'anim' : 'sticker';
                if (left[kind] <= 0) continue;
                left[kind]--;
                img.loading = 'eager';
                /* **받아 두는 것만으로는 모자란다 — 푸는 일도 미리 시킨다.**
                   `eager`는 파일을 받아 오게 할 뿐이고, 압축을 푸는 일은
                   **그릴 때** 벌어진다. 사파리(WebKit)는 그것을 화면 그리는
                   그 갈래에서 하므로(위 '이모티콘 그림' 꼭지) 굴리는 도중에
                   걸리면 그대로 끊긴다. `decode()`는 '지금 미리 풀어 두라'는
                   뜻이라 그 일을 사람이 읽는 동안으로 옮겨 준다.
                   **기다리지 않는다**(`await` 없음) — 여기서 기다리면 다음
                   묶음이 그만큼 늦어진다. 못 푸는 그림은 그냥 넘어간다. */
                void img.decode?.().catch(() => {});
                n++;
            }
            if (n) timer = window.setTimeout(step, WARM_GAP);
        };
        timer = window.setTimeout(step, WARM_GAP);
        return () => clearTimeout(timer);
    }, [messages]);

    const onScroll = () => {
        const el = listRef.current;
        if (!el) return;
        const below = el.scrollHeight - el.scrollTop - el.clientHeight;
        /* **앉히는 동안에는 '맨 아래인가'를 고쳐 쓰지 않는다.** 키보드가
           오르내리면 목록 높이가 여러 단계에 걸쳐 바뀌고 그때마다 브라우저가
           스크롤 이벤트를 던지는데, 그 한 번이 `atBottom`을 거짓으로 내려
           버리면 **뒤따라오는 신호가 전부 '맨 아래가 아니었다'로 읽힌다** —
           네이티브 바가 자랐다고 알려 올 때(`height`)가 그 자리다.
           `settleList`가 손을 떼면서 한 번 다시 잰다. */
        if (!settling.current.ro) atBottom.current = below < 80;
        // 굴릴 때마다 높이를 다시 적어 둔다 — 사진이 도착했을 때 얼마나
        // 자랐는지 견줄 잣대다(위 `onImageLoad`).
        listH.current = el.scrollHeight;
        // 화살표는 **뒤집힐 때만** 알린다 (위 `showJump` 주석 참고).
        const far = below > JUMP_AT;
        if (far !== jumpShown.current) { jumpShown.current = far; setShowJump(far); }
    };

    /* **화살표에 마지막 대화를 함께 적는다**(사용자 요청 — 카톡의 그 줄).
       동그란 화살표만 있을 때는 '아래에 뭐가 있나'를 눌러 봐야 알았다.
       `windowed`일 때는 이 단추 자체가 안 뜨므로(아래 JSX) 목록의 마지막
       글이 곧 방의 마지막 글이다. */
    const lastMsg = messages.length ? messages[messages.length - 1] : undefined;
    const lastWho = lastMsg && !lastMsg.system ? names[lastMsg.user_id ?? ''] : undefined;

    /** 최근 대화로 한 번에 내려간다. **부드럽게 굴리지 않는다** — 300개까지
     *  받아 둔 목록을 훑어 내려가는 일이라 느린 폰에서 그대로 끊긴다. */
    const jumpToLatest = useCallback(() => {
        const el = listRef.current;
        if (!el) return;
        atBottom.current = true;
        jumpShown.current = false;
        setShowJump(false);
        el.scrollTop = el.scrollHeight;
        listH.current = el.scrollHeight;
    }, []);

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
        // 옛 글을 읽겠다는 뜻이니 미리 받아 둘 몫을 다시 채운다.
        warmLeft.current = freshWarm();

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
    /** 지난번에 잰 글자 수. **줄어들 때만** 높이를 되돌려 다시 잰다. */
    const lastLen = useRef(0);
    /** 다음 프레임에 재기로 예약해 둔 것. 0이면 예약이 없다. */
    const growAt = useRef(0);

    /** 실제로 재고 고치는 곳. **`growDraft`를 거쳐서만 부른다** — 글자를
        치는 그 순간에 이걸 직접 부르면 아래 꼭지의 그 깜빡임이 돌아온다. */
    const measureDraft = useCallback(() => {
        // 네이티브 글칸은 제 높이를 스스로 잰다(`ComposerBar.swift`).
        if (ncOn.current) return;
        const el = taRef.current;
        if (!el) return;
        /* `box-sizing: border-box`라 height에 테두리가 포함된다. `scrollHeight`는
           안 그래서 그냥 넣으면 2px이 모자라 잔스크롤이 남는다. 그 차이를 잰다. */
        const border = () => el.offsetHeight - el.clientHeight;

        const len = el.value.length;
        const shrank = len < lastLen.current;
        lastLen.current = len;

        if (!shrank) {
            /* **글자가 늘 때는 넘칠 때만 한 번 늘린다.** 예전에는 글자마다
               `height: auto`로 되돌렸다 다시 넣어, 안 그래도 되는 자리에서
               칸을 두 번씩 고쳤다. */
            const need = el.scrollHeight + border();
            if (need > el.offsetHeight) {
                el.style.height = `${need}px`;
                pinBottom();
            }
            return;
        }

        /* 지웠을 때만 되돌려 다시 잰다(안 되돌리면 한 번 커진 뒤 안 줄어든다). */
        const was = el.style.height;
        el.style.height = 'auto';
        const now = `${el.scrollHeight + border()}px`;
        el.style.height = now;
        if (now !== was) pinBottom();
    }, [pinBottom]);

    /**
     * 칸 높이를 **다음 프레임에** 잰다. 글자를 치는 그 순간에는 절대 안 잰다.
     *
     * **이게 이 자리의 핵심이다.** 한글 한 글자를 고쳐 쓸 때 WebKit은 칸을
     * **비웠다가 다시 채운다** — 실기기 영상에서 깜빡이는 두 프레임 동안
     * 커서가 맨 앞(x=20)으로 돌아가는 것으로 확인했다. 글꼴이 늦게 와서
     * 글자만 안 보이는 것이었다면 커서는 제자리에 있었을 것이다.
     * 비우기와 채우기는 원래 한 번에 끝나 화면에 안 보이는데, **그 사이에
     * 우리가 `scrollHeight`를 읽으면** 브라우저가 거기서 배치를 다시 잡아
     * **빈 칸이 그대로 한 프레임 그려진다.** 그게 `글씨가 깜빡인다`의 정체다.
     *
     * 그래서 재는 일을 다음 프레임으로 미룬다 — 그때는 비웠다 채우는 일이
     * 이미 끝나 있어 빈 칸이 보일 틈 자체가 없다. 칸은 한 프레임 늦게
     * 늘어나지만 눈에는 안 보인다. 여러 번 불려도 한 번만 예약한다.
     *
     * **`onCompositionStart`로 막는 것만으로는 모자랐다.** 조합 이벤트를
     * 안 주는 자판이 있다 — 아이폰 쿼티는 멀쩡한데 **천지인에서 모음을 칠
     * 때만** 깜빡인다는 제보가 그것이었다(자음은 글자 수가 그대로고, 모음은
     * `ㄱ → ㄱ· → 고`로 오르내린다). 판을 확인하고도 그대로였다.
     * 이 방식은 **자판도 조합 이벤트도 안 탄다** — 되돌리지 말 것.
     */
    const growDraft = useCallback(() => {
        if (growAt.current) return;              // 이미 예약돼 있다
        growAt.current = requestAnimationFrame(() => {
            growAt.current = 0;
            measureDraft();
        });
    }, [measureDraft]);

    /**
     * 글자가 있는지를 **곁에 적어 두기만** 한다(리액트를 안 거친다).
     *
     * 읽는 곳은 둘 다 **다시 그려지는 순간에만** 본다 — 안내 글씨(초점이
     * 떠날 때)와 보내기 단추(초점이 오갈 때)다. 그래서 글자를 쳐도 화면이
     * 다시 그려지지 않는다.
     */
    const markText = useCallback((value: string) => {
        hasText.current = value.trim() !== '';
    }, []);

    /* ── 글칸이 둘이다 — 웹과 네이티브 ──────────────────────────
     *
     * 앱에 네이티브 글칸이 있으면 값은 그쪽이 들고 있고, 없으면 예전처럼
     * `<textarea>`가 들고 있다. **읽고 쓰는 곳을 전부 이 넷으로 모은 것이
     * 이 갈래의 전부다** — 안 그러면 `taRef.current.value`를 직접 읽는 곳이
     * 열 군데라 한쪽만 고치게 된다.
     */

    /** 지금 칸에 적힌 글. **칸이 값의 주인이라 늘 칸에서 직접 읽는다.** */
    const draftValue = useCallback(
        () => (ncOn.current ? ncText.current.text : (taRef.current?.value ?? '')), []);

    /** 커서 자리. `@언급`을 가려내는 데 쓴다. */
    const draftCaret = useCallback(
        () => (ncOn.current ? ncText.current.sel : (taRef.current?.selectionStart ?? 0)), []);

    /** 칸에 글을 써 넣는다(언급 넣기·비우기가 쓴다). */
    const setDraft = useCallback((text: string, sel = text.length) => {
        ncText.current = { text, sel };
        if (ncOn.current) {
            void hush(NativeComposer.setText({ text, sel }));
        } else if (taRef.current) {
            taRef.current.value = text;
            taRef.current.setSelectionRange(sel, sel);
        }
        markText(text);
    }, [markText]);

    const focusDraft = useCallback(() => {
        if (ncOn.current) void hush(NativeComposer.focus());
        else taRef.current?.focus();
    }, []);

    const blurDraft = useCallback(() => {
        if (ncOn.current) void hush(NativeComposer.blur());
        else taRef.current?.blur();
    }, []);

    const clearDraft = () => {
        ncText.current = { text: '', sel: 0 };
        if (ncOn.current) void hush(NativeComposer.setText({ text: '', sel: 0 }));
        if (taRef.current) {
            taRef.current.value = '';
            // 보내고 나면 한 줄로 돌아와야 한다.
            taRef.current.style.height = '';
        }
        markText('');
        lastLen.current = 0;
        /* 예약해 둔 재기를 걷어낸다 — 방금 한 줄로 되돌려 놨는데 한 프레임
           뒤에 옛 글자로 잰 높이가 덮어쓰면 빈 칸이 늘어난 채로 남는다. */
        if (growAt.current) { cancelAnimationFrame(growAt.current); growAt.current = 0; }
        setMention(null);
    };

    /**
     * 캐럿 앞에 `@무엇`을 치고 있는지 본다.
     *
     * 입력칸이 값의 주인이라(uncontrolled) 칸에서 직접 읽는다. 글자를 칠
     * 때뿐 아니라 **캐럿만 옮겨도** 다시 봐야 해서 `onSelect`에서도 부른다.
     */
    const syncMention = useCallback(() => {
        const found = mentionQuery(draftValue(), draftCaret());
        setMention(found ? found.q : null);
    }, [draftValue, draftCaret]);

    /** 언급 목록에서 고른 사람을 `@이름 `으로 끼워 넣는다. */
    const insertMention = (name: string) => {
        const value = draftValue();
        const caret = draftCaret();
        const found = mentionQuery(value, caret);
        if (!found) return;
        const head = value.slice(0, found.at) + `@${name} `;
        setDraft(head + value.slice(caret), head.length);
        setMention(null);
        growDraft();
        // 고르고 나서도 키보드가 그대로 있어야 이어 칠 수 있다.
        focusDraft();
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
    const jumpTo = useCallback((id: string) => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
        if (!el) { toast('지난 대화에 있습니다. 위로 올려 주세요.'); return; }
        atBottom.current = false;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1300);
    }, [toast]);

    /* ── 대화 검색 ──────────────────────────────────────────────
     *
     * **카톡 오픈톡의 🔍다.** 100명이 하루 100마디를 쌓으면 `무등산 몇 시라고
     * 했지`를 되짚을 길이 아예 없었다 — 위로 계속 올려 눈으로 찾는 것 말고는.
     *
     * **찾는 일은 서버가 한다.** 화면이 받아 둔 것만 뒤지면 `지난 대화 더
     * 보기`를 누른 만큼만 찾아져서, 정작 오래된 것을 못 찾는다.
     */
    const [searchOn, setSearchOn] = useState(false);
    /** 서랍을 여닫은 뒤 그림 들기를 도로 켤 때 검색 중인지 보려고(`toggleTray`). */
    const searchOnRef = useRef(false);
    searchOnRef.current = searchOn;
    const slideBack = useRef(0);
    useEffect(() => () => clearTimeout(slideBack.current), []);
    const [hits, setHits] = useState<Message[] | null>(null);
    const [searching, setSearching] = useState(false);
    const sqRef = useRef<HTMLInputElement>(null);
    /** 검색으로 옛 글에 가 있는가. 그때는 목록이 '지금'이 아니라 그 언저리다. */
    const [windowed, setWindowed] = useState(false);
    /* 실시간으로 들어오는 새 글을 덧붙일지 정하는 값. **state로 보면 안 된다** —
       구독은 한 번만 걸리므로 그 안에서 읽는 state는 처음 값에 굳는다. */
    const windowedRef = useRef(false);
    windowedRef.current = windowed;

    /**
     * 친 말이 든 글을 찾는다.
     *
     * **가린 글은 화면에서 거른다**(`hidden_at`). 조회에 조건으로 걸지
     * 않는 것은 일부러다 — 그 칸이 아직 없는 저장소에서 400이 나면
     * **검색이 통째로 죽는다**(스키마를 손으로 붙여넣는 사이가 있다).
     */
    const runSearch = useCallback(async (raw: string) => {
        const q = raw.trim();
        if (!roomId || q.length < 2) { setHits(null); return; }
        setSearching(true);
        // `%`·`_`는 찾기의 특수문자다. 그냥 넘기면 `100%`가 아무거나 맞는다.
        const safe = q.replace(/[\\%_]/g, c => `\\${c}`);
        const { data: rows, error: err } = await supabase
            .from('messages').select('*').eq('room_id', roomId)
            .ilike('body', `%${safe}%`)
            .order('created_at', { ascending: false }).limit(SEARCH_HITS);
        setSearching(false);
        if (err) { toast(readableError(err), 'error'); return; }
        setHits((rows ?? []).filter(m => !m.hidden_at));
    }, [roomId, toast]);

    /** 치는 동안 매 글자마다 물어보지 않는다. 250ms 쉬면 그때 한 번 간다. */
    const sqTimer = useRef<number | null>(null);
    const onSearchType = (v: string) => {
        if (sqTimer.current !== null) clearTimeout(sqTimer.current);
        sqTimer.current = window.setTimeout(() => runSearch(v), 250);
    };

    const closeSearch = () => {
        if (sqTimer.current !== null) clearTimeout(sqTimer.current);
        setSearchOn(false);
        setHits(null);
    };

    /**
     * 찾은 글로 옮겨 간다.
     *
     * 이미 화면에 있으면 그냥 그 자리로 옮기고, **지난 묶음에 있으면 그 글을
     * 가운데 두고 앞뒤를 받아 온다** — `지난 대화 더 보기`를 몇 번씩 누르게
     * 하면 찾아 준 뜻이 없다.
     */
    const openHit = async (m: Message) => {
        if (!roomId) return;
        if (messages.some(x => x.id === m.id)) {
            closeSearch();
            requestAnimationFrame(() => jumpTo(m.id));
            return;
        }
        const [older, newer] = await Promise.all([
            supabase.from('messages').select('*').eq('room_id', roomId)
                .lte('created_at', m.created_at)
                .order('created_at', { ascending: false }).limit(PAGE),
            supabase.from('messages').select('*').eq('room_id', roomId)
                .gt('created_at', m.created_at)
                .order('created_at', { ascending: true }).limit(WINDOW_AFTER),
        ]);
        const back = older.data ?? [];
        // 맨 아래로 끌려 내려가지 않게 먼저 내려 둔다 — 옮길 자리는 가운데다.
        atBottom.current = false;
        setMessages([...back.slice().reverse(), ...(newer.data ?? [])]);
        setHasMore(back.length === PAGE);
        setWindowed(true);
        setUnreadFrom(null);
        closeSearch();
        // 붙고 나서 옮긴다. 한 프레임으로는 아직 그려지기 전이다.
        requestAnimationFrame(() => requestAnimationFrame(() => jumpTo(m.id)));
    };

    /**
     * 옛 글을 보다가 **지금으로 돌아온다.**
     *
     * 검색으로 옮겨 가면 목록이 그 언저리만 담고 있어, 아래로 끝까지 굴려도
     * 최근 대화가 없다 — 돌아올 길이 이것뿐이라 **꼭 있어야 하는 단추다.**
     */
    const backToRecent = async () => {
        if (!roomId) return;
        const { data: rows } = await supabase
            .from('messages').select('*').eq('room_id', roomId)
            .order('created_at', { ascending: false }).limit(PAGE);
        setMessages((rows ?? []).slice().reverse());
        setHasMore((rows ?? []).length === PAGE);
        setWindowed(false);
        atBottom.current = true;
        requestAnimationFrame(() => pinBottom());
    };

    /** 답장을 시작한다. 밀어서든 눌러서든 여기로 온다. */
    const startReply = useCallback((m: Message) => {
        setReplyTo(m);
        focusDraft();
    }, [focusDraft]);

    /**
     * 길게 누른 글. 여기 값이 있으면 **누른 자리에** 고르는 창이 뜬다.
     *
     * **곧바로 묻지 않고 한 번 고르게 하는 것은 할 일이 여럿이기 때문이다** —
     * 복사·선택 복사·댓글·공유·캡쳐에 운영진의 가리기·공지, 쓴 사람의 삭제까지
     * 붙는다. 바로 확인창을 띄우면 그중 하나를 고를 자리가 없다.
     *
     * **`at`은 누른 말풍선의 자리다**(사용자 요청 — `누른 자리에서 나오도록`).
     * 예전에는 화면 아래에서 올라왔는데, 그러면 **어느 글을 누른 것인지
     * 창만 봐서는 몰라서** 미리보기 머리말을 한 줄 얹어야 했다. 말풍선 옆에
     * 뜨면 그 줄이 통째로 필요 없어진다(카톡도 머리말이 없다).
     * `mine`은 어느 쪽에 붙일지다 — 내 글은 오른쪽, 남의 글은 왼쪽.
     */
    const [menuFor, setMenuFor] = useState<{ m: Message; at: DOMRect; mine: boolean } | null>(null);
    /** `선택 복사`로 연 글. 글자를 끌어서 고를 수 있게 펼쳐 놓는 창이다. */
    const [pickText, setPickText] = useState<string | null>(null);
    /* **`memo`로 감싼 말풍선에 넘기는 값이라 붙박아 둔다.** 매번 새 함수를
       넘기면 쉰 개가 통째로 다시 그려진다(위 `Bubble` 머리말 참고). */
    const openMenu = useCallback((m: Message, at: DOMRect, mine: boolean) => {
        setMenuFor({ m, at, mine });
    }, []);

    /**
     * **운영진이 남의 글을 가린다**(카톡의 '가리기').
     *
     * 지우지 않고 덮어만 둔다 — 지우면 오해로 가린 것을 되돌릴 길이 없다.
     * 말풍선을 길게 누르면(PC는 오른쪽 클릭) 뜨는 창에서 여기로 온다.
     *
     * **가리기는 화면에서 덮는 것이지 지우는 것이 아니다.** 글은 DB에
     * 그대로 남아 있어 마음먹고 파 보면 읽힌다 — 없애야 할 글은 쓴 사람이
     * 지우거나 운영진이 지워야 한다. 급한 불을 끄는 자리로 쓸 것.
     */
    const askHide = useCallback(async (m: Message) => {
        const on = !m.hidden_at;
        const ok = await confirm({
            title: on ? '이 메시지를 가릴까요?' : '가리기를 풀까요?',
            detail: on
                ? <>모두에게 <b>운영진이 가린 메시지입니다</b>로 보입니다.
                   지우는 것이 아니라 덮어 두는 것이라 언제든 다시 풀 수 있습니다.</>
                : '가렸던 내용이 모두에게 다시 보입니다.',
            confirmLabel: on ? '가리기' : '가리기 풀기',
            danger: on,
        });
        if (!ok) return;
        // 곧바로 화면에 반영한다. 실시간 이벤트가 뒤따라와도 같은 값이다.
        const patch = on ? { hidden_at: new Date().toISOString(), hidden_by: me } : { hidden_at: null, hidden_by: null };
        setMessages(prev => prev.map(x => (x.id === m.id ? { ...x, ...patch } : x)));
        const { error: err } = await supabase.from('messages').update(patch).eq('id', m.id);
        if (err) {
            setMessages(prev => prev.map(x => (x.id === m.id ? m : x)));   // 되돌린다
            toast(readableError(err));
            return;
        }
        toast(on ? '가렸습니다.' : '가리기를 풀었습니다.');
    }, [confirm, me, toast]);

    /* ── 참여자 목록과 프로필 ────────────────────────────────────
     *
     * **카톡 오픈톡의 ☰다.** 방에 누가 있는지 볼 길이 없었고, 말풍선 옆
     * 얼굴을 눌러도 아무 일이 없었다 — 100명 방에서 `83/신성호/광산구`만
     * 보고는 누군지 떠올리기 어렵다.
     *
     * **명단을 새로 안 받아 온다.** 이 화면이 이미 `fetchPeople()`로 회원
     * 전부를 들고 있다(이름표와 얼굴 테두리에 쓴다) — 방에 있는 사람이
     * 곧 회원이라, 여기서 거르는 값이 조회 한 번보다 훨씬 싸다.
     */
    const [peopleOn, setPeopleOn] = useState(false);
    /** 얼굴을 눌러 펼친 사람. 목록에서도 여기로 온다. */
    const [card, setCard] = useState<Person | null>(null);

    /**
     * **화면을 덮는 창이 뜨면 네이티브 바를 감춘다.**
     *
     * 그 바는 웹 화면 **위에 얹힌 앱 부품**이라 웹의 `z-index`로는 못 덮는다 —
     * 사진을 크게 봤는데 그 위로 입력칸이 그대로 보였다(사용자 제보 · 사진).
     * 덮는 창은 넷이다: 사진 크게 보기 · 길게 누른 창 · 프로필 카드 ·
     * 선택 복사. 감추면서 키보드도 내린다(창 뒤에 남아 있을 이유가 없다).
     *
     * **감출 수 있는 것은 7판부터다.** 옛 앱에서는 그대로 보이는데, 거기서
     * 바를 떼었다 다시 붙이는 길로 가면 글칸이 통째로 안 뜨는 위험이 더 크다.
     */
    const overlayUp = !!zoom || !!card || pickText !== null || !!menuFor;
    useEffect(() => {
        if (!ncOn.current || ncLog.v < 7) return;
        /* **감추는 것을 먼저, 키보드 내리기를 그다음에.** 앱은 부르는 차례대로
           도는데, 14판은 키보드가 내려갈 때 목록 그림을 들고 움직인다 —
           바가 감춰져 있으면 안 든다(덮는 창 위로 그림이 올라오면 안 된다).
           내리기를 먼저 보내면 그 판단이 감추기 전에 나 버린다. */
        void hush(NativeComposer.setState({ hidden: overlayUp }));
        if (overlayUp) void hush(NativeComposer.blur());
    }, [overlayUp]);
    /** 올해 몇 번 나갔나. 함수가 없는 저장소에서는 `null`이라 그 줄을 안 적는다. */
    const [attend, setAttend] = useState<Record<string, number> | null>(null);
    const attendTried = useRef(false);

    /* 방에 있는 사람. **대기·추방은 뺀다** — 그분들은 대화를 아예 못 본다.
       `mentionable`과 같은 잣대다(부르는 목록과 있는 목록이 갈리면 안 된다). */
    const roomPeople = mentionable;

    /**
     * 참석 횟수를 받아 온다. **목록이나 카드를 처음 열 때 한 번만** 부른다 —
     * 대화를 보기만 하는 사람에게는 필요 없는 조회다.
     *
     * **운영진만 본다**(사용자 요청 · 회원 명단과 같은 잣대다). 일반회원은
     * 아예 안 부르고, DB도 같게 막혀 있다(`attendance_counts`).
     *
     * **함수가 없거나 막히면 `null`로 둔다.** 오류를 0으로 넘기면 모두가
     * `올해 0회`가 되어 **거짓말이 된다**(회원 명단과 같은 규칙이다).
     */
    const loadAttend = useCallback(async () => {
        if (!isAdmin || attendTried.current) return;
        attendTried.current = true;
        const since = `${kstDate().slice(0, 4)}-01-01T00:00:00+09:00`;
        const { data: rows, error: err } = await supabase
            .rpc('attendance_counts', { p_since: since });
        if (err) return;                       // 함수가 없거나 막힘 — 안 적는다
        setAttend(Object.fromEntries(
            ((rows ?? []) as { user_id: string; n: number }[]).map(x => [x.user_id, x.n])));
    }, [isAdmin]);

    const openPeople = () => { setPeopleOn(true); loadAttend(); };
    /* **`memo`로 감싼 말풍선에 넘기는 값이라 붙박아 둔다** — 매번 새 함수를
       넘기면 쉰 개가 통째로 다시 그려진다(`openMenu`와 같은 자리다). */
    const openCard = useCallback((p: Person) => {
        setCard(p);
        loadAttend();
    }, [loadAttend]);

    /** 카드에서 `@언급하기`를 누르면 입력칸에 `@이름 `을 넣고 자판을 올린다. */
    const mentionFromCard = (p: Person) => {
        setCard(null);
        setPeopleOn(false);
        const was = draftValue();
        const head = was && !was.endsWith(' ') ? `${was} ` : was;
        setDraft(`${head}@${p.name} `);
        focusDraft();
        growDraft();
    };

    /* ── 방 공지 ────────────────────────────────────────────────
     *
     * **카톡 오픈톡에서 말풍선을 길게 눌러 맨 위에 붙박는 그것이다.**
     * 모임 규칙·계좌·집합 장소처럼 늘 보여야 하는 한 줄이 하루 백 마디에
     * 밀려 사라지지 않게 한다. **공지 탭(`posts`)과는 다르다** — 그쪽은
     * 읽고 지나가는 글이고, 이건 대화 위에 붙박여 있는 쪽지다.
     *
     * **한 방에 하나다.** `pinned_at`이 가장 늦은 줄 하나만 읽으므로 새로
     * 등록하면 앞엣것이 저절로 물러난다 — 지우는 일이 따로 없다.
     */
    const [pin, setPin] = useState<Message | null>(null);
    /** 펼쳐 놓았는가. 기본은 접힌 한 줄이다 — 긴 공지가 대화를 덮으면 안 된다. */
    const [pinOpen, setPinOpen] = useState(false);
    /**
     * **✕로 닫아 둔 공지**(카톡과 같다. 사용자 요청).
     *
     * **이 기기에만 남는다** — 내 눈에서 치우는 일이지 남의 화면에서
     * 내리는 일이 아니다. 정말 내리는 것은 운영진의 `공지 내리기`이고,
     * 그건 DB를 고쳐 모두에게서 사라진다. 둘을 섞지 말 것.
     *
     * **열쇠에 `pinned_at`을 함께 넣는다** — 같은 글을 내렸다 다시
     * 올리면 새 공지로 보고 다시 띄워야 한다(id만 보면 영영 숨는다).
     */
    const [pinX, setPinX] = useState<string | null>(null);
    const pinKey = pin ? `${pin.id}@${pin.pinned_at ?? ''}` : '';
    useEffect(() => {
        if (!pinKey) return;
        try { setPinX(localStorage.getItem(PIN_X_KEY)); } catch { /* 비공개 모드 */ }
    }, [pinKey]);
    const closePin = useCallback(() => {
        setPinOpen(false);
        setPinX(pinKey);
        try { localStorage.setItem(PIN_X_KEY, pinKey); } catch { /* 저장이 막혀도 화면은 돈다 */ }
    }, [pinKey]);
    const pinShown = pin && pinX !== pinKey;

    /**
     * 붙박아 둔 글 한 줄을 받아 온다.
     *
     * **오류를 그냥 삼킨다.** `pinned_at` 칸이 아직 없는 저장소에서 400이
     * 나는데, 그걸 던지면 **대화 화면이 통째로 안 열린다** — 앱은 푸시하면
     * 몇 분 뒤 올라가지만 스키마는 사람이 손으로 붙여넣으므로 그 사이가 있다.
     * 못 받으면 공지 줄만 안 뜨고 대화는 멀쩡하다.
     */
    const loadPin = useCallback(async (rid: string) => {
        const { data: row, error: err } = await supabase
            .from('messages').select('*').eq('room_id', rid)
            .not('pinned_at', 'is', null)
            .order('pinned_at', { ascending: false }).limit(1).maybeSingle();
        if (err) return;                      // 칸이 없는 저장소 — 조용히 넘긴다
        setPin((row as Message) ?? null);
    }, []);

    useEffect(() => { if (roomId) loadPin(roomId); }, [roomId, loadPin]);

    /**
     * 공지로 올리거나 내린다. **운영진만** 부른다.
     *
     * 정책을 새로 안 만들었다 — `messages_admin`이 이미 `for all`이고
     * 회원에게는 update 정책이 아예 없다. 화면이 감추는 것과 DB가 막는 것이
     * 같은 잣대다.
     */
    const askPin = useCallback(async (m: Message) => {
        const on = !m.pinned_at;
        const already = pin && pin.id !== m.id;
        const ok = await confirm({
            title: on ? '이 메시지를 공지로 올릴까요?' : '공지를 내릴까요?',
            detail: on
                ? <>대화 맨 위에 붙어 모두에게 늘 보입니다.
                   {already && <> 지금 올라와 있는 공지는 <b>내려갑니다.</b></>}</>
                : '대화 맨 위의 공지 줄이 없어집니다. 글은 그대로 남습니다.',
            confirmLabel: on ? '공지로 올리기' : '공지 내리기',
        });
        if (!ok) return;
        const patch = on
            ? { pinned_at: new Date().toISOString(), pinned_by: me }
            : { pinned_at: null, pinned_by: null };
        const { error: err } = await supabase.from('messages').update(patch).eq('id', m.id);
        if (err) { toast(readableError(err)); return; }
        /* **앞엣것을 손으로 안 내린다.** 가장 늦게 붙박은 줄 하나만 읽으므로
           새로 올리면 그것이 저절로 공지가 된다 — 쓰기를 두 번 하면 그 사이에
           공지가 없는 순간이 생기고, 실패했을 때 되돌릴 것도 둘이 된다. */
        setPinOpen(false);
        if (roomId) await loadPin(roomId);
        toast(on ? '공지로 올렸습니다.' : '공지를 내렸습니다.');
    }, [confirm, loadPin, me, pin, roomId, toast]);

    /**
     * 글을 복사한다.
     *
     * **이 자리가 있어야 하는 까닭이 하나 더 있다** — 가리거나 지울 수 있는
     * 글에는 `user-select: none`이 걸려 있어(길게 누르기를 iOS의 글자
     * 고르기가 덮지 않게), 그 글은 **길게 눌러 복사하는 길이 아예 없다.**
     * 창에서 복사할 수 있어야 그 손해가 없어진다.
     */
    const copyText = (text: string) => {
        navigator.clipboard?.writeText(text)
            .then(() => toast('복사했습니다.', 'ok'))
            .catch(() => toast('복사가 안 됩니다.', 'error'));
    };

    /**
     * **다른 앱으로 보내기**(카톡의 `공유`).
     *
     * 폰의 공유창을 띄우는 것이 전부다 — 어디로 갈지는 사용자가 고른다.
     * **공유창이 없는 기기에서는 복사로 물러난다**(PC 크롬 등). 아무 일도
     * 안 일어나면 고장으로 보이므로, 대신 한 일을 토스트로 알린다.
     * 사진은 주소까지 함께 보낸다 — 글만 가면 무슨 사진인지 알 수 없다.
     */
    const shareMessage = async (m: Message) => {
        const text = m.body.trim() || preview(m);
        const url = m.image_url && !isSticker(m.image_url) ? m.image_url : undefined;
        if (await shareText(text, url)) return;
        copyText(url ? `${text}\n${url}` : text);
    };

    /**
     * **말풍선을 그림으로 만든다**(카톡의 `캡쳐`).
     *
     * 화면에 그려져 있는 그 줄을 그대로 찍으므로 **모양을 두 번 만들지
     * 않는다** — 말풍선 규칙이 두 벌이 되면 언젠가 어긋난다.
     * 그리는 데 한 박자 걸려서 **누르자마자 `만드는 중`이라고 알린다**:
     * 아무 반응이 없으면 안 눌린 줄 알고 또 누른다.
     */
    const captureMessage = async (m: Message) => {
        /* **`[data-mid]`가 아니라 그 안의 `.chat-row`다.** 바깥 칸에는
           날짜 칸(`2026년 9월 7일`)과 `여기까지 읽으셨습니다` 줄이 함께
           들어 있어, 그대로 찍으면 그것들까지 그림에 딸려 온다. */
        const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${m.id}"] .chat-row`);
        if (!el) { toast('그 메시지를 찾지 못했습니다.', 'error'); return; }
        toast('그림으로 만드는 중…', 'ok');
        const how = await captureNode(el);
        if (how === 'saved') toast('그림으로 내려받았습니다.', 'ok');
        else if (how === 'fail') toast('캡쳐가 안 됩니다.', 'error');
        // 'shared'는 공유창이 뜬 것이라 따로 알릴 것이 없다.
    };

    /**
     * **쓴 사람이 제 글을 지운다**(사용자 요청).
     *
     * DB는 예전부터 열려 있었다 — `messages_own` 정책이
     * `user_id = auth.uid()`인 줄의 삭제를 허용한다. 그래서 이 기능에는
     * 붙여넣을 SQL이 없다.
     *
     * **남의 글은 지우지 않는다.** 운영진에게는 `가리기`가 있고, 그쪽은
     * 되돌릴 수 있다 — 남이 쓴 글을 되돌릴 수 없게 없애는 것은 다른
     * 무게의 일이라 이 창에 두지 않았다.
     *
     * 지운 글에 달린 답장은 그대로 남는다(`reply_to`가 `on delete set null`).
     * 인용은 `지난 대화`가 되고 눌러도 안 움직인다.
     */
    const askDelete = async (m: Message) => {
        const ok = await confirm({
            title: '이 메시지를 지울까요?',
            detail: '지운 글은 되돌릴 수 없습니다. 모두의 화면에서 사라집니다.',
            confirmLabel: '지우기',
            danger: true,
        });
        if (!ok) return;
        // 곧바로 화면에서 뺀다. 실패하면 있던 자리에 도로 끼운다.
        const at = messages.findIndex(x => x.id === m.id);
        setMessages(prev => prev.filter(x => x.id !== m.id));
        const { error: err } = await supabase.from('messages').delete().eq('id', m.id);
        if (err) {
            setMessages(prev => {
                if (prev.some(x => x.id === m.id)) return prev;
                const next = prev.slice();
                next.splice(at < 0 ? prev.length : at, 0, m);
                return next;
            });
            toast(readableError(err), 'error');
            return;
        }
        toast('지웠습니다.');
    };

    /** id → 글. 인용할 원본을 찾는다. 지난 묶음에 있으면 없을 수 있다. */
    const byMid = new Map(messages.map(m => [m.id, m]));
    /* **매번 새 배열을 만들면 안 된다** — 말풍선이 이걸 그대로 받으므로,
       내용이 같아도 배열이 새것이면 쉰 개가 전부 다시 그려진다. */
    const mentionNames = useMemo(() => mentionable.map(p => p.name), [mentionable]);

    /** 지금 칸에 적힌 글. **칸이 값의 주인이라 늘 칸에서 직접 읽는다** —
     *  곁에 두는 것은 `hasText`(참/거짓) 하나뿐이다. */
    const currentDraft = () => draftValue().trim();

    /**
     * 글 한 줄(또는 사진 한 장, 이모티콘 하나)을 보낸다.
     * 보내기 · 사진 올리기 · 이모티콘이 같이 쓴다.
     */
    const push = async (body: string, imageUrl: string | null, replyId: string | null) => {
        if (!roomId) return null;
        const { data: row, error: err } = await supabase
            .from('messages')
            // **사진이 없으면 image_url을, 답장이 아니면 reply_to를 아예
            // 보내지 않는다.** DB에 그 칸을 아직 안 만들었어도(스키마를
            // 다시 안 돌렸어도) 글은 그대로 오가게 하려는 것이다.
            .insert({
                room_id: roomId, user_id: me, body,
                ...(imageUrl ? { image_url: imageUrl } : {}),
                ...(replyId ? { reply_to: replyId } : {}),
            })
            .select('*').single();
        if (err) { toast(readableError(err), 'error'); return null; }
        return (row as Message) ?? null;
    };

    /** 화면에만 먼저 그려 둘 내 글 한 줄. 서버 답이 오면 진짜 줄로 갈아 끼운다. */
    const draftRow = (body: string, imageUrl: string | null, replyId: string | null): Message => ({
        id: `${TEMP_ID}${crypto.randomUUID()}`,
        room_id: roomId ?? '', user_id: me, body,
        system: false, image_url: imageUrl, reply_to: replyId,
        created_at: new Date().toISOString(),
    });

    /**
     * 먼저 그려 둔 줄을 **진짜 줄로 갈아 끼운다.**
     *
     * 서버 답보다 **실시간 이벤트가 먼저 닿는 판이 있다** — 그때는 진짜
     * 줄이 이미 목록에 있으므로 먼저 그린 것을 빼기만 한다. 안 그러면
     * 같은 말이 두 줄로 남는다.
     */
    const swapRow = (prev: Message[], tmpId: string, row: Message) =>
        (prev.some(m => m.id === row.id)
            ? prev.filter(m => m.id !== tmpId)
            : prev.map(m => (m.id === tmpId ? row : m)));

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
     *
     * ## 누르는 즉시 올라간다 — 서버 답을 기다리지 않는다
     *
     * 사용자 제보 — `전송 버튼을 누르면 채팅이 올라가는데 딜레이가 생겨.
     * 그래서 혹시 멈췄나 싶어서 다시 누르면 두 번이 올라갈 때가 있어.`
     * 예전에는 **서버에 넣고 답이 온 뒤에야** 말풍선을 그리고 글칸을
     * 비웠다. 그 왕복이 곧 인터넷 한 바퀴(0.3~1초)인데 그동안 화면에는
     * **아무 일도 안 일어나고 친 글도 칸에 그대로 남아 있어**, 안 눌린
     * 줄 알고 또 누르게 된다.
     *
     * 지금은 누르는 그 자리에서 **글칸을 비우고 말풍선을 먼저 그린다.**
     * 실패하면 그 줄을 걷어내고 **친 글·고른 이모티콘·답장을 그대로
     * 되돌려 놓는다** — 다시 누르면 되게 해야지, 적은 글이 사라지면 안 된다.
     *
     * ## 두 번 눌러도 한 번만 나간다
     *
     * **막는 것은 `busy`(ref)다. 단추를 흐리게 하는 것으로는 못 막는다** —
     * 앱에서는 보내기 단추가 **네이티브 바**의 것이라(`ComposerBar.swift`)
     * 웹의 `disabled`가 아예 안 걸린다. 그 단추는 `send` 신호를 그대로
     * 다시 보내므로, **웹 쪽에서 값 하나로 잠가야** 두 줄이 안 올라간다.
     * state가 아니라 ref인 것도 그래서다 — state는 다시 그려진 뒤에야
     * 바뀌어서 연달아 누르는 그 순간을 못 잡는다.
     */
    const send = async () => {
        const body = currentDraft();
        // **이모티콘만 골라도 보낼 수 있다** — 글은 없어도 된다.
        if ((!body && !picked) || !roomId) return;
        if (sendBusy.current) return;
        sendBusy.current = true;
        setSending(true);

        const sticker = picked ? stickerRef(picked) : null;
        const quoted = replyTo;
        const mine = draftRow(body, sticker, quoted?.id ?? null);

        // 초점 되돌리기는 `await` 앞이어야 한다(위 참고).
        focusDraft();
        clearDraft();
        setPicked(null);
        setReplyTo(null);
        atBottom.current = true;
        setMessages(prev => [...prev, mine]);

        const row = await push(body, sticker, quoted?.id ?? null);
        if (row) {
            setMessages(prev => swapRow(prev, mine.id, row));
        } else {
            // 못 보냈으면 먼저 그린 줄을 걷고 적어 둔 것을 그대로 돌려준다.
            setMessages(prev => prev.filter(m => m.id !== mine.id));
            setDraft(body);
            setPicked(picked);
            setReplyTo(quoted);
        }
        sendBusy.current = false;
        setSending(false);
        focusDraft();
    };

    /**
     * 이모티콘 서랍을 여닫는다.
     *
     * **키보드와 자리를 맞바꾼다.** 서랍은 입력칸 아래, 키보드가 서던 그
     * 자리에 뜬다 — 열 때 키보드를 내리고 닫을 때 도로 올린다(닫으면
     * 하던 말을 이어 칠 수 있어야 한다). 글칸을 직접 누를 때도 서랍이
     * 닫히는데, 그건 `onComposerFocus`가 맡는다.
     *
     * 열고 나서 대화를 맨 아래로 붙이는 일은 위의 `useLayoutEffect`가 한다.
     */
    const toggleTray = () => {
        /* **서랍을 여닫는 동안은 앱이 목록 그림을 안 들게 한다**(14판).
           서랍은 키보드와 자리를 맞바꾸므로 키보드가 내려가는 그 자리에
           서랍이 선다 — 그때 그림을 키보드와 함께 내리면 서랍이 붙는 순간
           목록이 도로 올라와 두 번 움직인다. 앱은 보낸 값만 고치고 부르는
           차례대로 도므로, 끄는 것을 초점 여닫기보다 **먼저** 보낸다.
           다 움직인 뒤(0.9초) 다시 켠다 — 검색 중이면 그대로 꺼 둔다. */
        if (ncOn.current && canSlide()) {
            void hush(NativeComposer.setState({ slide: false }));
            clearTimeout(slideBack.current);
            slideBack.current = window.setTimeout(() => {
                if (ncOn.current) void hush(NativeComposer.setState({ slide: !searchOnRef.current }));
            }, 900);
        }
        setTray(open => {
            if (open) focusDraft();
            else blurDraft();
            return !open;
        });
    };

    /**
     * 이모티콘을 고른다. **곧바로 나가지 않는다**(사용자 요청).
     *
     * 입력칸 위에 미리보기로 물려 두고, 거기서 글을 마저 적어 **한 마디로
     * 함께 보낸다.** 예전에는 누르는 즉시 나갔는데, 그러면 `나이스 샷!` 같은
     * 이모티콘에 한마디 덧붙이려면 두 마디로 갈라 보내야 했다.
     * 서랍은 열어 둔다 — 고른 것을 바꾸는 일이 흔하다.
     */
    const pickSticker = (id: string) => setPicked(id);

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
        await sendPhoto(await shrinkImage(file));
    };

    /**
     * **앱에서는 사진도 앱이 고른다** — 다만 **12판부터다.**
     *
     * `+`가 앱의 단추라 웹에는 누른 자리가 없다 — 웹의 `<input type="file">`을
     * 쓰면 iOS가 고르는 창을 붙일 데를 못 찾고 **화면 아무 데나 띄웠다**
     * (사용자 제보 · 사진 두 장. 화면 아래에 44px짜리 칸을 두어도 안 봤다).
     * 그래서 8판에 고르는 일을 앱으로 옮겼다.
     *
     * **그런데 9~11판에서는 사진이 통째로 안 올라갔다**(사용자 제보 —
     * `보관함하고 찍는 것도 둘 다 안돼`). 고르는 창은 뜨는데 보관함이든
     * 카메라든 누르면 **아무 일도 안 일어났다** — 9판에서 그 창을
     * 팝오버로 바꾸면서, 창이 닫히기 전에 다음 창을 띄우게 되어
     * iOS가 조용히 무시한 것이다(`ComposerBar` 쪽 `afterSheet` 참고).
     *
     * **그 사이 판을 든 폰은 웹 칸으로 되돌린다.** 창이 엉뚱한 자리에
     * 뜨긴 해도 **뜨기는 한다** — 자리가 어긋난 것과 아예 못 보내는 것
     * 중에서는 앞엣것이 낫고, 무엇보다 **앱을 새로 안 깔아도 웹만 밀면
     * 그날로 고쳐진다.** 12판을 깔면 저절로 앱 창으로 돌아간다.
     */
    const photo = async () => {
        /* **고르는 셈은 `lib/composer.ts`에 있다** — `내 정보`의 프로필
           사진이 같은 길을 쓴다(`pickNativePhoto`). 여기서 하는 것은
           **못 골랐을 때 무엇으로 물러나느냐**뿐이다. */
        if (!ncOn.current || !canPickNative()) { fileRef.current?.click(); return; }
        const got = await pickNativePhoto();
        /* 취소는 조용히 돌아선다. **고장이면 알리고 웹 칸으로 물러나**
           어떻게든 보낼 수 있게 한다 — 아무 말도 안 뜨면 어디가 막힌 것인지
           알 길이 없다(`사진 크기를 키운 후로 안돼`가 그 자리였다). */
        if (got.kind === 'fail') {
            toast(`사진을 못 불러왔습니다 — ${got.why}`, 'error');
            fileRef.current?.click();
            return;
        }
        if (got.kind === 'cancel') return;
        await sendPhoto(got.blob);
    };

    /**
     * 사진 한 장을 올려 보낸다. 웹 칸과 앱이 같이 쓴다.
     *
     * **여기서 크기를 한 번 더 잰다.** 앱도 제 나름대로 줄여서 주지만
     * (`jpegBase64`), 앱은 새로 깔아야 바뀌므로 **옛 앱을 든 폰에서는
     * 웹이 아무리 고쳐도 큰 사진이 그대로 온다.** 실제로 2560px으로
     * 올렸다가 사진이 통째로 안 올라가는 일이 있었고, 그때 웹만 밀어서
     * 고칠 길이 없었다 — 이 한 줄이 그 길이다.
     * `shrinkImage`는 **이미 작으면 그대로 돌려주므로** 헛일을 안 한다.
     */
    const sendPhoto = async (raw: Blob) => {
        if (!roomId) return;
        setUploading(true);
        try {
            const blob = await shrinkImage(raw);
            const path = `${roomId}/${crypto.randomUUID()}.jpg`;
            const { error: upErr } = await supabase.storage
                .from('chat-photos')
                .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
            if (upErr) throw upErr;

            const { data: pub } = supabase.storage.from('chat-photos').getPublicUrl(path);
            const quoted = replyTo;
            const row = await push(currentDraft(), pub.publicUrl, quoted?.id ?? null);
            /* **사진은 먼저 그리지 않는다** — 올리는 데 몇 초가 걸려
               그동안 보여 줄 그림이 없고, 사진을 고른 것 자체가 이미
               '무언가 하는 중'으로 읽힌다(`사진 올리는 중…`이 뜬다).
               못 올리면 적어 둔 글을 그대로 두어 다시 해 볼 수 있게 한다. */
            if (row) {
                setReplyTo(null);
                clearDraft();
                atBottom.current = true;
                setMessages(prev =>
                    prev.some(m => m.id === row.id) ? prev : [...prev, row]);
            }
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

    /* ── 네이티브 글칸 ──────────────────────────────────────────
     *
     * 앱에 그 플러그인이 있으면 **웹 글칸 대신 네이티브 바를 쓴다.**
     * 두 가지가 웹으로는 안 고쳐지기 때문이다(`ComposerBar.swift` 머리말):
     * **천지인 깜빡임**과 **키보드와 따로 노는 움직임**.
     *
     * 바가 맡는 것은 **한 줄뿐이다** — `+` · 글칸 · 이모티콘 · 보내기.
     * 인용(답장) · 언급 목록 · 이모티콘 미리보기 · 서랍은 예전 그대로
     * 웹이 그 위에 그린다. 바가 가리는 만큼은 `--composer`로 비운다
     * (네이티브가 높이를 알려 준다).
     *
     * **플러그인이 없으면 아무 일도 안 한다** — 그때는 웹 글칸이 그대로
     * 쓰인다. 앱은 새로 만들어 깔기까지 시간이 걸리는데 웹은 밀면 바로
     * 올라가므로 그 사이가 늘 생긴다.
     */

    /** 바가 알려 올 때 부를 것들. **늘 최신 함수를 가리키게 해 둔다** —
        붙이는 일은 화면이 열릴 때 한 번뿐이라, 그때의 함수를 그대로 들고
        있으면 옛 값을 보고 돈다. */
    const nc = useRef({
        send, toggleTray, onComposerFocus, onComposerBlur, syncMention, markText,
        photo,
    });
    useEffect(() => {
        nc.current = {
            send, toggleTray, onComposerFocus, onComposerBlur, syncMention, markText,
            photo,
        };
    });

    useEffect(() => {
        let dead = false;
        let drops: Array<() => void> = [];
        /** 바가 제 높이를 알려 왔는가. **화면에 실제로 섰다는 증거다.** */
        let stood = false;
        let watchdog = 0;

        /* 웹의 다른 칸(대화 검색)이 초점을 가져가면 앱에 알린다.
           1판 앱(`inputAccessoryView`)에서는 그때 바가 물러나야 서로
           first responder를 뺏느라 다투지 않았다. 2판은 아무 일도 안 하지만
           옛 앱을 위해 그대로 부른다. */
        const typing = (el: EventTarget | null) => {
            const t = el as HTMLElement | null;
            return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
        };
        const onIn = (e: FocusEvent) => { if (typing(e.target)) void hush(NativeComposer.pause()); };
        const onOut = () => {
            setTimeout(() => {
                if (!typing(document.activeElement)) void hush(NativeComposer.resume());
            }, 60);
        };

        void (async () => {
            if (!(await composerReady()) || dead) return;
            const hs = await Promise.all([
                NativeComposer.addListener('change', e => {
                    ncText.current = { text: e.text, sel: e.sel };
                    nc.current.markText(e.text);
                    nc.current.syncMention();
                }),
                NativeComposer.addListener('send', () => { void nc.current.send(); }),
                NativeComposer.addListener('action', e => {
                    if (e.name === 'plus') nc.current.photo();
                    else nc.current.toggleTray();
                }),
                NativeComposer.addListener('focus', e => {
                    if (e.on) nc.current.onComposerFocus();
                    else nc.current.onComposerBlur();
                }),
                /* **키보드가 움직이기 시작한 그 순간**(3판부터). 늦게 받은
                   만큼 짧게 움직여 키보드와 같이 끝낸다 — 까닭은 위
                   `kbBeat` 주석에 있다. 옛 앱은 이 신호를 안 보내므로
                   `keyboardWillShow`/`Hide`만으로 예전처럼 돈다. */
                NativeComposer.addListener('kb', e => {
                    kbBeat.current?.(e.on, e.dur, e.at, e);
                }),
                /* **바가 그려지는 자리, 프레임마다**(4판부터). 화면 높이를
                   그 값으로 그대로 몬다 — 까닭은 위 `kbFrame` 주석에 있다. */
                NativeComposer.addListener('frame', e => { kbFrame.current?.(e); }),
                /* 바가 가리는 만큼 목록 아래를 비운다. 줄이 늘면 함께 늘어난다. */
                NativeComposer.addListener('height', e => {
                    const h = Math.round(e.height);
                    if (h <= 0) return;
                    stood = true;
                    ncLog.stood = true;
                    /* **바가 자라면 목록이 그만큼 줄어드니 다시 앉힌다.**
                       키보드가 내려갈 때 바는 탭바 자리(58px)와 홈 인디케이터
                       몫을 도로 물어 90px쯤 자란다. 그 순간 목록이 그만큼
                       짧아지는데 여기서 다시 안 앉히면 **맨 아래 글이 잘려
                       안 보인다**(실기기 제보 — 키보드를 내리니 마지막 글이
                       사라졌다). 그 사이 `onScroll`이 '맨 아래가 아니다'로
                       내려 버리므로, **바꾸기 전에** 집어 둔 값을 넘긴다. */
                    const wasBottom = atBottom.current;
                    ncH.current = h;
                    lastBarH = h;
                    /* 따라가는 동안(4판 `kbFrame`)은 그쪽이 프레임마다 적는다 —
                       여기서 목표값을 먼저 적으면 여백이 툭 뛴다. 끝날 때
                       `ncH`에서 도로 적는다. */
                    /* **6판에서는 이 값을 안 적는다** — `frame`이 여백까지
                       셈해서 보낸다(`--composer`는 바 높이가 아니라 **바가
                       가리는 자리**다). 여기서 덮어쓰면 둘이 엇갈려 목록이
                       흔들린다. `stood`와 `lastBarH`만 챙긴다. */
                    if (!owns6() && !kbFollow.current) {
                        document.documentElement.style.setProperty('--composer', `${h}px`);
                    }
                    if (wasBottom) settleList(true);
                }),
            ]);
            if (dead) { hs.forEach(h => { void h.remove(); }); return; }
            drops = hs.map(h => () => { void h.remove(); });

            await hush(NativeComposer.attach(composerSkin({
                showIcon: STICKERS.length > 0,
                hintText: '메시지',
                /* **키보드가 오르내릴 때 목록 그림을 앱이 들고 움직이게 한다**
                   (14판 · `slideKb` 주석). 목록이 시작하는 자리(`listTop`)는
                   아래 효과가 재서 알려 준다 — 여기서는 켜기만 한다. */
                slide: canSlide(),
            })));
            if (dead) return;
            ncOn.current = true;
            document.documentElement.classList.add('nc');
            /* `kb-follow`는 **여기서 안 붙인다** — 바가 첫 `frame`으로 값을
               보내 준 뒤에 붙는다(`kbFrame` 주석). `attach`가 `announce()`로
               그 자리에서 한 번 보내므로 곧바로다. */
            setNativeBar(true);
            document.addEventListener('focusin', onIn);
            document.addEventListener('focusout', onOut);

            /* **안 서면 되돌린다.** 웹 글칸을 안 그려 두고 네이티브 바도
               안 뜨면 대화에서 글을 아예 못 친다 — 여기서는 실기기로
               확인할 길이 없으므로, 그 최악을 앱이 스스로 막게 해 둔다.
               바가 제 높이를 알려 오는 것이 곧 '섰다'는 증거다. */
            watchdog = window.setTimeout(() => {
                if (dead || stood) return;
                ncOn.current = false;
                kbFollow.current = false;
                document.documentElement.classList.remove('nc');
                document.documentElement.classList.remove('kb-follow');
                setNativeBar(false);
                void hush(NativeComposer.detach());
            }, 1500);
        })();

        return () => {
            dead = true;
            clearTimeout(watchdog);
            ncOn.current = false;
            document.removeEventListener('focusin', onIn);
            document.removeEventListener('focusout', onOut);
            document.documentElement.classList.remove('nc');
            document.documentElement.style.removeProperty('--composer');
            drops.forEach(f => f());
            drops = [];
            void hush(NativeComposer.detach());
        };
        /* `settleList`는 `useCallback([])`이라 안 바뀐다 — 여기에 적어도
           바를 다시 세우는 일은 없다. */
    }, [settleList]);

    /** 서랍이 열렸는지와 이모티콘을 골랐는지를 바에 알린다. */
    useEffect(() => {
        if (!nativeBar) return;
        void hush(NativeComposer.setState({ tray, forceSend: picked !== null }));
    }, [nativeBar, tray, picked]);

    /**
     * **목록이 시작하는 자리를 앱에 알린다**(14판 · `slideKb` 주석). 앱이 뜨는
     * 그림은 머리말·방 공지 **아래**부터 움직여야 하는데 그 경계는 웹만 안다.
     * 방 공지가 붙거나 펴지면 목록 높이가 바뀌므로 `ResizeObserver`로 잡고,
     * 값이 바뀔 때만 보낸다(같은 값을 되풀이해 건너보내지 않는다).
     * `loading`을 보는 것은 목록이 스피너 뒤에야 생기기 때문이다.
     */
    useEffect(() => {
        if (!nativeBar || loading || !canSlide()) return;
        const el = listRef.current;
        if (!el) return;
        let last = -1;
        const tell = () => {
            const t = Math.round(el.getBoundingClientRect().top);
            if (t === last) return;
            last = t;
            void hush(NativeComposer.setState({ listTop: t }));
        };
        tell();
        const ro = new ResizeObserver(tell);
        ro.observe(el);
        return () => ro.disconnect();
    }, [nativeBar, loading]);

    /**
     * **검색 중에는 그림을 안 든다**(14판). 검색 결과 창이 목록 위를 덮고
     * 있는데(`position: absolute`) 그때 키보드가 내려가며 그림을 밀면 그
     * 창까지 밀린다. 검색 칸은 웹 글칸이라 앱도 제 키보드가 아닌 줄 알지만
     * (`kbOwner`), 바를 눌렀다가 검색으로 옮겨 간 판은 못 가리므로 여기서 끈다.
     */
    useEffect(() => {
        if (!nativeBar || !canSlide()) return;
        void hush(NativeComposer.setState({ slide: !searchOn }));
    }, [nativeBar, searchOn]);

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
            {/* **머리말은 카톡 오픈톡과 같은 배치다**(사용자 요청) —
                왼쪽에 제목과 사람 수, 오른쪽에 🔍와 ☰.

                예전에는 제목을 가운데 세우고 단추 둘을 양끝에 얹었는데,
                카톡은 제목이 왼쪽에 붙고 누르는 것이 오른쪽에 모여 있다.
                **`←`(뒤로)는 안 둔다** — 카톡에서는 방을 나가는 자리지만
                이 앱에서 대화는 **탭**이라 뒤로 갈 데가 없다(눌러 봐야 앱이
                통째로 닫힌다). 방을 옮기는 일은 탭바가 맡는다.

                단추 둘 다 흐름 안에 있다 — 제목이 왼쪽이라 자리를 뺏길
                일이 없어, 예전처럼 `position: absolute`로 띄울 이유가 없다. */}
            <div className="chat-head">
                {searchOn ? (
                    <div className="chat-search">
                        <input className="chat-search-in" ref={sqRef} type="search"
                               autoFocus enterKeyHint="search"
                               aria-label="대화 검색"
                               onChange={e => onSearchType(e.target.value)} />
                        <button className="chat-search-x" onClick={closeSearch}>취소</button>
                    </div>
                ) : (
                    <>
                        {/* 제목 옆에 사람 수를 흐리게 붙인다(카톡과 같다).
                            ☰ 위에 숫자를 얹던 것을 여기로 옮긴 것이라
                            **두 군데에 적지 않는다.** */}
                        <h1 className="chat-title">
                            {data.room.name}
                            <span className="chat-title-n">{roomPeople.length}</span>
                        </h1>
                        <button className="chat-find" onClick={() => setSearchOn(true)}
                                aria-label="대화 검색">
                            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                                 strokeLinecap="round" aria-hidden="true">
                                <circle cx="11" cy="11" r="7" />
                                <path d="M20 20l-4-4" />
                            </svg>
                        </button>
                        {/* **참여자 목록**(카톡 오픈톡의 ☰). */}
                        <button className="chat-who-btn" onClick={openPeople}
                                aria-label={`참여자 ${roomPeople.length}명`}>
                            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                                 strokeLinecap="round" aria-hidden="true">
                                <path d="M4 7h16M4 12h16M4 17h16" />
                            </svg>
                        </button>
                    </>
                )}
            </div>

            {/* **방 공지** — 카톡 오픈톡에서 맨 위에 붙박여 있는 그 줄이다.
                모임 규칙·계좌·집합 장소가 하루 백 마디에 안 밀린다.

                **기본은 접힌 한 줄이다.** 긴 공지를 펴 놓고 시작하면 대화가
                그만큼 가려진다 — 누르면 펴지고 다시 누르면 접힌다. */}
            {pinShown && !searchOn && (
                <div className="chat-pin-wrap">
                    <div className={`chat-pin${pinOpen ? ' open' : ''}`}>
                        <div className="chat-pin-row">
                            <button className="chat-pin-main" onClick={() => setPinOpen(v => !v)}
                                    aria-expanded={pinOpen}>
                                <span className="chat-pin-mark" aria-hidden="true">📢</span>
                                <span className="chat-pin-text">{preview(pin) || '메시지'}</span>
                                <span className="chat-pin-caret" aria-hidden="true">
                                    {pinOpen ? '⌃' : '⌄'}
                                </span>
                            </button>
                            {/* **✕는 내 화면에서만 치운다.** 남의 화면에서
                                내리는 것은 아래의 `공지 내리기`(운영진)다 —
                                생김새가 비슷하니 하는 일을 헷갈리지 말 것. */}
                            <button className="chat-pin-x" onClick={closePin}
                                    aria-label="공지 닫기">✕</button>
                        </div>
                        {/* 펼쳤을 때만 나오는 줄. **누가 올렸는지 적는다** — 물어볼
                            데가 있어야 한다. `대화에서 보기`는 그 말이 오간 자리로
                            데려간다(앞뒤 이야기가 곧 공지의 뜻인 때가 많다). */}
                        {pinOpen && (
                            <div className="chat-pin-foot">
                                <span className="chat-pin-by">
                                    {names[pin.pinned_by ?? '']?.name
                                        ? `${names[pin.pinned_by ?? ''].name}님이 올림`
                                        : '운영진이 올림'}
                                </span>
                                <button className="chat-pin-act"
                                        onClick={() => { setPinOpen(false); jumpTo(pin.id); }}>
                                    대화에서 보기
                                </button>
                                {isAdmin && (
                                    <button className="chat-pin-act" onClick={() => askPin(pin)}>
                                        공지 내리기
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 찾은 글 목록. **대화 위를 통째로 덮는다** — 반쯤 걸치면 어느
                줄이 결과이고 어느 줄이 대화인지 헷갈린다. */}
            {searchOn && (
                <div className="chat-hits">
                    {searching && <div className="chat-hits-note">찾는 중…</div>}
                    {!searching && hits === null && (
                        <div className="chat-hits-note">찾을 말을 두 글자 이상 적어 주세요.</div>
                    )}
                    {!searching && hits?.length === 0 && (
                        <div className="chat-hits-note">찾는 말이 든 대화가 없습니다.</div>
                    )}
                    {hits?.map(m => (
                        <button key={m.id} className="chat-hit" onClick={() => openHit(m)}>
                            <div className="chat-hit-top">
                                <span className="chat-hit-who">
                                    {m.system ? '안내' : names[m.user_id ?? '']?.name ?? '알 수 없음'}
                                </span>
                                <span className="chat-hit-at">{formatStamp(m.created_at)}</span>
                            </div>
                            <div className="chat-hit-body">{preview(m)}</div>
                        </button>
                    ))}
                </div>
            )}

            <div className="chat-list" ref={listRef} onScroll={onScroll} onClick={onPhotoTap}>
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
                            {newDay && <div className="chat-day">{formatChatDay(m.created_at)}</div>}
                            {/* **앱이 스스로 남긴 줄**(라운드·투표 안내).
                                말풍선으로 그리면 누가 말을 건 것처럼 보이고
                                답장·밀기까지 붙는다 — 안내는 가운데 한 줄이다. */}
                            {m.system && (
                                m.round_id
                                    ? <LinkCard body={m.body} to={`/rounds/${m.round_id}`}
                                                go="라운드 보러 가기 ›" rest="chat-result-note" />
                                    : m.poll_id
                                        ? <LinkCard body={m.body} to={`/polls/${m.poll_id}`}
                                                    go="투표 보러 가기 ›" rest="chat-result-win" />
                                        : m.post_id
                                            ? <LinkCard body={m.body} to={`/board/${m.post_id}`}
                                                        go="공지 보러 가기 ›" rest="chat-result-note" />
                                            : <div className="chat-notice">{m.body}</div>
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
                                onImageLoad={onImageLoad}
                                quoted={quoted}
                                quotedWho={quoted ? names[quoted.user_id ?? '']?.name : undefined}
                                lostQuote={!!m.reply_to && !quoted}
                                onJump={jumpTo}
                                onReply={startReply}
                                onHold={openMenu}
                                onFace={openCard}
                                mentionNames={mentionNames}
                                myName={myName}
                                allowAll={staffIds.has(m.user_id ?? '')}
                                reactions={reacts[m.id]}
                                onReact={toggleReact}
                                myId={me}
                            />}
                        </div>
                    );
                })}
            </div>

            {/* **옛 글을 보는 중이라는 표이자, 돌아오는 길이다.** 검색으로
                옮겨 가면 목록이 그 언저리만 담고 있어 아래로 끝까지 굴려도
                최근 대화가 없다 — 이 단추가 없으면 나갔다 다시 들어와야 한다. */}
            {windowed && (
                <button className="chat-recent" onClick={backToRecent}>
                    최근 대화로 ↓
                </button>
            )}

            {/* **맨 아래로 내려가는 화살표**(카톡에 있는 그것 — 사용자 요청).
                오랜만에 들어오면 `여기까지 읽으셨습니다` 줄에 내려놓으므로,
                밀린 글이 많은 날에는 최근 대화까지 한참을 굴려야 했다.
                `windowed`일 때는 안 띄운다 — 그때는 목록에 최근 대화가 아예
                없어 굴려도 소용이 없고, 바로 위 `.chat-recent`가 그 몫이다. */}
            {!windowed && showJump && lastMsg && (
                <button className="chat-jump" onClick={jumpToLatest}
                        aria-label="최근 대화로 이동">
                    {/* 안내 줄(`system`)에는 얼굴도 이름도 없다 — 말풍선에서도
                        그렇게 그린다. 그때는 글이 줄을 통째로 쓴다. */}
                    {lastWho && <Avatar name={lastWho.name} url={lastWho.avatar_url}
                                        gender={lastWho.gender} size="sm" />}
                    <span className="chat-jump-text">
                        {lastWho && <b>{lastWho.name}</b>}
                        <span>{preview(lastMsg)}</span>
                    </span>
                    <span className="chat-jump-go" aria-hidden="true">↓</span>
                </button>
            )}

            <div className="chat-input" ref={barRef}>
                {/* 골라 둔 이모티콘. **곧바로 안 나가고 여기 떠 있는다**
                    (사용자 요청) — 글을 마저 적어 한 마디로 함께 보낸다.
                    그림을 누르면 그대로 나가고(글이 없어도 된다), `✕`로 뗀다.
                    `onMouseDown`을 막아 키보드가 안 내려가게 한다 — 글을 치던
                    중에 누르는 자리라 보내기 단추와 같은 사정이다. */}
                {picked && (
                    <div className="sticker-peek">
                        <button className="sticker-peek-img" onClick={send}
                                onMouseDown={e => e.preventDefault()}
                                disabled={sending}
                                aria-label={`${stickerLabel(stickerRef(picked))} 보내기`}>
                            <img src={stickerSrc(stickerRef(picked))} alt="" onError={otherExt} />
                        </button>
                        <button className="sticker-peek-x" onClick={() => setPicked(null)}
                                onMouseDown={e => e.preventDefault()}
                                aria-label="이모티콘 빼기">✕</button>
                    </div>
                )}

                {/* 답장할 글을 입력칸 위에 물려 둔다. ✕로 뗀다.
                    입력칸 안이라 키보드가 올라와도 함께 따라 올라간다.
                    **말은 `댓글`이다** — 길게 누르는 창의 그 줄과도, 올라간
                    말풍선의 머리말과도 같아야 한다(한쪽만 고치면 누른 것과
                    남는 것이 달라 보인다). */}
                {replyTo && (
                    <div className="reply-bar">
                        <div className="grow" style={{ minWidth: 0 }}>
                            <div className="xs b">
                                {(names[replyTo.user_id ?? '']?.name ?? '알 수 없음')}에게 댓글
                            </div>
                            <div className="xs faint truncate">{preview(replyTo)}</div>
                        </div>
                        <button className="reply-x" onClick={() => setReplyTo(null)}
                                onMouseDown={e => e.preventDefault()}
                                aria-label="댓글 그만두기">✕</button>
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

                {/* **`hidden`으로 두지 말 것.** iOS는 사진 고르는 창을
                    **이 칸이 있는 자리**에 붙이는데, `display: none`이면
                    자리가 없어 **화면 한가운데에 뜬다**(사용자 제보 · 사진).
                    `+` 옆에 1px로 숨겨 두면 거기서 올라온다. 눈에 안 보이고
                    눌리지도 않으므로 배치에는 아무 몫이 없다. */}
                <input
                    ref={fileRef} type="file" accept="image/*"
                    onChange={onPickPhoto}
                    className="file-anchor" tabIndex={-1} aria-hidden="true"
                />


                {/* 사진 · 입력칸 · 보내기 한 줄. 위의 인용과 언급 목록이
                    같은 상자 안에 쌓이므로 이 줄만 따로 묶는다.

                    **앱에 네이티브 글칸이 있으면 이 줄을 안 그린다** — 그
                    자리에 네이티브 바가 서기 때문이다(위 `네이티브 글칸`
                    꼭지). 위의 인용·언급 목록·이모티콘 미리보기와 아래
                    서랍은 그대로 웹이 그린다. */}
                {!nativeBar && (
                <div className={`chat-bar${STICKERS.length ? '' : ' no-sticker'}`}>
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
                        onChange={e => {
                            markText(e.target.value);
                            syncMention();
                            growDraft();
                        }}
                        onSelect={syncMention}
                        onKeyDown={onKeyDown}
                        onFocus={onComposerFocus}
                        onBlur={onComposerBlur}
                        rows={1} maxLength={1000}
                        aria-label="메시지 입력"
                    />
                    {!focused && !hasText.current && <span className="chat-hint">메시지</span>}
                    {/* 이모티콘 단추는 **입력칸 안 오른쪽 끝**에 얹는다
                        (사용자가 보여 준 모양이다). 왼쪽 `+` 옆에 나란히
                        두었더니 눌러야 할 것이 왼쪽에 둘로 몰렸다 —
                        오른쪽은 보내는 쪽이라 뜻으로도 그 편이 맞다.
                        여러 줄로 늘어나면 아래쪽 끝에 붙어 따라 내려간다.
                        **`onMouseDown`을 막지 않는다** — 여는 순간 키보드를
                        내리는 것이 이 단추가 할 일이다(`toggleTray`).
                        **서랍이 열려 있는 동안에는 자판 그림이 된다** — 그
                        자리에 다시 키보드를 부르는 단추가 되기 때문이다.
                        얼굴 그림 그대로 두면 눌러도 다시 이모티콘이 나올 것
                        같아 보인다(카톡도 이렇게 바꾼다).
                        **한 장도 없으면 단추 자체를 안 그린다** — 눌러 봐야
                        빈 서랍이 열릴 뿐이라, 그 자리는 비워 두는 것이 맞다.
                        그때는 `.textarea`의 오른쪽 여백도 함께 없앤다
                        (`.chat-bar.no-sticker`) — 안 그러면 아무것도 없는
                        자리를 40px 비워 둔 채로 글자가 일찍 접힌다. */}
                    {STICKERS.length > 0 && (
                    <button className={`chat-sticker-btn${tray ? ' on' : ''}`}
                            onClick={toggleTray}
                            aria-label={tray ? '자판으로' : '이모티콘'} aria-pressed={tray}>
                        {tray
                            ? <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8"
                                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
                                  <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01
                                           M6 12.8h.01M9.5 12.8h.01M13 12.8h.01M16.5 12.8h.01
                                           M8.5 15.6h7" />
                              </svg>
                            : <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9"
                                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <circle cx="12" cy="12" r="9" />
                                  <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
                                  <path d="M9 9.5h.01M15 9.5h.01" />
                              </svg>}
                    </button>
                    )}
                </div>
                {/* 보내기 버튼은 **늘 그 자리에 있다**(사용자 제보 — 카톡은
                    부드러운데 여기는 깜빡였다). 붙였다 떼면 두 가지가 같이
                    나빠진다: 단추가 생길 때마다 글칸이 좁아져 **치던 글이
                    옆으로 밀리고**, 한글 조합 중에 값이 잠깐 비어 보이는
                    순간마다 **깜빡인다**. 뒤엣것은 댓글의 `등록` 단추에서
                    이미 겪은 그것이다.
                    그래서 **켜지는 기준도 거기와 같은 초점**이다 — 글자로
                    정하면 조합 중에 다시 깜빡인다. 초점이 떠 있어도 적어 둔
                    글이나 골라 둔 이모티콘이 있으면 켜 둔다.
                    빈칸일 때 눌러도 `send()`가 그냥 돌아선다.
                    **글자마다 도는 값이 아니다** — `focused`는 초점이 오갈
                    때만 바뀌므로 치는 동안에는 화면이 다시 안 그려진다.
                    onMouseDown을 막아야 입력칸이 초점을 안 놓친다 — 키보드가
                    내려가지 않는 이유가 이 한 줄이다. 누르는 것 자체는 그대로
                    onClick으로 온다. */}
                <button className="btn primary chat-send" onClick={send}
                        onMouseDown={e => e.preventDefault()}
                        disabled={sending || (!focused && !hasText.current && !picked)}
                        aria-label="보내기">
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        {/* 위쪽 화살표. 카톡의 보내기 단추가 그 그림이라
                            손에 익은 쪽을 따랐다(예전엔 오른쪽 화살표였다). */}
                        <path d="M12 19V6M6 12l6-6 6 6" />
                    </svg>
                </button>
                </div>
                )}

                {/* 이모티콘 서랍은 **입력칸 아래**, 키보드가 서던 자리에 뜬다
                    (사용자가 보여 준 카톡 모양이다). 위에 두었더니 대화가
                    가려졌고, 무엇보다 **글칸이 서랍에 밀려 올라가** 이모티콘을
                    고르면서 글을 이어 칠 수가 없었다.
                    여기 두면 `.chat-input`이 그만큼 두꺼워지고 `.chat-list`가
                    저절로 줄어든다 — 대화는 가려지는 게 아니라 접힌다.
                    **누르면 곧바로 나간다** — 고르고 나서 `보내기`를 또
                    눌러야 하면 한 마디에 두 번이다(투표의 날짜 고르기·조 편성
                    조건과 같은 결이다).
                    그림은 화면에 보이는 것만 받아 온다(`loading="lazy"`) —
                    백예순 장을 한꺼번에 받으면 LTE에서 서랍이 늦게 뜬다.

                    **묶음마다 탭이 하나다**(사용자 요청 — 카카오톡처럼).
                    한 줄로 늘어놓았더니 백예순 장 가운데 아래쪽 것은 아무도
                    끝까지 굴려 보지 않았다. 탭은 **위**에 둔다 — 카톡은 아래에
                    두지만 이 앱은 화면 맨 아래가 탭바(홈·공지·…) 자리라
                    서랍이 그 밑으로 깔려 가려진다.
                    그림글자만 두지 않고 **이름을 함께 적는다** — 그림 하나로는
                    무슨 묶음인지 알 수 없고, 그림글자가 없는 기기에서는 네모난
                    두부만 남는다. 일곱 개가 좁은 화면에서 넘치므로 옆으로
                    굴러가게 두었다. */}
                {tray && (
                    <div className="sticker-tray">
                        <div className="sticker-tabs" role="tablist"
                             aria-label="이모티콘 묶음">
                            {STICKER_GROUPS.map(gr => (
                                <button key={gr.id} type="button" role="tab"
                                        className={`sticker-tab${gr.id === group ? ' on' : ''}`}
                                        aria-selected={gr.id === group}
                                        onClick={() => setGroup(gr.id)}>
                                    <span aria-hidden="true">{gr.tab}</span>
                                    {gr.name}
                                </button>
                            ))}
                        </div>
                        {/* **`key`가 묶음이라 탭을 옮기면 새로 만들어진다** —
                            굴려 둔 자리가 그대로 남으면 장수가 적은 묶음으로
                            옮겼을 때 빈 칸만 보인다. */}
                        <div className="sticker-grid" key={group}>
                            {(STICKER_GROUPS.find(gr => gr.id === group)
                              ?? STICKER_GROUPS[0]).stickers.map(s => (
                                <button key={s.id}
                                        className={`sticker-btn${picked === s.id ? ' on' : ''}`}
                                        onClick={() => pickSticker(s.id)}
                                        aria-label={s.label}>
                                    <img src={stickerSrc(stickerRef(s.id))}
                                         alt="" loading="lazy" onError={otherExt} />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* **길게 누른 글로 할 일을 고르는 창**(카톡의 그 창이다).
                아래에서 올라온다 — 폰에서 엄지가 닿는 자리다.
                바깥을 누르면 닫힌다.

                **고르면 창을 먼저 닫고 확인창을 띄운다.** 둘이 겹쳐 있으면
                뒤엣것이 앞엣것을 덮어 무엇을 누르는 중인지가 흐려진다. */}
            {/* **참여자 목록** — 머리말 아래를 덮는다(검색 결과와 같은 자리다).
                100명이면 훑을 수가 없으므로 **열둘을 넘으면 찾게 한다**
                (`FIND_AT` — 정산에서 사람 고를 때와 같은 잣대다). */}
            {peopleOn && (
                <PeopleList people={roomPeople} me={me}
                            onPick={openCard} onClose={() => setPeopleOn(false)} />
            )}

            {/* **프로필 카드** — 얼굴을 누르거나 참여자 목록에서 고르면 뜬다.
                **여기에 전화번호·차량번호를 적지 말 것** — 그건 회원 명단
                하나에서 운영진에게만 보이기로 정해 둔 값이다. */}
            {card && (
                <div className="chat-menu-back" onClick={() => setCard(null)}>
                    <div className="chat-card" onClick={e => e.stopPropagation()}>
                        <Avatar name={card.name} url={card.avatar_url}
                                gender={card.gender} size="lg" />
                        <div className="chat-card-name">{personLabel(card)}</div>
                        <div className="chat-card-sub">
                            {ROLE_TAG[card.role] && (
                                <span className={`role-tag ${ROLE_TAG[card.role]}`}>
                                    {ROLE_LABEL[card.role]}
                                </span>
                            )}
                            {/* **참석 횟수는 운영진에게만 보인다**(사용자 요청 ·
                                회원 명단과 같은 규칙). 일반회원은 `attend`가
                                `null`이라 이 줄이 아예 없다. */}
                            {attend && <span className="dim xs">올해 {attend[card.id] ?? 0}회</span>}
                        </div>
                        {/* **내 얼굴에는 `@언급하기`를 안 붙인다** — 나를 부를 일이 없다. */}
                        {card.id !== me && card.name && (
                            <button className="btn ghost sm"
                                    onClick={() => mentionFromCard(card)}>@언급하기</button>
                        )}
                        <button className="chat-menu-item ghost"
                                onClick={() => setCard(null)}>닫기</button>
                    </div>
                </div>
            )}

            {menuFor && (() => {
                /* 창을 그리는 동안 `menuFor`가 바뀔 일은 없지만, 아래 콜백들이
                   전부 이 값을 붙들도록 한 번만 꺼내 둔다. */
                const m = menuFor.m;
                const shut = () => setMenuFor(null);
                /** 고르면 창부터 닫고 그 일을 한다 — 둘이 겹쳐 보이면 안 된다. */
                const pick = (go: () => void) => () => { shut(); go(); };
                const hidden = !!m.hidden_at;
                const hasText = !!m.body.trim();
                return (
                    <div className="chat-menu-back soft" onClick={shut}>
                        <HoldAt at={menuFor.at} mine={menuFor.mine}>
                            <div className="chat-menu" onClick={e => e.stopPropagation()}>
                                {/* **미리보기 머리말이 없다**(카톡과 같다).
                                    누른 말풍선 옆에 뜨므로 어느 글인지가
                                    자리로 이미 말해진다 — 화면 아래에서
                                    올라오던 때만 필요했던 줄이다. */}
                                {/* **복사가 맨 위다** — 가장 자주 누르는 자리이면서
                                    아무것도 안 바꾸는 일이다. 글이 없는 글
                                    (사진·이모티콘만)에는 안 붙인다. */}
                                {hasText && !hidden && (
                                    <button className="chat-menu-item" onClick={pick(() => copyText(m.body))}>
                                        복사<HoldIcon name="copy" />
                                    </button>
                                )}
                                {/* **선택 복사** — 글의 일부만 가져가는 자리다.
                                    가리거나 지울 수 있는 글에는 `user-select: none`이
                                    걸려 있어(길게 누르기를 iOS의 글자 고르기가
                                    덮지 않게) **말풍선에서는 끌어서 고를 수가
                                    없다.** 그 손해를 여기서 되돌린다. */}
                                {hasText && !hidden && (
                                    <button className="chat-menu-item" onClick={pick(() => setPickText(m.body))}>
                                        선택 복사<HoldIcon name="pick" />
                                    </button>
                                )}
                                {/* **`댓글`은 왼쪽으로 밀면 걸리는 그것과 같은 일이다**
                                    (사용자가 정한 이름이다 — `댓글이 답장기능과
                                    같은거고`). 인용해서 답하는 자리다.
                                    미는 손짓은 아는 사람만 쓰므로 여기에도 둔다. */}
                                {!hidden && (
                                    <button className="chat-menu-item" onClick={pick(() => startReply(m))}>
                                        댓글<HoldIcon name="reply" />
                                    </button>
                                )}
                                <button className="chat-menu-item" onClick={pick(() => void shareMessage(m))}>
                                    공유<HoldIcon name="share" />
                                </button>
                                <button className="chat-menu-item" onClick={pick(() => void captureMessage(m))}>
                                    캡쳐<HoldIcon name="capture" />
                                </button>
                                {/* 가리기는 **운영진만** 한다(사용자 요청).
                                    되돌릴 수 있어 남의 글에도 쓴다. */}
                                {isAdmin && (
                                    <button className="chat-menu-item" onClick={pick(() => askHide(m))}>
                                        {hidden ? '가리기 풀기' : '가리기'}<HoldIcon name="hide" />
                                    </button>
                                )}
                                {/* **공지로 올리는 것도 운영진 몫이다**(카톡 오픈톡과 같다).
                                    대화 맨 위에 붙박여 모두에게 늘 보이는 자리라,
                                    아무나 올리면 그 자리가 곧 의미를 잃는다.
                                    가린 글에는 안 붙인다 — 덮어 둔 내용이 맨 위로 샌다. */}
                                {isAdmin && !hidden && (
                                    <button className="chat-menu-item" onClick={pick(() => askPin(m))}>
                                        {m.pinned_at ? '공지 내리기' : '공지로 올리기'}<HoldIcon name="notice" />
                                    </button>
                                )}
                                {/* **삭제는 쓴 사람 몫이다.** 되돌릴 수 없는 일이라
                                    남의 글에는 안 붙인다 — 운영진에게는 가리기가 있다. */}
                                {m.user_id === me && (
                                    <button className="chat-menu-item danger" onClick={pick(() => askDelete(m))}>
                                        삭제<HoldIcon name="trash" />
                                    </button>
                                )}
                            </div>
                            {/* **반응은 창 아래에 알약으로 따로 선다**(사용자 요청 —
                                `이모티콘도 카톡처럼 하단에 넣어줘`). 카톡의 그것도
                                메뉴와 붙어 있지 않고 아래에 떠 있는 한 줄이다.
                                **누른 말풍선에 가장 가까운 쪽이 이 줄이다** — 창이
                                말풍선 위에 뜨든 아래에 뜨든 언제나 맨 아래다.
                                가린 글에는 안 붙인다: 덮어 둔 글에 좋다고 누를
                                일이 없다(복사·댓글을 안 붙이는 것과 같다).
                                **카톡의 `+`(더 고르기)는 안 만든다** — 우리 반응은
                                다섯으로 못박혀 있어(`REACTIONS`) 더 고를 것이 없다. */}
                            {!hidden && (
                                <div className="chat-menu-reacts" onClick={e => e.stopPropagation()}>
                                    {REACTIONS.map(e => (
                                        <button key={e} className="chat-menu-react"
                                                aria-label={`${e} 반응`}
                                                onClick={pick(() => toggleReact(m.id, e))}>{e}</button>
                                    ))}
                                </div>
                            )}
                        </HoldAt>
                    </div>
                );
            })()}

            {/* **선택 복사** — 글자를 끌어서 고를 수 있게 펼쳐 놓는다.
                고르고 나면 폰이 띄워 주는 `복사`를 누르면 된다(iOS·안드로이드
                둘 다 그렇다). 그게 안 되는 기기를 위해 `전체 복사`도 둔다. */}
            {pickText !== null && (
                <div className="chat-menu-back" onClick={() => setPickText(null)}>
                    <div className="chat-pick" onClick={e => e.stopPropagation()}>
                        <div className="chat-pick-hint">글자를 길게 눌러 고른 뒤 복사하세요</div>
                        <div className="chat-pick-body">{pickText}</div>
                        <div className="chat-pick-foot">
                            <button className="btn ghost sm" onClick={() => setPickText(null)}>닫기</button>
                            <button className="btn primary sm"
                                    onClick={() => { const t = pickText; setPickText(null); copyText(t); }}>
                                전체 복사
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* **사진을 크게 보는 자리.** 앱에서 새 창으로 띄우면 사파리로
                나가 버리므로 여기서 본다(위 `onPhotoTap` 주석).
                벌려서 키우는 것까지 `PhotoZoom`이 맡는다. */}
            {zoom && (
                <PhotoZoom url={zoom} busy={busy}
                           onSave={() => savePhoto(zoom)}
                           onShare={() => sharePhoto(zoom)}
                           onClose={() => setZoom(null)} />
            )}
        </div>
    );
}

/**
 * 대화방의 사진 한 장.
 *
 * **못 받아 오면 `저장 기간이 만료되었습니다`로 바꾼다**(카톡과 같다).
 * 무료 저장 공간이 1GB라 **90일이 지난 사진은 지워지므로**(`lib/photos.ts`),
 * 지난 사진에는 언젠가 반드시 이 자리가 온다. 안 두면 깨진 그림 표만
 * 덩그러니 남아 고장으로 보인다.
 *
 * **글은 그대로 남는다** — 사진에 함께 적은 말은 아래 줄에 그대로 있다.
 * 자리를 이모티콘 없는 조각과 같은 크기로 두는 것도 같은 까닭이다:
 * 그림이 없다고 자리가 줄면 읽던 자리가 위아래로 튄다.
 */
function ChatPhoto({ url, onLoad }: {
    url: string;
    onLoad: (e: SyntheticEvent<HTMLImageElement>) => void;
}) {
    const [gone, setGone] = useState(false);
    if (gone) {
        return (
            <div className="chat-photo-gone">
                <span>사진 저장 기간이<br />만료되었습니다</span>
            </div>
        );
    }
    return (
        <a className="chat-photo-link" href={url}>
            <img className="chat-image" src={url} alt="보낸 사진" loading="lazy"
                 onLoad={onLoad} onError={() => setGone(true)} />
        </a>
    );
}

/** 손짓이 도는 동안 붙들어 두는 값. */
type Grip = {
    mode: 'pan' | 'pinch';
    /* 시작할 때의 자리와 크기 */
    s0: number; x0: number; y0: number;
    /* 손가락 하나면 그 자리, 둘이면 사이 거리와 가운데 */
    px: number; py: number; dist: number;
};

/** 두 손가락 사이의 거리와 가운데(창 가운데를 0으로 본 자리). */
function pinchOf(t: React.TouchList, box: DOMRect) {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return {
        dist: Math.hypot(dx, dy) || 1,
        mx: (t[0].clientX + t[1].clientX) / 2 - (box.left + box.width / 2),
        my: (t[0].clientY + t[1].clientY) / 2 - (box.top + box.height / 2),
    };
}

const ZOOM_MAX = 4;      // 이보다 더 키우면 화소만 보인다
const ZOOM_TAP = 2.5;    // 두 번 눌렀을 때

/**
 * **크게 본 사진 — 벌려서 키우고, 끌어서 옮긴다**(사용자 제보 —
 * `사진 확대는 안되네?`).
 *
 * 앱 안 웹뷰는 화면 자체를 벌려 키우는 것을 안 받아 준다(받아 준들
 * 입력칸·탭바까지 같이 커져 더 나쁘다). 그래서 **사진만 우리가 키운다** —
 * 웹으로 열었을 때와 앱에서 하는 일이 같아지고, 헤드리스로도 확인된다.
 *
 * 규칙 넷:
 * - **크기를 state에 안 넣는다.** 손가락을 따라 매 프레임 다시 그리면
 *   느린 폰에서 그대로 끊긴다 — 답장 밀기와 같은 자리라 요소를
 *   직접 움직인다(`el.style.transform`).
 * - **벌리는 가운데를 붙박아 둔다.** 그냥 키우면 사진이 손가락에서
 *   달아나 보고 싶은 데를 못 본다.
 * - **손을 뗄 때 테두리 안으로 도로 넣는다.** 1배로 돌아오면 자리도
 *   가운데로 되돌린다.
 * - **키워 둔 동안에는 눌러도 안 닫힌다.** 옮기려고 끌다가 창이
 *   닫히면 그것대로 성가시다 — 닫는 것은 `✕`와 두 번 누르기가 맡는다.
 */
function PhotoZoom({ url, busy, onSave, onShare, onClose }: {
    url: string;
    busy: 'save' | 'share' | null;
    onSave: () => void;
    onShare: () => void;
    onClose: () => void;
}) {
    const viewRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const at = useRef({ s: 1, x: 0, y: 0 });
    const grip = useRef<Grip | null>(null);
    const moved = useRef(false);
    const lastTap = useRef(0);

    const paint = () => {
        const el = imgRef.current;
        const { s, x, y } = at.current;
        if (el) el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    };

    /** 테두리 안으로 되돌린다. 1배면 가운데로. */
    const settle = () => {
        const a = at.current, view = viewRef.current, img = imgRef.current;
        a.s = Math.min(ZOOM_MAX, Math.max(1, a.s));
        if (a.s <= 1.01 || !view || !img) {
            at.current = { s: 1, x: 0, y: 0 };
        } else {
            /* 사진이 실제로 그려진 크기(키우기 전)로 잰다 — 세로 사진과
               가로 사진이 남는 자리가 다르다. */
            const vw = view.clientWidth, vh = view.clientHeight;
            const iw = img.offsetWidth * a.s, ih = img.offsetHeight * a.s;
            const mx = Math.max(0, (iw - vw) / 2), my = Math.max(0, (ih - vh) / 2);
            a.x = Math.min(mx, Math.max(-mx, a.x));
            a.y = Math.min(my, Math.max(-my, a.y));
        }
        paint();
    };

    /** 그 자리를 붙박은 채로 크기를 바꾼다. */
    const zoomAt = (s: number, mx: number, my: number, from: Grip) => {
        const a = at.current;
        a.s = s;
        a.x = mx - (mx - from.x0) * (s / from.s0);
        a.y = my - (my - from.y0) * (s / from.s0);
        paint();
    };

    const onStart = (e: React.TouchEvent) => {
        const box = viewRef.current?.getBoundingClientRect();
        if (!box) return;
        moved.current = false;
        const a = at.current;
        if (e.touches.length >= 2) {
            const p = pinchOf(e.touches, box);
            grip.current = { mode: 'pinch', s0: a.s, x0: a.x, y0: a.y,
                             px: p.mx, py: p.my, dist: p.dist };
        } else {
            grip.current = { mode: 'pan', s0: a.s, x0: a.x, y0: a.y,
                             px: e.touches[0].clientX, py: e.touches[0].clientY, dist: 1 };
        }
    };

    const onMove = (e: React.TouchEvent) => {
        const g = grip.current, box = viewRef.current?.getBoundingClientRect();
        if (!g || !box) return;
        if (e.touches.length >= 2) {
            /* 손가락 하나로 끌다가 하나를 더 얹으면 거기서 다시 잡는다. */
            if (g.mode !== 'pinch') { onStart(e); return; }
            const p = pinchOf(e.touches, box);
            moved.current = true;
            zoomAt(g.s0 * (p.dist / g.dist), p.mx, p.my, g);
            return;
        }
        if (g.mode !== 'pan') return;
        const dx = e.touches[0].clientX - g.px, dy = e.touches[0].clientY - g.py;
        if (Math.hypot(dx, dy) > 8) moved.current = true;
        /* 1배일 때는 안 옮긴다 — 그냥 누른 것이 되어야 닫힌다. */
        if (at.current.s <= 1) return;
        at.current.x = g.x0 + dx;
        at.current.y = g.y0 + dy;
        paint();
    };

    const onEnd = (e: React.TouchEvent) => {
        if (e.touches.length === 0) grip.current = null;
        settle();
    };

    /** 두 번 누르면 키우고, 키워 둔 것은 되돌린다(카톡과 같다). */
    const onTap = (e: React.MouseEvent) => {
        const box = viewRef.current?.getBoundingClientRect();
        /* **표시는 누를 때마다 비운다.** `touchstart`에서만 비우면 손짓
           뒤에 남은 값이 다음 누름까지 따라와 안 닫힌다. */
        const dragged = moved.current;
        moved.current = false;
        const now = Date.now();
        const twice = now - lastTap.current < 320;
        /* 두 번 누르기가 이뤄졌으면 셈을 처음으로 — 세 번째가 또
           짝지어져 방금 되돌린 것을 도로 키우면 안 된다. */
        lastTap.current = twice ? 0 : now;
        if (twice && box) {
            const a = at.current;
            if (a.s > 1) at.current = { s: 1, x: 0, y: 0 };
            else zoomAt(ZOOM_TAP,
                        e.clientX - (box.left + box.width / 2),
                        e.clientY - (box.top + box.height / 2),
                        { mode: 'pan', s0: 1, x0: 0, y0: 0, px: 0, py: 0, dist: 1 });
            settle();
            return;
        }
        /* 끌었거나 키워 둔 동안에는 안 닫는다. */
        if (dragged || at.current.s > 1) return;
        /* **사진을 누르는 것으로는 안 닫는다** — 한 번 누른 그 자리에서
           바로 닫아 버리면 **두 번 누르기가 아예 성립하지 않는다**(첫
           누름에서 창이 사라진다). 닫는 것은 사진 바깥·`✕`가 맡는다. */
        if (e.target === imgRef.current) return;
        onClose();
    };

    return (
        <div className="photo-zoom">
            <div className="photo-zoom-view" ref={viewRef} onClick={onTap}
                 onTouchStart={onStart} onTouchMove={onMove}
                 onTouchEnd={onEnd} onTouchCancel={onEnd}>
                {/* **키우면 원본을 다시 안 받아 온다** — 같은 주소라 브라우저가
                    들고 있던 것을 그대로 쓴다. */}
                <img src={url} alt="보낸 사진" ref={imgRef} />
            </div>
            <button className="photo-zoom-x" aria-label="닫기" onClick={onClose}>✕</button>
            {/* **카톡처럼 저장·공유를 단추로 둔다**(사용자 요청).
                앱에서는 앱이 맡는다 — 웹의 `<a download>`는 앱 안에서
                안 먹고 새 창은 사파리로 나간다. 옛 앱과 웹에서는
                폰이 띄워 주는 공유창으로 물러난다(거기에 `이미지 저장`이
                들어 있다). */}
            <div className="photo-zoom-bar">
                <button className="photo-zoom-btn" disabled={busy !== null} onClick={onSave}>
                    {busy === 'save' ? '저장 중…' : '저장'}
                </button>
                <button className="photo-zoom-btn" disabled={busy !== null} onClick={onShare}>
                    공유
                </button>
            </div>
        </div>
    );
}

/**
 * **참여자 목록**(카톡 오픈톡의 ☰).
 *
 * **찾는 글자를 대화 화면이 아니라 여기서 들고 있다.** 위에 두었더니 한
 * 글자마다 대화 화면 전체가 다시 그려져 **글자 하나에 64ms**가 걸렸다
 * (`node .dev/type-bench.mjs`로 쟀다 — 말풍선 120개가 뒤에 있다).
 * 조각을 갈라 놓으면 다시 그려지는 것이 이 목록뿐이라 그 값이 사라진다.
 * **state를 위로 올리지 말 것.**
 *
 * `useDeferredValue`로 늦추는 길도 있지만 **여기서는 안 쓴다** — 회원
 * 명단에서 그렇게 했다가 첫 글자가 8 → 44ms로 나빠졌다(빈 검색어에서
 * 첫 글자로 넘어가는 순간 목록이 통째로 갈리는데, 늦추면 리액트가 그
 * 큰 그림을 두 번 그린다).
 */
function PeopleList({ people, me, onPick, onClose }: {
    people: Person[];
    me: string;
    onPick: (p: Person) => void;
    onClose: () => void;
}) {
    /* 100명이면 훑을 수가 없으므로 **열둘을 넘으면 찾게 한다**
       (`FIND_AT` — 정산에서 사람 고를 때와 같은 잣대다). */
    const [find, setFind] = useState('');
    const q = find.trim();
    return (
        <div className="chat-people">
            <div className="chat-people-head">
                <span className="chat-people-n">참여자 {people.length}명</span>
                <button className="chat-search-x" onClick={onClose}>닫기</button>
            </div>
            {people.length > FIND_AT && (
                <div className="chat-people-find">
                    <input className="chat-search-in" type="search" aria-label="참여자 찾기"
                           value={find} onChange={e => setFind(e.target.value)} />
                </div>
            )}
            {people.filter(p => !q || (p.name ?? '').includes(q)).map(p => (
                <button key={p.id} className="chat-person" onClick={() => onPick(p)}>
                    <Avatar name={p.name} url={p.avatar_url} gender={p.gender} size="sm" />
                    <span className="chat-person-name">{personLabel(p)}</span>
                    {ROLE_TAG[p.role] && (
                        <span className={`role-tag ${ROLE_TAG[p.role]}`}>
                            {ROLE_LABEL[p.role]}
                        </span>
                    )}
                    {p.id === me && <span className="chat-person-me">나</span>}
                </button>
            ))}
        </div>
    );
}

/**
 * **길게 누른 창을 그 말풍선 옆에 세운다**(사용자 요청 —
 * `누른 자리에서 나오도록해줘`).
 *
 * 안에 든 것(메뉴 카드 + 반응 알약)의 크기를 **그려 놓고 재서** 자리를
 * 정한다. 미리 알 수가 없기 때문이다 — 줄 수가 사람마다 다르고(운영진은
 * 여덟, 남의 글을 누른 회원은 다섯), 가린 글에는 알약이 아예 없다.
 *
 * 규칙 넷:
 * - **가로는 말풍선의 가까운 쪽에 붙인다** — 내 글은 오른쪽 끝을, 남의
 *   글은 왼쪽 끝을 맞춘다. 카톡이 그렇고, 누른 자리에서 눈이 안 움직인다.
 * - **세로는 아래를 먼저 본다.** 안 들어가면 위로 넘긴다 — 밑에서 두 번째
 *   말풍선을 눌렀을 때 창이 화면 밖으로 나가는 것이 그 자리다.
 * - **화면 가장자리에서 8px은 띄운다**(`M`). 어느 쪽으로도 안 잘린다.
 * - **높이는 `visualViewport`로 본다** — 키보드가 올라와 있으면 보이는
 *   높이가 그만큼 작다. `clientHeight`는 아이폰에서 안 줄어든다.
 *
 * **재기 전에는 안 보이게 둔다**(`visibility: hidden`). 안 그러면 첫
 * 프레임에 왼쪽 위 구석에 한 번 번쩍인다. `useLayoutEffect`라 그리기
 * 전에 자리가 잡히므로 사람 눈에는 처음부터 제자리다.
 */
function HoldAt({ at, mine, children }: {
    at: DOMRect;
    mine: boolean;
    children: React.ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const M = 8;      // 화면 가장자리에서 띄울 만큼
        const GAP = 6;    // 말풍선과의 사이
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.visualViewport?.height ?? document.documentElement.clientHeight;

        let left = mine ? at.right - w : at.left;
        left = Math.max(M, Math.min(left, vw - w - M));

        let top = at.bottom + GAP;
        if (top + h > vh - M) top = at.top - GAP - h;
        top = Math.max(M, Math.min(top, vh - h - M));

        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
        el.style.visibility = 'visible';
    }, [at, mine]);

    return <div className={`chat-hold${mine ? ' mine' : ''}`} ref={ref}>{children}</div>;
}

/** 인용에 보일 한 줄. 사진·이모티콘만 보낸 글은 글자가 없다. */
function preview(m: Message): string {
    // 가린 글은 인용에서도 덮는다 — 여기로 새어 나가면 가린 뜻이 없다.
    if (m.hidden_at) return '가려진 메시지';
    const text = m.body.trim();
    if (text) return text.length > 60 ? text.slice(0, 60) + '…' : text;
    if (isSticker(m.image_url)) return stickerLabel(m.image_url!);
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
/** 얼마나 눌러야 '길게 누른 것'인가. 카톡과 비슷한 자리다. */
const HOLD_MS = 500;

/**
 * 이모티콘 그림을 못 찾았을 때 **다른 확장자로 한 번만** 다시 해 본다.
 *
 * 움직이는 것은 `.webp`, 그 밖은 `.png`이고 가르는 잣대는 id의 머리글자다
 * (`ANIM_PREFIX`). 규칙이 앞으로 또 바뀌면 **옛 판을 든 폰에서만 404가
 * 나는데**, 그때 그림 자리에 이름만 덩그러니 남는 것이 실제로 겪은
 * 증상이라 예비 길을 하나 둔다. 한 번만 해 보는 것은 둘 다 없을 때
 * 끝없이 오가지 않게 하려는 것이다.
 */
function otherExt(e: SyntheticEvent<HTMLImageElement>) {
    const el = e.currentTarget;
    if (el.dataset.retried) return;
    el.dataset.retried = '1';
    if (el.src.endsWith('.webp')) el.src = `${el.src.slice(0, -4)}png`;
    else if (el.src.endsWith('.png')) el.src = `${el.src.slice(0, -3)}webp`;
}

/** 다른 확장자로 바꾼 주소. 위 `otherExt`와 같은 잣대다. */
const swapExt = (url: string): string =>
    url.endsWith('.webp') ? `${url.slice(0, -4)}png` : `${url.slice(0, -3)}webp`;

/**
 * 보낸 이모티콘 한 장.
 *
 * 못 찾으면 **다른 확장자로 한 번** 해 보고, 그것도 없으면 `이모티콘`이라고
 * 적힌 작은 조각으로 물러난다. **그림이 없어진 뒤에도 예전 글이 열려야
 * 하기 때문이다** — 이모티콘을 갈아 끼우면 지난 대화에는 없는 id가 그대로
 * 남는데, 그냥 두면 깨진 그림 자국이 말풍선 자리에 남는다.
 *
 * 서랍과 미리보기는 지금 등록된 것만 그리므로 여기까지 필요 없다
 * (거기는 `otherExt` 한 번으로 끝난다).
 */
function StickerImg({ mark, onLoad }: {
    mark: string; onLoad: (e: SyntheticEvent<HTMLImageElement>) => void }) {
    /* 0 = 제 확장자 · 1 = 다른 확장자 · 2 = 포기하고 조각으로 */
    const [tried, setTried] = useState(0);
    const label = stickerLabel(mark);
    /* **자리는 이모티콘과 똑같이 차지한다**(안쪽 알약만 작다). 그림이
       없다고 자리까지 줄어들면, 미리 받아 두기가 그 사실을 알아내는
       순간(80ms마다 세 장씩) 목록이 그만큼 짧아져 **읽던 자리가 위아래로
       튄다** — 실기기 진단에서 들어갈 때 내용 높이가 272px씩 네 번
       줄었고, 그것이 이모티콘 세 장 몫(96×3)이었다. */
    if (tried >= 2) {
        return <span className="chat-sticker-gone"><span>{label}</span></span>;
    }
    const src = stickerSrc(mark);
    return <img className="chat-sticker" src={tried ? swapExt(src) : src}
                alt={label} loading="lazy"
                onLoad={onLoad} onError={() => setTried(t => t + 1)} />;
}

/**
 * 반응을 그림글자별로 묶어 `[그림글자, 개수, 내가 눌렀나]`로 돌려준다.
 *
 * **차례는 먼저 달린 순서다** — 새 반응이 들어올 때마다 칩이 자리를
 * 바꾸면 누르려던 것을 잘못 누른다. 개수순으로 정렬하지 말 것.
 */
function countReacts(rows: MessageReaction[], me: string): [string, number, boolean][] {
    const by = new Map<string, { n: number; mine: boolean; at: string }>();
    for (const r of rows) {
        const got = by.get(r.emoji);
        if (got) {
            got.n += 1;
            got.mine ||= r.user_id === me;
            if (r.created_at < got.at) got.at = r.created_at;
        } else {
            by.set(r.emoji, { n: 1, mine: r.user_id === me, at: r.created_at });
        }
    }
    return [...by.entries()]
        .sort((a, b) => (a[1].at < b[1].at ? -1 : a[1].at > b[1].at ? 1 : 0))
        .map(([emoji, v]) => [emoji, v.n, v.mine]);
}

/**
 * 말풍선 하나.
 *
 * **`memo`로 감싸 둔다.** 이 화면은 글을 치거나 초점이 오갈 때마다 다시
 * 그려지는데, 그때마다 쉰 개가 통째로 다시 그려지면 치는 것이 눈에 띄게
 * 끊긴다(실제 제보다). 넘기는 값이 그대로면 여기서 멈춘다.
 * **그래서 넘기는 것들이 매번 같아야 한다** — `jumpTo`·`startReply`·
 * `pinBottom`은 `useCallback`, `mentionNames`는 `useMemo`로 붙박아 두었다.
 * 새 값을 넘길 일이 생기면 그것도 함께 붙박을 것.
 */
const Bubble = memo(function Bubble({
    message, who, mine, grouped, showTime, unread, onImageLoad,
    quoted, quotedWho, lostQuote, onJump, onReply, onHold, onFace,
    mentionNames, myName, allowAll, reactions, onReact, myId,
}: {
    message: Message;
    who?: Person;
    mine: boolean;
    grouped: boolean;
    /** 덩어리의 마지막 줄에만 시각을 적는다. */
    showTime: boolean;
    /** 아직 안 읽은 사람 수. 0이면 아무것도 안 적는다(다 읽었다는 뜻이다). */
    unread: number;
    /** 사진은 늦게 뜨면서 목록을 밀어낸다. 다 떴다고 알린다 — 위쪽에서
     *  자란 만큼은 화면이 안 튀게 메워진다(`onImageLoad` 주석 참고). */
    onImageLoad: (e: SyntheticEvent<HTMLImageElement>) => void;
    /** 답장이면 원본. 아직 안 불러온 지난 글이면 없다. */
    quoted?: Message;
    quotedWho?: string;
    /** 답장이긴 한데 원본을 못 찾은 경우(지난 묶음이거나 지워졌다). */
    lostQuote: boolean;
    onJump: (id: string) => void;
    onReply: (m: Message) => void;
    /** 길게 눌렀을 때. 복사·댓글·공유·캡쳐 따위를 고르는 창을 연다.
     *  **어느 글에서나 열린다** — 남의 글에서도 복사와 댓글은 할 수 있다.
     *  **`at`은 누른 말풍선의 자리다** — 창이 거기 붙어 뜬다(`HoldAt`). */
    onHold: (m: Message, at: DOMRect, mine: boolean) => void;
    /** 얼굴을 눌렀을 때. 그 사람 프로필 카드를 연다. */
    onFace: (p: Person) => void;
    mentionNames: string[];
    myName: string;
    /** 쓴 사람이 운영진인가. `@전체`는 그때만 부른 것으로 본다. */
    allowAll: boolean;
    /** 이 글에 달린 반응. 하나도 없으면 없다(그때는 줄 자체를 안 그린다). */
    reactions?: MessageReaction[];
    onReact: (messageId: string, emoji: string) => void;
    myId: string;
}) {
    const rowRef = useRef<HTMLDivElement>(null);
    /** 운영진이 가린 글인가. 가렸으면 글·사진·이모티콘 대신 안내 한 줄이다. */
    const hidden = !!message.hidden_at;
    /* 이모지만 보낸 짧은 글은 말풍선 없이 크게 그린다(카톡이 그렇다).
       사진에 함께 적은 글은 그대로 둔다 — 사진 아래 붙는 한 줄이라
       거기서만 글자가 커지면 짜임이 무너진다. */
    const big = !message.image_url && emojiOnly(message.body);
    /** 이모티콘인가. 사진과 같은 칸(`image_url`)에 `sticker:`로 들어 있다. */
    const sticker = isSticker(message.image_url);
    /** 사진·이모티콘에 함께 적은 글. 있으면 그 줄이 이 덩어리의 마지막 줄이
     *  된다. **이모티콘에도 붙는다** — 골라 두고 글을 마저 적어 한 마디로
     *  함께 보내기 때문이다(`pickSticker` 참고). */
    const caption = !!message.image_url && !!message.body;
    /* 밀기 상태. **React state로 두지 않는다** — 손가락을 따라 매 프레임
       다시 그리면 긴 대화에서 눈에 띄게 끊긴다. 요소를 직접 움직인다. */
    const g = useRef({ x0: 0, y0: 0, dx: 0, decided: false, active: false });
    /* **길게 누르면 고르는 창이 뜬다**(카톡과 같은 손짓). **어느 글에서나
       뜬다** — 창 안에 `복사`가 있으므로, 남의 글이라고 막으면 정작 복사할
       길이 없어진다(예전에는 그래서 할 일이 있는 글에만 달았다). */
    const hold = useRef<number | null>(null);
    const held = useRef(false);
    const stopHold = () => {
        if (hold.current !== null) { clearTimeout(hold.current); hold.current = null; }
    };
    /**
     * 창이 붙을 자리 — **줄 전체가 아니라 말풍선(또는 그림)이다.**
     * 줄은 화면 폭을 다 쓰므로 그걸 넘기면 내 글에서도 창이 왼쪽에 뜬다.
     * 그림·이모티콘도 같은 자리를 쓰고, 무엇도 못 찾으면 줄로 물러난다.
     */
    const anchor = (): DOMRect => {
        const row = rowRef.current;
        const el = row?.querySelector<HTMLElement>(
            '.chat-bubble, .chat-sticker, .chat-image, .chat-sticker-gone');
        return (el ?? row)?.getBoundingClientRect() ?? new DOMRect();
    };
    const startHold = () => {
        held.current = false;
        stopHold();
        hold.current = window.setTimeout(() => {
            hold.current = null;
            held.current = true;
            onHold(message, anchor(), mine);
        }, HOLD_MS);
    };

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
        startHold();
    };

    /* `touch-action: pan-y`라 세로 스크롤은 브라우저가 그대로 가져간다.
       우리는 가로로 그은 것만 집는다 — `preventDefault`는 부르지 않는다
       (React의 touchmove는 passive라 어차피 안 먹는다). */
    const onTouchMove = (e: React.TouchEvent) => {
        const t = e.touches[0];
        const dx = t.clientX - g.current.x0;
        const dy = Math.abs(t.clientY - g.current.y0);
        // 조금이라도 움직이면 '길게 누르기'가 아니다 — 굴리는 중이거나 미는 중이다.
        if (Math.abs(dx) > 8 || dy > 8) stopHold();
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
        stopHold();
        const el = rowRef.current;
        // 길게 눌러 창이 떠 있으면 답장까지 걸리지 않게 한다.
        const hit = !held.current && g.current.active && g.current.dx <= -SWIPE_TRIGGER;
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

    /* ── 답장 인용 — **말풍선 안에 든다**(사용자 요청 · 카톡 사진을 받아
     *  맞췄다). 머리말(`○○에게 댓글`) · 원문 한 줄 · 가는 선, 그 아래가
     *  답장 글이다. 예전에는 말풍선 **위에** 따로 뜬 쪽지였는데, 그러면 한
     *  마디가 두 덩어리로 보여 어디까지가 답장인지 흐렸다.
     *
     *  - **이름은 닉네임 그대로다**(`83/신성호/광산구`가 아니라). 문장에
     *    가까운 줄이라 긴 이름표는 목록의 이름 자리 몫이다(홈의 `내 조` 줄과 같다).
     *  - **`댓글`은 길게 누르는 창과 같은 말이다**(사용자가 정한 이름이다) —
     *    한쪽만 고치면 누른 것과 남는 것이 달라 보인다.
     *  - 원문은 **한 줄로 자른다.** 길면 말풍선이 통째로 커져 정작 답장 글이
     *    밀린다(카톡도 한두 줄에서 자른다).
     *  - **사진·이모티콘 답장에는 말풍선이 없다** — 그때만 예전처럼 위에
     *    쪽지로 띄운다(`above`). 카톡도 그 자리에서는 쪽지로 그린다.
     */
    const quoteAt = (where: 'in' | 'above') => (
        <button className={`chat-quote ${where}`}
                onClick={() => quoted && onJump(quoted.id)}
                disabled={!quoted}>
            <span className="chat-quote-who truncate">
                {quoted ? `${quotedWho ?? '알 수 없음'}에게 댓글` : '지난 대화에 댓글'}
            </span>
            <span className="chat-quote-text truncate">
                {quoted ? preview(quoted) : '원본을 찾지 못했습니다'}
            </span>
        </button>
    );
    const hasQuote = !hidden && (quoted || lostQuote);
    /** 말풍선 안에 넣을 수 있는가 — **글 말풍선을 그릴 때만**이다. */
    const quoteIn = hasQuote && !message.image_url;

    return (
        <div className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}
             ref={rowRef}
             onTouchStart={onTouchStart} onTouchMove={onTouchMove}
             onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
             /* PC에서는 오른쪽 클릭이 '길게 누르기'다. 폰에서 창이 뜬 뒤
                손을 떼면 여기도 한 번 더 불릴 수 있어 그때는 건너뛴다. */
             onContextMenu={e => {
                 e.preventDefault();
                 if (!held.current) onHold(message, anchor(), mine);
             }}>
            {!mine && (
                <div className="chat-avatar">
                    {/* **얼굴을 누르면 그 사람 카드가 뜬다**(카톡과 같다).
                        100명 방에서는 이름표만 보고 누군지 떠올리기 어렵다. */}
                    {!grouped && (
                        <button className="chat-face" aria-label={`${who?.name ?? '알 수 없음'} 프로필`}
                                onClick={() => who && onFace(who)}>
                            <Avatar name={who?.name} url={who?.avatar_url} gender={who?.gender} />
                        </button>
                    )}
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
                {hasQuote && !quoteIn && quoteAt('above')}
                <div className="chat-line">
                    {/* **운영진이 가린 글**(카톡의 '가리기'). 글·사진·이모티콘을
                        통째로 덮고 안내 한 줄만 남긴다 — 지운 것이 아니라
                        덮어 둔 것이라 운영진이 다시 풀 수 있다. */
                    hidden
                        ? <div className="chat-bubble chat-hidden">운영진이 가린 메시지입니다</div>
                        : sticker
                        // 이모티콘. 사진과 달리 **누르는 곳이 아니다** —
                        // 원본을 새 창에 띄워 봐야 같은 그림이고, 앱에 딸린
                        // 그림이라 저장할 것도 없다.
                        // **못 찾으면 다른 확장자로 한 번 더 해 보고, 그것도
                        // 없으면 작은 조각으로 물러난다**(`StickerImg`).
                        // 움직이는 것은 `.webp`, 그 밖은 `.png`인데 가르는
                        // 잣대가 id의 머리글자라(`ANIM_PREFIX`), 앞으로 규칙이
                        // 바뀌면 옛 판을 든 폰에서 404가 난다 — 그때 그림
                        // 자리에 이름만 덩그러니 남는 것이 지난번 그 증상이다.
                        ? <StickerImg mark={message.image_url!} onLoad={onImageLoad} />
                        : message.image_url
                        // 사진은 말풍선 없이 그 자체로 보여 준다. 누르면
                        // 앱 안에서 크게 뜬다(`onPhotoTap`).
                        ? <ChatPhoto url={message.image_url} onLoad={onImageLoad} />
                        /* **인용이 붙으면 말풍선을 벗기지 않는다.** 이모지만
                           보낸 글은 원래 말풍선 없이 크게 그리는데, 답장에는
                           그 안에 머리말과 가는 선이 들어가야 하므로 말풍선이
                           있어야 한다 — 벗기면 인용이 허공에 뜬다. */
                        : <div className={`chat-bubble${big && !quoteIn ? ' emoji-only' : ''}`}>
                              {quoteIn && quoteAt('in')}
                              <Body text={message.body} names={mentionNames} me={myName} allowAll={allowAll} />
                          </div>}
                    {/* 시각은 **덩어리의 마지막 줄**에 붙는다. 사진에 글을 함께
                        보냈으면 그 글이 마지막 줄이므로 여기서는 비운다 —
                        안 그러면 사진 옆에 시각이 찍히고 그 아래로 글이 더 온다.
                        **안 읽은 사람 수는 글마다 붙는다**(카톡이 그렇다) —
                        같은 분에 보낸 글이라도 읽힌 정도가 다를 수 있다. */}
                    {(!caption || hidden) && <Stamp at={message.created_at} showTime={showTime} unread={unread} />}
                </div>
                {/* 사진에 글을 함께 보냈으면 그 아래 한 줄로 붙인다.
                    **`.chat-line`으로 감싸야 한다** — 그냥 두면 `.chat-col`이
                    늘여서(`align-items: stretch`) 짧은 글도 사진보다 넓게
                    퍼진다. 감싸면 글 길이만큼만 차지하고, 내 글은 오른쪽으로
                    붙으며, 시각도 이 줄 끝에 온다. */}
                {caption && !hidden && (
                    <div className="chat-line">
                        {/* `chat-cap` — **꼬리를 안 단다.** 꼬리는 덩어리의
                            첫 말풍선에만 붙는데, 이 줄은 사진 아래에 딸린
                            두 번째 줄이라 위가 사진으로 막혀 있다. */}
                        <div className="chat-bubble chat-cap">
                            <Body text={message.body} names={mentionNames} me={myName} allowAll={allowAll} />
                        </div>
                        <Stamp at={message.created_at} showTime={showTime} unread={unread} />
                    </div>
                )}
                {/* **말풍선 반응**(카톡의 `😄 2`). 말풍선 아래 한 줄로 붙는다.
                    **하나도 없으면 줄 자체가 없다** — 빈 자리를 늘 비워 두면
                    말풍선 사이가 성겨진다. 다는 곳은 길게 누르는 창이다. */}
                {!!reactions?.length && (
                    <div className="chat-reacts">
                        {countReacts(reactions, myId).map(([emoji, n, mineOn]) => (
                            <button key={emoji}
                                    className={`chat-react${mineOn ? ' on' : ''}`}
                                    onClick={() => onReact(message.id, emoji)}
                                    aria-pressed={mineOn}
                                    aria-label={`${emoji} ${n}명`}>
                                <span aria-hidden="true">{emoji}</span>
                                <b>{n}</b>
                            </button>
                        ))}
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
});

/**
 * 글 한 덩어리. `@이름`을 도드라지게 하고 **주소는 눌리는 링크로** 만든다.
 *
 * **두 번 나눈다** — 먼저 언급으로 자르고, 언급이 아닌 조각만 다시 주소로
 * 자른다. 언급 안에서 주소를 찾을 일은 없고(이름에 `/`가 없다), 순서를
 * 뒤집으면 `@김지명` 같은 이름이 주소 안에 들어 있을 때 링크가 쪼개진다.
 */
function Body({ text, names, me, allowAll }: {
    text: string; names: string[]; me: string; allowAll: boolean;
}) {
    const pieces = splitMentions(text, names, allowAll);
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
                    : <Links key={i} text={p.text} />)}
        </>
    );
}

/**
 * 글 조각 하나 — 주소만 눌리는 링크로 바꾼다.
 *
 * **새 탭으로 연다**(`target="_blank"`). 같은 창에서 열면 홈 화면 앱에서는
 * 돌아올 길이 없다 — 주소창도 뒤로 가기도 없는 창이라 앱을 껐다 켜야 한다.
 * `rel`은 새 탭이 우리 창을 건드리지 못하게 막는 짝이다.
 *
 * **누르는 것이 밀기·길게 누르기와 안 부딪힌다** — 그 둘은 `.chat-row`의
 * touch 이벤트라 손가락이 움직이거나 오래 머물러야 걸리고, 링크는 그냥
 * 톡 누르는 것이다. 다만 링크 위에서 길게 누르면 고르는 창이 뜨는데,
 * 카톡도 그 자리에서 같은 창을 띄우므로 그대로 둔다.
 */
function Links({ text }: { text: string }) {
    const parts = splitLinks(text);
    if (parts.length === 1 && !parts[0].href) return <>{text}</>;
    return (
        <>
            {parts.map((p, i) => p.href
                ? <a key={i} className="chat-link" href={p.href}
                     target="_blank" rel="noopener noreferrer"
                     // 링크를 눌러 나가는 것이 답장 걸기로 번지지 않게 막는다.
                     onClick={e => e.stopPropagation()}>{p.text}</a>
                : <span key={i}>{p.text}</span>)}
        </>
    );
}

/**
 * 대화방에 남는 **눌리는 카드** — 라운드·투표·공지가 같이 쓴다.
 *
 * **안내 줄을 눌러서 바로 들어갈 수 있어야 한다**(사용자 요청). 예전에는
 * 가운데 한 줄짜리 글이라, 모집이 열린 것을 대화에서 보고도 라운드 탭으로
 * 건너가 목록에서 다시 찾아야 했다 — 그러면 그 줄을 남기는 뜻이 반쯤 없어진다.
 *
 * 넣는 곳이 넷이다: 모집·투표를 열 때 저절로(`announce_to_chat`), 투표가
 * 끝났을 때(`post_poll_result`), 그리고 **라운드 상세와 공지 상세**의
 * `📣 대화방에 공유`. **넷을 한 코드로 그린다** — 따로 만들면 한쪽만 고치게 된다.
 *
 * **줄 수를 세지 않는다.** 첫 줄만 갈라 흐리게 놓고 나머지는 있는 대로
 * 그리므로 문구가 늘거나 줄어도 안 깨진다. 다만 **한 줄짜리는 그 줄이 곧
 * 내용이라** 머리말로 흐리게 깔지 않고 제목으로 세운다.
 *
 * 어느 칸도 없는 예전 안내 줄은 지금처럼 가운데 한 줄로 그려진다.
 */
function LinkCard({ body, to, go, rest: restClass }: {
    body: string; to: string; go: string; rest: string;
}) {
    const lines = body.split('\n').filter(Boolean);
    const [head, ...rest] = lines;
    return (
        <Link className="chat-result" to={to}>
            <span className={lines.length > 1 ? 'chat-result-head' : 'chat-result-title'}>
                {head}
            </span>
            {rest.map((line, i) => (
                <span key={i} className={i === 0 ? 'chat-result-title' : restClass}>
                    {line}
                </span>
            ))}
            <span className="chat-result-go">{go}</span>
        </Link>
    );
}

