import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
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
    confirmLabel?: string;
    danger?: boolean;
}

const ConfirmContext = createContext<(ask: Ask) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [ask, setAsk] = useState<Ask | null>(null);
    const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

    const confirm = useCallback((next: Ask) => {
        setAsk(next);
        return new Promise<boolean>(resolve => setResolver(() => resolve));
    }, []);

    const close = (value: boolean) => {
        resolver?.(value);
        setAsk(null);
        setResolver(null);
    };

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
