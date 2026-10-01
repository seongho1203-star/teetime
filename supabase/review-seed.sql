-- ═══════════════════════════════════════════════════════════════
--  심사용 서버 · 샘플 모임과 심사 계정
--
--  **실제 모임 DB에는 절대 돌리지 말 것.** 애플·구글 심사자가 쓰는 따로
--  떨어진 Supabase 프로젝트 전용이다(`.github/workflows/review.yml`이
--  `REVIEW_DB_URL`에만 돌린다). 여기 사람들은 전부 지어낸 이름이다.
--
--  - **심사 계정**: `review@kkakkung.app` · 비밀번호는 저장소에 없다 —
--    워크플로가 비밀값 `REVIEW_PASSWORD`를 `-v review_pw=…`로 넘긴다.
--    가입·승인·프로필까지 다 채워져 있어 문자 인증도 운영진 승인도 없이
--    곧바로 들어간다. **운영자(admin)** 라 공지 쓰기까지 다 해 볼 수 있다.
--  - **여러 번 돌려도 안전하다** — 고정 id에 `on conflict`. 매일 한 번 돌아
--    ① 비밀번호·등급·프로필을 되돌리고(심사자가 바꾸거나 탈퇴해도 다음 날
--    되살아난다) ② 다가오는 라운드·투표 날짜를 앞으로 민다(심사가 몇 주
--    늦어져도 '지난 라운드'만 남지 않게).
--  - 심사자가 한 일(신청·대화·투표)은 지우지 않는다.
-- ═══════════════════════════════════════════════════════════════

set search_path = public, extensions;

-- **실제 모임 DB면 여기서 멈춘다.** 비밀값을 잘못 넣어 이 파일이 진짜 DB로
-- 가는 일을 막는 마지막 문이다 — 샘플이 아닌 회원이 스물을 넘으면 실제 모임이다.
do $$
begin
    if (select count(*) from profiles
        where id::text not like 'a0000000-0000-4000-8000-%') > 20 then
        raise exception '실제 모임 DB로 보입니다 — 심사용 샘플을 넣지 않습니다. REVIEW_DB_URL을 확인하세요.';
    end if;
end $$;

-- ── 1. 계정 ─────────────────────────────────────────────────────
-- 사람마다 auth.users 한 줄 — profiles가 그것을 참조한다. 샘플 회원은
-- 비밀번호가 없어(빈 값) 아무도 그 계정으로 못 들어간다.
with people(id, email, name, pw) as (values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'review@kkakkung.app',       '심사자',
        crypt(:'review_pw', gen_salt('bf'))),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'sample02@kkakkung.invalid', '김민준', ''),
    ('a0000000-0000-4000-8000-000000000003'::uuid, 'sample03@kkakkung.invalid', '이서연', ''),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'sample04@kkakkung.invalid', '박지훈', ''),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'sample05@kkakkung.invalid', '최유나', ''),
    ('a0000000-0000-4000-8000-000000000006'::uuid, 'sample06@kkakkung.invalid', '정현우', ''),
    ('a0000000-0000-4000-8000-000000000007'::uuid, 'sample07@kkakkung.invalid', '강도윤', ''),
    ('a0000000-0000-4000-8000-000000000008'::uuid, 'sample08@kkakkung.invalid', '윤하은', ''),
    ('a0000000-0000-4000-8000-000000000009'::uuid, 'sample09@kkakkung.invalid', '새회원', '')
)
insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
       email, pw, now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('name', name), now(), now()
from people
on conflict (id) do update
    set encrypted_password = excluded.encrypted_password,
        email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()),
        banned_until       = null,
        deleted_at         = null,
        updated_at         = now();

-- 로그인 서버(GoTrue)는 토큰 칸이 NULL이면 그 계정을 읽다 넘어진다
-- (`converting NULL to string`). 판마다 칸이 달라 있는 것만 빈 글자로 채운다.
do $$
declare c text;
begin
    foreach c in array array['confirmation_token', 'recovery_token', 'email_change_token_new',
                             'email_change', 'email_change_token_current', 'phone_change',
                             'phone_change_token', 'reauthentication_token'] loop
        if exists (select 1 from information_schema.columns
                   where table_schema = 'auth' and table_name = 'users' and column_name = c) then
            execute format('update auth.users set %1$I = '''' where %1$I is null
                            and id::text like ''a0000000-0000-4000-8000-%%''', c);
        end if;
    end loop;
