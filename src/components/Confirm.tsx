import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { setConfirmUp } from '../lib/overlay';
import './Confirm.css';

/**
 * 되돌리기 어려운 일을 하기 전에 한 번 더 묻는 창.
 *
 * `window.confirm`을 쓰지 않는 이유가 둘이다 — 앱 안(Capacitor)에서
 * 모양이 제각각이고, 무엇이 사라지는지 여러 줄로 보여 줄 수가 없다.
 */

interface Ask {
    title: string;
    detail?: ReactNode;
    /**
     * 같은 말을 **글자로만** 적은 것.
     *
     * 한동안 앱이 대신 띄우던 판(30판)이 이 값을 썼다. 그 길은 대화가
     * 통째로 앱 화면이 되면서 없어졌지만(`screens/NativeChat.tsx`),
     * **꾸민 글(JSX) 옆에 같은 말을 글자로 남겨 두는 것 자체가 값이라**
     * 칸은 그대로 둔다 — 적어 두는 곳도 그대로다.
     */
    detailText?: string;
    confirmLabel?: string;
    danger?: boolean;
}

const ConfirmContext = createContext<(ask: Ask) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [ask, setAsk] = useState<Ask | null>(null);
    const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

    const confirm = useCallback(async (next: Ask) => {
        setAsk(next);
        return new Promise<boolean>(resolve => setResolver(() => resolve));
    }, []);

    const close = (value: boolean) => {
        resolver?.(value);
        setAsk(null);
        setResolver(null);
    };

    /**
     * **떠 있다는 사실을 밖에 알린다**(`lib/overlay.ts`).
     *
     * 앱에서 대화 목록과 입력칸은 웹뷰 **위에 얹힌 앱 부품**이라 이 창이
     * 그 뒤에 통째로 깔린다 — `가리기`·`삭제`가 눌러도 아무 일이 없어
     * 보이던 자리가 그것이다. **여기서 직접 감추지는 않는다**: 감췄다
     * 도로 내보이는 일의 주인이 둘이 되면, 사진을 크게 본 채로 뜬 창을
     * 닫을 때 그 위로 입력칸이 도로 올라온다.
     */
    useEffect(() => {
        setConfirmUp(!!ask);
        return () => setConfirmUp(false);
    }, [ask]);

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            {ask && (
                <div className="confirm-back" onClick={() => close(false)}>
                    <div className="confirm-box" onClick={e => e.stopPropagation()}>
                        <div className="confirm-title">{ask.title}</div>
                        {ask.detail && <div className="confirm-detail">{ask.detail}</div>}
                        <div className="confirm-actions">
                            <button className="btn ghost grow" onClick={() => close(false)}>
                                취소
                            </button>
                            <button
                                className={`btn grow ${ask.danger ? 'confirm-danger' : 'primary'}`}
                                onClick={() => close(true)}
                            >
                                {ask.confirmLabel ?? '확인'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ConfirmContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useConfirm = () => useContext(ConfirmContext);
