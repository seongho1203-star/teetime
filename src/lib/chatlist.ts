import { formatChatDay, kstDate, kstMinute } from './format';
import { NativeComposer, hush, ncLog } from './composer';
import type { Message } from './types';

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
 * ## 되물러남 — 기본은 꺼짐이다
 *
 * **`teetime:nc-list`를 `on`으로 적어야 켜진다**(`내 정보`의 스위치).
 * 여기는 **헤드리스로 한 줄도 확인할 수 없는 자리**라(맥도 아이폰도 없다)
 * 14판 `ListSlider`와 같은 잣대를 쓴다 — 매일 쓰는 화면을 짐작으로 갈아
 * 끼우지 않는다.
 *
 * 켜 두어도 **앱 목록이 실제로 서서 줄을 받아 그렸다고 알려 줄 때만** 웹이
 * 제 목록을 감춘다(`visibility: hidden` — 자리는 그대로 둔다).
 */

const KEY = 'teetime:nc-list';

/** 켜 두었는가(스위치 하나만 본다 — 화면에서 그대로 보여 준다). */
export function listOn(): boolean {
    try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}

export function setListOn(on: boolean): void {
    try {
        if (on) localStorage.setItem(KEY, 'on');
        else localStorage.removeItem(KEY);
    } catch { /* 사파리 잠금 */ }
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
 * **지금은 23판이다** — 사진·이모티콘·눌리는 카드(2판) · 인용·반응 알약·
 * `여기까지 읽으셨습니다` 줄(3판) · 손짓(4판) · 굴리기 얽힘(5판)까지
 * 앱이 맡고, **웹이 바 위에 그리는 것을 가리지 않는다**(`lift`).
 * 그 아래 판을 든 폰은 못 그리거나(사진이 글자로 보인다) 못 움직여서
 * (길게 눌러도 창이 안 뜬다), **같은 수로 웹 목록으로 되돌린다.**
 *
 * **20 → 21 → 22 → 23이 그 본보기다** — 20판은 얼굴·인용·밀기가 안 눌리고
 * `최근 대화로` 줄이 가려 안 보였고, **21판은 이모티콘이 한 장도 안 떠
 * 말풍선 자리가 통째로 비었으며**(앱 안에 든 그림을 인터넷에서 받으려
 * 했다), **22판은 인용·언급 목록·서랍이 목록 뒤에 깔려 안 보였다**
 * (`@언급 안됨` · `이모티콘 안나옴` · `답장 안걸림`이 다 그 한 자리였다).
 * 수를 올려 두면 그 판을 든 폰은 **웹만 밀어도 그날로** 웹 목록으로
 * 돌아오고, 새 앱을 받으면 저절로 앱 목록으로 돌아온다.
 */
export function canNativeList(): boolean {
    return ncLog.ready === true && ncLog.v >= 23 && listOn();
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

/* ── 앱에 넘기는 한 줄 ───────────────────────────────────── */

export type ListRow = {
    id: string;
    /**
     * `text` 말풍선 · `system` 가운데 안내 줄 · `photo` 사진 · `sticker`
     * 이모티콘 · `card` 눌러서 들어가는 안내 카드 · `other` 아직 앱이
     * 못 그리는 것(자리만 잡고 무슨 줄인지만 적는다).
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
    /** 아직 못 그리는 줄에 적을 말(`사진`·`이모티콘`). */
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
};

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
        /* 카드의 `보러 가기 ›`. **분홍(`--brand`)을 쓰지 말 것** — 그건
           '지금 눌러야 할 것' 자리이고 이건 알려 주는 값이다. */
        link: read(root, '--grass', '#4c8c2f'),
        card: read(root, '--surface', '#ffffff'),
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
        /* `최근 대화로` 줄(웹의 `.chat-jump`). **앱이 그린다** — 그 단추는
           목록 위에 떠 있는데 앱 목록은 웹 화면 **위에 얹힌 앱 부품**이라
           웹이 그리면 통째로 가려진다(사용자 제보 — `최신대화로 버튼
           안나옴`). 네이티브 바에서 겪은 그 자리다.
           값은 `.chat-jump`와 같은 것이다 — **한쪽만 고치지 말 것.** */
        jumpBg: read(root, '--surface', '#ffffff'),
        jumpLine: read(root, '--line', 'rgba(0,0,0,0.1)'),
        jumpDim: read(root, '--text-dim', '#5b6455'),
        jumpH: 38, jumpSize: 13,
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
    listAttach(o: Record<string, unknown>): Promise<{ ok?: boolean }>;
    listRows(o: { rows: ListRow[]; stickBottom: boolean }): Promise<{ ok?: boolean; n?: number }>;
    listSet(o: Record<string, unknown>): Promise<void>;
    listScrollTo(o: { id: string; place?: string; flash?: boolean }): Promise<{ ok?: boolean }>;
    listDetach(): Promise<void>;
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
};

/** 길게 누른 말풍선의 자리 — **창(화면) 좌표다**(웹의 `getBoundingClientRect`와 같은 자). */
export type HoldAt = { id: string; mine: boolean; x: number; y: number; w: number; h: number };

const bridge = NativeComposer as unknown as Bridge;

/** 목록을 세운다. **바가 먼저 서 있어야 한다** — 안 서 있으면 앱이 거절한다. */
export async function listAttach(o: Record<string, unknown>): Promise<boolean> {
    try {
        const r = await bridge.listAttach(o);
        return r?.ok === true;
    } catch {
        return false;
    }
}

export async function listRows(rows: ListRow[], stickBottom: boolean): Promise<void> {
    await hush(bridge.listRows({ rows, stickBottom }));
}

export async function listSet(o: Record<string, unknown>): Promise<void> {
    await hush(bridge.listSet(o));
}

export async function listDetach(): Promise<void> {
    await hush(bridge.listDetach());
}

/**
 * 그 글로 뛴다 — 인용을 눌렀을 때 · 검색 결과를 골랐을 때 ·
 * `여기까지 읽으셨습니다` 줄로 내려놓을 때.
 *
 * **못 찾으면 거짓이다**(아직 안 받아 온 지난 묶음의 글) — 그때 무엇을
 * 알릴지는 웹이 정한다(`지난 대화에 있습니다. 위로 올려 주세요.`).
 */
export async function listScrollTo(
    id: string, place: 'center' | 'top' = 'center', flash = false,
): Promise<boolean> {
    try {
        const r = await bridge.listScrollTo({ id, place, flash });
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
