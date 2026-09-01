-- ═══════════════════════════════════════════════════════════════
--  teetime · 데이터베이스 스키마
--
--  Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 실행한다.
--  여러 번 실행해도 안전하다 (create if not exists / drop policy if exists).
--
--  ┌ 설계 원칙 ────────────────────────────────────────────────┐
--  │ JTFAG는 앱 상태 전체를 payload JSON 한 덩어리에 넣었다.    │
--  │ 4명일 땐 괜찮았지만 40명이 동시에 쓰면 서로 덮어쓴다.      │
--  │ 그래서 여기서는 행 단위로 나눈다 — 신청 한 건이 행 하나다. │
--  │ 정원 계산처럼 경합이 나는 것은 클라이언트가 아니라         │
--  │ DB 함수가 행을 잠그고 처리한다(join_round 참고).           │
--  └───────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;


-- ═══ 1. 회원 ═══════════════════════════════════════════════════
--
-- 카카오로 로그인하면 auth.users에 행이 생기고, 트리거가 여기에
-- profiles 행을 만든다. 처음엔 role='pending' 이다 —
-- 링크만 알면 누구나 로그인할 수 있으므로, 관리자가 승인해야
-- 실제 모임 회원이 된다.

create table if not exists profiles (
    id          uuid primary key references auth.users on delete cascade,
    name        text        not null default '',
    avatar_url  text,
    -- pending 승인 대기 · member 일반회원 · treasurer 총무 · staff 부운영자
    -- admin 운영자(방장) · superadmin 앱관리자
    -- banned 추방 — 행을 남겨 두는 것이 곧 막는 방법이다. 지우면 다시
    --               로그인할 때 앱이 대기 상태로 되살려 버린다.
    role        text        not null default 'pending'
                            check (role in ('pending', 'member', 'treasurer',
                                            'staff', 'admin', 'superadmin', 'banned')),
    -- 대화를 언제부터 볼 수 있는가. 승인된 순간이 들어간다.
    -- 카톡처럼 **들어오기 전 이야기는 안 보인다.**
    joined_at   timestamptz,
    handicap    numeric(4,1),
    phone       text,
    memo        text        not null default '',   -- 관리자 메모
    created_at  timestamptz not null default now()
);

-- ⚠️ **`create table if not exists`는 이미 있는 표를 고치지 않는다.**
-- 위의 표 정의를 바꿔 봐야 처음 만드는 곳에만 먹는다. 이미 돌아가고 있는
-- 저장소에는 아래처럼 `alter`를 따로 적어야 반영된다 — 등급을 넷에서
-- 다섯으로 늘리고도 이걸 빠뜨려, 부운영자로 올리면 검사 규칙에 걸렸다.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
    check (role in ('pending', 'member', 'treasurer',
                    'staff', 'admin', 'superadmin', 'banned'));

alter table profiles add column if not exists joined_at timestamptz;
-- **핸디캡 대신 차량번호를 받는다**(사용자 요청). **골프장에 미리 차를
-- 등록할 때** 쓴다 (카풀과는 무관 — 사용자가 바로잡아 준 것이다).
-- `handicap` 칸은 지우지 않고 남겨 둔다 —
-- 예전에 적어 둔 값이 있고, 지워서 얻을 게 없다.
alter table profiles add column if not exists car text;

-- **조 편성에 쓰는 두 칸.** 성별로 섞고(남남여여) 나이로 섞는(신구 조화)
-- 조 편성 조건이 이 값을 본다 — 없으면 그 두 조건이 아예 못 돈다.
--
-- **둘 다 비워 둘 수 있다.** 이 기능을 만들기 전부터 있던 회원 100명이
-- 다 `null`인데, 필수로 잡으면 그분들이 앱을 못 쓰게 된다. 조 편성 쪽에서
-- 모르는 사람은 따로 모아 고르게 흩뿌린다.
--
-- **나이 대신 태어난 해를 받는다.** 나이를 적으면 해가 바뀔 때마다 틀린
-- 값이 되고, 아무도 고치러 오지 않는다.
alter table profiles add column if not exists gender text;
alter table profiles drop constraint if exists profiles_gender_check;
alter table profiles add  constraint profiles_gender_check
    check (gender is null or gender in ('m', 'f'));

alter table profiles add column if not exists birth_year smallint;
alter table profiles drop constraint if exists profiles_birth_year_check;
alter table profiles add  constraint profiles_birth_year_check
    check (birth_year is null or birth_year between 1930 and 2020);

-- 이미 있던 회원은 처음 들어온 때부터 본다.
update profiles set joined_at = created_at
 where joined_at is null
   and role in ('member', 'treasurer', 'staff', 'admin', 'superadmin');

