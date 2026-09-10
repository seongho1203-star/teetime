import { useState } from 'react';
import { kstDate } from '../lib/format';

/**
 * 날짜를 고르는 달력. **우리가 직접 그린다.**
 *
 * ── 왜 브라우저의 날짜 칸을 안 쓰는가 ────────────────────────
 *
 * 1. **아이폰은 칸을 누르는 순간 값을 오늘로 정하고 `change`를 던진다.**
 *    그래서 고르기도 전에 오늘이 항목으로 들어갔다(사용자 제보 —
 *    5·12·19·26을 골랐는데 2일이 끼어 있었다).
 * 2. **창 모양이 화면마다 다르다.** 아이폰이 `칸 옆에 붙는 작은 팝오버`와
 *    `가운데에 크게 띄우는 창` 중 하나를 그때그때 고르는데, 어느 쪽으로
 *    띄울지도 크기도 웹에서 정할 수가 없다 — 사용자가 라운드와 투표를
 *    잇따라 찍어 **`이런게 아예 다른데?`**라고 짚어 준 자리다.
 *    직접 그리면 두 화면이 늘 같은 모양이고 글자도 한글이다.
 *
 * **`marked`로 칠할 날을 정한다** — 하나만 고르는 자리(라운드 티오프)와
 * 여러 날을 담는 자리(투표 항목)가 같이 쓰므로, 목록이 아니라 '이 날이
 * 골라진 것인가'를 묻는다. 부르는 쪽이 제 방식대로 답하면 된다.
 */
export function DayCal({ marked, onPick, from }: {
    /** `YYYY-MM-DD`를 받아 칠할 날인지 답한다. */
    marked: (ymd: string) => boolean;
    onPick: (ymd: string) => void;
    /** 처음 펼칠 달(`YYYY-MM-DD`). 없으면 이번 달이다. */
    from?: string;
}) {
    const today = kstDate();
    const [y0, m0] = (from || today).split('-').map(Number);
    const [at, setAt] = useState({ y: y0, m: m0 });

    const days = new Date(at.y, at.m, 0).getDate();
    const lead = new Date(at.y, at.m - 1, 1).getDay();   // 1일이 무슨 요일인가

    const move = (step: number) => setAt(p => {
        const n = p.m + step;
        return { y: p.y + Math.floor((n - 1) / 12), m: ((n - 1 + 12) % 12) + 1 };
    });

    return (
        <div className="cal">
            <div className="cal-head">
                <button type="button" className="cal-move" onClick={() => move(-1)}
                        aria-label="지난 달">‹</button>
                <span className="cal-month">{at.y}년 {at.m}월</span>
                <button type="button" className="cal-move" onClick={() => move(1)}
                        aria-label="다음 달">›</button>
            </div>
            <div className="cal-grid">
                {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                    <span key={d} className="cal-dow">{d}</span>
                ))}
                {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
                {Array.from({ length: days }, (_, i) => {
                    const d = i + 1;
                    const ymd = `${at.y}-${String(at.m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const on = marked(ymd);
                    return (
                        <button
                            key={d} type="button"
                            className={`cal-day${on ? ' on' : ''}${ymd === today ? ' today' : ''}`}
                            aria-pressed={on}
                            onClick={() => onPick(ymd)}
                        >{d}</button>
                    );
                })}
            </div>
        </div>
    );
}
