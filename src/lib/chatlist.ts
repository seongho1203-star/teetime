import type { KeyboardResize } from '@capacitor/keyboard';
import { formatChatDay, kstDate, kstMinute } from './format';
import { NativeComposer, hush, ncLog } from './composer';
import type { Message } from './types';
/* 그림 이름은 **웹 창이 쓰는 그것 그대로다**(27판) — 앱은 같은 이름을
   제 그림으로 옮겨 그린다. 타입만 가져오므로 묶음에는 안 실린다. */
import type { HoldIconName } from '../components/HoldIcons';

/*
 * **대화 목록을 앱이 그리게 하는 쪽**(17판 · `ios/App/App/ChatList.swift`).
 *
 * 사용자가 고른 길이다 — `docs/네이티브로-바꾸기.md`의 **B(대화 화면만)**.
 * 거친 순간이 전부 이 화면에 몰려 있었고, 나머지 열아홉 화면은 웹 그대로다.
 *
 * ## 누가 무엇을 맡나
 *
 * **줄은 웹이 만든다.** 누구 글인지 · 이름을 붙일지 · 시각을 적을지 ·
 * 안 읽은 수가 몇인지는 이미 `Chat.tsx`가 알고 있고 그 규칙이 거기 한 벌로
 * 있다. 앱은 **그리기와 굴리기만** 한다:
 *
 *   웹 → `listRows(줄 목록)` → 앱이 높이를 재고 그린다
 *   앱 → `listState(맨 아래인가 · 맨 위에 닿았나)` → 웹이 더 받아 온다
 *
 * **묶는 규칙(`sameBlock`·`isNewDay`)을 여기 두는 것이 이 파일의 값이다** —
 * 그리는 곳이 둘(웹 목록 · 앱 목록)이 되었으므로, 규칙까지 둘이 되면
 * 언젠가 어긋난다.
 *
 * ## 되물러남 — 41판부터 앱 목록을 기본으로 쓴다
 *
 * 41판부터 기본으로 켜지고, `내 정보`에서 끄면 `off`를 저장한다.
 * 40판 이하에서는 예전처럼 `on`으로 직접 켠 경우에만 쓴다.
 * Swift의 실제 키보드 움직임은 TestFlight 실기기에서 확인한다.
 *
 * 켜 두어도 **앱 목록이 실제로 서서 줄을 받아 그렸다고 알려 줄 때만** 웹이
 * 제 목록을 감춘다(`visibility: hidden` — 자리는 그대로 둔다).
 */

const KEY = 'teetime:nc-list';

/** 41판부터 기본 켜짐. 사용자가 명시한 off는 버전이 올라가도 유지한다. */
export function listOn(): boolean {
    try {
        const choice = localStorage.getItem(KEY);
        return choice === 'on' || (choice !== 'off' && ncLog.v >= 41);
    } catch { return ncLog.v >= 41; }
}

export function setListOn(on: boolean): void {
    try {
        if (on) localStorage.setItem(KEY, 'on');
        else localStorage.setItem(KEY, 'off');
    } catch { /* 사파리 잠금 */ }
}

/**
 * **손가락을 따라 뒤로 가기**(35판)의 시험 스위치.
 *
 * 대화방은 말풍선과 입력칸을 앱이 그려서 웹이 화면을 밀면 찢어진다 —
 * 그래서 25판까지는 밀면 **곧바로** 넘어갔고, 나머지 열아홉 화면만
 * 손가락을 따라왔다(사용자 요청 — `되돌아가기할때 손따라 오면서 되는건
 * 안되는거야?`). 지금은 끄는 일을 통째로 앱이 맡는다(`BackDrag`).
 *
 * **기본은 꺼짐이다** — 여기는 헤드리스로 한 줄도 확인할 수 없는 자리라
 * (그림을 찍어 미는 것이 앱이다) 14판 `ListSlider`·17판 앱 목록과 같은
 * 잣대를 쓴다: 매일 쓰는 화면을 짐작으로 갈아 끼우지 않는다.
 * **스위치가 화면에 있어야 하는 것이 한 쌍이다**(`내 정보 → 시험 중`) —
 * 저장 열쇠를 폰에서 손으로 적을 길이 없다.
 */
const DRAG_KEY = 'teetime:nc-drag';

export function dragOn(): boolean {
    try { return localStorage.getItem(DRAG_KEY) === 'on'; } catch { return false; }
}

export function setDragOn(on: boolean): void {
    try {
        if (on) localStorage.setItem(DRAG_KEY, 'on');
        else localStorage.removeItem(DRAG_KEY);
    } catch { /* 사파리 잠금 */ }
}

/**
 * 지금 판에서 끌 수 있는가. **36판부터다.**
 *
 * 35판은 그림을 **웹뷰 안에** 얹었는데 Capacitor는 웹뷰를 화면 그 자체로
 * 쓰므로(`loadView`의 `view = webView`), 앞 화면 몫으로 웹뷰를 미는 순간
 * **그림까지 함께 밀려** 화면이 왼쪽으로 97px 튀었다가 손을 따라 끌려왔다
 * (사용자 제보 — `오른쪽으로 손가락을 밀면 … 화면이 왼쪽으로 갔다가
 * 오른쪽으로 끌려와`). 36판이 그림을 **창에** 얹어 그 자리를 없앴다.
 *
 * 수를 올려 두면 **35판을 든 폰은 웹만 밀어도 그날로** 25판처럼 곧바로
 * 넘어가고(그 자국이 없다), 36판을 받으면 저절로 돌아온다 — 12판
 * `canPickNative()`에서 쓴 그 수다.
 */
export function canBackDrag(): boolean {
    return ncLog.ready === true && ncLog.v >= 36 && dragOn();
}

