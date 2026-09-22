import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
         type Dispatch, type SetStateAction, type SyntheticEvent,
         type TouchEvent as RTouchEvent } from 'react';
import { supabase } from '../lib/supabase';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync, unwrap, useRefreshOnShow, fetchPeople, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatChatDay, formatStamp, formatTime, kstDate } from '../lib/format';
import { FIND_AT, GIFT_URL, REACTIONS, ROLE_LABEL, ROLE_TAG, personLabel,
         type Gender, type Message, type MessageReaction,
         type Person, type Room } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/Confirm';
import { useConfirmUp } from '../lib/overlay';
import { readableError } from '../lib/errors';
import { httpsUrl } from '../lib/image';
import { UPLOAD_LIMIT, extOf, isVideo } from '../lib/media';
import { lastSeen, markSeen, NEVER } from '../lib/unread';
import { unreadCounts, type Reads } from '../lib/reads';
import { ALL_MENTION, mentionQuery, splitMentions } from '../lib/mention';
import { splitLinks } from '../lib/links';
import { CHEER_MS, isCheer } from '../lib/cheer';
import { Fireworks } from '../components/Fireworks';
import { IS_NATIVE } from '../lib/native';
import { slideLeft } from '../lib/tabs';
import {
    NativeComposer, canNativeShare, canPickNative, canSlide, chatBarSkin, composerReady, composerSkin, hush,
    kbMark, kbSnap, kbTick, kbWork, ncLog, pickNativePhoto, shareNativeText,
} from '../lib/composer';
import { HIDDEN_LINE, isNewDay, sameBlock, type ChatSpot } from '../lib/chatlist';
import type { HoldIconName } from '../components/HoldIcons';

/** 길게 누른 창에 서는 줄 하나. */
type HoldItem = {
    name: string;
    label: string;
    icon: HoldIconName;
    danger?: boolean;
};

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
import { shareText, sharePhotoFile } from '../lib/share';
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
 * **읽던 자리를 방마다 기억해 둔다** (사용자 제보 — `채팅방으로 공유된
 * 알림을 눌러서 라운드나 투표로 들어갔다가 뒤로가기하면 그 화면으로 와야
 * 하는데 최근대화로 넘어와`).
 *
 * 대화는 `useAsync` 기억해 두기를 안 쓰므로(위 '탭을 넘길 때' 꼭지) 나갔다
 * 오면 화면이 통째로 새로 만들어지고 첫 묶음을 다시 받는다 — 그러면 굴려
 * 둔 자리가 없어 `pinBottom`이 맨 아래로 내려놓는다. 옛 대화를 되짚다가
 * 그 안의 카드를 눌러 들어간 사람에게는 **읽던 자리를 잃는 일**이다.
 *
 * - **굴린 픽셀이 아니라 글 id로 적는다.** 다시 들어오면 사진이 늦게 뜨며
 *   높이가 달라져 **같은 숫자가 다른 자리를 가리킨다.** 화면 맨 위에 걸린
 *   글과 그 글이 위로 지나간 만큼(`off`)이면 목록이 어떻게 자라도 같은 자리다.
 * - **맨 아래를 보고 있었으면 아예 안 적는다**(지운다). 그때 되돌려 놓을
 *   자리는 '맨 아래'이고, 그건 새 글이 오면 따라 내려가야 하는 자리다 —
 *   글 id로 못박아 두면 되레 안 따라간다.
 * - **모듈에 둔다.** 방을 나가면 화면이 없어지므로 화면 안에 두면 함께
 *   사라진다. 로그아웃해도 안 비우지만 **적어 둔 것이 글 id뿐**이라,
 *   다른 사람으로 들어오면 그 글이 목록에 없어 저절로 맨 아래가 된다.
 * - 방이 몇 개 없지만 **한도를 둔다** — 목록·상세 기억해 두기(`CACHE_MAX`)와
 *   같은 잣대다.
 */
const SPOTS = new Map<string, ChatSpot>();
const SPOT_MAX = 10;

/** 굴리기가 멎고 나서 적는다 — **굴리는 동안에는 재지 않는다.** */
const SPOT_WAIT = 150;

function keepSpot(room: string, spot: ChatSpot | null): void {
    SPOTS.delete(room);
    if (!spot) return;
    SPOTS.set(room, spot);
    for (const old of SPOTS.keys()) {
        if (SPOTS.size <= SPOT_MAX) break;
        SPOTS.delete(old);
    }
}

/**
 * 웹 목록에서 **화면 맨 위에 걸린 줄**을 찾는다.
 *
 * 줄이 300개까지 쌓이므로 하나씩 훑지 않고 **반씩 좁혀 간다** — 굴리기가
 * 멎은 뒤에 도는 일이라 값이 싸야 할 자리는 아니지만, 느린 폰에서 굴리다
 * 멈출 때마다 300개를 훑을 이유도 없다.
 */
function webSpot(el: HTMLElement): ChatSpot | null {
    const rows = el.querySelectorAll<HTMLElement>('[data-mid]');
    if (!rows.length) return null;
    const top = el.getBoundingClientRect().top;
    let lo = 0;
    let hi = rows.length - 1;
    let at = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].getBoundingClientRect().bottom > top + 1) { at = mid; hi = mid - 1; }
        else lo = mid + 1;
    }
    if (at < 0) return null;
    const id = rows[at].dataset.mid;
    if (!id) return null;
    return { id, off: Math.max(0, Math.round(top - rows[at].getBoundingClientRect().top)) };
}

/**
 * **마지막으로 그려 둔 줄을 방마다 들고 있는다.**
 *
 * 나갔다 오면 화면이 통째로 새로 만들어지는데, 그동안 **빈 화면이 0.8초쯤
 * 지나간다** — 사용자 제보(`되돌아가기하면 … 화면이 깜빡이면서 나오는데`)로
 * 잡은 자리다. 헤드리스로 프레임마다 재 보니 갈래가 둘이었다:
 * **0.4초는 통째로 스피너**(방·명단을 물어보는 동안 `page center-fill`),
 * **그다음 0.4초는 줄이 하나도 없는 빈 목록**(첫 묶음이 아직 안 왔다).
 *
 * 그래서 나갈 때 들고 있다가 **들어오자마자 그대로 깐다.** 빈 화면이 아예
 * 없어지고, 읽던 자리(`SPOTS`)도 그 자리에서 바로 잡힌다.
 *
 * - **통째로 다시 받지 않는다 — 마지막 글 뒤엣것만 덧붙인다.** 다시 받으면
 *   굴려 둔 자리도 `여기까지 읽으셨습니다` 줄도 잃는다(접었다 펴는
 *   `useRefreshOnShow`와 같은 잣대다). 첫 묶음 밖을 받아 오는 일도
 *   그만큼 안 생긴다.
 * - **열쇠에 사람을 넣는다**(`방:나`). 한 기기를 둘이 쓸 때 앞사람 대화가
 *   잠깐이라도 비치면 안 된다 — 사람이 바뀌면 열쇠가 달라 저절로 빈손이다.
 * - **검색으로 옛 글에 가 있을 때는 안 적는다**(`windowed`). 그 목록은
 *   '지금'이 아니라 찾은 글 언저리라, 뒤에 오늘 글을 붙이면 안 된다.
 * - **방 둘까지만** 들고 있는다(`SPOT_MAX`와 같은 결).
 */
const KEPT = new Map<string, { list: Message[]; more: boolean }>();
const KEPT_MAX = 2;

function keepList(key: string, v: { list: Message[]; more: boolean } | null): void {
    KEPT.delete(key);
    if (!v || !v.list.length) return;
    KEPT.set(key, v);
    for (const old of KEPT.keys()) {
        if (KEPT.size <= KEPT_MAX) break;
        KEPT.delete(old);
    }
}

/**
 * **읽음 표(`room_reads`)도 방마다 들고 있는다.** 줄은 `KEPT`로 첫 그림부터
 * 깔리는데 읽음 표는 서버에 다시 물어봐 몇백 ms 뒤에 오므로, 그 사이
 * **안 읽은 수가 잠깐 크게 찍혔다**(줄이 없는 사람은 '한 번도 안 읽음'으로
 * 세므로 `1`이 `4`로 보였다 — 사용자 제보 · 사진). 들어오자마자 마지막
 * 값을 깔면 첫 그림의 숫자가 나갈 때와 같다. 새 값은 뒤에서 와서 갈아 끼운다.
 */
const READS_KEPT = new Map<string, Reads>();

function keepReads(roomId: string, r: Reads): void {
    READS_KEPT.delete(roomId);
    READS_KEPT.set(roomId, r);
    for (const old of READS_KEPT.keys()) {
        if (READS_KEPT.size <= KEPT_MAX) break;
        READS_KEPT.delete(old);
    }
}

/**
 * 적어 두는 자리에 **그 글의 시각을 함께 붙인다**(`ChatSpot.at`).
 *
 * 다시 들어오면 마지막 묶음만 받아 오므로, 그 글이 거기 없으면 받아 올
 * 길이 있어야 한다 — 시각이 그 열쇠다(첫 묶음 받는 곳의 `언저리를 받아 온다`).
 * 웹 목록과 앱 목록이 **같이 쓴다**(앱은 id만 돌려주므로 여기서 붙인다).
 */
