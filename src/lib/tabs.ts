import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * 탭 순서. **탭바와 스와이프가 같은 목록을 봐야 한다** — 한쪽만 고치면
 * 밀었을 때 엉뚱한 탭으로 간다. 순서는 사용자가 정한 것이다.
 */
export const TAB_PATHS = ['/', '/board', '/rounds', '/polls', '/chat'];

/** 이만큼 밀어야 넘어간다. 짧게 그으면 그냥 스크롤로 본다. */
const MIN_X = 60;
/** 가로가 세로보다 이만큼 커야 '옆으로 민 것'으로 본다. */
const RATIO = 1.6;

/**
 * 넘어가는 쪽을 `<html>`에 잠깐 적어 둔다. 그 표시를 보고 CSS가 새 화면을
 * 스르륵 밀어 넣는다(global.css의 `page-in-*`).
 *
 * **화면 전환에 애니메이션이 없어 뚝 끊겨 보인다는 제보가 있었다.**
 * 아이폰은 왼쪽 가장자리에서 미는 '뒤로 가기'에 사파리가 제 애니메이션을
 * 붙여 주는데, 그 한 방향만 부드러워서 나머지가 더 도드라졌다.
 *
 * **사파리 것과 똑같이는 못 만든다.** 그쪽은 손가락을 따라 실시간으로
 * 움직이고 중간에 놓으면 되돌아간다 — 우리는 **손을 뗀 뒤에야** 어디로
 * 갈지 알 수 있어서, 짧게 밀어 넣는 것이 할 수 있는 전부다.
 */
const SLIDE_MS = 220;
let slideTimer: ReturnType<typeof setTimeout> | undefined;

function markSlide(dir: 'next' | 'prev') {
    const el = document.documentElement;
    el.dataset.slide = dir;
    clearTimeout(slideTimer);
    // 표시를 남겨 두면 다음에 다시 그릴 때 또 미끄러진다. 끝나면 지운다.
    slideTimer = setTimeout(() => { delete el.dataset.slide; }, SLIDE_MS + 40);
}

/** 가로로 스크롤되는 칸(골프장 검색 목록 등) 안에서 시작한 손짓은 그쪽 몫이다. */
function inScroller(start: EventTarget | null): boolean {
    let el = start instanceof Element ? start : null;
    while (el && el !== document.body) {
        const ox = getComputedStyle(el).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 4) return true;
        el = el.parentElement;
    }
    return false;
}

/**
 * 화면을 좌우로 밀어 탭을 옮긴다.
 *
 * **대화 화면에서는 안 한다.** 거기서는 좌우로 미는 손짓이 이미
 * `밀어서 답장`에 쓰이고 있어서, 둘을 같이 두면 답장하려다 화면이 넘어간다.
 * 탭 다섯 중 대화가 끝자리라 잃는 것도 적다.
 *
 * **탭 화면에서만 듣는다.** 라운드 상세처럼 들어간 화면에서 밀면
 * '뒤로'를 기대하지 탭이 바뀌기를 기대하지 않는다.
 *
 * 손짓은 `passive`로 듣는다 — 세로 스크롤을 막지 않기 위해서다. 우리가
 * 하는 일은 손을 뗄 때 화면을 옮기는 것뿐이라 막을 이유가 없다.
 */
export function useTabSwipe() {
    const nav = useNavigate();
    const { pathname } = useLocation();

    useEffect(() => {
        const at = TAB_PATHS.indexOf(pathname);
        if (at < 0 || pathname === '/chat') return;

        let x0 = 0, y0 = 0, ok = false;

        const start = (e: TouchEvent) => {
            if (e.touches.length !== 1) { ok = false; return; }
            const t = e.touches[0];
            x0 = t.clientX;
            y0 = t.clientY;
            ok = !inScroller(e.target);
        };
        const end = (e: TouchEvent) => {
            if (!ok) return;
            ok = false;
            const t = e.changedTouches[0];
            if (!t) return;
            const dx = t.clientX - x0;
            const dy = t.clientY - y0;
            if (Math.abs(dx) < MIN_X || Math.abs(dx) < Math.abs(dy) * RATIO) return;
            // 왼쪽으로 밀면 다음 탭, 오른쪽으로 밀면 앞 탭. 끝에서는 안 넘어간다.
            const next = dx < 0;
            const to = TAB_PATHS[at + (next ? 1 : -1)];
            if (!to) return;
            markSlide(next ? 'next' : 'prev');
            nav(to);
        };

        document.addEventListener('touchstart', start, { passive: true });
        document.addEventListener('touchend', end, { passive: true });
        return () => {
            document.removeEventListener('touchstart', start);
            document.removeEventListener('touchend', end);
        };
    }, [pathname, nav]);
}
