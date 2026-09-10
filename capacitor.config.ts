import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

/* 앱으로 감싸는 설정. 절차와 까닭은 `docs/출시-전-할일.md` 0-3번에 있다.
 *
 * **이제 출시용이다**(사용자 요청 — `앱 출시용으로 진행해줘`). `server` 한
 * 덩어리를 지웠으므로 `npm run build`가 만든 `dist`가 **앱 안에 담긴다.**
 *
 * **그래서 고치는 속도가 달라졌다 — 이것이 이 한 줄의 값이자 대가다.**
 * 껍데기이던 동안에는 웹만 밀면 폰에서 바로 보였는데, 이제 앱을 쓰는
 * 사람에게 닿으려면 `빌드 → TestFlight → 애플이 처리 → 폰에서 갱신`으로
 * **한 바퀴가 30분**이다. 화면을 여러 번 고쳐 보며 다듬어야 하는 일이
 * 생기면, `server`를 잠시 도로 붙여 그 동안만 껍데기로 쓰는 길이 있다
 * (아래 주석 그대로 되살리면 된다).
 *
 *     server: { url: 'https://seongho1203-star.github.io/teetime/' },
 *
 * **웹(GitHub Pages)은 그대로 돈다** — 홈 화면에 추가해 쓰던 회원은 예전과
 * 똑같고, 알림도 거기서는 그대로 온다. 앱은 그 위에 하나 더 생기는 길이다.
 */
const config: CapacitorConfig = {
    /* **한 번 정하면 영영 못 바꾼다.** 스토어에서 앱을 가리키는 이름이라
     * 바꾸려면 다른 앱이 되고, 깔았던 사람은 새로 깔아야 한다. */
    appId: 'com.kkakkung.app',

    /* 홈 화면에 뜨는 이름. 저장소 이름만 `teetime`으로 남아 있고 사람 눈에
     * 보이는 이름은 전부 `까꿍`이다(manifest·`<title>`·로그인 화면과 같다). */
    appName: '까꿍',

    /* 여기 든 것이 앱 안에 담긴다. **`vite.config.ts`의 `base: './'`가
     * 이 자리를 위한 것이다** — 앱에서는 문서가 `capacitor://localhost`에
     * 있어 절대 경로(`/teetime/…`)로는 아무것도 못 찾는다.
     * 이모티콘 그림(`public/stickers/`)도 함께 담기므로 앱에서는 그림을
     * 밖에서 안 받아 온다 — 통신량도 줄고 처음 여는 것도 빠르다. */
    webDir: 'dist',

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
