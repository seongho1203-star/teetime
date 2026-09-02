import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Contact, Person, Profile } from './types';

/**
 * 화면마다 같은 코드를 쓰지 않으려고 둔 조회 도우미.
 *
 * `useAsync`는 불러오기 상태(로딩·오류·다시 불러오기)를 들고 있고,
 * `useRealtime`은 그 테이블이 바뀌면 다시 불러오게 한다.
 */

interface AsyncState<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    reload: () => void;
}

/* ── 마지막으로 받은 것을 기억해 둔다 ────────────────────────────
 *
 * 탭을 넘길 때마다 화면이 새로 만들어지며 자료를 다시 물어보는데, 그
 * 답을 기다리는 동안 빈 화면에 스피너가 돈다. **그 기다림이 통째로
 * 인터넷 왕복 시간이다** — 재 봤더니 왕복 0ms일 때 10~58ms, 150ms일 때
 * 190ms, 300ms일 때 340ms였다. 앱이 느린 게 아니라 서버에 다녀오는
 * 시간이다(그래서 **앱으로 감싸도 이건 안 없어진다**).
 *
 * 그래서 **아까 본 것을 먼저 보여 주고 뒤에서 새로 받는다.** 화면들이
 * 이미 `loading && !data`로 스피너를 띄우므로, 처음 값만 채워 주면
 * 기다림이 사라진다.
 *
 * 두 가지를 조심할 것:
 *
 * - **로그아웃할 때 반드시 비운다**(`clearAsyncCache`). 안 그러면 한
 *   기기에서 사람이 바뀔 때 **앞사람이 보던 명단·대화가 그대로 뜬다.**
 * - **대화·수정 화면은 안 쓴다.** 대화는 안 읽음 줄과 스크롤이 얽혀
 *   있고, 수정 화면은 옛 값을 폼에 채우면 그대로 저장될 수 있다.
 */
const CACHE_MAX = 30;
const cache = new Map<string, unknown>();

function readCache<T>(key: string): T | undefined {
    if (!cache.has(key)) return undefined;
    const v = cache.get(key) as T;
    // 쓴 것을 맨 뒤로 옮긴다 — 넘칠 때 오래된 것부터 버리려는 것이다.
    cache.delete(key);
    cache.set(key, v);
    return v;
}

