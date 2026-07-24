-- 교회문서키트 BASIC 1.20 PC·모바일 이어쓰기용 내 문서 테이블
-- Supabase SQL Editor에서 실행해 주세요.

create extension if not exists pgcrypto;

create table if not exists public.user_documents (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  title text not null default '새 문서',
  doc_type text,
  bundle_types text[] default '{}',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_documents_owner_updated_idx
on public.user_documents (lower(owner_email), updated_at desc);

alter table public.user_documents enable row level security;

comment on table public.user_documents is '교회문서키트 BASIC 사용자의 클라우드 저장 문서';
comment on column public.user_documents.owner_email is '로그인한 구매자/베타테스터 이메일';

-- 현재 앱은 클라이언트가 직접 이 테이블을 읽지 않고 Vercel API(service_role)로만 저장/불러오기합니다.
-- 따라서 RLS 정책을 따로 열지 않아도 됩니다.
