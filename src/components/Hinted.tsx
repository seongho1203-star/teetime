import { useState, type ReactNode } from 'react';

/**
 * 입력칸의 안내 글씨.
 *
 * **브라우저의 `placeholder`를 쓰지 않으려고 둔 것이다.** 한글은 한 글자가
 * 여러 번에 걸쳐 조합되는데 iOS는 그 조합 중인 글자를 '내용 없음'으로 봐서,
 * **첫 글자를 칠 때 안내 글씨가 한 번 번쩍인다.** 대화·댓글 칸에서 겪고,
 * 모집 열기의 골프장 칸에서 또 제보가 들어온 그것이다.
 *
 * **기준은 글자가 아니라 초점이다.** 글자가 들어왔는지로 정하면 조합 중에
 * 잠깐 비어 보이는 순간마다 다시 나타난다. 초점이 오면 바로 치운다 —
 * 그래야 번쩍일 틈 자체가 없다.
 *
 * 초점은 **감싼 자리에서 잡는다**(`onFocusCapture`). 그래야 화면마다
 * 상태를 따로 두지 않아도 되고, 안에 무엇이 들어오든(input·textarea) 같다.
 *
 * 쓰는 쪽:
 *   <Hinted hint="예) 무등산CC" empty={!course}>
 *       <input className="input" value={course} … />
 *   </Hinted>
 */
export function Hinted({ hint, empty, children }: {
    hint: string;
    /** 칸이 비었는가. 비었을 때만 안내 글씨를 띄운다. */
    empty: boolean;
    children: ReactNode;
}) {
    const [focused, setFocused] = useState(false);

    return (
        <div className="input-wrap"
             onFocusCapture={() => setFocused(true)}
             onBlurCapture={() => setFocused(false)}>
            {children}
            {/* 장식이라 소리로는 안 읽는다 — 칸 이름은 `label`이 말해 준다. */}
            {!focused && empty && (
                <span className="input-hint" aria-hidden="true">{hint}</span>
            )}
        </div>
    );
}
