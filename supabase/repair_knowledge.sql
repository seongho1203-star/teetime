-- 수리노트 지식 공유 테이블.
-- 기존 라운드·투표·대화 데이터는 건드리지 않고 별도 테이블과 비공개 사진 통만 추가한다.

-- 수리노트 회원 정보는 기존 profiles와 분리한다. 표시 이름 변경과 가입
-- 신청 삭제가 JTFAG 회원 프로필·권한에 영향을 주지 않도록 한다.
create table if not exists public.repair_memberships (
    user_id       uuid primary key references auth.users(id) on delete cascade,
    display_name  text not null default '회원'
                  check (char_length(display_name) between 1 and 40),
    status        text not null default 'pending'
                  check (status in ('pending', 'member')),
    requested_at  timestamptz not null default now(),
    approved_at   timestamptz,
    approved_by   uuid references public.profiles(id) on delete set null
);

-- 승인 후 첫 접속에서 카카오 이름을 그대로 확정하지 않고, 수리노트에서
-- 사용할 이름과 직급을 본인이 직접 입력한다. 기존 회원도 다음 접속에 한 번 확인한다.
alter table public.repair_memberships
    add column if not exists job_title text,
    add column if not exists profile_completed_at timestamptz;
alter table public.repair_memberships
    drop constraint if exists repair_memberships_job_title_check,
    drop constraint if exists repair_memberships_profile_check;
alter table public.repair_memberships
    add constraint repair_memberships_job_title_check check (
        job_title in ('센터장', '실장', '반장', '조장', '기성', '기정', '기장', '주임', '사원')
    ),
    add constraint repair_memberships_profile_check check (
        profile_completed_at is null
        or (job_title is not null and nullif(btrim(display_name), '') is not null)
    );

create index if not exists repair_memberships_status_name_idx
    on public.repair_memberships (status, display_name);

-- 기존 승인 회원은 별도 신청 없이 수리노트를 계속 이용할 수 있게 옮긴다.
insert into public.repair_memberships (user_id, display_name, status, requested_at, approved_at)
select p.id, coalesce(nullif(btrim(p.name), ''), '회원'), 'member',
       coalesce(p.joined_at, p.created_at, now()), coalesce(p.joined_at, p.created_at, now())
  from public.profiles p
 where p.role in ('member', 'treasurer', 'staff', 'admin', 'superadmin')
on conflict (user_id) do nothing;

create or replace function public.is_repair_member()
returns boolean
language sql security definer stable set search_path = public, pg_catalog as $$
    select exists (
        select 1 from public.repair_memberships
         where user_id = auth.uid() and status = 'member'
    );
$$;

revoke all on function public.is_repair_member() from public, anon;
grant execute on function public.is_repair_member() to authenticated;

create or replace function public.request_repair_membership(p_display_name text default null)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
    v_user uuid := auth.uid();
    v_profile_name text;
    v_name text;
begin
    if v_user is null then raise exception '로그인이 필요합니다.'; end if;
    select name into v_profile_name from public.profiles where id = v_user;
    v_name := coalesce(nullif(btrim(p_display_name), ''), nullif(btrim(v_profile_name), ''), '회원');
    insert into public.repair_memberships (user_id, display_name, status)
    values (v_user, left(v_name, 40), 'pending')
    on conflict (user_id) do nothing;
end;
$$;

