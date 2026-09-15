import {
    createContext, useCallback, useContext, useRef, useState,
    type ReactNode,
} from 'react';
import { canNativeToast, showNativeToast } from '../lib/composer';
import './Toast.css';

type Kind = 'ok' | 'error' | 'info';
interface Item { id: number; text: string; kind: Kind; }

const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<Item[]>([]);
    const nextId = useRef(1);

    const web = useCallback((text: string, kind: Kind) => {
        const id = nextId.current++;
        setItems(prev => [...prev, { id, text, kind }]);
        setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 2800);
    }, []);

    /**
     * **바가 아래를 덮고 있으면 앱에게 맡긴다**(29판 · `lib/composer.ts`).
     * 네이티브 바와 앱 목록은 웹뷰 **위에 얹힌 앱 부품**이라 웹의
     * `z-index`로는 못 덮는다 — 그 화면에서는 웹 토스트가 그 뒤에 깔린다.
     *
     * **앱이 못 하면 그 자리에서 웹으로 그린다** — 안 뜨는 것보다 위쪽에라도
     * 뜨는 것이 낫다(`Toast.css`의 예비 길이 머리말 자리로 올려 준다).
     */
    const show = useCallback((text: string, kind: Kind = 'info') => {
        if (!canNativeToast()) { web(text, kind); return; }
        showNativeToast(text, kind).then(ok => { if (!ok) web(text, kind); });
    }, [web]);

    return (
        <ToastContext.Provider value={show}>
            {children}
            <div className="toast-stack" role="status" aria-live="polite">
                {items.map(t => (
                    <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastContext);
