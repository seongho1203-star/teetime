/**
 * 치는 글에 어울리는 이모티콘을 골라 준다 — 카톡의 그 줄이다.
 *
 * 사용자 요청 — `카톡처럼 메시지에 따라 이모티콘이 뜨는기능을 만들자.
 * 굿모닝하면 관련 이모티콘이뜨는거말이야`.
 *
 * **글에 아무것도 저장하지 않는다.** `@언급`·링크·축하 폭죽과 같은 결이다 —
 * 치는 글자를 보고 그 자리에서 고르므로 **붙여넣을 SQL도 새 칸도 없고**,
 * 말을 늘리면 이 파일만 고치면 된다.
 *
 * **규칙은 여기 한 곳에 있다 — 앱에 또 적지 말 것.** 앱 대화 화면은
 * `screens/NativeChat.tsx`가 열 때 `suggestTable()`을 그대로 실어 보내고
 * (`ios/App/App/NativeChatViewController.swift`), Swift는 **글자가 들었는지만**
 * 본다. 축하 폭죽(`lib/cheer.ts`)은 말이 셋뿐이라 양쪽에 적어 두었지만
 * 여기는 서른 꼭지에 이백 줄이라 두 벌이 되면 반드시 어긋난다.
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
 * 것만 여섯 장으로 묶어 둔 그 까닭과 같다. 차례가 묶음 차례라 그냥
 * 두면 **앞의 여덟이 전부 움짤**이 된다(`❄️ 펭귄 움짤`이 첫 묶음이다).
 * 헤드리스로 재 보니 줄이 처음 뜨는 글자에서만 65ms가 났다.
 */
export const SUGGEST_ANIM = 2;

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
 */
