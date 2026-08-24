/**
 * DB 테이블 모양. supabase/schema.sql 과 짝이다 — 한쪽만 고치지 말 것.
 *
 * Supabase CLI로 자동 생성할 수도 있지만(`supabase gen types`), 그러려면
 * CLI 로그인과 프로젝트 연결이 필요하다. 테이블이 열 개뿐이라 손으로 적었다.
 */

/**
 * 회원 등급.
 *   pending 승인 대기 · member 회원 · staff 부운영자 · admin 운영자
 *   banned  추방 — 행을 남겨 두는 것이 곧 막는 방법이다. 지우면 다시
 *           로그인할 때 앱이 대기 상태로 되살려 버린다.
 *
 * **운영자는 한 사람, 부운영자는 두엇**이라는 게 이 모임의 모양이다.
 * 둘이 하는 일은 같고(가입 승인·공지·남의 글 정리), 부운영자를 임명하고
 * 푸는 것만 운영자가 한다.
 */
export type Role = 'pending' | 'member' | 'staff' | 'admin' | 'banned';

export const ROLE_LABEL: Record<Role, string> = {
    pending: '대기',
    member:  '회원',
    staff:   '부운영자',
    admin:   '운영자',
    banned:  '추방',
};
export type RoundStatus = 'open' | 'closed' | 'done' | 'cancelled';

/**
 * 필드인가 스크린인가.
 *
 * 겨울과 비 오는 날에는 스크린이 훨씬 잦아서, 목록에 섞여 있으면 어느
 * 것인지 열어 봐야 안다. 그래서 **종류를 행에 못 박는다** — 이름만으로
 * 가리려 들면 `골프존파크 상무점` 같은 것을 매번 사람이 알아봐야 한다.
 *
 * 스크린이면 실내라 **날씨가 없고, 캐디·카트도 없다.** 화면 세 곳
 * (모집 열기 · 목록 카드 · 상세)이 이 값 하나를 보고 갈린다.
 */
export type RoundKind = 'field' | 'screen';

/** 라운드 조건. 화면 여러 곳이 같은 말을 쓰도록 여기 모아 둔다. */
export const KIND_LABEL: Record<RoundKind, string> = { field: '필드', screen: '스크린' };
/** 글자를 안 늘리고 목록에서 한눈에 가르는 표식. */
export const KIND_ICON: Record<RoundKind, string> = { field: '⛳', screen: '🎯' };
/** 스크린은 골프장이 아니라 매장이고, 티오프가 아니라 시작 시각이다. */
export const PLACE_LABEL: Record<RoundKind, string> = { field: '골프장', screen: '매장' };
export const TEE_LABEL: Record<RoundKind, string> = { field: '티오프', screen: '시작' };
/** 필드에서 내는 돈은 그린피, 스크린에서는 게임비다. 앞에 `1인`을 붙여 쓴다. */
export const FEE_LABEL: Record<RoundKind, string> = { field: '그린피', screen: '게임비' };

export const CADDIE_LABEL = { caddie: '캐디', none: '노캐디' } as const;
export const CART_LABEL = { included: '카트 포함', excluded: '카트 미포함' } as const;

/**
 * 라운드 상세의 표에 넣는 짧은 형태.
 *
 * 그 표는 이름과 값이 따로 있어(`캐디` / `카트`) 위의 긴 말을 그대로 쓰면
 * `캐디: 캐디`, `카트: 카트 포함`처럼 되풀이된다. 이름이 이미 있는 자리에서는
 * 값만 남긴다. 목록 카드와 모집 열기는 이름 없이 홀로 서므로 긴 쪽을 쓴다.
 */
export const CADDIE_SHORT = { caddie: '있음', none: '없음' } as const;
export const CART_SHORT = { included: '포함', excluded: '미포함' } as const;

/**
 * 행에서 종류를 읽는다. **`r.kind`를 직접 보지 말 것** — 스키마를 아직
 * 다시 안 돌린 저장소에는 그 칸이 아예 없어 `undefined`가 온다. 종류가
 * 생기기 전에 올린 라운드는 모두 필드였으므로 그쪽으로 기운다.
 */
export function roundKind(r: { kind?: RoundKind | null }): RoundKind {
    return r.kind === 'screen' ? 'screen' : 'field';
}
export type SignupState = 'confirmed' | 'waitlist';

export type Profile = {
    id: string;
    name: string;
    avatar_url: string | null;
    role: Role;
    /** 대화를 언제부터 볼 수 있는가. 승인된 순간이 찍힌다. */
    joined_at: string | null;
    handicap: number | null;
    phone: string | null;
    memo: string;
    created_at: string;
};

