import { useEffect, useRef, useState } from 'react';
import { useNavigate, useNavigationType } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { NativeChat, hasNativeChat, openNativeChat, closeNativeChat } from '../lib/native-chat';
import { purgeOldPhotos } from '../lib/photos';
import { STICKER_GROUPS, stickerSrc } from '../lib/stickers';
import { suggestTable, SUGGEST_MAX, SUGGEST_ANIM } from '../lib/suggest';
import { chatDragged, hasBackShot, nativeBackStart, nativeBackEnd, nativeChatEnter, nativeChatLeave, nativeChatPop, setChatShot, slideLeft } from '../lib/tabs';
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
    /* **들어온 길을 첫 렌더에서 한 번만 집는다.** 라운드·투표에서 **뒤로**
       온 것이면 들어오는 모양이 반대여야 한다(아래 `nativeChatPop`).
       효과 안에서 `useNavigationType()`을 읽으면 다시 그려질 때마다 값이
       바뀌므로 ref에 얼려 둔다(대화의 `lastSeen`과 같은 결이다). */
    const cameBack = useRef(useNavigationType() === 'POP');
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!user) return;
        const screen = crypto.randomUUID();
        let dead = false;
        let remove: (() => Promise<void>) | undefined;
        /* **앞 화면 그림을 깔고 들어간다**(`nativeChatEnter`) — 웹 쪽에
           남는 것은 자리를 지키는 스피너 한 장뿐이라, 안 깔면 들어올 때
           빈 화면이 밀려 들어오고 끌어서 뒤로 갈 때 뒤에 아무것도 없다.
           **효과가 도는 그 자리에서 곧바로 깐다** — 다리를 한 번 건넜다
           오면 그 사이에 빈 화면이 한 번 지나간다.
           **깔아 둔 그림은 가만히 있는다** — 미는 것은 앱이 그리는 대화
           화면 하나뿐이고, `ms`는 그쪽에만 넘긴다. */
        const ms = slideLeft();
        /* **라운드·투표에서 돌아온 것이면 반대로 그린다** — 떠나는 화면이
           오른쪽으로 빠져나가고 대화 화면이 그 밑에서 따라 들어온다.
           웹은 떠나는 화면을 **깔아 두기만** 하고(앱 대화 화면이 웹 DOM을
           통째로 덮으므로 웹이 내보낼 수가 없다) 미는 것은 앱이 맡는다. */
        const back = cameBack.current && nativeChatPop();
        /* **손가락으로 끌어서 온 길이면 그림이 이미 제자리에 있다**
           (`useBackSwipe`가 붙들어 둔 대화방 그림이다). 여기서 갈아 끼우면
           앱이 화면을 세우기까지 몇 프레임 동안 그 뒤가 비친다. */
        const dragged = chatDragged();
        if (!back && !dragged) nativeChatEnter();
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
                if (e.type === 'navigate' && e.data.path && /^\/(?:$|rounds(?:\/|$)|polls(?:\/|$)|board(?:\/|$)|chat$)/.test(e.data.path)) {
                    /* **앱이 떠 준 대화방 그림을 먼저 건네고 옮긴다** —
                       `snap()`이 주소가 바뀌는 그 자리에서 쓴다(`pushState`).
                       그것이 곧 라운드에서 끌어 뒤로 올 때 뒤에 깔릴 화면이다. */
                    setChatShot(e.data.shot ?? '');
                    navigate(e.data.path);
                }
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
            /* **깔아 둔 떠나는 화면이 한 번 그려진 뒤에 연다.** 앱은 열면서
               웹뷰를 그 자리에서 찍는데, 그리기 전에 찍으면 **떠나는 화면
               대신 빈 스피너가 찍혀** 나가는 그림이 통째로 흰 화면이 된다. */
            if (back) await new Promise<void>(go =>
                requestAnimationFrame(() => requestAnimationFrame(() => go())));
            if (dead) return;
            await openNativeChat(screen, {
                user, token, url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_ANON_KEY,
                seen: lastSeen('chat', user),
                /* 뒤에 깔 앞 화면이 있을 때만 끈다 — 없으면 빈 화면이
                   손을 따라 나온다. 대화방 안에서는 주소가 안 바뀌므로
                   열 때 한 번 정하면 그대로다. */
                back: hasBackShot(),
                /* 들어올 때 오른쪽에서 미끄러져 들어올 **남은 시간**
                   (웹의 `CHAT_MS`에서 이미 지난 만큼을 뺀 값이다). */
                slide: back || dragged ? 0 : ms,
                /* **뒤로 온 길**(위 `nativeChatPop`) — 앱이 웹뷰를 찍어
                   오른쪽으로 내보내고 대화 화면은 왼쪽에서 따라 들어온다. */
                pop: back ? ms : 0,
                /* 반응 그림글자는 **웹이 정한다**(`REACTIONS` — 카톡과 같은
                   다섯). 앱에 또 적으면 한쪽만 고치게 된다. */
                reactions: REACTIONS,
                stickers: STICKER_GROUPS.map(g => ({ ...g, stickers: g.stickers.map(s => ({ ...s,
                    src: new URL(stickerSrc(`sticker:${s.id}`), window.location.href).href })) })),
                /* 치는 글에 어울리는 이모티콘을 고르는 표 — **규칙은 웹에만
                   있다**(`lib/suggest.ts`). 서른 꼭지에 이백 줄이라 앱에 또
                   적으면 반드시 어긋난다. 앱은 **글에 그 말이 들었는지만**
                   본다(축하 폭죽은 말이 셋뿐이라 양쪽에 적어 두었다). */
                suggest: suggestTable(),
                suggestMax: SUGGEST_MAX,
                suggestAnim: SUGGEST_ANIM,
            });
            /* **깔아 둔 떠나는 화면을 걷고 앞 화면 그림으로 갈아 놓는다** —
               이제부터는 끌어서 뒤로 갈 때 뒤에 깔릴 그림이 필요하다.
               앱이 찍어 둔 그림이 그 사이를 덮고 있어 눈에는 안 보인다. */
            if ((back || dragged) && !dead) nativeChatEnter();
            /* **오래된 사진·동영상 청소는 여기서도 돈다**(`PHOTO_DAYS` 일주일).
               대화를 앱이 통째로 그리게 되면서 이 줄이 빠져 있었는데,
               그러면 **앱을 쓰는 사람에게는 청소가 아예 없는 것**이 된다 —
               청소를 도는 화면이 웹 대화방(`Chat.tsx`)뿐이었다.
               방 번호는 `purgeOldPhotos`가 스스로 찾고, 하루 한 번만 돈다. */
            void purgeOldPhotos();
        })().catch(e => {
            if (dead) return;
            /* **못 열었으면 깔아 둔 그림을 걷는다** — 안 걷으면 그 그림이
               아래 오류 안내를 통째로 덮어 아무 말도 안 보인다. */
            nativeChatLeave();
            setError(e instanceof Error ? e.message : '채팅을 열지 못했습니다.');
        });
        return () => {
            dead = true; nativeChatLeave();
            void remove?.(); void closeNativeChat(screen).catch(() => {});
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
