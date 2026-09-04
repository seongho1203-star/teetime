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

/** 묶음 하나. `g('golf', '⛳', '골프공', s('gday', '까꿍day'), …) */
export const g = (id: string, tab: string, name: string, ...stickers: Sticker[]): StickerGroup =>
    ({ id, tab, name, stickers });
/** 한 장. 파일은 `public/stickers/<id>.png`(배경 투명). */
export const s = (id: string, label: string): Sticker => ({ id, label });
/** 움직이는 것. **id가 `mv`로 시작해야 `.webp`로 찾는다**(`ANIM_PREFIX`). */
export const a = (id: string, label: string): Sticker => ({ id, label });

/**
 * 묶음 목록.
 *
 * 여덟 묶음이다 — 움직이는 것 열여덟(영상에서 잘랐다. 배경이 투명한 장면만
 * 골랐다), 골프공(앱 아이콘과 같은 캐릭터) 스물일곱, 골퍼 스물넷,
 * 골프친구 스물넷, 펭귄골프 스물둘, 펭귄 스물여덟, 고양이 스물넷,
 * 이모지 열여덟. **차례는 원본에 나온 차례 그대로다.**
 */
export const STICKER_GROUPS: StickerGroup[] = [
    g('mv', '✨', '움직임',
      a('mvkkk', 'ㅋㅋㅋ'), a('mvtears', '절망'), a('mvyum', '우물우물'),
      a('mvshy', '부끄부끄'), a('mvzzz', '쿨쿨'), a('mvshock', '헉!'),
      a('mvtyping', '타다닥'), a('mvfighting', '화이팅!'), a('mvogu', '오구오구'),
      a('mvyay', '신나!'), a('mvsob', '훌쩍훌쩍'), a('mvcry', '흑흑'),
      /* 갈색 곰 영상에서 잘랐다 — 여섯 장면이 이어져 있고 다 체커(투명) 바탕이다.
         움직이는 것은 **id가 `mv`로 시작해야 한다**(`ANIM_PREFIX`). */
      a('mvblove', '사랑해'), a('mvbfight', '화이팅!'), a('mvbthanks', '감사해요'),
      a('mvbcry', '흑흑흑흑'), a('mvbyay', '신나!'), a('mvbsleep', '졸려')),

    /* 앱 아이콘과 같은 캐릭터다 — 선글라스 낀 골프공. 시트 석 장으로 왔는데
       거의 같은 것이 되풀이돼서, 한 장을 뼈대로 삼고 나머지 둘에서
       **겹치지 않는 것만** 더했다(사용자 요청 — 중복은 뺀다). */
    g('golf', '⛳', '골프공',
      s('gday', '까꿍day'), s('gfight', '화이팅!'), s('ggood', 'Good!'),
      s('gswing', '스윙'), s('gcart', '카트'), s('gheart', '하트'),
      s('gchill', '쉬는 중'), s('gwhat', '뭐해요?'), s('gnice', '나이스!'),
      s('gbeer', '한잔해요!'), s('gsad', '아쉽네요'), s('gzzz', '쿨쿨'),
      s('gbunker', '벙커'), s('gbirdie', '버디!'), s('gshot', '굿샷!'),
      s('gbye', '또봐요~'), s('gthink', '음…'), s('gthanks', '감사합니다'),
      s('ggo', '출발!'), s('ghi', '안녕~'), s('gyay', '신난다!'),
      s('gsplash', '풍덩'), s('gball', '공 사랑'), s('gfinger', '손가락 하트'),
      s('gdizzy', '어질어질'), s('gdrive', '드라이버'), s('grelax', '여유~')),

    /* 같은 골프공이지만 **다른 세트다** — 모자에 `GOLF`가 적히고 남색 셔츠를
       입었다. 위 `골프공`(선글라스)과 그림이 달라 묶음을 따로 두었다. */
    g('gman', '🧢', '골퍼',
      s('gmgood', '좋아요'), s('gmyay', '신난다!'), s('gmputt', '퍼팅'),
      s('gmfinger', '손가락 하트'), s('gmcool', '멋져'), s('gmswing', '스윙'),
      s('gmwin', '우승!'), s('gmnice', '나이스샷!'), s('gmaja', '아자아자'),
      s('gmchill', '여유 한 잔'), s('gmcart', '카트'), s('gmbag', '골프백'),
      s('gmthanks', '감사합니다'), s('gmlove', '하트 눈'), s('gmzzz', '쿨쿨'),
      s('gmrain', '비 와요'), s('gmcry', '엉엉'), s('gmfire', '불타오른다'),
      s('gmsign', 'GOOD!'), s('gmheart', '하트'), s('gmwalk', '출발!'),
      s('gmdone', '해냈다!'), s('gmsorry', '죄송합니다'), s('gmfight', '화이팅!')),

    /* 한 시트에 캐릭터가 여럿 섞여 있다 — 소년·소녀·펭귄·곰·강아지·고양이가
       함께 라운딩한다. 캐릭터가 아니라 **세트**로 묶는 규칙 그대로다. */
    g('gfr', '🐻', '골프친구',
      s('gfswing', '스윙'), s('gfshot', '굿샷!'), s('gfflag', '깃발'),
      s('gfcool', '멋져'), s('gfdash', '달려!'), s('gfnice', '나이스!'),
      s('gfcart', '카트'), s('gfbeer', '한잔해~'), s('gffight', '파이팅!'),
      s('gfheart', '하트'), s('gfchill', '여유~'), s('gfob', '아..OB..'),
      s('gfrun', '물어왔어요'), s('gfhuh', '헉!'), s('gfgo', '다녀올게요~'),
      s('gfmiss', '멋진 스윙'), s('gfball', '공 사랑'), s('gfgood', '좋아요!'),
      s('gfbirdie', '버디!'), s('gfzzz', '쿨쿨'), s('gfv', '브이'),
      s('gfputt', '퍼팅'), s('gfthanks', '수고했어요~'), s('gfsunset', '오늘도 행복')),

    g('pgolf', '🐧', '펭귄골프',
      s('pswing', '스윙'), s('pnice', 'Nice!'), s('pbirdie', 'Birdie!'),
      s('ppar', 'Par!'), s('pbag', '골프백'), s('pready', '설레'),
      s('pbeer', '라운딩 끝!'), s('pcart', '카트'), s('pcourse', '필드'),
      s('pball', '공 자랑'), s('pputt', '퍼팅'), s('pshot', '굿샷!'),
      s('pangry', '뒤땅'), s('pwhat', '어디로?'), s('psun', '더워'),
      s('pzzz', '쿨쿨'), s('pchamp', 'Champion!'), s('pdrive', '드라이버'),
      s('pscore', '스코어 -3'), s('plove', '두근두근'), s('pagain', '다음에 또'),
      s('phole', 'Hole in One!')),

    g('peng', '💙', '펭귄',
      s('pnheart', '하트'), s('pnyay', '신난다'), s('pngood', '좋아요'),
      s('pncheek', '부끄'), s('pnfight', '화이팅!'), s('pnbow', '꾸벅'),
      s('pncoffee', '커피 한 잔'), s('pnsleep', '잘 자'), s('pnpeek', '빼꼼'),
      s('pncry', '엉엉'), s('pnhuh', '헉!'), s('pnflower', '꽃다발'),
      s('pncool', '멋져'), s('pnlove', '하트 눈'), s('pnwink', '윙크'),
      s('pnparty', '축하해'), s('pnfrog', '개구리'), s('pnwork', '일하는 중'),
      s('pnthanks', '감사합니다'), s('pnhide', '쭈뼛'), s('pnangry', '화났어'),
      s('pnrun', '달려'), s('pnpillow', '포근'), s('pnplease', '부탁해'),
      s('pnflop', '뻗음'), s('pnrain', '비 와요'), s('pndj', '신나는 음악'),
      s('pnhi', '안녕~')),

    /* 주황 고양이 한 마리. **노트북 앞에 앉은 것(`ctwork`)에 사과 상표가
       있어 지웠다** — 펭귄(`pnwork`) 때와 같은 자리이고, 사용자가 그때
       `로고만 지워줘`로 정한 방식 그대로다. */
    g('cat', '🐱', '고양이',
      s('ctgood', '좋아요!'), s('ctheart', '하트'), s('ctfight', '화이팅!'),
      s('ctthanks', '감사합니다'), s('ctpeek', '뭐해?'), s('ctcool', '멋져'),
      s('ctzzz', '쿨쿨'), s('ctdino', '어흥!'), s('ctomg', '헉!'),
      s('ctcry', '엉엉'), s('ctlove', '좋아 좋아'), s('ctlovesign', '사랑해요'),
      s('ctyum', '냠냠~'), s('ctwork', '일하는 중'), s('ctchef', '요리 중'),
      s('ctpeekaboo', '까꿍~'), s('cttrip', '여행가자!'), s('ctbath', '목욕 중'),
      s('cthealth', '건강하세요!'), s('ctnight', '잘자요~'), s('ctkkk', 'ㅋㅋㅋㅋ'),
      s('ctsad', '힝…'), s('ctflower', '꽃다발'), s('ctbye', '다녀올게요~')),

    /* 이모지 시트 한 장. 얼굴·손이 대부분이라 뜻으로 나누지 않고 세트째 두었다.
       **시트에는 '움직이는 이모티콘 모음'이라 적혀 있지만 그림은 정지 그림이다** —
       움직이는 것은 영상으로 받아야 만들 수 있다. */
    g('em', '😀', '이모지',
      s('emlol', '빵터짐'), s('emwink', '메롱'), s('emlove', '하트 눈'),
      s('emsob', '엉엉'), s('emcry', '눈물 펑펑'), s('emangry', '화났어'),
      s('emshock', '헉!'), s('emup', '좋아요'), s('embear', '두근두근'),
      s('embear2', '신나는 춤'), s('emzzz', '쿨쿨'), s('emparty', '축하해'),
      s('emhi', '안녕~'), s('emrocket', '출발!'), s('empower', '힘내!'),
      s('emmoney', '돈복'), s('emdown', '별로야'), s('emalien', '외계인')),
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