/**
 * 지금 판에서 앱 목록을 쓸 수 있는가. 옛 앱은 판 번호로 걸러진다.
 *
 * **17판이 아니라 18판부터다.** 17판 앱 목록에는 **키보드를 내릴 길이
 * 없었다**(사용자 제보 — `키보드가 내려가지않아 … 채팅창을 아래로내릴때,
 * 채팅창을 눌렀을때인데 둘다 안돼`). 내리는 두 길이 둘 다 웹 목록에
 * 걸려 있었는데 앱 목록이 그 위를 덮었기 때문이다.
 *
 * 번호를 올려 두면 **17판을 든 폰은 웹만 밀어도 그날로 웹 목록으로
 * 돌아오고**(앱 한 바퀴는 30분이다), 18판을 받으면 저절로 앱 목록으로
 * 돌아온다 — 12판 `canPickNative()`에서 쓴 그 수다.
 *
 * **지금은 27판이다** — 사진·이모티콘·눌리는 카드(2판) · 인용·반응 알약·
 * `여기까지 읽으셨습니다` 줄(3판) · 손짓(4판) · 굴리기 얽힘(5판)까지
 * 앱이 맡고, **웹이 바 위에 그리는 것을 가리지 않으며**(23판의 `lift`)
 * **눌러서 키보드를 내릴 수 있고**(24판), **오른쪽으로 밀면 나가고 들어올
 * 때 미끄러져 들어오며**(25판), **줄 위 자리를 웹이 알려 주고**(26판의
 * `top` — 25판까지는 모든 줄에 4px을 박아 두어 웹과 6px씩 어긋났다),
 * **길게 누른 창까지 앱이 그린다**(27판 — 그래야 바꿔치기가 없어진다).
 * 그 아래 판을 든 폰은 못 그리거나(사진이 글자로 보인다) 못 움직여서
 * (길게 눌러도 창이 안 뜬다), **같은 수로 웹 목록으로 되돌린다.**
 *
 * **24판은 대화방을 나갈 길이 `←` 하나뿐이었다** — 오른쪽으로 미는 손짓도,
 * 들어올 때 미끄러져 들어오는 것도 웹 목록에 걸려 있었는데 앱 목록이 그
 * 위를 덮었다(사용자 제보 — `상단에 돋보기 있는 그 라인을 잡고 우측으로
 * 밀면 되돌리기가 되는데 채팅창 잡고 오른쪽으로 밀면 되돌아가기가 안 돼` ·
 * `채팅창은 밀려서 들어오는 게 아니고 그냥 바로 나타나`). **머리말에서만
 * 되고 말풍선 자리에서만 안 되는 것**이 곧 그 갈림의 자국이다.
 *
 * **20 → 21 → 22 → 23 → 24 → 25가 그 본보기다** — 20판은 얼굴·인용·밀기가
 * 안 눌리고 `최근 대화로` 줄이 가려 안 보였고, **21판은 이모티콘이 한 장도
 * 안 떠 말풍선 자리가 통째로 비었으며**(앱 안에 든 그림을 인터넷에서
 * 받으려 했다), **22판은 인용·언급 목록·서랍이 목록 뒤에 깔려 안 보였고**
 * (`@언급 안됨` · `이모티콘 안나옴` · `답장 안걸림`이 다 그 한 자리였다),
 * **23판은 눌러도 키보드가 안 내려갔다**(셀의 탭이 목록의 `키보드 내리기`
 * 탭을 막았다 — 사용자 제보 `채팅창을 터치하면 키보드가 내려가지않아`).
 * 수를 올려 두면 그 판을 든 폰은 **웹만 밀어도 그날로** 웹 목록으로
 * 돌아오고, 새 앱을 받으면 저절로 앱 목록으로 돌아온다.
 *
 * **26판은 길게 누르면 자리가 틀어졌다** — 창은 웹 것인데 앱 목록을 못
 * 덮으므로 그동안 웹 목록으로 **바꿔치기**를 했고, 두 목록은 글꼴이 달라
 * 아래로 갈수록 어긋났다(사용자 제보 · 사진 — `팝업이 있을때와 없을때
 * 프로필이나 말풍선 위치가 틀어져`). 줄 간격을 맞춰도 그대로였다.
 *
 * **27판은 `공유`가 눌러도 아무 일이 없었다** — 창이 앱 것이 되면서
 * 고른 값이 다리를 건너와 **웹의 `navigator.share`가 통째로 막혔다**(그것은
 * 사람이 누른 그 손짓 안에서만 열린다). 28판이 그 둘을 앱에게 맡겼다.
 *
 * **28·29판은 `가리기`·`삭제`를 누르면 대화가 튀었다** — 한 번 더 묻는
 * 창은 웹 것인데 앱 목록을 못 덮으므로 그때만 **웹 목록으로 바꿔치기**를
 * 했고, 두 목록은 굴린 자리가 따로라 **대화가 맨 아래로 툭 내려갔다가
 * 닫으면 도로 올라왔다**(사용자 제보 · 사진). 30판이 그 창도 앱에게
 * 맡겨(`canNativeConfirm`) 바꿔치기 자체를 없앴다 — **26판의 그 자리와
 * 같은 답이다.** 그 전 판을 든 폰은 여기서 웹 목록으로 돌아가는데,
 * 거기서는 창도 목록도 다 웹이라 튈 자리가 없다.
 *
 * **30~33판은 드나들 때마다 말풍선이 조금씩 내려앉았다**(사용자 제보 —
 * `들어갔다 되돌아오기를 반복하면 채팅창이 조금씩 올라가` → `웹에서는
 * 증상이 없네. 앱그리기해놓은상태에서 그 증상이있어`). 앱 목록은 읽던
 * 자리를 **한 번만** 놓고 끝냈는데 목록 높이는 한 번에 안 정해져서, 사진이
 * 뜨며 위쪽에서 자란 만큼 밀리고 **나갈 때 그 밀린 자리를 다시 적어**
 * 드나들 때마다 쌓였다(웹 목록은 1.5초 동안 다시 놓아 그 자국이 없다).
 * 34판의 `holdSpot`이 같은 일을 하고, **그 전 판은 여기서 웹 목록으로
 * 돌린다** — 옛 판에서는 고칠 길이 없기 때문이다.
 */
export function canNativeList(): boolean {
    return ncLog.ready === true && ncLog.v >= 34 && listOn();
}

/* ── 묶는 규칙 (웹 목록과 앱 목록이 같이 본다) ─────────────── */

/**
 * 한 덩어리인가 — **같은 사람 · 같은 분**이다(카톡과 같다).
 * 5분으로 묶어 봤더니 9시 09분과 9시 10분 글이 한 덩어리가 되어,
 * 카톡이라면 이름이 다시 붙을 자리가 비어 보였다.
 */
