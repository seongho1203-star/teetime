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
    if not public.is_admin() then raise exception '회원 승인 권한이 없습니다.'; end if;
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
    if not public.is_admin() then raise exception '가입 신청 삭제 권한이 없습니다.'; end if;
    delete from public.repair_memberships
     where user_id = p_user_id and status = 'pending';
    if not found then raise exception '대기 중인 가입 신청을 찾을 수 없습니다.'; end if;
end;
$$;

revoke all on function public.request_repair_membership(text) from public, anon;
revoke all on function public.approve_repair_membership(uuid) from public, anon;
revoke all on function public.delete_repair_application(uuid) from public, anon;
grant execute on function public.request_repair_membership(text) to authenticated;
grant execute on function public.approve_repair_membership(uuid) to authenticated;
grant execute on function public.delete_repair_application(uuid) to authenticated;

alter table public.repair_memberships enable row level security;
revoke all on public.repair_memberships from public, anon;
grant select, insert on public.repair_memberships to authenticated;
grant update (display_name) on public.repair_memberships to authenticated;

drop policy if exists repair_memberships_read on public.repair_memberships;
create policy repair_memberships_read on public.repair_memberships
    for select to authenticated
    using (user_id = auth.uid() or is_repair_member() or is_admin());

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
    model_code          text not null check (char_length(model_code) between 2 and 50),
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

-- 이전 화면에서 등록된 유형은 모두 새 '수리 및 점검방법'으로 묶어 보존한다.
update public.repair_entries
   set category = 'inspection'
 where category in ('hidden_key', 'know_how');

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
    using (is_admin() or created_by = auth.uid())
    with check (is_admin() or created_by = auth.uid());

drop policy if exists repair_entries_delete on public.repair_entries;
create policy repair_entries_delete on public.repair_entries
    for delete to authenticated
    using (is_admin() or created_by = auth.uid());

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

-- 검색어·제품군·유형·모델 필터를 한 번에 적용한다. SECURITY INVOKER라
-- 호출한 회원의 RLS 정책을 그대로 적용한다.
create or replace function public.search_repair_entries(
    p_query text default null,
    p_family text default null,
    p_category text default null,
    p_model text default null,
    p_limit integer default 80
)
returns setof public.repair_entries
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
    v_query text := nullif(btrim(coalesce(p_query, '')), '');
    v_model text := nullif(btrim(coalesce(p_model, '')), '');
begin
    return query
    select e.*
      from public.repair_entries e
     where (nullif(btrim(coalesce(p_family, '')), '') is null
            or e.product_family = btrim(p_family))
       and (nullif(btrim(coalesce(p_category, '')), '') is null
            or e.category = btrim(p_category))
       and (v_model is null or e.model_code ilike '%' || v_model || '%')
       and (
            v_query is null
            or e.search_vector @@ plainto_tsquery('pg_catalog.simple'::regconfig, v_query)
            or e.title ilike '%' || v_query || '%'
            or e.model_code ilike '%' || v_query || '%'
            or e.symptoms ilike '%' || v_query || '%'
       )
     order by e.created_at desc
     limit least(greatest(coalesce(p_limit, 80), 1), 100);
end;
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
        and (owner = auth.uid() or is_admin())
    );

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
        when 'parts' then '부품·회로'
        else '수리 정보'
    end;
    v_title := '새 수리 정보 · ' || v_category;
    v_body := left(new.product_family || ' · ' || new.model_code || ' · ' || new.title, 160);

    if tg_op = 'UPDATE' then
        update public.notifications
           set title = v_title,
               body = v_body
         where kind = 'repair_entries'
           and url = '#/entry/' || new.id::text;
        return new;
    end if;

    insert into public.notifications (user_id, kind, title, body, url)
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

-- 알림 푸시는 기존 발송기에 연결한다. 발송기가 아직 없더라도 저장·검색·
-- 알림함 기능은 계속 동작한다.
do $$
begin
    if to_regprocedure('public.notify_push()') is not null then
        execute 'drop trigger if exists repair_entries_push_notice on public.repair_entries';
        execute $t$
            create trigger repair_entries_push_notice after insert on public.repair_entries
                for each row execute function public.notify_push()
        $t$;
    end if;
end;
$$;

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
end;
$$;
