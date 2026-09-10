import { supabase } from './supabase';
import type { AppNotification } from './types';

/**
 * **알림함** — 폰으로 밀어 준 알림을 서버에도 남겨 두고 앱에서 되짚는 자리.
 *
 * 미는 것으로 끝내면 **배너를 놓쳤을 때 볼 데가 없다.** 아이콘에 `12`가
 * 떠 있어도 그중 둘이 정산인지 자리가 난 것인지 앱 안에서 알 길이 없었다
 * (사용자 제보 — `앱에서는 알수있는 방법이 없어`). 홈 머리말의 🔔이
 * 이 줄들을 보여 준다.
 *
 * **대화는 여기 없다** — 하루 100마디가 그대로 쌓이는 데다 대화방이 곧
 * 목록이다. 그래서 **종의 숫자와 대화 안 읽은 수는 갈린다**(폰 아이콘의
 * 숫자만 둘을 더한 값이다).
 *
 * **넣는 것은 발송기뿐이다.** 표에 insert 정책이 아예 없어서, 회원은
 * 제 것을 보고·읽음 찍고·지우기만 한다(schema.sql의 `notifications`).
 *
 * **표가 아직 없는 저장소에서도 화면이 살아야 한다.** 스키마를 손으로
 * 붙여넣던 사이가 있으므로, 여기 넷은 오류를 던지지 않고 **빈 목록·0**으로
 * 물러난다 — 알림함 하나 때문에 홈이 통째로 안 열리면 안 된다.
 */

/** 한 번에 받아 오는 줄 수. 목록에 페이지 넘기기를 두지 않았다. */
export const ALERTS_LIMIT = 50;

/** 90일이 지난 것은 내 화면이 지운다. **DB 함수와 같은 값이어야 한다.** */
export const ALERT_DAYS = 90;

export async function fetchAlerts(): Promise<AppNotification[]> {
    const { data, error } = await supabase.from('notifications')
        .select('*').order('created_at', { ascending: false }).limit(ALERTS_LIMIT);
    if (error) return [];
    return (data ?? []) as AppNotification[];
}

/**
 * 안 읽은 알림 개수 — 종에 붙는 숫자.
 *
 * **개수만 센다**(`head: true`) — 몸통이 아예 안 실려 온다. 홈은 실시간
 * 이벤트마다 다시 그려지므로 줄을 받아 오면 그만큼 통신이 쌓인다.
 */
export async function countUnreadAlerts(): Promise<number> {
    const { count, error } = await supabase.from('notifications')
        .select('id', { count: 'exact', head: true }).is('read_at', null);
    return error ? 0 : count ?? 0;
}

/**
 * 목록을 열면 다 읽은 것으로 본다.
 *
 * **줄마다 눌러 읽게 하지 않는다** — 종을 누른 것이 곧 '무엇이 왔나 보자'라,
 * 거기서 숫자가 안 줄면 아이콘의 뱃지를 지울 길이 없어진다.
 *
 * **안 읽은 것이 없으면 아무것도 안 보낸다** — 목록을 다시 열 때마다
 * 헛 쓰기가 나가면 실시간 이벤트가 그만큼 돈다(`rememberCurrentRanks`와
 * 같은 결이다).
 */
export async function markAlertsRead(): Promise<void> {
    await supabase.from('notifications')
        .update({ read_at: new Date().toISOString() }).is('read_at', null);
}

/**
 * 오래된 내 알림을 걷는다.
 *
 * 대화 사진 청소와 같은 결이다 — **정해진 시각에 도는 것(pg_cron)을 새로
 * 켜지 않고** 알림함을 연 사람의 화면이 치운다. 실패해도 그냥 넘어간다.
 */
export async function purgeOldAlerts(): Promise<void> {
    await supabase.rpc('purge_my_notifications');
}
