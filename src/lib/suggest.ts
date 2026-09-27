/**
 * 치는 글에 어울리는 이모티콘을 골라 준다 — 카톡의 그 줄이다.
 *
 * 사용자 요청 — `카톡처럼 메시지에 따라 이모티콘이 뜨는기능을 만들자.
 * 굿모닝하면 관련 이모티콘이뜨는거말이야`.
 *
 * **어떤 말에 어떤 이모티콘이 뜨는지는 DB의 `sticker_words` 표가 정한다**
 * (사용자 요청 — `이걸 내가 수동으로 입력해서 지정하고싶은데 … 차후
 * 이모티콘을 추가할때도 내가 입력하고싶어` · `자동 추천 전부 끄기`).
 * 앱관리자가 대화의 이모티콘 서랍에서 그림을 **길게 눌러** 말을 적는다.
 * 그래서 **앱을 새로 안 깔아도 바로 먹는다.**
 *
 * 이 파일에 남은 것은 **깎는 자(`norm`)와 고르는 차례**뿐이다. 앱(Swift·
 * Kotlin)은 그 표를 스스로 받아 오고, 깎는 자만 한 벌씩 들고 있다 —
 * **한쪽만 고치지 말 것.**
 *
 * **고르면 곧바로 안 나간다** — 이모티콘 서랍에서 고른 것과 똑같이 입력칸
 * 위에 미리보기로 물려 두고, 글을 마저 적어 한 마디로 함께 보낸다.
 */
/* **여기만 `.ts`를 붙여 부른다** — `node --experimental-strip-types`로 도는
   `.dev/suggest-check.mts`가 확장자 없이는 못 찾는다(tsconfig의
   `allowImportingTsExtensions`라 타입 검사도 Vite도 그대로 돈다). */
import { STICKERS, ANIM_PREFIX, type Sticker } from './stickers.ts';

/** 몇 장까지 내놓나. 줄이 옆으로 굴러가므로 여덟이면 넉넉하다. */
export const SUGGEST_MAX = 8;

/**
 * 그 가운데 움직이는 것은 몇 장까지.
 *
 * **여덟 장을 다 움직이는 것으로 채우면 안 된다.** 움직이는 한 장이
 * 평균 105KB에 열두 프레임이라(멈춘 것은 7KB) 글자를 칠 때마다 줄이
 * 갈리는 자리에서 폰이 그대로 주저앉는다 — `미리 받아 두기`가 움직이는
 * 것만 여섯 장으로 묶어 둔 그 까닭과 같다.
 *
 * **둘에서 넷으로 올렸다** — 말을 사람이 직접 고르게 되면서, 고른 움짤이
 * 셋째부터 조용히 빠지면 `왜 안 뜨지`가 된다. 넷이면 한 말에 두세 장씩
 * 다는 쓰임새를 다 덮고, 움직이는 것만 여덟을 다는 일은 드물다.
 * **앱도 이 값을 받아 쓴다**(`chatShared()`의 `suggestAnim`).
 */
export const SUGGEST_ANIM = 4;

/**
 * 몇 글자부터 보나. **한 글자로는 안 본다** — `ㅋ` 하나에 줄이 뜨면
 * 치는 내내 말풍선 한 줄이 가려진다(폭죽 단추와 같은 사정이다).
 */
export const SUGGEST_MIN = 2;

/**
 * 견줄 때 지우는 것들 — 공백과 문장부호다.
 *
 * 이모티콘 이름에는 `화이팅!`·`안녕~`처럼 꼬리가 붙어 있고 사람이 칠 때는
 * 안 붙이므로, **양쪽을 같은 자로 깎아** 견준다.
 *
 * **물음표(`?`)만은 남긴다**(사용자 요청 — `응? 엥? 뭐? → 응?·엥?·뭐?·
 * 어쩌라고?`). `응`·`엥`·`뭐`는 한 글자라 그대로는 말로 못 넣고(`응원`·
 * `뭐해`에 다 걸린다), 물음표가 붙어야 그 뜻이 된다. 전각 `？`는 `?`로 본다. **앱의 `normalize`도 같다**(`NativeChatViewController`) —
 * 한쪽만 고치면 `응?`이 웹에서만 걸린다.
 */