const norm = (s: string): string =>
    s.replace(/[\s!?~.,…'"“”()·:;\-_/]/g, '').toLowerCase();

/** 이모티콘 이름을 견줄 수 있는 꼴로. `커피 한 잔` → `커피한잔` */
export const labelKey = (label: string): string => norm(label);

/**
 * `치는 말 → 어울리는 이모티콘 이름` 표.
 *
 * - **`words`는 사람이 칠 만한 말**이다. 글에 그 말이 **들어 있으면** 걸린다
 *   (`굿모닝입니다`도 `굿모닝`에 걸린다). 공백은 지우고 보므로 `좋은 아침`도
 *   `좋은아침`에 걸린다.
 * - **`labels`는 이모티콘 이름을 깎아 둔 값**이다(`labelKey`). 같은 이름이
 *   묶음마다 하나씩 있어(`화이팅!`이 다섯 곳) 한 줄에 여러 캐릭터가 저절로
 *   섞인다 — 카톡이 세트마다 하나씩 보여 주는 그 모양이다.
 * - **한 글자 말을 넣지 말 것** — `굿`을 넣으면 `굿모닝`까지 걸려 인사 자리에
 *   엉뚱한 것이 섞인다. `밥`처럼 그 자체로 뜻이 또렷한 것만 예외로 둔다.
 *
 * **이름을 잘못 적으면 조용히 아무것도 안 걸린다.**
 * `node --experimental-strip-types .dev/suggest-check.mts`가 그걸 잡는다 —
 * 표를 고쳤으면 먼저 돌려 볼 것(브라우저가 필요 없다).
 */
export type SuggestTopic = { words: string[]; labels: string[] };

export const SUGGEST_TOPICS: SuggestTopic[] = [
    { words: ['안녕', '하이', '반가', '굿모닝', '좋은아침', 'ㅎㅇ', '방가', '하잉'],
      labels: ['안녕', '반가워', '빼꼼', '까꿍', '윙크'] },
    { words: ['잘자', '굿나잇', '굿밤', '자러', '졸려', '졸립', '주무'],
      labels: ['잘자', '잘자요', '쿨쿨', '포근'] },
    { words: ['감사', '고마', '고맙', 'ㄱㅅ', '땡큐', 'thank'],
      labels: ['감사합니다', '꾸벅'] },
    { words: ['축하', 'ㅊㅋ', '추카', '생일', '결혼', '승진'],
      labels: ['축하해', '신난다', '꽃다발'] },
    { words: ['화이팅', '파이팅', '홧팅', '힘내', '아자', '응원'],
      labels: ['화이팅', '파이팅', '힘내', '아자아자', '불타오른다'] },
    { words: ['나이스', '굿샷', '버디', '이글', '홀인원', '우승', '잘치'],
      labels: ['나이스', '나이스샷', '굿샷', '버디', 'birdie', 'nice', 'holeinone',
               '멋진스윙', '우승', 'champion', 'par'] },
    { words: ['골프', '라운딩', '라운드', '티오프', '스윙', '드라이버', '퍼팅', '필드'],
      labels: ['스윙', '드라이버', '퍼팅', '필드', '골프백', '카트', '깃발'] },
    { words: ['오비', '뒤땅', '벙커', '해저드', '퐁당', '아쉽', '아깝', '망했'],
      labels: ['아ob', '뒤땅', '벙커', '풍덩', '아쉽네요', '어질어질'] },
    { words: ['좋아', '조아', 'ㅇㅋ', '오케', '콜요', 'ㄱㄱ', '넵넵', '알겠', 'ok'],
      labels: ['좋아요', 'good', '멋져', '브이'] },
    { words: ['ㅋㅋ', 'ㅎㅎ', '웃겨', '빵터', 'ㅋㄷ'],
      labels: ['빵터짐', 'ㅋㅋㅋㅋ', '메롱'] },
    { words: ['ㅠㅠ', 'ㅜㅜ', '슬프', '슬퍼', '속상', '울고', '눈물'],
      labels: ['엉엉', '눈물펑펑', '힝'] },
    { words: ['헉', '대박', 'ㄷㄷ', '실화', '헐', '깜짝'],
      labels: ['헉', '어질어질', '어흥'] },
    { words: ['화나', '화남', '짜증', '열받', '빡쳐'],
      labels: ['화났어'] },
    { words: ['한잔', '맥주', '소주', '회식', '뒷풀이', '뒤풀이', '건배', '치맥'],
      labels: ['한잔해요', '한잔해', '여유한잔', '라운딩끝'] },
    { words: ['커피', '카페', '아메리카노'],
      labels: ['커피한잔', '여유'] },
    { words: ['사랑', '하트', '좋아해', '애정'],
      labels: ['하트', '하트눈', '손가락하트', '사랑해요', '좋아좋아', '두근두근'] },
    { words: ['부탁', '제발', 'ㅂㅌ'],
      labels: ['부탁해', '꾸벅'] },
    { words: ['미안', '죄송', 'ㅈㅅ'],
      labels: ['죄송합니다', '꾸벅', '쭈뼛'] },
    { words: ['출발', '갑니다', '가는중', '이동', '도착'],
      labels: ['출발', '달려', '다녀올게요', '여행가자'] },
    { words: ['수고', '고생', '잘가', '또봐', '다음에', '들어가세'],
      labels: ['수고했어요', '또봐요', '다음에또', '다녀올게요', '오늘도행복'] },
    { words: ['비와', '비온', '우천', '장마', '소나기', '빗길'],
      labels: ['비와요'] },
    { words: ['더워', '덥다', '폭염', '더운'],
      labels: ['더워'] },
    { words: ['밥', '점심', '저녁', '먹자', '맛있', '식사', '배고'],
      labels: ['냠냠', '요리중'] },
    { words: ['일하는', '근무', '퇴근', '야근', '출근', '회사', '업무'],
      labels: ['일하는중'] },
    { words: ['뭐해', '어디', '언제', '몇시'],
      labels: ['뭐해요', '뭐해', '어디로', '음'] },
    { words: ['피곤', '힘들', '지침', '쉬고', '쉬는'],
      labels: ['뻗음', '쉬는중', '포근', '여유'] },
    { words: ['건강', '아프', '감기', '몸조리'],
      labels: ['건강하세요'] },
    { words: ['설레', '기대', '두근'],
      labels: ['설레', '두근두근'] },
    { words: ['입금', '정산', '회비', '송금'],
      labels: ['돈복'] },
    { words: ['노래', '음악', '춤', '신나'],
      labels: ['신나는음악', '신나는춤', '신난다'] },
];

/** 앱에 실어 보내는 꼴 — 말 하나에 이모티콘 여럿이다. */
export type SuggestRule = { words: string[]; ids: string[] };

/**
 * 표를 이모티콘 id로 풀어 둔 것.
 *
 * **이름 그대로 친 것도 걸리게** 이름마다 한 줄을 더 넣는다 — `쿨쿨`을
 * 치면 묶음마다 있는 `쿨쿨`이 다 나온다. **두 글자부터만** 넣는다
 * (`음…`은 한 글자라 `다음`·`있음`에 걸려 쓸모가 없다).
 */
export const suggestTable = (): SuggestRule[] => {
    const out: SuggestRule[] = [];
    for (const topic of SUGGEST_TOPICS) {
        const want = new Set(topic.labels);
        const ids = STICKERS.filter(s => want.has(labelKey(s.label))).map(s => s.id);
        const words = topic.words.map(norm).filter(w => w.length >= SUGGEST_MIN);
        if (ids.length && words.length) out.push({ words, ids });
    }
    const byKey = new Map<string, string[]>();
    for (const s of STICKERS) {
        const key = labelKey(s.label);
        if (key.length < SUGGEST_MIN) continue;
        const list = byKey.get(key);
        if (list) list.push(s.id); else byKey.set(key, [s.id]);
    }
    for (const [key, ids] of byKey) out.push({ words: [key], ids });
    return out;
};

const TABLE = suggestTable();

/**
 * 치는 글에 어울리는 이모티콘 — **이모티콘 목록 차례 그대로** 돌려준다.
 *
 * 차례가 곧 묶음 차례라 **움직이는 것이 맨 앞에 선다**(`STICKER_GROUPS`).
 * 앱도 같은 차례를 쓰므로 웹과 앱이 같은 줄을 보여 준다 —
 * **한쪽만 고치지 말 것.**
 */
export const suggestFor = (draft: string): Sticker[] => {
    const text = norm(draft);
    if (text.length < SUGGEST_MIN) return [];
    const hit = new Set<string>();
    for (const rule of TABLE) {
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
