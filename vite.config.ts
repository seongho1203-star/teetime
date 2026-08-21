import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // 상대 경로로 빌드한다. GitHub Pages의 하위 경로(`/teetime/`)에서도,
    // 나중에 Capacitor가 파일을 직접 띄울 때도 그대로 동작한다.
    base: './',
    server: { host: true },
});
