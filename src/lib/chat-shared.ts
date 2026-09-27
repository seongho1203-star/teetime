import { STICKER_GROUPS, stickerSrc } from './stickers';
import { SUGGEST_MAX, SUGGEST_ANIM } from './suggest';
import { REACTIONS } from './types';

/**
 * **대화 화면이 쓰는 규칙 셋을 한 꾸러미로** — 반응 그림글자 · 이모티콘 목록 ·
 * 추천 한도. 원본은 웹 한 곳이다(`REACTIONS` · `lib/stickers.ts` ·
 * `lib/suggest.ts`) — 앱(Swift·Kotlin)에 또 적으면 두 벌이 되어 언젠가
 * 어긋난다. **추천 말 자체는 DB(`sticker_words`)에 있고 앱이 스스로 받는다.**
 *
 * 부르는 곳이 둘이다:
 *  - 아이폰 — 대화를 열 때(`screens/NativeChat.tsx` → `NativeChat.open`).
 *  - 안드로이드 — 코틀린 홈이 대화를 직접 세우므로 **홈을 열 때 한 번**
 *    (`NativeApp.open`)에 같은 이름으로 실어 보낸다. 코틀린은 그 값을
 *    `ChatConfig`에 그대로 넘긴다.
 *
 * **이름을 바꾸지 말 것** — 두 앱이 이 키 이름으로 읽는다. 더할 때는 더하기만 한다.
 * 이모티콘의 `src`는 웹뷰 기준 주소라 안드로이드는 쓰지 않고 `id`로 제 자리
 * (`file:///android_asset/public/stickers/`)를 만든다.
 */
export function chatShared(): Record<string, unknown> {
    return {
        reactions: REACTIONS,
        stickers: STICKER_GROUPS.map(g => ({ ...g, stickers: g.stickers.map(s => ({ ...s,
            src: new URL(stickerSrc(`sticker:${s.id}`), window.location.href).href })) })),
        /* **추천 말은 이제 앱이 DB(`sticker_words`)에서 스스로 받는다** —
           앱관리자가 고치면 앱을 새로 안 깔아도 바로 먹어야 하기 때문이다.
           이름은 옛 판이 읽으므로 빈 채로 남겨 둔다. */
        suggest: [],
        suggestMax: SUGGEST_MAX,
        suggestAnim: SUGGEST_ANIM,
    };
}
