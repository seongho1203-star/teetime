/**
 * 빌드 시각. `vite.config.ts`의 `define`이 빌드할 때 값을 박아 넣는다.
 *
 * 폰에 떠 있는 게 어느 판인지 가리는 데 쓴다 — 고친 게 안 먹는다고 할 때
 * 코드가 틀린 것인지 옛 화면이 남아 있는 것인지부터 갈라야 하기 때문이다.
 */
declare const __BUILD__: string;

/**
 * 앱 빌드 번호. `내 정보`의 `버전 1.28`에서 뒷자리다(`types.ts`의
 * `APP_VERSION`). **아이폰 앱을 만들 때만 채워진다** — 웹에서는 빈 값이다.
 */
declare const __APP_BUILD__: string;
