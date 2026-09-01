/**
 * DB 테이블 모양. supabase/schema.sql 과 짝이다 — 한쪽만 고치지 말 것.
 *
 * Supabase CLI로 자동 생성할 수도 있지만(`supabase gen types`), 그러려면
 * CLI 로그인과 프로젝트 연결이 필요하다. 테이블이 열 개뿐이라 손으로 적었다.
 */

/**
 * 회원 등급.
 *   pending 승인 대기 · member 일반회원 · treasurer 총무
 *   staff 부운영자 · admin 운영자(방장) · superadmin 앱관리자
 *   banned 추방 — 행을 남겨 두는 것이 곧 막는 방법이다. 지우면 다시
 *          로그인할 때 앱이 대기 상태로 되살려 버린다.
 *
 * **운영진**(부운영자 이상)이 하는 일은 같다 — 가입 승인·공지·남의 글 정리.
 * 갈리는 것은 **임명**뿐이다(`TITLES` 참고).
 * **총무는 운영진이 아니다** — 정산만 맡는다(`canSettle`).
 */
export type Role =
    | 'pending' | 'member' | 'treasurer' | 'staff' | 'admin' | 'superadmin' | 'banned';

export const ROLE_LABEL: Record<Role, string> = {
    pending:    '대기',
    member:     '일반회원',
    treasurer:  '총무',
    staff:      '부운영자',
    admin:      '운영자',
    superadmin: '앱관리자',
    banned:     '추방',
};

/**
 * 직책은 넷이다 — 앱관리자 · 운영자 · 부운영자 · 총무. 나머지는 일반회원이다.
 * **임명은 위에서 아래로만 된다:**
 *   앱관리자 → 운영자를 임명·해제
 *   운영자   → 부운영자·총무를 임명·해제 (인원 제한 없음)
 * 화면에서 버튼을 감추는 것으로 끝내지 않는다 — DB의 `profiles_owner`
 * 정책이 같은 규칙을 다시 본다.
 */
export const TITLES: Role[] = ['superadmin', 'admin', 'staff', 'treasurer'];

/** 명단에서 이름 옆에 붙는 표. 일반회원은 안 붙인다. */
export const ROLE_TAG: Partial<Record<Role, string>> = {
    superadmin: 'role-super',
    admin:      'role-admin',
    staff:      'role-staff',
    treasurer:  'role-treasurer',
};

/** 이 사람이 정산을 만들 수 있는가. DB의 `can_settle()`과 같은 잣대다. */
export function canSettle(role?: Role | null): boolean {
    return role === 'treasurer' || role === 'staff'
        || role === 'admin' || role === 'superadmin';
}
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

/**
 * 사람 목록이 이보다 길면 **늘어놓지 않고 찾게 한다.**
 *
 * 열둘이면 네 줄이라 눈으로 훑는 게 빠르고, 검색칸만 하나 더 생겨 성가시다.
 * 그 위로는 늘어놓는 것이 오히려 방해다 — 정산에서 마흔여섯 명을 폈더니
 * 목록만 602px였고, 회원 명단은 100명에서 6,495px(화면 여덟 장)이었다.
 * **정산의 사람 고르기와 회원 명단이 같은 잣대를 쓴다.** */
export const FIND_AT = 12;

/**
 * 이름과 얼굴만 필요한 곳에서 쓰는 가벼운 프로필.
 *
 * **명단 말고는 아무도 전화번호·가입일을 안 본다.** 그런데 거의 모든
 * 화면이 `fetchProfiles()`로 전체 명단을 받으므로, 안 쓰는 칸이 100명분씩
 * 화면마다 따라왔다 — 100명 기준 58KB 중 38KB가 그것이었다.
 * 이름표를 붙이는 곳은 `fetchPeople()`로 이 다섯 칸만 받는다.
 *
 * - `role` — 대화에서 `@전체`를 도드라지게 할지 가른다.
 * - `car` — **라운드 상세의 참가자 줄에 보인다**(골프장에 차를 미리
 *   등록할 때 쓴다). 두 화면에서만 쓰지만 짧은 값이라(100명에 2KB)
 *   여기 넣어 두고 명단 타입을 하나로 유지한다.
 */
