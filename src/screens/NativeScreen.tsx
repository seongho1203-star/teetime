import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { NativeApp, nativeScreen } from '../lib/native-app';
import { afterPaint, TAB_PATHS, chatDragged, hasBackShot, nativeChatEnter, nativeChatLeave, nativeChatPop, nativeNavRendered, navDragged, slideLeft } from '../lib/tabs';
import { hasNativeChat } from '../lib/native-chat';
import { Members } from './Members';
import { PostDetail } from './PostDetail';
import { Alerts } from './Alerts';
import { RoundDetail } from './RoundDetail';

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

export function RoundRoute() {
    const { id } = useParams<{ id: string }>();
    const path = `/rounds/${id ?? ''}`;
    return nativeScreen(path) ? <NativeScreenHost path={path} /> : <RoundDetail />;
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
            /* rAF에만 매달지 않는다(`afterPaint`) — 앱 껍데기 뒤에서는 rAF가 안 돈다. */
            await afterPaint();
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

/**
 * **앱 껍데기(홈·탭바)와 웹을 맞춘다**(사용자 요청 — `그냥 지금 바로 홈·탭바까지
 * 앱으로 만들어줘`). 로그인이 끝난 웹이 이것을 그리면 앱이 `ShellController`를
 * 세우고, 그 뒤로 사람이 보는 것은 전부 앱 화면이다. 웹이 하는 일은 셋이다:
 *
 *  1. **세우고 내린다** — 그려지면 `shell()`, 사라지면(로그아웃) `shellOff()`.
 *     토큰이 바뀌면 `shell()`을 다시 부른다(같은 사람이면 토큰만 갈아 끼운다).
 *  2. **앱이 열어 달라는 주소를 연다** — 껍데기가 `navigate`를 보내면
 *     (`대화` 탭 · 아직 웹인 라운드·투표 상세 · 쓰는 화면) 웹이 그 주소로
 *     간다. 대화는 대화 플러그인이, 웹 화면은 `NativeNav.push`가 껍데기 위에
 *     세운다. **그 이동은 앱이 시킨 것이라 아래 3에서 되돌려 보내지 않는다.**
 *  3. **웹이 먼저 움직였으면 앱에 알린다** — 알림을 눌러 온 길은 웹의 주소만
 *     바뀌고 앱은 모른다(`sw.js`·`native-push`가 해시를 옮긴다). 탭 주소면
 *     `go`로 그 탭을 켜고, 웹 화면이면 **탭으로 되돌렸다 다시 밀어**
 *     `pushState`가 나게 한다 — 그래야 `NativeNav.push`가 page를 세운다.
 *     대화·앱 화면은 제 호스트가 알아서 연다.
 */
export function NativeShellSync() {
    const { session } = useAuth();
    const user = session?.user.id ?? '';
    const token = session?.access_token ?? '';
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const navRef = useRef(navigate);
    useEffect(() => { navRef.current = navigate; }, [navigate]);
    /** 앱이 시켜서 가는 주소 — 3에서 되돌려 보내지 않으려는 표. */
    const fromNative = useRef('');
    const prev = useRef(pathname);
    const pathRef = useRef(pathname);
    useEffect(() => { pathRef.current = pathname; }, [pathname]);

    useEffect(() => {
        if (!user || !token) return;
        void NativeApp.shell({
            user, token, path: pathRef.current,
            url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_ANON_KEY,
        }).catch(() => {});
    }, [user, token]);
    useEffect(() => () => { void NativeApp.shellOff().catch(() => {}); }, []);

    useEffect(() => {
        if (!user) return;
        let dead = false;
        let handle: { remove(): Promise<void> } | undefined;
        void NativeApp.addListener('event', e => {
            if (dead || e.screen !== 'shell') return;
            if (e.type === 'navigate' && e.data.path && NAV_OK.test(e.data.path)) {
                void NativeApp.log({ line: `열라는 주소 받음 ${e.data.path} (지금 ${window.location.hash})` }).catch(() => {});
                fromNative.current = e.data.path;
                navRef.current(e.data.path);
            }
            if (e.type === 'auth') {
                void supabase.auth.refreshSession().then(({ data }) => {
                    if (data.session && !dead) void NativeApp.session({ user, token: data.session.access_token });
                });
            }
        }).then(h => {
            handle = h; if (dead) void h.remove();
            void NativeApp.log({ line: '껍데기 듣기 붙음' }).catch(() => {});
        });
        return () => { dead = true; void handle?.remove(); };
    }, [user]);

    useEffect(() => {
        const was = prev.current;
        prev.current = pathname;
        if (fromNative.current === pathname) { fromNative.current = ''; return; }
        if (TAB_PATHS.includes(pathname)) {
            /* 탭에서 탭으로 **주소만** 바뀐 것(알림 딥링크)만 앱에 알린다.
               대화·웹 화면에서 **돌아온** 것은 앱이 이미 보고 있던 탭 그대로다 —
               웹 주소는 탭을 옮겨도 안 바뀌므로 여기서 홈으로 되돌리면 안 된다. */
            if (TAB_PATHS.includes(was) && was !== pathname) void NativeApp.go({ path: pathname }).catch(() => {});
            return;
        }
        if ((hasNativeChat() && pathname === '/chat') || nativeScreen(pathname)) return;
        /* 웹 화면인데 탭에서 곧바로 왔다(알림 딥링크) — 앱 page가 서게 다시 민다. */
        if (TAB_PATHS.includes(was) || was === pathname) {
            const target = pathname;
            fromNative.current = target;
            navRef.current('/', { replace: true });
            navRef.current(target);
        }
    }, [pathname]);

    return null;
}
