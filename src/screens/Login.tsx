import { useState } from 'react';
import { signInWithApple, signInWithKakao } from '../lib/supabase';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import './Login.css';

/** 어느 단추를 눌러 두었는가. 둘 다 잠가야 두 번 눌리지 않는다. */
type Busy = 'kakao' | 'apple' | null;

export function Login() {
    const [busy, setBusy] = useState<Busy>(null);
    const toast = useToast();

    const go = async (which: Exclude<Busy, null>) => {
        setBusy(which);
        try {
            await (which === 'kakao' ? signInWithKakao() : signInWithApple());
            // 성공하면 로그인 화면으로 넘어가므로 여기 아래는 실행되지 않는다.
        } catch (err) {
            toast(readableError(err), 'error');
            setBusy(null);
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
                <button className="kakao-btn" onClick={() => go('kakao')} disabled={!!busy}>
                    {busy === 'kakao' ? (
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

                {/* **애플 심사 4.8이 요구하는 단추다** — 카카오 같은 남의
                    로그인만 쓰는 앱에는 맞먹는 로그인을 하나 더 두라고 한다.
                    아이폰 말고 어디서도 되므로 화면을 안 가린다. */}
                <button className="apple-btn" onClick={() => go('apple')} disabled={!!busy}>
                    {busy === 'apple' ? (
                        <span className="spinner" />
                    ) : (
                        <>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path fill="currentColor" d="M17.05 12.04c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3.01-.79-1.55.02-2.98.9-3.78 2.29-1.61 2.79-.41 6.92 1.15 9.19.76 1.11 1.67 2.35 2.86 2.31 1.15-.05 1.58-.74 2.97-.74 1.39 0 1.78.74 3 .72 1.24-.02 2.02-1.13 2.78-2.24.88-1.29 1.24-2.54 1.26-2.6-.03-.01-2.41-.93-2.43-3.69M14.8 5.3c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.68-1.09 1.77-.95 2.81 1.02.08 2.06-.52 2.68-1.28" />
                            </svg>
                            Apple로 계속하기
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
