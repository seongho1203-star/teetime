import {
    createContext, useContext, useEffect, useMemo, useState,
    type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, Role } from './types';

/** DB의 `is_member()` · `is_admin()`과 짝이다. 한쪽만 고치지 말 것. */
const MEMBERS: Role[] = ['member', 'treasurer', 'staff', 'admin', 'superadmin'];
const STAFF_UP: Role[] = ['staff', 'admin', 'superadmin'];

/**
 * 로그인 상태와 내 프로필을 앱 전체에 공급한다.
 *
 * 카카오 로그인만으로는 부족하다. 링크만 알면 누구나 로그인할 수 있으므로,
 * **profiles.role 이 'member' 이상이어야 실제 회원**이다.
 * 그 전까지는 `승인 대기` 화면만 보인다.
 */

interface AuthValue {
    session: Session | null;
    profile: Profile | null;
    loading: boolean;
    isMember: boolean;
    /** 운영진 — 운영자와 부운영자. 하는 일이 같아 한 이름으로 묶는다. */
    isAdmin: boolean;
    /** 운영자 한 사람. 부운영자를 임명·해임할 수 있다. */
    /** 방장(운영자·앱관리자). 부운영자·총무를 임명한다. */
    isOwner: boolean;
    /** 앱관리자. 운영자를 임명한다. */
    isSuper: boolean;
    /** 프로필을 다시 읽는다 (승인 뒤 새로고침 없이 반영하려고). */
    refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({
    session: null, profile: null, loading: true,
    isMember: false, isAdmin: false, isOwner: false, isSuper: false,
    refresh: async () => {},
});

/**
 * 대기 상태의 프로필을 만든다.
 *
 * 이름은 카카오가 준 것을 그대로 쓴다 — 운영진이 명단에서 누군지
 * 알아보려면 이름이 있어야 한다. 만들지 못하면 null을 돌려주고,
 * 화면은 지금까지처럼 '승인 대기중'에 머문다.
 */
async function createPending(session: Session): Promise<Profile | null> {
    const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
    const name = [meta.name, meta.full_name, meta.preferred_username]
        .find(v => typeof v === 'string' && v) as string | undefined;

    const { data, error } = await supabase.from('profiles').insert({
        id: session.user.id,
        name: name ?? '',
        avatar_url: (meta.avatar_url as string) ?? null,
        role: 'pending',
    }).select('*').maybeSingle();

    if (error) {
        console.error('[teetime] 프로필 생성 실패', error.message);
        return null;
    }
    return data ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    // 세션과 프로필을 둘 다 확인하기 전에는 화면을 정하지 않는다.
    // 하나만 보고 정하면 로그인한 사람에게 로그인 화면이 한 번 번쩍인다.
    const [sessionReady, setSessionReady] = useState(false);
    const [profileReady, setProfileReady] = useState(false);

    useEffect(() => {
        let alive = true;

        supabase.auth.getSession().then(({ data }) => {
            if (!alive) return;
            setSession(data.session);
            setSessionReady(true);
        });

        const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
            if (!alive) return;
            setSession(s);
            setSessionReady(true);
        });

        return () => { alive = false; sub.subscription.unsubscribe(); };
    }, []);

    // 세션이 생기거나 바뀌면 프로필을 읽는다.
    useEffect(() => {
        let alive = true;
        const uid = session?.user?.id;

        if (!uid) {
            setProfile(null);
            setProfileReady(sessionReady);
            return;
        }

        setProfileReady(false);
        (async () => {
            const { data, error } = await supabase
                .from('profiles').select('*').eq('id', uid).maybeSingle();
            if (!alive) return;
            if (error) console.error('[teetime] 프로필 조회 실패', error.message);

            // **행이 없으면 다시 만든다.** 로그인 트리거는 카카오 계정이
            // 처음 생길 때만 돈다. 운영진이 명단에서 지운 사람은 계정이
            // 남아 있어 트리거가 안 돌고, 프로필도 없어 어느 화면에도 못
            // 들어가는 상태가 됐다. 여기서 대기 상태로 되살려 가입 신청부터
            // 다시 하게 한다 (운영진에게 신청 알림도 그때 간다).
            const row = data ?? await createPending(session!);
            setProfile(row);
            setProfileReady(true);
        })();

        return () => { alive = false; };
        // session 통째로가 아니라 **사람이 바뀔 때만** 다시 읽는다. 토큰이
        // 조용히 갱신될 때마다 다시 읽으면 화면이 로딩으로 깜빡인다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.user?.id, sessionReady]);

    // 승인은 관리자가 다른 기기에서 한다. 내 profiles 행이 바뀌면 바로 반영해
    // 대기 화면에 앉아 있던 사람이 새로고침 없이 들어오게 한다.
    useEffect(() => {
        const uid = session?.user?.id;
        if (!uid) return;

        const channel = supabase
            .channel(`profile:${uid}`)
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
                payload => setProfile(payload.new as Profile))
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [session?.user?.id]);

    const refresh = async () => {
        const uid = session?.user?.id;
        if (!uid) return;
        const { data } = await supabase
            .from('profiles').select('*').eq('id', uid).maybeSingle();
        setProfile(data ?? null);
    };

    const value = useMemo<AuthValue>(() => ({
        session,
        profile,
        loading: !sessionReady || !profileReady,
        // DB의 is_member() · is_admin() · is_owner()와 **같은 잣대여야 한다.**
        // 화면만 열어 두면 눌렀을 때 정책에 막히고, 화면만 닫아 두면
        // 할 수 있는 일을 못 하게 된다.
        isMember: MEMBERS.includes(profile?.role as Role),
        isAdmin: STAFF_UP.includes(profile?.role as Role),
        isOwner: profile?.role === 'admin' || profile?.role === 'superadmin',
        isSuper: profile?.role === 'superadmin',
        refresh,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [session, profile, sessionReady, profileReady]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
