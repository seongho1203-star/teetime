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
 * ── **iOS는 소리를 잠가 둔다** ────────────────────────────────
 *
 * 아이폰 사파리는 **사람이 누른 순간에 한 번이라도 재생된 적 없는
 * `Audio`는 나중에 코드로 재생하지 못하게** 막는다. 화면 어딘가를 눌러
 * 봤는지가 아니라 **그 요소가 손짓 안에서 울려 본 적이 있는지**를 본다.
 * 그래서 알림이 올 때 처음 `play()`를 부르면 언제나 거절당하고, 우리는
 * 그 실패를 조용히 넘기고 있어서 **아무 일도 안 일어난 것처럼 보였다.**
 *
 * 그래서 **첫 손짓에서 소리 없이 한 번 재생해 잠금을 푼다**(`unlock`).
 * 한 번 풀리면 그 뒤로는 코드로 울릴 수 있다.
 *
 * **그래도 무음 스위치는 못 이긴다.** 폰이 무음이면 사파리의 소리는
 * 통째로 안 난다 — 웹에서 넘을 수 있는 벽이 아니다. 이것도 앱으로
 * 감싸면 없어진다(네이티브는 소리 갈래를 정할 수 있다).
 */

/** 너무 잦으면 시끄럽다. 마지막으로 운 지 이만큼은 지나야 다시 운다. */
const GAP = 1500;
let last = 0;

let audio: HTMLAudioElement | null = null;
/** 소리가 실제로 난 적이 있는가. iOS에서만 뜻이 있다. */
let unlocked = false;
/**
 * 진짜 재생을 걸어 둔 적이 있는가. **바로 서는 표시라야 한다.**
 *
 * 잠금 풀기와 진짜 소리가 같은 순간에 겹칠 수 있다. `play()`가 끝나기를
 * 기다리는 값으로는 그 찰나를 못 막아 동기 표시를 따로 둔다 —
 * 아래 `unlock`의 `pause()`가 **방금 난 소리를 스스로 끄는 것**을 막는다.
 * (`내 정보`에 있던 `소리 시험` 단추에서 실제로 그렇게 났었다.
 *  단추는 사용자 요청으로 걷어냈지만 이 장치는 남겨 둔다.)
 */
let tried = false;
/** 잠금 풀기가 도는 중. 한 번 누르면 pointerdown·touchend가 같이 온다. */
let unlocking = false;

function ensureAudio(): HTMLAudioElement {
    if (!audio) {
        audio = new Audio('./kkakkung.wav');
        audio.preload = 'auto';
    }
    return audio;
}

/**
 * 첫 손짓에서 잠금을 푼다.
 *
 * 소리를 끄고 한 번 재생했다 바로 멈춘다 — 사람 귀에는 아무것도 안
 * 들리지만 iOS는 '이 요소는 손짓 안에서 울렸다'고 기억한다.
 * **`once`로 한 번만 듣는다** — 누를 때마다 돌 이유가 없다.
 */
function unlock() {
    if (tried || unlocked || unlocking) return;
    unlocking = true;
    const a = ensureAudio();
    a.muted = true;
    a.play().then(() => {
        unlocking = false;
        /* **그새 진짜 소리가 시작됐으면 멈추지 않는다.**
           `pointerdown`은 `click`보다 **먼저** 오므로, 누름 하나로 여기가
           먼저 돌고 뒤이어 진짜 소리가 날 수 있다 — 그때 아래 `pause()`를
           그대로 부르면 **방금 난 소리를 스스로 끈다.** 실제로 겪은 일이다. */
        if (tried) { a.muted = false; return; }
        a.pause();
        a.currentTime = 0;
        a.muted = false;
        unlocked = true;
    }).catch(() => {
        // 여기서 막히면 아직 못 푼 것이다. 다음 손짓에 다시 해 본다.
        unlocking = false;
        a.muted = false;
    });
}

/* **모듈을 불러오는 순간부터 손짓을 기다린다.** 화면 하나에서 듣고
   있으면 그 화면에 가기 전에 이미 여러 번 눌린 뒤라 늦다.
   `pointerdown`은 아이폰에서도 뜨고, 없는 기기를 위해 `touchend`와
   `keydown`도 함께 건다. */
if (typeof window !== 'undefined') {
    for (const type of ['pointerdown', 'touchend', 'keydown']) {
        window.addEventListener(type, unlock, { once: true, passive: true });
    }
}

export function playDing() {
    if (Date.now() - last < GAP) return;
    last = Date.now();

    // 위 `unlock`이 이 순간을 알아채고 물러나도록 **먼저** 표시한다.
    tried = true;
    try {
        const a = ensureAudio();
        a.muted = false;
        a.currentTime = 0;
        a.play().then(() => { unlocked = true; })
                .catch(() => { /* 아직 안 풀렸거나 폰이 무음이다 */ });
    } catch { /* 소리를 못 내는 기기 */ }
}

