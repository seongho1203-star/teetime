/**
 * 길게 누른 창의 `공유`와 `캡쳐`.
 *
 * **둘 다 폰이 해 주는 일을 부르는 것뿐이다** — 우리가 무엇을 저장하거나
 * 어디로 보내지 않는다. 그래서 서버도, 붙여넣을 SQL도 없다.
 *
 * **되는지 안 되는지는 기기마다 다르다.** `navigator.share`는 아이폰
 * 사파리·홈 화면 앱에서는 되지만 PC 크롬에서는 없기도 하고, 앱 껍데기
 * (WKWebView) 안에서도 막힐 수 있다. 그래서 **여기서는 성공 여부만
 * 돌려주고, 못 하면 부른 쪽이 복사로 물러난다** — 오류창을 띄우지 않는다.
 * 공유가 안 된다고 대화가 멈출 이유는 없다.
 */

/** 공유창을 띄웠으면 `true`. 못 띄웠거나 사용자가 취소했으면 `false`. */
export async function shareText(text: string, url?: string): Promise<boolean> {
    if (!navigator.share) return false;
    try {
        await navigator.share(url ? { text, url } : { text });
        return true;
    } catch {
        /* 사용자가 창을 닫은 것도 여기로 온다 — 실패와 구분할 길이 없다.
           어느 쪽이든 더 할 일이 없으므로 조용히 돌아선다. */
        return false;
    }
}

/** 캡쳐 결과. 부른 쪽이 이 값으로 무슨 말을 할지 정한다. */
export type CaptureResult = 'shared' | 'saved' | 'fail';

/**
 * 말풍선 한 줄을 **그림으로 만들어** 공유창에 넘기거나 내려받는다.
 *
 * - **`html-to-image`는 누를 때 받아 온다**(`import()`). 캡쳐를 한 번도
 *   안 누르는 사람이 대부분인데 30KB를 늘 안고 다닐 이유가 없다.
 * - **글꼴은 안 심는다**(`skipFonts`). 우리 Pretendard는 화면에 나온 글자만
 *   받아 오는 방식이라, 심으려 들면 CDN에 수십 번 다녀오느라 몇 초가 걸린다.
 *   대신 폰의 기본 한글 글꼴로 그려지는데 **그림으로는 그게 더 자연스럽다.**
 * - **배경은 대화 목록의 보라를 그대로 깐다.** 안 깔면 투명 PNG가 되어
 *   흰 바탕에서 열면 글자가 안 보인다.
 * - **밀어서 답장 화살표는 뺀다**(`.chat-reply-btn`). 화면에서는 안 보이는데
 *   그림에는 그대로 찍힌다.
 */
export async function captureNode(el: HTMLElement): Promise<CaptureResult> {
    let blob: Blob | null = null;
    try {
        const { toBlob } = await import('html-to-image');
        const bg = getComputedStyle(
            document.querySelector('.chat-list') ?? document.body).backgroundColor;
        /* **여백을 주면 캔버스도 그만큼 키워야 한다.** `style`로 padding만
           주면 그림은 커지는데 담는 칸은 그대로라 **아래가 잘린다**
           (실제로 시각 줄이 반쯤 잘려 나왔다). `content-box`로 두고
           가로·세로를 직접 넘겨 그만큼 넓혀 준다. */
        const PX = 12, PY = 10;
        const r = el.getBoundingClientRect();
        blob = await toBlob(el, {
            backgroundColor: bg || '#7369a0',
            pixelRatio: 3,
            skipFonts: true,
            width: Math.ceil(r.width) + PX * 2,
            height: Math.ceil(r.height) + PY * 2,
            style: { margin: '0', padding: `${PY}px ${PX}px`, boxSizing: 'content-box' },
            filter: n => !(n instanceof Element && n.classList.contains('chat-reply-btn')),
        });
    } catch {
        return 'fail';
    }
    if (!blob) return 'fail';

    /* **파일 이름만은 영문이다.** `까꿍-…png`로 두었더니 브라우저가 한글
       이름을 통째로 버리고 `download`로 저장했다(크로미움에서 확인했다) —
       그러면 여러 장 찍었을 때 서로 덮어쓴다. 화면에 보이는 글이 아니라
       파일 이름이므로 `kkakkung.wav`처럼 영문 그대로 둔다. */
    const file = new File([blob], `kkakkung-${stamp()}.png`, { type: 'image/png' });

    /* **공유창이 먼저다.** 거기서 `이미지 저장`을 고르면 사진첩으로 들어가고,
       카톡으로 바로 보낼 수도 있다 — 내려받기보다 쓸모가 많다. */
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return 'shared';
        } catch {
            /* 취소했을 수도 있으므로 내려받기로 또 밀어붙이지 않는다. */
            return 'fail';
        }
    }

    /* 공유창이 없는 기기(PC 등)에서는 내려받는다.
       **아이폰 사파리는 이 길에서 새 탭으로 그림을 열어 준다** — 거기서
       길게 눌러 저장하면 된다. 그것까지가 웹이 할 수 있는 전부다. */
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        /* **문서에 붙였다 눌러야 이름이 먹는다.** 안 붙이고 누르면 파일이
           `download`로 저장된다(실제로 그렇게 나왔다) — 여러 장 찍었을 때
           서로 덮어쓴다. */
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        return 'saved';
    } catch {
        return 'fail';
    }
}

/** 파일 이름에 붙일 `0908-2143`. 같은 초에 두 번 눌러도 덮어쓰지 않게. */
function stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 사진 한 장을 **폰이 띄워 주는 공유창**에 넘긴다.
 *
 * 앱(8판+)에서는 앱이 직접 맡으므로 여기까지 안 온다 — **웹과 옛 앱의
 * 물러남**이다. 아이폰 공유창에는 `이미지 저장`이 들어 있어서 저장도 이
 * 길로 된다.
 *
 * **주소만 넘기지 않고 파일로 만들어 넘긴다** — 주소만 주면 사진이 아니라
 * 링크가 공유되어 `이미지 저장`이 안 나온다.
 */
export async function sharePhotoFile(url: string): Promise<boolean> {
    if (!navigator.share) return false;
    try {
        const res = await fetch(url);
        if (!res.ok) return false;
        const blob = await res.blob();
        const file = new File([blob], 'kkakkung.jpg', { type: blob.type || 'image/jpeg' });
        /* 파일을 못 받는 기기가 있다 — 그때는 아무 일도 안 하는 것보다
           낫게 주소라도 넘긴다. */
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
        else await navigator.share({ url });
        return true;
    } catch {
        // 사용자가 창을 닫은 것도 여기로 온다 — 실패와 구분할 길이 없다.
        return false;
    }
}
