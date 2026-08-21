import {
    createContext, useContext, useEffect, useMemo, useState,
    type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from './types';

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
    isAdmin: boolean;
    /** 프로필을 다시 읽는다 (승인 뒤 새로고침 없이 반영하려고). */
    refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({
    session: null, profile: null, loading: true,
    isMember: false, isAdmin: false,
    refresh: async () => {},
});

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
            setProfile(data ?? null);
            setProfileReady(true);
        })();

        return () => { alive = false; };
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
        isMember: profile?.role === 'member' || profile?.role === 'admin',
        isAdmin: profile?.role === 'admin',
        refresh,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [session, profile, sessionReady, profileReady]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