create or replace function public.approve_repair_membership(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
    if not public.is_admin() or not public.is_repair_member() then
        raise exception '회원 승인 권한이 없습니다.';
    end if;
    update public.repair_memberships
       set status = 'member', approved_at = now(), approved_by = auth.uid()
     where user_id = p_user_id and status = 'pending';
    if not found then raise exception '대기 중인 가입 신청을 찾을 수 없습니다.'; end if;
end;
$$;

create or replace function public.delete_repair_application(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
    if not public.is_admin() or not public.is_repair_member() then
        raise exception '가입 신청 삭제 권한이 없습니다.';
    end if;
    delete from public.repair_memberships
     where user_id = p_user_id and status = 'pending';
    if not found then raise exception '대기 중인 가입 신청을 찾을 수 없습니다.'; end if;
end;
$$;

-- 추방은 기존 가입 신청 상태로 되돌려 관리자의 재승인을 기다리게 한다.
-- 회원 행은 유지해야 기존 회원 이관 SQL이 다음 배포 때 다시 승인하지 않는다.
-- 계정, 까꿍 회원 정보, 작성 글도 그대로 유지한다.
create or replace function public.expel_repair_member(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
    if not public.is_admin() or not public.is_repair_member() then
        raise exception '회원 추방 권한이 없습니다.';
    end if;
    if p_user_id = auth.uid() then raise exception '본인은 추방할 수 없습니다.'; end if;
    update public.repair_memberships
       set status = 'pending', requested_at = now(), approved_at = null, approved_by = null
     where user_id = p_user_id and status = 'member';
    if not found then raise exception '가입된 회원을 찾을 수 없습니다.'; end if;
end;
$$;

revoke all on function public.request_repair_membership(text) from public, anon;
revoke all on function public.approve_repair_membership(uuid) from public, anon;
revoke all on function public.delete_repair_application(uuid) from public, anon;
revoke all on function public.expel_repair_member(uuid) from public, anon;
grant execute on function public.request_repair_membership(text) to authenticated;
grant execute on function public.approve_repair_membership(uuid) to authenticated;
grant execute on function public.delete_repair_application(uuid) to authenticated;
grant execute on function public.expel_repair_member(uuid) to authenticated;

alter table public.repair_memberships enable row level security;
revoke all on public.repair_memberships from public, anon;
grant select, insert on public.repair_memberships to authenticated;
grant update (display_name, job_title, profile_completed_at) on public.repair_memberships to authenticated;

drop policy if exists repair_memberships_read on public.repair_memberships;
create policy repair_memberships_read on public.repair_memberships
    for select to authenticated
    using (user_id = auth.uid() or is_repair_member());

drop policy if exists repair_memberships_request on public.repair_memberships;
create policy repair_memberships_request on public.repair_memberships
    for insert to authenticated
    with check (user_id = auth.uid() and status = 'pending');

drop policy if exists repair_memberships_name on public.repair_memberships;
create policy repair_memberships_name on public.repair_memberships
    for update to authenticated
    using (user_id = auth.uid() and status = 'member')
    with check (user_id = auth.uid() and status = 'member');

create table if not exists public.repair_entries (
    id                  uuid primary key default gen_random_uuid(),
    product_family      text not null check (char_length(product_family) between 1 and 40),
    model_code          text not null default '' check (char_length(model_code) <= 50),
    category            text not null check (category in
                            ('inspection', 'test_mode', 'error_code', 'parts')),
    title               text not null check (char_length(title) between 2 and 120),
    symptoms            text not null default '' check (char_length(symptoms) <= 1200),
    inspection_steps    text not null check (char_length(inspection_steps) between 2 and 8000),
    result_notes        text not null default '' check (char_length(result_notes) <= 3000),
    cautions            text not null default '' check (char_length(cautions) <= 1800),
    tags                text[] not null default '{}',
    photo_paths         text[] not null default '{}',
    created_by          uuid references public.profiles(id) on delete set null,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    verification_status text not null default 'unverified'
                            check (verification_status in ('unverified', 'verified', 'needs_review')),
    verified_by         uuid references public.profiles(id) on delete set null,
    verified_at         timestamptz,
    search_vector       tsvector not null default ''::tsvector,
    constraint repair_entries_tags_limit check (cardinality(tags) <= 10),
    constraint repair_entries_photos_limit check (cardinality(photo_paths) <= 6)
);

-- 이전에 생성된 최소 2자 모델명 제약을 없애 제품군 공통 자료도 허용한다.
alter table public.repair_entries alter column model_code set default '';
alter table public.repair_entries drop constraint if exists repair_entries_model_code_check;
alter table public.repair_entries add constraint repair_entries_model_code_check
    check (char_length(model_code) <= 50);

-- 이전 화면에서 등록된 유형은 모두 새 '수리 및 점검방법'으로 묶어 보존한다.
update public.repair_entries
   set category = 'inspection'
 where category in ('hidden_key', 'know_how');

-- 제품군 명칭 변경 전 등록된 글도 새 제품군 필터에서 찾을 수 있게 옮긴다.
update public.repair_entries
   set product_family = '로봇 청소기'
 where product_family = '청소기';

alter table public.repair_entries drop constraint if exists repair_entries_category_check;
alter table public.repair_entries add constraint repair_entries_category_check
    check (category in ('inspection', 'test_mode', 'error_code', 'parts'));

create index if not exists repair_entries_search_idx
    on public.repair_entries using gin (search_vector);
create index if not exists repair_entries_family_created_idx
    on public.repair_entries (product_family, created_at desc);
create index if not exists repair_entries_category_created_idx
    on public.repair_entries (category, created_at desc);
create index if not exists repair_entries_model_idx
    on public.repair_entries (model_code);

alter table public.repair_entries enable row level security;
grant select, insert, update, delete on public.repair_entries to authenticated;
revoke all on public.repair_entries from anon;

drop policy if exists repair_entries_read on public.repair_entries;
create policy repair_entries_read on public.repair_entries
    for select to authenticated using (is_repair_member());

drop policy if exists repair_entries_add on public.repair_entries;
create policy repair_entries_add on public.repair_entries
    for insert to authenticated
    with check (is_repair_member() and created_by = auth.uid());

drop policy if exists repair_entries_edit on public.repair_entries;
create policy repair_entries_edit on public.repair_entries
    for update to authenticated
    using ((select public.is_repair_member()) and (is_admin() or created_by = (select auth.uid())))
    with check ((select public.is_repair_member()) and (is_admin() or created_by = (select auth.uid())));

drop policy if exists repair_entries_delete on public.repair_entries;
create policy repair_entries_delete on public.repair_entries
    for delete to authenticated
    using ((select public.is_repair_member()) and (is_admin() or created_by = (select auth.uid())));

create or replace function public.repair_entries_touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
    if tg_op = 'UPDATE' then
        new.updated_at := now();
    end if;
    -- to_tsvector with an explicit configuration is immutable, but building
    -- this in the trigger also avoids generated-column restrictions on text
    -- concatenation and array formatting.
    new.search_vector := to_tsvector(
        'pg_catalog.simple'::regconfig,
        coalesce(new.product_family, '') || ' ' ||
        coalesce(new.model_code, '') || ' ' ||
        coalesce(new.title, '') || ' ' ||
        coalesce(new.symptoms, '') || ' ' ||
        coalesce(new.inspection_steps, '') || ' ' ||
        coalesce(new.result_notes, '') || ' ' ||
        coalesce(new.cautions, '') || ' ' ||
        coalesce(array_to_string(new.tags, ' '), '')
    );
    return new;
end;
$$;

drop trigger if exists repair_entries_touch_updated_at on public.repair_entries;
create trigger repair_entries_touch_updated_at
    before insert or update on public.repair_entries
    for each row execute function public.repair_entries_touch_updated_at();

-- 작성자가 관리자 검증 상태를 바꾸지 못하게 한다.
create or replace function public.repair_entries_protect_verification()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
    if auth.uid() is not null and not is_admin()
       and (new.verification_status is distinct from old.verification_status
            or new.verified_by is distinct from old.verified_by
            or new.verified_at is distinct from old.verified_at) then
        raise exception '검증 상태는 관리자만 변경할 수 있습니다.';
    end if;
    return new;
end;
$$;

drop trigger if exists repair_entries_protect_verification on public.repair_entries;
create trigger repair_entries_protect_verification
    before update on public.repair_entries
    for each row execute function public.repair_entries_protect_verification();

-- 기존 글은 수리 사례로 남긴다. 질문은 답변을 채택할 때 같은 글에서
-- 수리 사례로 전환되므로 사진, 알림 링크, 작성자와 답변이 모두 남는다.
alter table public.repair_entries
    add column if not exists entry_kind text not null default 'case',
    add column if not exists accepted_answer_id uuid;

alter table public.repair_entries
    drop constraint if exists repair_entries_inspection_steps_check,
    drop constraint if exists repair_entries_entry_kind_check;
alter table public.repair_entries
    add constraint repair_entries_entry_kind_check check (entry_kind in ('case', 'question')),
    add constraint repair_entries_inspection_steps_check check (
        (entry_kind = 'case' and char_length(inspection_steps) between 2 and 8000)
        or (entry_kind = 'question' and inspection_steps = ''
            and char_length(btrim(symptoms)) >= 2 and accepted_answer_id is null)
    );

create index if not exists repair_entries_kind_created_idx
    on public.repair_entries (entry_kind, created_at desc, id desc);

create table if not exists public.repair_entry_answers (
    id          uuid primary key default gen_random_uuid(),
    entry_id    uuid not null references public.repair_entries(id) on delete cascade,
    author_id   uuid references public.profiles(id) on delete set null,
    body        text not null check (char_length(btrim(body)) between 2 and 8000),
    created_at  timestamptz not null default now(),
    unique (entry_id, id)
);

alter table public.repair_entries drop constraint if exists repair_entries_accepted_answer_fk;
alter table public.repair_entries add constraint repair_entries_accepted_answer_fk
    foreign key (id, accepted_answer_id) references public.repair_entry_answers(entry_id, id);

alter table public.repair_entry_answers enable row level security;
revoke all on public.repair_entry_answers from public, anon, authenticated;
grant select, delete on public.repair_entry_answers to authenticated;
grant insert (entry_id, author_id, body) on public.repair_entry_answers to authenticated;

drop policy if exists repair_answers_read on public.repair_entry_answers;
create policy repair_answers_read on public.repair_entry_answers
    for select to authenticated using ((select public.is_repair_member()));

drop policy if exists repair_answers_add on public.repair_entry_answers;
create policy repair_answers_add on public.repair_entry_answers
    for insert to authenticated with check (
        author_id = (select auth.uid())
        and exists (select 1 from public.repair_entries e
                    where e.id = repair_entry_answers.entry_id and e.entry_kind = 'question')
    );

drop policy if exists repair_answers_delete on public.repair_entry_answers;
create policy repair_answers_delete on public.repair_entry_answers
    for delete to authenticated using (
        author_id = (select auth.uid())
        and exists (select 1 from public.repair_entries e
                    where e.id = repair_entry_answers.entry_id and e.entry_kind = 'question')
    );

create or replace function public.repair_entries_question_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_answer text;
begin
    if tg_op = 'INSERT' then
        if new.accepted_answer_id is not null then
            raise exception '질문을 먼저 등록해 주세요.';
        end if;
    elsif new.entry_kind is distinct from old.entry_kind
       or new.accepted_answer_id is distinct from old.accepted_answer_id then
        if old.entry_kind <> 'question' or new.entry_kind <> 'case'
           or auth.uid() is null or old.created_by is distinct from auth.uid() then
            raise exception '질문 작성자만 답변을 채택할 수 있습니다.';
        end if;

        select a.body into v_answer
          from public.repair_entry_answers a
         where a.entry_id = old.id and a.id = new.accepted_answer_id;
        if not found then
            raise exception '이 질문의 답변을 선택해 주세요.';
        end if;
        new.inspection_steps := v_answer;
    end if;
    return new;
end;
$$;

drop trigger if exists repair_entries_question_state on public.repair_entries;
create trigger repair_entries_question_state
    before insert or update of entry_kind, accepted_answer_id on public.repair_entries
    for each row execute function public.repair_entries_question_state();

create or replace function public.accept_repair_answer(p_entry_id uuid, p_answer_id uuid)
returns public.repair_entries
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_entry public.repair_entries;
begin
    update public.repair_entries e
       set entry_kind = 'case', accepted_answer_id = p_answer_id
     where e.id = p_entry_id and e.entry_kind = 'question'
       and e.created_by = (select auth.uid())
    returning e.* into v_entry;
    if not found then
        raise exception '이미 해결된 질문이거나 답변을 채택할 수 없습니다.';
    end if;
    return v_entry;
end;
$$;

revoke all on function public.accept_repair_answer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_repair_answer(uuid, uuid) to authenticated;

create table if not exists public.repair_entry_applications (
    entry_id    uuid not null references public.repair_entries(id) on delete cascade,
    user_id     uuid not null references auth.users(id) on delete cascade,
    model_code  text not null default '' check (char_length(model_code) <= 50),
    note        text not null default '' check (char_length(note) <= 300),
    created_at  timestamptz not null default now(),
    primary key (entry_id, user_id)
);

alter table public.repair_entry_applications enable row level security;
revoke all on public.repair_entry_applications from public, anon, authenticated;
grant select, delete on public.repair_entry_applications to authenticated;
grant insert (entry_id, user_id) on public.repair_entry_applications to authenticated;
grant update (model_code, note) on public.repair_entry_applications to authenticated;

drop policy if exists repair_applications_read on public.repair_entry_applications;
create policy repair_applications_read on public.repair_entry_applications
    for select to authenticated using ((select public.is_repair_member()));

drop policy if exists repair_applications_add on public.repair_entry_applications;
create policy repair_applications_add on public.repair_entry_applications
    for insert to authenticated with check (
        user_id = (select auth.uid())
        and exists (select 1 from public.repair_entries e
                    where e.id = repair_entry_applications.entry_id and e.entry_kind = 'case'
                      and e.created_by is distinct from (select auth.uid()))
    );

drop policy if exists repair_applications_edit on public.repair_entry_applications;
create policy repair_applications_edit on public.repair_entry_applications
    for update to authenticated
    using ((select public.is_repair_member()) and user_id = (select auth.uid()))
    with check ((select public.is_repair_member()) and user_id = (select auth.uid()));

drop policy if exists repair_applications_delete on public.repair_entry_applications;
create policy repair_applications_delete on public.repair_entry_applications
    for delete to authenticated
    using ((select public.is_repair_member()) and user_id = (select auth.uid()));

-- 자주 쓰는 말과 서비스 용어를 같은 단어로 찾는다. 통일한 단어 양쪽에
-- 공백을 두어 "물이 안 빠져요 OE"처럼 에러 코드를 함께 검색할 수 있다.
create or replace function public.repair_search_key(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_text text := regexp_replace(lower(coalesce(p_text, '')), '[[:space:][:punct:]]+', '', 'g');
begin
    v_text := regexp_replace(v_text, '(배수불량|배수(가)?(안되(는|요)?|안돼(요)?|안됨|안댐)|물(이)?(안빠(짐|져(요)?)|빠지지않(아요|음)))', ' 배수불량 ', 'g');
    v_text := regexp_replace(v_text, '(급수불량|급수(가)?(안됨|안돼(요)?|안되(요)?)|물(이)?안들어(옴|와(요)?))', ' 급수불량 ', 'g');
    v_text := regexp_replace(v_text, '(냉방불량|냉방(이)?(약함|약해(요)?|안됨|안돼(요)?)|찬바람(이)?안나(옴|와(요)?))', ' 냉방불량 ', 'g');
    v_text := regexp_replace(v_text, '(전원불량|전원(이)?(안켜(짐|져(요)?)|안들어(옴|와(요)?)))', ' 전원불량 ', 'g');
    v_text := regexp_replace(v_text, '(무화면|화면무|화면(이)?안나(옴|와(요)?))', ' 무화면 ', 'g');
    v_text := regexp_replace(v_text, '(온수불량|온수(가)?안나(옴|와(요)?))', ' 온수불량 ', 'g');
    v_text := regexp_replace(v_text, '(누수(가나(요)?)?|물(이)?(샘|새(요)?))', ' 누수 ', 'g');
    return btrim(regexp_replace(v_text, ' +', ' ', 'g'));
end;
$$;

revoke all on function public.repair_search_key(text) from public, anon, authenticated;
grant execute on function public.repair_search_key(text) to authenticated;

-- SECURITY INVOKER로 호출한 회원의 글 열람 권한을 그대로 적용한다.
create table if not exists public.repair_bookmarks (
    user_id uuid not null references auth.users(id) on delete cascade,
    entry_id uuid not null references public.repair_entries(id) on delete cascade,
    primary key (user_id, entry_id)
);
alter table public.repair_bookmarks enable row level security;
revoke all on public.repair_bookmarks from public, anon, authenticated;
grant select, insert, delete on public.repair_bookmarks to authenticated;
drop policy if exists own_bookmarks on public.repair_bookmarks;
create policy own_bookmarks on public.repair_bookmarks for all to authenticated
    using (user_id = (select auth.uid()) and (select public.is_repair_member()))
    with check (user_id = (select auth.uid()) and (select public.is_repair_member()));

create or replace function public.search_repair_library(
    p_query text default null,
    p_family text default null,
    p_category text default null,
    p_model text default null,
    p_kind text default 'case',
    p_offset integer default 0,
    p_limit integer default 6
)
returns setof public.repair_entries
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
    v_query text := nullif(btrim(left(coalesce(p_query, ''), 120)), '');
    v_model text := nullif(regexp_replace(lower(left(coalesce(p_model, ''), 50)), '[[:space:][:punct:]]+', '', 'g'), '');
    v_query_model text := regexp_replace(lower(v_query), '[[:space:][:punct:]]+', '', 'g');
    v_terms text[] := string_to_array(nullif(public.repair_search_key(v_query), ''), ' ');
begin
    return query
    select e.*
      from public.repair_entries e
      cross join lateral (
          select regexp_replace(lower(e.model_code), '[[:space:][:punct:]]+', '', 'g') as model_key,
                 public.repair_search_key(concat_ws(' ', e.title, e.symptoms, e.product_family,
                     e.model_code, e.inspection_steps, e.result_notes, e.cautions,
                     array_to_string(e.tags, ' '))) as content_key
      ) keys
     where e.entry_kind = case when p_kind = 'question' then 'question' else 'case' end
       and (nullif(btrim(coalesce(p_family, '')), '') is null
            or e.product_family = btrim(p_family))
       and (nullif(btrim(coalesce(p_category, '')), '') is null
            or e.category = btrim(p_category))
       and (p_kind is distinct from 'mine' or e.created_by = (select auth.uid()))
       and (p_kind is distinct from 'saved' or exists (
           select 1 from public.repair_bookmarks b
           where b.user_id = (select auth.uid()) and b.entry_id = e.id
       ))
       and (v_model is null or strpos(keys.model_key, v_model) > 0)
       and (
            v_query is null
            or e.search_vector @@ plainto_tsquery('pg_catalog.simple'::regconfig, v_query)
            or (v_terms is not null and not exists (
                select 1 from unnest(v_terms) as term(value)
                 where strpos(replace(keys.content_key, ' ', ''), term.value) = 0
            ))
       )
     order by case
                when v_query is null then 0
                when keys.model_key <> '' and keys.model_key = v_query_model then 0
                when strpos(lower(e.title), lower(v_query)) > 0 then 1
                when strpos(lower(e.symptoms), lower(v_query)) > 0 then 2
                else 3
              end,
              e.created_at desc, e.id desc
     offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limit, 6), 1), 100);
end;
$$;

revoke all on function public.search_repair_library(text, text, text, text, text, integer, integer)
    from public, anon, authenticated;
grant execute on function public.search_repair_library(text, text, text, text, text, integer, integer)
    to authenticated;

-- 배포 전에 열어 둔 앱에서도 기존 검색 호출은 계속 수리 사례를 반환한다.
create or replace function public.search_repair_entries(
    p_query text default null,
    p_family text default null,
    p_category text default null,
    p_model text default null,
    p_limit integer default 80
)
returns setof public.repair_entries
language sql
stable
security invoker
set search_path = ''
as $$
    select * from public.search_repair_library(p_query, p_family, p_category, p_model,
        'case', 0, coalesce(p_limit, 80));
$$;

revoke all on function public.search_repair_entries(text, text, text, text, integer) from public, anon;
grant execute on function public.search_repair_entries(text, text, text, text, integer) to authenticated;

-- 사진은 비공개 저장소에 둔다. 저장된 링크만으로 외부인이 내려받을 수 없다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'repair-photos',
    'repair-photos',
    false,
    8388608,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists repair_photos_member_read on storage.objects;
create policy repair_photos_member_read on storage.objects
    for select to authenticated
    using (bucket_id = 'repair-photos' and is_repair_member());

drop policy if exists repair_photos_member_add on storage.objects;
create policy repair_photos_member_add on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'repair-photos'
        and is_repair_member()
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists repair_photos_owner_delete on storage.objects;
create policy repair_photos_owner_delete on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'repair-photos'
        and is_repair_member()
        and (owner = auth.uid() or is_admin())
    );