export type Person = Pick<Profile, 'id' | 'name' | 'avatar_url' | 'role' | 'car'>;

/**
 * 조 편성 화면이 받는 명단. **`Person`에 성별·태어난 해를 더한 것**이다.
 *
 * **`Person`에 그냥 넣지 않는다.** 명단은 거의 모든 화면이 받는데(홈·대화·
 * 투표…), 조 편성 말고는 이 둘을 안 쓴다 — 100명이면 화면마다 3KB가 그냥
 * 따라다닌다. 여기만 넓게 받는다(운영진이 가끔 여는 화면이라 값이 싸다).
 */
export type GroupPerson =
    Pick<Profile, 'id' | 'name' | 'avatar_url' | 'gender' | 'birth_year'>;

/** 성별. 조 편성에서 남녀를 고르게 섞는 데만 쓴다. */
export type Gender = 'm' | 'f';
export const GENDER_LABEL: Record<Gender, string> = { m: '남', f: '여' };

/** 태어난 해로 받을 수 있는 범위. DB의 `profiles_birth_year_check`와 같다. */
export const BIRTH_MIN = 1930;
export const BIRTH_MAX = 2020;

/**
 * 적은 글자를 저장할 값으로 바꾼다.
 * 비었으면 `null`(안 적은 것), 범위 밖이면 `false`(잘못 적은 것).
 *
 * **가입 화면과 `내 정보`가 같은 잣대를 쓰게 하려고 여기 둔다.**
 * 화면 파일에서 함수를 내보내면 fast refresh가 깨진다는 경고가 붙는다
 * (`pollClosed`를 여기 둔 것과 같은 이유다).
 */
export function birthValue(text: string): number | null | false {
    const t = text.trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isInteger(n) || n < BIRTH_MIN || n > BIRTH_MAX) return false;
    return n;
}

/**
 * 이 사람이 성별·태어난 해를 아직 안 적었는가 (로그인 뒤 한 번 막고 받는다).
 *
 * **`null`과 `undefined`를 반드시 갈라야 한다.**
 * - `null` — 칸은 있는데 안 적은 것. 받아야 한다.
 * - `undefined` — **DB에 그 칸이 아예 없는 것**(스키마를 아직 다시 안 돌린
 *   저장소). 이때 막으면 **회원 모두가 앱에 못 들어간다** — 저장하려 해도
 *   없는 칸이라 오류가 나서 영영 빠져나올 수가 없다. 그래서 칸이 있는 것이
 *   확인될 때만 막는다(`select('*')`라 없는 칸은 키 자체가 안 온다).
 *
 * 앱은 푸시하면 몇 분 뒤 올라가는데 `schema.sql`은 사람이 손으로 붙여넣으므로,
 * 그 사이에는 **칸이 없는 DB에 새 앱이 붙는다.** 여기가 그 시간을 견디는 곳이다.
 */
export function needsProfile(p?: Profile | null): boolean {
    if (!p) return false;
    if (!('gender' in p) || !('birth_year' in p)) return false;   // 칸이 아직 없다
    return p.gender == null || p.birth_year == null;
}