export function sameBlock(a?: Message, b?: Message): boolean {
    return !!a && !!b && a.user_id === b.user_id
        && kstMinute(a.created_at) === kstMinute(b.created_at);
}

/** 앞 글과 날짜가 갈리는가(그 위에 날짜 칸이 붙는다). */
export function isNewDay(prev: Message | undefined, m: Message): boolean {
    return !prev || kstDate(prev.created_at) !== kstDate(m.created_at);
}

/**
 * **운영진이 가린 글에 대신 적는 한 줄.**
 *
 * **날짜 칸처럼 가운데 한 줄로 그린다**(사용자 요청 — `가릴때 누가썼는지
 * 모르게 프로필도 없애고 … 가운데로 표시해줘. 날짜와요일 표시되는거처럼`).
 * 얼굴·이름·시각·안 읽은 수가 통째로 빠진다 — **누가 썼는지를 지우는 것이
 * 이 줄의 뜻**이라, 옆에 얼굴이 남아 있으면 그 뜻이 반쯤 없어진다.
 *
 * 그전에는 말풍선을 벗긴 흐린 한 줄이었고(그 전에는 말풍선 안에
 * `운영진이 가린 메시지입니다`였다), 둘 다 **글이 있던 자리에** 남아
 * 누구 줄인지가 그대로 보였다.
 *
 * **웹 말풍선과 앱 목록이 같이 쓴다 — 한쪽만 고치지 말 것.**
 * 인용·미리보기의 `가려진 메시지`(`preview()`)와 말이 이어지게 두었다.
 */
export const HIDDEN_LINE = '가려진 메시지입니다';

/* ── 앱에 넘기는 한 줄 ───────────────────────────────────── */

export type ListRow = {
    id: string;
    /**
     * `text` 말풍선 · `system` 가운데 안내 줄 · `photo` 사진 · `sticker`
     * 이모티콘 · `card` 눌러서 들어가는 안내 카드 · `other` 말풍선 없이
     * 흐린 한 줄.
     *
     * **`other`는 이제 웹이 안 만든다.** 가린 글이 마지막 임자였는데
     * **날짜 칸처럼 가운데 한 줄**로 바뀌면서 `system`으로 옮겨 갔다
     * (사용자 요청). **그래도 앱 쪽 그림은 지우지 말 것** — 옛 화면을 문 폰
     * (GitHub Pages가 index.html을 10분쯤 물고 있다)이 새 앱에 붙으면
     * 그때까지 이 줄을 보내오고, 앱이 못 그리면 그 줄이 통째로 빈다.
     */
    kind: 'text' | 'system' | 'photo' | 'sticker' | 'card' | 'other';
    mine?: boolean;
    /** 이름표(`83/신성호/광산구`). **없으면 안 그린다** — 덩어리의 둘째 줄부터다. */
    name?: string;
    avatar?: string;
    /** 남녀 테두리 색. 없으면 테두리 없음. */
    edge?: string;
    body: string;
    /** 덩어리의 **마지막 줄에만** 붙는다. */
    time?: string;
    unread?: number;
    /** 이 줄 위에 붙는 날짜 칸. */
    date?: string;
    /**
     * 말풍선 대신 **흐린 한 줄로만** 적을 말. 이 값이 있으면 앱도 웹처럼
     * 말풍선을 벗긴다.
     *
     * **`kind: 'other'`와 한 쌍이라 이제 웹은 안 보낸다** — 위 `kind` 참고.
     */
    note?: string;
    /**
     * 사진·이모티콘의 **그림 주소**. 이모티콘은 글에 `sticker:<id>`로 남고
     * 주소를 짓는 규칙(`stickerSrc`)은 웹에만 있으므로 **여기서 만들어 준다** —
     * 앱이 그 규칙을 또 들고 있으면 형식을 바꿀 때 한쪽만 고치게 된다.
     */
    image?: string;
    /** 사진·이모티콘과 **함께 보낸 글**(그림 아래 한 줄 · 웹의 `.chat-cap`). */
    cap?: string;
    /** 이모지만 보낸 글 — 말풍선을 벗기고 크게 그린다(`lib/emoji.ts`). */
    big?: boolean;
    /** 눌리는 카드의 아랫줄(`라운드 보러 가기 ›`). */
    go?: string;
    /** 그 카드가 가는 곳(`/rounds/r1`). */
    to?: string;
    /**
     * 카드 머리에 서는 **배지 그림의 이름**. 웹의 `CARD_PATHS`(선 SVG)와
     * 같은 이름이고, 앱은 같은 이름을 제 SF Symbol로 옮겨 그린다
     * (`ChatList.swift`의 `cardSymbol`). **한쪽만 고치지 말 것.**
     *
     * **그림글자(이모지)로 하지 말 것** — 기기에 없으면 네모난 두부가
     * 나온다(투표 결과 카드의 `🗳`에서 겪었다).
     */
    icon?: 'round' | 'poll' | 'post';
    /**
     * 인용(답장)의 머리말 — `박승수에게 댓글`. **닉네임 그대로다**
     * (`83/신성호/광산구`가 아니다 — 문장에 가까운 줄이다).
     */
    quoteWho?: string;
    /**
     * 인용의 원문 **한 줄**. `preview()`를 거친 값이라 **가린 글은
     * `가려진 메시지`로 이미 바뀌어 있다** — 앱에 원문을 넘기면 그리로 샌다.
     */
    quoteText?: string;
    /**
     * 인용을 누르면 갈 **원본 글의 id**. 없으면 누를 수 없다 — 지난 묶음에
     * 있어 아직 안 받아 온 원본이 그렇다(웹 목록에서도 안 움직인다).
     *
     * **이 값을 빠뜨리면 인용이 통째로 안 눌린다** — 앱은 어디로 뛸지를
     * 알 길이 아예 없다(20판에서 실제로 그랬다).
     */
    quoteTo?: string;
    /**
     * 말풍선 아래 반응 알약. **차례는 먼저 달린 순서다**(`countReacts`) —
     * 개수순으로 세우면 새 반응이 들어올 때마다 칩이 자리를 바꾼다.
     */
    reacts?: { emoji: string; n: number; mine: boolean }[];
    /** 이 줄 **위에** `여기까지 읽으셨습니다`를 긋는가. */
    mark?: boolean;
    /**
     * 이 줄 **위에 띄울 자리**(px). 웹 목록의 `margin-top`과 같은 값이다 —
     * `.chat-row` **10px**, 같은 사람이 잇따라 보낸 줄(`.grouped`) **2px**,
     * 안내 줄·카드(`.chat-notice`·`.chat-result`) **10px**.
     *
     * **앱이 셈하게 두지 말 것.** 예전에는 앱이 모든 줄에 4px을 박아 두어
     * 줄마다 6px씩 어긋났고, **아래로 갈수록 쌓였다** — 길게 누르는 창이
     * 뜨면 앱 목록을 감추고 웹 목록으로 바꿔치기하는데 그때 그 어긋남이
     * 통째로 드러난다(사용자 제보 · 사진 두 장 — `팝업이 있을때와 없을때
     * 프로필이나 말풍선 위치가 틀어져`).
     */
    top?: number;
};

