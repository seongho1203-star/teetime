import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { NativeApp, nativeScreen } from '../lib/native-app';
import { chatDragged, hasBackShot, nativeChatEnter, nativeChatLeave, nativeChatPop, nativeNavRendered, navDragged, slideLeft } from '../lib/tabs';
import { Members } from './Members';
import { PostDetail } from './PostDetail';
import { Alerts } from './Alerts';

/**
 * **주소마다 앱 화면인지 웹 화면인지 가르는 자리**(`docs/아이폰-네이티브.md`).
 * 아이폰 앱에서 스위치가 켜져 있고 앱이 그 주소를 알면 앱 화면, 아니면
 * 지금까지의 웹 화면이다 — 대화의 `ChatRoute`와 같은 결이다.
 * 화면을 하나 더 옮기면 여기 `…Route`와 `NATIVE_SCREENS`, 그리고 Swift의
 * `screens`·`make`를 함께 더한다(넷이 한 벌이다).
 */
export function MembersRoute() {
    return nativeScreen('/members') ? <NativeScreenHost path="/members" /> : <Members />;
}

export function PostRoute() {
    const { id } = useParams<{ id: string }>();
    const path = `/board/${id ?? ''}`;
    return nativeScreen(path) ? <NativeScreenHost path={path} /> : <PostDetail />;
}

export function AlertsRoute() {
    return nativeScreen('/alerts') ? <NativeScreenHost path="/alerts" /> : <Alerts />;
}

/** 앱 화면이 `navigate`로 보내올 수 있는 주소 — 그 밖은 무시한다(알림의 `url`도 이 안이다). */
const NAV_OK = /^\/(?:$|rounds(?:\/|$)|polls(?:\/|$)|board(?:\/|$)|chat$|members$|alerts$|settle$|help$|me$)/;

/**
 * 앱이 그리는 동안 **웹에 남는 것은 자리를 지키는 스피너 한 장**이다.
 * 짜임은 `NativeChat.tsx`의 `NativeChatHost`와 같다 — 앞 화면 그림을 깔고
 * (`nativeChatEnter`), 열고, `back`이 오면 뒤로 간다. 대화만의 것(읽음·
 * 이모티콘·추천 표)이 없을 뿐이다.
 */
function NativeScreenHost({ path }: { path: string }) {
    const { session } = useAuth();
    const user = session?.user.id ?? '';
    const current = useRef(session);
    useEffect(() => { current.current = session; }, [session]);
    const navigate = useNavigate();
    const cameBack = useRef(useNavigationType() === 'POP');
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useLayoutEffect(() => {
        if (!user) return;
        const screen = crypto.randomUUID();
        let dead = false;
        let remove: (() => Promise<void>) | undefined;
        const back = cameBack.current && nativeChatPop();
        const dragged = chatDragged() || navDragged();
        if (!back && !dragged) nativeChatEnter();
        const goBack = () => {
            const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
            if (idx > 0) navigate(-1); else navigate('/');
        };
        void (async () => {
            const listener = await NativeApp.addListener('event', e => {
                if (dead || e.screen !== screen) return;
                if (e.type === 'navigate' && e.data.path && NAV_OK.test(e.data.path)) {
                    navigate(e.data.path, { replace: e.data.replace === true });
                }
                if (e.type === 'back') goBack();
                if (e.type === 'auth') {
                    void supabase.auth.refreshSession().then(({ data }) => {
                        if (data.session && !dead) void NativeApp.session({ user, token: data.session.access_token });
                    });
                }
            });
            remove = () => listener.remove();
            if (dead) { await remove(); return; }
            const token = current.current?.access_token;
            if (!token) throw new Error('로그인을 확인해 주세요.');
            await new Promise<void>(go =>
                requestAnimationFrame(() => requestAnimationFrame(() => go())));
            if (dead) return;
            const ms = slideLeft();
            const result = await NativeApp.open({
                screen, path, user, token,
                url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_ANON_KEY,
                back: hasBackShot(),
                slide: back || dragged ? 0 : ms,
            });
            if (!result.ok) throw new Error('화면을 열지 못했습니다. 다시 시도해 주세요.');
            if ((back || dragged) && !dead) nativeChatEnter();
            nativeNavRendered();
        })().catch(e => {
            if (dead) return;
            nativeChatLeave();
            nativeNavRendered();
            setError(e instanceof Error ? e.message : '화면을 열지 못했습니다.');
        });
        return () => {
            dead = true; nativeChatLeave();
            void remove?.(); void NativeApp.close({ screen }).catch(() => {});
        };
    }, [user, navigate, attempt, path]);
    useEffect(() => {
        if (user && session?.access_token) void NativeApp.session({ user, token: session.access_token });
    }, [user, session?.access_token]);
    return <div className="page center-fill" aria-label="앱 화면 열기">
        {error ? <>
            <p>{error}</p>
            <p className="xs faint">계속 안 열리면 내 정보의 `시험 중: 앱 화면` 스위치를 끄면 예전 화면으로 돌아갑니다.</p>
            <button className="btn primary" onClick={() => { setError(''); setAttempt(x => x + 1); }}>다시 시도</button>
        </> : <span className="spinner" />}
    </div>;
}