-- 수리노트 알림과 웹 푸시 구독은 까꿍의 알림함/기기 목록과 분리한다.
-- 기존 설치 기기의 웹 구독은 수리노트에 접속할 때 옮긴다. 까꿍의
-- APNs/FCM 토큰이나 웹 구독을 DB에서 일괄 옮기면 안 된다.
begin;

create table if not exists public.repair_notifications (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users(id) on delete cascade,
    kind       text not null,
    title      text not null,
    body       text not null default '',
    url        text not null default '',
    created_at timestamptz not null default now(),
    read_at    timestamptz
);
create index if not exists repair_notifications_user_idx
    on public.repair_notifications (user_id, created_at desc);
alter table public.repair_notifications enable row level security;
revoke all on public.repair_notifications from anon;
grant select, update on public.repair_notifications to authenticated;
drop policy if exists repair_notifications_read on public.repair_notifications;
create policy repair_notifications_read on public.repair_notifications
    for select to authenticated using (user_id = auth.uid() and is_repair_member());
drop policy if exists repair_notifications_mark_read on public.repair_notifications;
create policy repair_notifications_mark_read on public.repair_notifications
    for update to authenticated
    using (user_id = auth.uid() and is_repair_member())
    with check (user_id = auth.uid() and is_repair_member());

