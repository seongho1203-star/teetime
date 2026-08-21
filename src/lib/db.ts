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

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    // fn은 화면이 그려질 때마다 새로 만들어진다. deps로만 다시 돌게 하려고
    // ref에 담아 둔다. **그리는 중에 ref를 쓰지 않는다** — 이 갱신 effect를
    // 아래 조회 effect보다 먼저 선언해 둬야 순서가 맞는다.
    const fnRef = useRef(fn);
    useEffect(() => { fnRef.current = fn; });

    useEffect(() => {
        let alive = true;
        setLoading(true);
        fnRef.current()
            .then(v => { if (alive) { setData(v); setError(null); } })
            .catch(e => { if (alive) setError(e?.message ?? String(e)); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, tick]);

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
