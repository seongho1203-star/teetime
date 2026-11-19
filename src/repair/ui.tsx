import type { ReactNode } from 'react';

type IconName = 'home' | 'search' | 'book' | 'bell' | 'plus' | 'user' | 'wrench' | 'image' | 'check' | 'arrow' | 'logout' | 'shield';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
    const shapes: Record<IconName, ReactNode> = {
        home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
        search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
        book: <><path d="M4 4.8A2.8 2.8 0 0 1 6.8 2H20v17H6.8A2.8 2.8 0 0 0 4 21.8z" /><path d="M4 5v16" /><path d="M8 6h8" /><path d="M8 10h8" /></>,
        bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
        plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
        user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
        wrench: <><path d="M14.5 6.5a5 5 0 0 0-6.7 6.7L3 18l3 3 4.8-4.8a5 5 0 0 0 6.7-6.7L14 13l-3-3z" /><path d="m14 6 4-4 4 4-4 4" /></>,
        image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
        check: <><path d="m5 12 4 4L19 6" /></>,
        arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
        logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
        shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11" /><path d="m9 12 2 2 4-4" /></>,
    };
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
             strokeLinejoin="round" aria-hidden="true">
            {shapes[name]}
        </svg>
    );
}

export function dateLabel(value: string) {
    return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(value));
}

export function messageOf(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    const maybe = error as { message?: string } | null;
    return maybe?.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