export type Round = {
    id: string;
    title: string;
    course: string;
    lat: number | null;
    lon: number | null;
    tee_at: string;
    capacity: number;
    fee: number;
    note: string;
    status: RoundStatus;
    /** 필드인가 스크린인가. 예전 행은 DB 기본값으로 모두 'field'다. */
    kind: RoundKind;
    /** 캐디를 쓰는가. 안 정했으면 null. */
    caddie: 'caddie' | 'none' | null;
    /** 카트비가 참가비에 들어 있는가. 안 정했으면 null. */
    cart: 'included' | 'excluded' | null;
    opens_at: string | null;
    created_by: string | null;
    created_at: string;
};

export type Signup = {
    id: string;
    round_id: string;
    user_id: string;
    state: SignupState;
    seq: number;
    note: string;
    created_at: string;
};

/**
 * 마감된 투표인가. 손으로 마감했거나 마감 시각이 지났으면 끝난 것이다.
 * **목록·상세·탭 숫자가 같은 잣대를 써야 한다** — 한 곳만 고치면 목록에는
 * 진행중인데 눌러 들어가면 마감인 일이 생긴다. (`roundKind`와 같은 이유로
 * 화면이 아니라 여기 둔다 — 화면 파일에서 함수를 내보내면 fast refresh가
 * 깨진다는 경고도 함께 붙었다.)
 */
export function pollClosed(p: Pick<Poll, 'closed' | 'closes_at'>): boolean {
    return p.closed || (p.closes_at !== null && new Date(p.closes_at) < new Date());
}

export type Poll = {
    id: string;
    title: string;
    body: string;
    multi: boolean;
    anonymous: boolean;
    closes_at: string | null;
    closed: boolean;
    created_by: string | null;
    created_at: string;
};

export type PollOption = {
    id: string;
    poll_id: string;
    label: string;
    sort: number;
};

export type PollVote = {
    id: string;
    poll_id: string;
    option_id: string;
    user_id: string;
    created_at: string;
};

/** 투표에 달린 댓글. `PostComment`와 같은 모양이다. */
export type PollComment = {
    id: string;
    poll_id: string;
    author_id: string | null;
    body: string;
    created_at: string;
};

export type Post = {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    author_id: string | null;
    created_at: string;
    updated_at: string;
};

export type PostComment = {
    id: string;
    post_id: string;
    author_id: string | null;
    body: string;
    created_at: string;
};

export type Room = {
    id: string;
    name: string;
    round_id: string | null;
    created_at: string;
};

export type Message = {
    id: string;
    room_id: string;
    user_id: string | null;
    body: string;
    /** 함께 보낸 사진의 공개 주소. 사진이 없으면 null. */
    image_url: string | null;
    /** 답장이면 원본 글의 id. 원본이 지워지면 null이 된다. */
    reply_to: string | null;
    created_at: string;
};

/** 알림을 받을 기기 한 대. 사람이 아니라 **기기** 단위다. */
export type PushSubscriptionRow = {
    endpoint: string;
    user_id: string;
    p256dh: string;
    auth: string;
    ua: string;
    /** 이 기기로 대화 알림을 받는가. 대화만 따로 끌 수 있다. */
    chat: boolean;
    created_at: string;
};

/** supabase-js 제네릭에 넣을 최소한의 형태. */
type Table<Row> = {
    Row: Row;
    Insert: Partial<Row>;
    Update: Partial<Row>;
    Relationships: [];
};

export interface Database {
    public: {
        Tables: {
            profiles: Table<Profile>;
            rounds: Table<Round>;
            signups: Table<Signup>;
            polls: Table<Poll>;
            poll_options: Table<PollOption>;
            poll_votes: Table<PollVote>;
            poll_comments: Table<PollComment>;
            posts: Table<Post>;
            post_comments: Table<PostComment>;
            rooms: Table<Room>;
            messages: Table<Message>;
            push_subscriptions: Table<PushSubscriptionRow>;
        };
        Views: Record<string, never>;
        Functions: {
            join_round: { Args: { p_round: string; p_note?: string }; Returns: Signup };
            leave_round: { Args: { p_round: string }; Returns: void };
            kick_signup: { Args: { p_round: string; p_user: string }; Returns: void };
            cast_vote: { Args: { p_option: string }; Returns: void };
            retract_vote: { Args: { p_option: string }; Returns: void };
            is_member: { Args: Record<string, never>; Returns: boolean };
            is_admin: { Args: Record<string, never>; Returns: boolean };
        };
        Enums: Record<string, never>;
        CompositeTypes: Record<string, never>;
    };
};
