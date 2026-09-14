import { useState } from 'react';
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
    if (src && src !== bad) {
        return (
            <img
                className={cls}
                src={src}
                alt={alt}
                loading="lazy"
                onError={() => setBad(src)}
            />
        );
    }
    return <div className={cls} aria-label={alt}>{initials}</div>;
}
