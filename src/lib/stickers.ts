/**
 * 이모티콘(스티커).
 *
 * 넣는 방법은 아래 세 걸음이 전부다:
 *
 * 1. 그림을 `public/stickers/<id>.png`로 넣는다(**배경은 투명**, 256px 정사각,
 *    팔레트 PNG로 20KB 안쪽). 움직이는 것은 `.webp`이고 **id가 `mv`로
 *    시작해야 한다**(`ANIM_PREFIX`).
 * 2. 아래 `STICKER_GROUPS`에 묶음과 함께 적는다 — `s('id', '이름')`,
 *    움직이는 것은 `a('mvid', '이름')`.
 * 3. `.dev/fixtures.mjs`의 대화에 그 id를 하나 넣어 두면 `node .dev/behave.mjs`가
 *    서랍과 말풍선을 함께 확인한다.
 *
 * **거르는 잣대는 배경이 투명한가 하나뿐이다**(사용자 요청).
 * 사용자가 먼저 하나씩 보고 고른 것들이므로 **주는 것을 임의로 빼지 말 것** —
 * 글자가 한글이 아니어도 그대로 넣는다. 눈에 걸리는 것(배경이 안 지워졌다,
 * 남의 상표가 보인다)은 **빼지 말고 넣기 전에 한 줄로 알려** 사용자가
 * 정하게 한다.
 *
 * **한 장도 없으면 입력칸의 이모티콘 단추가 아예 안 나온다**(Chat.tsx) —
 * 눌러 봐야 빈 서랍이 열릴 뿐이라 그 자리를 비워 두는 것이 맞다.
 * **예전 글에 남은 `sticker:` 값은 그대로 둔다** — 그림이 없어졌으므로
 * 말풍선 자리에 `이모티콘`이라고 적힌 작은 조각으로 그려진다.
 *
 * **그림은 `public/stickers/`에 있고 GitHub Pages가 그대로 내준다.**
 * Supabase Storage에 올리지 않는다 — 회원이 올린 것이 아니라 앱에 딸린
 * 붙박이 그림이라, 무료 통신량(월 5GB)을 대화 사진과 나눠 쓸 이유가 없다.
 *
 * **글에 붙는 값은 `sticker:<id>`다.** 주소를 그대로 넣지 않는 것은,
 * 나중에 그림을 다시 만들거나 자리를 옮겨도 예전 글이 안 깨지게 하려는
 * 것이다 — 주소는 `stickerSrc()`가 그때그때 만든다.
 *
 * **DB에 칸을 새로 만들지 않았다.** 사진이 쓰던 `messages.image_url`을
 * 같이 쓴다(`sticker:`로 시작하면 이모티콘). 사용자가 손으로 붙여넣어야
 * 하는 SQL이 늘지 않고, 스키마를 아직 안 돌린 저장소에서도 사진과 똑같이
 * 동작한다.
 *
 * **묶음(카테고리)이 곧 서랍의 탭이다**(사용자 요청 — 카카오톡처럼).
 * 백 장이 넘어가면 한 줄로 늘어놓았을 때 아래쪽 것은 아무도 못 본다.
 * 카톡이 이모티콘 '세트'마다 탭을 두는 것과 같은 방식이라, 여기 묶음도
 * **그림이 나온 세트**를 따른다 — 뜻으로 나누면 `화이팅!`이 어느 탭에
 * 있는지를 매번 헷갈린다. **묶음의 차례가 곧 탭의 차례다.**
 */

export const STICKER_MARK = 'sticker:';

/**
 * 이모티콘 한 장. 글에 남는 값은 `sticker:<id>` 하나뿐이고 **주소는
 * `stickerSrc()`가 그때그때 만든다** — 나중에 그림을 다시 만들거나 형식을
 * 바꿔도 예전 글이 안 깨진다.
 */
export type Sticker = { id: string; label: string };

/**
 * 움직이는 이모티콘의 id 머리글자.
 *
 * **파일 확장자를 이걸로 정한다**(`stickerSrc`) — 목록에서 찾으면 그 판이
 * 모르는 id에서 깨지기 때문이다. 그래서 **움직이는 것은 id가 반드시
 * `mv`로 시작해야 하고, 그 밖의 것은 `mv`로 시작하면 안 된다.**
 */