/** 줄 위에 띄울 자리 — `Chat.css`의 `.chat-row`와 같은 값이다. */
export const ROW_TOP = 10;
/** 같은 사람이 같은 분에 잇따라 보낸 줄(`.chat-row.grouped`). */
export const GROUPED_TOP = 2;

/** 날짜 칸 글자. 웹 목록의 `.chat-day`와 같은 함수를 쓴다. */
export function dayChip(m: Message): string {
    return formatChatDay(m.created_at);
}

/* ── 크기와 색 ───────────────────────────────────────────── */

/**
 * 앱 목록에 넘길 값들. **`.chat-list`에서 읽는다** — 대화 색 토큰은
 * `:root`가 아니라 그 칸에 달려 있다(`Chat.css`의 팔레트).
 *
 * **크기는 카톡 스크린샷을 픽셀로 재서 맞춘 그 값이다**(CLAUDE.md의
 * `대화 화면의 크기`). 눈대중으로 고치지 말 것 — 고칠 일이 생기면
 * **여기와 `Chat.css`를 함께** 고친다.
 */
export function chatListSkin(el: HTMLElement | null): Record<string, unknown> {
    const read = (node: Element, name: string, fallback: string) => {
        try {
            const v = getComputedStyle(node).getPropertyValue(name).trim();
            return v || fallback;
        } catch {
            return fallback;
        }
    };
    const list = el ?? document.documentElement;
    const root = document.documentElement;
    return {
        bg: read(list, '--chat-bg', '#7369a0'),
        bubble: read(list, '--chat-bubble', '#f5f5f5'),
        mineBubble: '#ffdf47',
        text: read(root, '--text', '#1b1f19'),
        soft: read(list, '--chat-soft', 'rgba(255,255,255,0.78)'),
        faint: read(list, '--chat-faint', 'rgba(255,255,255,0.75)'),
        chip: read(list, '--chat-chip', 'rgba(255,255,255,0.17)'),
        on: read(list, '--chat-on', 'rgba(255,255,255,0.95)'),
        unread: read(list, '--chat-unread', '#ffdf47'),
        /* 카드의 `보러 가기 ›`와 머리 배지. **분홍(`--brand`)을 쓰지 말 것** —
           그건 '지금 눌러야 할 것' 자리이고 이건 알려 주는 값이다.
           흰 카드 위라 `--grass`가 아니라 **한 톤 낮춘 `--grass-deep`**이다
           (웹의 `.chat-result-go`와 같은 값 — 한쪽만 고치지 말 것). */
        link: read(root, '--grass-deep', '#5b8d18'),
        /* 배지의 옅은 칠(웹의 `.chat-result-icon`). */
        linkSoft: read(root, '--grass-soft', 'rgba(124,184,40,0.16)'),
        card: read(root, '--surface', '#ffffff'),
        /* 눌리는 카드의 잔디빛 칠과 배지(사용자가 올린 그림에 맞춘 값이다).
           **`card`를 물들이지 말 것** — 그 값은 길게 누른 창의 카드도 같이
           쓴다(`ChatList.swift`의 `HoldMenu`). 웹은 `.chat-result`에서 위가
           짙고 아래가 옅은 그라디언트로 깔지만 앱은 한 색이라, 여기 값은
           그 **위쪽 칠을 흰 바탕에 눌러 담은 것**이다(`--grass` 17%). */
        cardTint: '#e9f3da',
        cardBadge: read(root, '--grass', '#7cb828'),
        /* 카드 안의 가는 선(`보러 가기 ›` 위). 흰 바탕 위라 `--line` 그대로다. */
        cardRule: read(root, '--line', '#dde3d1'),
        /* 인용 안의 가는 선. **`--line`을 쓰지 말 것** — 흰 말풍선에만 맞는
           값이라 내 노란 말풍선 위에서는 안 보인다(웹에서 겪은 그 자리다). */
        quoteRule: 'rgba(0,0,0,0.1)',
        /* 내가 누른 반응 알약의 **테두리만** 분홍이다 — 칠하지 말 것.
           이 화면에서 '지금 눌러야 할 것'은 보내기 단추 하나다. */
        brand: read(root, '--brand', '#e8497f'),
        pad: 9, avatar: 29, avatarGap: 7, radius: 11,
        fontSize: 15, lineHeight: 18, padH: 11, padV: 8.5,
        nameSize: 13.5, stampSize: 10, maxRatio: 0.684,
        /* 사진 상자·이모티콘 크기는 `Chat.css`의 `.chat-image`·`.chat-sticker`와
           같은 값이다 — **한쪽만 고치지 말 것.** */
        photoW: 240, photoH: 300, photoRadius: 15,
        sticker: 118, bigSize: 40,
        /* 인용 글자는 **말풍선보다 한 톤 낮춘다**(웹의 `.chat-quote`).
           알약은 **30px 아래로 내리지 말 것** — 누를 자리다. */
        quoteSize: 13, quoteLine: 18, reactH: 30,
        /* 눌리는 카드(라운드·투표·공지). **웹의 `.chat-result`와 같은 값이다** —
           길게 누르는 창이 뜰 때 웹 목록으로 바꿔치기하는 판이 아직 남아
           있어(28판 아래 앱) 두 카드가 같아 보여야 한다. 한쪽만 고치지 말 것. */
        cardW: 320, cardPad: 13, cardRadius: 16,
        cardIconSize: 34, cardIconGap: 10,
        cardHead: 11.5, cardTitle: 16, cardNote: 12.5, cardGo: 12,
        /* `최근 대화로` 줄(웹의 `.chat-jump`). **앱이 그린다** — 그 단추는
           목록 위에 떠 있는데 앱 목록은 웹 화면 **위에 얹힌 앱 부품**이라
           웹이 그리면 통째로 가려진다(사용자 제보 — `최신대화로 버튼
           안나옴`). 네이티브 바에서 겪은 그 자리다.
           값은 `.chat-jump`와 같은 것이다 — **한쪽만 고치지 말 것.** */
        jumpBg: read(root, '--surface', '#ffffff'),
        jumpLine: read(root, '--line', 'rgba(0,0,0,0.1)'),
        jumpDim: read(root, '--text-dim', '#5b6455'),
        jumpH: 38, jumpSize: 13,
        /* 길게 누른 창의 `삭제` 줄(27판 · 웹의 `.chat-menu-item.danger`).
           되돌릴 수 없는 일이라 그 줄만 색으로 갈라 둔다. */
        danger: read(root, '--danger', '#d13c3c'),
    };
}