create table if not exists public.repair_push_subscriptions (
    endpoint   text primary key,
    user_id    uuid not null references auth.users(id) on delete cascade,
    p256dh     text not null,
    auth       text not null,
    ua         text not null default '',
    created_at timestamptz not null default now()
);
create index if not exists repair_push_subs_user_idx
    on public.repair_push_subscriptions (user_id);
alter table public.repair_push_subscriptions enable row level security;
revoke all on public.repair_push_subscriptions from anon;
grant select, insert, update, delete on public.repair_push_subscriptions to authenticated;
drop policy if exists repair_push_subs_own on public.repair_push_subscriptions;
create policy repair_push_subs_own on public.repair_push_subscriptions for all to authenticated
    using (user_id = auth.uid() and is_repair_member())
    with check (user_id = auth.uid() and is_repair_member());

-- 가입 신청은 수리노트의 승인된 관리자에게만 알린다. 푸시를 꺼 둔
-- 관리자도 알림함에서 볼 수 있고, 승인/삭제하면 미확인 숫자가 내려간다.
create or replace function public.repair_membership_in_app_notice()
returns trigger language plpgsql security definer
set search_path = public, pg_catalog as $$
declare v_resolved uuid;
begin
    if tg_op = 'INSERT' then
        if new.status = 'pending' then
            insert into public.repair_notifications (user_id, kind, title, body, url)
            select m.user_id, 'repair_memberships', '가입 신청',
                   new.display_name || '님이 승인을 기다립니다',
                   '#/members?request=' || new.user_id::text
              from public.repair_memberships m
              join public.profiles p on p.id = m.user_id
             where m.status = 'member' and p.role in ('staff', 'admin', 'superadmin')
               and m.user_id <> new.user_id;
        end if;
    elsif tg_op = 'UPDATE' then
        if old.status = 'pending' and new.status = 'member' then
            v_resolved := old.user_id;
        elsif old.status = 'member' and new.status = 'pending' then
            insert into public.repair_notifications (user_id, kind, title, body, url)
            select m.user_id, 'repair_memberships', '재승인 대기',
                   new.display_name || '님이 재승인을 기다립니다',
                   '#/members?request=' || new.user_id::text
              from public.repair_memberships m
              join public.profiles p on p.id = m.user_id
             where m.status = 'member' and p.role in ('staff', 'admin', 'superadmin')
               and m.user_id <> new.user_id;
        end if;
    elsif tg_op = 'DELETE' then
        if old.status = 'pending' then v_resolved := old.user_id; end if;
    end if;
    if v_resolved is not null then
        update public.repair_notifications
           set read_at = coalesce(read_at, now())
         where kind = 'repair_memberships'
           and url = '#/members?request=' || v_resolved::text
           and read_at is null;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;
