import { useState } from 'react';
import { dateLabel, kstDate } from '../lib/format';
import { DayCal } from './DayCal';

/** `07:30` → `오전 7:30` */
function clock(hm: string): string {
    const [h, m] = hm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return hm;
    return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
}

/**
 * 날짜와 시각을 함께 고르는 칸 — **라운드 `티오프`와 투표 `마감 시각`이
 * 같이 쓴다.**
 *
 * **브라우저의 `datetime-local`을 쓰다가 걷어냈다**(사용자 요청 — 두 화면의
 * 날짜 창이 `아예 다른데?`). 아이폰이 띄우는 창은 화면마다 크기도 모양도
 * 다르고 그 안은 영어인데, **어느 것도 웹에서 정할 수가 없다.**
 * 여기서는 `DayCal`을 펼쳐 두 화면이 늘 같게 보이게 한다.
 *
 * **접힌 채로 시작한다.** 모집 열기는 이미 한 화면을 넘기므로 달력을
 * 늘 펴 두면 저장 단추가 더 멀어진다 — 누르면 그 자리에서 펴진다.
 *
 * **시각만은 브라우저 칸(`type="time"`)이다.** 시·분 고르는 창은 아이폰이
 * 늘 같은 굴림판으로 띄워 화면마다 갈리지 않고, 조 편성의 조별 시각도
 * 같은 칸을 쓴다 — 굳이 두 벌로 만들 이유가 없다.
 */
export function DateTimeField({ id, value, onChange, defaultTime = '09:00' }: {
    id: string;
    /** `2026-09-12T07:30`(한국 시각). 빈 값이면 아직 안 정한 것이다. */
    value: string;
    onChange: (v: string) => void;
    /** 날짜만 골랐을 때 채워 둘 시각. */
    defaultTime?: string;
}) {
    const [open, setOpen] = useState(false);
    const [ymd, hm] = value ? value.split('T') : ['', ''];

    return (
        <>
            {/* **누르는 자리가 곧 값을 보여 주는 자리다.** `data-value`는
                `.dev/behave.mjs`가 읽는다 — 진짜 입력칸이 아니라서다. */}
            <button
                type="button" id={id} data-value={value}
                className={`input picked${value ? '' : ' blank'}`}
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
            >
                {value
                    ? `${ymd.split('-')[0]}년 ${dateLabel(ymd)} ${clock(hm)}`
                    : '날짜와 시각을 고르세요'}
            </button>

            {open && (
                <div className="picker">
                    <DayCal
                        from={ymd || undefined}
                        marked={d => d === ymd}
                        onPick={d => onChange(`${d}T${hm || defaultTime}`)}
                    />
                    <div className="picker-time">
                        <span className="sm b">시각</span>
                        <input
                            type="time" className="input" aria-label="시각"
                            value={hm || defaultTime}
                            onChange={e => e.target.value
                                && onChange(`${ymd || kstDate()}T${e.target.value}`)}
                        />
                        <button type="button" className="btn ghost sm"
                                onClick={() => setOpen(false)}>완료</button>
                    </div>
                </div>
            )}
        </>
    );
}