export const norm = (s: string): string =>
    s.replace(/？/g, '?').replace(/[\s!~.,…'"“”()·:;\-_/]/g, '').toLowerCase();

/** 이모티콘 이름을 견줄 수 있는 꼴로. `커피 한 잔` → `커피한잔` */
export const labelKey = (label: string): string => norm(label);

/** 앱에 실어 보내는 꼴 — 말 하나에 이모티콘 여럿이다. */
export type SuggestRule = { words: string[]; ids: string[] };

/** DB 한 줄(`sticker_words`) — 이모티콘 하나에 말 하나. */
export type StickerWordRow = { sticker_id: string; word: string };

/**
 * DB의 줄들을 규칙으로 묶는다 — **같은 말끼리 모은다.**
 *
 * **규칙은 이제 이 표뿐이다**(사용자 요청 — `이걸 내가 수동으로 입력해서
 * 지정하고싶은데` · `자동 추천 전부 끄기`). 예전에는 이 파일에 박힌 표가
 * 이모티콘 이름으로 짐작해 골랐는데 엉뚱한 것이 자주 걸렸다 — **이름으로
 * 짐작하는 길을 되살리지 말 것.** 앱관리자가 서랍에서 이모티콘을 길게
 * 눌러 적은 말만 걸린다.
 *
 * 말은 DB에 깎아 둔 꼴로 들어 있지만 **여기서 한 번 더 깎는다** — 손으로
 * SQL로 넣은 줄이 깎이지 않은 채 들어와도 걸리게 하려는 것이다.
 * **없는 이모티콘 id는 그냥 둔다** — 목록을 훑을 때 저절로 빠진다.
 */
export const buildRules = (rows: StickerWordRow[]): SuggestRule[] => {
    const byWord = new Map<string, string[]>();
    for (const r of rows) {
        const w = norm(r.word ?? '');
        if (w.length < SUGGEST_MIN || !r.sticker_id) continue;
        const list = byWord.get(w);
        if (!list) byWord.set(w, [r.sticker_id]);
        else if (!list.includes(r.sticker_id)) list.push(r.sticker_id);
    }
    return [...byWord].map(([w, ids]) => ({ words: [w], ids }));
};

/** 앱관리자가 적은 말을 넣기 좋은 꼴로 — 쉼표·줄바꿈으로 나누고 깎는다. */
export const splitWords = (text: string): string[] => {
    const out: string[] = [];
    for (const part of text.split(/[,，\n]/)) {
        const w = norm(part);
        if (w.length >= SUGGEST_MIN && w.length <= 20 && !out.includes(w)) out.push(w);
    }
    return out;
};

/**
 * 치는 글에 어울리는 이모티콘 — **이모티콘 목록 차례 그대로** 돌려준다.
 *
 * 차례가 곧 묶음 차례라 **움직이는 것이 맨 앞에 선다**(`STICKER_GROUPS`).
 * 앱도 같은 차례를 쓰므로 웹과 앱이 같은 줄을 보여 준다 —
 * **한쪽만 고치지 말 것.**
 */
export const suggestFor = (draft: string, rules: SuggestRule[]): Sticker[] => {
    if (!rules.length) return [];
    const text = norm(draft);
    if (text.length < SUGGEST_MIN) return [];
    const hit = new Set<string>();
    for (const rule of rules) {
        if (rule.words.some(w => text.includes(w))) for (const id of rule.ids) hit.add(id);
    }
    if (!hit.size) return [];
    const out: Sticker[] = [];
    let anim = 0;
    for (const s of STICKERS) {
        if (!hit.has(s.id)) continue;
        if (s.id.startsWith(ANIM_PREFIX)) {
            if (anim >= SUGGEST_ANIM) continue;
            anim++;
        }
        out.push(s);
        if (out.length >= SUGGEST_MAX) break;
    }
    return out;
};
