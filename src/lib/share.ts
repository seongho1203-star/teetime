/**
 * 길게 누른 창의 `공유`, 그리고 크게 본 사진의 `공유`.
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
