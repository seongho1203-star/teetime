import { useEffect, useRef } from 'react';

/**
 * 화면 가득 터지는 폭죽 — 카톡의 그 축하 효과다(사용자 요청).
 *
 * **캔버스 한 장이다.** CSS로 하면 조각 하나에 요소 하나라 수백 개가 DOM에
 * 들어앉고, 그걸 `transform`으로 움직이면 느린 안드로이드에서 그대로
 * 주저앉는다 — 이 앱이 무한 애니메이션과 `blur`을 걷어낸 그 자리다.
 * 캔버스는 **요소 하나 · rAF 하나**이고, 다 터지면 **스스로 끝난다.**
 *
 * **`pointer-events: none`이다.** 축하가 도는 동안에도 대화는 그대로
 * 눌리고 굴러간다 — 화면을 덮는 창이 아니라 그 위에 얹힌 그림이다.
 * 그래서 네이티브 바를 감추는 `overlayUp` 목록에도 안 든다.
 *
 * **색은 뜻이 없다.** 이 앱의 색 규칙(분홍은 지금 눌러야 할 것, 잔디는
 * 좋은 상태…)은 **화면의 값**을 가르는 규칙이라, 2초 만에 사라지는 불꽃에는
 * 걸리지 않는다. 여기 색을 토큰으로 묶지 말 것 — 묶으면 다음에 토큰을
 * 만질 때 불꽃까지 따라 바뀐다.
 *
 * **움직임을 줄여 달라고 해 둔 기기에서는 한 번만 터뜨린다.** 사람이
 * 눌러서 보는 것이라 아예 안 보여 주면 누른 뜻이 없어지므로, 없애는 대신
 * 짧게 끝낸다(뒤로 가기 효과가 갈래를 나누는 것과 같은 결이다).
 */

/** 한 번 터질 때의 조각 수. 느린 폰을 생각해 넉넉하지 않게 잡았다. */
const PARTICLES = 56;
/** 몇 번 터지는가 · 터지는 사이(ms). */
const BURSTS = 5;
const GAP = 280;
/** 조각 하나가 사는 시간(ms). */
const LIFE = 1500;

const COLORS = ['#ff4e8a', '#ffd23f', '#4ad66d', '#6c5ce7', '#ff9f1c', '#ffffff'];

type Bit = {
    x: number; y: number; vx: number; vy: number;
    born: number; color: string; size: number;
};

export function Fireworks({ onDone }: { onDone: () => void }) {
    const ref = useRef<HTMLCanvasElement>(null);
    /* **끝났다는 것을 한 번만 알린다.** rAF와 예비 타이머가 둘 다 부를 수
       있는데, 두 번 부르면 부모가 상태를 두 번 내려 화면이 한 번 더 그려진다. */
    const done = useRef(false);

    useEffect(() => {
        const cv = ref.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        if (!ctx) { onDone(); return; }

        const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const bursts = calm ? 1 : BURSTS;

        /* **그리는 크기는 화면 배율을 따른다.** 안 맞추면 레티나에서 조각이
           뭉개진다. **3배는 안 쓴다** — 아이폰은 3배인데 그만큼 그릴 픽셀이
           2.25배가 되고, 눈에는 2배와 거의 같다. */
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let w = 0, h = 0;
        const fit = () => {
            w = cv.clientWidth; h = cv.clientHeight;
            cv.width = Math.round(w * dpr);
            cv.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        fit();

        const bits: Bit[] = [];
        const boom = (at: number) => {
            /* 터지는 자리는 화면 위쪽 절반에 흩는다 — 아래쪽은 입력칸과
               탭바 자리라 거기서 터지면 반이 가린다. */
            const cx = w * (0.18 + Math.random() * 0.64);
            const cy = h * (0.16 + Math.random() * 0.34);
            const color = COLORS[Math.floor(Math.random() * COLORS.length)];
            const power = 2.4 + Math.random() * 1.4;
            for (let i = 0; i < PARTICLES; i++) {
                const a = (Math.PI * 2 * i) / PARTICLES + Math.random() * 0.2;
                const v = power * (0.55 + Math.random() * 0.75);
                bits.push({
                    x: cx, y: cy,
                    vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                    born: at, size: 1.6 + Math.random() * 1.8,
                    /* 한 번에 한 색이면 밋밋해서 조각 몇은 딴 색으로 튄다. */
                    color: Math.random() < 0.22
                        ? COLORS[Math.floor(Math.random() * COLORS.length)] : color,
                });
            }
        };

        const start = performance.now();
        let next = 0;
        let raf = 0;

        const tick = (now: number) => {
            const t = now - start;
            while (next < bursts && t >= next * GAP) { boom(start + next * GAP); next++; }

            ctx.clearRect(0, 0, w, h);
            let alive = 0;
            for (const b of bits) {
                const age = now - b.born;
                if (age < 0 || age > LIFE) continue;
                alive++;
                const s = age / 1000;                      // 초
                const x = b.x + b.vx * age * 0.06;
                const y = b.y + b.vy * age * 0.06 + 42 * s * s;   // 중력
                ctx.globalAlpha = Math.max(0, 1 - age / LIFE);
                ctx.fillStyle = b.color;
                ctx.beginPath();
                ctx.arc(x, y, b.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            if (next < bursts || alive > 0) { raf = requestAnimationFrame(tick); return; }
            finish();
        };

        const finish = () => {
            if (done.current) return;
            done.current = true;
            cancelAnimationFrame(raf);
            onDone();
        };

        raf = requestAnimationFrame(tick);

        /* **rAF에만 매달지 않는다.** 앱을 덮어 두면 rAF가 아예 안 돌아
           그림이 화면에 그대로 남는다 — 뒤로 가기 그림을 걷을 때 겪은
           그 자리다. 넉넉한 예비 타이머를 함께 건다. */
        const bail = window.setTimeout(finish, bursts * GAP + LIFE + 600);
        window.addEventListener('resize', fit);

        return () => {
            cancelAnimationFrame(raf);
            window.clearTimeout(bail);
            window.removeEventListener('resize', fit);
        };
    }, [onDone]);

    return <canvas ref={ref} className="cheer-burst" aria-hidden="true" />;
}
