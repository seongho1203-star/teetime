import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync, useRealtime } from '../lib/db';
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
 */
export function Alerts() {
    const nav = useNavigate();
    const { data, loading, reload } = useAsync(fetchAlerts, [], 'alerts');

    /* **읽음은 한 번만 찍는다.** 실시간 이벤트로 이 화면이 다시 그려질
       때마다 찍으면 쓰기가 그만큼 나가고, 그 쓰기가 다시 이벤트가 되어
       되돌아온다. 청소도 같은 자리에서 한 번만 한다(대화방을 연 사람이
       사진을 치우는 것과 같은 결이다). */
    const once = useRef(false);
    useEffect(() => {
        if (once.current) return;
        once.current = true;
        void (async () => {
            await markAlertsRead();
            await purgeOldAlerts();
            reload();
        })();
    }, [reload]);

    /* 남이 무엇을 하면 알림이 새로 꽂힌다 — 보고 있는 동안 들어오면
       그 자리에서 나타나야 한다. */
    useRealtime(['notifications'], reload);

    const open = (a: AppNotification) => {
        if (!a.url) return;
        // 발송기가 실어 보내는 값 그대로다(`#/rounds/123`). 폰 알림을
        // 눌렀을 때 가는 곳과 같아야 하므로 `#`만 떼고 그대로 넘긴다.
        nav(a.url.replace(/^#/, ''));
    };

    const list = data ?? [];

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
                    <button key={a.id} className={`alert-row${a.read_at ? '' : ' fresh'}`}
                            onClick={() => open(a)} disabled={!a.url}>
                        <span className="alert-icon" aria-hidden="true">{icon(a)[0]}</span>
                        <span className="alert-body">
                            <span className="alert-title">{icon(a)[1]}</span>
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
