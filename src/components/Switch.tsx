/**
 * 켜고 끄는 스위치. 투표 만들기 · 공지 고정 · 알림 설정이 같이 쓴다.
 *
 * `<input type="checkbox">`를 감추고 꾸미는 대신 단추 하나로 두었다 —
 * `role="switch"`면 읽어 주는 기기도 켜짐/꺼짐을 그대로 말해 준다.
 * 모양은 global.css의 `.switch`다. **거기 하나뿐이니 새로 만들지 말 것.**
 */
export function Switch({ on, onChange, disabled, label }: {
    on: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    /** 화면에 글자가 따로 있으므로, 읽어 주는 기기를 위한 이름만 받는다. */
    label: string;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            className={`switch${on ? ' on' : ''}`}
            disabled={disabled}
            onClick={() => onChange(!on)}
        />
    );
}
