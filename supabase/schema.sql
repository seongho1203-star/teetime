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
    -- pending 승인 대기 · member 회원 · staff 부운영자 · admin 운영자
    -- banned 추방 — 행을 남겨 두는 것이 곧 막는 방법이다. 지우면 다시
    --               로그인할 때 앱이 대기 상태로 되살려 버린다.
    role        text        not null default 'pending'
                            check (role in ('pending', 'member', 'staff', 'admin', 'banned')),
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
    check (role in ('pending', 'member', 'staff', 'admin', 'banned'));

alter table profiles add column if not exists joined_at timestamptz;

-- 이미 있던 회원은 처음 들어온 때부터 본다.
update profiles set joined_at = created_at
 where joined_at is null and role in ('member', 'staff', 'admin');

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
        where id = auth.uid() and role in ('member', 'staff', 'admin')
    );
$$;

-- **운영진**이다 — 운영자와 부운영자를 함께 가리킨다.
-- 이름은 is_admin 그대로 두었다. 정책 스무 군데가 이 이름을 쓰고 있고,
-- 부운영자가 하는 일이 운영자와 같기 때문이다(역할 임명만 빼고).
create or replace function is_admin() returns boolean
language sql security definer stable set search_path = public as $$
    select exists (
        select 1 from profiles
        where id = auth.uid() and role in ('staff', 'admin')
    );
$$;

-- **운영자 한 사람**. 부운영자를 임명하고 푸는 것은 이 사람만 한다.
create or replace function is_owner() returns boolean
language sql security definer stable set search_path = public as $$
    select exists (
        select 1 from profiles
        where id = auth.uid() and role = 'admin'
    );
$$;

-- 내 등급. profiles의 정책 안에서 profiles를 다시 조회하면 무한 재귀가
-- 나므로, 이 함수를 거쳐 읽는다.
-- **승인되는 순간에 도장을 찍는다.** 화면이 넣어 주기를 기다리면 빠뜨리는
-- 길이 생긴다(운영진이 SQL로 직접 올리는 경우 등).
create or replace function stamp_joined_at()
returns trigger language plpgsql as $$
begin
    if new.role in ('member', 'staff', 'admin')
       and (old.role is null or old.role not in ('member', 'staff', 'admin'))
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
alter table rounds drop constraint if exists rounds_caddie_check;
alter table rounds add  constraint rounds_caddie_check check (caddie in ('caddie', 'none'));
alter table rounds drop constraint if exists rounds_cart_check;
alter table rounds add  constraint rounds_cart_check   check (cart in ('included', 'excluded'));

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

    -- 확정 자리가 하나 비었으니 대기 1번을 올린다.
    if v_state = 'confirmed' then
        update signups set state = 'confirmed'
         where id = (
            select id from signups
             where round_id = p_round and state = 'waitlist'
             order by seq
             limit 1
         );
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
        update signups set state = 'confirmed'
         where id = (
            select id from signups
             where round_id = p_round and state = 'waitlist'
             order by seq limit 1
         );
    end if;
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
    created_at timestamptz not null default now()
);

-- 사진 한 장을 함께 보낼 수 있다. 파일은 Storage에 있고 여기에는 주소만
-- 남는다. 사진만 보내면 body는 빈 글자다 (not null이라 빈 글자로 넣는다).
alter table messages add column if not exists image_url text;

create index if not exists messages_room_idx on messages (room_id, created_at desc);

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
alter table rooms         enable row level security;
alter table messages      enable row level security;

-- profiles ---------------------------------------------------
drop policy if exists profiles_read      on profiles;
drop policy if exists profiles_self_add  on profiles;
drop policy if exists profiles_self_upd  on profiles;
drop policy if exists profiles_admin     on profiles;
drop policy if exists profiles_owner     on profiles;
drop policy if exists profiles_staff_upd on profiles;

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

-- 운영자는 무엇이든 한다 — 부운영자 임명도 여기 들어간다.
create policy profiles_owner on profiles for all
    using (is_owner()) with check (is_owner());

-- 부운영자는 **가입 승인까지만** 한다.
-- using이 고치기 전 행을 보므로 운영자·부운영자 행은 손댈 수 없고,
-- with check가 고친 뒤를 보므로 남을 운영진으로 올릴 수도 없다.
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
    created_at timestamptz not null default now()
);

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
        'posts', 'post_comments', 'profiles'
    ] loop
        if not exists (
            select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
        ) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end $$;