revoke all on function public.repair_membership_in_app_notice() from public, anon, authenticated;
drop trigger if exists repair_memberships_in_app_notice on public.repair_memberships;
create trigger repair_memberships_in_app_notice
    after insert or update of status or delete on public.repair_memberships
    for each row execute function public.repair_membership_in_app_notice();

-- 이미 대기 중인 신청도 관리자의 수리노트 알림함에 한 번만 채운다.
insert into public.repair_notifications (user_id, kind, title, body, url, created_at)
select admin.user_id, 'repair_memberships', '가입 신청',
       pending.display_name || '님이 승인을 기다립니다',
       '#/members?request=' || pending.user_id::text, pending.requested_at
  from public.repair_memberships pending
 cross join public.repair_memberships admin
  join public.profiles p on p.id = admin.user_id
 where pending.status = 'pending' and admin.status = 'member'
   and p.role in ('staff', 'admin', 'superadmin')
   and pending.user_id <> admin.user_id
   and not exists (
       select 1 from public.repair_notifications n
        where n.user_id = admin.user_id and n.kind = 'repair_memberships'
          and n.url = '#/members?request=' || pending.user_id::text
   );

-- 공통 로그인만으로 생겼던 까꿍 가입 알림 중, 실제 까꿍 가입 정보를
-- 제출하지 않은 수리노트 대기 신청의 알림은 읽음 처리한다.
update public.notifications n
   set read_at = now()
  from public.repair_memberships m
  join public.profiles p on p.id = m.user_id
  left join public.profile_private v on v.id = p.id
 where m.status = 'pending' and p.role = 'pending'
   and (nullif(btrim(v.phone), '') is null or nullif(btrim(v.car), '') is null)
   and n.kind = 'profiles' and n.title = '🙋 가입 신청'
   and n.body = coalesce(nullif(btrim(p.name), ''), '새 회원') || '님이 승인을 기다립니다'
   and n.created_at between p.created_at - interval '2 minutes'
                        and p.created_at + interval '2 minutes'
   and n.read_at is null;