/** 남녀 테두리 색. 얼굴 한 곳에만 쓰는 토큰이다(`Avatar`와 같은 잣대). */
export function edgeColor(gender: string | null | undefined): string | undefined {
    if (gender !== 'm' && gender !== 'f') return undefined;
    try {
        const v = getComputedStyle(document.documentElement)
            .getPropertyValue(gender === 'm' ? '--male' : '--female').trim();
        return v || undefined;
    } catch {
        return undefined;
    }
}

/* ── 다리 ────────────────────────────────────────────────── */

type Bridge = {
    listAttach(o: Record<string, unknown>): Promise<{ ok?: boolean; resumed?: boolean }>;
    listRows(o: { rows: ListRow[]; stickBottom: boolean }): Promise<{ ok?: boolean; n?: number }>;
    listSet(o: Record<string, unknown>): Promise<void>;
    listScrollTo(o: {
        id: string; place?: string; flash?: boolean; off?: number;
    }): Promise<{ ok?: boolean }>;
    listMenu(o: Record<string, unknown>): Promise<{ ok?: boolean }>;
    listDetach(): Promise<{
        atBottom?: boolean; topId?: string; off?: number;
        shot?: string; shotTop?: number; shotH?: number;
    }>;
    addListener(
        n: 'listState',
        cb: (e: { atBottom: boolean; atTop: boolean; far: boolean }) => void,
    ): Promise<{ remove: () => Promise<void> }>;
    addListener(
        n: 'listTap',
        cb: (e: { kind: string; id: string; to: string }) => void,
    ): Promise<{ remove: () => Promise<void> }>;
    addListener(
        n: 'listHold',
        cb: (e: HoldAt) => void,
    ): Promise<{ remove: () => Promise<void> }>;
    addListener(
        n: 'listMenuPick',
        cb: (e: { kind: string; name: string }) => void,
    ): Promise<{ remove: () => Promise<void> }>;
    addListener(
        n: 'listBack',
        cb: (e: { phase: string }) => void,
    ): Promise<{ remove: () => Promise<void> }>;
};

/**
 * 길게 누른 창에 설 줄 하나(27판).
 *
 * **글자도 갈래 이름도 웹이 정한다** — 누구에게 무엇이 붙는지는
 * `Chat.tsx`의 `holdItems()`에 한 벌로 있고, 앱은 그리기와 누르기만 맡는다.
 * `icon`은 웹의 `HoldIcon`과 같은 이름이고 앱이 제 그림으로 옮겨 그린다.
 */
export type HoldItem = {
    name: string;
    label: string;
    icon: HoldIconName;
    danger?: boolean;
};

/** 길게 누른 말풍선의 자리 — **창(화면) 좌표다**(웹의 `getBoundingClientRect`와 같은 자). */
export type HoldAt = { id: string; mine: boolean; x: number; y: number; w: number; h: number };

/**
 * **읽던 자리**(32판) — 화면 맨 위에 걸린 글과 그 글이 위로 지나간 만큼이다.
 *
 * 굴린 픽셀(`scrollTop`)을 적어 두지 않는 것이 핵심이다 — 다시 들어오면
 * 사진이 늦게 뜨며 높이가 달라져 같은 숫자가 다른 자리를 가리킨다.
 * 글 id로 적어 두면 그 글이 목록에 있는 한 늘 같은 자리다.
 *
 * **`at`은 그 글의 시각이다 — 첫 묶음에 없을 때 받아 오려고 함께 적는다.**
 * 다시 들어오면 마지막 50개만 받아 오므로, 옛 글을 되짚다 나간 사람은
 * 그 글이 목록에 아예 없어 맨 아래로 떨어진다(사용자 제보 — 고쳐 놓고도
 * `최근대화로 넘어와`). 시각이 있어야 그 언저리를 받아 올 수 있다.
 * **없을 수도 있다** — 앱이 돌려준 자리(`listDetach`)에서 그 글이 이미
 * 밀려났을 때다. 그때는 예전처럼 맨 아래다.
 */
export type ChatSpot = { id: string; off: number; at?: string };

const bridge = NativeComposer as unknown as Bridge;

// 이전 화면의 해제와 다음 화면의 준비도 같은 순서로 처리한다.
let commands: Promise<unknown> = Promise.resolve();
function ordered<T>(run: () => Promise<T>): Promise<T> {
    const next = commands.then(run);
    commands = next.catch(() => {});
    return next;
}
let previousResize: KeyboardResize | undefined;
async function restoreResize(): Promise<void> {
    if (previousResize === undefined) return;
    const mode = previousResize;
    const { Keyboard } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode });
    previousResize = undefined;
}

