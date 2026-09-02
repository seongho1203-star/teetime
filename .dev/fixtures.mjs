/* 헤드리스 확인용 가짜 데이터.
 * 실제 Supabase 없이 모든 화면을 눈으로 보려고 둔 것이다. 배포에는 안 들어간다. */

export const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (dayOffset, h = 7, m = 30) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + dayOffset);
    // 한국 시각 h시 m분 = UTC h-9
    d.setUTCHours(h - 9, m, 0, 0);
    return d.toISOString();
};

export const ME = uid(1);

/* `gender`·`birth_year`는 **조 편성 조건**이 보는 값이다.
   **일부러 몇 사람은 비워 둔다** — 이 기능 이전에 가입한 분들이 실제로
   그렇고, 그때 조 편성 화면이 `안 적은 분 N명`을 알려 주는지도 봐야 한다.
   (오세훈은 성별만·태어난 해만 빈 경우를 각각 만들려고 둘 다 비웠다.) */
export const profiles = [
    { id: uid(1), name: '신성호', avatar_url: null, role: 'superadmin', joined_at: iso(-120), memo: '', region: '광산구', gender: 'm', birth_year: 1972, created_at: iso(-120) },
    { id: uid(2), name: '이관교', avatar_url: null, role: 'admin', joined_at: iso(-110), memo: '', region: '북구', gender: 'm', birth_year: 1968, created_at: iso(-110) },
    { id: uid(3), name: '김지명', avatar_url: null, role: 'staff', joined_at: iso(-100), memo: '', region: '서구', gender: 'm', birth_year: 1980, created_at: iso(-100) },
    { id: uid(4), name: '박승수', avatar_url: null, role: 'treasurer', joined_at: iso(-90), memo: '', region: '남구', gender: 'm', birth_year: 1975, created_at: iso(-90) },
    { id: uid(5), name: '정우성', avatar_url: null, role: 'member', joined_at: iso(-40), memo: '', region: '동구', gender: 'f', birth_year: 1988, created_at: iso(-40) },
    /* 여덟 명이 차야 **조가 둘로 갈린다** — 네 명짜리 라운드만 두면 조
       편성이 늘 한 덩어리라, 조별로 묶어 그리는 것이 맞는지 확인이 안 된다. */
    { id: uid(9),  name: '오세훈', avatar_url: null, role: 'member', joined_at: iso(-35), memo: '', region: null, gender: null, birth_year: null, created_at: iso(-35) },
    { id: uid(10), name: '장동건', avatar_url: null, role: 'member', joined_at: iso(-33), memo: '', region: '첨단', gender: 'm', birth_year: 1995, created_at: iso(-33) },
    { id: uid(11), name: '임채원', avatar_url: null, role: 'member', joined_at: iso(-31), memo: '', region: '수완지구', gender: 'f', birth_year: 1958, created_at: iso(-31) },
    { id: uid(6), name: '한도현', avatar_url: null, role: 'pending', joined_at: null, memo: '', region: null, gender: null, birth_year: null, created_at: iso(-1) },
    { id: uid(7), name: '조민석', avatar_url: null, role: 'pending', joined_at: null, memo: '', region: null, gender: null, birth_year: null, created_at: iso(0) },
    // 추방된 사람. 명단 아래 칸이 어떻게 보이는지 확인용.
    { id: uid(8), name: '최민수', avatar_url: null, role: 'banned', joined_at: iso(-60), memo: '', region: null, gender: null, birth_year: null, created_at: iso(-60) },
];

/** 전화번호·차량번호는 **다른 표에 산다** — 운영진만 남의 것을 본다. */
export const profile_private = [
    { id: uid(1), phone: '010-1234-5678', car: '12가 3456' },
    { id: uid(2), phone: null, car: '34나 5678' },
    { id: uid(3), phone: null, car: '56다 7890' },
    { id: uid(4), phone: null, car: '78라 1234' },
    { id: uid(5), phone: null, car: null },
    { id: uid(9), phone: null, car: '90마 1122' },
    { id: uid(10), phone: null, car: null },
    { id: uid(11), phone: null, car: '11바 3344' },
    { id: uid(6), phone: '010-9999-1111', car: null },
    { id: uid(7), phone: null, car: null },
    { id: uid(8), phone: null, car: null },
];