function writeCache(key: string, v: unknown) {
    cache.delete(key);
    cache.set(key, v);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** 기억해 둔 것을 통째로 버린다. **남의 자료가 남아 있으면 안 된다.** */
export function clearAsyncCache() {
    cache.clear();
}

/* **사람이 바뀌면 기억한 것을 버린다.**
 *
 * 로그아웃 단추를 누르는 자리에서 지우면 빠뜨리는 길이 생긴다 — 토큰이
 * 만료돼 저절로 풀리는 경우도 있고, 한 폰을 둘이 쓰며 갈아타는 경우도
 * 있다. 그래서 **로그인 상태가 바뀌는 곳 한 군데**에서 지운다.
 * (`supabase.ts`가 이 파일을 부르게 하면 두 파일이 서로 물고 돈다.)
 */
let seenUser: string | undefined;
supabase.auth.onAuthStateChange((_event, session) => {
    const uid = session?.user?.id;
    if (uid !== seenUser) {
        seenUser = uid;
        cache.clear();
    }
});

/**
 * @param cacheKey 주면 마지막 결과를 기억해 두었다가 다음에 먼저 보여 준다.
 *   화면마다 다른 글자여야 하고, 상세 화면은 `round:{id}`처럼 id를 붙인다.
 *   안 주면 예전처럼 매번 빈 화면에서 시작한다.
 */
export function useAsync<T>(
    fn: () => Promise<T>, deps: unknown[] = [], cacheKey?: string,
): AsyncState<T> {
    const [data, setData] = useState<T | null>(
        () => (cacheKey ? readCache<T>(cacheKey) ?? null : null));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    // fn은 화면이 그려질 때마다 새로 만들어진다. deps로만 다시 돌게 하려고
    // ref에 담아 둔다. **그리는 중에 ref를 쓰지 않는다** — 이 갱신 effect를
    // 아래 조회 effect보다 먼저 선언해 둬야 순서가 맞는다.
    const fnRef = useRef(fn);
    useEffect(() => { fnRef.current = fn; });

    const keyRef = useRef(cacheKey);

    useEffect(() => {
        let alive = true;
        /* **키가 바뀌면 앞 화면 내용을 그대로 두면 안 된다.** 라운드 상세는
           주소만 바뀌고 화면은 그대로 살아 있어서(리액트가 다시 안 만든다),
           안 지우면 6차를 눌렀는데 5차 내용이 남는다. */
        if (keyRef.current !== cacheKey) {
            keyRef.current = cacheKey;
            setData(cacheKey ? readCache<T>(cacheKey) ?? null : null);
        }
        setLoading(true);
        fnRef.current()
            .then(v => {
                if (!alive) return;
                setData(v);
                setError(null);
                if (cacheKey) writeCache(cacheKey, v);
            })
            .catch(e => { if (alive) setError(e?.message ?? String(e)); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, tick, cacheKey]);

    const reload = useCallback(() => setTick(t => t + 1), []);
    return { data, loading, error, reload };
}

/**
 * 테이블이 바뀌면 `onChange`를 부른다.
 *
 * 바뀐 내용을 직접 반영하지 않고 **다시 불러오는** 쪽을 골랐다.
 * 신청 하나가 들어오면 대기자가 확정으로 바뀌는 식으로 다른 행까지
 * 함께 움직이기 때문에, 들어온 행만 갈아 끼우면 화면이 어긋난다.
 *
 * 여러 사람이 연달아 누르면 이벤트가 몰아치므로 250ms 모아서 한 번만 부른다.
 */
export function useRealtime(
    tables: string | string[],
    onChange: () => void,
    filter?: string
) {
    const cbRef = useRef(onChange);
    useEffect(() => { cbRef.current = onChange; });

    // 배열은 매번 새로 만들어지므로 그대로는 의존성이 될 수 없다.
    // 문자열 하나로 눌러 두고, effect 안에서 다시 편다.
    const key = (Array.isArray(tables) ? tables : [tables]).join(',');

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const fire = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => cbRef.current(), 250);
        };

        const channel = supabase.channel(`live:${key}:${Math.random().toString(36).slice(2)}`);
        for (const table of key.split(',')) {
            channel.on(
                'postgres_changes',
                { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
                fire
            );
        }
        channel.subscribe();

        return () => {
            if (timer) clearTimeout(timer);
            supabase.removeChannel(channel);
        };
    }, [key, filter]);
}

/** 조회 결과에서 오류를 던져 useAsync가 잡게 한다. */
export function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
    if (error) throw new Error(error.message);
    return data as T;
}

/* ── 자주 쓰는 조회 ───────────────────────────────────────── */

/**
 * 명단 전체를 **모든 칸까지** 받는다.
 *
 * **`회원 명단` 화면에서만 쓴다** — 가입일·메모를 보는 곳이 거기뿐이다.
 * 다른 화면은 아래 `fetchPeople()`을 쓸 것.
 * **전화번호·차량번호는 여기 안 온다** — 다른 표에 있다(`fetchContacts`).
 */
export async function fetchProfiles(): Promise<Profile[]> {
    return unwrap(
        await supabase.from('profiles').select('*').order('name')
    ) ?? [];
}

/** 이름표에 필요한 칸. 여기 없는 칸은 100명분씩 화면마다 따라다닌다. */
const PERSON_COLS = 'id, name, avatar_url, role, gender, birth_year, region';

/**
 * 이름표를 붙일 때 쓰는 가벼운 명단.
 *
 * 거의 모든 화면이 남의 이름과 얼굴을 붙이려고 명단을 받는데, 가입일·메모까지
 * 따라오면 100명 기준 **화면마다 64KB**다(`node .dev/scale.mjs 100`의
 * `회원 명단`). 쓰는 칸만 받으면 **38.5KB**로 준다. 무료 통신량이 월 5GB라
 * 이 차이가 크다. 이름표에 태어난 해·거주지역이 들어가면서 35.7KB에서
 * 2.8KB 늘었고, 한 달 어림은 1.20GB 그대로다.
 *
 * **칸이 없는 저장소에서는 좁은 목록으로 물러난다.** `schema.sql`은 사람이
 * 손으로 붙여넣으므로 앱이 며칠 먼저 올라가 있을 수 있는데, 그때 없는 칸을
 * 달라고 하면 PostgREST가 오류를 주고 `unwrap`이 그걸 던져 **명단을 받는
 * 화면이 전부 죽는다**(홈·대화·라운드·투표 다 받는다). 그 한 번만 왕복이
 * 하나 더 늘고, 이름표는 닉네임만으로 나온다.
 */