export type Profile = {
    id: string;
    /** 화면에 보이는 이름. 가입할 때 **닉네임**으로 받는다. */
    name: string;
    avatar_url: string | null;
    role: Role;
    /** 대화를 언제부터 볼 수 있는가. 승인된 순간이 찍힌다. */
    joined_at: string | null;
    /** 차량번호. **골프장에 미리 차를 등록할 때** 쓴다(카풀과는 무관). */
    car: string | null;
    /**
     * 조 편성에 쓰는 두 칸. **둘 다 비어 있을 수 있다.**
     *
     * 이 기능 이전에 가입한 사람은 전부 `null`이라 필수로 잡을 수 없었다 —
     * 조 편성 쪽이 모르는 사람을 따로 모아 고르게 흩뿌린다(`lib/groups.ts`).
     * 스키마를 아직 다시 안 돌린 저장소에서는 칸 자체가 없어 `undefined`도
     * 온다(`roundKind`와 같은 사정이다).
     *
     * **나이가 아니라 태어난 해다** — 나이를 적으면 해가 바뀔 때마다 틀린
     * 값이 되고 아무도 고치러 오지 않는다.
     */
    gender: Gender | null;
    birth_year: number | null;
    /** 예전에 받던 값. 지금은 화면에서 안 쓰지만 적어 둔 것이 남아 있다. */
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

/**
 * 목록 카드가 그리는 데 필요한 라운드의 칸들.
 *
 * **`note`(전달 내용)를 안 받는다** — 목록에는 안 나오는데 한 줄이 수백
 * 글자라, 라운드 마흔 건이면 그것만으로 수십 KB다. 좌표(`lat`/`lon`)도
 * 마찬가지다: 날씨는 홈과 상세에만 있다.
 * (홈은 날씨를 그리므로 `Round` 전부를 받는다.)
 */
export type RoundLite = Pick<Round,
    'id' | 'course' | 'title' | 'tee_at' | 'capacity' | 'fee' | 'status' | 'kind' | 'caddie' | 'cart'>;

export type Signup = {
    id: string;
    round_id: string;
    user_id: string;
    state: SignupState;
    seq: number;
    note: string;
    /**
     * 몇 조인가. 안 정했으면 null — 조를 안 짜는 라운드가 대부분이라
     * 그게 기본이다. 스키마를 아직 안 돌린 저장소에는 이 칸이 아예
     * 없으므로 `undefined`도 온다(`roundKind`와 같은 사정이다).
     */
    grp: number | null;
    created_at: string;
};

/**
 * 조 편성이 공개됐다는 표시. 라운드 하나에 한 줄이다.
 *
 * 조 번호는 사람(`signups.grp`)에 붙어 있고, 이 줄은 **언제 누가 짰는지**와
 * **조별 시각**을 담는다. 알림이 여기 걸려 있어서, 열여섯 명을 배정해도
 * 폰은 한 번만 울린다.
 */
export type RoundGroup = {
    round_id: string;
    /** `{"1": "2026-09-01T07:00:00+09:00", ...}` — 키가 조 번호다. */
    tees: Record<string, string>;
    posted_by: string | null;
    posted_at: string;
};

/** 한 라운드에 짤 수 있는 조의 최대 개수. DB의 `signups_grp_check`와 같다. */
export const MAX_GROUPS = 20;

/** 한 조에 몇 명을 넣을까. 필드는 네 명이 한 팀이라 그게 기본이다. */
export const GROUP_SIZE = 4;

/** 입금 독촉을 보낸 기록. 총무만 본다. */
export type SettleReminder = {
    id: string;
    settlement_id: string;
    created_by: string | null;
    created_at: string;
};

/**
 * 목록에서 쓰는 신청 기록의 최소 조각.
 *
 * **목록은 자리 수와 내 상태만 본다** — `id` · `note` · `created_at`은
 * 상세에서만 쓴다. 100명 · 1년치로 재 보니 라운드 목록이 받는 것의 절반이
 * 이 안 쓰는 칸들이었다. 그래서 홈과 라운드 목록은 **네 칸만 받는다.**
 * (상세 화면은 그대로 `Signup` 전부를 받는다 — 한 라운드어치뿐이다.)
 *
 * `seq`는 대기 번호를 매기는 데 쓴다 — 이 값 자체가 대기 번호는 **아니다.**
 * 그 라운드의 몇 번째 신청인지라, 정원이 4명이면 대기 첫 사람이 5다.
 * 대기 줄에서 몇 번째인지는 `seq`로 줄을 세운 뒤 세어야 한다(홈이 그렇게 한다).
 */
export type SignupLite = Pick<Signup, 'round_id' | 'user_id' | 'state' | 'seq'>;

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

/**
 * 목록·상세에서 쓰는 표의 최소 조각.
 *
 * 화면이 보는 것은 **어느 투표의 · 어느 항목을 · 누가** 골랐나, 이 셋뿐이다.
 * 표 한 줄의 `id`와 `created_at`은 아무 데서도 안 쓰는데 둘이 합쳐 줄의
 * 절반이 넘는다. 100명이 스물네 번 투표하면 표가 3천 줄이라 그 차이가 곧
 * 수백 KB다.
 */
export type PollVoteLite = Pick<PollVote, 'poll_id' | 'option_id' | 'user_id'>;

/** 투표에 달린 댓글. `PostComment`와 같은 모양이다. */
export type PollComment = {
    id: string;
    poll_id: string;
    author_id: string | null;
    body: string;
    created_at: string;
};

/** 라운드에 달린 댓글. `PostComment`와 같은 모양이다. */
export type RoundComment = {
    id: string;
    round_id: string;
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

/**
 * 사람마다 **그 방을 어디까지 읽었나.**
 *
 * 말풍선 옆의 `안 읽은 사람 수`가 이걸로 셈해진다(`lib/reads.ts`).
 * 글마다가 아니라 **사람마다 한 줄**이라 해가 지나도 안 늘어난다.
 */
export type RoomRead = {
    room_id: string;
    user_id: string;
    last_read_at: string;
};

export type Room = {
    id: string;
    name: string;
    round_id: string | null;
    created_at: string;
};

/** 정산 한 건. 라운드 하나에 여러 건이 달릴 수 있다. */
export type Settlement = {
    id: string;
    round_id: string;
    title: string;
    body: string;
    bank: string;
    account: string;
    /** 총금액(원). 1/N은 화면이 계산해 사람마다 `amount`로 적어 둔다. */
    total: number;
    created_by: string | null;
    created_at: string;
};

/** 정산에서 한 사람이 낼 몫. **금액을 그대로 적는다** — 중간에 들어온
 *  사람은 다른 금액이라, 1/N 계산식으로는 담기지 않는다. */
export type SettlementShare = {
    id: string;
    settlement_id: string;
    user_id: string;
    amount: number;
    paid: boolean;
    created_at: string;
};

export type Message = {
    id: string;
    room_id: string;
    user_id: string | null;
    body: string;
    /** 앱이 스스로 남긴 줄(라운드·투표 알림). 말풍선이 아니라 가운데 한 줄. */
    system: boolean;
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
            round_comments: Table<RoundComment>;
            settlements: Table<Settlement>;
            settlement_shares: Table<SettlementShare>;
            settle_reminders: Table<SettleReminder>;
            round_groups: Table<RoundGroup>;
            posts: Table<Post>;
            post_comments: Table<PostComment>;
            rooms: Table<Room>;
            messages: Table<Message>;
            room_reads: Table<RoomRead>;
            push_subscriptions: Table<PushSubscriptionRow>;
        };
        Views: Record<string, never>;
        Functions: {
            join_round: { Args: { p_round: string; p_note?: string }; Returns: Signup };
            leave_round: { Args: { p_round: string }; Returns: void };
            kick_signup: { Args: { p_round: string; p_user: string }; Returns: void };
            /**
             * 조 편성을 통째로 저장한다. `p_grps`는 `{"<사람 id>": 2, ...}`,
             * `p_tees`는 `{"1": "2026-09-01T07:00:00+09:00", ...}`.
             * **목록에 없는 사람은 조에서 빠진 것으로 본다** — 화면이 늘
             * 확정자 전원을 실어 보내므로 '빼기'를 따로 부르지 않는다.
             */
            set_round_groups: {
                Args: {
                    p_round: string;
                    p_grps: Record<string, number | null>;
                    p_tees?: Record<string, string>;
                };
                Returns: void;
            };
            cast_vote: { Args: { p_option: string }; Returns: void };
            retract_vote: { Args: { p_option: string }; Returns: void };
            is_member: { Args: Record<string, never>; Returns: boolean };
            is_admin: { Args: Record<string, never>; Returns: boolean };
            is_owner: { Args: Record<string, never>; Returns: boolean };
            can_settle: { Args: Record<string, never>; Returns: boolean };
            mark_room_read: { Args: { p_room: string }; Returns: void };
        };
        Enums: Record<string, never>;
        CompositeTypes: Record<string, never>;
    };
};
