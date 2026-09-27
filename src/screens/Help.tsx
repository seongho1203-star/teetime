import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { GUIDE_FOOT, GUIDE_INTRO, GUIDE_PARTS, type GuidePart } from '../lib/guide';
import './Help.css';

/**
 * 앱 사용자 가이드.
 *
 * **처음 들어온 분에게 보여 줄 곳이다.** 공지로 올리는 길도 있었지만
 * 새 공지가 쌓이면 묻힌다 — 앱 안에 두면 언제든 같은 자리에서 찾는다.
 * 들어가는 문은 둘이다: **`내 정보` 메뉴의 `앱 사용자 가이드`**, 그리고
 * **승인 대기 화면** — 기다리는 동안 읽어 두면 승인되자마자 쓸 수 있다.
 *
 * **글은 `lib/guide.ts`에 있다** — 앱 화면(`HelpViewController.swift`)과
 * 같은 글을 쓰려고 한 곳에 모았다. 문구를 고치려면 그 파일을 고친다.
 * `**굵게**`와 `((곁말))` 두 표시를 `Rich`가 푼다.
 *
 * 마지막 꼭지의 `홈 화면에 추가`는 **웹으로 쓰는 동안만 필요한 안내다**
 * (`webOnly`) — 앱 화면에서는 뺀다.
 */

/** `**굵게**`·`((곁말))`을 푼다 — Swift의 `GuideText`와 같은 규칙이다. */
function Rich({ text }: { text: string }) {
    const out: React.ReactNode[] = [];
    const re = /\*\*(.+?)\*\*|\(\((.+?)\)\)/gs;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push(text.slice(last, m.index));
        if (m[1] != null) out.push(<b key={m.index}>{m[1]}</b>);
        else out.push(<span key={m.index} className="dim"><Rich text={m[2]} /></span>);
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return <>{out.map((n, i) => <Fragment key={i}>{n}</Fragment>)}</>;
}

/** 한 꼭지. 번호·아이콘·제목·이끄는 말·본문. */
function Part({ part }: { part: GuidePart }) {
    return (
        <div className="card help-part">
            <h2 className="help-h">
                <span className="help-icon" aria-hidden="true">{part.icon}</span>
                <span className="help-num">{part.n}.</span>
                {part.title}
            </h2>
            {part.lead && <p className="help-lead">{part.lead}</p>}
            {part.items && (
                <ul className="help-list">
                    {part.items.map((t, i) => <li key={i}><Rich text={t} /></li>)}
                </ul>
            )}
            {/* 번호가 붙는 한 단계. 손으로 따라 할 일에만 쓴다. */}
            {part.steps?.map((s, i) => (
                <div className="help-step" key={i}>
                    <span className="help-n">{i + 1}</span>
                    <div className="help-step-body"><Rich text={s.text} /></div>
                </div>
            ))}
            {part.tip && <p className="help-tip">{part.tip}</p>}
        </div>
    );
}

export function Help({ onBack }: { onBack?: () => void }) {
    return (
        <div className="page help">
            {/* `onBack`은 **승인 대기 화면**에서 띄울 때 쓴다 — 거기서는
                라우터로 옮겨 봐야 같은 화면이 다시 나온다. */}
            <TopBar title="앱 사용자 가이드" fallback="/" onBack={onBack} />

            <p className="help-intro"><Rich text={GUIDE_INTRO} /></p>

            {GUIDE_PARTS.map(p => <Part key={p.n} part={p} />)}

            <div className="card help-foot">
                <p className="sm"><Rich text={GUIDE_FOOT} /></p>
                {onBack
                    ? <button className="btn block" onClick={onBack}>닫기</button>
                    : <Link to="/" className="btn block">홈으로 가기</Link>}
            </div>
        </div>
    );
}
