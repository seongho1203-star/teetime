import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

/* 앱으로 감싸는 설정. 절차와 까닭은 `docs/출시-전-할일.md` 0-3번에 있다.
 *
 * **지금은 확인용 껍데기다** — 화면을 앱 안에 담지 않고 웹 주소를 그대로
 * 띄운다(`server.url`). 그래야 한 줄 고칠 때마다 빌드·업로드·심사를
 * 기다리지 않고, 밀기만 하면 폰에서 바로 보인다. 키보드 밀림처럼 **여러 번
 * 고쳐 보며 잡아야 하는 것**을 그 속도로는 못 잡는다.
 *
 * **출시용으로 바꿀 때는 `server` 한 덩어리만 지운다** — 그러면 `npm run build`가
 * 만든 `dist`가 앱 안에 담긴다. 앱을 새로 만드는 것이 아니라 같은 앱의
 * 새 판이 되어, 폰에서는 앱 갱신으로 조용히 넘어간다.
 */
const config: CapacitorConfig = {
    /* **한 번 정하면 영영 못 바꾼다.** 스토어에서 앱을 가리키는 이름이라
     * 바꾸려면 다른 앱이 되고, 깔았던 사람은 새로 깔아야 한다. */
    appId: 'com.kkakkung.app',

    /* 홈 화면에 뜨는 이름. 저장소 이름만 `teetime`으로 남아 있고 사람 눈에
     * 보이는 이름은 전부 `까꿍`이다(manifest·`<title>`·로그인 화면과 같다). */
    appName: '까꿍',

    /* 껍데기에서는 안 쓰지만 비워 둘 수 없다 — 출시용으로 바꿀 때 여기가
     * 앱 안에 담긴다. `vite.config.ts`의 `base: './'`가 그때를 위한 것이다. */
    webDir: 'dist',

    server: {
        url: 'https://seongho1203-star.github.io/teetime/',
    },

    plugins: {
        /* **이 한 줄이 아이폰 키보드 밀림의 답이다**(`docs/출시-전-할일.md` 2번).
         * 웹에서는 키보드가 올라오면 보이는 화면이 문서보다 작아지고 그 차이만큼
         * iOS가 화면을 미는데, 그 손짓은 우리에게 이벤트조차 안 온다 —
         * 넉 대를 헛짚고 못 고쳤다. `native`는 **웹뷰 자체를 줄여** 밀 틈을
         * 아예 없앤다.
         *
         * 웹용 보정(`--kb`·`--vvh`·`locked`·120ms 되돌리기)은 **그대로 둔다** —
         * 웹뷰가 줄면 `documentElement.clientHeight`도 함께 줄어 키보드 높이가
         * 0으로 잡히고, 그러면 그 코드가 저절로 아무 일도 안 한다.
         * **실기기에서 그런지 먼저 확인할 것** — 어긋나면 그때
         * `Capacitor.isNativePlatform()`으로 앱일 때만 건너뛴다. */
        Keyboard: { resize: KeyboardResize.Native },
    },
};

export default config;
