/**
 * 이모티콘(스티커).
 *
 * **그림은 `public/stickers/`에 있고 GitHub Pages가 그대로 내준다.**
 * Supabase Storage에 올리지 않는다 — 예순일곱 장을 거기 두면 무료 통신량
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
 */

export const STICKER_MARK = 'sticker:';

export type Sticker = { id: string; label: string };

/** 이모티콘 한 벌. 화면의 순서가 곧 이 차례다 — 자주 쓸 것을 앞에 둔다. */
export const STICKERS: Sticker[] = [
    // 골프공 — 이 앱의 주제라 맨 앞에 둔다.
    { id: 'ballhi', label: '안녕!' },
    { id: 'ballcall', label: 'OK 콜!' },
    { id: 'ballfighting', label: '파이팅!' },
    { id: 'ballniceshot', label: '나이스 샷!' },
    { id: 'ballbest', label: '최고야!' },
    { id: 'ballkkkk', label: 'ㅋㅋㅋㅋ' },
    { id: 'ballsorry', label: '미안…' },
    { id: 'ballsad', label: '미안… (눈물)' },
    { id: 'ballheart', label: '사랑해♥' },
    { id: 'ballgo', label: '가자!' },
    { id: 'ballangry', label: '에잇!' },
    { id: 'ballwait', label: '잠깐' },
    { id: 'ballhard', label: '어려워…' },
    { id: 'niceshot2', label: '나이스 샷!' },
    { id: 'call2', label: '콜!' },
    { id: 'together', label: '같이 가요!' },
    { id: 'whenwego', label: '언제 가요?' },
    { id: 'congrats', label: '축하해!' },
    { id: 'hwaiting', label: '화이팅!' },
    { id: 'thanks', label: '감사합니다' },
    { id: 'thanks2', label: '감사합니다 (윙크)' },
    { id: 'kkkk2', label: 'ㅋㅋㅋㅋ' },
    { id: 'putting', label: '이 퍼팅만…' },
    { id: 'whymiss', label: '왜 안 맞아!' },
    { id: 'whymiss2', label: '왜 안 맞아! (버럭)' },
    { id: 'bunker', label: '벙커에…' },
    { id: 'bunker2', label: '벙커에… (한숨)' },
    { id: 'sleepy', label: '졸려…' },

    // 코알라 — 말이 적힌 것이라 가장 자주 쓴다.
    { id: 'annyeong', label: '안녕!' },
    { id: 'haengbok', label: '행복해!' },
    { id: 'saranghae', label: '사랑해!' },
    { id: 'saranghae2', label: '사랑해! (윙크)' },
    { id: 'kkkk', label: 'ㅋㅋㅋㅋ' },
    { id: 'fighting', label: '파이팅!' },
    { id: 'fighting2', label: '파이팅! (경례)' },
    { id: 'heol', label: '헐!' },
    { id: 'heukheuk', label: '흑흑…' },
    { id: 'euaak', label: '으아악!' },
    { id: 'eotteokhaji', label: '어떡하지?' },
    { id: 'maijjeong', label: '마이쩡!' },
    { id: 'andwae', label: '안돼!' },
    { id: 'sujubda', label: '수줍어요…' },
    { id: 'chukha', label: '축하해!' },
    { id: 'chukha2', label: '축하해! (폭죽)' },
    { id: 'wanryo', label: '완료!' },
    { id: 'mwohae', label: '뭐해?' },

    // 대답·맞장구
    { id: 'call', label: '콜!' },
    { id: 'gazua', label: '가즈아!' },
    { id: 'goodshot', label: '굿샷!' },
    { id: 'thumbsup', label: '엄지척' },
    { id: 'chickenno', label: '싫어요' },
    { id: 'hi', label: '하이' },
    { id: 'hmm', label: '음…?' },
    { id: 'manse', label: '만세' },
    { id: 'manse2', label: '만세!' },
    { id: 'firehero', label: '불타는 의지' },
    { id: 'mangsse', label: '아… 망해따' },
    { id: 'cake', label: '케이크' },

    // 표정
    { id: 'star', label: '별' },
    { id: 'fox', label: '여우' },
    { id: 'foxsweat', label: '진땀 여우' },
    { id: 'panda', label: '판다' },
    { id: 'penguin', label: '펭귄 엄지' },
    { id: 'cloudlove', label: '하트 구름' },
    { id: 'catshock', label: '놀란 고양이' },
    { id: 'koalarain', label: '비 맞는 코알라' },
    { id: 'koalasulk', label: '뿌루퉁 코알라' },
    { id: 'hamster', label: '응원 햄스터' },
    { id: 'owl', label: '부엉이' },
    { id: 'sloth', label: '나무늘보' },
    { id: 'beaver', label: '노트북 비버' },
    { id: 'dogwow', label: '놀란 강아지' },
    { id: 'birdidea', label: '아이디어 새' },
    { id: 'ghost', label: '유령' },
    { id: 'robot', label: '로봇' },
    { id: 'mushroomcry', label: '우는 버섯' },
    { id: 'mushroomsad', label: '시무룩 버섯' },
    { id: 'bearstretch', label: '기지개 곰' },

    // 먹을 것
    { id: 'coffee', label: '커피' },
    { id: 'burger', label: '햄버거' },
    { id: 'donut', label: '도넛' },
    { id: 'apple', label: '사과' },
    { id: 'toast', label: '아침밥' },
    { id: 'toastsmile', label: '아침밥 (웃음)' },

    // 아침·밤
    { id: 'goodmorning', label: '좋은 아침!' },
    { id: 'wakeup', label: '기상!' },
    { id: 'yawn', label: '하암~' },
    { id: 'goodnight', label: '굿나잇!' },
    { id: 'sleepwell', label: '잘 자요!' },
    { id: 'cloudzzz', label: '쿨쿨 구름' },
    { id: 'bearsleep', label: '자는 곰' },
    { id: 'bearnap', label: '낮잠 곰' },
    { id: 'penguinsleep', label: '자는 펭귄' },
    { id: 'penguinnight', label: '밤하늘 펭귄' },
    { id: 'owlnight', label: '밤 부엉이' },
];

const BY_ID = new Map(STICKERS.map(s => [s.id, s]));

/** `sticker:안녕` 꼴인가. 사진과 가르는 잣대는 이것 하나다. */
export const isSticker = (url: string | null | undefined): boolean =>
    typeof url === 'string' && url.startsWith(STICKER_MARK);

/** 글에 남길 값. */
export const stickerRef = (id: string): string => STICKER_MARK + id;

/**
 * 그림 주소. **`import.meta.env.BASE_URL`을 거친다** — `vite.config.ts`가
 * `base: './'`라 저장소 이름이 붙은 주소에서도 맞게 풀린다.
 */
export const stickerSrc = (ref: string): string =>
    `${import.meta.env.BASE_URL}stickers/${ref.slice(STICKER_MARK.length)}.png`;

/**
 * 이름. 인용줄과 대체 텍스트에 쓴다.
 *
 * **모르는 id도 그냥 넘긴다** — 그림을 지운 뒤에도 예전 글이 열려야 한다.
 * (그때는 그림만 안 뜨고 `이모티콘`이라고 적힌다.)
 */
export const stickerLabel = (ref: string): string =>
    BY_ID.get(ref.slice(STICKER_MARK.length))?.label ?? '이모티콘';
