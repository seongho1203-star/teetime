# 수리노트

LG전자 가전수리 엔지니어가 모델별 점검 방법, 테스트 모드, 히든 키, 에러 코드와 현장 노하우를 공유하고 검색하는 웹앱입니다.

## 시작하기

```bash
npm ci
cp .env.example .env
npm run dev
```

`.env`에 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`를 입력합니다. 로그인은 카카오 또는 Apple을 지원하며, 기존 회원 승인 절차를 통과한 계정만 자료를 읽고 등록할 수 있습니다.

## 주요 기능

- 제품군·모델명·정보 유형별 분류와 검색
- 증상, 점검 절차, 결과, 주의 사항 및 태그 등록
- 사진 최대 6장 첨부와 승인 회원 전용 비공개 저장
- 새 수리 정보의 앱 알림함 등록과 선택형 웹 푸시
- 운영자 회원 승인과 정보 검증 표시
- 휴대전화와 데스크톱에 맞춘 반응형 화면

## 데이터베이스와 배포

`supabase/repair_knowledge.sql`은 기존 인증·회원·알림 데이터를 유지하면서 수리 지식 테이블, 검색 함수, 사진 저장소와 알림 트리거를 추가합니다. `main`에 반영하면 GitHub Actions가 SQL과 알림 함수를 갱신한 뒤 GitHub Pages에 웹앱을 배포합니다.

배포용 저장소 Secrets에는 기존 설정인 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`이 필요합니다. DB 주소가 없으면 Actions가 SQL 적용을 건너뛰므로 `supabase/repair_knowledge.sql`을 Supabase SQL Editor에서 실행해야 합니다. 자세한 내용은 [운영 안내](docs/수리노트-운영.md)를 참고하세요.

## 실행 명령

```bash
npm run dev       # 개발 서버
npm run build     # 타입 검사 및 프로덕션 빌드
npm run preview   # 빌드 결과 미리보기
npm run lint      # 정적 검사
```
