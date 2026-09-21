import { CAL_LABEL, type BirthCal, type BirthInput, type Gender } from '../lib/types';

/**
 * 생년월일과 성별을 받는 칸.
 *
 * **가입 화면·`내 정보`·`FillProfile` 셋이 같이 쓴다.** 화면마다 따로
 * 만들면 한쪽에만 범위 검사가 붙거나 말이 어긋난다.
 *
 * **생년월일이 성별보다 위에 있다** — 사용자가 정해 준 칸 차례가
 * `닉네임 · 전화번호 · 생년월일 · 성별 · 차량번호 · 거주지역`이다.
 *
 * **한 줄에 `양력/음력`과 `년 · 월 · 일`이 함께 있다**(사용자 요청 —
 * `첫 가입때 음력 또는 양력 생년월일을 받고`). 예전에는 **태어난 해만**
 * 받았는데, 생일을 축하하려면 달과 날이 있어야 한다.
 *
 * **저장되는 곳이 갈린다 — 그게 이 칸의 핵심이다.**
 * - **해**는 `profiles.birth_year`(공개). 이름표(`83/신성호/광산구`)와
 *   조 편성의 `나이 조합`이 이미 그 값을 본다.
 * - **달·날과 양력/음력**은 `profile_private`(운영진만)이다 —
 *   사용자가 `개인정보는 운영진만 확인할 수 있게`라고 정했다.
 *
 * **음력으로 적으면 그 해도 음력 해다.** 이름표의 `83`과 조 편성이 그 값을
 * 그대로 쓰는데, 음력 설이 양력 1~2월이라 **설 전에 난 사람만 한 살 어긋난다.**
 * 나이를 섞어 조를 짜는 데 쓰는 값이라 그 한 해 차이는 아무 데도 안 걸린다 —
 * 두 해를 따로 받게 하면 칸만 늘고 헷갈린다.
 *
 * **셋 다 필수다**(사용자가 정한 것이다). 조 편성의 `성별 조합`·`나이 조합`이
 * 이 값을 보는데 반이 비어 있으면 그 조건이 반쪽으로 돈다.
 * 이 기능 이전에 가입한 분들은 **로그인 뒤 한 번 막고 받는다**
 * (`screens/FillProfile.tsx`) — 가입 화면은 승인 전에만 보이기 때문이다.
 *
 * **나이가 아니라 태어난 해를 받는다** — 나이를 적으면 해가 바뀔 때마다
 * 틀린 값이 되고 아무도 고치러 오지 않는다.
 * 숫자만 치는 칸이라 `placeholder`를 그대로 쓴다(한글 조합이 없어 안 번쩍인다).
 */

/** 숫자만 남기고 자릿수를 자른다. */
const digits = (v: string, max: number) => v.replace(/[^0-9]/g, '').slice(0, max);

export function GenderAge({
    id, gender, birth, onGender, onBirth,
}: {
    /** 칸 id 앞머리. 한 화면에 둘이 뜰 일은 없지만 label과 짝을 맞춘다. */
    id: string;
    gender: Gender | null;
    birth: BirthInput;
    onGender: (v: Gender | null) => void;
    onBirth: (v: BirthInput) => void;
}) {
    const set = (patch: Partial<BirthInput>) => onBirth({ ...birth, ...patch });

    return (
        <>
            <div className="field">
                <label htmlFor={`${id}-birth`}>생년월일</label>
                {/* **양력/음력은 하나만 켜진다** — 캐디·카트와 같은 손짓이다.
                    다만 여기서는 **끌 수 없다**: 날짜만 있고 어느 달력인지
                    모르면 생일이 언제인지 알 길이 없다. */}
                <div className="opt-row">
                    {(['solar', 'lunar'] as BirthCal[]).map(c => (
                        <button
                            key={c}
                            type="button"
                            className={`opt${birth.cal === c ? ' on' : ''}`}
                            aria-pressed={birth.cal === c}
                            onClick={() => set({ cal: c })}
                        >
                            <span className="opt-box" aria-hidden="true">
                                {birth.cal === c ? '✓' : ''}
                            </span>
                            {CAL_LABEL[c]}
                        </button>
                    ))}
                </div>
                <div className="birth-row">
                    <input
                        id={`${id}-birth`} className="input birth-y" value={birth.year}
                        onChange={e => set({ year: digits(e.target.value, 4) })}
                        inputMode="numeric" placeholder="1975" maxLength={4}
                        aria-label="태어난 해"
                    />
                    <span className="birth-unit">년</span>
                    <input
                        className="input" value={birth.month}
                        onChange={e => set({ month: digits(e.target.value, 2) })}
                        inputMode="numeric" placeholder="5" maxLength={2}
                        aria-label="태어난 달"
                    />
                    <span className="birth-unit">월</span>
                    <input
                        className="input" value={birth.day}
                        onChange={e => set({ day: digits(e.target.value, 2) })}
                        inputMode="numeric" placeholder="10" maxLength={2}
                        aria-label="태어난 날"
                    />
                    <span className="birth-unit">일</span>
                </div>
            </div>
            <div className="field">
                <label>성별</label>
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
        </>
    );
}