-- 알림함은 푸시 설정 여부와 관계없이 모든 승인 회원에게 남긴다.
create or replace function public.repair_entry_in_app_notice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
    v_category text;
    v_title text;
    v_body text;
begin
    v_category := case new.category
        when 'inspection' then '수리 및 점검 노하우'
        when 'test_mode' then '테스트 모드'
        when 'error_code' then '에러 코드'
        when 'parts' then '부품교체 노하우'
        else '수리 정보'
    end;
    v_title := case
        when new.entry_kind = 'question' then '미해결 질문'
        when new.accepted_answer_id is not null then '해결된 수리 사례'
        else '새 수리 정보 · ' || v_category
    end;
    v_body := left(concat_ws(' · ', nullif(btrim(new.product_family), ''),
        nullif(btrim(new.model_code), ''), nullif(btrim(new.title), '')), 160);

    if tg_op = 'UPDATE' then
        update public.repair_notifications
           set title = v_title,
               body = v_body
         where kind = 'repair_entries'
           and url = '#/entry/' || new.id::text
           and (title, body) is distinct from (v_title, v_body);
        if new.title is distinct from old.title then
            update public.repair_notifications
               set body = new.title
             where kind = 'repair_answers'
               and starts_with(url, '#/entry/' || new.id::text || '?answer=');
        end if;
        return new;
    end if;

    insert into public.repair_notifications (user_id, kind, title, body, url)
    select p.user_id, 'repair_entries', v_title, v_body, '#/entry/' || new.id::text
      from public.repair_memberships p
     where p.status = 'member';
    return new;
