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
 * `내 정보` 맨 아래에 적는 앱 판 — `버전 1.28`(사용자 요청 —
 * `빌드가 28이다면 1.28 이런식으로`).
 *
 * **앞자리는 손으로 정하고 뒷자리는 빌드 번호다.**
 *
 * - 앞자리(`MAJOR`)는 **`ios/App/App.xcodeproj/project.pbxproj`의
 *   `MARKETING_VERSION` 앞자리와 같아야 한다** — 앱스토어에 적히는 판이
 *   그쪽이라 어긋나면 회원이 보는 판과 스토어의 판이 달라진다. Xcode 쪽을
 *   웹에서 읽을 길이 없어 한 군데로 못 모았으니, 판을 올릴 때 함께 고칠 것.
 * - 뒷자리는 **앱 빌드 번호**(`CURRENT_PROJECT_VERSION`)다. 워크플로가
 *   `github.run_number`로 넣으므로 사람이 챙길 것이 없고, TestFlight에
 *   `1.0 (28)`로 적히는 그 숫자와 같다. **폰에서 새 앱을 받았는지 가릴 수
 *   있는 유일한 값이라** 화면에 세웠다 — 화면이 앱 안에 담겨 있어 앱을
 *   새로 깔기 전에는 안 바뀌는 것이 정상이기 때문이다.
 *
 * **웹(GitHub Pages)에서는 `1.0`이다.** 거기엔 빌드 번호라는 것이 없고,
 * 웹은 밀면 몇 분 뒤 저절로 바뀌므로 가릴 값도 필요 없다 — 덕분에
 * **그 숫자만 봐도 지금 보고 있는 것이 앱인지 웹인지 갈린다.**
 * **웹 워크플로의 번호를 대신 넣지 말 것** — 두 워크플로의 번호는 서로
 * 다른 셈이라 같은 자리에 적으면 거짓말이 된다. */
const MAJOR = '1';
export const APP_VERSION = `${MAJOR}.${__APP_BUILD__ || '0'}`;

/**
 * 이름표를 붙이는 곳에서 쓰는 명단 한 줄.
 *
 * **`select('*')`로 통째로 받지 않는다.** 거의 모든 화면이 명단을 받으므로
 * 안 쓰는 칸이 100명분씩 화면마다 따라온다 — 100명 기준 58KB 중 38KB가
 * 그것이었다. `fetchPeople()`이 여기 적힌 칸만 받는다.
 *
 * - `role` — 대화에서 `@전체`를 도드라지게 할지 가른다.
 * - `gender` — 얼굴 테두리 색을 가른다.
 * - `birth_year` · `region` — 이름표가 `83/신성호/광산구`로 적힌다
 *   (`personLabel`). 이 셋이 **모든 화면에 필요해져서** 예전의 좁은 명단에
 *   더했다 — 100명에 3.5KB 늘고, 대신 `car`가 빠져 그만큼 상쇄된다.
 *
 * **뒤 셋은 없을 수도 있다(`undefined`).** 스키마를 아직 다시 안 돌린
 * 저장소에는 칸이 아예 없어서, `fetchPeople()`이 좁은 목록으로 물러난다.
 * 쓰는 쪽은 `null`과 `undefined`를 똑같이 '모른다'로 다루면 된다.
 *
 * **전화번호·차량번호는 여기 없다.** 다른 표에 있고 운영진만 본다
 * (`Contact` · `fetchContacts()`).
 */
export type Person =
    Pick<Profile, 'id' | 'name' | 'avatar_url' | 'role'>
    & Partial<Pick<Profile, 'gender' | 'birth_year' | 'region'>>;

/**
 * 조 편성이 보는 명단. **지금은 `Person`과 같다** — 성별·태어난 해가
 * 이름표에 쓰이면서 명단에 늘 따라오게 됐기 때문이다. 이름은 남겨 둔다:
 * `lib/groups.ts`가 무엇을 보고 나누는지 그 이름으로 드러난다.
 */