/** 목록을 세운다. **바가 먼저 서 있어야 한다** — 안 서 있으면 앱이 거절한다. */
export async function listAttach(o: Record<string, unknown>): Promise<{ ok: boolean; resumed: boolean }> {
    return ordered(async () => {
        try {
            if (ncLog.v >= 41) {
                const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
                if (previousResize === undefined) previousResize = (await Keyboard.getResizeMode()).mode;
                await Keyboard.setResizeMode({ mode: KeyboardResize.None });
            }
            const r = await bridge.listAttach(o);
            if (r?.ok === true) return { ok: true, resumed: r.resumed === true };
        } catch { /* 준비하지 못하면 웹 목록을 유지한다. */ }
        await restoreResize().catch(() => {});
        return { ok: false, resumed: false };
    });
}

export async function listRows(rows: ListRow[], stickBottom: boolean): Promise<boolean> {
    return ordered(async () => {
        try { return (await bridge.listRows({ rows, stickBottom }))?.ok === true; }
        catch { return false; }
    });
}

export async function listSet(o: Record<string, unknown>): Promise<boolean> {
    try { await ordered(() => bridge.listSet(o)); return true; }
    catch { return false; }
}

/**
 * 나가면서 **읽던 자리**를 받아 온다(32판).
 *
 * 굴린 자리는 앱이 들고 있으므로 웹이 물어볼 길이 그 순간뿐이다 —
 * 굴릴 때마다 알려 오게 하면 다리를 쉼 없이 건너게 된다(`far`를 뒤집힐
 * 때만 알리는 것과 같은 잣대다). 라운드·투표를 눌러 들어갔다 돌아왔을 때
 * 그 자리에 되돌려 놓는 값이다.
 *
 * **그 값을 모르는 옛 앱에서는 `null`이다** — 그때는 예전처럼 최근 대화로
 * 내려놓을 뿐이라 깨질 자리가 없다(`canNativeList()`의 문을 안 올린 까닭).
 */
export async function listDetach(room?: string): Promise<ChatSpot | null> {
    let spot: ChatSpot | null = null;
    let paint: ListPaint | null = null;
    try {
        const r = await ordered(async () => {
            try { return await bridge.listDetach(); }
            finally { await restoreResize(); }
        });
        if (r && r.atBottom === false && r.topId) {
            spot = { id: r.topId, off: r.off ?? 0 };
        }
        if (r && typeof r.shot === 'string' && r.shot && (r.shotH ?? 0) > 0) {
            paint = {
                url: `data:image/jpeg;base64,${r.shot}`,
                top: Math.round(r.shotTop ?? 0),
                h: Math.round(r.shotH ?? 0),
            };
        }
    } catch { /* 옛 앱 — 자리를 모르면 맨 아래로 본다 */ }
    if (room && paint) keepPaint(room, paint);
    /* 진단 — **그림이 안 왔다**(옛 앱이거나 앱이 못 찍은 때). 세워 둔
       목록이 없으면 그 자리는 애초에 안 찍으므로(들어오자마자 한 번 도는
       `listDetach`가 그렇다) `room`이 있을 때만 센다. */
    else if (room) paintLog.놓침++;
    tellDetached(spot ? { bottom: false, ...spot } : { bottom: true }, paint);
    return spot;
}

/**
 * **마지막으로 받아 둔 앱 목록 그림을 방 하나만큼 들고 있는다**(탭바로
 * 다시 들어올 때의 덮개다).
 *
 * 대화방에 들어가면 화면이 밀려 들어오는 동안 **웹 목록이 보이고**, 앱
 * 목록은 그 뒤에 감춘 채로 서서 줄과 자리를 다 잡은 뒤에 드러난다 —
 * 그 순간 Pretendard(웹)에서 폰 기본 글꼴(앱)로 **갈아 끼워지는 것이
 * 그대로 보였다**(사용자 제보 — `탭바에서 대화를 눌러서 들어가면 웹화면이
 * 잠깐 보였다 앱으로 바뀌는거처럼 보여`). 39판이 끌어 돌아올 때 쓴 그림을
 * 여기서도 덮개로 쓰면 **갈아 끼우는 자리 자체가 없어진다** — 값을 하나씩
 * 맞추는 길로 가지 않는다는 26 → 27판·39판의 그 답이다.
 *
 * **한 칸만 둔다.** 방이 사실상 하나이고 base64 JPEG이라 한 장이 수백 KB다.
 * 처음 들어가는 길에는 그림이 없어 예전처럼 웹 목록이 보인다 — 그때
 * 나가면서 한 장 받아 두므로 그다음부터 덮인다.
 */
let paintRoom = '';
let paintShot: ListPaint | null = null;

function keepPaint(room: string, p: ListPaint): void {
    paintRoom = room;
    paintShot = p;
    paintLog.찍음++;
    paintLog.잰것 = `${p.top}+${p.h}`;
    /* **미리 풀어 둔다**(`lib/tabs.ts`의 `warmPaint`와 같은 결). 받는 때
       (나갈 때)와 까는 때(다시 들어올 때)가 한참 떨어져 있어 공짜인데,
       안 하면 **깔리는 첫 한두 프레임이 빈 채로 지나간다** — 수백 KB짜리
       base64를 그 자리에서 풀어야 하기 때문이다. */
    try {
        const img = new Image();
        img.src = p.url;
        void img.decode?.().catch(() => {});
    } catch { /* 못 풀어도 그림만 한 박자 늦게 뜬다 */ }
}

/** 그 방의 마지막 그림. 없으면 `null`(옛 앱·처음 들어가는 길·못 찍은 때). */
export function lastPaint(room: string): ListPaint | null {
    const p = paintRoom === room ? paintShot : null;
    if (p) paintLog.덮음++; else paintLog.없음++;
    return p;
}

/**
 * **덮개를 폰에서 재는 값**(진단 · `spotLog`·`ncStatus`와 같은 자리).
 *
 * 앱이 그림을 찍어 주는 것도, 그것으로 덮는 것도 **헤드리스로는 한 줄도
 * 확인할 수 없다.** `탭바로 들어가면 여전히 웹 화면이 보인다`는 제보가
 * 오면 이 줄 하나로 갈린다 — `찍음`이 안 늘면 **앱이 못 찍는 것**이고,
 * 느는데 `덮음`이 안 늘면 **웹이 그 그림을 못 찾는 것**이며, 둘 다 느는데
 * 그대로 보이면 **덮개가 안 그려지거나 너무 일찍 걷히는 것**이다.
 *
 * **까닭이 가려지면 이 줄을 걷어낼 것.**
 */
