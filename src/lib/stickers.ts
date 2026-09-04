/**
 * 이모티콘(스티커).
 *
 * **그림은 `public/stickers/`에 있고 GitHub Pages가 그대로 내준다.**
 * Supabase Storage에 올리지 않는다 — 백예순 장을 거기 두면 무료 통신량
 * (월 5GB)을 대화 사진과 나눠 쓰게 되는데, 이건 회원이 올린 것이 아니라
 * 앱에 딸린 붙박이 그림이라 저장소에 두는 것이 맞다.
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
 * 백예순 장을 한 줄로 늘어놓으면 아래쪽 것은 아무도 못 본다. 카톡이
 * 이모티콘 '세트'마다 탭을 두는 것과 같은 방식이라, 여기 묶음도
 * **그림이 나온 세트**를 따른다 — 뜻으로 나누면 `화이팅!`이 어느 탭에
 * 있는지를 매번 헷갈린다.
 * **묶음의 차례가 곧 탭의 차례다.** **움직이는 것이 맨 앞이고** 그다음이
 * 앱의 주제인 골프다 — 움직이는 것이 눈에 제일 잘 띄어서 앞에 둔다.
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

const g = (id: string, tab: string, name: string, ...stickers: Sticker[]): StickerGroup =>
    ({ id, tab, name, stickers });
const s = (id: string, label: string): Sticker => ({ id, label });
/** 움직이는 것. **id가 `mv`로 시작해야 `.webp`로 찾는다**(`ANIM_PREFIX`). */
const a = (id: string, label: string): Sticker => ({ id, label });

