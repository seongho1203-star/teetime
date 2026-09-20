import type { ChangeEvent } from 'react';
import { groupWon, wonDigits } from '../lib/format';

/**
 * 금액을 적는 칸 — **치는 대로 `100,000원`으로 보인다**(사용자 요청 —
 * `금액 입력부분을 100,000원 이런식으로 표현되게해줘`).
 *
 * **값은 숫자만 든 글자다**(`100000`). 쉼표를 값에 섞으면 저장하는 쪽마다
 * 다시 벗겨야 하고 한 곳만 빠뜨리면 조용히 0이 된다 — 쉼표는 **보여 줄
 * 때만** 붙인다(`groupWon`). `원`도 값이 아니라 표시라 칸 밖에 세우고
 * 자리만 비워 둔다(`.won-mark`).
 *
 * **쓰는 곳이 셋이다** — 정산의 `총금액`과 `1/N` 몫, 모집 열기의
 * `그린피·게임비`. 금액 칸을 새로 만들면 여기를 쓸 것.
 * **정원·태어난 해·계좌번호에는 쓰지 말 것** — 숫자지만 금액이 아니라
 * 쉼표를 붙이면 되레 거짓말이 된다(`1,983년생`).
 *
 * `type="number"`로 두면 쉼표를 아예 못 넣는다. 그래서 글자 칸이고
 * `inputMode="numeric"`으로 폰에서 숫자 자판이 뜨게 한다.
 */
export function WonField({ id, className, value, onChange }: {
    id?: string;
    className?: string;
    /** 숫자만 든 글자. `''`면 빈 칸이다. */
    value: string;
    onChange: (digits: string) => void;
}) {
    function handle(e: ChangeEvent<HTMLInputElement>) {
        const el = e.currentTarget;
        const raw = el.value;
        const caret = el.selectionStart ?? raw.length;
        // **커서 앞에 숫자가 몇 개였는지로 자리를 기억한다.** 글자 수로 세면
        // 쉼표가 하나 늘어나는 순간 커서가 한 칸씩 밀린다.
        const before = raw.slice(0, caret).replace(/[^0-9]/g, '').length;
        const digits = wonDigits(raw);
        const shown = groupWon(digits);

        // **리액트가 다시 그리기 전에 칸에 직접 써 넣는다.** 부모가 같은 값을
        // 돌려주므로 리액트는 칸을 안 건드리고, 그래서 커서가 끝으로 튀지
        // 않는다. 쓰고 나서 바로 커서를 제자리에 놓는다.
        el.value = shown;
        let seen = 0;
        let pos = before === 0 ? 0 : shown.length;
        for (let i = 0; i < shown.length; i++) {
            if (shown[i] >= '0' && shown[i] <= '9' && ++seen === before) {
                pos = i + 1;
                break;
            }
        }
        el.setSelectionRange(pos, pos);

        onChange(digits);
    }

    return (
        <div className="won-field">
            <input id={id} className={`input${className ? ` ${className}` : ''}`}
                   inputMode="numeric" value={groupWon(value)} onChange={handle} />
            {/* 장식이라 소리로는 안 읽는다 — 칸 이름은 `label`이 말해 준다. */}
            <span className="won-mark" aria-hidden="true">원</span>
        </div>
    );
}
