/**
 * 글 안의 주소(URL)를 찾아 **눌리는 링크**로 만든다.
 *
 * 카톡에서는 주소를 붙이면 그대로 눌러 들어간다. 우리는 그냥 글자였고,
 * 게다가 말풍선에 `user-select: none`이 걸린 자리(가리거나 지울 수 있는 글)
 * 에서는 **길게 눌러 복사할 수도 없어서** 주소를 옮길 길이 아예 없었다 —
 * 골프장 예약 주소나 유튜브 주소를 대화방에 붙이는 일이 흔한데 그게 죽은 값이었다.
 *
 * **언급(`@이름`)과 같은 결로 다룬다** — 따로 저장하지 않고 그릴 때 찾는다.
 * 칸을 두면 나중에 규칙을 바꿔도 예전 글에는 안 먹는다.
 */

/**
 * 주소로 볼 것.
 *
 * `http(s)://`로 시작하거나 `www.`로 시작하는 것만 본다.
 * **`naver.com`처럼 맨몸 도메인은 안 잡는다** — `오전 9.30분` 같은 글이
 * 주소로 둔갑하는 쪽이 훨씬 성가시다.
 *
 * **한글에서 끊는다.** `https://map.kakao.com/무등산CC로 오세요`처럼 주소
 * 뒤에 바로 한글이 붙는 일이 잦은데, 안 끊으면 문장 끝까지 링크가 된다.
 * 진짜 주소 안의 한글은 대개 `%EB%AC%B4`처럼 바뀌어 오므로 손해가 없다.
 * 괄호·따옴표도 끊는 자리다 — `(https://…)`로 감싸 적는 일이 있다.
 */
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'`()[\]{}가-힣ㄱ-ㅎㅏ-ㅣ]+/gi;

/** 주소 끝에 붙은 문장부호는 주소가 아니다 — `여기 봐: https://a.b/c.` 의 마지막 점. */
const TAIL = /[.,!?;:·…]+$/;

/** 글 한 조각. `href`가 있으면 눌리는 주소다. */
export interface Link { text: string; href?: string }

/**
 * `href`로 쓸 값. `www.`로 시작하면 `https://`를 앞에 붙인다 —
 * 안 붙이면 브라우저가 **우리 앱 안의 경로**로 알아듣는다.
 */
const hrefOf = (raw: string) => (/^www\./i.test(raw) ? `https://${raw}` : raw);

/**
 * 글을 주소와 나머지로 나눈다.
 *
 * 주소가 없으면 통째로 한 조각이라, 부르는 쪽이 헛일을 안 한다.
 */
export function splitLinks(text: string): Link[] {
    if (!text || !/https?:\/\/|www\./i.test(text)) return [{ text }];

    const out: Link[] = [];
    let last = 0;
    for (const m of text.matchAll(URL_RE)) {
        const i = m.index ?? 0;
        // 끝의 문장부호는 주소에서 뺀다. 뺀 만큼은 그냥 글자로 돌려놓는다.
        const raw = m[0].replace(TAIL, '');
        // 부호를 떼고 나니 `https://`만 남는 것 같은 경우는 주소가 아니다.
        if (!/[a-z0-9]/i.test(raw.replace(/^https?:\/\//i, ''))) continue;
        if (i > last) out.push({ text: text.slice(last, i) });
        out.push({ text: raw, href: hrefOf(raw) });
        last = i + raw.length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out.length ? out : [{ text }];
}
