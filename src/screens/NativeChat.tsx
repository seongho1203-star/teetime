import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { NativeChat, hasNativeChat, openNativeChat, closeNativeChat } from '../lib/native-chat';
import { STICKER_GROUPS, stickerSrc } from '../lib/stickers';
import { hasBackShot, nativeBackStart, nativeBackEnd, slideLeft } from '../lib/tabs';
import { REACTIONS } from '../lib/types';
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
        /* **뒤로 갈 데가 없으면 홈으로 간다** — 알림을 눌러 `#/chat`으로
           곧바로 들어오는 길이 있어 그때는 히스토리에 앞 화면이 없다
           (웹 `Chat.tsx`의 `goBack`과 같은 잣대다). */
        const goBack = () => {
            const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
            if (idx > 0) navigate(-1); else navigate('/');
        };
        void (async () => {
            const listener = await NativeChat.addListener('event', e => {
                if (dead || e.screen !== screen) return;
                if (e.type === 'navigate' && e.data.path && /^\/(?:$|rounds(?:\/|$)|polls(?:\/|$)|board(?:\/|$)|chat$)/.test(e.data.path)) navigate(e.data.path);
                if (e.type === 'read' && e.data.at) markSeen('chat', user, e.data.at);
                /* 앱이 화면을 끌고, 뒤에 깔 앞 화면만 웹이 그린다. */
                if (e.type === 'back') {
                    if (e.data.phase === 'start') nativeBackStart();
                    if (e.data.phase === 'commit') nativeBackEnd(true, goBack);
                    if (e.data.phase === 'cancel') nativeBackEnd(false, goBack);
                    if (e.data.phase === 'plain') goBack();
                }
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
                /* 뒤에 깔 앞 화면이 있을 때만 끈다 — 없으면 빈 화면이
                   손을 따라 나온다. 대화방 안에서는 주소가 안 바뀌므로
                   열 때 한 번 정하면 그대로다. */
                back: hasBackShot(),
                /* 들어올 때 오른쪽에서 미끄러져 들어올 **남은 시간**
                   (웹의 `SCREEN_MS`에서 이미 지난 만큼을 뺀 값이다). */
                slide: slideLeft(),
                /* 반응 그림글자는 **웹이 정한다**(`REACTIONS` — 카톡과 같은
                   다섯). 앱에 또 적으면 한쪽만 고치게 된다. */
                reactions: REACTIONS,
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
