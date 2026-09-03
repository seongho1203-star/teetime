import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../components/TopBar';

/**
 * **글칸 깜빡임을 폰에서 재는 임시 화면이다.** 다 가려지면 통째로 지운다
 * (`App.tsx`의 route와 `Me.tsx`의 들어가는 줄도 함께).
 *
 * `광`을 칠 때 글씨가 깜빡인다는 제보를 **세 번 헛짚었다.** 헤드리스에는
 * 한글 자판이 없어 흉내로만 확인했고, 그 흉내가 실기기와 달랐다
 * (CDP는 조합 이벤트를 주는데 천지인은 안 준다). 그래서 이제
 * **폰에서 직접 가른다** — 칸 셋을 나란히 놓고 어느 것이 깜빡이는지만
 * 보면 원인이 셋 중 하나로 좁혀진다:
 *
 * ① 맨 칸이 깜빡인다        → 우리 코드도 글꼴도 아니다. iOS/WebKit 자체다.
 * ② 앱 글꼴 칸만 깜빡인다   → 글꼴을 글자마다 받아 오는 것이 원인이다.
 * ③ 대화창 칸만 깜빡인다    → 우리 코드나 CSS다.
 *
 * **①은 아무 코드도 안 붙어 있어야 뜻이 있다.** 이벤트 기록도 ③에만
 * 붙이고, 그 기록조차 화면을 다시 그리지 않게 ref에만 쌓는다 —
 * 재는 행위가 재려는 것을 흔들면 안 된다.
 */
type Line = { at: number; kind: string; value: string };

export function KbTest() {
    const log = useRef<Line[]>([]);
    const [shown, setShown] = useState<Line[] | null>(null);
    const appBox = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const el = appBox.current;
        if (!el) return;
        const t0 = performance.now();
        const put = (kind: string) => log.current.push({
            at: Math.round(performance.now() - t0), kind, value: el.value });
        const on: [string, () => void][] = [
            ['compositionstart', () => put('조합 시작')],
            ['compositionupdate', () => put('조합 중')],
            ['compositionend',   () => put('조합 끝')],
            ['input',            () => put('input')],
            ['beforeinput',      () => put('beforeinput')],
        ];
        for (const [name, fn] of on) el.addEventListener(name, fn);
        return () => { for (const [name, fn] of on) el.removeEventListener(name, fn); };
    }, []);

    /* ③만 대화창과 같은 방식으로 칸이 늘어나게 해 둔다(다음 프레임에 잰다). */
    const growAt = useRef(0);
    const grow = () => {
        if (growAt.current) return;
        growAt.current = requestAnimationFrame(() => {
            growAt.current = 0;
            const el = appBox.current;
            if (!el) return;
            const need = el.scrollHeight + (el.offsetHeight - el.clientHeight);
            if (need > el.offsetHeight) el.style.height = `${need}px`;
        });
    };

    const bare: React.CSSProperties = {
        display: 'block', width: '100%', boxSizing: 'border-box',
        fontSize: 16, lineHeight: 1.4, padding: '10px 12px',
        border: '1px solid #ccc', borderRadius: 10, resize: 'none',
    };

    return (
        <div className="page">
            <TopBar title="글칸 시험" fallback="/me" />
            <div style={{ display: 'grid', gap: 14, padding: '0 14px 24px' }}>
                <p className="xs faint" style={{ margin: 0 }}>
                    칸마다 <b>광산</b>을 쳐 보시고, <b>어느 칸에서 글씨가
                    깜빡이는지</b>만 알려 주세요. 판 {__BUILD__}
                </p>

                <div>
                    <p className="xs" style={{ margin: '0 0 4px' }}>
                        <b>① 맨 칸</b> — 아무 코드도 안 붙었고 폰 글꼴입니다
                    </p>
                    <textarea rows={2} style={{ ...bare, fontFamily: '-apple-system, sans-serif' }} />
                </div>

                <div>
                    <p className="xs" style={{ margin: '0 0 4px' }}>
                        <b>② 맨 칸 + 앱 글꼴</b> — 코드는 없고 글꼴만 앱 것입니다
                    </p>
                    <textarea rows={2} style={bare} />
                </div>

                <div>
                    <p className="xs" style={{ margin: '0 0 4px' }}>
                        <b>③ 대화창과 같은 칸</b> — 실제 대화 입력칸과 같은 방식입니다
                    </p>
                    <div className="chat-field">
                        <textarea ref={appBox} className="textarea" rows={1}
                                  onChange={grow} aria-label="시험 입력" />
                    </div>
                </div>

                <button className="btn ghost block"
                        onClick={() => setShown([...log.current])}>
                    ③에서 일어난 일 보기
                </button>
                {shown && (
                    <pre className="xs" style={{
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        background: 'var(--surface-2)', padding: 10, borderRadius: 10,
                        maxHeight: 320, overflow: 'auto', margin: 0,
                    }}>
                        {shown.length === 0 ? '(아직 없습니다 — ③에 글을 쳐 보세요)'
                            : shown.map(l => `${l.at}ms  ${l.kind}  "${l.value}"`).join('\n')}
                    </pre>
                )}
                <button className="btn ghost block"
                        onClick={() => { log.current = []; setShown(null); }}>
                    기록 지우기
                </button>
            </div>
        </div>
    );
}
