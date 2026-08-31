import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { watchBadge } from './lib/badge';
import { isConfigured } from './lib/supabase';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import { TabBar } from './components/TabBar';

import { Login } from './screens/Login';
import { Pending } from './screens/Pending';
import { Home } from './screens/Home';
import { Rounds } from './screens/Rounds';
import { RoundDetail } from './screens/RoundDetail';
import { RoundEdit } from './screens/RoundEdit';
import { RoundGroups } from './screens/RoundGroups';
import { Polls } from './screens/Polls';
import { PollDetail } from './screens/PollDetail';
import { PollEdit } from './screens/PollEdit';
import { Board } from './screens/Board';
import { PostDetail } from './screens/PostDetail';
import { PostEdit } from './screens/PostEdit';
import { Chat } from './screens/Chat';
import { Me } from './screens/Me';
import { Members } from './screens/Members';
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
    const { session, isMember, loading } = useAuth();
    if (!isConfigured) return <Setup />;

    /* 세션을 확인하는 동안. **index.html에 박아 둔 첫 화면과 같은 그림**이라,
       자바스크립트가 도착하는 순간 화면이 바뀌지 않고 그대로 이어진다.
       (규칙은 index.html의 `<style>`에 한 번만 적혀 있다.) */
    if (loading) {
        return <div className="boot" role="img" aria-label="까꿍" />;
    }

    if (!session) return <Login />;
    if (!isMember) return <Pending />;

    return (
        <div className="app">
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/rounds" element={<Rounds />} />
                <Route path="/rounds/new" element={<RoundEdit />} />
                <Route path="/rounds/:id" element={<RoundDetail />} />
                <Route path="/rounds/:id/edit" element={<RoundEdit />} />
                <Route path="/rounds/:id/groups" element={<RoundGroups />} />
                <Route path="/polls" element={<Polls />} />
                <Route path="/polls/new" element={<PollEdit />} />
                <Route path="/polls/:id" element={<PollDetail />} />
                <Route path="/polls/:id/edit" element={<PollEdit />} />
                <Route path="/board" element={<Board />} />
                <Route path="/board/new" element={<PostEdit />} />
                <Route path="/board/:id" element={<PostDetail />} />
                <Route path="/board/:id/edit" element={<PostEdit />} />
                <Route path="/chat" element={<Chat />} />
                <Route path="/me" element={<Me />} />
                <Route path="/members" element={<Members />} />
                <Route path="/settle" element={<Settle />} />
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