export async function fetchPeople(): Promise<Person[]> {
    const wide = await supabase.from('profiles').select(PERSON_COLS).order('name');
    if (!wide.error) return (wide.data ?? []) as Person[];
    return unwrap(
        await supabase.from('profiles').select('id, name, avatar_url, role').order('name')
    ) ?? [];
}

/**
 * 전화번호·차량번호. **정책이 알아서 좁혀 준다** —
 * 운영진이면 전원, 그 밖에는 **본인 한 줄**만 돌아온다.
 *
 * 화면에서 감추는 것이 아니라 애초에 안 실려 오는 것이 요점이다
 * (`profile_private` · schema.sql). 표가 아직 없는 저장소에서는 오류를
 * 던지지 않고 빈 목록으로 물러난다 — 전화번호 한 줄 때문에 화면이
 * 통째로 안 열리면 안 된다.
 */
export async function fetchContacts(): Promise<Contact[]> {
    const { data, error } = await supabase.from('profile_private').select('id, phone, car');
    return error ? [] : (data ?? []);
}

/**
 * **끝났는데 아직 결과를 안 알린 투표**를 대화방에 알리게 한다.
 *
 * 손으로 `마감`을 누르면 DB 트리거가 곧바로 남기지만, **마감 시각이 지나
 * 끝나는 것은 DB에서 아무 일도 안 일어난다** — 시간이 흐르는 것은 사건이
 * 아니다. 그래서 투표를 받아 보는 화면이 그런 것을 보면 여기서 부른다.
 * 정해진 시각에 도는 것(pg_cron)을 새로 켜지 않으려는 것이고, 아무도 앱을
 * 안 열었으면 볼 사람도 없으므로 늦어도 탈이 없다.
 *
 * **여러 사람이 동시에 열어도 한 줄만 남는다** — DB 함수가 행을 잠그고
 * 도장(`result_at`)을 보고 나서 넣는다. 여기 `tried`는 그 위에 얹은
 * 예의일 뿐이다: 실시간 이벤트로 화면이 다시 그려질 때마다 같은 투표에
 * 헛걸음을 보내지 않게 한다.
 *
 * **`result_at`이 `undefined`면 아무것도 안 한다** — 스키마를 아직 다시
 * 안 돌린 저장소라 그 함수도 없다.
 */
const tried = new Set<string>();
export async function announceClosedPolls(
    polls: { id: string; closed: boolean; closes_at: string | null; result_at?: string | null }[],
) {
    for (const p of polls) {
        if (p.result_at !== null) continue;          // 이미 알렸거나 칸이 없다
        if (!(p.closed || (p.closes_at && p.closes_at < new Date().toISOString()))) continue;
        if (tried.has(p.id)) continue;
        tried.add(p.id);
        await supabase.rpc('post_poll_result', { p_poll: p.id });
    }
}

/**
 * 내 프로필을 저장한다. **두 표에 나뉘어 있으므로 여기 한 곳에서만 쓴다** —
 * 가입 화면 · `내 정보` · 로그인 뒤 `FillProfile` 셋이 같이 부른다.
 * 화면마다 따로 적으면 한쪽만 고치게 된다.
 *
 * **`profiles`를 먼저 쓴다.** 첫 앱관리자를 가려내는 트리거가
 * `profile_private`에 걸려 있고 이름은 `profiles`에서 읽으므로, 순서가
 * 바뀌면 방금 고친 이름을 못 보고 지나간다(schema.sql의 `claim_superadmin`).
 *
 * 오류는 던지지 않고 돌려준다 — 화면이 토스트로 보여 줘야 한다.
 */
export async function saveMyProfile(
    uid: string,
    fields: Partial<Pick<Profile, 'name' | 'region' | 'gender' | 'birth_year'>>,
    contact?: { phone: string; car: string },
): Promise<{ message: string } | null> {
    const { error } = await supabase.from('profiles').update(fields).eq('id', uid);
    if (error) return error;
    if (!contact) return null;
    const priv = await supabase.from('profile_private')
        .upsert({ id: uid, ...contact }, { onConflict: 'id' });
    return priv.error ?? null;
}

/** id → 프로필. 명단을 한 번만 읽고 여기저기서 이름을 붙일 때 쓴다. */
export function byId<T extends { id: string }>(list: T[]): Record<string, T> {
    const map: Record<string, T> = {};
    for (const p of list) map[p.id] = p;
    return map;
}
