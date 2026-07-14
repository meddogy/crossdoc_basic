# 교회문서키트 BASIC 1.2 작성기

내부 관리 버전: **BASIC 1.2 로그인 API 진단판**

교역자와 교회 실무자가 자주 쓰는 3개 문서를 빠르게 작성하고 PDF/PNG로 저장하는 상품화용 작성기입니다.

## 포함 문서

1. 기본 공지 안내문
2. 각부 월간행사 안내
3. 교육부서 주간보고서

## 사용 흐름

구매자 이메일 로그인 → 문서 선택 → 내용 작성 → 미리보기 확인 → PDF/PNG 저장

## BASIC 1.2 수정 내용

- 버전명을 `1.1`로 정리했습니다.
- `/api/send-login-link` 로그인 API의 오류 로그를 강화했습니다.
- Supabase가 반환한 상태 코드, 메시지, 원인, 진단 정보를 화면에 표시합니다.
- Vercel Logs에 `[send-login-link] failed` 상세 로그가 남도록 수정했습니다.
- `fetch failed`가 발생할 때 원인(cause), endpoint, key 종류, redirect URL을 함께 확인할 수 있습니다.
- `/api/debug-auth` 진단 API를 추가했습니다.

## Vercel 환경변수

Vercel → Environment Variables에 아래 2개가 필요합니다.

```text
VITE_SUPABASE_URL=https://프로젝트ID.supabase.co
VITE_SUPABASE_ANON_KEY=Supabase Legacy anon public key 또는 publishable key
```

현재 테스트 기준 예시:

```text
VITE_SUPABASE_URL=https://wgvprfkjwyxybcybxzqyu.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ... 로 시작하는 Legacy anon public key
```

환경변수 저장 후에는 반드시 Vercel에서 **Redeploy** 해야 합니다.

## Supabase 설정

- Authentication → Sign In / Providers → Email Enabled
- Allow new users to sign up ON
- Authentication → URL Configuration
  - Site URL: 작성기 Vercel 주소
  - Redirect URLs: 작성기 Vercel 주소와 `/**` 주소
- SQL Editor에서 `supabase_allowed_users.sql` 실행
- `allowed_users` 테이블에 구매자 이메일 등록

## 오류 확인 방법

로그인 링크 발송이 실패하면 작성기 화면의 상세 오류를 확인하세요.
또는 Vercel → Logs에서 `/api/send-login-link` 요청을 클릭한 뒤 아래 로그를 찾습니다.

```text
[send-login-link] failed
```

이 로그에 Supabase 상태, 메시지, 원인, endpoint 정보가 표시됩니다.

## GitHub/Vercel 배포 순서

1. 이 압축파일을 풉니다.
2. 압축을 푼 전체 파일을 GitHub 저장소에 업로드합니다.
3. Vercel에서 자동 배포가 완료될 때까지 기다립니다.
4. Vercel 환경변수 2개가 정확한지 확인합니다.
5. 필요한 경우 Deployments → Redeploy를 실행합니다.
6. `meddogy@naver.com`으로 로그인 링크 발송을 테스트합니다.


## BASIC 1.2 수정

- 로그인 후 개인 PC에서는 로그아웃하지 않고 창만 닫아도 된다는 안내를 추가했습니다.
- 로그아웃 버튼을 `공용 PC에서 로그아웃`으로 변경했습니다.
- PWA 설치/바로가기 안내를 추가했습니다.
- `manifest.webmanifest`, `sw.js`, 앱 아이콘을 추가했습니다.
- 구매자 접속 안내 문구를 BASIC 1.2 기준으로 보완했습니다.
