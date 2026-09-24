import { useState, type SyntheticEvent } from 'react';
import type { Gender } from '../lib/types';
/**
 * **주소를 `https`로 올리는 일은 `lib/image.ts`에 한 벌로 있다**
 * (`httpsUrl`). 전체화면 프로필(`ProfileFull`)도 같은 것을 쓰므로,
 * 여기에 다시 만들지 말 것 — 한쪽만 고치면 그 화면에서만 사진이
 * 글자로 바뀐다. 올렸는데도 안 받아지면 `onError`가 글자로 되돌린다.
 */
import { httpsUrl } from '../lib/image';

/**
 * 프로필 사진. 없거나 못 불러오면 이름의 마지막 두 글자를 보여 준다
 * (한국 이름은 성보다 이름이 사람을 가른다 — `신성호` → `성호`).
 *
 * **테두리 색이 남녀를 가른다**(사용자가 고른 방법이다). 이름표는
 * `83/신성호/광산구`로 이미 길어서 거기에 `남`·`여`까지 붙이면 줄이
 * 넘친다 — 얼굴 둘레는 글자를 안 늘리고 쓸 수 있는 자리다.
 *
 * **`--male`·`--female`은 이 한 곳에만 쓴다.** 뜻이 있는 색
 * (분홍=지금 눌러야 할 것 · 잔디=좋은 상태 · 노랑=기다림 · 빨강=안 본 것 ·
 * 보라=대기자)과 섞이면 안 되므로 토큰을 따로 두었다. 얼굴에만 붙어
 * 있으면 뱃지·단추와 부딪힐 일이 없다 — **다른 곳으로 번지게 하지 말 것.**
 *
 * 성별을 모르면 테두리가 없다(예전 회원·로그인 전). 색만으로 가르는 것은
 * 눈이 불편한 사람에게 안 보이므로 `aria-label`에 함께 적는다.
 */
/**
 * **한 번 받은 얼굴은 픽셀째 기억해 두고, 다음부터는 캔버스로 곧바로 그린다.**
 *
 * 사용자 제보 — `채팅에서 홈으로 갈때 프로필을 다시 불러드리는 것처럼 한번
 * 깜빡이고`. 화면이 새로 그려지면 `<img>`도 새 요소라 캐시에 있어도 **붙은
 * 뒤에 다시 받아 풀고**, 그동안 얼굴 자리가 회색 동그라미(`.avatar`의 바탕)로
 * 빈다. 앱에서는 대화 화면이 떠 있는 동안 웹뷰가 화면 밖에 있어 그 일이
 * **돌아오는 순간까지 미뤄져** 더 도드라졌다.
 *
 * 캔버스는 픽셀을 들고 있어 **붙는 그 프레임에 이미 차 있다** — 앞 화면
 * 사본(`lib/tabs.ts`의 `grabImages`)에서 먹힌 그 수다.
 *
 * - **처음 한 번은 여느 `<img>`다.** 다 받았을 때(`onLoad`) 그 그림을
 *   작게(`FACE_PX`) 옮겨 담는다. 그 뒤로 같은 주소는 캔버스로 그린다.
 * - **`.avatar` 클래스를 그대로 준다** — 둥근 모양·남녀 테두리·`object-fit:
 *   cover`가 캔버스에도 먹는다.
 * - **남의 서버 그림은 캔버스가 '오염'되지만 그리는 것은 된다**(읽는 것만
 *   막힌다. 우리는 안 읽는다).
 * - **몇 장까지만 들고 있는다**(`FACE_MAX`) — 가장 오래 안 쓴 것부터 버린다.
 *   한 장이 168px 정사각이면 110KB 남짓이라 백이십 장에 13MB쯤이다.
 * - 모르는 판(캔버스를 못 만드는 곳)에서는 조용히 예전 `<img>`로 남는다.
 */
const FACE_PX = 168;     // 가장 큰 얼굴(lg 56px) × 화면 배율 3
const FACE_MAX = 120;
const faces = new Map<string, HTMLCanvasElement>();

function keepFace(src: string, img: HTMLImageElement): void {
    try {
        if (faces.has(src) || !img.naturalWidth || !img.naturalHeight) return;
        const k = Math.min(1, FACE_PX / Math.min(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * k));
        cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = cv.getContext('2d');
        if (!g) return;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, cv.width, cv.height);
        faces.set(src, cv);
        while (faces.size > FACE_MAX) faces.delete(faces.keys().next().value as string);
    } catch { /* 못 담으면 다음에도 `<img>`로 그릴 뿐이다 */ }
}

/** 기억해 둔 얼굴을 캔버스에 옮긴다. 쓸 때마다 맨 뒤로 보내 오래 남긴다. */
function paintFace(src: string, cv: HTMLCanvasElement | null): void {
    const pic = faces.get(src);
    if (!cv || !pic) return;
    faces.delete(src); faces.set(src, pic);
    if (cv.width !== pic.width || cv.height !== pic.height) {
        cv.width = pic.width; cv.height = pic.height;
    }
    try { cv.getContext('2d')?.drawImage(pic, 0, 0); } catch { /* 그대로 둔다 */ }
}

export function Avatar({
    name, url, gender, size = 'md',
}: {
    name?: string | null;
    url?: string | null;
    gender?: Gender | null;
    size?: 'sm' | 'md' | 'lg';
}) {
    /* **어느 주소가 깨졌는지를 담는다.** 참·거짓으로 두면 사진을 바꿔
     * 올린 뒤에도 그 표가 남아, 새 사진이 멀쩡한데 글자로 보인다
     * (`내 정보`에서 바꾸면 같은 조각이 그대로 다시 그려진다). */
    const [bad, setBad] = useState<string | null>(null);
    const ring = gender === 'm' ? ' av-m' : gender === 'f' ? ' av-f' : '';
    const cls = `avatar${size === 'lg' ? ' lg' : size === 'sm' ? ' sm' : ''}${ring}`;
    const label = (name || '').trim();
    const initials = label ? label.slice(-2) : '?';
    const alt = gender ? `${label} (${gender === 'm' ? '남' : '여'})` : label;

    const src = url ? httpsUrl(url) : null;
    if (src && src !== bad && faces.has(src)) {
        return (
            <canvas className={cls} role="img" aria-label={alt}
                    ref={cv => paintFace(src, cv)} />
        );
    }
    if (src && src !== bad) {
        return (
            <img
                className={cls}
                src={src}
                alt={alt}
                loading="lazy"
                onLoad={(e: SyntheticEvent<HTMLImageElement>) => keepFace(src, e.currentTarget)}
                onError={() => setBad(src)}
            />
        );
    }
    return <div className={cls} aria-label={alt}>{initials}</div>;
}
