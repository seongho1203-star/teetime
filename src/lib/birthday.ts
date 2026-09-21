/**
 * 생일이면 대화방에 축하 글이 올라가게 한다.
 *
 * **시간이 흐르는 것은 DB에게 사건이 아니다.** 투표 결과 카드
 * (`announceClosedPolls`)·오래된 사진 청소(`purgeOldPhotos`)와 같은 결로,
 * **앱을 연 사람의 화면이 한 번 부른다** — 정해진 시각에 도는 것(pg_cron)을
 * 새로 켜지 않으려는 것이다. 아무도 앱을 안 열었으면 볼 사람도 없다.
 *
 * **홈이 부른다.** 모두가 처음 닿는 화면이라 늦어야 그날 아침이다.
 * 대화 탭에서만 부르면 아무도 그 탭을 안 여는 날 축하가 통째로 빠진다
 * (투표 결과를 홈이 함께 부르는 것과 같은 까닭이다).
 *
 * **누가 생일인지는 DB가 고른다**(`post_birthday_greetings`). 생일의 달·날은
 * 운영진만 보는 값이라 애초에 화면으로 안 실려 온다 — 여기서 넘기는 것은
 * **오늘이 음력 며칠인가** 하나뿐이다(Postgres에는 음력이 없다).
 *
 * **한 사람에 하루 한 줄인 것은 DB가 지킨다** — 아래 `tried()`는 그 위에
 * 얹은 예의일 뿐이다(기기마다 하루 한 번만 물어보게 한다).
 */

import { supabase } from './supabase';
import { kstDate } from './format';
import { toLunar } from './lunar';

/** 기기마다 하루 한 번만. 홈은 실시간 이벤트마다 다시 그려진다. */
const KEY = 'teetime:birthday';

function tried(today: string): boolean {
    try {
        if (localStorage.getItem(KEY) === today) return true;
        localStorage.setItem(KEY, today);
        return false;
    } catch {
        return true;   // 사파리 잠금 — 그런 기기에서는 그냥 넘어간다
    }
}

export async function announceBirthdays(): Promise<void> {
    const today = kstDate();
    if (tried(today)) return;

    const [y, m, d] = today.split('-').map(Number);
    const lunar = toLunar(y, m, d);

    /* **윤달에는 음력 생일을 안 센다.** 윤5월에 난 사람도 평5월에 생일을
       쇠는 것이 우리 관습이고, 평달이 먼저 오므로 그때 이미 축하받았다. */
    const { error } = await supabase.rpc('post_birthday_greetings', {
        p_lmonth: lunar.leap ? null : lunar.month,
        p_lday: lunar.leap ? null : lunar.day,
    });

    /* **오류는 그냥 삼킨다.** 함수가 아직 없는 저장소에서는 404가 오는데,
       축하 한 줄 때문에 홈이 통째로 안 열리면 안 된다(참석 횟수·반응과
       같은 잣대다). 다음 날 다시 해 본다. */
    if (error) {
        try { localStorage.removeItem(KEY); } catch { /* 잠긴 기기 */ }
    }
}
