# 교회문서키트 BASIC 1.0 작성기

내부 관리 버전: **BASIC 1.0.10 로그인 안정화판**

교역자와 교회 실무자가 자주 쓰는 3개 문서를 빠르게 작성하고 PDF/PNG로 저장하는 상품화용 작성기입니다.

## 포함 문서

1. 기본 공지 안내문
2. 각부 월간행사 안내
3. 교육부서 주간보고서

## 사용 흐름

문서 선택 → 내용 작성 → 미리보기 확인 → PDF/PNG 저장

## 1.0.9 수정 내용

- 로그인 링크 발송 실패 시 실제 Supabase 상세 오류를 화면에 표시합니다.
- 로그인 화면에 관리자용 설정 확인 영역을 추가했습니다.
  - Supabase URL
  - 키 종류
  - 키 앞부분
  - Redirect URL
- Supabase URL이 예시값이거나 잘못된 형식이면 더 분명한 오류를 보여줍니다.
- 중복 클릭/오류 확인이 쉬워지도록 로그인 오류 문구를 안정화했습니다.

## Vercel 환경변수

Vercel → Environment Variables에 아래 2개가 필요합니다.

```text
VITE_SUPABASE_URL=https://프로젝트ID.supabase.co
VITE_SUPABASE_ANON_KEY=Supabase Legacy anon public key 또는 publishable key
```

문제가 있을 때는 로그인 화면의 **관리자용 설정 확인**을 열어 실제 값이 반영되었는지 확인하세요.

## Supabase 설정

- Authentication → Sign In / Providers → Email Enabled
- Allow new users to sign up ON
- Authentication → URL Configuration
  - Site URL: 작성기 Vercel 주소
  - Redirect URLs: 작성기 Vercel 주소와 `/**` 주소
- SQL Editor에서 `supabase_allowed_users.sql` 실행
- `allowed_users` 테이블에 구매자 이메일 등록


## BASIC 1.0.10 수정
- 브라우저에서 Supabase로 직접 로그인 요청을 보내지 않고 Vercel API 프록시(`/api/send-login-link`)를 통해 로그인 링크를 발송하도록 변경했습니다.
- Safari에서 `Load failed`가 뜨는 상황을 줄이기 위해 같은 도메인 API 요청 방식으로 보정했습니다.
- 서버 API 함수 3개를 추가했습니다: `send-login-link`, `auth-user`, `check-buyer`.
