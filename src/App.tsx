import { useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { watchBadge } from './lib/badge';
import { isConfigured } from './lib/supabase';
import { needsBirthday, needsProfile } from './lib/types';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import { TabBar } from './components/TabBar';
import { useBackSwipe, useScreenSlide } from './lib/tabs';
import { useKeyboardChrome } from './lib/keyboard';

import { Login } from './screens/Login';
import { Pending } from './screens/Pending';
import { FillProfile } from './screens/FillProfile';
import { Home } from './screens/Home';
import { Rounds } from './screens/Rounds';
import { RoundEdit } from './screens/RoundEdit';
import { RoundGroups } from './screens/RoundGroups';
import { Polls } from './screens/Polls';
import { PollEdit } from './screens/PollEdit';
import { Board } from './screens/Board';
import { PostEdit } from './screens/PostEdit';
import { ChatRoute } from './screens/NativeChat';
import { hasNativeChat, resetNativeChat } from './lib/native-chat';
import { Me } from './screens/Me';
import { AlertsRoute, MembersRoute, NativeShellSync, PollRoute, PostRoute, RoundRoute } from './screens/NativeScreen';
import { hasNativeApp, hasAndroidNativeV2, openAndroidNativeV2 } from './lib/native-app';
import { Settle } from './screens/Settle';
import { Help } from './screens/Help';

/**
 * 라우팅은 **해시 방식**(`/#/rounds`)을 쓴다.
 *
 * 이유가 둘이다.
 *  1. GitHub Pages 같은 정적 서버는 `/rounds`로 직접 들어오면 404를 낸다.
 *     해시 뒤는 서버로 가지 않으므로 그런 설정이 아예 필요 없다.
 *  2. 나중에 Capacitor로 감싸 스토어에 낼 때, 앱 안에서는 파일을 직접
 *     띄우므로 경로 라우팅이 깨진다. 해시는 그대로 동작한다.
 *
 * 지금 편하자고 BrowserRouter로 바꾸면 그때 전부 다시 손봐야 한다.
 */

function Gate() {
    const { session, profile, contact, isMember, loading } = useAuth();
    useEffect(() => {
        if (!loading && !session && hasNativeChat()) void resetNativeChat();
    }, [loading, session]);

    /* **오른쪽으로 밀면 뒤로 가고**, 화면에 들고 날 때 미끄러져 들어온다
       (`lib/tabs.ts`). 탭 사이를 미는 기능은 사용자 요청으로 걷어냈다 —
       되살리지 말 것(그 파일 머리말에 내력이 있다).
       훅은 아래 갈림길들보다 **먼저** 불러야 한다 — 렌더마다 같은 차례로
       돌아야 하기 때문이다. */
    const appRef = useRef<HTMLDivElement>(null);
    useBackSwipe();
    useScreenSlide(appRef);
    /* 키보드가 올라오면 탭바를 감추고, 글칸 밖을 누르면 내린다.
       **대화 화면은 제 셈을 따로 들고 있어 누르기로는 안 내린다.** */
    useKeyboardChrome();

    /* Android Native V2의 임시 부트스트랩.
       로그인/가입승인/필수 프로필 확인까지만 기존 웹 인증을 빌리고, 그 다음부터
       보이는 홈·라운드·투표·채팅은 Kotlin NativeHomeActivity가 맡는다.
       Native Auth가 완성되면 이 effect 자체를 제거한다. */
    const androidOpened = useRef(false);
    useEffect(() => {
        if (loading || !session || !hasAndroidNativeV2()) return;
        /* 로그인만 성립하면 Android Native V2가 이후 가입대기/필수프로필/회원
           gate까지 맡는다. 디자인은 기존 Pending/FillProfile 흐름을 그대로
           재현하고 WebView는 최초 OAuth를 마칠 때까지만 남긴다. */
        if (androidOpened.current) return;
        androidOpened.current = true;
        void openAndroidNativeV2(
            session.user.id,
            session.access_token,
            session.refresh_token,
            session.expires_at ? session.expires_at * 1000 : Date.now() + 55 * 60 * 1000,
            profile?.name ?? '',
        )
            .catch(() => { androidOpened.current = false; });
    }, [loading, session, isMember, profile, contact]);

    if (!isConfigured) return <Setup />;

    /* 세션을 확인하는 동안. **index.html에 박아 둔 첫 화면과 같은 그림**이라,
       자바스크립트가 도착하는 순간 화면이 바뀌지 않고 그대로 이어진다.
       (규칙은 index.html의 `<style>`에 한 번만 적혀 있다.) */
    if (loading) {
        return <div className="boot" role="img" aria-label="까꿍" />;
    }

    if (!session) return <Login />;
    if (!isMember) return <Pending />;
    /* **성별·태어난 해는 필수다**(사용자가 정한 것이다). 가입 화면에서 받지만
       이 기능 이전에 승인된 분들은 그 화면을 다시 안 보므로, 로그인 뒤 앱에
       들어가기 직전에 한 번 막고 받는다. 적고 나면 다시는 안 뜬다.
       **DB에 칸이 없으면 안 막는다** — `needsProfile` 주석 참고.

       **생일의 달·날도 같은 문을 쓴다**(사용자 요청 — `첫 가입때 음력 또는
       양력 생년월일을 받고`). 그 값은 `profile_private`에 있어 `profile`이
       아니라 `contact`를 봐야 한다. 둘을 한 화면에서 함께 받으므로
       문도 하나다 — 따로 두면 저장하고 나서 또 막히는 화면이 생긴다. */
    if (needsProfile(profile) || needsBirthday(contact)) return <FillProfile />;

    return (
        <div className="app" ref={appRef}>
            {/* **앱 껍데기(홈·탭바)** — 켠 아이폰 앱에서만. 로그인이 끝난 여기서
                세우고, 로그아웃으로 이 칸이 사라지면 내린다(`NativeShellSync`). */}
            {hasNativeApp() && <NativeShellSync />}
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/rounds" element={<Rounds />} />
                <Route path="/rounds/new" element={<RoundEdit />} />
                <Route path="/rounds/:id" element={<RoundRoute />} />
                <Route path="/rounds/:id/edit" element={<RoundEdit />} />
                <Route path="/rounds/:id/groups" element={<RoundGroups />} />
                <Route path="/polls" element={<Polls />} />
                <Route path="/polls/new" element={<PollEdit />} />
                <Route path="/polls/:id" element={<PollRoute />} />
                <Route path="/polls/:id/edit" element={<PollEdit />} />
                <Route path="/board" element={<Board />} />
                <Route path="/board/new" element={<PostEdit />} />
                <Route path="/board/:id" element={<PostRoute />} />
                <Route path="/board/:id/edit" element={<PostEdit />} />
                <Route path="/chat" element={<ChatRoute />} />
                <Route path="/me" element={<Me />} />
                {/* 아이폰 앱에서 스위치가 켜져 있으면 앱이 그린다(`docs/아이폰-네이티브.md`). */}
                <Route path="/members" element={<MembersRoute />} />
                <Route path="/settle" element={<Settle />} />
                <Route path="/alerts" element={<AlertsRoute />} />
                <Route path="/help" element={<Help />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <TabBar />
        </div>
    );
}

/** .env가 비어 있을 때 — 무엇을 해야 하는지 알려 준다. */
function Setup() {
    return (
        <div className="page bare">
            <h1 className="page-title">설정이 필요합니다</h1>
            <div className="notice warn">Supabase 주소와 anon 키가 없습니다.</div>
            <p className="sm dim" style={{ lineHeight: 1.8 }}>
                저장소의 <code>.env.example</code>을 <code>.env</code>로 복사한 뒤
                두 값을 채우고 개발 서버를 다시 시작하세요.<br />
                자세한 절차는 <code>docs/설치.md</code>에 있습니다.
            </p>
        </div>
    );
}

export default function App() {
    // 앱을 보고 있는 동안에는 아이콘의 숫자를 비워 둔다.
    useEffect(watchBadge, []);

    return (
        <HashRouter>
            <AuthProvider>
                <ToastProvider>
                    <ConfirmProvider>
                        <Gate />
                    </ConfirmProvider>
                </ToastProvider>
            </AuthProvider>
        </HashRouter>
    );
}
