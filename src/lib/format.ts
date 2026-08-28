/**
 * 날짜·숫자 표기.
 *
 * **모든 날짜는 한국 시각으로 보여 준다.** 기기 시간대를 따르면
 * 해외에 있는 사람에게 티오프 시각이 다르게 보인다. DB에는 UTC(timestamptz)로
 * 들어 있고, 여기서만 Asia/Seoul로 옮긴다.
 */

const KST = 'Asia/Seoul';

const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('ko-KR', { timeZone: KST, ...opts });

const dateFmt = fmt({ month: 'long', day: 'numeric', weekday: 'short' });
const timeFmt = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });
const fullFmt = fmt({ year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
const stampFmt = fmt({ month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });

/** `8월 21일 (금)` */
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));

/** `오전 7:30` */
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));

/** `8월 21일 (금) 오전 7:30` */
export const formatDateTime = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`;

/** `2026년 8월 21일 (금)` */
export const formatFullDate = (iso: string) => fullFmt.format(new Date(iso));

/** `8/21 오후 3:04` — 목록의 작은 시각 표시용 */
export const formatStamp = (iso: string) => stampFmt.format(new Date(iso));

/** `120,000원` */
export const formatWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/**
 * 한국 날짜 기준 D-day.
 * 양수면 남은 날, 0이면 오늘, 음수면 지난 날.
 *
 * 기기 시간대와 무관해야 하므로 두 시각을 각각 한국 날짜(YYYY-MM-DD)로
 * 바꾼 뒤 그 날짜끼리 뺀다. 밀리초 차이를 86400000으로 나누면
 * 시간대에 따라 하루가 어긋난다.
 */
const ymdFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit',
});

export const kstDate = (d: Date | string = new Date()) =>
    ymdFmt.format(typeof d === 'string' ? new Date(d) : d);

/**
 * `2026-08-21T09:11` — 한국 시각의 **분**까지. 같은 분인지 견주는 데 쓴다.
 * 카톡이 대화를 묶는 단위가 '같은 사람 · 같은 분'이라 대화 화면이 이걸 본다.
 */
export const kstMinute = (iso: string) => toKstInput(iso);

export function daysUntil(iso: string): number {
    const target = new Date(kstDate(iso) + 'T00:00:00Z').getTime();
    const today = new Date(kstDate() + 'T00:00:00Z').getTime();
    return Math.round((target - today) / 86400000);
}

/** `D-3` · `D-DAY` · `종료` */
export function ddayLabel(iso: string): string {
    const d = daysUntil(iso);
    if (d > 0) return `D-${d}`;
    if (d === 0) return 'D-DAY';
    return '종료';
}

/** `방금` · `12분 전` · `3시간 전` · 그보다 오래면 날짜 */
export function timeAgo(iso: string): string {
    const secs = (Date.now() - new Date(iso).getTime()) / 1000;
    if (secs < 60) return '방금';
    if (secs < 3600) return `${Math.floor(secs / 60)}분 전`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}시간 전`;
    if (secs < 86400 * 7) return `${Math.floor(secs / 86400)}일 전`;
    return formatDate(iso);
}

/* ── <input type="datetime-local"> 과 주고받기 ─────────────────
 *
 * 이 입력칸은 **기기 시간대**로 값을 다룬다. 해외에서 열면 티오프 시각이
 * 엉뚱하게 저장되므로, 한국 시각(UTC+9, 서머타임 없음)으로 못 박아 옮긴다.
 */

const inputFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
});

/** ISO → `2026-08-21T07:30` (한국 시각) */
export function toKstInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const parts = inputFmt.formatToParts(new Date(iso));
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    // en-CA에서 자정은 24시로 나온다. 00시로 되돌린다.
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/** `2026-08-21T07:30` (한국 시각) → ISO */
export function fromKstInput(value: string): string | null {
    if (!value) return null;
    const d = new Date(`${value}:00+09:00`);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * 다가올 라운드만 받아 오려고 쓰는 자르는 선.
 *
 * **지난 라운드를 받지 않으려는 것이다.** 화면들이 보여 주는 것은 앞으로의
 * 라운드뿐인데 예전에는 취소된 것만 빼고 **전부** 받아 왔다 — 신청 기록까지
 * 딸려 오면서, 1년 지난 시점에 홈 한 번 여는 데 334KB였다. 해가 갈수록
 * 무거워지므로 회원이 쉰 명이면 무료 통신량(월 5GB)을 넘긴다.
 *
 * **하루 여유를 둔다.** 한국 날짜로 자르는 일은 화면의 `daysUntil`에
 * 맡긴다 — 여기서 시간대까지 맞추면 판단하는 곳이 둘이 되고, 어긋나면
 * 오늘 라운드가 화면에서 사라진다. 넉넉히 받아 두고 거르는 편이 안전하다.
 */
export function upcomingSince(): string {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}
