/**
 * 알림음 (`까꿍`).
 *
 * **앱을 보고 있을 때만 울린다.** 웹푸시에는 소리를 정하는 방법이 아예
 * 없다 — `Notification`의 `sound`는 어느 브라우저도 구현하지 않았고,
 * 알림이 올 때 도는 서비스워커는 오디오를 재생할 수 없다. 그래서 앱이
 * 닫혀 있을 때 오는 알림은 **폰의 기본음**이 난다.
 * 앱으로 감싸면 그때는 이 파일을 알림음으로 물릴 수 있다
 * (`docs/출시-전-할일.md` 1번).
 *
 * 그래서 여기서 하는 일은 카톡과 같다 — **대화 화면을 안 보고 있는데 새
 * 글이 오면** 소리로 알려 준다. 대화 화면을 보고 있으면 그 자리에서
 * 읽는 것이라 울리지 않는다.
 *
 * **소리는 막힐 수 있다.** 브라우저는 사람이 한 번도 안 누른 페이지에서
 * 소리를 못 내게 한다. 막히면 조용히 지나간다 — 소리 때문에 화면이
 * 멈추는 일은 없어야 한다.
 */

let audio: HTMLAudioElement | null = null;

/** 너무 잦으면 시끄럽다. 마지막으로 운 지 이만큼은 지나야 다시 운다. */
const GAP = 1500;
let last = 0;

export function playDing() {
    if (Date.now() - last < GAP) return;
    last = Date.now();
    try {
        // 한 번 만들어 두고 되감아 쓴다. 새로 만들면 그때마다 파일을 받는다.
        if (!audio) {
            audio = new Audio('./kkakkung.wav');
            audio.preload = 'auto';
        }
        audio.currentTime = 0;
        audio.play().catch(() => { /* 아직 아무것도 안 누른 화면 */ });
    } catch { /* 소리를 못 내는 기기 */ }
}
