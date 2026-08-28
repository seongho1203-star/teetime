import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Profile } from './types';

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

export async function fetchProfiles(): Promise<Profile[]> {
    return unwrap(
        await supabase.from('profiles').select('*').order('name')
    ) ?? [];
}

/** id → 프로필. 명단을 한 번만 읽고 여기저기서 이름을 붙일 때 쓴다. */
export function byId(list: Profile[]): Record<string, Profile> {
    const map: Record<string, Profile> = {};
    for (const p of list) map[p.id] = p;
    return map;
}
