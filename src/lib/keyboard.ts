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

/**
 * 탭바를 감추는 표시들. **화면을 옮기면 이 넷을 통째로 걷는다**(아래
 * `useKeyboardChrome`의 첫 효과).
 *
 * - `kb-typing` — 여기서 세운다(웹 글칸에 초점이 있는 동안)
 * - `nc-typing` — `components/Comments.tsx`(네이티브 댓글 바가 떠 있는 동안)
 * - `kb-open` · `kb-bar` — `screens/Chat.tsx`(대화 화면의 키보드 셈)
 *
 * **새로 탭바를 감추는 표시를 만들면 여기 더할 것.**
 */
const HIDES_TABBAR = ['kb-typing', 'nc-typing', 'kb-open', 'kb-bar'];

export function useKeyboardChrome(): void {
    const { pathname } = useLocation();
    const onChat = pathname === '/chat';

    /**
     * **화면이 바뀌면 감추던 표시를 걷는다.**
     *
     * 사용자 제보 — `뒤로가기하면 가끔 탭바가 사라지는 경우가있어`.
     * 글칸에 초점을 둔 채 뒤로 가면 **탭바가 사라진 채로 굳었다.**
     *
     * 세 가지가 겹쳐서 났다:
     *  1. 아래 효과는 `[onChat]`으로 걸려 있어 **폼 화면끼리 오갈 때는 다시
     *     돌지 않는다** — 그 뒷정리(`mark(false)`)가 안 불린다.
     *  2. 그래서 기댈 곳은 `focusout`인데, **웹킷은 초점이 있던 요소가
     *     화면에서 사라질 때 그걸 안 보내 준다**(크로미움은 보낸다).
     *     화면을 옮기면 그 칸은 통째로 없어지므로 딱 그 자리다.
     *  3. `nc-typing`·`kb-open`·`kb-bar`도 각자 제 화면에서 걷는데,
     *     그 코드가 도는 것 자체가 어긋나면 같은 자국이 남는다.
     *
     * **한 군데씩 고치지 않고 여기서 한 번에 걷는다** — 감추는 곳이 넷이라
     * 한 곳씩 챙기면 반드시 하나를 빠뜨리고, 빠뜨리면 **화면이 잠긴 것처럼
     * 보여** 원래보다 나쁘다(JTFAG의 `watchOverlays`와 같은 결이다).
     * 화면을 옮겼다는 것은 **적던 칸이 이미 사라졌다는 뜻**이라 넷 다
     * 남아 있을 이유가 없다. 새 화면이 키보드를 다시 올리면 그때 저마다
     * 다시 세운다.
     */
    useEffect(() => {
        document.body.classList.remove(...HIDES_TABBAR);
        document.documentElement.classList.remove('kb-open');
        document.body.style.removeProperty('--kb-pad');
    }, [pathname]);

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
                if (typingIn(document.activeElement)) return;
                mark(false);
                // 빈자리도 함께 걷는다 — 남기면 글 아래가 휑하게 남는다.
                body.style.removeProperty('--kb-pad');
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

        /**
         * **키보드가 가린 자리에 있는 칸을 끌어 올린다**(사용자 제보 —
         * `댓글쓰는창이 키보드가 가려서 볼수가없어`).
         *
         * 브라우저는 초점이 갈 때 한 번 굴려 주는데, **화면이 줄어드는 것은
         * 그 뒤**다 — 앱은 `resize: 'native'`라 웹뷰가 나중에 줄고(플러그인이
         * 0.45초 늦춘다), 그때 다시 굴려 주지는 않는다. 그래서 초점이 갈
         * 때는 보이던 칸이 **키보드가 다 올라오고 나면 그 아래로 내려간다.**
         * 재 보니 댓글 칸이 보이는 화면보다 165px 아래에 있었다.
         *
         * **줄어들기를 기다리지 않는다 — 줄어들 것을 미리 빼고 지금 굴린다.**
         * 처음에는 창이 줄어든 뒤에 굴리게 두었는데 **그 0.45초가 그대로 눈에
         * 보였다**(사용자 제보 — `순간 댓글창이 안보여서 뭐지? 이러면 댓글창이
         * 보여`). 대화 화면이 `kbHint`로 지난번 키보드 높이를 미리 써먹는
         * 것과 같은 수다.
         *
         * **이미 보일 자리면 아무 일도 안 한다** — 사람이 굴려 둔 자리를
         * 빼앗지 않는다. **부드럽게 굴리지 않는다** — 키보드가 올라오는 그
         * 순간이라 느린 폰에서는 그대로 끊긴다.
         */
        /** 칸 아래로 이만큼은 보이게 둔다 — 옆·아래에 붙는 `등록` 단추 몫이다. */
        const GAP = 64;
        /** 키보드가 없을 때의 높이. 초점이 처음 갈 때 집어 둔다. */
        let baseH = window.innerHeight;
        const seenH = () => window.visualViewport?.height ?? window.innerHeight;
        /**
         * 키보드가 얼마나 가릴까.
         *
         * **`Chat.tsx`가 쓰는 그 열쇠를 같이 쓴다**(`teetime:kbh:<가로폭>`).
         * 거기서는 플러그인이 알려 준 값을, 여기서는 창이 줄어든 만큼을
         * 적는다 — 뜻이 같아 서로 배워 준다. **한쪽만 고치지 말 것.**
         * 한 번도 안 겪은 판에서는 화면의 42%로 잡는다(아이폰 한글 자판이
         * 그 언저리다). 넘겨 잡아도 칸이 조금 더 위로 갈 뿐이라 손해가 적다.
         */
        const MEMO = () => `teetime:kbh:${window.innerWidth}`;
        const guessKb = () => {
            let n = 0;
            try { n = Number(localStorage.getItem(MEMO())) || 0; } catch { /* 막힌 판 */ }
            return n > 120 && n < baseH * 0.75 ? n : Math.round(baseH * 0.42);
        };
        /**
         * **굴릴 자리를 먼저 만든다.**
         *
         * 미리 굴리려고 해도 **화면이 줄기 전에는 굴릴 자리가 없다** —
         * 댓글 칸은 글의 맨 아래에 있어서 이미 끝까지 굴러가 있다(재 보니
         * `scrollTop`이 딱 최대값이었다). 그래서 치는 동안에만 `.page`
         * 아래에 **키보드가 가릴 만큼 빈자리를 붙여** 그만큼 더 굴러가게 한다.
         *
         * **이미 줄어든 만큼은 뺀다.** 앱은 웹뷰가 줄어들어(`resize: native`)
         * 저절로 자리가 생기지만, **사파리 탭에서는 문서 높이가 안 줄어들어**
         * 이 빈자리가 없으면 끝내 못 올라간다 — 두 판을 한 셈으로 덮으려고
         * `documentElement.clientHeight`(문서가 놓인 높이)로 견준다.
         */
        const padFor = () => {
            const layout = document.documentElement.clientHeight;
            /* `GAP`까지 더한다 — 딱 키보드 높이만 붙이면 **끝까지 굴려도
               모자라** 칸이 키보드에 아슬아슬하게 붙는다(라운드 상세에서
               28px밖에 안 남았다). */
            return Math.max(0, guessKb() + GAP - Math.max(0, baseH - layout));
        };

        /** 그 칸을 담고 있는 굴러가는 칸. 없으면 문서 자체다. */
        const scrollerOf = (el: HTMLElement): HTMLElement => {
            let p = el.parentElement;
            while (p) {
                const s = getComputedStyle(p);
                if (/auto|scroll/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
                p = p.parentElement;
            }
            return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
        };
        const reveal = () => {
            const el = document.activeElement;
            if (!typingIn(el)) return;
            const node = el as HTMLElement;
            // 자리를 먼저 만들고(위 `padFor`) 그다음에 잰다 — 순서가 뒤집히면
            // 굴릴 데가 없어 그대로 주저앉는다.
            body.style.setProperty('--kb-pad', `${padFor()}px`);
            const vh = seenH();
            /* 창이 아직 안 줄었으면 **줄어들 것을 미리 뺀다.** 이미 줄었으면
               그 높이가 곧 답이다(40px은 주소 막대가 접히는 정도의 흔들림). */
            const seen = vh < baseH - 40 ? vh : Math.max(200, vh - guessKb());
            const over = node.getBoundingClientRect().bottom + GAP - seen;
            if (over <= 1) return;
            scrollerOf(node).scrollTop += over;
        };
        /* **여러 번 부른다 — 화면이 한 번에 줄지 않기 때문이다.**
           초점이 가는 그 자리에서 곧바로 한 번(이게 눈에 보이는 그 한 번이다),
           창이 줄어들 때마다 한 번, 다 올라왔을 때쯤 한 번 더. */
        let timers: number[] = [];
        const revealSoon = () => {
            timers.forEach(clearTimeout);
            reveal();
            timers = [350, 650].map(ms => window.setTimeout(reveal, ms));
        };

        const onFocusInAll = (e: FocusEvent) => {
            const first = !body.classList.contains('kb-typing');
            onFocusIn(e);
            if (onChat || !typingIn(e.target as Element)) return;
            /* **키보드가 없을 때의 높이여야 한다** — 칸에서 칸으로 옮겨 가는
               중이면 이미 줄어 있으므로 그때는 그대로 둔다. */
            if (first) baseH = window.innerHeight;
            revealSoon();
        };
        const onResize = () => {
            if (onChat || !body.classList.contains('kb-typing')) return;
            /* **줄어든 만큼이 곧 키보드 높이다 — 적어 두고 다음에 써먹는다.**
               가로세로가 바뀐 것과 헷갈리지 않게 그럴듯한 값만 받는다. */
            const gap = baseH - seenH();
            if (gap > 120 && gap < baseH * 0.75) {
                try { localStorage.setItem(MEMO(), String(Math.round(gap))); } catch { /* 막힌 판 */ }
            }
            reveal();
        };

        document.addEventListener('focusin', onFocusInAll);
        document.addEventListener('focusout', onFocusOut);
        if (!onChat) {
            document.addEventListener('pointerdown', onDown, true);
            window.addEventListener('resize', onResize);
            window.visualViewport?.addEventListener('resize', onResize);
        }

        return () => {
            document.removeEventListener('focusin', onFocusInAll);
            document.removeEventListener('focusout', onFocusOut);
            document.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('resize', onResize);
            window.visualViewport?.removeEventListener('resize', onResize);
            if (off !== null) clearTimeout(off);
            timers.forEach(clearTimeout);
            /* 화면을 옮길 때는 남기지 않는다 — 남으면 탭바가 사라진 채로 굳는다. */
            mark(false);
            body.style.removeProperty('--kb-pad');
        };
    }, [onChat]);
}
