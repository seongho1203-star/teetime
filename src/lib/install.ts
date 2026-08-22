/**
 * 안드로이드·PC 크롬의 **앱 설치**.
 *
 * 크롬은 '설치할 만한 페이지'라고 판단하면 `beforeinstallprompt`를 딱 한 번
 * 던진다. **그 순간은 앱이 뜨자마자다** — 화면 하나에서 듣고 있으면 이미
 * 지나간 뒤라 영영 못 잡는다(실제로 `내 정보`에서만 듣다가 못 잡았다).
 * 그래서 이 파일은 **불러오는 순간**부터 창에 귀를 대고 있다가 붙잡아 둔다.
 *
 * iOS에는 이 이벤트가 없다. 거기는 공유 → 홈 화면에 추가뿐이라
 * `canInstall()`이 늘 false다.
 */

interface InstallPrompt extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();

function announce() {
    for (const fn of listeners) fn();
}

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', e => {
        // 막아 두지 않으면 크롬이 제 방식대로 처리해 버려서 나중에 못 띄운다.
        e.preventDefault();
        deferred = e as InstallPrompt;
        announce();
    });
    window.addEventListener('appinstalled', () => {
        deferred = null;
        announce();
    });
}

export function canInstall(): boolean {
    return deferred !== null;
}

/** 설치할 수 있게 되거나 설치가 끝나면 알려 준다. */
export function onInstallChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/**
 * 설치 창을 띄운다. 한 번 쓴 이벤트는 다시 못 쓴다.
 * 거절해도 크롬이 나중에 다시 주므로 그때 또 잡는다.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!deferred) return 'unavailable';
    const e = deferred;
    deferred = null;
    announce();
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome;
}