end;
$$;

drop trigger if exists repair_entries_in_app_notice on public.repair_entries;
create trigger repair_entries_in_app_notice
    after insert or update on public.repair_entries
    for each row execute function public.repair_entry_in_app_notice();

-- 이미 받은 알림도 유형의 새 이름을 표시한다. 읽음 여부는 유지한다.
update public.repair_notifications
   set title = replace(title, '부품·회로', '부품교체 노하우')
 where kind = 'repair_entries'
   and title like '%부품·회로%';

create or replace function public.repair_answer_in_app_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'DELETE' then
        delete from public.repair_notifications
         where kind = 'repair_answers'
           and url = '#/entry/' || old.entry_id::text || '?answer=' || old.id::text;
        return old;
    end if;

    insert into public.repair_notifications (user_id, kind, title, body, url)
    select e.created_by, 'repair_answers', '내 질문에 답변이 달렸어요', e.title,
           '#/entry/' || e.id::text || '?answer=' || new.id::text
      from public.repair_entries e
      join public.repair_memberships m on m.user_id = e.created_by and m.status = 'member'
     where e.id = new.entry_id and e.created_by <> new.author_id and e.entry_kind = 'question';
    return new;
end;
$$;

revoke all on function public.repair_answer_in_app_notice() from public, anon, authenticated;