export const ANIM_PREFIX = 'mv';

/**
 * 이모티콘 묶음. `tab`은 탭에 그릴 그림글자 하나, `name`은 그 탭의 이름
 * (소리로 읽히는 값이자 눌린 탭 아래에 적히는 말)이다.
 */
export type StickerGroup = { id: string; tab: string; name: string; stickers: Sticker[] };

/** 묶음 하나. `g('golf', '⛳', '골프', s('ballhi', '안녕!'), …) */
export const g = (id: string, tab: string, name: string, ...stickers: Sticker[]): StickerGroup =>
    ({ id, tab, name, stickers });
/** 한 장. 파일은 `public/stickers/<id>.png`(배경 투명). */
export const s = (id: string, label: string): Sticker => ({ id, label });
/** 움직이는 것. **id가 `mv`로 시작해야 `.webp`로 찾는다**(`ANIM_PREFIX`). */
export const a = (id: string, label: string): Sticker => ({ id, label });

/**
 * 묶음 목록.
 *
 * 지금은 **움직이는 것 열둘**이고 한 묶음이다. 사용자가 준 영상 두 편에서
 * 배경이 투명한(체커 무늬로 그려진) 장면만 골라 잘랐다 — 파스텔 바탕이
 * 깔린 장면은 규칙대로 뺐다. **차례는 영상에 나온 차례 그대로다.**
 */
export const STICKER_GROUPS: StickerGroup[] = [
    g('mv', '✨', '움직임',
      a('mvkkk', 'ㅋㅋㅋ'), a('mvtears', '절망'), a('mvyum', '우물우물'),
      a('mvshy', '부끄부끄'), a('mvzzz', '쿨쿨'), a('mvshock', '헉!'),
      a('mvtyping', '타다닥'), a('mvfighting', '화이팅!'), a('mvogu', '오구오구'),
      a('mvyay', '신나!'), a('mvsob', '훌쩍훌쩍'), a('mvcry', '흑흑')),
];

export const STICKERS: Sticker[] = STICKER_GROUPS.flatMap(x => x.stickers);

const BY_ID = new Map(STICKERS.map(x => [x.id, x]));

/** `sticker:안녕` 꼴인가. 사진과 가르는 잣대는 이것 하나다. */
export const isSticker = (url: string | null | undefined): boolean =>
    typeof url === 'string' && url.startsWith(STICKER_MARK);

/** 글에 남길 값. */
export const stickerRef = (id: string): string => STICKER_MARK + id;

/**
 * 그림 주소. **`import.meta.env.BASE_URL`을 거친다** — `vite.config.ts`가
 * `base: './'`라 저장소 이름이 붙은 주소에서도 맞게 풀린다.
 */
export const stickerSrc = (ref: string): string => {
    const id = ref.slice(STICKER_MARK.length);
    // **id의 머리글자로 가른다 — 목록(`BY_ID`)을 보지 않는다.**
    // 목록을 보면 **그 판이 모르는 id에서 깨진다**: 남이 새 이모티콘을
    // 보냈는데 받는 사람 폰이 아직 옛 묶음을 들고 있으면(GitHub Pages가
    // index.html을 10분쯤 물고 있어 흔한 일이다) `.png`로 찾아 404가 나고
    // 그림 자리에 `이모티콘`이라고만 떴다. 머리글자는 글에 남는 값이라
    // 판이 달라도 같게 풀린다.
    // **그래도 `.png`를 함께 둔다** — 이 고침이 닿기 전의 판은 여전히
    // 목록을 보므로, 움직이는 것도 `<id>.png` 한 장이 있어야 안 깨진다.
    const ext = id.startsWith(ANIM_PREFIX) ? 'webp' : 'png';
    return `${import.meta.env.BASE_URL}stickers/${id}.${ext}`;
};

/**
 * 이름. 인용줄과 대체 텍스트에 쓴다.
 *
 * **모르는 id도 그냥 넘긴다** — 그림을 지운 뒤에도 예전 글이 열려야 한다.
 * (그때는 그림만 안 뜨고 `이모티콘`이라고 적힌다.)
 */
export const stickerLabel = (ref: string): string =>
    BY_ID.get(ref.slice(STICKER_MARK.length))?.label ?? '이모티콘';
