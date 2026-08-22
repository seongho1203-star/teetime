/**
 * 라운드 날 날씨.
 *
 * `rounds.lat/lon`이 이미 있으므로 좌표만 넘기면 된다. Open-Meteo는
 * 키가 필요 없고 무료라 서버 없이도 쓸 수 있다 — 이 앱에 서버가 없다는
 * 전제를 깨지 않는 유일한 선택지였다.
 *
 * **예보는 16일까지만 나온다.** 그보다 먼 라운드는 조용히 비워 둔다 —
 * 없는 값을 억지로 채우면 잘못된 예보를 보여 주게 된다.
 */

export interface Weather {
    /** 그 날 최저·최고 (℃, 반올림) */
    min: number;
    max: number;
    /** 강수 확률 최댓값 (%) */
    rain: number;
    /** 하늘 상태를 나타내는 그림글자 */
    icon: string;
    /** `맑음` · `구름 조금` 같은 한 마디 */
    label: string;
}

/**
 * WMO 날씨 코드 → 우리말 한 마디.
 * 스무 가지가 넘지만 골프 갈지 말지를 가르는 건 결국 몇 덩이뿐이라
 * 그 단위로 묶는다.
 */
function describe(code: number): { icon: string; label: string } {
    if (code === 0) return { icon: '☀️', label: '맑음' };
    if (code <= 2) return { icon: '🌤️', label: '구름 조금' };
    if (code === 3) return { icon: '☁️', label: '흐림' };
    if (code <= 48) return { icon: '🌫️', label: '안개' };
    if (code <= 57) return { icon: '🌦️', label: '이슬비' };
    if (code <= 67) return { icon: '🌧️', label: '비' };
    if (code <= 77) return { icon: '🌨️', label: '눈' };
    if (code <= 82) return { icon: '🌧️', label: '소나기' };
    if (code <= 86) return { icon: '🌨️', label: '눈' };
    return { icon: '⛈️', label: '천둥번개' };
}

/**
 * 같은 곳·같은 날이면 다시 받지 않는다.
 *
 * 홈은 실시간 이벤트가 올 때마다 다시 그려지는데, 그때마다 부르면
 * 요청이 금방 쌓인다. 형제 앱 JTFAG에서 실제로 한도(429)에 걸려
 * 날씨가 통째로 안 뜬 적이 있어 캐시를 먼저 둔다.
 */
const cache = new Map<string, Weather | null>();
const pending = new Map<string, Promise<Weather | null>>();

/** `YYYY-MM-DD` (한국 날짜) */
function kstDay(iso: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
}

export async function fetchWeather(
    lat: number | null, lon: number | null, teeAt: string,
): Promise<Weather | null> {
    if (lat == null || lon == null) return null;

    const day = kstDay(teeAt);
    const key = `${lat.toFixed(2)},${lon.toFixed(2)},${day}`;
    if (cache.has(key)) return cache.get(key) ?? null;
    const already = pending.get(key);
    if (already) return already;

    const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${lat}&longitude=${lon}`
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
        + `&timezone=Asia%2FSeoul&start_date=${day}&end_date=${day}`;

    const job = (async (): Promise<Weather | null> => {
        try {
            const res = await fetch(url);
            // **200이 아닌 경우를 반드시 처리한다.** 한도를 넘기면 429에
            // JSON 본문이 오는데, 그걸 그냥 읽으면 daily가 없어 조용히
            // 깨진다. 실패는 실패로 두고 날씨칸만 감춘다.
            if (!res.ok) return null;
            const d = await res.json();
            const t = d?.daily;
            if (!t?.temperature_2m_max?.length) return null;
            const { icon, label } = describe(Number(t.weather_code?.[0] ?? 0));
            return {
                min: Math.round(Number(t.temperature_2m_min[0])),
                max: Math.round(Number(t.temperature_2m_max[0])),
                rain: Math.round(Number(t.precipitation_probability_max?.[0] ?? 0)),
                icon, label,
            };
        } catch {
            return null;
        }
    })();

    pending.set(key, job);
    const got = await job;
    pending.delete(key);
    cache.set(key, got);
    return got;
}
