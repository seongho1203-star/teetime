import {
    createContext, useCallback, useContext, useRef, useState,
    type ReactNode,
} from 'react';
import './Toast.css';

type Kind = 'ok' | 'error' | 'info';
interface Item { id: number; text: string; kind: Kind; }

const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<Item[]>([]);
    const nextId = useRef(1);

    const show = useCallback((text: string, kind: Kind = 'info') => {
        const id = nextId.current++;
        setItems(prev => [...prev, { id, text, kind }]);
        setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), 2800);
    }, []);

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
