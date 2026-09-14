/**
 * 올리기 전에 사진을 줄인다.
 *
 * 요즘 폰 사진은 한 장에 3~5MB다. 그대로 올리면 저장 공간이 금방 차고,
 * 데이터가 넉넉하지 않은 곳에서 대화를 열 때마다 그걸 다 받아야 한다.
 *
 * **긴 변 2560px · JPEG 82%다.** 한 장 700~800KB쯤이다(사용자가 고른 값 —
 * `최고 화질`). 크게 본 사진을 벌려 키울 수 있게 되면서 1600px으로는
 * 흐릿했다.
 *
 * **한 번 1600px으로 되돌렸다가 다시 올렸다.** 2560px으로 키운 직후에
 * 사진이 아예 안 올라가서 크기를 의심했는데(`사진 크기를 키운 후로 안돼`),
 * **범인은 크기가 아니라 사진 고르는 창이었다** — 그 창이 닫히기 전에
 * 보관함·카메라를 띄우고 있었다(`NativeComposerPlugin`의 `afterSheet`).
 * **여기서 남길 교훈은 그대로다: 크기를 만질 때는 화질만 볼 것이 아니라
 * 정말 올라가는지부터 볼 것** — `.dev/behave.mjs`의 `사진을 줄여서 올린다`
 * 칸이 실제로 나가는 바이트를 잰다.
 *
 * **바꿀 때는 사용자에게 물을 것** — 무료 저장 공간이 1GB라 여기가
 * 곧 '사진을 몇 장 올릴 수 있는가'다. 지금은 90일이 지나면 지우므로
 * (`lib/photos.ts`) 한 시즌치인 300MB 언저리에서 멈춘다.
 *
 * **`imageSmoothingQuality`가 이 파일의 핵심이다.** 브라우저의 기본값은
 * `low`인데, 4032px을 2560px으로 줄이는 것처럼 크게 줄일 때 계단이 지고
 * 잔무늬가 생긴다. 재 보니 **화질이 나쁘면서 파일은 오히려 더 컸다**
 * (1600px 기준 529KB·차이 19.1 → `high`로 449KB·차이 16.5) — JPEG이
 * 그 잡티까지 저장하기 때문이다. **지우지 말 것: 공짜로 얻는 것이다.**
 *
 * **줄이지 못하면 원본을 그대로 돌려준다.** 사진을 못 올리는 것보다
 * 큰 사진이라도 올라가는 편이 낫다.
 *
 * **앱은 이 셈을 따로 들고 있다**(`ios/App/App/NativeComposerPlugin.swift`의
 * `jpegBase64`). 8판부터 사진을 앱이 고르므로 그 길로 올라간다 —
 * **한쪽만 고치지 말 것.** 다만 앱은 새로 깔아야 바뀌므로, 웹이
 * 올리기 직전에 **한 번 더 재어 넘치면 줄인다**(`Chat.tsx`의 `sendPhoto`) —
 * 그래야 옛 앱을 든 폰에서도 웹만 밀어서 고칠 수 있다.
 */

const MAX_EDGE = 2560;
const QUALITY = 0.82;

/**
 * 그림 주소를 `https`로 올린다.
 *
 * **카카오가 주는 프사 주소는 `http://k.kakaocdn.net/…`이다** — `https`가
 * 아니다. 웹에서는 문서가 `https`라 **브라우저가 알아서 올려 받아 줘서**
 * (mixed content auto-upgrade) 여태 그냥 떴다. **앱에서는 문서가
 * `capacitor://localhost`라 그 올림이 없고**, iOS는 http 통신을 통째로
 * 막으므로(App Transport Security) 그림만 조용히 실패한다 — **앱으로
 * 옮기자마자 얼굴이 다 글자로 바뀐 것이 이것이다**(사용자 제보).
 *
 * **그릴 때 고친다. DB를 고치지 말 것** — 이미 `http://`로 저장된 행이
 * 회원 수만큼 있어서, 넣는 자리만 고치면 그 뒤로 들어오는 사람만 맞는다.
 *
 * **얼굴(`Avatar`)과 전체화면 프로필(`ProfileFull`)이 같이 쓴다** —
 * 한쪽에만 두면 그 화면에서만 사진이 글자로 바뀐다.
 */
export function httpsUrl(u: string) {
    return u.startsWith('http://') ? `https://${u.slice(7)}` : u;
}

/**
 * `maxEdge`를 넘기면 그 크기로 줄인다. 프로필 사진은 아바타로만 쓰여
 * 큰 것이 의미가 없다 — 400px이면 충분하고 그만큼 빨리 올라간다.
 */
export async function shrinkImage(file: Blob, maxEdge = MAX_EDGE): Promise<Blob> {
    try {
        // 아이폰 사진은 방향이 EXIF에만 적혀 있다. from-image를 줘야
        // 세로로 찍은 사진이 눕지 않는다.
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        // 위 머리말 참고 — 이 두 줄이 화질과 파일 크기를 함께 좋게 한다.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();

        const blob = await new Promise<Blob | null>(res =>
            canvas.toBlob(res, 'image/jpeg', QUALITY));
        // 줄인 게 더 크면(작은 PNG 같은 것) 원본이 낫다.
        return blob && blob.size < file.size ? blob : file;
    } catch {
        return file;
    }
}
