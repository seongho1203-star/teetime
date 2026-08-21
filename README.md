# teetime

골프 모임 앱. 라운드 모집·참가신청, 투표, 공지, 대화를 한곳에서 한다.

카카오 오픈톡에서 투표와 인원 모집이 대화에 묻히는 문제를 없애려고 만들었다.
**중요한 것은 각자의 자리에 남고, 대화는 대화 탭에서만 흐른다.**

## 지금 할 것

`docs/설치.md`를 따라 Supabase 프로젝트와 카카오 로그인을 한 번 붙이면 된다.
그 뒤로는 아래로 충분하다.

```bash
npm install
cp .env.example .env     # Supabase 주소와 anon 키를 채운다
npm run dev              # http://localhost:5173
```

## 무엇이 들어 있나

| 탭 | 하는 일 |
|---|---|
| 홈 | 지금 내가 해야 할 것만 — 다음 라운드, 아직 안 한 투표, 새 공지 |
| 라운드 | 모집 열기 · 선착순 신청 · 대기자 자동 승격 |
| 투표 | 복수 선택 · 익명 · 마감 시각 |
| 공지 | 고정 글 · 댓글 |
| 대화 | 실시간 채팅 |

회원 가입은 **총무 승인제**다. 카카오로 로그인만 해서는 아무것도 볼 수 없고,
`내 정보 → 회원 명단`에서 총무가 승인해야 들어온다.

## 만든 방식

- **Vite + React + TypeScript** — 빌드 결과는 정적 파일이라 어디에나 올라간다
- **Supabase** — Postgres · 카카오 로그인 · 실시간 · 권한(RLS)
- **해시 라우팅** — 정적 서버에서 404가 안 나고, 나중에 Capacitor로 감쌀 때도 그대로 동작한다

서버 코드가 따로 없다. 권한과 경합 처리는 전부 DB 안에 있다
(`supabase/schema.sql`).

## 명령어

```bash
npm run dev       # 개발 서버
npm run build     # dist/ 로 빌드 (타입 검사 포함)
npm run preview   # 빌드 결과 미리보기
npm run lint      # oxlint
```

`.dev/`는 헤드리스로 화면을 훑어보는 도구다. 가짜 데이터로 Supabase 없이
모든 화면을 찍어 볼 수 있다.

```bash
npm run dev -- --port 5199
node .dev/shots.mjs                     # 화면 전체를 .dev/shots/ 에
node .dev/scroll.mjs '/#/rounds/r1' rd  # 한 화면을 위/가운데/아래로
```

## 배포

`main`에 푸시하면 GitHub Actions가 빌드해서 Pages에 올린다.
저장소 Secrets에 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`가 있어야 한다.