function stampSpot(spot: ChatSpot | null, list: Message[]): ChatSpot | null {
    if (!spot) return null;
    const at = list.find(m => m.id === spot.id)?.created_at;
    return at ? { ...spot, at } : spot;
}

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
/** **움직이는 이모티콘은 따로 센다** — 한 장 평균 105KB로 멈춘 것의 열다섯
 *  배가 넘는다. 같은 몫으로 두면 대화를 열 때마다 몇 MB를 받아, 미리 받아
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
    /** 캐럿 앞에 `@무엇`을 치고 있으면 그 글자. 아니면 null.
     *  **고른 뒤에는 빈 글자로 남는다** — 목록을 열어 둔 채 다음 사람을
     *  이어 고르기 위해서다(아래 `insertMention`). */
    const [mention, setMention] = useState<string | null>(null);
    /** 이미 글에 넣은 이름들. 목록의 그 줄에 체크가 붙고, 다시 누르면 빠진다. */
    const [called, setCalled] = useState<string[]>([]);
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
        /* **기억해 둔다**(`chat`). 여기서 받는 것은 **방 하나와 회원 명단**
           뿐이라 읽던 자리·안 읽음 줄과 아무 상관이 없다 — 그것들은 아래
           `messages`가 맡는다. 안 기억해 두면 나갔다 올 때마다 인터넷을
           한 바퀴 돌 동안 **화면이 통째로 스피너**가 된다(0.4초로 쟀다).
           새 값은 뒤에서 받아 슬쩍 갈아 끼운다. */
    }, [], `chat:${me}`);

    const roomId = data?.room?.id;
    /** 화면을 걷는 뒷정리에서도 읽어야 한다(`listDetach` → `SPOTS`). */
    const roomRef = useRef<string | undefined>(undefined);
    roomRef.current = roomId;
    const names = byId(data?.people ?? []);
    const myName = names[me]?.name ?? '';
    /** 언급에 쓸 이름들. 회원 이상만 — 대기·추방된 사람은 대화를 못 본다. */
    const mentionable = (data?.people ?? [])
        .filter(p => p.name && p.role !== 'pending' && p.role !== 'banned');
    /* **매번 새 배열을 만들면 안 된다** — 말풍선이 이걸 그대로 받으므로,
       내용이 같아도 배열이 새것이면 쉰 개가 전부 다시 그려진다.
       **여기 위에 있는 것은 일부러다** — 아래 `syncMention`의 의존성에
       들어가므로 그보다 늦게 선언하면 첫 렌더에서 그대로 죽는다. */
    const mentionNames = useMemo(() => mentionable.map(p => p.name), [mentionable]);
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
    /** 들고 있던 줄의 열쇠. **사람을 넣는다** — 위 `KEPT` 주석 참고. */
    const keptKey = roomId ? `${roomId}:${me}` : '';

    /* **들고 있던 줄을 그리기 전에 깐다**(위 `KEPT`). `useEffect`로 하면
       한 프레임이 빈 채로 그려져 그만큼 깜빡인다 — 배치 효과라야 첫 그림에
       이미 들어 있다. 아래 첫 묶음 받는 곳은 이걸 보고 **덧붙이기로 간다.** */
    useLayoutEffect(() => {
        const kept = keptKey && KEPT.get(keptKey);
        if (!kept) return;
        /* **`atBottom`을 여기서 내리지 말 것.** 되돌려 놓을 자리가 있다고
           미리 내려 두었더니, **되돌리기가 어긋나는 판에서 맨 위에 멈췄다** —
           `pinBottom`이 막히는데 아무도 안 옮기므로 굴린 자리가 0으로 남는다
           (사용자 사진 — 되돌아오니 대화 맨 위였다). 그대로 두면 `pinBottom`이
           일단 맨 아래로 붙이고, 되돌리기는 **같은 프레임에 뒤에서** 제 자리로
           옮긴다(그쪽이 스스로 `atBottom`을 내린다) — 그리기 전이라 안 보인다.
           되돌릴 자리를 못 찾아도 **맨 아래**로 끝난다: 예전 그대로다. */
        setMessages(kept.list);
        setHasMore(kept.more);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keptKey]);

    useEffect(() => {
        if (!roomId) return;
        let alive = true;
        (async () => {
            /* **들고 있던 줄이 있으면 통째로 다시 안 받는다 — 뒤엣것만
               덧붙인다.** 다시 받으면 굴려 둔 자리도 `여기까지 읽으셨습니다`
               줄도 잃는다(접었다 펴는 `useRefreshOnShow`와 같은 잣대다). */
            const kept = keptKey ? KEPT.get(keptKey) : null;
            if (kept?.list.length) {
                const tail = kept.list[kept.list.length - 1].created_at;
                const { data: add } = await supabase
                    .from('messages').select('*').eq('room_id', roomId)
                    .gt('created_at', tail)
                    .order('created_at', { ascending: true }).limit(MAX_CATCHUP);
                if (!alive || !add?.length) return;
                setMessages(prev => {
                    const 새것 = add.filter(r => !prev.some(m => m.id === r.id));
                    return 새것.length ? [...prev, ...새것] : prev;
                });
                return;
            }

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

            /* **읽던 글이 첫 묶음에 없으면 그 언저리를 받아 온다**(사용자
               제보 — 고쳐 놓고도 `깜빡하면서 최근대화로되어있어`).
               옛 대화를 되짚다가(=`지난 대화 더 보기`를 눌러 가며 올라가다가)
               카드를 눌러 들어간 사람은, 돌아오면 **마지막 50개만 받아 와**
               그 글이 목록에 아예 없어 맨 아래로 떨어졌다. 헤드리스로
               재서 갈랐다 — 첫 묶음 안이면 제자리로 오고, 넘어가면 `끝 0`이다.
               **검색 결과로 옮겨 갈 때와 같은 길이다**(`openHit`) — 그 글을
               가운데 두고 앞뒤를 받고 `windowed`를 세워 `최근 대화로`를 낸다.
               한쪽만 고치지 말 것.
               - **`여기까지 읽으셨습니다` 줄이 있으면 안 한다**(`i > 0`).
                 밀린 글이 있는 사람에게는 그 줄이 먼저 답해야 할 물음이다.
               - **시각을 모르면 안 한다**(옛 판이 적어 둔 자리) — 예전처럼
                 맨 아래다. 한 번 더 다녀오는 것은 그 글이 정말 없을 때뿐이다. */
            const back = SPOTS.get(roomId);
            if (i <= 0 && back?.at && !list.some(m => m.id === back.id)) {
                const [older, newer] = await Promise.all([
                    supabase.from('messages').select('*').eq('room_id', roomId)
                        .lte('created_at', back.at)
                        .order('created_at', { ascending: false }).limit(PAGE),
                    supabase.from('messages').select('*').eq('room_id', roomId)
                        .gt('created_at', back.at)
                        .order('created_at', { ascending: true }).limit(WINDOW_AFTER),
                ]);
                if (!alive) return;
                const before = older.data ?? [];
                if (before.some(m => m.id === back.id)) {
                    // 맨 아래로 끌려 내려가지 않게 먼저 내려 둔다.
                    atBottom.current = false;
                    setMessages([...before.slice().reverse(), ...(newer.data ?? [])]);
                    setHasMore(before.length === PAGE);
                    setWindowed(true);
                    return;
                }
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
                })
            .on('postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'messages' },
                payload => {
                    const gone = payload.old as { id?: string };
                    if (!gone.id) return;
                    setMessages(prev => prev.filter(m => m.id !== gone.id));
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

    /* **들고 있던 읽음 표를 그리기 전에 깐다**(위 `READS_KEPT`). 줄을 까는
       것과 같은 배치 효과라야 첫 그림의 안 읽은 수가 나갈 때와 같다. */
    useLayoutEffect(() => {
        const kept = roomId ? READS_KEPT.get(roomId) : undefined;
        if (kept) setReads(kept);
    }, [roomId]);

    // 들어올 때 한 번 받는다. 100명이라도 100줄, 7KB 남짓이다.
    useEffect(() => {
        if (!roomId) return;
        let alive = true;
        supabase.from('room_reads').select('user_id, last_read_at').eq('room_id', roomId)
            .then(({ data: rows }) => {
                if (!alive || !rows) return;
                const r: Reads = Object.fromEntries(rows.map(r => [r.user_id, r.last_read_at]));
                keepReads(roomId, r);
                setReads(r);
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
                    setReads(prev => {
                        const next = { ...prev, [row.user_id!]: row.last_read_at! };
                        keepReads(roomId, next);
                        return next;
                    });
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
    /* 앱 목록에서 카드를 눌렀을 때 옮겨 갈 길이다(19판). 웹 목록은
       `<Link>`로 가지만 앱 목록에는 링크가 없어 여기서 옮긴다. */
    const nav = useNavigate();

    /**
     * 머리말의 `←` — **대화방을 나간다**(사용자 요청 — 카톡처럼).
     *
     * **뒤로 갈 데가 없으면 홈으로 간다.** 대화는 이제 탭이 아니라
     * 들어갔다 나오는 화면인데, **알림을 눌러 `#/chat`으로 곧바로 들어오는
     * 길이 있어서**(`sw.js`의 `putNav` · `native-push`) 그때는 히스토리에
     * 앞 화면이 없다 — 그냥 `nav(-1)`만 부르면 **앱 밖으로 나가거나
     * 아무 일도 안 일어난다.** 리액트 라우터가 몇 번째 화면인지를
     * `history.state.idx`에 적어 두므로 그것으로 가린다.
     */
    const goBack = useCallback(() => {
        const idx = (history.state as { idx?: number } | null)?.idx;
        if (typeof idx === 'number' && idx > 0) nav(-1);
        else nav('/');
    }, [nav]);

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
        /* **목록이 짧아지는 것도 함께 본다**(사용자 제보 · 사진 — 대화방에
           처음 들어오면 맨 아래 말풍선이 입력칸에 반쯤 가렸고, 키보드를
           한 번 올렸다 내리면 제자리로 왔다). 앱에서는 네이티브 바가 서면서
           `.chat-input`이 50px쯤 **두꺼워지는데**, 그때 바뀌는 것은 목록의
           `clientHeight`뿐이라 안에 든 내용 높이(`scrollHeight`)만 보던
           이 감시가 그 순간을 통째로 놓쳤다. 굴러간 자리는 그대로인데
           갈 수 있는 끝이 그만큼 밀려나 아래가 잘린 것이다. */
        let lastFit = el.clientHeight;
        const until = performance.now() + 1500;
        const tick = () => {
            const h = el.scrollHeight;
            const fit = el.clientHeight;
            if (h !== last || fit !== lastFit) { last = h; lastFit = fit; pinBottom(); }
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
    const onImageLoad = useCallback((e: SyntheticEvent<HTMLElement>) => {
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

    /**
     * **읽던 자리로 되돌려 놓는다**(사용자 제보 — `채팅방으로 공유된 알림을
     * 눌러서 라운드나 투표로 들어갔다가 뒤로가기하면 그 화면으로 와야 하는데
     * 최근대화로 넘어와`). 적어 두는 곳은 위의 `SPOTS`다.
     *
     * - **`여기까지 읽으셨습니다` 줄이 이긴다.** 그 효과가 바로 아래에
     *   있으니 여기서는 비켜 준다 — 밀린 글이 있는 사람에게는 그 줄이
     *   먼저 답해야 할 물음이다.
     * - **적어 둔 글이 목록에 없으면 그냥 넘어간다.** 지난 묶음으로 밀려난
     *   글이라, 예전처럼 맨 아래에 내려놓는 것이 맞다.
     * - **앱 목록은 한 번 더 한다**(`web` → `app`). 앱 목록은 웹 화면이
     *   그려진 **뒤에** 서고 그때 맨 아래로 붙으므로, 웹 목록에 놓아 둔
     *   자리를 그대로 덮어쓴다. 그쪽은 **줄을 넘긴 뒤에** 해야 하므로
     *   `listRows` 바로 옆에 따로 두었다(아래 `앱 목록에도 같은 자리로`).
     */
    const spotDone = useRef<'web' | 'app' | 'skip' | null>(null);

    /** 되돌려 놓을 자리. 없거나 그 글이 목록에 없으면 `null`이다. */
    const spotNow = useCallback((list: Message[]): ChatSpot | null => {
        if (!roomId || !list.length) return null;
        const spot = SPOTS.get(roomId);
        /* **`여기까지 읽으셨습니다` 줄이 이긴다** — 밀린 글이 있는 사람에게는
           그 줄이 먼저 답해야 할 물음이다. */
        if (unreadFrom) {
            spotDone.current = 'skip';
            return null;
        }
        if (!spot || !list.some(m => m.id === spot.id)) {
            if (!spot) spotDone.current = 'skip';
            return null;
        }
        return spot;
    }, [roomId, unreadFrom]);

    useLayoutEffect(() => {
        if (spotDone.current) return;
        const spot = spotNow(messages);
        const el = listRef.current;
        if (!spot || !el || !el.querySelector(`[data-mid="${spot.id}"]`)) return;
        spotDone.current = 'web';
        atBottom.current = false;

        const put = () => {
            const row = el.querySelector<HTMLElement>(`[data-mid="${spot.id}"]`);
            if (!row) return;
            el.scrollTop
                += row.getBoundingClientRect().top - el.getBoundingClientRect().top + spot.off;
            // 사진이 도착했을 때 얼마나 자랐는지 견줄 잣대(위 `onImageLoad`).
            listH.current = el.scrollHeight;
        };
        put();

        /* **한 번만 놓으면 어긋난다 — 목록 높이가 한 번에 안 정해진다.**
           들어오고 나서도 그림·글꼴이 뒤늦게 자리를 잡느라 한동안 자라는데,
           헤드리스로 재 보니 **그 자란 66px이 통째로 위쪽 몫이라** 놓아 둔
           자리가 그만큼 밀렸다. 그래서 맨 아래를 붙들어 두는 감시(위)와
           똑같이 **높이가 바뀔 때마다** 다시 놓고 1.5초 뒤에 손을 뗀다.
           **높이가 바뀔 때만** 한다 — 사람이 굴리는 것은 높이를 안 바꾸므로
           그 사이에 읽으러 옮겨 간 자리를 빼앗지 않는다. */
        let raf = 0;
        let last = el.scrollHeight;
        let lastFit = el.clientHeight;
        const until = performance.now() + 1500;
        const tick = () => {
            const h = el.scrollHeight;
            const fit = el.clientHeight;
            if (h !== last || fit !== lastFit) { last = h; lastFit = fit; put(); }
            if (performance.now() < until) { raf = requestAnimationFrame(tick); return; }
            raf = 0;
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [messages, spotNow]);

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
    /**
     * **키보드가 지금 오르내리는 중인가**(`kb` 신호 ~ `frame`의 `end` 사이).
     *
     * 그 사이에는 **화면을 다시 그리게 하지 않는다** — 실기기 진단에서
     * 내려가는 길에만 `최대 34ms@201`로 한 프레임이 통째로 비었는데,
     * 그 201ms째에 있던 것이 `onComposerBlur`의 150ms짜리 `setFocused(false)`
     * 였다(`onComposerBlur` 주석). **올라갈 때는 같은 다시 그리기가
     * `onComposerFocus`에서 키보드가 움직이기 **전에** 끝나 공짜다** —
     * 그것이 한쪽만 거칠던 까닭이다.
     */
    const kbMoving = useRef(false);

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
            /* **여기서 걸린 시간이 진단의 핵심이다**(`kbWork` · `kbLog` 주석).
               이 블록은 키보드가 내려가기 **시작하는 바로 그 프레임**에 도는데,
               뿌리 클래스를 떼어 문서 전체 스타일을 다시 셈하게 하고
               `settleList()`가 `scrollHeight`를 읽어 배치까지 그 자리에서
               끝낸다. 올라갈 때는 같은 일이 `kbHint`로 **미리** 끝나 있어
               공짜다 — 지금까지 찾은 유일한 비대칭이 이것이라, 값이 실리는지
               보고 고칠 자리가 있는지 가린다. */
            const t0 = performance.now();
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
            kbWork(performance.now() - t0);
        };

        paint();
        /**
         * **키보드가 떠 있는 채로 창이 줄어들면 그 높이를 그대로 적는다**
         * (`trueUp` — 사용자 제보: 천지인에서 쿼티로 바꾸니 키보드 높이가
         * 달라지며 목록 아래에 밝은 띠가 남았다). 그때 iOS는 `keyboardWillShow`를
         * 시간 0으로 다시 던지는데, 바의 따라가기는 0.05초 만에 끝나고 바가
         * 옮겨 앉는 것은 그 뒤라 **`--chat-h`가 옛 키보드 높이에 굳었다.**
         * 앱은 16판부터 옮긴 자리를 다시 알리지만, 옛 앱을 든 폰은 웹만
         * 밀어서 고쳐야 한다 — `resize: 'native'`라 **키보드가 떠 있으면
         * 창(`clientHeight`)의 아랫변이 곧 키보드 윗변 = 바 아랫변**이니
         * 웹이 스스로 아는 값이다(`trueDown`과 같은 결). 움직이는 동안과
         * 키보드가 없을 때(창이 원래 높이)는 손대지 않는다 — 내려갈 때
         * 플러그인이 창을 먼저 늘리는데 거기서 적으면 툭 뛴다.
         */
        const trueUp = () => {
            if (!owns() || kbMoving.current) return;
            if (!document.body.classList.contains('kb-open')) return;
            const h = root.clientHeight;
            if (h > 0 && h < base - 40) root.style.setProperty('--chat-h', `${h}px`);
        };
        const onResize = () => { paint(); trueUp(); };
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
                    /* **다 내려간 뒤의 높이는 웹이 스스로 안다**(`trueDown`).
                       앱이 보낸 끝값이 어디선가 어긋나도 여기서 제자리로
                       온다 — 키보드를 내렸는데 화면이 옛 크기로 굳던 자리다. */
                    trueDown();
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
        /**
         * **끝값을 적는다 — 갈래와 상관없이 이 한 곳이다.**
         *
         * 14판은 그림을 드는 동안 바가 **프레임마다 안 알린다**
         * (`ComposerBar.follow`를 안 켠다). 그래서 웹이 슬라이드 갈래를
         * 안 타면 **아무도 `--chat-h`를 안 적는 자리**가 생긴다 — 키보드를
         * 내렸는데 화면이 키보드 올라온 크기 그대로 굳어 그 아래가 통째로
         * 비었다(사용자 제보 · 사진). 값을 적는 것을 먼저 하고 갈래는
         * 그다음에 고르면 그 자리가 없어진다.
         */
        /** 위 `kbMoving`을 내려 줄 예비 타이머. */
        let moveEnd = 0;
        /**
         * **다 움직인 뒤 화면이 놓인 자리를 한 줄로 적는다**(진단 — `kbSnap`).
         *
         * 1.69 사진에서 키보드가 떠 있는데 **목록 아래·바 위에 밝은 띠**가
         * 남아 있었다. 그 띠가 누구 몫인지는 값을 봐야 갈린다 — `--chat-h`가
         * 키보드 윗변보다 작은지(`.chat`이 일찍 끝난다) · `--composer`가 바보다
         * 큰지(입력칸 여백이 남는다) · 창(`clientHeight`)이 아직 안 줄었는지.
         * 그래서 CSS 값 둘과 **실제로 그려진 자리** 셋(창·목록 아랫변·입력칸
         * 윗변/높이), 그리고 바가 마지막으로 보낸 자리(`frame`)를 함께 적는다.
         * `내 정보` 맨 아래 `↑끝`·`↓끝` 줄이 그것이다. **까닭이 가려지면 걷어낼 것.**
         */
        let lastFrame = { bottom: 0, h: 0, p: 0 };
        let snapAt = 0;
        const snap = (on: boolean, dur: number) => {
            clearTimeout(snapAt);
            snapAt = window.setTimeout(() => {
                const cs = getComputedStyle(root);
                const num = (v: string) => Math.round(parseFloat(v) || 0);
                const list = listRef.current;
                const chat = list?.closest<HTMLElement>('.chat') ?? null;
                const inp = barRef.current;
                const r = (el: HTMLElement | null) => el?.getBoundingClientRect();
                const c = r(chat), l = r(list), i = r(inp);
                kbSnap(on, [
                    `h${num(cs.getPropertyValue('--chat-h'))}`,
                    `c${num(cs.getPropertyValue('--composer'))}`,
                    `창${root.clientHeight}`,
                    `채${c ? Math.round(c.bottom) : '-'}`,
                    `목${l ? Math.round(l.bottom) : '-'}`,
                    `입${i ? `${Math.round(i.top)}+${Math.round(i.height)}` : '-'}`,
                    `바${Math.round(lastFrame.bottom)}/${Math.round(lastFrame.h)}`,
                    `p${Math.round(lastFrame.p * 100) / 100}`,
                    `s${num(cs.getPropertyValue('--safe-b'))}`,
                ].join(' '));
            }, Math.round((dur || 0.25) * 1000) + 400);
        };
        const writeKb = (e: KbSignal) => {
            if (e.chatH === undefined || e.pad === undefined) return;
            root.style.setProperty('--chat-anim', '0ms');
            root.style.setProperty('--chat-h', `${Math.round(e.chatH)}px`);
            root.style.setProperty('--composer', `${Math.round(e.pad)}px`);
            if (!kbFollow.current) {
                kbFollow.current = true;
                root.classList.add('kb-follow');
            }
        };
        /**
         * **다 움직인 뒤에 끝값을 한 번 더 적는다.**
         *
         * 그림을 드는 동안에는 프레임마다 오는 값이 없어, 그 사이에 다른
         * 값이 한 번이라도 끼어들면 **되돌릴 자리가 없다.** 폰에서만 갈리는
         * 자리라 되돌아오는 길을 코드에 두는 것이 맞다 — 어긋났으면 여기서
         * 제자리로 오고, 안 어긋났으면 같은 값이라 아무 일도 안 한다.
         */
        let fixAt: ReturnType<typeof setTimeout> | undefined;
        /**
         * **키보드가 내려가 있을 때의 화면 높이는 웹이 스스로 안다.**
         *
         * 앱은 `resize: 'native'`라 키보드가 없으면 **웹뷰가 곧 화면**이고,
         * 그 높이가 `documentElement.clientHeight`다. 그러니 그때만은 앱이
         * 보내 준 값을 기다릴 것 없이 여기서 바로 적으면 된다.
         *
         * **이 줄이 있는 까닭**(사용자 제보 · 사진 두 장) — 키보드를 올린
         * 화면은 멀쩡한데 내리면 대화 화면이 **키보드 올라온 크기 그대로
         * 굳어** 그 아래가 통째로 비었다. 앱이 보낸 끝값이 어느 길에서
         * 어긋났는지는 폰에서만 갈리는 자리라 여기서는 못 가리는데,
         * **내려간 뒤의 답은 웹이 이미 들고 있으므로** 무엇이 어긋났든
         * 제자리로 돌아온다. `--composer`는 안 건드린다 — 그쪽은 바가
         * 가리는 자리라 웹이 모르는 값이다(6판 주석).
         */
        const trueDown = () => {
            if (!owns()) return;
            const h = root.clientHeight;
            if (h > 0) root.style.setProperty('--chat-h', `${h}px`);
        };
        const reassure = (e: KbSignal, dur: number) => {
            clearTimeout(fixAt);
            fixAt = setTimeout(() => {
                writeKb(e);
                if (!e.on) trueDown();
                settleList();
            }, Math.round((dur || 0.25) * 1000) + 140);
        };
        const slideKb = (e: KbSignal) => {
            const el = listRef.current;
            const s = Math.round(e.s ?? 0);
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
            /* 오르내리는 한 판을 재기 시작한다(진단 — `kbLog` 주석).
               값은 `내 정보` 맨 아래 한 줄로 나온다. */
            kbMark(on, dur);
            snap(on, dur);
            /* 움직이는 동안에는 화면을 다시 그리지 않는다(`kbMoving` 주석).
               **예비 타이머를 함께 건다** — 그림을 드는 갈래(14판)에서는
               `frame`이 아예 안 와서 이 표가 안 내려간다. */
            kbMoving.current = true;
            clearTimeout(moveEnd);
            moveEnd = window.setTimeout(
                () => { kbMoving.current = false; }, Math.round((dur || 0.25) * 1000) + 160);
            /* **끝값은 그림을 드는 갈래에서만 적는다.** 한동안 여기(갈래를
               고르기 전)에서 적었는데, 그림을 안 드는 판에서는 바가
               프레임마다 자리를 알려 주므로(`follow`) **끝값을 먼저 적으면
               목록이 끝자리로 툭 뛰었다가 끌려 돌아온다** — 그것이 곧
               `위아래로 깜빡인다`였다(사용자 제보). 값을 적는 곳이 둘이
               되면 서로 엇갈린다는 6판의 그 자리다.
               14판 — 앱이 그림을 들고 움직인다고 하면 끝값을 한 번에 적는 길로.
               `slide`가 거짓이면(서랍·검색 중이라 웹이 꺼 두었거나, 그림을
               못 떴거나) 13판처럼 프레임마다 따라간다. */
            if (e?.slide && e.chatH !== undefined && e.pad !== undefined && canSlide()) {
                slideKb(e);
                reassure(e, dur);
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
            kbTick(e.end);   // 진단 — 신호가 얼마나 고르게 닿는가(`kbLog` 주석)
            lastFrame = { bottom: e.bottom, h: e.h, p: e.p };
            if (e.end) { kbMoving.current = false; clearTimeout(moveEnd); }
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
            clearTimeout(fixAt);
            clearTimeout(moveEnd);
            clearTimeout(snapAt);
            kbMoving.current = false;
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
     *
     * **그런데 그 '조금'이 하필 키보드가 내려가는 한가운데였다.**
     * 실기기 진단(1.68)에서 내려가는 길에만 한 프레임이 통째로 비었는데
     * (`↓ 27칸·최대 34ms@201`) 그 **201ms째**가 바로 이 150ms 타이머가
     * `setFocused(false)`로 화면을 다시 그리던 자리다. 말풍선은 `memo`라
     * 다시 안 그려져도 화면 전체를 한 번 맞춰 보는 값이 폰에서는 그만큼 든다.
     * **올라갈 때는 같은 다시 그리기가 `onComposerFocus`에서 키보드가
     * 움직이기 전에 끝나 공짜다** — 그것이 한쪽만 거칠던 까닭이었다.
     * (앞서 짚었던 둘은 숫자로 갈렸다 — `정리`가 8ms라 우리 `hide()`가
     * 아니었고, 벌어진 자리가 `@201`이라 시작 순간의 웹뷰 되늘리기도 아니다.)
     *
     * 그래서 **키보드가 다 내려간 뒤에 접는다**(`kbMoving`). 기다리는 동안
     * 달라 보이는 것은 없다 — 안내 글씨와 보내기 단추가 0.3초쯤 늦게
     * 제자리로 갈 뿐이고, 그동안 키보드는 아직 화면에 있다.
     * **못 기다리는 판에도 길을 남긴다**(`WAIT_MAX`) — 신호가 안 오는
     * 판에서 영영 안 접히면 안 된다.
     */
    const onComposerBlur = () => {
        clearTimeout(blurTimer.current);
        // **붙박기는 곧바로 푼다.** 키보드는 0.25초쯤 미끄러져 내려가는데,
        // 그동안 보이는 높이가 333에서 707로 조금씩 커진다. 붙박아 둔 채로
        // 두면 그 끝에서 화면이 한 번에 툭 늘어나 뚝뚝 끊겨 보인다.
        // 풀어 두면 매 단계 따라 늘어나 카톡처럼 함께 내려간다.
        kbRef.current.locked = false;
        const WAIT_MAX = 900;
        const from = Date.now();
        const fold = () => {
            if (kbMoving.current && Date.now() - from < WAIT_MAX) {
                blurTimer.current = window.setTimeout(fold, 60);
                return;
            }
            kbRef.current.typing = false;
            setFocused(false);
            stick.current = null;
            setMention(null);
            setCalled([]);
            applyKeyboard(true);
        };
        blurTimer.current = window.setTimeout(fold, 150);
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

    /**
     * **읽던 자리를 적어 둔다**(위 `SPOTS`).
     *
     * **굴리는 동안이 아니라 멎고 나서 한 번** 잰다 — 굴릴 때마다 줄 자리를
     * 재면 긴 대화에서 그대로 끊긴다(그림 자리를 재서 미리 받던 것이
     * 되레 나빠진 그 자리다).
     *
     * **다만 기다리던 것이 남아 있으면 떠나면서 한 번 잰다**(사용자 제보 —
     * 고쳐 놓고도 `최근대화로 넘어와`가 그대로였다). 카드를 눌러 들어가는
     * 사람은 **굴려서 그 카드를 찾자마자 누르므로**, 마지막 굴리기 신호와
     * 누름 사이가 150ms보다 짧으면 기다리던 것이 뒷정리에 지워져
     * **한 번도 안 적힌 채로 나갔다.** 헤드리스로 재서 잡은 자리다
     * (누르기 전 400ms 기다리면 그대로, 40ms면 맨 아래로 끌려간다).
     * 리액트는 뒷정리를 **DOM을 걷기 전에** 돌리므로 그 자리에서 재도 값이
     * 맞는다 — 기다리던 것이 없으면 이미 적어 둔 것이라 아무 일도 안 한다.
     */
    const spotTimer = useRef(0);
    const saveSpot = () => {
        const el = listRef.current;
        if (!roomId || !el) return;
        /* **맨 아래를 보고 있었으면 지운다** — 되돌려 놓을 자리가 '맨 아래'인데,
           글 id로 못박아 두면 그 사이 온 새 글을 안 따라간다. */
        const 적을것 = stampSpot(atBottom.current ? null : webSpot(el), msgsRef.current);
        keepSpot(roomId, 적을것);
    };
    const spotSoon = () => {
        if (spotTimer.current) return;
        spotTimer.current = window.setTimeout(() => {
            spotTimer.current = 0;
            saveSpot();
        }, SPOT_WAIT);
    };
    /* 뒷정리는 화면이 만들어질 때 한 번만 걸리므로 **그때의 `saveSpot`을
       들고 있으면 옛 `roomId`를 본다** — 늘 마지막 것을 부른다. */
    const saveNow = useRef(saveSpot);
    saveNow.current = saveSpot;
    /* **`useEffect`가 아니라 `useLayoutEffect`다.** 화면을 걷을 때 보통
       효과의 뒷정리는 **DOM을 지운 뒤에** 돌아 `listRef`가 이미 비어 있다
       (그래서 고쳐 놓고도 그대로였다). 배치 효과의 뒷정리만 지우기
       전에 돈다. */
    /** 나갈 때 들고 갈 값. 뒷정리는 한 번만 걸리므로 마지막 것을 본다. */
    const keepNow = useRef<() => void>(() => {});
    keepNow.current = () => {
        if (!keptKey) return;
        /* 검색으로 옛 글에 가 있으면 안 들고 간다 — 그 목록은 '지금'이
           아니라 찾은 글 언저리라, 다음에 그 뒤로 오늘 글을 붙이면 안 된다. */
        if (windowedRef.current) { keepList(keptKey, null); return; }
        /* **줄이 없으면 들고 있던 것을 지우지 않는다.** 첫 묶음이 오기 전에
           나가면(또는 리액트가 뒷정리를 한 번 더 돌리면 — 개발 모드의
           `StrictMode`가 그렇다) 빈 목록으로 덮어써 **다음에 들어올 때
           깜빡임이 그대로 돌아온다.** 실제로 그렇게 났다. */
        if (!msgsRef.current.length) return;
        keepList(keptKey, { list: msgsRef.current, more: hasMore });
    };
    useLayoutEffect(() => () => {
        keepNow.current();
        if (!spotTimer.current) return;      // 이미 적어 둔 것이다.
        clearTimeout(spotTimer.current);
        spotTimer.current = 0;
        saveNow.current();
    }, []);

    const onScroll = () => {
        const el = listRef.current;
        if (!el) return;
        spotSoon();
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

    /* 내려갈 글이 하나라도 있을 때만 단추를 낸다(아래 JSX). */
    const lastMsg = messages.length ? messages[messages.length - 1] : undefined;

    /* ── 축하 폭죽 ──────────────────────────────────────────────
       `축하`·`추카`·`ㅊㅋ`가 오가면 입력칸 위에 단추가 뜨고, 누르면 화면에
       폭죽이 터진다(사용자 요청 — 카톡의 그것).

       **들어올 때는 안 뜬다.** 첫 판에서는 자리만 적어 두고 돌아선다 —
       안 그러면 방을 열 때마다 **지난달 축하로** 단추가 떠서, 정작 오늘
       축하할 때와 구별이 안 된다.
       **시각으로 가린다**(`created_at`). 실시간으로 들어온 글이든 내가
       방금 보낸 임시 줄이든 시각이 지금이라 같은 길을 탄다 — 갈래를
       나누면 한쪽만 고치게 된다.
       **마지막 한 줄만 보지 않는다.** `축하!` 뒤에 `ㅋㅋ`가 바로 붙으면
       그 한 줄에 밀려 단추가 아예 안 뜬다. */
    const [cheer, setCheer] = useState(false);
    const [burst, setBurst] = useState(false);
    const cheerMark = useRef('');

    useEffect(() => {
        if (!messages.length) return;
        const mark = cheerMark.current;
        cheerMark.current = messages[messages.length - 1].created_at;
        if (!mark) return;                       // 들어온 첫 판
        const now = Date.now();
        const hit = messages.some(m =>
            m.created_at > mark && isCheer(m.body)
            && now - new Date(m.created_at).getTime() < CHEER_MS);
        if (hit) setCheer(true);
    }, [messages]);

    /* **영영 두지 않는다.** 축하는 그 자리에서 하는 것이라, 한참 뒤에 눌러
       봐야 무엇을 축하하는지 알 수가 없다(`CHEER_MS`). 새 축하가 오면
       `cheer`가 이미 참이라 이 효과는 안 다시 돈다 — 그때는 남은 시간이
       그대로 이어지는데, 방금 또 축하했다는 뜻이라 되레 맞다. */
    useEffect(() => {
        if (!cheer) return;
        const t = window.setTimeout(() => setCheer(false), CHEER_MS);
        return () => window.clearTimeout(t);
    }, [cheer]);

    /** 폭죽이 다 터졌다. **`useCallback`이다** — `Fireworks`의 효과가
     *  이 값을 보고 있어, 매번 새로 만들면 도중에 다시 시작한다. */
    const burstDone = useCallback(() => setBurst(false), []);

    /** 최근 대화로 한 번에 내려간다. **부드럽게 굴리지 않는다** — 300개까지
     *  받아 둔 목록을 훑어 내려가는 일이라 느린 폰에서 그대로 끊긴다. */
    const jumpToLatest = useCallback(() => {
        atBottom.current = true;
        jumpShown.current = false;
        setShowJump(false);
        const el = listRef.current;
        if (!el) return;
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
        stick.current = null;
        setMention(null);
        setCalled([]);
    };

    /**
     * 방금 고르고 난 커서 자리.
     *
     * **여럿을 이어 고르려고 둔 표다**(앱의 길이 0짜리 `mentionRange`와
     * 같은 몫이다). 고르고 나면 글이 `@이름 `으로 바뀌어 `mentionQuery`가
     * 더는 `@`를 못 찾으므로, 그것만 믿으면 한 사람을 고르는 순간 목록이
     * 닫힌다. 커서가 이 자리에 그대로 있는 동안에는 목록을 남겨 둔다 —
     * **글자를 한 자 치거나 커서를 옮기면 저절로 닫힌다.**
     */
    const stick = useRef<number | null>(null);

    /** 글에 이미 들어간 이름들. **자르는 규칙은 말풍선과 같은 것을 쓴다** —
     *  `김지`와 `김지명`이 함께 있으면 긴 쪽이 걸려야 한다. */
    const calledIn = useCallback((value: string) => splitMentions(value, mentionNames, isAdmin)
        .map(p => p.name).filter((n): n is string => !!n), [mentionNames, isAdmin]);

    /** 달라졌을 때만 갈아 끼운다 — 글자를 칠 때 헛되이 다시 그리지 않으려는 것이다. */
    const markCalled = useCallback((names: string[]) => setCalled(prev =>
        (prev.length === names.length && prev.every((n, i) => n === names[i])) ? prev : names), []);

    /**
     * 캐럿 앞에 `@무엇`을 치고 있는지 본다.
     *
     * 입력칸이 값의 주인이라(uncontrolled) 칸에서 직접 읽는다. 글자를 칠
     * 때뿐 아니라 **캐럿만 옮겨도** 다시 봐야 해서 `onSelect`에서도 부른다.
     */
    const syncMention = useCallback(() => {
        const value = draftValue();
        const caret = draftCaret();
        const found = mentionQuery(value, caret);
        if (found) stick.current = null;
        // 방금 고른 자리에 커서가 그대로면 목록을 닫지 않는다(빈 글자 = 전원).
        const q = found ? found.q : (stick.current === caret ? '' : null);
        if (q === null) stick.current = null;
        setMention(q);
        markCalled(q === null ? [] : calledIn(value));
    }, [draftValue, draftCaret, calledIn, markCalled]);

    /**
     * 언급 목록에서 고른 사람을 `@이름 `으로 끼워 넣는다.
     *
     * **이미 부른 사람을 다시 누르면 뺀다**(사용자 요청 — `선택했던 사람을
     * 다시 누르게 되면 또 선택되는 게 아니고 선택 해제 될수 있게`).
     * 넣든 빼든 **목록은 그대로 남는다** — 여럿을 이어 고르는 자리라,
     * 한 번 누를 때마다 닫히면 `@`를 매번 다시 쳐야 한다.
     */
    const insertMention = (name: string) => {
        const value = draftValue();
        const caret = draftCaret();
        const found = mentionQuery(value, caret);
        /* 고른 직후에는 `@`가 이미 이름으로 바뀌어 있다 — 그때는 커서
           자리에 이어 붙인다(앱의 길이 0짜리 `mentionRange`와 같다). */
        const at = found ? found.at : (stick.current === caret ? caret : -1);
        if (at < 0) return;

        /* 빼기 — 그 이름 조각 하나와 뒤에 붙은 공백 하나만 걷어낸다.
           조각은 말풍선과 같은 규칙으로 잘라 놓은 것이라, 이름이 다른
           이름 안에 들어 있어도 엉뚱한 자리를 안 건드린다. */
        if (called.includes(name)) {
            let hs = -1, he = -1, pos = 0;
            for (const piece of splitMentions(value, mentionNames, isAdmin)) {
                if (hs < 0 && piece.name === name) { hs = pos; he = pos + piece.text.length; }
                pos += piece.text.length;
            }
            if (hs >= 0) {
                if (value[he] === ' ') he += 1;
                /* **치던 `@…` 조각도 함께 걷는다** — 안 걷으면 `@김`이
                   덩그러니 남아 그대로 보내진다(겹칠 때는 한 번만 자른다). */
                const cuts = [[hs, he]];
                if (found && (found.at >= he || caret <= hs)) cuts.push([found.at, caret]);
                let out = value;
                for (const [s, e] of [...cuts].sort((x, y) => y[0] - x[0])) {
                    out = out.slice(0, s) + out.slice(e);
                }
                const back = found && hs < found.at ? he - hs : 0;
                const cut = found ? found.at - back : hs;
                /* **표를 먼저 세우고 글을 쓴다** — 칸에 커서를 놓으면
                   `select`가 날아와 `syncMention`이 도는데, 그때 표가
                   아직 없으면 목록을 닫아 버린다. */
                stick.current = cut;
                setDraft(out, cut);
                setMention('');
                markCalled(calledIn(out));
                growDraft();
                focusDraft();
                return;
            }
        }

        const head = value.slice(0, at) + `@${name} `;
        const next = head + value.slice(caret);
        stick.current = head.length;          // 위와 같은 까닭으로 먼저 세운다.
        setDraft(next, head.length);
        setMention('');
        markCalled(calledIn(next));
        growDraft();
        // 고르고 나서도 키보드가 그대로 있어야 이어 칠 수 있다.
        focusDraft();
    };

    /* 목록. 운영진에게는 **맨 위에 `전체`**를 얹는다 — 서른 명에게 한
       번에 알릴 일(모집 마감·집합 시각 바뀜)이 운영진 몫이라 제일 자주
       고를 것이 그것이다. */
    const norm = (s2: string) => s2.replace(/\s/g, '');
    /* **보이는 것은 이름표, 넣는 것은 닉네임이다**(사용자 요청 — `언급했을때
       나오는 닉네임이 다르게나와. 회원목록에있는거처럼 해줘`). 100명 모임에서
       `@악마제리`만 봐서는 누군지 모르기 때문이고, 그래서 회원 명단·서랍과
       같은 `83/악마제리/광산구`를 적는다. **글에 들어가는 것은 그대로
       닉네임이다** — 발송기의 `mentionedIds`가 글에서 `@<닉네임>`을 찾아
       누구를 부른 것인지 가리므로, 이름표를 넣으면 부르긴 했는데 알림이
       안 가는 글이 된다. **앱 목록(`MentionList.Item`)과 같은 규칙이니
       한쪽만 고치지 말 것.** 찾는 글자도 이름표로 거른다.
       **이미 부른 사람은 그 줄에 체크가 붙는다**(`on`) — 여럿을 이어 고르는
       자리라 누구를 이미 불렀는지 목록만 봐서는 알 수 없다. */
    const mentionHits = mention === null ? [] : [
        ...(isAdmin && norm(ALL_MENTION).includes(norm(mention))
            ? [{ id: '__all__', name: ALL_MENTION, label: ALL_MENTION, avatar_url: null,
                gender: null as Gender | null, all: true }] : []),
        ...mentionable
            .map(p => ({ id: p.id, name: p.name, label: personLabel(p) || p.name,
                         avatar_url: p.avatar_url, gender: p.gender ?? null, all: false }))
            .filter(p => p.id !== me && norm(p.label).includes(norm(mention))),
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
     * 복사·선택 복사·댓글·공유에 운영진의 가리기, 쓴 사람의 삭제까지
     * 붙는다. 바로 확인창을 띄우면 그중 하나를 고를 자리가 없다.
     *
     * **`at`은 누른 말풍선의 자리다**(사용자 요청 — `누른 자리에서 나오도록`).
     * 예전에는 화면 아래에서 올라왔는데, 그러면 **어느 글을 누른 것인지
     * 창만 봐서는 몰라서** 미리보기 머리말을 한 줄 얹어야 했다. 말풍선 옆에
     * 뜨면 그 줄이 통째로 필요 없어진다(카톡도 머리말이 없다).
     * `mine`은 어느 쪽에 붙일지다 — 내 글은 오른쪽, 남의 글은 왼쪽.
     */
    const [menuFor, setMenuFor] = useState<
        { m: Message; at: DOMRect; mine: boolean; native?: boolean } | null
    >(null);
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
                ? <>모두에게 <b>{HIDDEN_LINE}</b>로 보입니다.
                   지우는 것이 아니라 덮어 두는 것이라 언제든 다시 풀 수 있습니다.</>
                : '가렸던 내용이 모두에게 다시 보입니다.',
            /* **꾸민 글은 앱 확인창에 못 넘긴다** — 같은 말을 글자로만 한
               번 더 적어 둔다(`components/Confirm.tsx`). 안 적어 두면 이
               창만 웹으로 뜨고, 그러면 앱 목록 바꿔치기가 그대로 돌아와
               대화가 맨 아래로 툭 내려간다(30판이 없앤 그 자국이다). */
            detailText: on
                ? `모두에게 ‘${HIDDEN_LINE}’로 보입니다. 지우는 것이 아니라 덮어 두는 것이라 언제든 다시 풀 수 있습니다.`
                : undefined,
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
    /* **앱이 그린 창은 여기 안 든다**(27판의 `native`). 그 창은 우리가
       `root`에 얹은 앱 부품이라 바와 목록을 제가 덮는다 — 감췄다가는
       입력칸 자리에 **흰 웹 글칸이 드러나고**, 목록까지 감추면 없애려던
       그 바꿔치기가 그대로 돌아온다.

       **확인창(`Confirm`)도 여기 든다**(`useConfirmUp`). 그것도 웹이 그리는
       창이라 앱 목록 뒤에 통째로 깔려, `가리기`·`삭제`가 **눌러도 아무 일이
       없는 것처럼** 보였다(사용자 제보 — `가리기가 안되네`). 어디서 뜨든
       같은 자리이므로 창마다 챙기지 않고 **떠 있다는 사실 하나로** 받는다. */
    const confirmUp = useConfirmUp();
    const overlayUp = confirmUp
        || !!zoom || !!card || pickText !== null || !!(menuFor && !menuFor.native);
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

    /**
     * 프로필에서 `@언급하기`를 누르면 입력칸에 `@이름 `을 넣고 자판을 올린다.
     *
     * **감춘 네이티브 바는 초점을 못 받는다 — 그래서 내보내는 일을 여기서
     * 먼저 한다**(사용자 제보 — `@언급 안됨`). 전체화면 프로필이 떠 있는
     * 동안 `overlayUp`이 바를 감춰 두는데, `setCard(null)`은 state라 그
     * 효과가 **이 함수가 끝난 뒤에야** 돌아 `hidden: false`가 늦게 간다.
     * 그러면 글자는 들어가는데 자판이 안 올라와 **아무 일도 안 한 것처럼
     * 보인다.** 내보내는 것과 초점을 `setState` 한 번에 실어 보내면 앱이
     * `apply` → `grabFocus` 차례를 지켜 준다(댓글 바가 쓰는 그 길이다).
     */
    const mentionFromCard = (p: Person) => {
        setCard(null);
        setPeopleOn(false);
        const was = draftValue();
        const head = was && !was.endsWith(' ') ? `${was} ` : was;
        setDraft(`${head}@${p.name} `);
        if (ncOn.current && ncLog.v >= 7) {
            void hush(NativeComposer.setState({ hidden: false, focus: true }));
        } else {
            focusDraft();
        }
        growDraft();
    };

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
        /* **앱에서는 앱이 띄운다**(28판). 웹의 `navigator.share`는 *누른 그
           손짓 안에서만* 열리는데, 27판부터 창이 앱 것이라 고른 값이 다리를
           건너와 그 손짓이 없다 — 그래서 **눌러도 아무 일이 없었다.** */
        if (canNativeShare()) {
            if (await shareNativeText(text, url)) return;
        } else if (await shareText(text, url)) return;
        copyText(url ? `${text}\n${url}` : text);
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
        const video = file.type.startsWith('video/');
        if (!video && !file.type.startsWith('image/')) {
            toast('사진과 동영상만 올릴 수 있습니다.', 'error');
            return;
        }
        /* **너무 크면 여기서 잡는다** — 그냥 보내면 통이 막아 세우는데,
           그 오류는 사람 말이 아니고 그때는 이미 한참을 기다린 뒤다. */
        if (file.size > UPLOAD_LIMIT) {
            toast(`${video ? '동영상' : '사진'}이 너무 큽니다(${Math.round(file.size / 1024 / 1024)}MB).`
                + ' 50MB까지 올릴 수 있습니다.', 'error');
            return;
        }
        /* **줄이지 않는다 — 원본 그대로 올린다**(사용자 요청). 예전에는
           여기서 `shrinkImage`로 긴 변 2560px·82%로 구웠다. */
        await sendPhoto(file, extOf(file), file.type || 'image/jpeg');
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
     * 사진·동영상 한 개를 올려 보낸다. 웹 칸과 앱이 같이 쓴다.
     *
     * **원본 그대로 올린다**(사용자 요청 — `사진과 동영상을 원본으로
     * 올릴수있게해주고`). 예전에는 여기서 한 번 더 줄였는데, 그 줄은
     * **옛 앱이 큰 사진을 줄 때를 메우려던 것**이라 이제 할 일이 없다.
     *
     * **끝(`ext`)이 곧 갈래다** — 받는 쪽은 주소 끝을 보고 사진인지
     * 동영상인지 가른다(`lib/media.ts`). 빼먹으면 동영상이 사진으로
     * 그려져 깨진 그림이 된다.
     */
    const sendPhoto = async (raw: Blob, ext = 'jpg', type = 'image/jpeg') => {
        if (!roomId) return;
        setUploading(true);
        try {
            const path = `${roomId}/${crypto.randomUUID()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from('chat-photos')
                .upload(path, raw, { contentType: type, cacheControl: '31536000' });
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

    /**
     * 길게 누른 창에 설 줄 목록 — **웹 창과 앱 창이 같이 쓴다**(27판).
     *
     * **누구에게 무엇이 붙는지가 이 창의 규칙 전부다** — 앞 다섯(복사 ·
     * 선택 복사 · 댓글 · 공유)은 누구나, `가리기`는
     * **운영진**(사용자 요청 — `가리기는 운영진만 할수있도록`), `삭제`는
     * **쓴 사람**(제 글에만)이다. 가린 글에는 복사·선택 복사·댓글과 반응
     * 알약을 안 붙인다 — 덮어 둔 내용이 그리로 샌다.
     *
     * **차례는 사용자가 정해 준 그대로다.** 바꾸지 말 것.
     *
     * 27판부터 **창을 앱이 그리므로**(`listMenu`) 이 목록을 실어 보낸다 —
     * 앱에서 다시 셈하면 같은 규칙이 두 곳이 되어 언젠가 어긋난다.
     * 웹으로 열었을 때와 옛 앱에서는 아래 JSX가 같은 목록으로 그린다.
     */
    const holdItems = (m: Message): HoldItem[] => {
        const hidden = !!m.hidden_at;
        const hasText = !!m.body.trim();
        const out: HoldItem[] = [];
        /* **복사가 맨 위다** — 가장 자주 누르는 자리이면서 아무것도 안
           바꾸는 일이다. 글이 없는 글(사진·이모티콘만)에는 안 붙인다. */
        if (hasText && !hidden) out.push({ name: 'copy', label: '복사', icon: 'copy' });
        /* **선택 복사** — 말풍선에는 `user-select: none`이 걸려 있어 글의
           일부만 가져갈 길이 아예 없다. 그 손해를 되돌리는 자리다. */
        if (hasText && !hidden) out.push({ name: 'pick', label: '선택 복사', icon: 'pick' });
        /* **`댓글`은 왼쪽으로 밀면 걸리는 그 답장과 같은 일이다**(사용자가
           정한 이름이다 — `댓글이 답장기능과 같은거고`). */
        if (!hidden) out.push({ name: 'reply', label: '댓글', icon: 'reply' });
        out.push({ name: 'share', label: '공유', icon: 'share' });
        if (isAdmin) {
            out.push({ name: 'hide', label: hidden ? '가리기 풀기' : '가리기', icon: 'hide' });
        }
        /* **삭제는 쓴 사람 몫이다.** 되돌릴 수 없는 일이라 남의 글에는
           안 붙인다 — 운영진에게는 가리기가 있다. */
        if (m.user_id === me) {
            out.push({ name: 'trash', label: '삭제', icon: 'trash', danger: true });
        }
        return out;
    };

    /** 창에서 줄 하나를 골랐다. **웹 창과 앱 창이 같이 쓰는 한 곳이다.** */
    const runHoldItem = (m: Message, name: string) => {
        switch (name) {
            case 'copy': copyText(m.body); break;
            case 'pick': setPickText(m.body); break;
            case 'reply': startReply(m); break;
            case 'share': void shareMessage(m); break;
            case 'hide': void askHide(m); break;
            case 'trash': void askDelete(m); break;
        }
    };

    /** 바가 알려 올 때 부를 것들. **늘 최신 함수를 가리키게 해 둔다** —
        붙이는 일은 화면이 열릴 때 한 번뿐이라, 그때의 함수를 그대로 들고
        있으면 옛 값을 보고 돈다. */
    const nc = useRef({
        send, toggleTray, onComposerFocus, onComposerBlur, syncMention, markText,
        photo, toggleReact,
    });
    useEffect(() => {
        nc.current = {
            send, toggleTray, onComposerFocus, onComposerBlur, syncMention, markText,
            photo, toggleReact,
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

            /* **화면이 밀려 들어오는 동안에는 바를 안 세운다.**
               대화도 다른 화면처럼 **화면 폭만큼** 밀려 들어오는데(사용자
               요청 — `카톡처럼`), 바는 웹뷰 **위에 얹힌 앱 부품**이라
               `transform`을 안 따라온다 — 도중에 서면 **아직 미끄러지는
               화면 위에 입력칸만 제자리에 붙어 찢어져 보인다.**
               끝나고 세우면 그 틈이 아예 없다(`slideLeft()`는 안 움직이는
               참이면 0이라 평소에는 그냥 지나간다). */
            const left = slideLeft();
            if (left > 0) await new Promise(r => setTimeout(r, left + 40));
            if (dead) return;

            await hush(NativeComposer.attach(composerSkin({
                showIcon: STICKERS.length > 0,
                hintText: '메시지',
                /* **바 뒤에 판을 깔지 않는다 — 대화 바탕색 그대로다**
                   (사용자 요청 — `메시지입력하는 창 뒷배경을 카톡처럼
                   삭제해줘`). 웹 `.chat-input`과 **같은 값이라 한쪽만
                   고치지 말 것**: 글칸은 흰 알약(`--chat-bubble`),
                   위쪽 선은 없애고, `+`의 획만 흰색(`icon` — 44판)이다.
                   `fg`는 그대로 먹색이어야 한다(흰 알약 위의 글자다).
                   **댓글 바는 이 덮어쓰기를 안 받는다** — 거기는 밝은
                   화면 위에 서므로 `composerSkin()`의 기본값 그대로다. */
                ...chatBarSkin(),
                /* **키보드가 오르내릴 때 목록 그림을 앱이 들고 움직이게 한다**
                   (14판 · `slideKb` 주석). 목록이 시작하는 자리(`listTop`)는
                   아래 효과가 재서 알려 준다 — 여기서는 켜기만 한다. */
                slide: canSlide(),
                /* **대화방에는 탭바가 없다**(사용자 요청 — 위 머리말 주석).
                   바 아래에 그 자리를 비워 두면 입력칸이 그만큼 떠 보인다.
                   `composerSkin()`은 `--tabbar-h`를 **`documentElement`에서**
                   읽어 기억해 두므로(`skinCache`), `.chat` 안에서 그 값을
                   0으로 덮어도 여기까지는 안 온다 — 그래서 손으로 준다
                   (댓글 바가 `tabH: 0`을 주는 것과 같은 자리다). */
                tabH: 0,
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

    /* **`loading`만 보지 말 것 — 기억해 둔 것이 있으면 그걸 먼저 그린다.**
       `loading`은 다시 물어보는 동안 늘 참이라, 그것만 보면 나갔다 올 때마다
       **화면이 통째로 스피너로 0.4초** 지나간다(사용자 제보 — `되돌아가기하면
       … 화면이 깜빡이면서 나오는데`. 헤드리스로 프레임마다 재서 잡았다).
       다른 화면들이 처음부터 `loading && !data`로 두고 있던 그 잣대다. */
    if (loading && !data) return <div className="page center-fill"><div className="spinner" /></div>;
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

                **맨 왼쪽에 `←`가 있다**(사용자 요청 — `채팅에서 탭바없애고
                오른쪽에서 왼쪽으로 채팅화면이 나오고 뒤로가기처럼
                나올수있게해줘`). 한동안 안 두었는데 그때는 **대화가 탭이라
                뒤로 갈 데가 없었기 때문**이다 — 지금은 카톡의 대화방처럼
                들어갔다 나오는 화면이라(`lib/tabs.ts`의 `TAB_PATHS`에서
                `/chat`을 뺐다) 그 전제가 바뀌었다. **탭바도 여기서는
                감춰진다**(`TabBar`) — 나오는 길이 `←`와 미는 손짓 둘이다.

                단추 셋 다 흐름 안에 있다 — 제목이 `flex: 1`이라 자리를 뺏길
                일이 없어, 예전처럼 `position: absolute`로 띄울 이유가 없다. */}
            <div className="chat-head">
                {/* 찾는 동안에는 안 보인다 — 그 줄은 칸과 `취소`로 꽉 차고,
                    거기서 나가는 길은 `취소`다(카톡도 그렇다). */}
                {!searchOn && (
                    <button className="chat-back" onClick={goBack} aria-label="뒤로">
                        <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M15 5l-7 7 7 7" />
                        </svg>
                    </button>
                )}
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

            <div className="chat-list"
                 ref={listRef} onScroll={onScroll} onClick={onPhotoTap}>
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
                    /* 묶는 규칙은 `lib/chatlist.ts`에 있다 — **그리는 곳이
                       둘이 되었으므로**(웹 목록 · 앱 목록) 규칙까지 둘이 되면
                       언젠가 어긋난다. */
                    const newDay = isNewDay(prev, m);
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
                                                go="라운드 보러 가기 ›" icon="round"
                                                rest="chat-result-note" />
                                    : m.poll_id
                                        ? <LinkCard body={m.body} to={`/polls/${m.poll_id}`}
                                                    go="투표 보러 가기 ›" icon="poll"
                                                    rest="chat-result-win" />
                                        : m.post_id
                                            ? <LinkCard body={m.body} to={`/board/${m.post_id}`}
                                                        go="공지 보러 가기 ›" icon="post"
                                                        rest="chat-result-note" />
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
                <button className="chat-recent" onClick={backToRecent}
                        aria-label="최근 대화로" title="최근 대화로">
                    <ChevronDown />
                </button>
            )}

            {/* **맨 아래로 내려가는 화살표**(카톡에 있는 그것 — 사용자 요청).
                오랜만에 들어오면 `여기까지 읽으셨습니다` 줄에 내려놓으므로,
                밀린 글이 많은 날에는 최근 대화까지 한참을 굴려야 했다.
                `windowed`일 때는 안 띄운다 — 그때는 목록에 최근 대화가 아예
                없어 굴려도 소용이 없고, 바로 위 `.chat-recent`가 그 몫이다. */}
            {!windowed && showJump && lastMsg && (
                <button className="chat-jump" onClick={jumpToLatest}
                        aria-label="최근 대화로 이동" title="최근 대화로 이동">
                    <ChevronDown />
                </button>
            )}

            <div className="chat-input" ref={barRef}>
                {/* **바 줄 위에 쌓이는 것 셋을 한 칸에 묶는다**(`.chat-over`) —
                    이모티콘 미리보기 · 인용(답장) · 언급 목록.
                    묶은 까닭은 **그 뒤를 대화 바탕색으로 덮기 위해서다**
                    (사용자 요청 — `언급 기능 사용할 때 … 뒷면에 배경화면
                    같은 게 하나 있는데 그거 삭제해줘`). 셋 다 `.chat-input`의
                    밝은 칠 위에 떠 있어 둘레에 밝은 띠가 남았고, 그것이
                    목록 뒤에 판이 하나 더 깔린 것처럼 보였다.
                    **하나도 없으면 칸째 안 그린다** — 빈 보라 띠가 남는다. */}
                {(picked || replyTo || mentionHits.length > 0 || cheer) && (
                <div className="chat-over">
                {/* **축하 폭죽.** 누르면 그 자리에서 터지고 단추는 사라진다 —
                    **내 화면에서만** 터진다(남의 화면을 우리가 건드리지 않는다).
                    맨 위에 두는 것은 언급 목록·인용이 입력칸 가까이 붙어
                    있어야 하기 때문이다.
                    `onMouseDown`을 막아 키보드가 안 내려가게 한다 — 글을
                    치던 중에 누르는 자리라 보내기 단추와 같은 사정이다.
                    **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가
                    나온다(투표 결과 카드의 `🗳`에서 겪었다). */}
                {cheer && (
                    <button className="cheer-btn"
                            onClick={() => { setCheer(false); setBurst(true); }}
                            onMouseDown={e => e.preventDefault()}>
                        <CheerIcon />
                        축하 폭죽 터뜨리기
                    </button>
                )}
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
                        {mentionHits.map(p => {
                            const on = called.includes(p.name);
                            return (
                                <button key={p.id} aria-pressed={on}
                                        className={`mention-item${p.all ? ' is-all' : ''}${on ? ' on' : ''}`}
                                        onMouseDown={e => e.preventDefault()}
                                        onClick={() => insertMention(p.name)}>
                                    {p.all
                                        ? <span className="mention-all-icon" aria-hidden="true">📢</span>
                                        : <Avatar name={p.name} url={p.avatar_url} gender={p.gender} size="sm" />}
                                    <span className="truncate">{p.label}</span>
                                    {p.all && <span className="xs faint">모두에게 알림</span>}
                                    {on && <CheckMark />}
                                </button>
                            );
                        })}
                    </div>
                )}
                </div>
                )}

                {/* **`hidden`으로 두지 말 것.** iOS는 사진 고르는 창을
                    **이 칸이 있는 자리**에 붙이는데, `display: none`이면
                    자리가 없어 **화면 한가운데에 뜬다**(사용자 제보 · 사진).
                    `+` 옆에 1px로 숨겨 두면 거기서 올라온다. 눈에 안 보이고
                    눌리지도 않으므로 배치에는 아무 몫이 없다. */}
                <input
                    ref={fileRef} type="file" accept="image/*,video/*"
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
                                    <TrayImg id={s.id} />
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
                <PeopleList people={roomPeople} me={me} room={roomId}
                            onPick={openCard} onPhoto={setZoom}
                            onClose={() => setPeopleOn(false)} />
            )}

            {/* **프로필** — 얼굴을 누르거나 참여자 목록에서 고르면 **전체화면**으로
                뜬다(사용자 요청 — 카톡처럼). 아래로 내리면 사라진다.
                **여기에 전화번호·차량번호를 적지 말 것** — 그건 회원 명단
                하나에서 운영진에게만 보이기로 정해 둔 값이다. */}
            {card && (
                <ProfileFull
                    p={card}
                    /* **참석 횟수는 운영진에게만 보인다**(사용자 요청 · 회원
                       명단과 같은 규칙). 일반회원은 `attend`가 `null`이다. */
                    attend={attend ? (attend[card.id] ?? 0) : null}
                    /* **내 얼굴에는 `@언급하기`를 안 붙인다** — 나를 부를 일이 없다. */
                    onMention={card.id !== me && card.name
                        ? () => mentionFromCard(card) : undefined}
                    onClose={() => setCard(null)} />
            )}

            {menuFor && !menuFor.native && (() => {
                /* 창을 그리는 동안 `menuFor`가 바뀔 일은 없지만, 아래 콜백들이
                   전부 이 값을 붙들도록 한 번만 꺼내 둔다. */
                const m = menuFor.m;
                const shut = () => setMenuFor(null);
                /** 고르면 창부터 닫고 그 일을 한다 — 둘이 겹쳐 보이면 안 된다. */
                const pick = (go: () => void) => () => { shut(); go(); };
                const hidden = !!m.hidden_at;
                return (
                    <div className="chat-menu-back soft" onClick={shut}>
                        <HoldAt at={menuFor.at} mine={menuFor.mine}>
                            {/* **줄 목록은 `holdItems()`가 정한다 — 앱 창과
                                같이 쓰는 한 곳이다**(27판). 누구에게 무엇이
                                붙는지가 여기 한 벌로 있어야, 웹에서 보는 창과
                                앱에서 보는 창이 어긋날 자리가 없다.
                                **미리보기 머리말이 없다**(카톡과 같다) —
                                누른 말풍선 옆에 뜨므로 어느 글인지가 자리로
                                이미 말해진다. */}
                            <div className="chat-menu" onClick={e => e.stopPropagation()}>
                                {holdItems(m).map(it => (
                                    <button key={it.name}
                                            className={`chat-menu-item${it.danger ? ' danger' : ''}`}
                                            onClick={pick(() => runHoldItem(m, it.name))}>
                                        {it.label}<HoldIcon name={it.icon} />
                                    </button>
                                ))}
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

            {/* **축하 폭죽.** 화면 위에 얹히지만 `pointer-events: none`이라
                대화는 그대로 눌리고 굴러간다 — 덮는 창이 아니라 그림이다.
                그래서 네이티브 바를 감추는 `overlayUp` 목록에도 안 든다. */}
            {burst && <Fireworks onDone={burstDone} />}
        </div>
    );
}

/**
 * 폭죽 단추 앞의 그림.
 *
 * **그림글자(🎉)를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다
 * (투표 결과 카드의 `🗳`에서 겪었다). 터지는 불꽃을 선 몇 개로 그린 것이고
 * 색은 `currentColor`라 단추 글자색을 그대로 따라간다.
 */
function CheerIcon() {
    return (
        <svg className="cheer-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="2.2" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3
                     M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1
                     M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
        </svg>
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
/**
 * 아래쪽 꺾쇠 — `최근 대화로` 동그라미 둘이 같이 쓴다(`.chat-jump` ·
 * `.chat-recent`). **그림글자를 쓰지 말 것**: 기기에 없으면 네모난 두부가
 * 나온다(투표 결과 카드의 `🗳`에서 겪었다).
 */
/**
 * 체크 — 언급 목록에서 **이미 부른 사람** 줄에 붙는다(앱은 SF Symbol
 * `checkmark`이고 여기는 같은 모양의 선 SVG다).
 * **그림글자를 쓰지 말 것**: 기기에 없으면 네모난 두부가 나온다.
 */
function CheckMark() {
    return (
        <svg className="mention-check" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ChevronDown() {
    return (
        <svg className="chat-jump-go" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9l8 8 8-8" fill="none" stroke="currentColor" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ChatPhoto({ url, onLoad }: {
    url: string;
    /** 그림·동영상이 자리를 잡으면 알린다 — 목록이 밀린 만큼 메운다.
     *  **칸 종류를 안 가린다**(`HTMLElement`) — 재는 것은 `currentTarget`의
     *  자리뿐이라 `<img>`든 `<video>`든 같은 길을 탄다. */
    onLoad: (e: SyntheticEvent<HTMLElement>) => void;
}) {
    const [gone, setGone] = useState(false);
    if (gone) {
        return (
            <div className="chat-photo-gone">
                <span>저장 기간이<br />만료되었습니다</span>
            </div>
        );
    }
    /* **동영상은 그대로 화면 안에서 튼다**(사용자 요청으로 동영상이
       올라가게 되면서). 새 창으로 띄우지 말 것 — 홈 화면 앱에서는 그것이
       곧 사파리로 나가는 것이라 돌아올 길이 없다.
       `preload="metadata"`라 **목록을 훑기만 할 때는 첫 장면 몫만** 받는다. */
    if (isVideo(url)) {
        return (
            <video className="chat-image" src={url} controls playsInline preload="metadata"
                   onLoadedMetadata={onLoad}
                   onError={() => setGone(true)} />
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

/* ── 전체화면 프로필 ────────────────────────────────────────────
 *
 * 손가락을 얼마나 내리면 닫히는가. **튕김도 함께 본다** — 짧게 톡
 * 내리치는 손짓이 여기 안 닿으면 `안 닫히네` 하고 다시 끌게 된다.
 * 값은 뒤로 가기 손짓(`lib/tabs.ts`)과 같은 결로 골랐다.
 */
const SHEET_CLOSE = 120;     // 이만큼 내리면 닫는다
const SHEET_FLICK = 0.6;     // px/ms — 이보다 빠르면 거리가 짧아도 닫는다
/** 튕김으로 닫히는 최소 거리. **이보다 짧은 것은 손이 떨린 것으로 본다** —
 *  손끝이 조금만 미끄러져도 닫히면 사진을 들여다볼 수가 없다. */
const SHEET_FLICK_MIN = 40;
const SHEET_FADE = 420;      // 이만큼 내려가면 바탕이 다 걷힌다

/**
 * **전체화면 프로필**(사용자 요청 — `프로필 누르면 사진처럼 전체화면이
 * 나오고 뒤로가기처럼 아래로 내리면 사라지게해줘` · 카톡 사진을 받아 맞췄다).
 *
 * 예전에는 아래에서 올라오는 작은 카드(`.chat-card`)였다. 100명 모임에서
 * 얼굴을 누르는 까닭은 **`83/신성호/광산구`만 보고는 누군지 안 떠올라서**라,
 * 사진이 작게 뜨면 그 물음에 답이 안 된다. **되돌리지 말 것.**
 *
 * 규칙 다섯 — 넷은 이미 앱 안에 있던 것을 그대로 따른 것이다:
 * - **아래로 끌면 손가락을 따라온다**(뒤로 가기 손짓과 같은 결).
 *   `SHEET_CLOSE`를 넘기거나 튕기면 닫히고, 아니면 제자리로 돌아온다.
 *   **위로 끄는 것은 1/3만 따라간다** — 갈 데가 없으니 벽에 닿은 느낌만 준다.
 * - **자리를 state에 안 넣는다.** 손가락을 따라 매 프레임 다시 그리면
 *   느린 폰에서 그대로 끊긴다 — `PhotoZoom`·답장 밀기와 같은 자리라
 *   요소에 직접 적는다(`el.style.transform`).
 * - **`transform`과 `opacity`만 움직인다.** `filter`·`blur`은 안 쓴다.
 * - **분홍을 안 쓴다** — 이 화면에서 '지금 눌러야 할 것'은 보내기 단추
 *   하나다. 검은 바탕 위 흰 알약으로, 크게 본 사진의 단추와 같은 값이다.
 * - **`✕`는 왼쪽 위다**(카톡과 같다). 크게 본 사진의 `✕`는 오른쪽인데,
 *   그건 사진 위에 얹힌 것이고 이건 화면을 통째로 차지하는 창이다.
 *
 * **이 창도 `overlayUp`에 든다** — `card`가 곧 그 값이라 네이티브 바와
 * 앱 목록이 함께 감춰진다(웹의 `z-index`로는 앱 부품을 못 덮는다).
 */
function ProfileFull({ p, attend, onMention, onClose }: {
    p: Person;
    attend: number | null;
    onMention?: () => void;
    onClose: () => void;
}) {
    const backRef = useRef<HTMLDivElement | null>(null);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    /** 손짓 한 판. state로 두면 매 프레임 화면이 다시 그려진다. */
    const drag = useRef({ y0: 0, t0: 0, dy: 0, live: false, done: false });
    /* 사진을 못 받아 오면 글자로 되돌린다(`Avatar`의 `bad`와 같은 결 —
       참·거짓이 아니라 그 주소를 담는다). */
    const [bad, setBad] = useState<string | null>(null);

    const src = p.avatar_url ? httpsUrl(p.avatar_url) : null;
    const photo = src && src !== bad ? src : null;
    const label = (p.name || '').trim();

    /** 손끝을 따라 옮긴다. **읽지 않고 적기만 한다** — 배치를 다시 잡게 하면 끊긴다. */
    const paint = (dy: number, smooth = false) => {
        const s = sheetRef.current, b = backRef.current;
        if (s) {
            s.style.transition = smooth ? 'transform 0.18s ease-out' : 'none';
            s.style.transform = dy ? `translateY(${dy}px)` : '';
        }
        if (b) {
            b.style.transition = smooth ? 'opacity 0.18s ease-out' : 'none';
            b.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / SHEET_FADE));
        }
    };

    const start = (e: RTouchEvent) => {
        if (e.touches.length !== 1 || drag.current.done) return;
        drag.current = { y0: e.touches[0].clientY, t0: Date.now(), dy: 0, live: true, done: false };
    };
    const move = (e: RTouchEvent) => {
        const d = drag.current;
        if (!d.live || e.touches.length !== 1) return;
        const raw = e.touches[0].clientY - d.y0;
        /* 위로는 갈 데가 없다 — 1/3만 따라가 벽에 닿은 느낌만 준다. */
        d.dy = raw > 0 ? raw : raw / 3;
        paint(d.dy);
    };
    const end = () => {
        const d = drag.current;
        if (!d.live) return;
        d.live = false;
        const ms = Math.max(1, Date.now() - d.t0);
        const fast = d.dy / ms > SHEET_FLICK;
        if (d.dy > SHEET_CLOSE || (d.dy > SHEET_FLICK_MIN && fast)) {
            /* **닫는 동안에도 손짓을 안 받는다**(`done`) — 내려가는 중에 또
               잡으면 반쯤 내려간 자리에서 멈춘다. */
            d.done = true;
            paint(window.innerHeight, true);
            window.setTimeout(onClose, 170);
            return;
        }
        paint(0, true);
    };

    return (
        <div className="profile-full"
             onTouchStart={start} onTouchMove={move}
             onTouchEnd={end} onTouchCancel={end}>
            <div className="profile-full-back" ref={backRef} />
            <div className="profile-full-sheet" ref={sheetRef}>
                {photo
                    ? <img className="profile-full-photo" src={photo} alt={label}
                           onError={() => setBad(photo)} />
                    /* 사진이 없으면 얼굴에 쓰는 그 글자를 크게 놓는다
                       (`Avatar`와 같은 값 — 마지막 두 글자다). */
                    : <div className="profile-full-photo blank" aria-label={label}>
                          {label ? label.slice(-2) : '?'}
                      </div>}
                {/* 글자가 사진 위에서 읽히게 위아래만 어둡게 깐다. 사진이
                    어떤 것이 올지 모르므로 이 두 겹이 없으면 이름이 묻힌다. */}
                <div className="profile-full-scrim" aria-hidden="true" />
                <button className="profile-full-x" aria-label="닫기" onClick={onClose}>✕</button>
                <div className="profile-full-info">
                    <div className="profile-full-name">{personLabel(p)}</div>
                    <div className="profile-full-sub">
                        {ROLE_TAG[p.role] && (
                            <span className={`role-tag ${ROLE_TAG[p.role]}`}>
                                {ROLE_LABEL[p.role]}
                            </span>
                        )}
                        {attend !== null && <span className="profile-full-n">올해 {attend}회</span>}
                    </div>
                    {/* **남의 프로필에만 둘이 선다.** 내 얼굴에는 `@언급하기`가
                        없고(나를 부를 일이 없다) 나에게 선물할 일도 없다.
                        **`@언급하기`가 먼저다** — 이 화면에서 늘 하던 일이 그쪽이다. */}
                    {onMention && (
                        <div className="profile-full-acts">
                            <button className="profile-full-btn mention"
                                    onClick={onMention}>@언급하기</button>
                            {/* **우리가 선물을 보내는 것이 아니라 카카오 페이지를
                                여는 것뿐이다**(`GIFT_URL`의 설명 참고). 주소 하나를
                                여는 지름길이라 정산의 `토스로 보내기`와 같은 짜임이고,
                                **새 탭으로 연다** — 같은 창으로 나가면 홈 화면 앱에는
                                돌아올 길이 없다(대화 글 안의 주소와 같은 잣대다). */}
                            <a className="profile-full-btn gift" href={GIFT_URL}
                               target="_blank" rel="noreferrer">🎁 선물하기</a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
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
 * 참여자 목록의 차례 — **운영진이 맨 위, 그다음은 나이순**(사용자 요청).
 *
 * 세 묶음으로 나눈다. **`ROLE_TAG`가 붙는 사람이 위로 오는 것**이라
 * 이름표와 차례가 어긋나지 않는다:
 *   ① 운영진(앱관리자·운영자·부운영자 — DB의 `is_admin()`과 같은 잣대)
 *   ② 총무 — 운영진에는 안 들지만 직책이 있어 일반회원보다 위에 둔다
 *   ③ 일반회원
 *
 * **묶음 안에서는 연장자가 앞이다**(태어난 해가 이른 순) — 회원 명단의
 * `나이` 차례와 같은 규칙이고, **모르는 값은 늘 뒤로 보낸다**(`null`은
 * 0이 아니라 **아직 안 적음**이다).
 * **같은 값끼리는 이름순이다** — 안 그러면 다시 그릴 때마다 줄이 뒤바뀐다.
 *
 * **내보내지 말 것** — 화면 파일에서 함수를 내보내면 fast refresh가
 * 깨진다(`pollClosed`를 types.ts에 둔 것과 같은 이유다).
 */
function roomOrder(a: Person, b: Person): number {
    const tier = (r: Person['role']) =>
        r === 'superadmin' || r === 'admin' || r === 'staff' ? 0
            : r === 'treasurer' ? 1 : 2;
    return tier(a.role) - tier(b.role)
        || (a.birth_year ?? 9999) - (b.birth_year ?? 9999)
        || (a.name || '').localeCompare(b.name || '', 'ko');
}

/**
 * **직책은 글자가 아니라 얼굴에 붙는 작은 표다**(사용자 요청 — `운영진은
 * 글씨로 앱관리자 이렇게 표시하지말고 사진처럼 표시해줘` · 카톡 사진을
 * 받아 맞췄다). 예전에는 이름 뒤에 `앱관리자`라고 적었는데, 이름표가
 * 이미 `83/신성호/광산구`로 길어서 좁은 화면에서는 그 표가 줄을 밀어냈다.
 *
 * - **운영진 셋(앱관리자·운영자·부운영자)은 왕관이고 색만 다르다** —
 *   카톡이 방장·부방장에 왕관을 쓰는 그 자리다. 색은 **회원 명단의
 *   직책표(`ROLE_TAG` → `.role-*`)를 그대로 물려받는다**(`background:
 *   currentColor`) — 여기서 색을 새로 정하면 명단과 어긋난다.
 * - **총무는 왕관이 아니다** — 앱의 다른 모든 자리에서 총무는 운영진이
 *   아니므로(돈만 만진다) 지폐 표를 따로 그린다. **왕관을 주지 말 것.**
 * - **그림글자를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다
 *   (투표 결과 카드의 `🗳`에서 겪었다). `HoldIcons`와 같은 결의 SVG다.
 * - **색만으로 가르지 않는다** — 누르면 뜨는 프로필 카드가 직책을 글자로
 *   적고, 표 자체에도 `aria-label`·`title`로 그 이름을 달아 둔다
 *   (얼굴 테두리의 남녀 구분과 같은 잣대다).
 */
function RankMark({ role }: { role: Person['role'] }) {
    const tag = ROLE_TAG[role];
    if (!tag) return null;
    const 총무 = role === 'treasurer';
    return (
        <span className={`chat-rank ${tag}`}
              title={ROLE_LABEL[role]} aria-label={ROLE_LABEL[role]}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
                {총무
                    ? (/* `₩` — 돈을 맡는 자리. **획을 굵게 두고 가로줄은
                          하나만 긋는다** — 10px에서 두 줄은 뭉개진다. */ <>
                        <path d="M2.6 3.6L6 11.4L8 6.4L10 11.4L13.4 3.6"
                              fill="none" stroke="currentColor" strokeWidth="1.9"
                              strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M2.2 7.4H13.8" stroke="currentColor"
                              strokeWidth="1.7" strokeLinecap="round" />
                    </>)
                    : (/* 왕관 — 운영진 */
                        <path d="M2.2 12.4V5.0L5.6 8.2L8 3.4L10.4 8.2L13.8 5.0V12.4Z"
                              fill="currentColor" />)}
            </svg>
        </span>
    );
}

/** 서랍에 늘어놓을 사진 수. 그래서 머리말이 `사진`이 아니라 **`최근 사진`**이다. */
const SHOTS = 30;

/** 서랍의 사진 한 장. */
type Shot = { id: string; url: string; at: string };

/**
 * **서랍이 열릴 때 그 방의 사진만 따로 받아 온다**(카톡 서랍의
 * `사진/동영상` 자리다 · 사용자 요청 — `메뉴누르면 사진처럼 사진/동영상
 * 만들어줘`). 올린 사진을 되짚으려면 대화를 위로 계속 올리는 것 말고는
 * 길이 없었다 — 검색(🔍)은 글자만 찾는다.
 *
 * - **서랍을 열 때만 나가는 조회다.** 대화 화면이 늘 들고 있을 값이 아니고
 *   (통신량 규칙), 여는 일이 드물어 그때 한 번 물어보는 값이 싸다.
 * - **이모티콘은 서버에서 걸러 낸다**(`not.ilike.sticker:%`). 사진과 같은
 *   칸(`image_url`)을 쓰므로 그냥 받으면 **우리 대화방은 대부분이
 *   이모티콘**이라 서른 줄이 죄다 이모티콘으로 차 사진이 한 장도 안 남는다.
 *   **`like`가 아니라 `ilike`인 것은 흉내(`.dev/rest.mjs`) 때문이다** —
 *   거기 `like`가 없어 조건이 통째로 무시되면 **검사만 초록으로 뜬다.**
 *   id는 소문자 ASCII라 대소문자를 안 가려도 같은 값이다.
 * - **가린 글은 화면에서 거른다**(대화 검색과 같은 잣대). 덮어 둔 사진이
 *   여기로 새면 안 된다.
 * - **오류는 그냥 삼킨다**(반응·참석 횟수와 같은 결이다). `image_url`·
 *   `hidden_at` 칸이 아직 없는 저장소에서는 400이 나는데, 그걸 던지면
 *   서랍이 통째로 안 열린다 — 못 받으면 **이 묶음만 안 그린다.**
 */
function useShots(room: string | undefined) {
    const [shots, setShots] = useState<Shot[]>([]);
    useEffect(() => {
        if (!room) return;
        let alive = true;
        void (async () => {
            const { data, error } = await supabase
                .from('messages').select('id, image_url, hidden_at, created_at')
                .eq('room_id', room)
                .not('image_url', 'is', null)
                .not('image_url', 'ilike', 'sticker:%')
                .order('created_at', { ascending: false }).limit(SHOTS);
            if (!alive || error) return;
            setShots((data ?? [])
                .filter(m => !m.hidden_at && m.image_url)
                .map(m => ({ id: m.id, url: m.image_url as string, at: m.created_at })));
        })();
        return () => { alive = false; };
    }, [room]);
    return shots;
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
function PeopleList({ people, me, room, onPick, onPhoto, onClose }: {
    people: Person[];
    me: string;
    room: string | undefined;
    onPick: (p: Person) => void;
    onPhoto: (url: string) => void;
    onClose: () => void;
}) {
    /* 100명이면 훑을 수가 없으므로 **열둘을 넘으면 찾게 한다**
       (`FIND_AT` — 정산에서 사람 고를 때와 같은 잣대다). */
    const [find, setFind] = useState('');
    const q = find.trim();
    /* 차례는 고정이라 **한 번 세워 두고 거르기만 한다** — 글자를 칠 때마다
       다시 세우지 않으려는 것이다(차례가 고정이므로 거른 뒤에 세우는 것과
       결과가 같다). */
    const rows = useMemo(() => [...people].sort(roomOrder), [people]);
    /* **저장 기간(90일)이 지나 지워진 사진은 조용히 뺀다.** 주소는 글에
       그대로 남아 있어 목록에는 실려 오는데 그림만 404다 — 말풍선에서
       `사진 저장 기간이 만료되었습니다`로 바꿔 적는 그 자리이고, 여기서는
       네모난 빈칸이 되므로 아예 안 그린다.
       **참·거짓이 아니라 그 사진의 id를 담는다**(`Avatar`의 `bad`와 같은
       결이다) — 참·거짓으로 두면 한 장만 지워져도 줄이 통째로 사라진다. */
    const [gone, setGone] = useState<Set<string>>(() => new Set());
    const shots = useShots(room).filter(s => !gone.has(s.id));
    return (
        <div className="chat-people">
            {/* 방 이름은 바로 위 대화 머리말에 그대로 보이므로 여기서 또
                적지 않는다 — 이 줄에 남는 것은 나가는 길 하나뿐이다. */}
            <div className="chat-people-head">
                <button className="chat-search-x" onClick={onClose}>닫기</button>
            </div>
            {/* **최근 사진·동영상** — 카톡 서랍의 그 자리다.
                `최근`을 붙인 것은 마지막 `SHOTS`개만 보여 주기 때문이다
                (다 있는 것처럼 적으면 거짓말이 된다).
                한 장도 없으면 **묶음째 안 그린다** — 글만 오간 방에 빈
                칸이 덩그러니 남지 않게. */}
            {shots.length > 0 && (
                <section className="chat-shots">
                    <div className="chat-shots-h">최근 사진·동영상</div>
                    <div className="chat-shots-row">
                        {shots.map(s => (
                            <button key={s.id} className="chat-shot"
                                    aria-label={`${formatChatDay(s.at)} ${isVideo(s.url) ? '동영상' : '사진'}`}
                                    onClick={() => onPhoto(s.url)}>
                                {/* **동영상은 `<video>`로 건다** — 브라우저가
                                    첫 장면을 그려 주므로 따로 만들 것이 없고,
                                    `preload="metadata"`라 앞부분만 받는다. */}
                                {isVideo(s.url)
                                    ? <video src={s.url} preload="metadata" muted playsInline
                                             onError={() => setGone(g => new Set(g).add(s.id))} />
                                    : <img src={s.url} alt="" loading="lazy"
                                           onError={() => setGone(g => new Set(g).add(s.id))} />}
                            </button>
                        ))}
                    </div>
                </section>
            )}
            <div className="chat-people-n">참여자 {people.length}명</div>
            {people.length > FIND_AT && (
                <div className="chat-people-find">
                    <input className="chat-search-in" type="search" aria-label="참여자 찾기"
                           value={find} onChange={e => setFind(e.target.value)} />
                </div>
            )}
            {rows.filter(p => !q || (p.name ?? '').includes(q)).map(p => (
                <button key={p.id} className="chat-person" onClick={() => onPick(p)}>
                    {/* 얼굴과 직책 표를 한 덩어리로 묶는다 — 표가 얼굴
                        오른아래에 걸터앉아야 하므로 기준 칸이 필요하다. */}
                    <span className="chat-person-face">
                        <Avatar name={p.name} url={p.avatar_url} gender={p.gender} />
                        <RankMark role={p.role} />
                    </span>
                    {/* `나`는 이름 **앞**에 붙는 동그란 표다(카톡과 같다).
                        뒤에 두면 긴 이름표에 밀려 화면 밖으로 나간다. */}
                    <span className="chat-person-line">
                        {p.id === me && <span className="chat-person-me">나</span>}
                        <span className="chat-person-name">{personLabel(p)}</span>
                    </span>
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
    if (isVideo(m.image_url)) return '동영상';
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
 * 서랍의 한 칸 — **멈춘 그림을 먼저 깔고** 움직이는 판이 오면 걷는다.
 *
 * 첫 묶음(`✨ 움직임`)이 통째로 움직이는 `.webp`라 **4.3MB**다. 칸은 곧바로
 * 그려지지만 그림이 다 올 때까지 빈 네모라, LTE에서 서랍을 처음 열면
 * 한참 아무것도 없다(사용자 제보 — `이모티콘을 누르면 바로 안뜨고 골프공이나
 * 다른걸 누른후에 떠`. 골프공은 한 장 7KB짜리 정지 PNG라 그 자리에서 뜬다).
 * **`<id>.png`가 늘 함께 있으므로**(`lib/stickers.ts` — 옛 판을 든 폰의
 * 예비 길이다) 그 한 장을 칸의 바탕으로 깔아 둔다. 열여덟 장 다 합쳐 160KB다.
 *
 * - **움직이는 판이 오면 바탕을 반드시 걷는다.** 우리 이모티콘은 배경이
 *   투명이라, 안 걷으면 움직이는 그림 **뒤로 멈춘 그림이 비쳐** 두 겹이 된다.
 * - **`onLoad`만 믿지 말 것** — 이미 받아 둔 그림은 그 신호가 리액트보다
 *   먼저 지나갈 수 있다. 칸이 붙는 자리(`ref`)에서 `complete`를 한 번 더 본다.
 * - `loading="lazy"`는 그대로다 — 움직이는 4.3MB는 여전히 **보이는 것만** 받는다.
 */
function TrayImg({ id }: { id: string }) {
    const live = stickerSrc(stickerRef(id));
    const still = live.endsWith('.webp') ? swapExt(live) : '';
    const clear = (el: HTMLImageElement | null) => {
        if (el && el.complete && el.naturalWidth > 0) el.style.backgroundImage = 'none';
    };
    return (
        <img src={live} alt="" loading="lazy" ref={clear}
             style={still ? { backgroundImage: `url(${still})` } : undefined}
             onLoad={e => { e.currentTarget.style.backgroundImage = 'none'; }}
             onError={otherExt} />
    );
}

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
    /** 그림·동영상이 자리를 잡으면 알린다. **칸 종류를 안 가린다** —
     *  `<img>`와 `<video>`가 같이 쓴다(`ChatPhoto`). */
    onImageLoad: (e: SyntheticEvent<HTMLElement>) => void;
    /** 답장이면 원본. 아직 안 불러온 지난 글이면 없다. */
    quoted?: Message;
    quotedWho?: string;
    /** 답장이긴 한데 원본을 못 찾은 경우(지난 묶음이거나 지워졌다). */
    lostQuote: boolean;
    onJump: (id: string) => void;
    onReply: (m: Message) => void;
    /** 길게 눌렀을 때. 복사·댓글·공유 따위를 고르는 창을 연다.
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
     * 그림·이모티콘·가린 칩도 같은 자리를 쓰고, 무엇도 못 찾으면 줄로
     * 물러난다.
     */
    const anchor = (): DOMRect => {
        const row = rowRef.current;
        const el = row?.querySelector<HTMLElement>(
            '.chat-bubble, .chat-sticker, .chat-image, .chat-sticker-gone, .chat-hidden');
        return (el ?? row)?.getBoundingClientRect() ?? new DOMRect();
    };
    const startHold = () => {
        held.current = false;
        stopHold();
        hold.current = window.setTimeout(() => {
            hold.current = null;
            held.current = true;
            /* 가린 글은 가운데 줄이라 **어느 쪽도 아니다** — 왼쪽에 붙인다. */
            onHold(message, anchor(), !hidden && mine);
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

    /* **운영진이 가린 글은 날짜 칸처럼 가운데 한 줄이다**(사용자 요청 —
       `가릴때 누가썼는지 모르게 프로필도 없애고 가려진 메시지입니다를
       가운데로 표시해줘. 날짜와요일 표시되는거처럼`).

       얼굴·이름·시각·안 읽은 수를 통째로 뺀다 — **누가 썼는지를 지우는
       것이 이 줄의 뜻**이라, 옆에 얼굴이 그대로 남아 있으면 덮어 봐야
       누가 쓴 글인지가 다 보인다. 앱 목록도 같은 모양으로 그린다
       (`listData`가 `kind: 'system'`으로 넘긴다 — 한쪽만 고치지 말 것).

       **손짓은 그대로 붙여 둔다** — 운영진이 길게 눌러 `가리기 풀기`를
       할 길이 여기밖에 없다. 창이 붙을 자리는 `anchor()`가 이 칩에서
       잡고(`.chat-hidden`), 가운데 줄이라 **왼쪽에 붙인다**(`mine`을
       안 넘긴다). */
    if (hidden) {
        return (
            <div className="chat-row hidden" ref={rowRef}
                 onTouchStart={onTouchStart} onTouchMove={onTouchMove}
                 onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
                 onContextMenu={e => {
                     e.preventDefault();
                     if (!held.current) onHold(message, anchor(), false);
                 }}>
                <div className="chat-hidden">{HIDDEN_LINE}</div>
            </div>
        );
    }

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
                    {/* 가린 글은 위에서 이미 가운데 한 줄로 빠졌다. */
                    sticker
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
                    {!caption && <Stamp at={message.created_at} showTime={showTime} unread={unread} />}
                </div>
                {/* 사진에 글을 함께 보냈으면 그 아래 한 줄로 붙인다.
                    **`.chat-line`으로 감싸야 한다** — 그냥 두면 `.chat-col`이
                    늘여서(`align-items: stretch`) 짧은 글도 사진보다 넓게
                    퍼진다. 감싸면 글 길이만큼만 차지하고, 내 글은 오른쪽으로
                    붙으며, 시각도 이 줄 끝에 온다. */}
                {caption && (
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
 * **생김새는 사용자가 올린 그림에 맞췄다**(`채팅창 공유팝업을 내가 올린
 * 사진형태로 바꿔줘. 공유,투표도 저렇게 멋있게해줘`) — 잔디빛 카드 · 큰
 * 동그라미 배지 · 곳 이름 알약 · 굵은 제목 · 그림 붙은 곁줄 · 가르는 선 ·
 * 꽉 찬 알약 단추. 오른쪽에는 그 갈래의 그림이 흐리게 깔린다.
 *
 * **줄을 세는 것이 아니라 `icon`으로 갈린다.** 글의 모양이 갈래마다 정해져
 * 있는데(아래), 줄 수로 가리면 **공지의 본문 첫 줄이 제목 자리에 앉는** 식으로
 * 엉뚱하게 배정된다(실제로 그렇게 짜 봤다가 갈아엎었다):
 *
 * - **라운드** — `○○님이 …했습니다` / `골프장` / `9월 30일 (수) · 오전 7:00 ·
 *   정원 4명 · 3자리 남음`. 곳 이름이 **알약**, 그 뒤 `·`로 갈린 조각들 중
 *   **첫째가 제목**(날짜)이고 나머지가 **곁줄 칩**이다.
 *   `모집을 열었습니다`처럼 **두 줄뿐인 것**(DB 트리거)은 곳 이름이 곧
 *   제목이 된다 — 알약만 덩그러니 남지 않게 한 것이다.
 * - **투표 · 공지** — 둘째 줄이 제목이고 나머지는 있는 대로 곁줄로 그린다
 *   (투표 결과의 `1위 …` 줄, 공지의 본문 첫 줄). **거기서는 줄 수를 안 센다.**
 *
 * 한 줄짜리는 그 줄이 곧 내용이라 제목으로 세우고 아랫줄을 비운다.
 * 어느 칸도 없는 예전 안내 줄은 지금처럼 가운데 한 줄로 그려진다.
 */
function LinkCard({ body, to, go, icon, rest: restClass }: {
    body: string; to: string; go: string; icon: CardIconName; rest: string;
}) {
    const lines = body.split('\n').filter(Boolean);
    const [foot, ...rest] = lines;

    let pill: string | null = null;
    let title = foot;
    let chips: string[] = [];
    let notes: string[] = [];
    if (icon === 'round' && rest.length >= 2) {
        pill = rest[0];
        const segs = rest.slice(1).join(' · ').split('·').map(s => s.trim()).filter(Boolean);
        title = segs[0] ?? pill;
        chips = segs.slice(1);
    } else if (rest.length) {
        title = rest[0];
        notes = rest.slice(1);
    }

    return (
        <Link className="chat-result" to={to}>
            <span className="chat-result-deco" aria-hidden="true">{CARD_DECO[icon]}</span>
            <span className="chat-result-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {CARD_PATHS[icon]}
                </svg>
            </span>
            <span className="chat-result-body">
                {pill && <span className="chat-result-pill">{pill}</span>}
                <span className="chat-result-title">{title}</span>
                {chips.length > 0 && (
                    <span className="chat-result-chips">
                        {chips.map((chip, i) => (
                            <span key={i} className="chat-result-chip">
                                <ChipIcon text={chip} />
                                {chip}
                            </span>
                        ))}
                    </span>
                )}
                {notes.map((line, i) => (
                    <span key={i} className={restClass}>{line}</span>
                ))}
            </span>
            <span className="chat-result-foot">
                {rest.length > 0 && <span className="chat-result-by">{foot}</span>}
                <span className="chat-result-go">{go}</span>
            </span>
        </Link>
    );
}

/**
 * 곁줄 칩 앞의 작은 그림. **글을 보고 고른다** — 시각이면 시계, 사람 수면
 * 사람. 모르는 것에는 아무것도 안 붙이고 글자만 둔다(억지로 붙이면 뜻이
 * 어긋난 그림이 선다). **그림글자를 쓰지 말 것**(`CARD_PATHS`와 같은 잣대).
 */
function ChipIcon({ text }: { text: string }) {
    const kind = /오전|오후|\d\s*:\s*\d/.test(text) ? 'time'
        : /정원|자리|명|인/.test(text) ? 'who'
            : null;
    if (!kind) return null;
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {kind === 'time'
                ? <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.2V12l3.2 1.9" /></>
                : <>
                    <circle cx="9.5" cy="8.8" r="3.3" />
                    <path d="M3.8 18.6c.6-3 2.8-4.6 5.7-4.6s5.1 1.6 5.7 4.6" />
                    <path d="M16.6 6.5a3.2 3.2 0 0 1 0 6" />
                    <path d="M18.4 18.6a6.6 6.6 0 0 0-1.4-3.4" />
                </>}
        </svg>
    );
}

/**
 * 카드 머리의 배지 그림.
 *
 * **그림글자(이모지)를 쓰지 말 것** — 기기에 없으면 네모난 두부가 나온다
 * (투표 결과 카드의 `🗳`에서 겪었다 · `HoldIcons`와 같은 잣대다).
 * **앱 목록은 같은 이름을 제 SF Symbol로 옮겨 그린다**(`ChatList.swift`의
 * `cardSymbol`) — 이름을 늘릴 때는 그쪽도 함께 볼 것.
 */
type CardIconName = 'round' | 'poll' | 'post';
const CARD_PATHS: Record<CardIconName, React.ReactNode> = {
    // 라운드 — 골프 깃발(필드든 스크린이든 하나로 쓴다).
    round: <>
        <path d="M7 20.5V4" />
        <path d="M7 4.5 17 8 7 11.5Z" />
    </>,
    // 투표 — 네모 안의 체크.
    poll: <>
        <rect x="4" y="4.5" width="16" height="15" rx="3.5" />
        <path d="M8.5 12.2 11 14.7l4.5-5.4" />
    </>,
    // 공지 — 확성기.
    post: <>
        <path d="M4 10.5a1.5 1.5 0 0 1 1.5-1.5H8l6-4v14l-6-4H5.5A1.5 1.5 0 0 1 4 13.5Z" />
        <path d="M17 9.5a4 4 0 0 1 0 5" />
    </>,
};

/**
 * 카드 오른쪽에 흐리게 깔리는 그림(사용자가 올린 그림의 그 자리다).
 *
 * **글 뒤에 깔릴 뿐 자리를 안 뺏는다** — `position: absolute`에 `opacity`도
 * 낮아, 글이 길어 그 위를 지나가도 읽는 데 지장이 없다. 여기도 **그림글자를
 * 쓰지 말 것**(기기에 없으면 네모난 두부가 나온다).
 */
const CARD_DECO: Record<CardIconName, React.ReactNode> = {
    // 라운드 — 그린 위의 깃발과 공.
    round: (
        <svg viewBox="0 0 80 56" fill="none" aria-hidden="true">
            <path d="M0 45c11-9 25-13 40-13s29 4 40 13v11H0Z" fill="currentColor" opacity=".45" />
            <path d="M53 45V8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M53 9 73 15 53 21Z" fill="currentColor" />
            <circle cx="25" cy="42" r="5" fill="currentColor" opacity=".8" />
        </svg>
    ),
    // 투표 — 표가 쌓인 막대.
    poll: (
        <svg viewBox="0 0 80 56" fill="none" aria-hidden="true">
            <rect x="8" y="30" width="15" height="26" rx="4" fill="currentColor" opacity=".45" />
            <rect x="32" y="13" width="15" height="43" rx="4" fill="currentColor" />
            <rect x="56" y="38" width="15" height="18" rx="4" fill="currentColor" opacity=".45" />
        </svg>
    ),
    // 공지 — 확성기와 퍼지는 소리.
    post: (
        <svg viewBox="0 0 80 56" fill="none" aria-hidden="true">
            <path d="M10 22h10l22-13v38L20 34H10a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4Z"
                  fill="currentColor" />
            <path d="M52 19a12 12 0 0 1 0 18" stroke="currentColor" strokeWidth="3.4"
                  strokeLinecap="round" />
            <path d="M61 12a22 22 0 0 1 0 32" stroke="currentColor" strokeWidth="3.4"
                  strokeLinecap="round" opacity=".45" />
        </svg>
    ),
};

