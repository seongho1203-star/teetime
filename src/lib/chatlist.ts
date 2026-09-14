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

/** 지금 판에서 앱 목록을 쓸 수 있는가. 옛 앱은 판 번호로 걸러진다. */
export function canNativeList(): boolean {
    return ncLog.ready === true && ncLog.v >= 17 && listOn();
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
    /** `text` 말풍선 · `system` 가운데 안내 줄 · `other` 아직 앱이 못 그리는 것. */
    kind: 'text' | 'system' | 'other';
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
        pad: 9, avatar: 29, avatarGap: 7, radius: 11,
        fontSize: 15, lineHeight: 18, padH: 11, padV: 8.5,
        nameSize: 13.5, stampSize: 10, maxRatio: 0.684,
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
    listDetach(): Promise<void>;
    addListener(
        n: 'listState',
        cb: (e: { atBottom: boolean; atTop: boolean }) => void,
    ): Promise<{ remove: () => Promise<void> }>;
};

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

export function onListState(
    cb: (e: { atBottom: boolean; atTop: boolean }) => void,
): Promise<{ remove: () => Promise<void> }> {
    return bridge.addListener('listState', cb);
}
