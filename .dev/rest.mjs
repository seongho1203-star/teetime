/* PostgREST 흉내 — **확인 도구 다섯이 함께 쓴다.**
 *
 * 예전에는 도구마다 이 코드를 복사해 두었는데, 앱이 `poll_votes(poll_id,
 * option_id, user_id)`처럼 **딸린 표에서 칸을 고르기** 시작하자 옛 판은
 * 그걸 못 읽어 **표가 0으로 나왔다.** 스크린샷만 보면 앱이 고장 난 것처럼
 * 보이는데 실제로는 흉내가 뒤처진 것이었다 — 그래서 한 곳으로 모았다.
 *
 * 앱이 실제로 쓰는 것만 처리한다:
 *   - 거르기  eq · neq · is · lt · gt · gte · lte · in
 *   - 줄 세우기 order (여러 번, desc)
 *   - 자르기  limit
 *   - 칸 고르기 `id, name` · `*, signups(round_id, state)` (딸린 표 포함)
 *   - 개수만 세기 head:true → content-range 헤더로 답한다
 */

/** 괄호 안의 쉼표는 건드리지 않고 맨 바깥 쉼표로만 자른다. */
function splitTop(s) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of s) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

function pick(row, cols) {
    if (cols.includes('*')) return { ...row };
    const o = {};
    for (const c of cols) if (c in row) o[c] = row[c];
    return o;
}

/**
 * @param tables 표 이름 → 행 배열
 * @returns 그 요청이 돌려줄 것 (배열이거나 객체 하나거나 null)
 */
export function handleRest(tables, url, req) {
    const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0];

    /* **DB 함수(rpc)도 흉내 낸다.** 세는 일을 DB에 맡긴 것이 있어서, 여기서
       안 흉내 내면 화면에 0이 깔린다 — 스크린샷만 보면 앱이 고장 난 것 같은데
       실제로는 흉내가 뒤처진 것이다(딸린 표에서 칸을 고를 때 겪은 그대로다).
       나머지 rpc는 값을 안 쓰거나 화면이 오류를 넘기므로 null로 답한다. */
    if (table?.startsWith('rpc/')) {
        const name = table.slice(4);
        if (name === 'attendance_counts') {
            const since = (req.postDataJSON?.() ?? {}).p_since ?? '';
            const now = new Date().toISOString();
            const done = new Set((tables.rounds ?? [])
                .filter(r => r.status !== 'cancelled' && r.tee_at >= since && r.tee_at < now)
                .map(r => r.id));
            const n = {};
            for (const s of tables.signups ?? []) {
                if (s.state !== 'confirmed' || !done.has(s.round_id)) continue;
                n[s.user_id] = (n[s.user_id] ?? 0) + 1;
            }
            return Object.entries(n).map(([user_id, count]) => ({ user_id, n: count }));
        }
        return null;
    }

    let rows = tables[table] ? [...tables[table]] : [];

    for (const [key, raw] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
        const [op, value] = raw.split(/\.(.*)/s);
        rows = rows.filter(r => {
            const v = r[key];
            switch (op) {
                case 'eq':  return String(v) === value;
                case 'neq': return String(v) !== value;
                case 'is':  return value === 'null' ? v === null : String(v) === value;
                case 'lt':  return String(v) < value;
                case 'gt':  return String(v) > value;
                case 'gte': return String(v) >= value;
                case 'lte': return String(v) <= value;
                case 'in':  return value.replace(/[()]/g, '').split(',').includes(String(v));
                default:    return true;
            }
        });
    }

    for (const spec of url.searchParams.getAll('order').reverse()) {
        const [col, ...mods] = spec.split('.');
        const desc = mods.includes('desc');
        rows.sort((a, b) => {
            const x = a[col], y = b[col];
            const c = x === y ? 0 : (x ?? '') < (y ?? '') ? -1 : 1;
            return desc ? -c : c;
        });
    }

    /* 고른 칸만 돌려주고, 딸린 표(embed)를 채운다.
       외래키는 이름에서 짐작한다 — `rounds` → `round_id`, `polls` → `poll_id`. */
    const parts = splitTop(url.searchParams.get('select') ?? '*');
    const cols = parts.filter(p => !p.includes('(')).map(p => p.trim());
    const embeds = [];
    for (const p of parts) {
        const m = /^\s*(\w+)\((.*)\)\s*$/s.exec(p);
        if (m) embeds.push({ name: m[1], cols: splitTop(m[2]).map(c => c.trim()) });
    }
    const fk = table.replace(/s$/, '') + '_id';
    rows = rows.map(r => {
        const out = pick(r, cols.length ? cols : ['*']);
        for (const e of embeds) {
            const kids = (tables[e.name] ?? []).filter(c => c[fk] === r.id);
            out[e.name] = kids.map(k => pick(k, e.cols));
        }
        return out;
    });

    const limit = url.searchParams.get('limit');
    if (limit) rows = rows.slice(0, Number(limit));

    // .single() / .maybeSingle() 은 객체 하나를 기대한다.
    const wantsOne = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
    return wantsOne ? (rows[0] ?? null) : rows;
}

/**
 * playwright의 route 하나로 만들어 준다.
 *
 * **개수만 세는 조회**(`head: true`)는 몸통이 아니라 `content-range` 헤더로
 * 답한다. 진짜 수를 안 넣어 주면 탭바의 안 읽음 숫자가 헤드리스에서만
 * 0으로 보인다. `access-control-expose-headers`도 함께 붙여야 자바스크립트가
 * 그 헤더를 읽을 수 있다(진짜 Supabase가 그렇게 보낸다).
 *
 * @param onBytes 응답 크기를 세고 싶을 때. (표 이름, 바이트 수)
 */
export function restRoute(tables, onBytes) {
    return async route => {
        const req = route.request();
        const url = new URL(req.url());
        const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0];
        const body = handleRest(tables, url, req);
        const n = Array.isArray(body) ? body.length : body ? 1 : 0;
        const text = req.method() === 'HEAD' ? '' : JSON.stringify(body);
        onBytes?.(table, text.length);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: {
                'content-range': n ? `0-${n - 1}/${n}` : '*/0',
                'access-control-expose-headers': 'content-range',
            },
            body: text,
        });
    };
}

/** 밖으로 나가는 것들을 막고 흉내 낸다. 화면마다 다녀오면 확인이 몇 분 걸린다. */
export async function stubOutside(target) {
    await target.route('**/realtime/v1/**', r => r.abort());
    await target.route('**fonts.googleapis.com/**', r => r.abort());
    await target.route('**fonts.gstatic.com/**', r => r.abort());
    await target.route('**cdn.jsdelivr.net/**', r => r.abort());
    await target.route('**api.open-meteo.com/**', r => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ daily: {
            weather_code: [1], temperature_2m_max: [31.4],
            temperature_2m_min: [21.8], precipitation_probability_max: [10],
        } }),
    }));
}
