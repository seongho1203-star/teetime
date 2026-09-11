import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync, useRealtime, useRefreshOnShow } from '../lib/db';
import { fetchAlerts, markAlertsRead, purgeOldAlerts } from '../lib/alerts';
import { timeAgo } from '../lib/format';
import { splitAlertTitle, type AppNotification } from '../lib/types';
import { TopBar } from '../components/TopBar';
import './Alerts.css';

/**
 * 알림함 — 폰으로 왔던 알림을 되짚는 자리.
 *
 * **배너를 놓치면 볼 데가 없던 문제를 푼다.** 아이콘에 `12`가 떠 있어도
 * 그중 둘이 정산인지 자리가 난 것인지 앱 안에서 알 길이 없었다
 * (사용자 제보 — `앱에서는 알수있는 방법이 없어`).
 *
 * **대화는 여기 없다.** 하루 100마디가 그대로 쌓이는 데다 대화방이 곧
 * 목록이라 여기 또 적을 것이 없다 — 종의 숫자가 대화 안 읽은 수와
 * 갈리는 까닭이다(폰 아이콘의 숫자만 둘을 더한 값이다).
 *
 * **여는 순간 다 읽음으로 본다.** 줄마다 눌러 읽게 하면 아이콘의 뱃지를
 * 지울 길이 없어진다 — 종을 눌렀다는 것이 곧 '무엇이 왔나 보자'다.
 * 그래서 **무엇이 안 읽은 것이었는지는 따로 얼려 둔다**(`fresh`) —
 * 안 그러면 들어가는 순간 전부 읽은 것으로 보인다.
 */
/* oxlint-disable react/refs */
export function Alerts() {
    const nav = useNavigate();
    const { data, loading, reload } = useAsync(fetchAlerts, [], 'alerts');

    /* **읽음은 한 번만 찍는다.** 실시간 이벤트로 이 화면이 다시 그려질
       때마다 찍으면 쓰기가 그만큼 나가고, 그 쓰기가 다시 이벤트가 되어
       되돌아온다. 청소도 같은 자리에서 한 번만 한다(대화방을 연 사람이
       사진을 치우는 것과 같은 결이다). */
    /* **'열기 전까지 안 읽었던 것'을 얼려 둔다.**
     *
     * 여는 순간 다 읽음으로 찍으므로(아래) `a.read_at`으로 그리면
     * **한 줄도 안 갈린다** — 들어가 보면 전부 읽은 것으로 보인다
     * (사용자 요청 — `내가 확인한건 색상을 다르게해서 확인한건지
     * 안한건지 알수있게해줘`).
     *
     * 담기는 길이 둘이고 둘 다 필요하다:
     *   ① **그릴 때** — 아직 `read_at`이 빈 줄을 보면 담는다. 목록이
     *      읽음 찍기보다 먼저 닿는 흔한 길이다.
     *   ② **`markAlertsRead()`가 돌려주는 id** — 반대 순서로 닿아
     *      ①에서 이미 읽음으로 보이는 판을 메운다.
     * 대화의 `lastSeen`을 첫 렌더에서 한 번만 집는 것과 같은 결이다.
     *
     * **id마다 한 번만 판단한다**(`judged`) — 실시간 이벤트로 다시
     * 그려질 때마다 보면, 읽음으로 바뀐 줄이 그때 '읽은 것'으로
     * 뒤집혀 색이 되돌아간다. 보고 있는 동안 새로 꽂히는 알림은
     * 처음 보는 id라 그대로 `안 읽음`으로 들어간다(그게 맞다). */
    const fresh = useRef<Set<string>>(new Set());
    const judged = useRef<Set<string>>(new Set());

    const once = useRef(false);
    useEffect(() => {
        if (once.current) return;
        once.current = true;
        void (async () => {
            for (const id of await markAlertsRead()) fresh.current.add(id);
            await purgeOldAlerts();
            reload();
        })();
    }, [reload]);

    /* 남이 무엇을 하면 알림이 새로 꽂힌다 — 보고 있는 동안 들어오면
       그 자리에서 나타나야 한다. */
    useRealtime(['notifications'], reload);

    /* **접어 두었다 펴면 그 사이 온 것을 받는다.** 실시간 연결이 끊긴
       동안 들어온 것은 되받아 오지 않는다(`useRefreshOnShow` 참고).
       **읽음도 함께 찍는다** — 이 화면을 보고 있다는 것이 곧 '봤다'라,
       안 찍으면 종의 숫자만 남는다. */
    useRefreshOnShow(useCallback(() => {
        void (async () => {
            for (const id of await markAlertsRead()) fresh.current.add(id);
            reload();
        })();
    }, [reload]));

    const open = (a: AppNotification) => {
        if (!a.url) return;
        // 발송기가 실어 보내는 값 그대로다(`#/rounds/123`). 폰 알림을
        // 눌렀을 때 가는 곳과 같아야 하므로 `#`만 떼고 그대로 넘긴다.
        nav(a.url.replace(/^#/, ''));
    };

    const list = data ?? [];

    /* 위 ① — 그리는 중에 ref를 건드린다. 일부러다(댓글 칸의 `hasText`와
       같은 자리): 효과에서 보면 그 사이에 읽음이 찍혀 늦는다. */
    for (const a of list) {
        if (judged.current.has(a.id)) continue;
        judged.current.add(a.id);
        if (!a.read_at) fresh.current.add(a.id);
    }

    return (
        <div className="page">
            <TopBar title="알림" />

            {loading && !data && <div className="spinner" />}

            {!loading && !list.length && (
                <div className="empty">
                    아직 온 알림이 없습니다
                    <br />
                    <span className="xs">
                        모집·정산·조 편성 소식이 여기 쌓입니다.
                        대화는 대화 탭에서 보세요.
                    </span>
                </div>
            )}

            <div className="alert-list">
                {list.map(a => (
                    <button key={a.id} className={`alert-row${fresh.current.has(a.id) ? ' fresh' : ' seen'}`}
                            onClick={() => open(a)} disabled={!a.url}>
                        <span className="alert-icon" aria-hidden="true">{icon(a)[0]}</span>
                        <span className="alert-body">
                            <span className="alert-title">
                                {icon(a)[1]}
                                {fresh.current.has(a.id) && (
                                    <span className="alert-new" aria-label="안 읽음">N</span>
                                )}
                            </span>
                            {a.body && <span className="alert-text">{a.body}</span>}
                            <span className="alert-when xs faint">{timeAgo(a.created_at)}</span>
                        </span>
                        {a.url && <span className="chev">›</span>}
                    </button>
                ))}
            </div>

            {list.length > 0 && (
                <div className="empty xs">
                    {ALERT_DAYS_NOTE}
                </div>
            )}
        </div>
    );
}

/** 제목 앞의 그림글자를 아이콘 자리로 옮긴다 — 안 옮기면 같은 그림이
 *  두 번 나온다(제목에 이미 붙어 있다). */
const icon = splitAlertTitle;

/** 오래된 것이 저절로 사라지는 것을 한 줄로 알려 준다 — 안 적으면
 *  지난달 알림이 없어진 것을 고장으로 본다. */
const ALERT_DAYS_NOTE = '90일이 지난 알림은 저절로 지워집니다';