end $$;

-- 이메일 로그인은 identities 한 줄이 있어야 한다.
insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                             last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.id = 'a0000000-0000-4000-8000-000000000001'
on conflict do nothing;

-- ── 2. 프로필 ───────────────────────────────────────────────────
-- 가입 트리거가 profiles 줄을 만들어 두었다. 칸을 다 채워야 앱이
-- `프로필 채우기`·`생일 받기` 화면에 안 멈춘다. **joined_at을 옛날로** 두는
-- 것은 대화가 보이게 하려는 것이다(그 뒤의 글만 보인다 — `chat_since()`).
with p(id, name, role, gender, birth_year, region) as (values
    ('a0000000-0000-4000-8000-000000000001'::uuid, '심사자', 'admin',     'm', 1985::smallint, '광산구'),
    ('a0000000-0000-4000-8000-000000000002'::uuid, '김민준', 'staff',     'm', 1978::smallint, '서구'),
    ('a0000000-0000-4000-8000-000000000003'::uuid, '이서연', 'treasurer', 'f', 1983::smallint, '북구'),
    ('a0000000-0000-4000-8000-000000000004'::uuid, '박지훈', 'member',    'm', 1980::smallint, '남구'),
    ('a0000000-0000-4000-8000-000000000005'::uuid, '최유나', 'member',    'f', 1988::smallint, '동구'),
    ('a0000000-0000-4000-8000-000000000006'::uuid, '정현우', 'member',    'm', 1975::smallint, '광산구'),
    ('a0000000-0000-4000-8000-000000000007'::uuid, '강도윤', 'member',    'm', 1991::smallint, '나주'),
    ('a0000000-0000-4000-8000-000000000008'::uuid, '윤하은', 'member',    'f', 1986::smallint, '담양'),
    ('a0000000-0000-4000-8000-000000000009'::uuid, '새회원', 'pending',   'm', 1990::smallint, '화순')
)
insert into profiles (id, name, role, gender, birth_year, region, joined_at)
select id, name, role, gender, birth_year, region,
       case when role = 'pending' then null else timestamptz '2026-01-01 00:00+09' end
from p
on conflict (id) do update
    set name = excluded.name, role = excluded.role, gender = excluded.gender,
        birth_year = excluded.birth_year, region = excluded.region,
        joined_at = excluded.joined_at;

insert into profile_private (id, phone, car, birth_md, birth_cal)
select id, '010-0000-' || right(id::text, 4), '00가 ' || right(id::text, 4), '05-05', 'solar'
from profiles where id::text like 'a0000000-0000-4000-8000-%'
on conflict (id) do update
    set phone = excluded.phone, car = excluded.car,
        birth_md = excluded.birth_md, birth_cal = excluded.birth_cal;

-- ── 3. 라운드 ───────────────────────────────────────────────────
-- 한국 시각으로 날짜를 잡는다. **다가오는 둘은 하루 안으로 다가오면 다시
-- 민다** — 심사가 늦어져도 늘 신청해 볼 라운드가 있게.
insert into rounds (id, course, tee_at, capacity, fee, note, status, kind, caddie, cart, created_by)
values
    ('b0000000-0000-4000-8000-000000000001', '무등산CC',
        (date_trunc('day', now() at time zone 'Asia/Seoul') + interval '7 days 07:30') at time zone 'Asia/Seoul',
        8, 150000, '정기모임입니다. 그린피·카트비 포함 금액입니다.', 'open', 'field', 'caddie', 'included',
        'a0000000-0000-4000-8000-000000000002'),
    ('b0000000-0000-4000-8000-000000000002', '골프존파크 상무점',
        (date_trunc('day', now() at time zone 'Asia/Seoul') + interval '3 days 19:00') at time zone 'Asia/Seoul',
        6, 25000, '퇴근 후 스크린 한 게임 하실 분!', 'open', 'screen', null, null,
        'a0000000-0000-4000-8000-000000000004'),
    ('b0000000-0000-4000-8000-000000000003', '어등산CC',
        (date_trunc('day', now() at time zone 'Asia/Seoul') - interval '10 days' + interval '08:00') at time zone 'Asia/Seoul',
        4, 140000, '', 'open', 'field', 'caddie', 'included',
        'a0000000-0000-4000-8000-000000000002')