export const paintLog = { 찍음: 0, 놓침: 0, 덮음: 0, 없음: 0, 잰것: '', 살음: 0 };

/** `내 정보` 맨 아래에 적는 한 줄. 아직 아무 일도 없으면 빈 글자다. */
export function paintStat(): string {
    const p = paintLog;
    if (!p.찍음 && !p.놓침 && !p.덮음 && !p.없음) return '';
    return `덮개 찍음${p.찍음} 놓침${p.놓침} 덮음${p.덮음} 없음${p.없음}`
        + (p.잰것 ? ` · ${p.잰것}` : '') + (p.살음 ? ` · ${p.살음}ms` : '');
}

/**
 * **앱 목록이 걷히며 남긴 자리** — 앞 화면 그림(`lib/tabs.ts`의 `shots`)이
 * 그 자리로 굴려 둘 때 쓴다.
 *
 * 대화방을 떠날 때 찍어 둔 웹 DOM에는 **감춰진 웹 목록**이 들어 있는데
 * (말풍선은 앱이 그렸다) 그 목록은 앱 목록과 **굴린 자리가 따로**라, 그대로
 * 되살리면 엉뚱한 자리가 보인다. 찍는 순간(`pushState`)에는 앱 목록이 아직
 * 서 있어 물어볼 길이 없고 `listDetach`가 **뒤늦게** 알려 주므로, 값이
 * 오면 기다리던 그림을 그때 굴려 둔다(`onListDetached`).
 *
 * `bottom`이면 맨 아래를 보고 있던 것이다(그때는 id를 안 적는다 — 새 글이
 * 오면 따라 내려가야 하는 자리라 못박아 두면 되레 안 따라간다).
 */
export type ListSpot = { bottom: true } | { bottom: false; id: string; off: number };

/**
 * **앱 목록을 걷기 직전에 찍은 그림**(39판 · `ChatList.paint`).
 *
 * 끌어 돌아올 때 웹이 까는 앞 화면 그림에서 **말풍선 자리를 이것으로 덮는다.**
 * 그러면 웹 사본(Pretendard)과 앱 목록(폰 기본 글꼴)이 갈아 끼워지는 자리가
 * 아예 없어진다 — 38판까지 자리를 맞춰 온 것의 마지막 조각이다.
 *
 * `top`·`h`는 창(화면) 좌표의 CSS px다 — 목록이 머리말 아래부터 바 윗변까지
 * 차지하던 그 자리. **없을 수 있다** — 옛 앱, 목록이 감춰져 있던 때,
 * 못 찍은 때. 그때는 예전처럼 DOM 사본을 깐다.
 */
export type ListPaint = { url: string; top: number; h: number };

let detachedCb: ((spot: ListSpot, paint: ListPaint | null) => void) | null = null;

/** 앱 목록이 걷힐 때 그 자리를 받아 볼 곳을 건다(한 곳뿐이다 — `lib/tabs.ts`). */
export function onListDetached(cb: (spot: ListSpot, paint: ListPaint | null) => void): void {
    detachedCb = cb;
}

function tellDetached(spot: ListSpot, paint: ListPaint | null): void {
    try { detachedCb?.(spot, paint); } catch { /* 그림 굴리기가 실패해도 나가는 길은 막지 않는다 */ }
}

/**
 * 길게 누른 창을 띄운다(27판) — **앱이 그린다.**
 *
 * 26판까지는 웹이 그렸는데, 웹 창은 앱 목록을 못 덮으므로(웹의 `z-index`로는
 * 앱 부품을 못 덮는다) 그동안 **앱 목록을 감추고 웹 목록을 도로 내보이는
 * 바꿔치기**를 했다. 두 목록은 **글꼴이 달라**(앱은 폰 기본 글꼴, 웹은
 * Pretendard) 줄 높이와 줄 바뀌는 자리가 조금씩 어긋나고 아래로 갈수록
 * 쌓여서, 창이 뜨는 순간 말풍선과 얼굴이 움찔했다. 앱이 그리면 **바꿔치기
 * 자체가 없어진다.**
 *
 * **무엇이 뜨는지는 그대로 웹이 정한다** — 줄 목록과 알약을 실어 보낸다.
 */
export async function listMenu(o: {
    at: { x: number; y: number; w: number; h: number };
    mine: boolean;
    items: HoldItem[];
    reacts: string[];
    skin: Record<string, unknown>;
}): Promise<boolean> {
    try {
        const r = await bridge.listMenu({ show: true, ...o });
        return r?.ok === true;
    } catch {
        return false;
    }
}

/**
 * 창을 걷는다.
 *
 * **`null`을 보내 끄는 길로 가지 말 것 — `show: false`다.** Capacitor의
 * `hasOption`은 `null`을 `안 보냄`으로 보아(`!(value is NSNull)`) 그런
 * 값은 통째로 무시된다 — `최근 대화로` 줄이 영영 안 걷히던 그 함정이다.
 */
export async function closeListMenu(): Promise<void> {
    await hush(bridge.listMenu({ show: false }));
}

/**
 * 그 글로 뛴다 — 인용을 눌렀을 때 · 검색 결과를 골랐을 때 ·
 * `여기까지 읽으셨습니다` 줄로 내려놓을 때 · **읽던 자리로 되돌릴 때**(`at`).
 *
 * `place`는 셋이다 — `center`(인용·검색) · `top`(줄. 위에서 100px) ·
 * **`at`(읽던 자리. 그 글이 위로 `off`만큼 지나간 자리)**.
 *
 * **못 찾으면 거짓이다**(아직 안 받아 온 지난 묶음의 글) — 그때 무엇을
 * 알릴지는 웹이 정한다(`지난 대화에 있습니다. 위로 올려 주세요.`).
 */
export async function listScrollTo(
    id: string, place: 'center' | 'top' | 'at' = 'center', flash = false, off = 0,
): Promise<boolean> {
    try {
        const r = await ordered(() => bridge.listScrollTo({ id, place, flash, off }));
        return r?.ok === true;
    } catch {
        return false;
    }
}

/* ── 재는 줄 ─────────────────────────────────────────────── */

