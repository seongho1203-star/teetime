import { useState } from 'react';
import type { Gender } from '../lib/types';

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
    const [broken, setBroken] = useState(false);
    const ring = gender === 'm' ? ' av-m' : gender === 'f' ? ' av-f' : '';
    const cls = `avatar${size === 'lg' ? ' lg' : size === 'sm' ? ' sm' : ''}${ring}`;
    const label = (name || '').trim();
    const initials = label ? label.slice(-2) : '?';
    const alt = gender ? `${label} (${gender === 'm' ? '남' : '여'})` : label;

    if (url && !broken) {
        return (
            <img
                className={cls}
                src={url}
                alt={alt}
                loading="lazy"
                onError={() => setBroken(true)}
            />
        );
    }
    return <div className={cls} aria-label={alt}>{initials}</div>;
}
