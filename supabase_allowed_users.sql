-- 교회문서키트 BASIC 1.0 구매자 이메일 허용 목록
-- Supabase SQL Editor에서 실행하세요.

create table if not exists public.allowed_users (
  email text primary key,
  plan text not null default 'basic',
  active boolean not null default true,
  church_name text,
  memo text,
  created_at timestamptz not null default now()
);

alter table public.allowed_users enable row level security;

drop policy if exists "buyers can read own active row" on public.allowed_users;

create policy "buyers can read own active row"
on public.allowed_users
for select
to authenticated
using (
  active is true
  and lower(email) = lower(auth.jwt() ->> 'email')
);

-- 구매자 이메일 등록 예시입니다. 실제 이메일로 바꿔서 사용하세요.
-- insert into public.allowed_users (email, plan, active, church_name, memo)
-- values ('buyer@example.com', 'basic', true, '우리교회', '1차 구매자')
-- on conflict (email) do update set active = excluded.active, plan = excluded.plan, church_name = excluded.church_name, memo = excluded.memo;
