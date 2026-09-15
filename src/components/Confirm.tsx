import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { askNativeConfirm, canNativeConfirm } from '../lib/composer';
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
     * 같은 말을 **글자로만** 적은 것 — 앱이 띄울 때 쓴다(아래 참고).
     *
     * `detail`이 이미 글자면 안 적어도 된다. **꾸민 글(JSX)일 때만**
     * 필요하고, 안 적어 두면 그 창은 앱으로 안 넘어가 웹 확인창이 뜬다.
     */
    detailText?: string;
    confirmLabel?: string;
    danger?: boolean;
}

const ConfirmContext = createContext<(ask: Ask) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [ask, setAsk] = useState<Ask | null>(null);
    const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

    /**
     * **앱 목록이 화면을 덮고 있으면 앱에게 맡긴다**(30판 · `lib/composer.ts`).
     *
     * 이 창은 웹이 그리는 것이라 **앱 목록과 입력칸 뒤에 통째로 깔린다** —
     * 그래서 그동안 대화 화면이 `useConfirmUp`을 보고 **앱 목록을 감추고
     * 웹 목록을 도로 내보이는 바꿔치기**를 했는데, 두 목록은 굴린 자리가
     * 따로라 **대화가 맨 아래로 툭 내려갔다가 닫으면 도로 올라왔다**
     * (사용자 제보 · 사진). 27판에서 길게 누른 창으로 배운 그대로,
     * 값을 맞추는 대신 **바꿔치기 자체를 없앤다.**
     *
     * **못 띄우면(`null`) 그 자리에서 웹으로 그린다** — 취소(`false`)와
     * 반드시 갈라야 한다. 앱이 답을 못 주는 판에서 `취소`로 접어 버리면
     * **사용자가 고르지도 않은 답이 된다.**
     *
     * **꾸민 글(JSX)은 앱에 못 넘긴다** — `detailText`가 함께 적혀 있을
     * 때만 앱으로 가고, 없으면 예전처럼 웹 확인창이 뜬다.
     */
    const confirm = useCallback(async (next: Ask) => {
        const plain = next.detailText
            ?? (typeof next.detail === 'string' ? next.detail : undefined);
        if (canNativeConfirm() && (plain !== undefined || next.detail === undefined)) {
            const r = await askNativeConfirm({
                title: next.title,
                ...(plain !== undefined ? { detail: plain } : {}),
                ...(next.confirmLabel ? { confirmLabel: next.confirmLabel } : {}),
                danger: !!next.danger,
            });
            if (r !== null) return r;
        }
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
