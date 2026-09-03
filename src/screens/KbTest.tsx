import { useEffect, useRef, useState } from 'react';
import { TopBar } from '../components/TopBar';

/**
 * **글칸 깜빡임을 폰에서 재는 임시 화면이다.** 다 가려지면 통째로 지운다
 * (`App.tsx`의 route와 `Me.tsx`의 들어가는 줄·판 표시도 함께).
 *
 * ── 1차에서 가려진 것 ────────────────────────────────────────────
 * 칸 셋(맨 칸 · 앱 글꼴 · 대화창과 같은 칸)이 **똑같이 깜빡였다.**
 * ①은 자바스크립트가 한 줄도 안 붙은 맨 칸이므로 **우리 코드도 글꼴도
 * 원인이 아니다.** 기록이 이유를 그대로 보여 줬다 — 아이폰 천지인은
 * 조합(marked text)을 **아예 안 쓴다.** `ㄱ·`을 `고`로 바꿀 때
 * `ㄱ·` → `ㄱ` → `` → `고`로 **칸을 진짜 비웠다가 다시 채운다.**
 * 그 빈 상태가 5~8ms 이어져서, 화면이 그 사이에 한 번 그려지면 깜빡인다.
 * (조합 이벤트는 한 줄도 안 왔다. 헤드리스 흉내는 그걸 줘서 초록이었다.)
 *
 * ── 2차에서 가리려는 것 ──────────────────────────────────────────
 * 그 비웠다 채우는 짓을 **덜 하게 하는 길이 있는가.** 셋을 더 놓았다:
 * ④ 자동수정을 끈 칸 · ⑤ `<input>` 한 줄 칸 · ⑥ `contenteditable`.
 * 하나라도 안 깜빡이면 그 방식으로 대화 입력칸을 바꾸면 된다.
 * 여섯이 다 깜빡이면 **웹에서 할 수 있는 일이 없다**(카톡은 네이티브
 * 칸이라 조합을 쓰므로 칸이 빌 일이 없다).
 */
type Line = { at: number; box: string; kind: string; value: string };

export function KbTest() {
    const log = useRef<Line[]>([]);
    const [shown, setShown] = useState<Line[] | null>(null);
    const t0 = useRef(0);

    /** 칸 하나에 기록만 붙인다(값을 안 건드리므로 재려는 것을 안 흔든다). */
    const watch = (box: string) => (el: HTMLElement | null) => {
        if (!el || el.dataset.watched) return;
        el.dataset.watched = '1';
        if (!t0.current) t0.current = performance.now();
        const read = () => (el as HTMLTextAreaElement).value ?? el.textContent ?? '';
        for (const kind of ['beforeinput', 'input', 'compositionstart',
                            'compositionupdate', 'compositionend']) {
            el.addEventListener(kind, () => log.current.push({
                at: Math.round(performance.now() - t0.current), box, kind, value: read() }));
        }
    };

    /* ③만 대화창과 같은 방식으로 칸이 늘어나게 해 둔다(다음 프레임에 잰다). */
    const appBox = useRef<HTMLTextAreaElement>(null);
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
    const sys = { ...bare, fontFamily: '-apple-system, sans-serif' };

    useEffect(() => () => { t0.current = 0; }, []);

    return (
        <div className="page">
            <TopBar title="글칸 시험" fallback="/me" />
            <div style={{ display: 'grid', gap: 14, padding: '0 14px 24px' }}>
                <p className="xs faint" style={{ margin: 0 }}>
                    칸마다 <b>광산</b>을 쳐 보시고, <b>안 깜빡이는 칸이 있는지</b>만
                    알려 주세요. 판 {__BUILD__}
                </p>
                <p className="xs" style={{ margin: 0 }}>
                    ①②③은 지난번과 같습니다(셋 다 깜빡였습니다). <b>④⑤⑥이 이번에
                    새로 볼 것</b>입니다.
                </p>

                <div>
                    <p className="xs" style={{ margin: '0 0 4px' }}><b>① 맨 칸</b></p>
                    <textarea rows={2} style={sys} ref={watch('①')} />
                </div>

                <div>
                    <p className="xs" style={{ margin: '0 0 4px' }}><b>② 맨 칸 + 앱 글꼴</b></p>
                    <textarea rows={2} style={bare} ref={watch('②')} />
                </div>

                <div>
                    <p className="xs" style={{ margin: '0 0 4px' }}><b>③ 대화창과 같은 칸</b></p>
                    <div className="chat-field">
                        <textarea ref={el => { appBox.current = el; watch('③')(el); }}
                                  className="textarea" rows={1}
                                  onChange={grow} aria-label="시험 입력 3" />
                    </div>
                </div>

                <div>
                    <p className="xs" style={{ margin: '0 0 4px' }}>
                        <b>④ 자동수정을 끈 칸</b> — 아이폰의 오타 고침·예측을 껐습니다
                    </p>
                    <textarea rows={2} style={sys} ref={watch('④')}
                              autoCorrect="off" autoCapitalize="off" spellCheck={false}
                              aria-label="시험 입력 4" />
                </div>

                <div>
                    <p className="xs" style={{ margin: '0 0 4px' }}>
                        <b>⑤ 한 줄 칸</b> — 여러 줄 칸이 아니라 `input`입니다
                    </p>
                    <input type="text" style={sys} ref={watch('⑤')}
                           autoCorrect="off" autoCapitalize="off" spellCheck={false}
                           aria-label="시험 입력 5" />
                </div>

                <div>
                    <p className="xs" style={{ margin: '0 0 4px' }}>
                        <b>⑥ 글 상자</b> — 입력칸이 아니라 고쳐 쓸 수 있는 글 자리입니다
                    </p>
                    <div contentEditable suppressContentEditableWarning
                         role="textbox" aria-label="시험 입력 6"
                         ref={watch('⑥')}
                         style={{ ...sys, minHeight: 44, textAlign: 'left' }} />
                </div>

                <button className="btn ghost block" onClick={() => setShown([...log.current])}>
                    일어난 일 보기
                </button>
                {shown && (
                    <pre className="xs" style={{
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                        background: 'var(--surface-2)', padding: 10, borderRadius: 10,
                        maxHeight: 340, overflow: 'auto', margin: 0,
                    }}>
                        {shown.length === 0 ? '(아직 없습니다 — 칸에 글을 쳐 보세요)'
                            : shown.map(l => `${l.box} ${l.at}ms ${l.kind} "${l.value}"`).join('\n')}
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