export type GroupPerson = Person;

/**
 * 전화번호·차량번호. **`profiles`가 아니라 `profile_private`에 있다.**
 *
 * RLS는 줄 단위라 한 표 안에서 칸만 가릴 수가 없어, **운영진만 보게 하려면
 * 표를 나누는 수밖에 없었다**(schema.sql의 `profile_private` 참고).
 * 받는 쪽은 `fetchContacts()` 하나다 — 회원 누구나 부를 수 있고, 정책이
 * **본인 것 한 줄**(또는 운영진이면 전부)만 돌려준다.
 */
export type Contact = { id: string; phone: string | null; car: string | null };

/** 성별. 조 편성과 얼굴 테두리 색이 본다. */
export type Gender = 'm' | 'f';
export const GENDER_LABEL: Record<Gender, string> = { m: '남', f: '여' };

/** 거주지역은 여덟 글자까지. DB의 `profiles_region_check`와 같은 값이다. */
export const REGION_MAX = 8;

/**
 * 화면에 적는 이름 — `83/신성호/광산구`.
 *
 * **100명 모임에서는 닉네임만으로 누군지 모른다**(사용자 요청). 태어난 해
 * 뒤 두 자리 · 닉네임 · 거주지역을 `/`로 잇는다.
 *
 * **모르는 조각은 그냥 뺀다** — `신성호/광산구`, `83/신성호`, `신성호`가
 * 모두 정상이다. 아직 안 적은 사람과 스키마를 다시 안 돌린 저장소가 그런데,
 * 빈칸을 `//`로 남기면 고장 난 것처럼 보인다.
 *
 * **`@언급`은 이 값을 쓰지 않는다** — 거기는 `name` 그대로여야 한다
 * (`lib/mention.ts`). 이름표만 길어지고 부르는 말은 닉네임 그대로다.
 */
export function personLabel(p?: {
    name?: string | null; birth_year?: number | null; region?: string | null;
} | null): string {
    if (!p) return '';
    const name = (p.name ?? '').trim();
    const year = p.birth_year != null ? String(p.birth_year % 100).padStart(2, '0') : '';
    const region = (p.region ?? '').trim();
    return [year, name, region].filter(Boolean).join('/');
}

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
 * 이 사람이 성별·태어난 해·거주지역을 아직 안 적었는가 (로그인 뒤 한 번 막고 받는다).
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
    // 칸이 아직 없는 저장소에서는 아무도 막지 않는다.
    if (!('gender' in p) || !('birth_year' in p) || !('region' in p)) return false;
    /* **닉네임도 본다** — 애플로 로그인하면 이름이 없을 수 있다. 애플은
       이름을 맨 처음 허락할 때 딱 한 번만 주고, 우리는 그것을 아예 안 받는다
       (`signInWithApple` 참고). 이름이 빈 사람은 명단에서 누군지 알 수 없어
       운영진이 승인할 수도 없으므로 여기서 한 번 받는다.
       `not null default ''`인 칸이라 옛 저장소에서도 늘 있다. */
    return !p.name?.trim() || p.gender == null || p.birth_year == null || !p.region;
}

