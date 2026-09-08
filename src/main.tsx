import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';
import { registerServiceWorker } from './lib/push';
// 크롬의 설치 신호는 앱이 뜨자마자 한 번 온다. 화면이 그려지기 전에
// 귀를 대 두어야 붙잡을 수 있다 — 그래서 여기서 부른다.
import './lib/install';
// 앱(Capacitor)일 때 바깥 브라우저에서 돌아오는 카카오 로그인을 받는다.
// 앱이 꺼져 있다 그 주소로 켜지는 경우가 있어 **화면이 그려지기 전에**
// 귀를 대 두어야 한다 — 위 설치 신호와 같은 이유다. 웹에서는 바로 돌아선다.
import { watchNativeAuth } from './lib/native';

registerServiceWorker();
watchNativeAuth();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
);
