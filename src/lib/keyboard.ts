import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * **키보드가 올라와 있는 동안의 화면 매무새 — 대화 말고 모든 화면.**
 *
 * 대화 화면은 제 키보드 셈을 따로 들고 있다(`Chat.tsx`의 `applyKeyboard`와
 * `앱: 키보드와 같은 박자로`). 그런데 **모집 열기·투표 만들기 같은 폼
 * 화면에는 그것이 아예 없어서** 두 가지가 났다(사용자 제보 —
 * `키보드가 탭바 밑으로 나와서 화면도 이상하고 키보드를 내리고싶어도
 * 내릴수가 없어`):
 *
 *  1. **탭바가 키보드 위에 얹혀 있었다.** 앱은 `resize: 'native'`라 키보드가
 *     올라오면 웹뷰 자체가 줄어드는데, 탭바는 `position: fixed; bottom: 0`
 *     이라 **줄어든 창의 바닥**(= 키보드 바로 위)에 그대로 붙는다.
 *     글을 치는 동안 탭이 보일 이유가 없으므로 감춘다.
 *  2. **키보드를 내릴 길이 없었다.** 대화에는 `아래로 끌어 내리기`가 있지만
 *     폼에는 없고, 한글 자판에는 `완료`도 없다. 그래서 **글칸이 아닌 데를
 *     누르면 초점을 뗀다** — 어느 앱에서나 되는 그 손짓이다.
 *
 * **대화 화면에서는 누르기로 안 내린다**(`onChat`). 거기는 목록을 눌러
 * 인용으로 뛰거나 반응을 다는 자리가 많고, 초점이 떠나는 것을 150ms
 * 기다렸다 접는 셈까지 얽혀 있다 — 손대면 그 자리가 깨진다.
 * 다만 **탭바를 감추는 것은 거기서도 같이 돈다**(`kb-typing`).
 * 대화가 쓰던 `kb-bar`와 겹쳐도 하는 일이 같아 서로 다투지 않는다.
 */

/** 글을 치는 칸인가. 여기에 초점이 있으면 키보드가 올라와 있다고 본다. */
function typingIn(el: Element | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    if (el instanceof HTMLTextAreaElement) return true;
    if (!(el instanceof HTMLInputElement)) return false;
    /* 체크박스·라디오·파일·단추는 키보드를 안 부른다. */
    return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color']
        .includes(el.type);
}

/** 눌렀을 때 초점을 떼면 안 되는 자리인가 — 누르는 것 자체가 일인 곳들. */
function keepsFocus(t: EventTarget | null): boolean {
    let el = t instanceof Element ? t : null;
    while (el && el !== document.body) {
        if (typingIn(el)) return true;
        /* 단추·링크·고르는 칸은 눌린 뒤에 제 일을 한다. 여기서 초점을 떼면
           그 사이에 화면이 다시 그려져 **눌림이 통째로 사라지는** 기기가 있다. */
        if (el.matches('button, a[href], label, select, [role="button"]')) return true;
        el = el.parentElement;
    }
    return false;
}

export function useKeyboardChrome(): void {
    const { pathname } = useLocation();
    const onChat = pathname === '/chat';

    useEffect(() => {
        const body = document.body;
        let off: number | null = null;

        const mark = (on: boolean) => body.classList.toggle('kb-typing', on);

        const onFocusIn = (e: FocusEvent) => {
            if (!typingIn(e.target as Element)) return;
            if (off !== null) { clearTimeout(off); off = null; }
            mark(true);
        };
        /* **떼는 것은 조금 기다린다.** 칸에서 칸으로 옮겨 갈 때 초점이 잠깐
           비는데, 곧바로 지우면 탭바가 한 번 번쩍 나왔다 들어간다. */
        const onFocusOut = () => {
            if (off !== null) clearTimeout(off);
            off = window.setTimeout(() => {
                off = null;
                if (!typingIn(document.activeElement)) mark(false);
            }, 120);
        };

        /* **글칸이 아닌 데를 누르면 초점을 뗀다** = 키보드가 내려간다.
           `pointerdown`을 잡는 것은 `click`보다 먼저 와서다 — 손을 뗄 때까지
           기다리면 그동안 화면이 밀려 어디를 눌렀는지가 흐려진다. */
        const onDown = (e: PointerEvent) => {
            if (!body.classList.contains('kb-typing')) return;
            if (keepsFocus(e.target)) return;
            (document.activeElement as HTMLElement | null)?.blur();
        };

        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('focusout', onFocusOut);
        if (!onChat) document.addEventListener('pointerdown', onDown, true);

        return () => {
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('focusout', onFocusOut);
            document.removeEventListener('pointerdown', onDown, true);
            if (off !== null) clearTimeout(off);
            /* 화면을 옮길 때는 남기지 않는다 — 남으면 탭바가 사라진 채로 굳는다. */
            mark(false);
        };
    }, [onChat]);
}