drop trigger if exists repair_answers_in_app_notice on public.repair_entry_answers;
create trigger repair_answers_in_app_notice
    after insert or delete on public.repair_entry_answers
    for each row execute function public.repair_answer_in_app_notice();

-- 기존 수리 알림을 읽음 상태와 시각까지 보존해 옮긴다. 같은 트랜잭션에서
-- 트리거도 교체했으므로 까꿍 알림함에 새 수리 알림이 끼어들 틈이 없다.
insert into public.repair_notifications
    (id, user_id, kind, title, body, url, created_at, read_at)
select id, user_id, kind, title, body, url, created_at, read_at
  from public.notifications
 where kind in ('repair_entries', 'repair_answers')
on conflict (id) do nothing;
delete from public.notifications
 where kind in ('repair_entries', 'repair_answers');
commit;

-- 예전 Edge Function은 까꿍 구독 목록으로도 수리 알림을 보낸다.
-- 배포 작업이 새 함수를 성공적으로 올린 뒤에만 이 푸시 트리거를 만든다.
-- 실패 중에도 수리노트 전용 알림함은 위 트리거로 계속 동작한다.
drop trigger if exists repair_entries_push_notice on public.repair_entries;
drop trigger if exists repair_memberships_push_notice on public.repair_memberships;

-- 앱이 검색 목록과 알림함을 실시간으로 갱신한다.
do $$
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        create publication supabase_realtime;
    end if;
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'repair_entries'
    ) then
        alter publication supabase_realtime add table public.repair_entries;
    end if;
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'repair_memberships'
    ) then
        alter publication supabase_realtime add table public.repair_memberships;
    end if;
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'repair_entry_answers'
    ) then
        alter publication supabase_realtime add table public.repair_entry_answers;
    end if;
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'repair_notifications'
    ) then
        alter publication supabase_realtime add table public.repair_notifications;
    end if;
end;
$$;
