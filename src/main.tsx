import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { registerServiceWorker } from './lib/push';
// 크롬의 설치 신호는 앱이 뜨자마자 한 번 온다. 화면이 그려지기 전에
// 귀를 대 두어야 붙잡을 수 있다 — 그래서 여기서 부른다.
import './lib/install';

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
