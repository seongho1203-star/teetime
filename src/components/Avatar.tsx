import { useState } from 'react';
import type { Gender } from '../lib/types';

/**
 * 그림 주소를 `https`로 올린다.
 *
 * **카카오가 주는 프사 주소는 `http://k.kakaocdn.net/…`이다** — `https`가
 * 아니다. 웹에서는 문서가 `https`라 **브라우저가 알아서 `https`로 올려
 * 받아 줘서**(mixed content auto-upgrade) 여태 그냥 떴다.
 * **앱에서는 문서가 `capacitor://localhost`라 그 올림이 없고**, iOS는
 * http 통신을 통째로 막으므로(App Transport Security) 그림만 조용히
 * 실패해 `onError`로 넘어갔다 — **앱으로 옮기자마자 얼굴이 글자로 바뀐
 * 것이 이것이다**(사용자 제보). 같은 주소를 `https`로 부르면 그대로 온다.
 *
 * **그릴 때 고친다. DB를 고치지 말 것** — 이미 `http://`로 저장된 행이
 * 회원 수만큼 있어서, 넣는 자리(가입 트리거·`createPending`)만 고치면
 * 그 뒤로 들어오는 사람만 맞고 지금 계신 분들은 그대로 글자다.
 *
 * 올렸는데도 안 받아지면 예전처럼 `onError`가 글자로 되돌리므로,
 * `https`가 없는 주소였더라도 잃는 것이 없다.
 */
function https(u: string) {
    return u.startsWith('http://') ? `https://${u.slice(7)}` : u;
}

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

    const src = url ? https(url) : null;
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
