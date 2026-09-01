import type { Gender } from '../lib/types';

/**
 * 성별과 태어난 해를 받는 두 칸.
 *
 * **가입 화면과 `내 정보`가 같이 쓴다.** 화면마다 따로 만들면 한쪽에만
 * 범위 검사가 붙거나 말이 어긋난다.
 *
 * **둘 다 안 적어도 된다.** 조 편성의 `성별 조합`·`나이 조합`에만 쓰는
 * 값이라, 없다고 앱을 못 쓰게 할 이유가 없다. 이 기능 이전에 가입한
 * 사람은 전부 비어 있기도 하다.
 *
 * **나이가 아니라 태어난 해를 받는다** — 나이를 적으면 해가 바뀔 때마다
 * 틀린 값이 되고 아무도 고치러 오지 않는다.
 * 숫자만 치는 칸이라 `placeholder`를 그대로 쓴다(한글 조합이 없어 안 번쩍인다).
 */
export function GenderAge({
    id, gender, birth, onGender, onBirth,
}: {
    /** 칸 id 앞머리. 한 화면에 둘이 뜰 일은 없지만 label과 짝을 맞춘다. */
    id: string;
    gender: Gender | null;
    birth: string;
    onGender: (v: Gender | null) => void;
    onBirth: (v: string) => void;
}) {
    return (
        <>
            <div className="field">
                <label>성별 <span className="xs faint">(안 적어도 됩니다)</span></label>
                {/* 누른 것을 다시 누르면 '안 정함'으로 돌아간다 —
                    라운드의 캐디·카트와 같은 손짓이다. */}
                <div className="opt-row">
                    {(['m', 'f'] as Gender[]).map(g => (
                        <button
                            key={g}
                            type="button"
                            className={`opt${gender === g ? ' on' : ''}`}
                            aria-pressed={gender === g}
                            onClick={() => onGender(gender === g ? null : g)}
                        >
                            <span className="opt-box" aria-hidden="true">
                                {gender === g ? '✓' : ''}
                            </span>
                            {g === 'm' ? '남' : '여'}
                        </button>
                    ))}
                </div>
            </div>
            <div className="field">
                <label htmlFor={`${id}-birth`}>
                    태어난 해 <span className="xs faint">(안 적어도 됩니다)</span>
                </label>
                <input
                    id={`${id}-birth`} className="input" value={birth}
                    onChange={e => onBirth(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                    inputMode="numeric" placeholder="1975" maxLength={4}
                />
            </div>
        </>
    );
}