/**
 * **앱이 보낸 신호를 세어 둔다.** 여기는 헤드리스로 한 줄도 확인할 수 없는
 * 자리라(그리고 손짓을 잡는 것이 앱이다) **값을 화면에 적어 두고 사람이
 * 읽어 주는 편이 결국 빠르다** — `ncStatus()`·`kbStat()`과 같은 방식이다.
 *
 * 손짓이 안 먹는다는 제보가 오면 이 줄 하나로 갈린다:
 * 눌렀는데 `탭`이 안 늘면 **앱이 안 보내는 것**이고, 느는데 화면이 안
 * 움직이면 **웹이 안 받는 것**이다.
 */
export const listLog = { tap: 0, hold: 0, state: 0, far: 0, last: '' };

/**
 * **읽던 자리 되돌리기를 폰에서 재는 값**(진단).
 *
 * 되풀이해 드나들면 말풍선이 조금씩 내려간다는 제보를 쫓는 자리인데,
 * **헤드리스로는 한 픽셀도 안 밀린다**(긴 방·짧은 방·사진·이모티콘·
 * 바 세우기 흉내까지 다섯 가지로 재 봤다). 폰에서만 갈리므로 값을 화면에
 * 남겨 읽어 주는 편이 결국 빠르다(`ncStatus`·`kbStat`과 같은 자리다).
 *
 * - `적음` — 나가면서 적어 둔 자리(글 id / 위로 몇 px). 앱 목록이 그린
 *   방이면 뒤에 `앱`이 붙는다 — **그 길은 `saveSpot`이 아니라
 *   `listDetach`가 적는다**(굴린 자리를 앱이 들고 있다).
 * - `깜` — 들어올 때 들고 있던 줄을 깔았는가(`줄 N`) 아니면 받아 왔는가
 * - `놓음` — 되돌린 결과. `건너뜀`이면 그 까닭이 붙는다
 * - `지난` — **드나든 차례대로 적어 둔 자리 넷**(새것이 앞). 아무것도
 *   안 굴리고 드나들면 이 값이 그대로여야 한다 — **조금씩 달라지면
 *   되돌리는 쪽이 어긋나는 것이고, 같은데 화면만 내려가면 그리는 쪽이다.**
 *
 * **까닭이 가려지면 이 줄을 걷어낼 것.**
 */
export const spotLog = { 적음: '', 깜: '', 놓음: '', 판: 0, 지난: [] as string[] };

/** 적어 둔 자리를 기록한다 — 마지막 넷만 남긴다. */
export function spotNote(적음: string): void {
    spotLog.적음 = 적음;
    spotLog.지난.unshift(적음);
    if (spotLog.지난.length > 4) spotLog.지난.length = 4;
}

/** `내 정보` 맨 아래에 적는 줄들. 아직 드나든 적이 없으면 빈 배열이다. */
export function spotStat(): string[] {
    const s = spotLog;
    if (!s.판) return [];
    const out = [`자리${s.판} 적음 ${s.적음 || '-'} · ${s.깜 || '-'} · ${s.놓음 || '-'}`];
    if (s.지난.length > 1) out.push(`지난자리 ${s.지난.join(' · ')}`);
    return out;
}

/** `내 정보` 맨 아래에 적는 한 줄. 값이 하나도 없으면 빈 글자다. */
export function listStat(): string {
    const l = listLog;
    if (!l.tap && !l.hold && !l.state) return '';
    return `목록 탭${l.tap} 홀드${l.hold} 상태${l.state} far${l.far}`
        + (l.last ? ` · ${l.last}` : '');
}

export function onListState(
    cb: (e: { atBottom: boolean; atTop: boolean; far: boolean }) => void,
): Promise<{ remove: () => Promise<void> }> {
    return bridge.addListener('listState', e => {
        listLog.state++;
        if (e.far) listLog.far++;
        cb(e);
    });
}

/**
 * 목록에서 무엇인가를 눌렀다 — 사진(크게 보기)이나 카드(그 화면으로).
 * **하는 일은 웹이 정한다** — 앱은 무엇을 눌렀는지만 알려 준다.
 */
export function onListTap(
    cb: (e: { kind: string; id: string; to: string }) => void,
): Promise<{ remove: () => Promise<void> }> {
    return bridge.addListener('listTap', e => {
        listLog.tap++;
        listLog.last = e.kind;
        cb(e);
    });
}

/**
 * 말풍선을 길게 눌렀다. **창이 뜨는 규칙은 웹에만 있다**(`HoldAt` 조각) —
 * 앱은 누른 말풍선의 자리만 알려 준다.
 */
export function onListHold(
    cb: (e: HoldAt) => void,
): Promise<{ remove: () => Promise<void> }> {
    return bridge.addListener('listHold', e => {
        listLog.hold++;
        listLog.last = 'hold';
        cb(e);
    });
}

/**
 * 길게 누른 창에서 무엇인가를 골랐다(27판).
 * **하는 일은 웹이 정한다** — 앱은 무엇을 골랐는지만 알려 준다.
 * 갈래는 `item`(줄) · `react`(알약) · `close`(바탕을 눌러 닫음)다.
 */
export function onListMenuPick(
    cb: (e: { kind: string; name: string }) => void,
): Promise<{ remove: () => Promise<void> }> {
    return bridge.addListener('listMenuPick', e => {
        listLog.tap++;
        listLog.last = `창:${e.kind}`;
        cb(e);
    });
}

/**
 * **손가락을 따라 뒤로 가기**(35판) — 앱이 세 번 알려 온다.
 *
 * - `start` — 끌기 시작했다. 웹은 **뒤에 깔릴 앞 화면만** 그려 둔다.
 * - `commit` — 그림이 다 빠져나갔다. 웹이 **그때** 뒤로 간다.
 * - `cancel` — 되돌아왔다. 감춰 둔 화면을 도로 내보인다.
 *
 * 끄는 동안에는 아무것도 안 온다 — 그림도 웹뷰도 앱이 옮기므로 다리를
 * 건널 일이 없다(13판 `frame`이 프레임마다 건너던 그 자리와 갈린다).
 */
export function onListBack(
    cb: (e: { phase: string }) => void,
): Promise<{ remove: () => Promise<void> }> {
    return bridge.addListener('listBack', e => {
        listLog.last = `뒤로:${e.phase}`;
        cb(e);
    });
}
