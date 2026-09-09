/**
 * 오래된 대화 사진을 지운다 — **카톡의 그 `저장 기간 만료`다**(사용자 제안 —
 * `일주일이 지나면 올린사진을 자동으로 삭제하면되는거 아니야?`).
 *
 * **무엇을 푸는 것인가.** 무료 저장 공간이 **1GB이고 쌓이기만 한다** —
 * 한 장 800KB니 1,200장쯤에서 차고, 차면 그때부터 **사진을 아예 못 올린다.**
 * 지워 주면 늘 일정한 양에서 멈춘다(90일·주 30장이면 300MB쯤).
 * **한 달 통신량(5GB)은 이걸로 안 줄어든다** — 그건 사람들이 사진을 볼 때
 * 나가는 것이고, 보는 일은 올린 직후 며칠에 다 일어난다.
 *
 * **정해진 시각에 도는 것(pg_cron)을 새로 켜지 않았다.** 투표 결과를
 * 대화방에 남기는 일(`announceClosedPolls`)과 같은 결이다 — 아무도 앱을
 * 안 열었으면 지울 일도 급하지 않고, 대화는 날마다 여는 화면이라 늦어야
 * 하루다. 서버도, 붙여넣을 비밀값도 없이 되는 것이 이 방식의 값이다.
 *
 * **누가 지우는가 — 회원 누구나다.** `storage.objects`에 `chat_photos_old`
 * 정책을 두어 **90일이 지난 것만** 지울 수 있게 열었다. 남의 사진이라도
 * 그 나이면 어차피 지워질 것이라 위험이 없고, 그 덕에 **운영진이 앱을 안
 * 여는 주에도** 청소가 돈다(제 사진만 지우게 두면 앱을 떠난 사람의 사진이
 * 영영 남는다).
 *
 * **지워진 자리는 화면이 알아챈다** — 그림을 못 받아 오면 `ChatPhoto`가
 * `사진 저장 기간이 만료되었습니다`로 바꾼다. 그래서 **DB에는 아무것도
 * 안 쓴다**(글도 주소도 그대로 남는다). 칸을 늘리지 않으려는 것이고,
 * 지우는 것과 표시하는 것이 어긋날 자리도 없앤 것이다.
 */

import { supabase } from './supabase';

/** 이만큼 지난 사진을 지운다. **`schema.sql`의 `chat_photos_old` 정책과
 *  같은 값이어야 한다** — 앱이 90일로 골라 놓고 DB가 안 열어 주면 아무
 *  일도 안 일어난다. 한쪽만 고치지 말 것. */
export const PHOTO_DAYS = 90;

/** 한 번에 이만큼만 지운다. 쌓인 것이 많아도 며칠에 걸쳐 걷힌다 —
 *  대화를 여는 그 순간에 백 건을 지우고 앉아 있을 이유가 없다. */
const BATCH = 30;

/** 기기마다 하루 한 번만. 대화방을 드나들 때마다 통에 물어볼 일이 아니다. */
const KEY = 'teetime:purge';
const DAY = 86400000;

function tried(): boolean {
    try {
        const last = Number(localStorage.getItem(KEY) || 0);
        if (Date.now() - last < DAY) return true;
        localStorage.setItem(KEY, String(Date.now()));
        return false;
    } catch {
        return true;   // 사파리 잠금 — 그런 기기에서는 그냥 넘어간다
    }
}

/**
 * 이 방의 오래된 사진을 걷는다.
 *
 * **조용히 실패한다.** 통이 없는 저장소도 있고, 정책을 아직 안 돌린
 * 저장소도 있다 — 청소가 안 됐다고 대화가 안 열리면 안 된다.
 */
export async function purgeOldPhotos(roomId: string): Promise<number> {
    if (!roomId || tried()) return 0;
    try {
        /* 오래된 것부터 받는다 — 지울 것이 있다면 앞쪽에 있다. */
        const { data, error } = await supabase.storage.from('chat-photos').list(roomId, {
            limit: 100,
            sortBy: { column: 'created_at', order: 'asc' },
        });
        if (error || !data?.length) return 0;

        const cutoff = Date.now() - PHOTO_DAYS * DAY;
        const old = data
            .filter(f => f.name && f.created_at && Date.parse(f.created_at) < cutoff)
            .slice(0, BATCH)
            .map(f => `${roomId}/${f.name}`);
        if (!old.length) return 0;

        const { error: delErr } = await supabase.storage.from('chat-photos').remove(old);
        return delErr ? 0 : old.length;
    } catch {
        return 0;
    }
}
