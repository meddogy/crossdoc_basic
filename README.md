# 교회문서키트 BASIC 1.17

교회문서키트 BASIC은 교회 실무자가 자주 만드는 공지문, 월간행사 안내, 주간보고서, 행사 및 수련회 기획안을 웹에서 작성하고 PDF/PNG로 저장하는 작성기입니다.

## 1.17 주요 추가 기능

- `/apply` 베타테스터 신청 페이지 추가
- `/admin` 베타 신청 관리자 페이지 추가
- 관리자 승인 버튼으로 `allowed_users` 자동 등록
- 신청자 안내 메일 문구 복사 기능 추가
- 기존 구매자 이메일 인증, PWA, 사용법 내장, PDF/PNG 저장 기능 유지

## 제공 문서 5종

1. 기본 공지 안내문
2. 각부 월간행사 안내
3. 부서별 주간보고서
4. 부서 통합 주간보고서
5. 행사 및 수련회 기획안

## 배포 전 준비

### 1) Supabase SQL 실행

Supabase SQL Editor에서 아래 파일 내용을 실행합니다.

- `supabase_allowed_users.sql`
- `supabase_beta_applications.sql`

`supabase_beta_applications.sql`은 베타 신청 목록을 저장하는 `beta_applications` 테이블을 만듭니다.

### 2) Vercel 환경변수

기존 환경변수는 그대로 유지합니다.

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

1.17 관리자 승인 기능을 사용하려면 아래 서버 전용 환경변수를 추가해야 합니다.

```text
SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSCODE
```

주의: `SUPABASE_SERVICE_ROLE_KEY`에는 절대 `VITE_`를 붙이지 마세요. 브라우저에 노출되면 안 되는 서버 전용 키입니다.

## 사용 주소

작성기 로그인:

```text
https://배포주소/
```

베타 신청 페이지:

```text
https://배포주소/apply
```

관리자 승인 페이지:

```text
https://배포주소/admin
```

## 운영 흐름

1. 베타 모집글에 `/apply` 링크를 공유합니다.
2. 신청자가 신청서를 작성합니다.
3. 관리자가 `/admin`으로 접속합니다.
4. `ADMIN_PASSCODE`를 입력하고 신청자 목록을 불러옵니다.
5. 승인할 신청자에게 `승인 및 등록`을 누릅니다.
6. 해당 이메일이 `allowed_users`에 자동 등록됩니다.
7. `안내문 복사`를 눌러 신청자에게 메일로 보냅니다.
8. 신청자는 작성기 주소에서 자기 이메일로 로그인합니다.

## 구매자/베타테스터 안내 핵심

- 메일의 Sign in 링크는 임시 로그인용입니다.
- 계속 사용할 주소는 작성기 기본 주소입니다.
- 개인 PC에서는 로그아웃하지 않고 창만 닫아도 됩니다.
- 공용 PC에서 사용한 경우에만 “공용 PC에서 로그아웃”을 누릅니다.
