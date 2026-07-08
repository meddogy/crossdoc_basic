# 교회문서키트 BASIC 1.0 작성기

교역자와 교회 실무자가 자주 쓰는 3개 문서를 빠르게 작성하고 PDF/PNG로 저장하는 상품화용 안정판입니다.

## 내부 버전

BASIC 1.0.8 — 구매자 이메일 인증판

외부 노출명은 계속 **교회문서키트 BASIC 1.0 작성기**로 사용합니다.

## 포함 문서

1. 기본 공지 안내문
2. 각부 월간행사 안내
3. 교육부서 주간보고서

## 사용 흐름

구매자 이메일 로그인 → 문서 선택 → 내용 작성 → 미리보기 확인 → PDF/PNG 저장

## 1.0.8 수정 내용

- 작성기 진입 전 구매자 이메일 인증 화면을 추가했습니다.
- Supabase 이메일 Magic Link 로그인 방식으로 보호합니다.
- `allowed_users` 테이블에 등록된 이메일만 작성기를 열 수 있습니다.
- 작성기 링크가 유출되어도 미등록 이메일은 사용할 수 없습니다.
- 로그아웃 버튼을 추가했습니다.
- Supabase 환경변수가 없을 경우 설정 안내 화면을 보여줍니다.

## Vercel 환경변수

Vercel Project Settings → Environment Variables에 아래 2개를 등록하세요.

```text
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=Supabase anon public key
```

등록 후 반드시 다시 배포해야 합니다.

## Supabase 설정 요약

1. Supabase 프로젝트를 만듭니다.
2. Authentication에서 Email 로그인을 활성화합니다.
3. Redirect URL에 작성기 Vercel 주소를 등록합니다.
4. SQL Editor에서 `supabase_allowed_users.sql`을 실행합니다.
5. 구매자 이메일을 `allowed_users` 테이블에 등록합니다.
6. Vercel에 Supabase 환경변수를 등록하고 재배포합니다.

## 구매자 등록 예시

```sql
insert into public.allowed_users (email, plan, active, church_name, memo)
values ('buyer@example.com', 'basic', true, '우리교회', '1차 구매자');
```

## 운영 메모

- 구매자는 결제할 때 등록한 이메일로 로그인합니다.
- 이메일 로그인 링크가 메일함으로 발송됩니다.
- 등록되지 않은 이메일로 로그인하면 작성기 접근이 차단됩니다.
- 구매자 삭제 대신 `active=false`로 비활성화하는 방식을 권장합니다.
