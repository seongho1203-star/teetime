import { useState } from 'react';
import { signInWithKakao } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import './Login.css';

export function Login() {
    const [busy, setBusy] = useState(false);
    const toast = useToast();

    const go = async () => {
        setBusy(true);
        try {
            await signInWithKakao();
            // 성공하면 카카오로 넘어가므로 여기 아래는 실행되지 않는다.
        } catch (err) {
            toast(readableError(err), 'error');
            setBusy(false);
        }
    };

    return (
        <div className="page bare login">
            <div className="login-brand">
                {/* 앱 아이콘 그대로. 홈 화면에서 누른 그림이 첫 화면에도
                    있어야 '그 앱이 맞다'는 확인이 된다. */}
                <img className="login-mark" src="./icon-192.png" alt="" aria-hidden="true" />
                <h1>까꿍</h1>
                <p className="dim">
                    골프에 열정이 가득하신 여러분<br />환영합니다
                </p>
            </div>

            <div className="login-actions">
                <button className="kakao-btn" onClick={go} disabled={busy}>
                    {busy ? (
                        <span className="spinner" />
                    ) : (
                        <>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path fill="currentColor" d="M12 3C6.98 3 2.9 6.2 2.9 10.14c0 2.53 1.7 4.75 4.26 6.01-.19.68-.68 2.47-.78 2.85-.12.48.18.47.37.34.15-.1 2.38-1.61 3.35-2.27.62.09 1.25.14 1.9.14 5.02 0 9.1-3.2 9.1-7.07C21.1 6.2 17.02 3 12 3Z" />
                            </svg>
                            카카오로 시작하기
                        </>
                    )}
                </button>
                <p className="xs faint" style={{ textAlign: 'center', lineHeight: 1.7 }}>
                    로그인하면 운영진에게 가입 신청이 갑니다.<br />
                    승인된 뒤부터 라운드 신청을 할 수 있습니다.
                </p>
            </div>
        </div>
    );
}
