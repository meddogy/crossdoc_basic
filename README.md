# 교회문서키트 BASIC 1.25

## 1.25 변경 사항

모바일에서 Supabase 이메일 Sign in 링크가 안정적으로 열리지 않는 문제를 피하기 위해 로그인 방식을 변경했습니다.

- 기존: 이메일 입력 → Supabase 로그인 메일 → Sign in 링크 클릭
- 변경: 승인된 이메일 입력 → 접속코드 입력 → 바로 접속

이제 베타테스터는 PC와 모바일에서 같은 방식으로 접속할 수 있습니다.

## 필수 Vercel 환경변수

기존 환경변수에 아래 값을 추가해 주세요.

```text
BETA_ACCESS_CODE=관리자가 정한 베타 접속코드
```

예시:

```text
BETA_ACCESS_CODE=crossdoc2026
```

기존 환경변수도 유지해야 합니다.

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSCODE
BETA_ACCESS_CODE
```

`APP_SESSION_SECRET`은 선택입니다. 없으면 `ADMIN_PASSCODE`를 세션 서명용으로 함께 사용합니다.

## 적용 방법

1. 압축을 풉니다.
2. GitHub에 압축 푼 파일 전체를 덮어쓰기 합니다.
3. Vercel 환경변수에 `BETA_ACCESS_CODE`를 추가합니다.
4. Vercel에서 Redeploy 합니다.
5. 승인된 이메일 + 접속코드로 PC/모바일 접속을 확인합니다.

## 기존 베타테스터 안내

기존에 받은 Supabase Sign in 메일은 사용하지 않아도 됩니다. 
앞으로는 작성기 주소에서 승인된 이메일과 접속코드를 입력해 주세요.

## 내 문서 저장

PC·모바일 이어쓰기 기능을 쓰려면 Supabase SQL Editor에서 `supabase_cloud_documents.sql` 내용을 한 번 실행해야 합니다.