export const rounds = [
    { id: 'r1', title: '8월 정기 라운드', course: '무등산CC', lat: 35.134, lon: 126.988,
      tee_at: iso(3), capacity: 4, fee: 120000, status: 'open', opens_at: null,
      kind: 'field', caddie: 'caddie', cart: 'included',
      note: '6시 30분 동광주 IC 앞 집합입니다.\n카풀 가능하신 분은 대화방에 남겨 주세요.',
      created_by: uid(1), created_at: iso(-10) },
    // 스크린 한 건 — 목록에 가리개가 뜨는지, 날씨가 빠지는지 함께 본다.
    { id: 'r4', title: '금요일 저녁 스크린', course: '골프존파크 상무점', lat: null, lon: null,
      tee_at: iso(6), capacity: 6, fee: 25000, status: 'open', opens_at: null,
      kind: 'screen', caddie: null, cart: null,
      note: '7시까지 매장 앞으로 오세요. 신페리오로 돌립니다.',
      created_by: uid(1), created_at: iso(-3) },
    { id: 'r2', title: '', course: '함평엘리체CC', lat: 35.066, lon: 126.517,
      tee_at: iso(12), capacity: 8, fee: 95000, status: 'open', opens_at: null,
      kind: 'field', caddie: 'none', cart: 'excluded',
      note: '', created_by: uid(1), created_at: iso(-5) },
    // 아직 안 지났지만 모집을 닫은 것. 진행중과 갈리는지 보려고 둔다.
    { id: 'r5', title: '', course: '광주CC', lat: null, lon: null,
      tee_at: iso(9), capacity: 4, fee: 130000, status: 'closed', opens_at: null,
      kind: 'field', caddie: 'caddie', cart: 'included',
      note: '', created_by: uid(1), created_at: iso(-6) },
    { id: 'r3', title: '지난 라운드', course: '해피니스CC', lat: null, lon: null,
      tee_at: iso(-14), capacity: 4, fee: 110000, status: 'done', opens_at: null,
      kind: 'field', caddie: null, cart: null,
      note: '', created_by: uid(1), created_at: iso(-30) },
];

/* `grp`가 몇 조인가. **r1은 아직 안 짠 라운드로 둔다** — 조를 안 짜는
   라운드가 대부분이라, 그때 명단이 예전처럼 한 줄로 그려지는지도 봐야 한다.
   조가 짜인 것은 r2다(여덟 명 · 두 조). */
export const signups = [
    { id: 's1', round_id: 'r1', user_id: uid(2), state: 'confirmed', seq: 1, grp: null, note: '', created_at: iso(-9) },
    { id: 's2', round_id: 'r1', user_id: uid(3), state: 'confirmed', seq: 2, grp: null, note: '', created_at: iso(-9) },
    { id: 's3', round_id: 'r1', user_id: uid(1), state: 'confirmed', seq: 3, grp: null, note: '', created_at: iso(-8) },
    { id: 's4', round_id: 'r1', user_id: uid(4), state: 'confirmed', seq: 4, grp: null, note: '', created_at: iso(-8) },
    { id: 's5', round_id: 'r1', user_id: uid(5), state: 'waitlist',  seq: 5, grp: null, note: '', created_at: iso(-7) },

    { id: 's6',  round_id: 'r2', user_id: uid(3),  state: 'confirmed', seq: 1, grp: 1, note: '', created_at: iso(-4) },
    { id: 's7',  round_id: 'r2', user_id: uid(4),  state: 'confirmed', seq: 2, grp: 1, note: '', created_at: iso(-4) },
    { id: 's8',  round_id: 'r2', user_id: uid(1),  state: 'confirmed', seq: 3, grp: 1, note: '', created_at: iso(-4) },
    { id: 's9',  round_id: 'r2', user_id: uid(2),  state: 'confirmed', seq: 4, grp: 1, note: '', created_at: iso(-3) },
    { id: 's10', round_id: 'r2', user_id: uid(9),  state: 'confirmed', seq: 5, grp: 2, note: '', created_at: iso(-3) },
    { id: 's11', round_id: 'r2', user_id: uid(10), state: 'confirmed', seq: 6, grp: 2, note: '', created_at: iso(-3) },
    { id: 's12', round_id: 'r2', user_id: uid(11), state: 'confirmed', seq: 7, grp: 2, note: '', created_at: iso(-2) },
    /* **조가 정해진 뒤에 대기에서 올라온 사람.** `미배정`으로 뜨는지 본다 —
       자리가 나면 실제로 이 상태가 되고, 그걸 못 보면 조가 하나 빈 채로 나간다. */
    { id: 's13', round_id: 'r2', user_id: uid(5),  state: 'confirmed', seq: 8, grp: null, note: '', created_at: iso(-1) },
];

