import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { NativeChat, hasNativeChat, openNativeChat, closeNativeChat } from '../lib/native-chat';
import { STICKER_GROUPS, stickerSrc } from '../lib/stickers';
import { lastSeen, markSeen } from '../lib/unread';
import { Chat } from './Chat';

export function ChatRoute() {
    // New iPhones never mount the web chat component. Browser/older binaries retain it.
    return hasNativeChat() ? <NativeChatHost /> : <Chat />;
}

function NativeChatHost() {
    const { session } = useAuth();
    const user = session?.user.id ?? '';
    const current = useRef(session);
    useEffect(() => { current.current = session; }, [session]);
    const navigate = useNavigate();
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!user) return;
        const screen = crypto.randomUUID();
        let dead = false;
        let remove: (() => Promise<void>) | undefined;
        void (async () => {
            const listener = await NativeChat.addListener('event', e => {
                if (dead || e.screen !== screen) return;
                if (e.type === 'navigate' && e.data.path && /^\/(?:$|rounds(?:\/|$)|polls(?:\/|$)|board(?:\/|$)|chat$)/.test(e.data.path)) navigate(e.data.path);
                if (e.type === 'read' && e.data.at) markSeen('chat', user, e.data.at);
                if (e.type === 'auth') {
                    void supabase.auth.refreshSession().then(({ data }) => {
                        if (data.session && !dead) void NativeChat.session({ user, token: data.session.access_token });
                    });
                }
            });
            remove = () => listener.remove();
            if (dead) { await remove(); return; }
            const token = current.current?.access_token;
            if (!token) throw new Error('로그인을 확인해 주세요.');
            await openNativeChat(screen, {
                user, token, url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_ANON_KEY,
                seen: lastSeen('chat', user),
                stickers: STICKER_GROUPS.map(g => ({ ...g, stickers: g.stickers.map(s => ({ ...s,
                    src: new URL(stickerSrc(`sticker:${s.id}`), window.location.href).href })) })),
            });
        })().catch(e => { if (!dead) setError(e instanceof Error ? e.message : '채팅을 열지 못했습니다.'); });
        return () => {
            dead = true; void remove?.(); void closeNativeChat(screen).catch(() => {});
        };
    }, [user, navigate, attempt]);
    useEffect(() => {
        if (user && session?.access_token) void NativeChat.session({ user, token: session.access_token });
    }, [user, session?.access_token]);
    // This is only the opening/error placeholder, never a second chat renderer.
    return <div className="page center-fill" aria-label="대화 열기">
        {error ? <><p>{error}</p><button className="btn primary" onClick={() => { setError(''); setAttempt(x => x + 1); }}>다시 시도</button></> : <span className="spinner" />}
    </div>;
}
