-- 교회문서키트 BASIC 1.18 베타 신청/관리 기능용 테이블
-- Supabase SQL Editor에서 실행해 주세요.

create extension if not exists pgcrypto;

create table if not exists public.beta_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  church text,
  role text,
  phone text,
  email text not null,
  documents text[] default '{}',
  device text,
  message text,
  consent boolean not null default false,
  status text not null default 'pending',
  memo text,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create unique index if not exists beta_applications_email_lower_idx
on public.beta_applications (lower(email));

alter table public.beta_applications enable row level security;

-- 클라이언트에서 직접 읽지 않고 Vercel API(service_role)로만 관리합니다.
-- 관리자 API는 service_role key를 사용하므로 RLS를 우회합니다.

comment on table public.beta_applications is '교회문서키트 BASIC 베타테스터 신청 목록';
comment on column public.beta_applications.status is 'pending, approved, rejected';

-- 기존 allowed_users 테이블이 없을 경우에만 참고용으로 생성합니다.
create table if not exists public.allowed_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  plan text not null default 'basic',
  active boolean not null default true,
  memo text,
  created_at timestamptz not null default now()
);

create unique index if not exists allowed_users_email_lower_idx
on public.allowed_users (lower(email));

alter table public.allowed_users enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'allowed_users'
      and policyname = 'authenticated user can read own allowed row'
  ) then
    create policy "authenticated user can read own allowed row"
    on public.allowed_users
    for select
    to authenticated
    using (lower(email) = lower(auth.jwt() ->> 'email'));
  end if;
end $$;

grant usage on schema public to authenticated;
grant select on public.allowed_users to authenticated;


-- BASIC 1.18: 기존 테이블에 연락처 컬럼을 추가합니다.
alter table public.beta_applications add column if not exists phone text;