-- 카카오 로그인 직후 프로필을 자동으로 만든다.
-- security definer라 RLS를 통과한다 — 이때는 아직 profiles 행이 없어
-- is_member()가 false이기 때문이다.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, name, avatar_url)
    values (
        new.id,
        coalesce(
            new.raw_user_meta_data ->> 'name',
            new.raw_user_meta_data ->> 'full_name',
            new.raw_user_meta_data ->> 'preferred_username',
            ''),
        new.raw_user_meta_data ->> 'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function handle_new_user();


-- ═══ 2. 권한 판정 함수 ═════════════════════════════════════════
--
-- RLS 정책 안에서 profiles를 직접 조회하면 그 조회에 또 RLS가 걸려
-- 무한 재귀가 난다. security definer 함수로 감싸 그 고리를 끊는다.

create or replace function is_member() returns boolean
language sql security definer stable set search_path = public as $$
    select exists (
        select 1 from profiles
        where id = auth.uid()
          and role in ('member', 'treasurer', 'staff', 'admin', 'superadmin')
    );
$$;

-- **운영진**이다 — 앱관리자·운영자·부운영자를 함께 가리킨다.
-- 이름은 is_admin 그대로 두었다. 정책 스무 군데가 이 이름을 쓰고 있고,
-- 셋이 하는 일이 같기 때문이다(임명만 빼고).
-- **총무는 여기 안 들어간다** — 총무는 정산만 맡는다(can_settle 참고).
create or replace function is_admin() returns boolean
language sql security definer stable set search_path = public as $$
    select exists (
        select 1 from profiles
        where id = auth.uid() and role in ('staff', 'admin', 'superadmin')
    );
$$;

-- **방장**. 부운영자와 총무를 임명하고 푸는 것은 이 사람들 몫이다.
-- 앱관리자도 포함한다 — 위에 있는 사람이 아래 일을 못 할 이유가 없다.
create or replace function is_owner() returns boolean
language sql security definer stable set search_path = public as $$
    select exists (
        select 1 from profiles
        where id = auth.uid() and role in ('admin', 'superadmin')
    );
$$;

-- **앱관리자**. 운영자(방장)를 임명하고 푸는 것은 이 사람만 한다.
-- 만드는 길은 하나뿐이다 — 아래 `claim_superadmin` 트리거(이름·전화번호).
create or replace function is_super() returns boolean
language sql security definer stable set search_path = public as $$
    select exists (
        select 1 from profiles
        where id = auth.uid() and role = 'superadmin'
    );
$$;

-- **남의 정산까지 다룰 수 있는가.** 총무와 운영진이다.
-- 총무를 따로 둔 이유가 이것이라, 정산 정책은 `is_admin()`이 아니라
-- 이 함수를 본다.
-- **정산을 만드는 것 자체는 회원 누구나 한다** — 자기가 만든 것을 자기가
-- 고치는 길은 `owns_settlement()`가 따로 연다. 이 함수는 그 위, 남의 것까지
-- 챙기는 권한이다(만든 사람이 한동안 안 들어올 때 돈이 뜨지 않게).
create or replace function can_settle() returns boolean
language sql security definer stable set search_path = public as $$
    select exists (
        select 1 from profiles
        where id = auth.uid()
          and role in ('treasurer', 'staff', 'admin', 'superadmin')
    );
$$;

-- 내 등급. profiles의 정책 안에서 profiles를 다시 조회하면 무한 재귀가
-- 나므로, 이 함수를 거쳐 읽는다.
-- **승인되는 순간에 도장을 찍는다.** 화면이 넣어 주기를 기다리면 빠뜨리는
-- 길이 생긴다(운영진이 SQL로 직접 올리는 경우 등).
create or replace function stamp_joined_at()
returns trigger language plpgsql as $$
begin
    if new.role in ('member', 'treasurer', 'staff', 'admin', 'superadmin')
       and (old.role is null or old.role not in
            ('member', 'treasurer', 'staff', 'admin', 'superadmin'))
       and new.joined_at is null
    then
        new.joined_at := now();
    end if;
    return new;
end $$;

drop trigger if exists profiles_stamp_joined on profiles;
create trigger profiles_stamp_joined before update on profiles
    for each row execute function stamp_joined_at();

/**
 * 내가 대화를 볼 수 있는 시작점.
 *
 * 도장이 없으면(옛 행 등) 아주 옛날을 돌려줘 전부 보이게 한다 — 못 보는
 * 쪽으로 틀리면 대화가 통째로 사라진 것처럼 보이기 때문이다.
 */
create or replace function chat_since() returns timestamptz
language sql security definer stable set search_path = public as $$
    select coalesce(
        (select joined_at from profiles where id = auth.uid()),
        '-infinity'::timestamptz);
$$;

create or replace function my_role() returns text
language sql security definer stable set search_path = public as $$
    select role from profiles where id = auth.uid();
$$;


/**
 * 앱관리자 자동 부여.
 *
 * 승인해 줄 사람이 없는 맨 처음을 위한 문이다. 가입 신청 화면에서 아래
 * 닉네임과 번호를 적으면 그 자리에서 **앱관리자**가 된다.
 *
 * **`before` 트리거로는 안 된다.** RLS의 `with check`(`profiles_self_upd`)가
 * before 트리거가 고친 **뒤의** 행을 보기 때문에, 거기서 role을 올리면
 * `role = my_role()`에 걸려 저장 자체가 막힌다. 그래서 `after`에서
 * `security definer`로 한 번 더 고친다 — 표 주인 권한이라 RLS를 안 탄다.
 * 안쪽 update가 트리거를 다시 부르지만 그때는 이미 superadmin이라
 * 조건에 안 걸려 거기서 멈춘다.
 *
 * 번호는 숫자만 남겨 견주므로 하이픈이 있든 없든 맞는다.
 *
 * ⚠️ **여기에 진짜 이름과 번호를 적어 커밋하지 말 것.** 이 저장소는
 * 공개라 전화번호가 그대로 남는다. 자리표시자로 두고, 실제 값은
 * Supabase의 SQL 편집기에 붙여넣을 때만 채운다 — 아래 그대로 실행하면
 * 조건이 안 맞아 아무도 앱관리자가 되지 않는다(막히기만 할 뿐 탈은 없다).
 * 손으로 한 사람을 올리는 길은 `docs/설치.md` 5번 방법 A에 있다.
 */
create or replace function claim_superadmin()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
    if new.role <> 'superadmin'
       and btrim(coalesce(new.name, '')) = '[이름]'
       and regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g') = '[숫자만 적은 번호]'
    then
        update profiles set role = 'superadmin' where id = new.id;
    end if;
    return null;
end $$;

drop trigger if exists claim_superadmin_ins on profiles;
drop trigger if exists claim_superadmin_upd on profiles;
create trigger claim_superadmin_ins after insert on profiles
    for each row execute function claim_superadmin();
create trigger claim_superadmin_upd after update on profiles
    for each row execute function claim_superadmin();

-- 예전에 쓰던 이름. 남아 있으면 같은 일을 두 번 하므로 걷어낸다.
drop trigger if exists claim_owner_ins on profiles;
drop trigger if exists claim_owner_upd on profiles;
drop function if exists claim_owner();


-- ═══ 3. 라운드 (모집) ══════════════════════════════════════════

create table if not exists rounds (
    id          uuid primary key default gen_random_uuid(),
    title       text        not null default '',
    course      text        not null default '',
    lat         double precision,
    lon         double precision,
    tee_at      timestamptz not null,               -- 티오프 시각
    capacity    int         not null default 4 check (capacity > 0),
    fee         int         not null default 0,     -- 1인 참가비(원)
    note        text        not null default '',
    status      text        not null default 'open'
                            check (status in ('open', 'closed', 'done', 'cancelled')),
    -- 필드인가 스크린인가. **비울 수 없다** — 예전 행은 모두 필드였으므로
    -- 기본값이 그대로 맞는 답이 된다. 스크린이면 캐디·카트·날씨가 없다.
    kind        text        not null default 'field'
                            check (kind in ('field', 'screen')),
    -- 캐디를 쓰는가 · 카트비가 참가비에 들어 있는가.
    -- 둘 다 안 정할 수 있어(null) 예전 라운드도 그대로 산다.
    caddie      text        check (caddie in ('caddie', 'none')),
    cart        text        check (cart in ('included', 'excluded')),
    opens_at    timestamptz,                        -- 신청 시작 시각 (null이면 바로)
    created_by  uuid        references profiles on delete set null,
    created_at  timestamptz not null default now()
);

-- ⚠️ 위의 표 정의는 **처음 만들 때만** 먹는다. 이미 돌아가고 있는 저장소에는
-- 아래 alter가 있어야 칸이 생긴다 (CLAUDE.md의 '주의사항' 참고).
alter table rounds add column if not exists caddie text;
alter table rounds add column if not exists cart   text;
-- 기본값을 함께 준 덕에 이미 쌓인 행이 전부 'field'로 채워진다.
alter table rounds add column if not exists kind   text not null default 'field';
alter table rounds drop constraint if exists rounds_caddie_check;
alter table rounds add  constraint rounds_caddie_check check (caddie in ('caddie', 'none'));
alter table rounds drop constraint if exists rounds_cart_check;
alter table rounds add  constraint rounds_cart_check   check (cart in ('included', 'excluded'));
alter table rounds drop constraint if exists rounds_kind_check;
alter table rounds add  constraint rounds_kind_check   check (kind in ('field', 'screen'));

create index if not exists rounds_tee_at_idx on rounds (tee_at desc);


-- 참가 신청. 한 사람이 한 라운드에 한 줄만 가질 수 있다.
--   state = 'confirmed' 확정 · 'waitlist' 대기
--   seq   = 신청 순번. 대기자를 올릴 때 이 순서를 따른다.
create table if not exists signups (
    id          uuid primary key default gen_random_uuid(),
    round_id    uuid        not null references rounds on delete cascade,
    user_id     uuid        not null references profiles on delete cascade,
    state       text        not null check (state in ('confirmed', 'waitlist')),
    seq         int         not null,
    note        text        not null default '',
    created_at  timestamptz not null default now(),
    unique (round_id, user_id)
);

create index if not exists signups_round_seq_idx on signups (round_id, seq);

-- **조 편성.** 필드는 네 명이 한 조로 돌고, 스크린도 타석 단위로 나뉜다.
-- 카톡에서 "1조 누구누구" 하고 적던 것을 여기로 옮긴 것이다.
-- null이면 아직 안 정한 것이다 — 조를 안 짜는 라운드가 대부분이라 그게 기본이다.
-- ⚠️ 위 `create table`은 이미 있는 표를 안 고친다. 이 줄이 있어야 한다.
alter table signups add column if not exists grp smallint;
alter table signups drop constraint if exists signups_grp_check;
alter table signups add  constraint signups_grp_check check (grp is null or grp between 1 and 20);


-- **조 편성이 공개됐다는 표시.** 라운드 하나에 한 줄이다.
--
-- 조 번호는 사람(`signups.grp`)에 붙는데, 그것만으로는 **언제 공개됐는지**와
-- **조별 시각**을 담을 데가 없다. 무엇보다 알림을 걸 자리가 필요했다 —
-- 웹훅은 행이 바뀔 때 도는데 `signups`를 열여섯 줄 고치면 열여섯 번 운다.
-- 여기에 한 줄만 쓰면 저장 한 번에 알림도 한 번이다.
--
-- `tees`는 `{"1": "2026-09-01T07:00:00+09:00", "2": ...}` 꼴로, 조 번호가
-- 키다. 조마다 티오프가 8분씩 밀리는 것이 흔해서 따로 적을 자리를 두었다.
-- 안 적으면 빈 객체다 — 라운드의 티오프 하나로 충분한 모임도 있다.
create table if not exists round_groups (
    round_id  uuid primary key references rounds on delete cascade,
    tees      jsonb not null default '{}'::jsonb,
    posted_by uuid references profiles on delete set null,
    posted_at timestamptz not null default now()
);


-- ── 신청 ──────────────────────────────────────────────────────
--
-- 이 함수가 이 앱에서 가장 중요한 조각이다.
--
-- 클라이언트에서 "지금 몇 명이지?" 를 세어 보고 insert하면,
-- 두 사람이 동시에 누를 때 둘 다 "아직 자리 있음"을 읽고 둘 다 확정된다.
-- 정원 4명짜리에 5명이 들어앉는 것이다.
--
-- 그래서 rounds 행을 for update로 잠근 뒤에 세고 넣는다.
-- 잠금이 풀릴 때까지 두 번째 사람은 기다리므로 순서가 반드시 갈린다.
create or replace function join_round(p_round uuid, p_note text default '')
returns signups
language plpgsql
security definer
set search_path = public
as $$
declare
    r        rounds;
    v_seq    int;
    v_state  text;
    v_row    signups;
begin
    if auth.uid() is null then
        raise exception '로그인이 필요합니다.';
    end if;
    if not is_member() then
        raise exception '가입 승인을 받은 회원만 신청할 수 있습니다.';
    end if;

    -- 여기서 잠근다. 같은 라운드에 대한 다른 신청은 이 줄에서 기다린다.
    select * into r from rounds where id = p_round for update;
    if not found then
        raise exception '없는 라운드입니다.';
    end if;
    if r.status <> 'open' then
        raise exception '지금은 신청을 받지 않습니다.';
    end if;
    if r.opens_at is not null and now() < r.opens_at then
        raise exception '아직 신청 시작 전입니다.';
    end if;

    select coalesce(max(seq), 0) + 1 into v_seq
      from signups where round_id = p_round;

    if (select count(*) from signups
         where round_id = p_round and state = 'confirmed') < r.capacity
    then
        v_state := 'confirmed';
    else
        v_state := 'waitlist';
    end if;

    insert into signups (round_id, user_id, state, seq, note)
    values (p_round, auth.uid(), v_state, v_seq, coalesce(p_note, ''))
    returning * into v_row;

    return v_row;
end;
$$;


-- ── 빈 자리를 대기자로 채운다 ─────────────────────────────────
--
-- **빈 자리를 세어 그만큼 올린다.** 한 명만 올리게 두면 자리가 둘 이상
-- 났을 때(정원을 늘렸을 때) 한 자리밖에 안 채워진다.
--
-- 취소·강제 제외·**정원 늘리기** 셋이 이 한 곳을 같이 쓴다. 예전에는
-- 취소와 제외가 각자 `대기 1번 하나만` 올리는 코드를 따로 들고 있었고,
-- 그래서 **정원을 4명에서 8명으로 늘려도 대기자가 그대로 남았다** —
-- 자리는 넷이나 비었는데 아무도 안 올라가니, 운영자는 늘렸다고 알리고
-- 대기자는 영영 대기였다. 규칙을 여기 하나로 모아 그 구멍을 막았다.
create or replace function promote_waitlist(p_round uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cap  int;
    v_open int;
    v_n    int := 0;
begin
    -- 잠근다. 두 사람이 동시에 취소하면 같은 대기자를 두 번 올리려 든다.
    select capacity into v_cap from rounds where id = p_round for update;
    if v_cap is null then return 0; end if;

    select v_cap - count(*) into v_open
      from signups where round_id = p_round and state = 'confirmed';
    if v_open <= 0 then return 0; end if;

    update signups set state = 'confirmed'
     where id in (
        select id from signups
         where round_id = p_round and state = 'waitlist'
         order by seq
         limit v_open
     );
    get diagnostics v_n = row_count;
    return v_n;
end;
$$;


-- **정원을 늘리면 대기자가 저절로 올라간다.**
-- 줄일 때는 아무도 안 뺀다 — 이미 확정된 사람을 앱이 말없이 내리면
-- 그 사람은 영문을 모른 채 자리를 잃는다. 그건 사람이 `✕`로 할 일이다.
create or replace function rounds_capacity_sync()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
    perform promote_waitlist(new.id);
    return null;
end $$;

drop trigger if exists rounds_capacity_grew on rounds;
create trigger rounds_capacity_grew after update on rounds
    for each row when (new.capacity > old.capacity)
    execute function rounds_capacity_sync();


-- ── 신청 취소 ─────────────────────────────────────────────────
--
-- 확정된 사람이 빠지면 대기자 맨 앞을 자동으로 올린다.
-- 이것도 잠그고 해야 한다 — 둘이 동시에 취소하면 같은 대기자를
-- 두 번 올리려 들거나, 자리가 둘 났는데 하나만 채워질 수 있다.
create or replace function leave_round(p_round uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_state text;
begin
    if auth.uid() is null then
        raise exception '로그인이 필요합니다.';
    end if;

    perform 1 from rounds where id = p_round for update;

    delete from signups
     where round_id = p_round and user_id = auth.uid()
    returning state into v_state;

    if v_state is null then
        return;                      -- 애초에 신청한 적이 없다
    end if;

    -- 확정 자리가 비었으니 대기 줄에서 올린다.
    if v_state = 'confirmed' then
        perform promote_waitlist(p_round);
    end if;
end;
$$;


-- ── 관리자가 남을 빼기 ────────────────────────────────────────
create or replace function kick_signup(p_round uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_state text;
begin
    if not is_admin() then
        raise exception '총무만 할 수 있습니다.';
    end if;

    perform 1 from rounds where id = p_round for update;

    delete from signups
     where round_id = p_round and user_id = p_user
    returning state into v_state;

    if v_state = 'confirmed' then
        perform promote_waitlist(p_round);
    end if;
end;
$$;


-- ── 조 편성 ───────────────────────────────────────────────────
--
-- **한 번에 다 쓴다.** 열여섯 명을 한 줄씩 고치면 쓰기가 열여섯 번이고,
-- 실시간 이벤트도 열여섯 번이라 보는 사람 화면이 그만큼 다시 그려진다.
-- 여기로 모으면 저장 한 번에 트랜잭션 하나, 알림도 한 번이다.
--
-- `p_grps`는 `{"<사람 id>": 2, ...}` 꼴이고 **이것이 곧 전부다** — 이 목록에
-- 없는 사람은 조에서 빠진 것으로 본다. 화면이 늘 확정자 전원을 실어 보내므로
-- '빼기'를 따로 만들 필요가 없다.
--
-- **안 바뀐 줄에는 쓰기를 안 보낸다**(투표 항목과 같은 규칙이다).
-- 조를 짜다 보면 저장을 여러 번 누르게 되는데, 그때마다 열여섯 줄이
-- 다시 쓰이면 실시간 이벤트만 쌓인다.
create or replace function set_round_groups(
    p_round uuid,
    p_grps  jsonb,
    p_tees  jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    r          rounds;
    v_moved    int;
    v_old_tees jsonb;
    v_groups   int;
    v_actor    uuid;
begin
    select * into r from rounds where id = p_round;
    if not found then
        raise exception '없는 라운드입니다.';
    end if;
    -- **모집을 연 사람과 운영진.** 라운드를 고칠 수 있는 사람과 같은 잣대다.
    if not (is_admin() or r.created_by = auth.uid()) then
        raise exception '모집을 연 사람과 운영진만 조를 짤 수 있습니다.';
    end if;

    p_grps := coalesce(p_grps, '{}'::jsonb);
    p_tees := coalesce(p_tees, '{}'::jsonb);

    -- 조 번호는 1~20의 정수뿐이다. 화면을 거치지 않고 부를 수도 있으니 여기서 본다.
    if exists (
        select 1 from jsonb_each_text(p_grps) e
         where coalesce(e.value, '') <> ''
           and (e.value !~ '^[0-9]+$' or e.value::int not between 1 and 20))
    then
        raise exception '조 번호가 올바르지 않습니다.';
    end if;

    update signups s
       set grp = nullif(p_grps ->> s.user_id::text, '')::smallint
     where s.round_id = p_round
       and s.grp is distinct from nullif(p_grps ->> s.user_id::text, '')::smallint;
    get diagnostics v_moved = row_count;

    select count(distinct grp) into v_groups
      from signups where round_id = p_round and grp is not null;

    -- 아무도 조에 안 들었으면 편성을 걷어낸다. 그래야 화면에서 '조 편성
    -- 지우기'가 되고, 지운 것이 알림으로 나가지도 않는다.
    if v_groups = 0 then
        delete from round_groups where round_id = p_round;
        return;
    end if;

    select tees into v_old_tees from round_groups where round_id = p_round;

    -- **바뀐 게 없으면 아예 안 쓴다.** 이 표에 쓰는 순간 알림이 나가므로,
    -- 저장만 다시 눌렀을 때 폰이 또 울리면 안 된다.
    if v_moved = 0 and v_old_tees is not distinct from p_tees then
        return;
    end if;

    v_actor := coalesce(auth.uid(), r.created_by);

    insert into round_groups (round_id, tees, posted_by, posted_at)
    values (p_round, p_tees, v_actor, now())
    on conflict (round_id) do update
       set tees = excluded.tees, posted_by = excluded.posted_by,
           posted_at = excluded.posted_at;

    -- 대화방에도 한 줄 남긴다 — 모집·투표와 같은 결이다.
    perform chat_notice(
        coalesce(nullif(r.course, ''), nullif(r.title, ''), '라운드')
        || ' 조 편성이 나왔습니다 · ' || v_groups || '개 조',
        v_actor);
end;
$$;


-- ═══ 4. 투표 ═══════════════════════════════════════════════════

create table if not exists polls (
    id          uuid primary key default gen_random_uuid(),
    title       text        not null,
    body        text        not null default '',
    multi       boolean     not null default false,  -- 복수 선택 허용
    anonymous   boolean     not null default false,  -- 누가 골랐는지 숨김
    closes_at   timestamptz,
    closed      boolean     not null default false,
    created_by  uuid        references profiles on delete set null,
    created_at  timestamptz not null default now()
);

create table if not exists poll_options (
    id       uuid primary key default gen_random_uuid(),
    poll_id  uuid not null references polls on delete cascade,
    label    text not null,
    sort     int  not null default 0
);

create table if not exists poll_votes (
    id         uuid primary key default gen_random_uuid(),
    poll_id    uuid not null references polls on delete cascade,
    option_id  uuid not null references poll_options on delete cascade,
    user_id    uuid not null references profiles on delete cascade,
    created_at timestamptz not null default now(),
    unique (option_id, user_id)
);

create index if not exists poll_votes_poll_idx on poll_votes (poll_id);

-- 한 표를 던진다. 단일 선택 투표면 이전 표를 지우고 넣는다.
create or replace function cast_vote(p_option uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_poll  uuid;
    v_multi boolean;
    v_closed boolean;
    v_closes timestamptz;
begin
    if not is_member() then
        raise exception '가입 승인을 받은 회원만 투표할 수 있습니다.';
    end if;

    select o.poll_id, p.multi, p.closed, p.closes_at
      into v_poll, v_multi, v_closed, v_closes
      from poll_options o join polls p on p.id = o.poll_id
     where o.id = p_option;

    if v_poll is null then raise exception '없는 항목입니다.'; end if;
    if v_closed then raise exception '마감된 투표입니다.'; end if;
    if v_closes is not null and now() > v_closes then
        raise exception '마감 시간이 지났습니다.';
    end if;

    if not v_multi then
        delete from poll_votes
         where poll_id = v_poll and user_id = auth.uid();
    end if;

    insert into poll_votes (poll_id, option_id, user_id)
    values (v_poll, p_option, auth.uid())
    on conflict (option_id, user_id) do nothing;
end;
$$;

create or replace function retract_vote(p_option uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from poll_votes
     where option_id = p_option and user_id = auth.uid();
end;
$$;


-- ═══ 5. 공지 게시판 ════════════════════════════════════════════

create table if not exists posts (
    id          uuid primary key default gen_random_uuid(),
    title       text        not null,
    body        text        not null default '',
    pinned      boolean     not null default false,
    author_id   uuid        references profiles on delete set null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists posts_order_idx on posts (pinned desc, created_at desc);

create table if not exists post_comments (
    id         uuid primary key default gen_random_uuid(),
    post_id    uuid not null references posts on delete cascade,
    author_id  uuid references profiles on delete set null,
    body       text not null,
    created_at timestamptz not null default now()
);


-- 투표에도 댓글을 단다. `post_comments`와 같은 모양이다 — 하나로 합쳐
-- `target_type` 같은 칸을 두는 길도 있지만, 그러면 외래키가 느슨해지고
-- 정책이 복잡해진다. 표 하나가 더 생기는 편이 싸다.
create table if not exists poll_comments (
    id         uuid primary key default gen_random_uuid(),
    poll_id    uuid not null references polls on delete cascade,
    author_id  uuid references profiles on delete set null,
    body       text not null,
    created_at timestamptz not null default now()
);

create index if not exists poll_comments_poll_idx on poll_comments (poll_id, created_at);


-- 라운드에도 댓글을 단다. `카풀 자리 있나요`처럼 그 라운드에만 걸리는
-- 말이 대화방으로 나가면 다른 사람들 사이에 묻힌다.
-- 표는 라운드(3장)가 아니라 **댓글끼리** 모아 둔다 — 셋이 같은 모양·같은
-- 정책이라 나란히 두면 한 곳만 고치는 일이 안 생긴다.
create table if not exists round_comments (
    id         uuid primary key default gen_random_uuid(),
    round_id   uuid not null references rounds on delete cascade,
    author_id  uuid references profiles on delete set null,
    body       text not null,
    created_at timestamptz not null default now()
);

create index if not exists round_comments_round_idx on round_comments (round_id, created_at);


-- ═══ 5-1. 정산 ═════════════════════════════════════════════════
--
-- 라운드 하나에 정산 여러 건이 달릴 수 있다(그린피 따로, 뒤풀이 따로).
-- **회원 누구나 만들고, 만든 사람이 챙긴다**(사용자가 정한 것이다).
-- 100명 모임에서 라운드를 여는 사람이 제각각인데 총무 한 사람이 모든 돈을
-- 걷는 것은 무리다. **남의 정산은 못 고친다** — 규칙은 정책 쪽에 있다
-- (`settlements_own` · `owns_settlement()`).
--
-- **1/N은 화면이 계산하고, DB에는 사람마다 낼 돈을 그대로 적는다.**
-- 중간에 들어온 사람은 금액이 다르기 때문이다("신성호 1만원, 나머지
-- 2만원씩"). 계산식을 DB에 두면 그런 예외를 담을 자리가 없어진다.

create table if not exists settlements (
    id         uuid primary key default gen_random_uuid(),
    round_id   uuid not null references rounds on delete cascade,
    title      text not null,
    body       text not null default '',
    bank       text not null default '',   -- 은행 이름
    account    text not null default '',   -- 계좌번호
    total      int  not null default 0,    -- 총금액(원)
    created_by uuid references profiles on delete set null,
    created_at timestamptz not null default now()
);

create index if not exists settlements_round_idx on settlements (round_id, created_at);

create table if not exists settlement_shares (
    id            uuid primary key default gen_random_uuid(),
    settlement_id uuid not null references settlements on delete cascade,
    user_id       uuid not null references profiles on delete cascade,
    amount        int  not null default 0,       -- 이 사람이 낼 돈
    paid          boolean not null default false,
    created_at    timestamptz not null default now(),
    unique (settlement_id, user_id)
);

create index if not exists settlement_shares_user_idx on settlement_shares (user_id);

-- **입금 독촉을 보낸 기록.** 한 줄이 곧 '한 번 보냈다'는 뜻이다.
--
-- 알림은 새 행이 생길 때 나가므로(웹훅), 이미 있는 몫 행(`settlement_shares`)을
-- 다시 밀 방법이 없다. 그래서 누를 때마다 여기 한 줄을 남기고, 발송기는
-- 그 정산에서 **아직 안 낸 사람만** 골라 보낸다.
--
-- 기록이 남는 것도 값이 있다 — 마지막으로 언제 보냈는지 총무가 볼 수 있어
-- 하루에 세 번 보내는 일이 없다.
create table if not exists settle_reminders (
    id            uuid primary key default gen_random_uuid(),
    settlement_id uuid not null references settlements on delete cascade,
    created_by    uuid references profiles on delete set null,
    created_at    timestamptz not null default now()
);

create index if not exists settle_reminders_idx
    on settle_reminders (settlement_id, created_at desc);


-- ═══ 6. 채팅 ═══════════════════════════════════════════════════
--
-- 카톡 오픈톡을 대신하는 자리다. 다만 중요한 것(라운드·투표·공지)은
-- 여기 흘려보내지 않고 위의 테이블에 남긴다 — 그게 이 앱의 요점이다.

create table if not exists rooms (
    id         uuid primary key default gen_random_uuid(),
    name       text not null,
    round_id   uuid references rounds on delete cascade,  -- 라운드 전용 방
    created_at timestamptz not null default now()
);

create table if not exists messages (
    id         uuid primary key default gen_random_uuid(),
    room_id    uuid not null references rooms on delete cascade,
    user_id    uuid references profiles on delete set null,
    body       text not null,
    -- 어느 글에 답한 것인가. 카톡의 '답장'이다. 원본이 지워져도 답장은
    -- 남아야 하므로 `set null`이다 — 인용만 '지워진 메시지'가 된다.
    reply_to   uuid references messages on delete set null,
    created_at timestamptz not null default now()
);

-- 사진 한 장을 함께 보낼 수 있다. 파일은 Storage에 있고 여기에는 주소만
-- 남는다. 사진만 보내면 body는 빈 글자다 (not null이라 빈 글자로 넣는다).
alter table messages add column if not exists image_url text;
-- ⚠️ 위 정의는 처음 만들 때만 먹는다. 이미 있는 표에는 이 줄이 있어야 한다.
alter table messages add column if not exists reply_to uuid references messages on delete set null;

-- **앱이 스스로 남기는 줄.** 라운드·투표가 올라오면 대화방에도 한 줄
-- 적어 둔다(아래 `announce_*` 트리거). 말풍선이 아니라 가운데 한 줄로
-- 그리고, **알림은 안 보낸다** — 새 모집·새 투표 알림이 이미 갔는데
-- 대화 알림까지 또 가면 두 번 울린다(`notify`의 planFor 참고).
alter table messages add column if not exists system boolean not null default false;

create index if not exists messages_room_idx on messages (room_id, created_at desc);

/**
 * 라운드·투표가 올라오면 대화방에 한 줄 남긴다.
 *
 * 대화가 이 모임의 광장이라, 거기 안 남으면 모집이 열린 줄 모르고 지나간다.
 * `security definer`라 RLS를 안 탄다 — 올린 사람 이름으로 적되 `system`을
 * 세워 두어, 알림은 안 나가고 화면에서도 말풍선이 아닌 안내 줄로 그려진다.
 *
 * 방이 아직 없으면(설치 직후) 조용히 지나간다.
 */
/**
 * 마감된 투표인가.
 *
 * **화면의 `pollClosed()`(types.ts)와 같은 잣대여야 한다** — 손으로 마감했거나
 * 마감 시각이 지났으면 끝난 것이다. 한쪽만 고치면 화면에는 진행중인데
 * DB는 마감으로 보는 일이 생긴다.
 * (`cast_vote`는 이 둘을 따로 본다 — 왜 막혔는지 사람에게 다르게 알려
 *  주려는 것이라, 규칙이 갈린 게 아니라 말만 갈라 놓은 것이다.)
 */
create or replace function poll_shut(p_closed boolean, p_closes timestamptz)
returns boolean language sql stable as $$
    select p_closed or (p_closes is not null and p_closes < now());
$$;

/**
 * 대화방에 안내 한 줄 남기기.
 *
 * **전체 대화방은 `round_id`가 없는 방 중 가장 먼저 만든 것**이다.
 * 방이 하나도 없으면(설치 직후) 조용히 지나간다 — 안내 한 줄 때문에
 * 모집 열기가 통째로 실패하면 안 된다.
 *
 * `security definer`인 것은 방을 찾는 조회가 RLS에 안 걸리게 하려는 것이다.
 * 글의 주인(`user_id`)은 그 일을 한 사람이라, 대화에서는 그 사람이 남긴
 * 것으로 남는다.
 *
 * **부르는 곳이 둘이다** — 모집·투표 트리거(`announce_to_chat`)와
 * 조 편성(`set_round_groups`). 방을 찾는 규칙이 두 벌이 되지 않게 모아 두었다.
 */
create or replace function chat_notice(p_line text, p_actor uuid)
returns void language plpgsql security definer
set search_path = public as $$
declare room uuid;
begin
    select id into room from rooms where round_id is null order by created_at limit 1;
    if room is null then return; end if;
    insert into messages (room_id, user_id, body, system)
    values (room, p_actor, p_line, true);
end $$;

create or replace function announce_to_chat()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
    who   text;
    line  text;
    actor uuid;
    again boolean := false;
begin
    /* **다시 연 것도 알린다.** 예전에는 새로 올릴 때만(`after insert`) 적어서,
       마감했던 투표를 다시 열면 대화방에 아무 말도 안 남았다 — 열어 둔 줄
       모르고 지나간다. 고친 것이 그것뿐일 때는 조용히 지나간다. */
    if tg_op = 'UPDATE' then
        if tg_table_name = 'rounds' then
            again := old.status <> 'open' and new.status = 'open';
        else
            again := poll_shut(old.closed, old.closes_at)
                 and not poll_shut(new.closed, new.closes_at);
        end if;
        if not again then return null; end if;
    end if;

    /* 누가 한 일인가. 새로 올린 것은 **올린 사람**, 다시 연 것은 **지금 누른
       사람**이다 — 남이 연 투표를 운영진이 다시 열 수 있다.
       SQL 편집기에서 고치면 `auth.uid()`가 없으므로 만든 사람으로 되돌아간다. */
    actor := case when tg_op = 'INSERT' then new.created_by
                  else coalesce(auth.uid(), new.created_by) end;
    select name into who from profiles where id = actor;
    who := coalesce(nullif(who, ''), '누군가');

    if tg_table_name = 'rounds' then
        line := who || '님이 '
             || case when new.kind = 'screen' then '스크린' else '라운드' end
             || case when again then ' 모집을 다시 열었습니다'
                                 else ' 모집을 열었습니다' end
             || case when coalesce(new.course, '') <> '' then ' · ' || new.course else '' end;
    else
        line := who || '님이 투표를 '
             || case when again then '다시 열었습니다' else '올렸습니다' end
             || ' · ' || new.title;
    end if;

    perform chat_notice(line, actor);
    return null;
end $$;

drop trigger if exists rounds_announce on rounds;
create trigger rounds_announce after insert on rounds
    for each row execute function announce_to_chat();

drop trigger if exists polls_announce on polls;
create trigger polls_announce after insert on polls
    for each row execute function announce_to_chat();

/* 다시 열렸는지는 함수 안에서 가린다. 조건을 `when`에 적으면 라운드·투표
   두 벌로 갈라져, 규칙이 바뀔 때 한쪽만 고치게 된다. 라운드·투표를 고치는
   일은 드물어 매번 함수가 도는 값은 안 든다. */
drop trigger if exists rounds_reopen on rounds;
create trigger rounds_reopen after update on rounds
    for each row execute function announce_to_chat();

drop trigger if exists polls_reopen on polls;
create trigger polls_reopen after update on polls
    for each row execute function announce_to_chat();

-- 전체 채팅방 하나는 항상 있어야 한다.
insert into rooms (name)
select '전체 대화'
where not exists (select 1 from rooms where round_id is null);


-- ═══ 7. RLS ════════════════════════════════════════════════════
--
-- 기본 원칙:
--   · 읽기는 승인된 회원(is_member)만.
--   · **라운드와 투표는 회원 누구나 만든다.** 남이 만든 것은 못 고친다.
--   · 공지는 총무만 쓴다 — 모임의 결정을 알리는 자리라 그렇다.
--   · 지우기는 관리자, 또는 본인이 만든 것.
--
-- profiles만 예외다 — 방금 로그인한 pending 사용자도 자기 행은 읽어야
-- "승인 대기중" 화면을 띄울 수 있다.

alter table profiles      enable row level security;
alter table rounds        enable row level security;
alter table signups       enable row level security;
alter table polls         enable row level security;
alter table poll_options  enable row level security;
alter table poll_votes    enable row level security;
alter table posts         enable row level security;
alter table post_comments enable row level security;
alter table poll_comments enable row level security;
alter table round_comments enable row level security;
alter table settlements       enable row level security;
alter table settlement_shares enable row level security;
alter table settle_reminders  enable row level security;
alter table round_groups      enable row level security;
alter table rooms         enable row level security;
alter table messages      enable row level security;

-- profiles ---------------------------------------------------
drop policy if exists profiles_read      on profiles;
drop policy if exists profiles_self_add  on profiles;
drop policy if exists profiles_self_upd  on profiles;
drop policy if exists profiles_admin     on profiles;
drop policy if exists profiles_owner     on profiles;
drop policy if exists profiles_staff_upd on profiles;
drop policy if exists profiles_super     on profiles;

-- 본인 행은 언제나 읽을 수 있다(승인 대기 화면용). 회원이면 전체 명단도 본다.
create policy profiles_read on profiles for select
    using (id = auth.uid() or is_member());

-- **추방은 행을 남겨 두는 것으로 한다.** 지우면 다음 로그인 때 아래
-- profiles_self_add로 되살아나 다시 신청이 들어온다. `banned` 행이 남아
-- 있으면 is_member()가 false라 아무것도 못 보고, 스스로 등급도 못 바꾼다
-- (profiles_self_upd의 with check가 role = my_role()을 본다).

-- **본인 행은 스스로 만들 수 있다 — 단 대기 상태로만.**
-- 로그인 트리거는 auth.users가 새로 생길 때만 돈다. 그래서 운영진이
-- 명단에서 지운 사람이 다시 로그인하면, 계정은 남아 있는데 프로필이 없어
-- 아무 화면에도 못 들어가는 상태가 됐다. 그때 앱이 이 정책으로 행을 다시
-- 만들어 **가입 신청부터 다시** 하게 한다. role은 pending으로 못박는다.
create policy profiles_self_add on profiles for insert
    with check (id = auth.uid() and role = 'pending');

-- 본인은 이름·핸디캡·전화만 고친다. role을 스스로 올리지 못하게
-- with check에서 role이 그대로인지 본다.
create policy profiles_self_upd on profiles for update
    using (id = auth.uid())
    with check (id = auth.uid() and role = my_role());

-- **앱관리자는 무엇이든 한다** — 운영자(방장) 임명이 이 사람 몫이다.
create policy profiles_super on profiles for all
    using (is_super()) with check (is_super());

-- **방장은 부운영자·총무까지 임명한다.** 인원 제한은 없다.
-- `using`이 고치기 전 행을 보므로 **위쪽 사람(운영자·앱관리자) 행은 손을
-- 못 대고**, `with check`가 고친 뒤를 보므로 **남을 자기 위로 올릴 수도
-- 없다.** 화면에서 버튼을 감추는 것만으로는 부족하다.
create policy profiles_owner on profiles for update
    using (is_owner() and role not in ('admin', 'superadmin'))
    with check (is_owner() and role not in ('admin', 'superadmin'));

-- 부운영자는 **가입 승인까지만** 한다.
create policy profiles_staff_upd on profiles for update
    using (is_admin() and role in ('pending', 'member', 'banned'))
    with check (is_admin() and role in ('pending', 'member', 'banned'));

-- rounds -----------------------------------------------------
-- **라운드는 누구나 연다.** 이 앱을 만든 까닭이 그것이다 — 총무 한 사람이
-- 다 짜는 게 아니라 서로 올리고 서로 모으는 것. 대신 남이 올린 것은 못
-- 고치고 못 지운다 (총무는 예외).
drop policy if exists rounds_read  on rounds;
drop policy if exists rounds_write on rounds;
drop policy if exists rounds_add   on rounds;
drop policy if exists rounds_upd   on rounds;
drop policy if exists rounds_del   on rounds;
drop policy if exists rounds_admin on rounds;
create policy rounds_read  on rounds for select using (is_member());
create policy rounds_add   on rounds for insert with check (is_member() and created_by = auth.uid());
create policy rounds_upd   on rounds for update
    using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy rounds_del   on rounds for delete using (created_by = auth.uid());
create policy rounds_admin on rounds for all    using (is_admin()) with check (is_admin());

-- signups ----------------------------------------------------
-- 신청/취소는 RPC(join_round·leave_round)로만 한다. 여기서는 읽기만 연다.
-- 직접 insert를 막아야 정원 계산을 건너뛸 수 없다.
drop policy if exists signups_read on signups;
drop policy if exists signups_admin on signups;
create policy signups_read  on signups for select using (is_member());
create policy signups_admin on signups for all    using (is_admin()) with check (is_admin());

-- round_groups — **쓰기는 `set_round_groups`로만 한다.**
-- `signups`에 직접 insert를 안 여는 것과 같은 이유다: 조 번호와 이 표는
-- 함께 움직여야 하는데, 여기만 따로 고칠 수 있으면 '편성이 있다고 적혀
-- 있는데 아무도 조에 없는' 상태가 만들어진다. 운영진에게만 지우기를
-- 열어 두는 것은 되돌릴 길 하나는 남기려는 것이다.
drop policy if exists round_groups_read on round_groups;
drop policy if exists round_groups_admin on round_groups;
create policy round_groups_read  on round_groups for select using (is_member());
create policy round_groups_admin on round_groups for delete using (is_admin());

-- polls ------------------------------------------------------
drop policy if exists polls_read on polls;
drop policy if exists polls_write on polls;
drop policy if exists polls_add on polls;
drop policy if exists polls_upd on polls;
drop policy if exists polls_del on polls;
drop policy if exists polls_admin on polls;
drop policy if exists poll_options_read on poll_options;
drop policy if exists poll_options_write on poll_options;
drop policy if exists poll_options_own on poll_options;
drop policy if exists poll_options_admin on poll_options;
drop policy if exists poll_votes_read on poll_votes;
drop policy if exists poll_votes_admin on poll_votes;
-- 투표도 라운드와 같다 — 누구나 만들고, 만든 사람과 총무가 고친다.
create policy polls_read         on polls        for select using (is_member());
create policy polls_add          on polls        for insert with check (is_member() and created_by = auth.uid());
create policy polls_upd          on polls        for update
    using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy polls_del          on polls        for delete using (created_by = auth.uid());
create policy polls_admin        on polls        for all    using (is_admin()) with check (is_admin());

-- 항목은 그 투표를 만든 사람 것이다. polls를 들여다봐서 주인을 가린다
-- (polls_read가 회원 전체에게 열려 있어 이 조회는 통한다).
create policy poll_options_read  on poll_options for select using (is_member());
create policy poll_options_own   on poll_options for all
    using (exists (select 1 from polls p where p.id = poll_id and p.created_by = auth.uid()))
    with check (exists (select 1 from polls p where p.id = poll_id and p.created_by = auth.uid()));
create policy poll_options_admin on poll_options for all    using (is_admin()) with check (is_admin());
-- 표는 RPC로만 넣는다(cast_vote). 읽기는 회원 전체.
create policy poll_votes_read    on poll_votes   for select using (is_member());
create policy poll_votes_admin   on poll_votes   for all    using (is_admin()) with check (is_admin());

-- posts ------------------------------------------------------
drop policy if exists posts_read on posts;
drop policy if exists posts_write on posts;
drop policy if exists posts_own on posts;
create policy posts_read  on posts for select using (is_member());
create policy posts_write on posts for all    using (is_admin()) with check (is_admin());
create policy posts_own   on posts for update using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists comments_read on post_comments;
drop policy if exists comments_add on post_comments;
drop policy if exists comments_own on post_comments;
drop policy if exists comments_admin on post_comments;
create policy comments_read  on post_comments for select using (is_member());
create policy comments_add   on post_comments for insert with check (is_member() and author_id = auth.uid());
create policy comments_own   on post_comments for delete using (author_id = auth.uid());
create policy comments_admin on post_comments for all    using (is_admin()) with check (is_admin());

-- poll_comments — 공지 댓글과 같은 규칙이다.
drop policy if exists poll_comments_read on poll_comments;
drop policy if exists poll_comments_add on poll_comments;
drop policy if exists poll_comments_own on poll_comments;
drop policy if exists poll_comments_admin on poll_comments;
create policy poll_comments_read  on poll_comments for select using (is_member());
create policy poll_comments_add   on poll_comments for insert with check (is_member() and author_id = auth.uid());
create policy poll_comments_own   on poll_comments for delete using (author_id = auth.uid());
create policy poll_comments_admin on poll_comments for all    using (is_admin()) with check (is_admin());

-- round_comments — 위 둘과 같은 규칙이다.
drop policy if exists round_comments_read on round_comments;
drop policy if exists round_comments_add on round_comments;
drop policy if exists round_comments_own on round_comments;
drop policy if exists round_comments_admin on round_comments;
create policy round_comments_read  on round_comments for select using (is_member());
create policy round_comments_add   on round_comments for insert with check (is_member() and author_id = auth.uid());
create policy round_comments_own   on round_comments for delete using (author_id = auth.uid());
create policy round_comments_admin on round_comments for all    using (is_admin()) with check (is_admin());

-- ── 정산 ──────────────────────────────────────────────────────
--
-- **회원 누구나 정산을 만든다**(사용자가 정한 것이다). 100명 모임에서
-- 라운드를 여는 사람이 제각각인데 총무 한 사람이 모든 돈을 걷는 것은
-- 무리라, 걷는 사람이 곧 만드는 사람이 되게 열었다.
--
-- **대신 남의 정산은 못 건드린다.** 여는 순간 누구나 계좌번호를 걸고
-- 100명에게 알림을 밀 수 있게 되므로, 열어 준 만큼 좁히는 것이 이 아래
-- 정책들이다:
--   · 만들 때 `created_by`가 나여야 한다 — 남의 이름으로 못 만든다.
--   · 고치고 지우는 것은 **만든 사람과 총무·운영진**뿐이다.
--   · 몫(`settlement_shares`)도 같은 잣대다 — 정산과 몫이 따로 놀면
--     남의 정산에 내 몫을 끼워 넣는 길이 생긴다.
--
-- **총무·운영진(`can_settle`)은 그대로 전부 만질 수 있다.** 만든 사람이
-- 한동안 안 들어올 때 대신 챙길 자리가 없으면 돈이 공중에 뜬다.

-- **이 정산이 내 것인가.** 정책 네 곳과 트리거 하나가 같이 쓴다 —
-- 잣대가 여러 벌이 되면 한쪽만 고치게 된다.
-- `security definer`인 것은 `settlements`를 읽는 이 조회가 다시 RLS를
-- 타지 않게 하려는 것이다(`is_member()`와 같은 이유다).
create or replace function owns_settlement(p_settlement uuid)
returns boolean
language sql security definer stable set search_path = public as $$
    select exists (
        select 1 from settlements
        where id = p_settlement and created_by = auth.uid()
    );
$$;

drop policy if exists settlements_read   on settlements;
drop policy if exists settlements_write  on settlements;
drop policy if exists settlements_add    on settlements;
drop policy if exists settlements_own    on settlements;
drop policy if exists settlements_admin  on settlements;
drop policy if exists shares_read        on settlement_shares;
drop policy if exists shares_write       on settlement_shares;
drop policy if exists shares_own         on settlement_shares;
drop policy if exists shares_admin       on settlement_shares;
drop policy if exists shares_own_paid    on settlement_shares;

create policy settlements_read  on settlements for select using (is_member());
-- **`created_by = auth.uid()`가 이 줄의 전부다.** 이게 없으면 남의 이름으로
-- 정산을 만들어 그 사람 계좌인 것처럼 꾸밀 수 있다.
create policy settlements_add   on settlements for insert
    with check (is_member() and created_by = auth.uid());
create policy settlements_own   on settlements for all
    using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy settlements_admin on settlements for all
    using (can_settle()) with check (can_settle());

create policy shares_read  on settlement_shares for select using (is_member());
create policy shares_own   on settlement_shares for all
    using (owns_settlement(settlement_id))
    with check (owns_settlement(settlement_id));
create policy shares_admin on settlement_shares for all
    using (can_settle()) with check (can_settle());
-- **본인 몫은 스스로 '보냈다'고 표시할 수 있다.** 금액은 못 고친다 —
-- `with check`가 `user_id`가 그대로인지만 보고, 금액 변경은 아래
-- 트리거가 막는다.
create policy shares_own_paid on settlement_shares for update
    using (user_id = auth.uid()) with check (user_id = auth.uid());

-- settle_reminders — **그 정산을 만든 사람과 총무·운영진.**
-- 남의 정산에 독촉을 보내면 그 사람 계좌로 오라는 알림이 100명에게 나간다.
-- 회원에게는 알림으로 갈 뿐이라 이 표를 읽을 일이 없다. 지우기는 안 연다:
-- 언제 보냈는지가 남아 있어야 하루에 세 번 보내는 일이 없다.
drop policy if exists settle_reminders_read on settle_reminders;
drop policy if exists settle_reminders_add  on settle_reminders;
create policy settle_reminders_read on settle_reminders for select
    using (can_settle() or owns_settlement(settlement_id));
create policy settle_reminders_add  on settle_reminders for insert
    with check (created_by = auth.uid()
                and (can_settle() or owns_settlement(settlement_id)));

create or replace function shares_amount_locked()
returns trigger language plpgsql
security definer set search_path = public as $$
begin
    -- 금액을 고칠 수 있는 사람은 **그 정산을 만든 사람과 총무·운영진**뿐이다.
    -- 나머지는 `paid`(보냈다는 표시)만 뒤집을 수 있다 — 안 그러면 자기 몫을
    -- 0원으로 고쳐 놓고 냈다고 표시할 수 있다.
    if new.amount <> old.amount
       and not (can_settle() or owns_settlement(new.settlement_id)) then
        raise exception '금액은 정산을 올린 사람만 고칠 수 있습니다';
    end if;
    return new;
end $$;

drop trigger if exists shares_amount_guard on settlement_shares;
create trigger shares_amount_guard before update on settlement_shares
    for each row execute function shares_amount_locked();

-- chat -------------------------------------------------------
drop policy if exists rooms_read on rooms;
drop policy if exists rooms_write on rooms;
drop policy if exists messages_read on messages;
drop policy if exists messages_add on messages;
drop policy if exists messages_own on messages;
drop policy if exists messages_admin on messages;
create policy rooms_read     on rooms    for select using (is_member());
create policy rooms_write    on rooms    for all    using (is_admin()) with check (is_admin());
-- **들어오기 전 대화는 아예 읽히지 않는다.** 화면에서 거르면 통신에는
-- 다 실려 오므로, 여기서 막는 것이 맞다.
create policy messages_read  on messages for select
    using (is_member() and created_at >= chat_since());
create policy messages_add   on messages for insert with check (is_member() and user_id = auth.uid());
create policy messages_own   on messages for delete using (user_id = auth.uid());
create policy messages_admin on messages for all    using (is_admin()) with check (is_admin());


-- ═══ 7-1. 읽음 표시 (카톡의 안 읽은 사람 수) ═══════════════════
--
-- 말풍선 옆에 **아직 안 읽은 사람 수**를 적는다. 다 읽으면 숫자가 사라진다.
--
-- **글마다 기록하지 않는다.** 100명이 하루 100마디를 주고받으면 '누가 어느
-- 글을 읽었나'는 하루 만 줄이 된다. 대신 **사람마다 어디까지 읽었는지**
-- 시각 하나만 남긴다 — 100명이면 100줄로 끝나고, 해가 지나도 안 늘어난다.
-- '이 글을 읽었나'는 `last_read_at >= created_at`으로 화면이 셈한다.

create table if not exists room_reads (
    room_id      uuid not null references rooms on delete cascade,
    user_id      uuid not null references profiles on delete cascade,
    last_read_at timestamptz not null default now(),
    primary key (room_id, user_id)
);

alter table room_reads enable row level security;
drop policy if exists room_reads_read on room_reads;
drop policy if exists room_reads_mine on room_reads;
-- 숫자를 세려면 남의 읽음도 봐야 한다. 회원이면 다 읽힌다.
create policy room_reads_read on room_reads for select using (is_member());
-- **쓰는 것은 자기 줄만.** 남이 읽은 것으로 대신 찍어 줄 수는 없다.
create policy room_reads_mine on room_reads for all
    using (user_id = auth.uid())
    with check (user_id = auth.uid() and is_member());

/**
 * 승인되는 순간 읽음 줄을 만들어 둔다.
 *
 * 이게 없으면 **승인만 받고 대화를 한 번도 안 연 사람** 때문에 지난 글이
 * 전부 `안 읽음 +1`로 굳는다 — 그 사람은 들어오기 전 글을 **볼 수도 없는데**
 * (`chat_since()`) 영영 안 읽은 사람으로 세어진다.
 * 승인 시각으로 찍어 두면 그 전 글은 읽은 것이 되고, 그 뒤 글만 세어진다.
 *
 * `security definer`인 것은 **남의 줄을 넣는 일**이라 위 정책
 * (`user_id = auth.uid()`)에 걸리기 때문이다. `stamp_joined_at`이 도장을
 * 찍은 **뒤에** 돌아야 하므로 `AFTER`다.
 */
create or replace function seed_room_reads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    if new.joined_at is not null and old.joined_at is null then
        insert into room_reads (room_id, user_id, last_read_at)
        select r.id, new.id, new.joined_at from rooms r
        on conflict (room_id, user_id) do nothing;
    end if;
    return null;
end $$;

drop trigger if exists profiles_seed_reads on profiles;
create trigger profiles_seed_reads after update on profiles
    for each row execute function seed_room_reads();

/*
 * 이미 있는 회원에게도 읽음 줄을 만들어 둔다. 위 트리거는 **승인되는 순간**에만
 * 돌기 때문에, 이 기능이 생기기 전부터 있던 사람은 줄이 없다 — 줄이 없으면
 * 화면이 '한 번도 안 읽음'으로 세어 지난 글이 전부 `안 읽음`으로 굳는다.
 *
 * **`now()`로 찍는다. `joined_at`으로 찍지 말 것.**
 * 몇 달째 대화를 읽어 온 사람도 가입 시각으로 찍히면, 그 사람이 대화를 한 번
 * 열기 전까지 **지난 몇 달치 글이 전부 안 읽음으로 보인다.** 실제로 그렇게
 * 넣었다가 숫자가 3~4에서 안 내려간다는 제보를 받았다.
 * 읽음 표시를 켜는 순간까지의 이야기는 **다 읽은 것으로 보는 게 맞다** —
 * 그전 기록이 아예 없으므로 지어낼 수가 없고, 카톡도 그렇게 시작한다.
 *
 * `do nothing`이라 **다시 실행해도 이미 있는 줄은 안 건드린다** — 스키마를
 * 통째로 다시 돌려도 사람들의 읽음 자리가 되돌아가지 않는다.
 */
insert into room_reads (room_id, user_id, last_read_at)
select r.id, p.id, now()
  from rooms r cross join profiles p
 where p.role in ('member', 'treasurer', 'staff', 'admin', 'superadmin')
on conflict (room_id, user_id) do nothing;

/**
 * `여기까지 읽었다`를 지금으로 밀어 둔다.
 *
 * **시각을 화면이 정해 보내지 않는다.** 폰 시계가 몇 초 어긋나 있으면
 * 방금 온 글보다 앞선 시각이 찍혀, 읽었는데도 숫자가 안 줄어든다.
 * 서버의 `now()`로 찍으면 그럴 일이 없다.
 *
 * `security invoker`(기본)라 위 정책이 그대로 걸린다 — 넣는 것은 늘
 * `auth.uid()`의 줄이라 남의 읽음은 못 건드린다.
 */
create or replace function mark_room_read(p_room uuid)
returns void language sql set search_path = public as $$
    insert into room_reads (room_id, user_id, last_read_at)
    values (p_room, auth.uid(), now())
    on conflict (room_id, user_id) do update set last_read_at = now();
$$;


-- ═══ 7-1. 알림 받을 기기 ═══════════════════════════════════════
--
-- 앱을 안 보고 있을 때 폰으로 밀어 줄 곳. **사람이 아니라 기기 단위다** —
-- 한 사람이 폰과 PC로 따로 켜면 두 줄이 된다.
-- `endpoint`가 그 기기의 주소이자 열쇠라 여기에 unique를 건다.

create table if not exists push_subscriptions (
    endpoint   text primary key,
    user_id    uuid not null references profiles on delete cascade,
    p256dh     text not null,
    auth       text not null,
    ua         text not null default '',
    -- 이 기기로 **대화** 알림을 받는가. 대화만 따로 끌 수 있게 둔 칸이다 —
    -- 모집·공지·투표는 하루 몇 번이지만 대화는 종일 울려서, 그것 때문에
    -- 알림을 통째로 꺼 버리면 정작 라운드 소식을 놓친다.
    chat       boolean not null default true,
    created_at timestamptz not null default now()
);

-- ⚠️ 위 정의는 처음 만들 때만 먹는다. 이미 있는 표에는 이 줄이 있어야 한다.
alter table push_subscriptions add column if not exists chat boolean not null default true;

create index if not exists push_subs_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

drop policy if exists push_subs_own   on push_subscriptions;
drop policy if exists push_subs_admin on push_subscriptions;
-- 자기 구독만 보고 넣고 지운다. 발송기는 service_role로 읽으므로
-- 여기 정책과 상관없이 전체를 본다.
create policy push_subs_own on push_subscriptions for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subs_admin on push_subscriptions for all
    using (is_admin()) with check (is_admin());


-- ═══ 7-2. 사진 저장소 ══════════════════════════════════════════
--
-- 대화에 올리는 사진은 `chat-photos` 통에 넣는다. 공개 통이라 주소를 아는
-- 사람은 볼 수 있다 — 우리 모임 사진첩 정도의 무게라 그렇게 두었다.
-- 대신 **올리고 지우는 것은 승인된 회원만** 할 수 있게 막는다.

insert into storage.buckets (id, name, public)
values ('chat-photos', 'chat-photos', true)
on conflict (id) do nothing;

drop policy if exists chat_photos_read on storage.objects;
drop policy if exists chat_photos_add  on storage.objects;
drop policy if exists chat_photos_del  on storage.objects;

create policy chat_photos_read on storage.objects for select
    using (bucket_id = 'chat-photos');
create policy chat_photos_add on storage.objects for insert to authenticated
    with check (bucket_id = 'chat-photos' and is_member());
create policy chat_photos_del on storage.objects for delete to authenticated
    using (bucket_id = 'chat-photos' and (owner = auth.uid() or is_admin()));

-- 프로필 사진은 따로 둔다. 대화 사진과 수명이 달라서다 — 대화 사진은
-- 쌓이기만 하지만 이건 사람마다 한 장씩 갈아 끼운다.
-- **승인 전(pending)에도 올릴 수 있어야 한다** — 가입 화면에서 얼굴을
-- 올려 두면 운영진이 알아보기 쉽다. 그래서 `is_member()`가 아니라
-- 로그인한 사람이면 되고, **자기 폴더에만** 넣을 수 있게 막는다.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists avatars_read on storage.objects;
drop policy if exists avatars_add  on storage.objects;
drop policy if exists avatars_del  on storage.objects;

create policy avatars_read on storage.objects for select
    using (bucket_id = 'avatars');
create policy avatars_add on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars'
                and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_del on storage.objects for delete to authenticated
    using (bucket_id = 'avatars'
           and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));


-- ═══ 8. 실시간 ═════════════════════════════════════════════════
--
-- 이 테이블들이 바뀌면 앱으로 밀어 준다. 채팅은 물론이고
-- 신청도 실시간이어야 한다 — 선착순 자리가 차는 걸 봐야 하기 때문이다.

do $$
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
    end if;
end $$;

-- 화면이 구독하는 표는 **빠짐없이** 여기 있어야 한다. 빠지면 조용히
-- 실시간만 안 먹는다 — 오류도 안 나서 알아채기 어렵다.
-- (polls·profiles가 빠져 있어 투표를 지워도 탭의 숫자가 그대로였고,
--  총무가 승인해도 대기 화면이 새로고침 전에는 안 바뀌었다.)
-- add table은 이미 들어 있으면 오류가 나므로 없는 것만 넣는다.
do $$
declare t text;
begin
    foreach t in array array[
        'messages', 'signups', 'rounds', 'polls', 'poll_options', 'poll_votes',
        'posts', 'post_comments', 'poll_comments', 'round_comments', 'profiles',
        'settlements', 'settlement_shares', 'room_reads', 'round_groups'
    ] loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end $$;
