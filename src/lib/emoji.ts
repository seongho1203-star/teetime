/**
 * 이모지만 보낸 짧은 글 가려내기.
 *
 * 카톡이 그렇듯 **이모지 하나만 보낸 글은 말풍선 없이 크게** 보여 준다.
 * 손에 익은 결이기도 하고, 작은 말풍선 안에 이모지 하나가 들어앉아 있으면
 * 그것대로 초라하다.
 */

/** 이만큼까지만 크게. 넘으면 평소대로 말풍선에 담는다. */
const MAX = 3;

/**
 * 이모지 하나인가.
 *
 * **`\p{Extended_Pictographic}` 하나로 보면 안 된다** — `©` `®` `™`도 거기
 * 들어가서, 그것만 친 글이 갑자기 커진다. 실제로 이모지로 보이는 것은
 * 넷 중 하나다: 기본이 이모지 모양인 글자(👍), 이모지로 보이라는 표시를
 * 달고 있는 글자(❤️ = ❤ + U+FE0F), 나라 글자 두 개로 된 깃발(🇰🇷),
 * 그리고 키캡(1️⃣의 U+20E3).
 */
function isEmoji(g: string): boolean {
    return /\p{Emoji_Presentation}/u.test(g)
        || g.includes('️')
        || /\p{Regional_Indicator}/u.test(g)
        || g.includes('⃣');
}

/**
 * 크게 그릴 글인가.
 *
 * **글자 하나가 코드 하나가 아니다.** `👨‍👩‍👧`는 사람 셋을 이음표로 묶은
 * 것이고 `👍🏽`은 손에 살색이 붙은 것이라, 문자열 길이로 세면 하나짜리도
 * 여럿으로 보인다. `Intl.Segmenter`로 **눈에 보이는 덩어리** 단위로 센다.
 * 그게 없는 낡은 기기에서는 크게 하지 않고 평소대로 그린다 — 못 알아보는
 * 쪽으로 틀려야 화면이 안 망가진다.
 */
export function emojiOnly(text: string): boolean {
    const s = text.replace(/\s/g, '');
    if (!s) return false;
    if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return false;

    let n = 0;
    for (const { segment } of new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(s)) {
        if (++n > MAX || !isEmoji(segment)) return false;
    }
    return n > 0;
}
