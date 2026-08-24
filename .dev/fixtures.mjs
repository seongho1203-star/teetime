/* 헤드리스 확인용 가짜 데이터.
 * 실제 Supabase 없이 모든 화면을 눈으로 보려고 둔 것이다. 배포에는 안 들어간다. */

const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (dayOffset, h = 7, m = 30) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + dayOffset);
    // 한국 시각 h시 m분 = UTC h-9
    d.setUTCHours(h - 9, m, 0, 0);
    return d.toISOString();
};

export const ME = uid(1);

export const profiles = [
    { id: uid(1), name: '신성호', avatar_url: null, role: 'admin',   joined_at: iso(-120), handicap: 12.5, phone: '010-1234-5678', memo: '', created_at: iso(-120) },
    { id: uid(2), name: '이관교', avatar_url: null, role: 'member',  joined_at: iso(-110), handicap: 18,   phone: null, memo: '', created_at: iso(-110) },
    { id: uid(3), name: '김지명', avatar_url: null, role: 'member',  joined_at: iso(-100), handicap: 9.2,  phone: null, memo: '', created_at: iso(-100) },
    { id: uid(4), name: '박승수', avatar_url: null, role: 'member',  joined_at: iso(-90),  handicap: 21,   phone: null, memo: '', created_at: iso(-90) },
    { id: uid(5), name: '정우성', avatar_url: null, role: 'member',  joined_at: iso(-40),  handicap: null, phone: null, memo: '', created_at: iso(-40) },
    { id: uid(6), name: '한도현', avatar_url: null, role: 'pending', joined_at: null, handicap: null, phone: '010-9999-1111', memo: '', created_at: iso(-1) },
    { id: uid(7), name: '조민석', avatar_url: null, role: 'pending', joined_at: null, handicap: null, phone: null, memo: '', created_at: iso(0) },
    // 추방된 사람. 명단 아래 칸이 어떻게 보이는지 확인용.
    { id: uid(8), name: '최민수', avatar_url: null, role: 'banned',  joined_at: iso(-60),  handicap: null, phone: null, memo: '', created_at: iso(-60) },
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

export const signups = [
    { id: 's1', round_id: 'r1', user_id: uid(2), state: 'confirmed', seq: 1, note: '', created_at: iso(-9) },
    { id: 's2', round_id: 'r1', user_id: uid(3), state: 'confirmed', seq: 2, note: '', created_at: iso(-9) },
    { id: 's3', round_id: 'r1', user_id: uid(1), state: 'confirmed', seq: 3, note: '', created_at: iso(-8) },
    { id: 's4', round_id: 'r1', user_id: uid(4), state: 'confirmed', seq: 4, note: '', created_at: iso(-8) },
    { id: 's5', round_id: 'r1', user_id: uid(5), state: 'waitlist',  seq: 5, note: '', created_at: iso(-7) },
    { id: 's6', round_id: 'r2', user_id: uid(3), state: 'confirmed', seq: 1, note: '', created_at: iso(-4) },
    { id: 's7', round_id: 'r2', user_id: uid(4), state: 'confirmed', seq: 2, note: '', created_at: iso(-4) },
];

export const polls = [
    { id: 'p1', title: '9월 정기 라운드 날짜', body: '되는 날 모두 골라 주세요.',
      multi: true, anonymous: false, closes_at: iso(5, 23, 59), closed: false,
      created_by: uid(1), created_at: iso(-2) },
    { id: 'p2', title: '가을 워크숍 장소', body: '',
      multi: false, anonymous: false, closes_at: null, closed: true,
      created_by: uid(1), created_at: iso(-30) },
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

export const tables = {
    profiles, rounds, signups, polls, poll_options, poll_votes,
    posts, post_comments, rooms, messages, push_subscriptions,
};
