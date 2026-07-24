# 교회문서키트 BASIC 1.23

BASIC 1.23는 PC·모바일 자유 접속을 위해 로그인 세션 자동 갱신을 보강한 버전입니다.

## 핵심 개선

- 기기별 최초 1회 로그인 후 세션 자동 갱신
- Supabase refresh token을 이용해 접속할 때마다 이메일 링크를 다시 받는 상황 완화
- 개인 PC/본인 휴대폰에서는 로그아웃하지 않고 창만 닫도록 안내 문구 정리
- 모바일/PC 홈 화면 바로가기 안내 강화
- 1.21 홈 대시보드형 UI 유지
- 1.20 클라우드 내 문서 저장/불러오기 유지

## 사용 흐름

1. 관리자가 `/admin`에서 베타 신청자를 승인합니다.
2. 사용자는 각 기기에서 처음 한 번만 이메일 로그인 링크를 엽니다.
3. 이후 개인 PC나 본인 휴대폰에서는 로그아웃하지 않고 기본 주소로 접속합니다.
4. 저장된 세션은 만료 전에 자동 갱신됩니다.

## 중요한 안내

- 새로운 기기에서는 최초 1회 이메일 인증이 필요합니다.
- 개인 기기에서는 로그아웃하지 않는 것이 좋습니다.
- 공용 PC에서만 로그아웃하세요.
- 베타테스터가 많아지면 Supabase Custom SMTP 설정을 권장합니다.

## 추가된 API

- `/api/refresh-session`

Supabase Auth refresh token으로 새 access token을 발급받아, 기존 로그인 상태를 유지합니다.

## 필요한 환경변수

기존과 동일합니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_PASSCODE`

## SQL

기존 1.20/1.21 SQL을 이미 적용했다면 새 SQL 추가 실행은 필요 없습니다.

- `supabase_beta_applications.sql`
- `supabase_cloud_documents.sql`
- `supabase_allowed_users.sql`


## BASIC 1.23 긴급 안정화

- 홈 대시보드의 `홈 / 문서 작성 / 내 문서 / 템플릿 / 설정` 메뉴가 실제 화면 전환처럼 보이도록 보강했습니다.
- 작성 화면 상단의 `← 홈` 버튼으로 언제든 대시보드로 돌아갈 수 있습니다.
- `user_documents` 테이블이 없을 때 원문 오류 대신 “Supabase SQL을 먼저 실행해 주세요” 안내가 나오도록 정리했습니다.
- 모바일 로그인 안내 문구를 보강했습니다. 새 기기의 최초 로그인에는 여전히 Supabase 인증 메일이 필요합니다. 기본 메일 발송 한도 문제는 Custom SMTP 설정이 필요합니다.

### 반드시 확인할 것

PC·모바일 이어쓰기 기능을 사용하려면 Supabase SQL Editor에서 `supabase_cloud_documents.sql`을 한 번 실행해야 합니다.