export const STICKER_GROUPS: StickerGroup[] = [
    /* 움직이는 것 — 영상에서 잘라 만든 것들이다. 맨 앞에 두어야 눈에 띈다.
       **묶음 안에서 세트 차례를 지킨다** — 앞이 골프공(앱 아이콘의 그 얼굴),
       뒤가 하얀 뭉치다. 섞어 두면 같은 말이 두 번 나올 때 헷갈린다. */
    g('move', '✨', '움직임',
        a('mvfighting', '화이팅! (골프공)'),
        a('mvbest', '최고야!'),
        a('mvniceshot', '나이스 샷!'),
        a('mvmanse', '만세!'),
        a('mvseeyou', '다음에 봐요'),
        a('mvfighting2', '화이팅!'),
        a('mvhi', '안녕~'),
        a('mvthanks', '감사해요'),
        a('mvogu', '오구오구'),
        a('mvfun', '신나!'),
        a('mvsorry', '미안해요'),
        a('mvsob', '흑흑~ 흑흑'),
        a('mvupset', '눈물 속상해'),
    ),
    /* 골프 — 이 앱의 주제라 그다음이다. 골프공 한 벌과 사람 한 벌이 같이 있다. */
    g('golf', '⛳', '골프',
        s('ballhi', '안녕!'),
        s('ballcall', 'OK 콜!'),
        s('ballfighting', '파이팅!'),
        s('ballniceshot', '나이스 샷!'),
        s('ballbest', '최고야!'),
        s('ballkkkk', 'ㅋㅋㅋㅋ'),
        s('ballsorry', '미안…'),
        s('ballsad', '미안… (눈물)'),
        s('ballheart', '사랑해♥'),
        s('ballgo', '가자!'),
        s('ballangry', '에잇!'),
        s('ballwait', '잠깐'),
        s('ballhard', '어려워…'),
        s('niceshot2', '나이스 샷! (공)'),
        s('call2', '콜!'),
        s('together', '같이 가요!'),
        s('whenwego', '언제 가요?'),
        s('congrats', '축하해!'),
        s('hwaiting', '화이팅!'),
        s('thanks', '감사합니다'),
        s('thanks2', '감사합니다 (윙크)'),
        s('kkkk2', 'ㅋㅋㅋㅋ (공)'),
        s('putting', '이 퍼팅만…'),
        s('whymiss', '왜 안 맞아!'),
        s('whymiss2', '왜 안 맞아! (버럭)'),
        s('bunker', '벙커에…'),
        s('bunker2', '벙커에… (한숨)'),
        s('sleepy', '졸려…'),
        s('kkakkung', '까꿍!'),
        s('carpool', '카풀 구해요'),
        s('treasurer', '총무님 최고!'),
        s('ssangthumb', '쌍따봉!'),
        s('notice', '공지 확인 필수!'),
        s('mulligan', '멀리건 굽신굽신'),
        s('bigdrive', '장타!'),
        s('ohjalgong', '오잘공!'),
        s('shade', '그늘집 고고~'),
        s('jjageol', '짜걸해!'),
        s('mental', '멘탈 바사삭…'),
        s('mental2', '멘탈 바사삭… (그로기)'),
        s('fore', '볼~!!! 조심해'),
        s('lifebest', '라베 달성!'),
        s('escape100', '백돌이 탈출!'),
        s('weatherfairy', '날씨 요정 강림'),
        s('raincancel', '우천 취소 ㅠㅠ'),
        s('soreness', '몸살 예약'),
    ),
    /* 곰돌이 — 말이 적혀 있어 대화에서 가장 자주 쓴다. */
    g('bear', '🐻', '곰돌이',
        s('bearhi', '안녕!'),
        s('bearthanks', '고마워!'),
        s('bearlove', '사랑해'),
        s('bearfight', '화이팅! (불꽃)'),
        s('bearfight2', '화이팅!'),
        s('bearyum', '맛있어!'),
        s('bearyum2', '맛있어! (밥)'),
        s('beargood', '좋아!'),
        s('bearokay', '괜찮아'),
        s('bearcongrats', '축하해!'),
        s('bearpromise', '약속!'),
        s('beargo', '나가자!'),
        s('bearbusy', '바빠!'),
        s('bearwait', '기다려'),
        s('bearcurious', '궁금해'),
        s('bearomg', '깜짝이야'),
        s('beargasp', '헉!'),
        s('bearcareful', '조심해'),
        s('bearsorry', '미안해'),
        s('bearupset', '속상해'),
        s('beardown', '우울해'),
        s('beartired', '피곤해'),
        s('bearmad', '화나!'),
        s('bearangry', '짜증나'),
    ),
    /* 동물 — 곰돌이와 같은 말인데 그림만 여러 동물이다. */
    g('zoo', '🦊', '동물',
        s('zoohi', '안녕!'),
        s('zoothanks', '고마워!'),
        s('zoolove', '사랑해'),
        s('zoofight', '화이팅! (사자)'),
        s('zoofight2', '화이팅! (여우)'),
        s('zooyum', '맛있어!'),
        s('zoohungry', '배고파'),
        s('zooook', '알았어!'),
        s('zoopromise', '약속!'),
        s('zoogo', '나가자!'),
        s('zoobusy', '바빠!'),
        s('zoowait', '기다려'),
        s('zoocurious', '궁금해'),
        s('zooomg', '깜짝이야'),
        s('zoogasp', '헉!'),
        s('zoocareful', '조심해'),
        s('zoosorry', '미안해'),
        s('zoosorry2', '미안해 (양)'),
        s('zooupset', '속상해'),
        s('zoodown', '우울해'),
        s('zootired', '피곤해'),
        s('zoomad', '화나!'),
        s('zooangry', '짜증나'),
        s('zoonight', '잘 자!'),
    ),
    /* 코알라 — 먼저 있던 한 벌이다. */
    g('koala', '🐨', '코알라',
        s('annyeong', '안녕!'),
        s('haengbok', '행복해!'),
        s('saranghae', '사랑해!'),
        s('saranghae2', '사랑해! (윙크)'),
        s('kkkk', 'ㅋㅋㅋㅋ'),
        s('fighting', '파이팅!'),
        s('fighting2', '파이팅! (경례)'),
        s('heol', '헐!'),
        s('heukheuk', '흑흑…'),
        s('euaak', '으아악!'),
        s('eotteokhaji', '어떡하지?'),
        s('maijjeong', '마이쩡!'),
        s('andwae', '안돼!'),
        s('sujubda', '수줍어요…'),
        s('chukha', '축하해!'),
        s('chukha2', '축하해! (폭죽)'),
        s('wanryo', '완료!'),
        s('mwohae', '뭐해?'),
    ),
    /* 표정·맞장구 — 말이 없거나 짧은 것들. */
    g('face', '😀', '표정',
        s('call', '콜!'),
        s('gazua', '가즈아!'),
        s('goodshot', '굿샷!'),
        s('thumbsup', '엄지척'),
        s('chickenno', '싫어요'),
        s('hi', '하이'),
        s('hmm', '음…?'),
        s('manse', '만세'),
        s('manse2', '만세!'),
        s('firehero', '불타는 의지'),
        s('mangsse', '아… 망해따'),
        s('cake', '케이크'),
        s('star', '별'),
        s('fox', '여우'),
        s('foxsweat', '진땀 여우'),
        s('panda', '판다'),
        s('penguin', '펭귄 엄지'),
        s('cloudlove', '하트 구름'),
        s('catshock', '놀란 고양이'),
        s('koalarain', '비 맞는 코알라'),
        s('koalasulk', '뿌루퉁 코알라'),
        s('hamster', '응원 햄스터'),
        s('owl', '부엉이'),
        s('sloth', '나무늘보'),
        s('beaver', '노트북 비버'),
        s('dogwow', '놀란 강아지'),
        s('birdidea', '아이디어 새'),
        s('ghost', '유령'),
        s('robot', '로봇'),
        s('mushroomcry', '우는 버섯'),
        s('mushroomsad', '시무룩 버섯'),
        s('bearstretch', '기지개 곰'),
    ),
    /* 아침·밤 — 인사와 잘 자요. */
    g('night', '🌙', '아침·밤',
        s('goodmorning', '좋은 아침!'),
        s('wakeup', '기상!'),
        s('yawn', '하암~'),
        s('goodnight', '굿나잇!'),
        s('sleepwell', '잘 자요!'),
        s('cloudzzz', '쿨쿨 구름'),
        s('bearsleep', '자는 곰'),
        s('bearnap', '낮잠 곰'),
        s('penguinsleep', '자는 펭귄'),
        s('penguinnight', '밤하늘 펭귄'),
        s('owlnight', '밤 부엉이'),
    ),
    /* 먹을 것. */
    g('food', '🍔', '먹을 것',
        s('coffee', '커피'),
        s('burger', '햄버거'),
        s('donut', '도넛'),
        s('apple', '사과'),
        s('toast', '아침밥'),
        s('toastsmile', '아침밥 (웃음)'),
    ),
];

/**
 * 이모티콘 한 벌을 펼친 것. **묶음을 이어 붙인 값이라 차례가 곧 그 차례다.**
 * 이름을 찾는 데 쓰이므로 묶음이 늘어도 이 값만 보면 된다.
 */
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