on conflict (id) do update
    set tee_at = excluded.tee_at
    where rounds.kind = excluded.kind
      and excluded.tee_at > now()                 -- 지난 라운드는 그대로
      and rounds.tee_at < now() + interval '1 day';

insert into signups (round_id, user_id, state, seq)
values
    ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'confirmed', 1),
    ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'confirmed', 2),
    ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', 'confirmed', 3),
    ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', 'confirmed', 4),
    ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008', 'confirmed', 5),
    ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', 'confirmed', 1),
    ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000007', 'confirmed', 2),
    ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005', 'confirmed', 3),
    ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', 'confirmed', 1),
    ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'confirmed', 2),
    ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', 'confirmed', 3),
    ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000004', 'confirmed', 4)
on conflict (round_id, user_id) do nothing;

-- 지난 라운드의 정산 — 심사자 몫은 아직 안 낸 것으로 둔다(홈의 `미정산금액`).
insert into settlements (id, round_id, title, body, bank, account, total, created_by)
values ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003',
        '어등산 그린피·카트비', '입금하시고 입금완료를 눌러 주세요.', '광주은행', '000-000-000000',
        560000, 'a0000000-0000-4000-8000-000000000003')
on conflict (id) do nothing;

insert into settlement_shares (settlement_id, user_id, amount, paid)
values
    ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 140000, false),
    ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 140000, true),
    ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 140000, true),
    ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 140000, false)
on conflict (settlement_id, user_id) do nothing;

-- ── 4. 투표 · 공지 ──────────────────────────────────────────────
insert into polls (id, title, body, multi, closes_at, created_by)
values ('d0000000-0000-4000-8000-000000000001', '다음 정기모임 날짜', '가능한 날을 모두 골라 주세요.', true,
        now() + interval '5 days', 'a0000000-0000-4000-8000-000000000002')
on conflict (id) do update
    set closes_at = excluded.closes_at, closed = false, result_at = null
    where polls.closes_at < now() + interval '1 day';

insert into poll_options (id, poll_id, label, sort)
values
    ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '첫째 주 토요일', 0),
    ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', '둘째 주 일요일', 1),
    ('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', '셋째 주 토요일', 2)
on conflict (id) do nothing;

insert into poll_votes (poll_id, option_id, user_id)
values
    ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002'),
    ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003'),
    ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004'),
    ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000006')
on conflict (option_id, user_id) do nothing;

insert into posts (id, title, body, pinned, author_id)
values ('e0000000-0000-4000-8000-000000000001', '샘플 모임에 오신 것을 환영합니다',
        '이곳은 앱 심사를 위한 샘플 모임입니다. 라운드 신청, 투표, 정산, 대화를 자유롭게 해 보세요.',
        true, 'a0000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

-- ── 5. 대화 ─────────────────────────────────────────────────────
insert into messages (id, room_id, user_id, body, created_at)
select m.id, r.id, m.user_id, m.body, now() - m.ago
from (select id from rooms where round_id is null order by created_at limit 1) r,
     (values
        ('f0000000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000002'::uuid,
            '다음 주 무등산 모집 열었습니다. 신청해 주세요!', interval '3 hours'),
        ('f0000000-0000-4000-8000-000000000002'::uuid, 'a0000000-0000-4000-8000-000000000003'::uuid,
            '신청했어요 😊', interval '2 hours 50 minutes'),
        ('f0000000-0000-4000-8000-000000000003'::uuid, 'a0000000-0000-4000-8000-000000000005'::uuid,
            '저도 갑니다. 카풀 하실 분 계세요?', interval '2 hours 40 minutes'),
        ('f0000000-0000-4000-8000-000000000004'::uuid, 'a0000000-0000-4000-8000-000000000006'::uuid,
            '광산구에서 출발하시면 같이 가요', interval '2 hours 30 minutes'),
        ('f0000000-0000-4000-8000-000000000005'::uuid, 'a0000000-0000-4000-8000-000000000004'::uuid,
            '스크린도 열어 뒀습니다 ⛳', interval '1 hour')
     ) as m(id, user_id, body, ago)
on conflict (id) do nothing;
