import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // 상대 경로로 빌드한다. GitHub Pages의 하위 경로(`/teetime/`)에서도,
    // 나중에 Capacitor가 파일을 직접 띄울 때도 그대로 동작한다.
    base: './',
    server: { host: true },
    // **지금 폰에 떠 있는 게 어느 판인지** 알 수 있게 빌드 시각을 박아 둔다.
    // 고친 게 안 먹는다고 할 때, 코드가 틀린 것인지 옛 화면이 남아 있는
    // 것인지부터 갈라야 하는데 그걸 볼 방법이 없었다. `내 정보` 맨 아래에
    // 한국 시각으로 나온다.
    define: {
        __BUILD__: JSON.stringify(
            // `8/23 02:20` — 한국 시각. en-CA는 `2026-08-23, 02:20`으로 주므로
            // 거기서 잘라 쓴다(ko-KR은 `8. 23. 02:20`이라 점이 지저분하다).
            new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: false,
            }).format(new Date()).replace('-', '/').replace(',', ''),
        ),
    },
});