/* 조 편성이 공개된 라운드 하나. 조별 시각이 8분씩 밀리는 흔한 모양이다. */
export const round_groups = [
    { round_id: 'r2', tees: { 1: iso(12, 7, 30), 2: iso(12, 7, 38) },
      posted_by: uid(1), posted_at: iso(-1) },
];

export const polls = [
    { id: 'p1', title: '9월 정기 라운드 날짜', body: '되는 날 모두 골라 주세요.',
      multi: true, anonymous: false, closes_at: iso(5, 23, 59), closed: false,
      created_by: uid(1), created_at: iso(-2) },
    { id: 'p2', title: '가을 워크숍 장소', body: '',
      multi: false, anonymous: false, closes_at: null, closed: true,
      result_at: iso(-30, 12, 0), created_by: uid(1), created_at: iso(-30) },
    /* **마감 시각이 지나 끝난 투표.** `closed`는 아직 false다 — 이 상태에서
       단추가 `마감`으로 보이면(옛 코드가 그랬다) 이미 끝난 것을 또 마감하는
       셈이고, 그 뒤에 눌러도 마감 시각이 그대로라 안 열린다. */
    { id: 'p3', title: '12월 송년 모임 날짜', body: '',
      multi: true, anonymous: false, closes_at: iso(-3, 23, 59), closed: false,
      /* **끝났는데 아직 결과를 안 알린 것.** `announceClosedPolls`가 이걸
         보고 `post_poll_result`를 부르는지 `behave.mjs`가 확인한다. */
      result_at: null, created_by: uid(1), created_at: iso(-20) },
];

export const poll_options = [
    { id: 'o1', poll_id: 'p1', label: '9월 6일 (토)',  sort: 0 },
    { id: 'o2', poll_id: 'p1', label: '9월 13일 (토)', sort: 1 },
    { id: 'o3', poll_id: 'p1', label: '9월 20일 (토)', sort: 2 },
    { id: 'o4', poll_id: 'p2', label: '제주',   sort: 0 },
    { id: 'o5', poll_id: 'p2', label: '경주',   sort: 1 },
];

export const poll_votes = [
    { id: 'v1', poll_id: 'p1', option_id: 'o1', user_id: uid(2), created_at: iso(-2) },
    { id: 'v2', poll_id: 'p1', option_id: 'o2', user_id: uid(2), created_at: iso(-2) },
    { id: 'v3', poll_id: 'p1', option_id: 'o2', user_id: uid(3), created_at: iso(-1) },
    { id: 'v4', poll_id: 'p1', option_id: 'o2', user_id: uid(4), created_at: iso(-1) },
    // 이름이 길어질 때 `외 N명`으로 접히는지 보려고 o1에 표를 몰아 둔다.
    { id: 'v7', poll_id: 'p1', option_id: 'o1', user_id: uid(1), created_at: iso(-1) },
    { id: 'v8', poll_id: 'p1', option_id: 'o1', user_id: uid(3), created_at: iso(-1) },
    { id: 'v9', poll_id: 'p1', option_id: 'o1', user_id: uid(4), created_at: iso(-1) },
    { id: 'v6', poll_id: 'p2', option_id: 'o4', user_id: uid(2), created_at: iso(-29) },
];

