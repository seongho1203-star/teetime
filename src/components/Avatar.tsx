import { useState } from 'react';

/**
 * 프로필 사진. 없거나 못 불러오면 이름의 마지막 두 글자를 보여 준다
 * (한국 이름은 성보다 이름이 사람을 가른다 — `신성호` → `성호`).
 */
export function Avatar({
    name, url, size = 'md',
}: {
    name?: string | null;
    url?: string | null;
    size?: 'sm' | 'md' | 'lg';
}) {
    const [broken, setBroken] = useState(false);
    const cls = `avatar${size === 'lg' ? ' lg' : size === 'sm' ? ' sm' : ''}`;
    const label = (name || '').trim();
    const initials = label ? label.slice(-2) : '?';

    if (url && !broken) {
        return (
            <img
                className={cls}
                src={url}
                alt={label}
                loading="lazy"
                onError={() => setBroken(true)}
            />
        );
    }
    return <div className={cls} aria-label={label}>{initials}</div>;
}