export type Profile = {
    id: string;
    /** 화면에 보이는 이름. 가입할 때 **닉네임**으로 받는다. */
    name: string;
    avatar_url: string | null;
    role: Role;
    /** 대화를 언제부터 볼 수 있는가. 승인된 순간이 찍힌다. */
    joined_at: string | null;
    /**
     * 거주지역. 이름표에 `83/신성호/광산구`로 함께 적힌다.
     * **여덟 글자까지**(`REGION_MAX` · DB의 `profiles_region_check`).
     */
    region: string | null;
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

/**
 * 라운드 알림을 보낸 기록. **한 줄이 곧 한 번의 발송이다.**
 *
 * 넣는 것은 크론이 부르는 DB 함수뿐이고, 넣는 순간 웹훅이 폰으로 밀어 준다.
 * `unique (round_id, kind)`가 있어 크론이 10분마다 돌아도 한 라운드에 한 번만
 * 간다. 화면은 이 표를 안 읽지만, DB 타입은 스키마와 짝이라 여기 적어 둔다.
 */
export type RoundReminder = {
    id: string;
    round_id: string;
    /** `day_before` 전날 저녁 · `soon` 시작 두 시간 전(스크린만) */
    kind: 'day_before' | 'soon';
    created_at: string;
};

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
 * 홈이 받는 신청 기록. **조 번호가 하나 더 붙는다.**
 *
 * 홈의 다음 라운드 카드가 `3조 · 07:30`을 적으려면 내 조를 알아야 한다 —
 * 새벽에 나가면서 몇 조인지 보려고 라운드 상세까지 들어갈 일이 없어야 한다.
 * 라운드 목록은 조를 안 적으므로 그쪽은 좁은 `SignupLite` 그대로다.
 */
export type SignupHome = SignupLite & Pick<Signup, 'grp'>;

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
    /**
     * 끝난 결과를 대화방에 남긴 시각. **`null`이면 아직 안 남긴 것**이다.
     *
     * 손으로 마감하면 트리거가 곧바로 남기지만, **마감 시각이 지나 끝나는
     * 것은 DB에서 아무 일도 안 일어난다** — 그래서 투표 목록이 '끝났는데
     * 이 값이 비어 있는 것'을 보면 `post_poll_result`를 부른다.
     * 스키마를 아직 다시 안 돌린 저장소에는 칸이 없어 `undefined`가 온다 —
     * 그때는 아무것도 안 부른다(`roundKind`와 같은 사정이다).
     */
    result_at?: string | null;
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
 * 화면이 보는 것은 **어느 항목을 · 누가** 골랐나, 이 둘뿐이다.
 * 표 한 줄의 `id`와 `created_at`은 아무 데서도 안 쓰는데 둘이 합쳐 줄의
 * 절반이 넘는다. 100명이 스물네 번 투표하면 표가 3천 줄이라 그 차이가 곧
 * 수백 KB다.
 *
 * **`poll_id`도 뺐다.** 목록은 표를 **투표에 딸려** 받으므로(`polls(*,
 * poll_votes(...))`) 어느 투표의 것인지가 이미 자리로 정해져 있고, 상세는
 * 한 투표만 부른다 — 줄마다 다시 적을 이유가 없다. UUID 한 칸이 줄의
 * 3분의 1이라, 표 천 줄이면 그것만으로 50KB다.
 * 대신 **평평한 배열로 펴지 말 것** — 펴는 순간 어느 투표 것인지를 잃는다.
 */
export type PollVoteLite = Pick<PollVote, 'option_id' | 'user_id'>;

/**
 * 목록에서 쓰는 항목의 최소 조각. `poll_id`를 빼는 이유는 위와 같다.
 * (상세·수정 화면은 한 투표만 부르므로 `PollOption`을 그대로 쓴다 —
 * 넓은 쪽은 좁은 쪽에 그대로 들어맞는다.)
 */
export type PollOptionLite = Pick<PollOption, 'id' | 'label' | 'sort'>;

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

/**
 * 말풍선 반응 한 개 (카톡의 `😄 2`).
 *
 * **한 사람이 한 글에 같은 그림글자를 두 번 못 단다** — 그 셋이 기본키다.
 * 개수만 세어 두지 않은 것은 '내가 눌렀나'를 알아야 하기 때문이다.
 */
export type MessageReaction = {
    message_id: string;
    user_id: string;
    emoji: string;
    created_at: string;
};

/**
 * 알림함 한 줄 — **폰으로 밀어 준 그 알림을 서버에도 남긴 것**이다.
 *
 * 미는 것으로 끝내면 **배너를 놓쳤을 때 되짚을 데가 없다.** 아이콘에
 * `12`가 떠 있어도 그중 둘이 정산인지 자리가 난 것인지 앱 안에서 알
 * 길이 없었다(사용자 제보). 홈 머리말의 🔔이 이 줄들을 보여 준다.
 *
 * **대화는 여기 없다** — 하루 100마디가 그대로 쌓이는 데다 대화방이
 * 곧 목록이다. 그래서 종의 숫자와 대화 안 읽은 수는 갈린다.
 *
 * `kind`는 발송기가 넣은 **표 이름 그대로**다(`rounds`·`settlement_shares`…).
 * 갈래를 새로 만들 때 여기 적을 것이 없게 하려는 것이고, 화면은 모르는
 * 값이 와도 기본 그림글자로 그린다(`ALERT_ICON`).
 */
export type AppNotification = {
    id: string;
    user_id: string;
    kind: string;
    title: string;
    body: string;
    url: string;
    created_at: string;
    read_at: string | null;
};

/**
 * 알림 제목을 **그림글자와 글자로 가른다** — `💰 정산` → `['💰', '정산']`.
 *
 * **알림 제목에는 이미 그림글자가 붙어 있다**(`💰 정산` · `🎉 자리가
 * 났습니다`). 알림창에는 제목 한 줄만 보이는 때가 많아 거기서 갈리라고
 * 붙여 둔 것인데, 알림함에서 아이콘을 따로 그리면 **같은 그림이 두 번
 * 나온다**(헤드리스로 찍어 보고 잡았다).
 *
 * 그래서 **제목이 들고 있는 그것을 아이콘 자리로 옮긴다.** 그림글자가
 * 없는 제목이면 갈래로 고르고(`ALERT_ICON`), 그것도 모르면 `🔔`이다.
 */
export function splitAlertTitle(n: { title: string; kind: string }): [string, string] {
    const m = /^(\p{Extended_Pictographic}\uFE0F?)\s*(.*)$/u.exec(n.title.trim());
    if (m) return [m[1], m[2]];
    return [ALERT_ICON[n.kind] ?? '🔔', n.title];
}

/**
 * 제목에 그림글자가 없을 때 쓸 갈래별 그림.
 *
 * **모르는 값은 `🔔`로 그린다** — 발송기가 표 이름을 그대로 넣으므로,
 * 새 알림 갈래가 생겨도 화면이 깨지지 않는다.
 */
export const ALERT_ICON: Record<string, string> = {
    rounds: '⛳',
    polls: '🗳',
    posts: '📢',
    profiles: '🙋',
    signups: '🎉',
    round_groups: '🚩',
    round_reminders: '⏰',
    settlement_shares: '💰',
    settle_reminders: '💰',
};

/** 말풍선에 달 수 있는 그림글자. **카톡과 같은 다섯이다.**
 *  늘리면 창이 두 줄로 접혀 무엇을 누르는 중인지가 흐려진다. */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢'] as const;

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
    /**
     * 투표 결과를 알리는 `system` 글이면 그 투표의 id.
     * **이 값이 있으면 대화에서 한 줄이 아니라 카드로 그린다** — 눌러서
     * 그 투표로 들어간다. 없는 저장소에서는 `undefined`라 예전처럼 한 줄이다.
     */
    poll_id?: string | null;
    /**
     * 어느 라운드 이야기인가. **이 값이 있으면 대화에서 눌리는 카드로 그린다** —
     * 모집을 열면 저절로 붙고(`announce_to_chat`), 라운드 상세의
     * `📣 대화방에 공유`로 사람이 직접 올릴 때도 붙는다.
     * 없는 저장소에서는 `undefined`라 예전처럼 가운데 한 줄이다.
     */
    round_id?: string | null;
    /**
     * **이 `system` 줄은 그래도 폰을 울린다.** 사람이 `📣 대화방에 공유`를
     * 눌러 올린 줄에만 선다 — 저절로 남는 안내 줄(`chat_notice`)은 기본값
     * false 그대로다. 화면은 이 값을 읽지 않는다(발송기 몫이다).
     */
    notify?: boolean;
    /**
     * **운영진이 가린 글이면 가린 시각.** 카톡의 '가리기'와 같다 —
     * 지우지 않고 덮어만 두므로 언제든 다시 풀 수 있다.
     * 화면은 글·사진·이모티콘 대신 `운영진이 가린 메시지입니다`를 그린다.
     * 칸이 없는 저장소에서는 `undefined`라 예전처럼 그대로 보인다.
     */
    hidden_at?: string | null;
    /** 가린 사람. 누가 가렸는지 물어볼 데가 있어야 해서 남긴다. */
    hidden_by?: string | null;
    /**
     * **방 공지로 붙박은 시각**(카톡 오픈톡의 그것). 대화 맨 위에 한 줄로
     * 붙어 있어, 모임 규칙·계좌·집합 장소가 하루 백 마디에 안 밀린다.
     * **한 방에 하나다** — 화면이 이 값이 가장 늦은 줄 하나만 읽으므로
     * 새로 등록하면 앞엣것이 저절로 물러난다. 내리는 것은 null이다.
     * 칸이 없는 저장소에서는 `undefined`라 공지 줄이 아예 안 뜬다.
     */
    pinned_at?: string | null;
    /** 공지로 올린 사람. 누구에게 물어볼지가 있어야 한다. */
    pinned_by?: string | null;
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
            profile_private: Table<Contact>;
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
            message_reactions: Table<MessageReaction>;
            push_subscriptions: Table<PushSubscriptionRow>;
            round_reminders: Table<RoundReminder>;
            notifications: Table<AppNotification>;
        };
        Views: Record<string, never>;
        Functions: {
            join_round: { Args: { p_round: string; p_note?: string }; Returns: Signup };
            leave_round: { Args: { p_round: string }; Returns: void };
            kick_signup: { Args: { p_round: string; p_user: string }; Returns: void };
            /**
             * 회원 탈퇴 — 내 계정과 내가 남긴 기록을 지운다.
             * **추방(`banned`)과 다른 일이다** — 그건 행을 남겨 두는 것이 곧
             * 막는 방법이고, 이건 계정까지 없애 다시 로그인하면 가입 신청부터다.
             * 대화 글과 내가 연 라운드는 남는다(남의 대화에 구멍이 나면 안 된다).
             */
            delete_me: { Args: Record<string, never>; Returns: void };
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
            /**
             * 끝난 투표의 결과를 대화방에 한 번 남긴다. 이미 남겼거나 아직
             * 안 끝났으면 아무 일도 안 하고 `false`를 돌려준다 — 여러 사람이
             * 동시에 불러도 한 줄만 남는다(행을 잠그고 도장을 본다).
             */
            post_poll_result: { Args: { p_poll: string }; Returns: boolean };
            /**
             * 사람마다 **지난 라운드에 몇 번 나갔나**. 회원 명단의 `올해 7회`다.
             * 화면이 신청 기록을 통째로 받아 세면 1년치가 수백 KB라 DB가 센다.
             */
            attendance_counts: {
                Args: { p_since: string };
                Returns: { user_id: string; n: number }[];
            };
            /**
             * **90일이 지난 내 알림을 걷는다.** 대화 사진 청소와 같은 결이다 —
             * 정해진 시각에 도는 것(pg_cron)을 새로 켜지 않고 알림함을 연
             * 사람의 화면이 치운다. 정책이 제 것만 지우게 막는다.
             */
            purge_my_notifications: { Args: Record<string, never>; Returns: void };
        };
        Enums: Record<string, never>;
        CompositeTypes: Record<string, never>;
    };
};