export const poll_comments = [
    { id: 'pc1', poll_id: 'p1', author_id: uid(3), body: '13일이 제일 좋습니다', created_at: iso(-1) },
    { id: 'pc2', poll_id: 'p1', author_id: uid(4), body: '저는 6일도 괜찮아요~', created_at: iso(-1) },
];

export const round_comments = [
    { id: 'rc1', round_id: 'r1', author_id: uid(4), body: '동광주 IC에서 카풀 한 자리 부탁드립니다', created_at: iso(-2) },
    { id: 'rc2', round_id: 'r1', author_id: uid(1), body: '제 차에 자리 있습니다. 6시 20분까지 오세요', created_at: iso(-1) },
];

/* 정산 한 건. **중간 참여자 예외**가 보이게 신성호만 금액이 다르다. */
export const settlements = [
    /* **올린 사람을 갈라 둔다.** 정산 현황이 기본으로 `내가 올린 것`만
       보여 주므로, 전부 한 사람 것이면 그 화면이 비거나 가득 차서 어느
       쪽도 확인이 안 된다. st1은 나(uid 1), st3은 남(uid 4)이다. */
    { id: 'st1', round_id: 'r1', title: '무등산CC 그린피 + 카트비',
      body: '캐디피는 현장에서 각자 냅니다.', bank: '국민', account: '123456-78-901234',
      total: 70000, created_by: uid(1), created_at: iso(-1) },
    { id: 'st3', round_id: 'r2', title: '함평엘리체CC 그린피',
      body: '', bank: '농협', account: '302-1234-5678-01',
      total: 40000, created_by: uid(4), created_at: iso(-2) },
    /* **은행 이름을 `국민은행`으로 적어 둔다.** 사람이 손으로 치는 칸이라
       실제로 이렇게 적힌다 — 토스 송금 주소를 만들 때 끝의 `은행`을 떼는지
       여기서 확인된다(`국민`으로 보내야 토스가 알아본다). */
    { id: 'st2', round_id: 'r3', title: '해피니스CC 뒤풀이',
      body: '', bank: '국민은행', account: '123456-78-901234',
      total: 30000, created_by: uid(4), created_at: iso(-20) },
];

export const settlement_shares = [
    { id: 'sh1', settlement_id: 'st1', user_id: uid(1), amount: 10000, paid: false, created_at: iso(-1) },
    { id: 'sh2', settlement_id: 'st1', user_id: uid(2), amount: 20000, paid: true,  created_at: iso(-1) },
    { id: 'sh3', settlement_id: 'st1', user_id: uid(3), amount: 20000, paid: false, created_at: iso(-1) },
    { id: 'sh4', settlement_id: 'st1', user_id: uid(4), amount: 20000, paid: true,  created_at: iso(-1) },
    // 다 걷힌 정산. 총무 화면에서 이건 목록에 안 나오고 아래 한 줄로만 세어진다.
    { id: 'sh5', settlement_id: 'st2', user_id: uid(1), amount: 15000, paid: true, created_at: iso(-20) },
    { id: 'sh6', settlement_id: 'st2', user_id: uid(3), amount: 15000, paid: true, created_at: iso(-20) },
    // 남(박승수)이 올린 정산. `전체`로 넘겼을 때만 보여야 한다.
    { id: 'sh7', settlement_id: 'st3', user_id: uid(2),  amount: 10000, paid: false, created_at: iso(-2) },
    { id: 'sh8', settlement_id: 'st3', user_id: uid(9),  amount: 10000, paid: false, created_at: iso(-2) },
    { id: 'sh9', settlement_id: 'st3', user_id: uid(10), amount: 10000, paid: true,  created_at: iso(-2) },
    { id: 'sh10', settlement_id: 'st3', user_id: uid(11), amount: 10000, paid: true, created_at: iso(-2) },
];

/* 독촉을 한 번 보낸 기록. `마지막 알림 …` 줄이 나오는지 본다. */
export const settle_reminders = [
    { id: 'sr1', settlement_id: 'st1', created_by: uid(4), created_at: iso(0, 9, 10) },
];

export const posts = [
    { id: 'b1', title: '9월 회비 안내', pinned: true, author_id: uid(1),
      body: '9월 회비는 8월 31일까지 입금 부탁드립니다.\n\n국민 123456-78-901234 (신성호)\n금액: 50,000원',
      created_at: iso(-3), updated_at: iso(-3) },
    { id: 'b2', title: '단체 티셔츠 주문 마감', pinned: false, author_id: uid(1),
      body: '사이즈 안 알려주신 분들 이번 주까지 대화방에 남겨 주세요.',
      created_at: iso(-8), updated_at: iso(-8) },
];

export const post_comments = [
    { id: 'c1', post_id: 'b1', author_id: uid(3), body: '입금했습니다!', created_at: iso(-2) },
    { id: 'c2', post_id: 'b1', author_id: uid(4), body: '저도 방금 보냈어요', created_at: iso(-2) },
];

export const rooms = [
    { id: 'room1', name: '전체 대화', round_id: null, created_at: iso(-200) },
];

export const messages = [
    { id: 'm1', room_id: 'room1', user_id: uid(2), body: '이번 주 무등산 날씨 어떤가요?', created_at: iso(-1, 20, 10) },
    { id: 'm2', room_id: 'room1', user_id: uid(3), body: '예보 보니까 맑다고 하네요 ☀️', created_at: iso(-1, 20, 12) },
    { id: 'm3', room_id: 'room1', user_id: uid(1), body: '좋습니다. 6시 30분 동광주 IC 앞에서 봬요', created_at: iso(0, 8, 5) },
    { id: 'm4', room_id: 'room1', user_id: uid(1), body: '카풀 필요하신 분 있으면 알려 주세요', created_at: iso(0, 8, 6) },
    { id: 'm5', room_id: 'room1', user_id: uid(4), body: '저 한 자리 부탁드립니다', created_at: iso(0, 9, 30) },
    // 답장 한 건과 언급 한 건. 인용 조각과 `@이름` 색을 눈으로 보려고 둔다.
    { id: 'm7', room_id: 'room1', user_id: ME, body: '@박승수 자리 있습니다. 오세요!',
      reply_to: 'm5', created_at: iso(0, 9, 32) },
    { id: 'm8', room_id: 'room1', user_id: uid(4), body: '@신성호 감사합니다 🙏',
      reply_to: 'm7', created_at: iso(0, 9, 33) },
    // `@전체`는 **운영진이 썼을 때만** 도드라진다. 둘을 나란히 둬서
    // 회원이 손으로 쳐 넣은 것이 그냥 글자로 남는지 함께 본다.
    { id: 'm9', room_id: 'room1', user_id: ME,
      body: '@전체 집합 시각이 6시 20분으로 바뀌었습니다', created_at: iso(0, 9, 35) },
    { id: 'm10', room_id: 'room1', user_id: uid(2),
      body: '@전체 저도 확인했습니다', created_at: iso(0, 9, 36) },
    // 앱이 스스로 남긴 안내 줄. 말풍선이 아니라 가운데 한 줄로 나온다.
    { id: 'sys1', room_id: 'room1', user_id: uid(2), system: true,
      body: '이관교님이 라운드 모집을 열었습니다 · 함평엘리체CC', created_at: iso(0, 9, 34) },
    /* 투표가 끝났을 때 남는 결과 카드. `poll_id`가 있는 `system` 글이라
       한 줄이 아니라 눌리는 카드로 그려진다. */
    { id: 'sys2', room_id: 'room1', user_id: uid(1), system: true, poll_id: 'p2',
      body: '투표가 끝났습니다\n가을 워크숍 장소\n1위 · 담양 리조트 (7표)',
      created_at: iso(0, 9, 41) },
    // 이모지만 보낸 글은 말풍선 없이 크게 나온다. 남·나 양쪽과, 글자가
    // 섞이면 평소대로 돌아오는 것까지 나란히 둔다.
    { id: 'm11', room_id: 'room1', user_id: uid(3), body: '👍', created_at: iso(0, 9, 37) },
    { id: 'm12', room_id: 'room1', user_id: ME, body: '⛳🔥👏', created_at: iso(0, 9, 38) },
    { id: 'm13', room_id: 'room1', user_id: uid(3), body: '👍 좋습니다', created_at: iso(0, 9, 39) },
    // 사진 말풍선 확인용. 바깥으로 요청이 나가지 않게 data URI로 둔다.
    { id: 'm6', room_id: 'room1', user_id: uid(2), body: '어제 18번 홀',
      image_url: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22640%22%20height=%22420%22%3E%3Crect%20width=%22640%22%20height=%22420%22%20fill=%22%232c7a52%22/%3E%3Ccircle%20cx=%22500%22%20cy=%2290%22%20r=%2245%22%20fill=%22%23f6e27a%22/%3E%3Cpath%20d=%22M0%20320%20L200%20220%20L380%20320%20L640%20200%20L640%20420%20L0%20420Z%22%20fill=%22%231d5a3a%22/%3E%3C/svg%3E', created_at: iso(0, 9, 40) },
];

/* 알림 받는 기기 한 대. `내 정보`의 대화 알림 스위치가 이 행의 `chat`을
   읽는다 — 헤드리스에는 진짜 구독이 없으므로 확인 도구가 구독을 흉내 낸다. */
export const push_subscriptions = [
    { endpoint: 'https://example.test/fake-endpoint', user_id: ME,
      p256dh: 'x', auth: 'y', ua: 'headless', chat: true, created_at: iso(-3) },
];

/* 사람마다 대화를 어디까지 읽었나. 말풍선 옆의 `안 읽은 사람 수`가 이걸로
   셈해진다. 회원 다섯 중 셋만 최근까지 읽은 것으로 두어, 숫자가 나오는
   말풍선과 안 나오는(다 읽은) 말풍선이 한 화면에 같이 보이게 했다. */
export const room_reads = [
    { room_id: 'room1', user_id: uid(1), last_read_at: iso(1, 0, 0) },   // 나 — 다 읽음
    { room_id: 'room1', user_id: uid(2), last_read_at: iso(0, 9, 36) },
    { room_id: 'room1', user_id: uid(3), last_read_at: iso(0, 9, 40) },
    { room_id: 'room1', user_id: uid(4), last_read_at: iso(0, 8, 30) },  // 뒤처짐
    // uid(5) 정우성은 줄이 아예 없다 — 한 번도 안 읽은 사람.
    /* 뒤에 늘린 셋은 **다 읽은 것으로** 둔다. 안 그러면 모든 말풍선에 +3이
       얹혀, 숫자가 나오는 것과 안 나오는 것이 한 화면에 같이 보이게 맞춰 둔
       위 배치가 통째로 무너진다. */
    { room_id: 'room1', user_id: uid(9),  last_read_at: iso(1, 0, 0) },
    { room_id: 'room1', user_id: uid(10), last_read_at: iso(1, 0, 0) },
    { room_id: 'room1', user_id: uid(11), last_read_at: iso(1, 0, 0) },
];

export const tables = {
    profiles, profile_private, rounds, signups, round_groups, round_comments,
    settlements, settlement_shares, settle_reminders,
    polls, poll_options, poll_votes,
    poll_comments, posts, post_comments, rooms, messages, room_reads,
    push_subscriptions,
};
