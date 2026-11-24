import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
    HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams,
} from 'react-router-dom';
import type { ChangeEvent } from 'react';
import { AuthProvider, useAuth } from '../lib/auth';
import { enablePush, pushState, syncRepairPushSubscription, type PushState } from '../lib/push';
import { clearBadge, watchBadge } from '../lib/badge';
import { isConfigured, signInWithApple, signInWithKakao, supabase } from '../lib/supabase';
import { ToastProvider, useToast } from '../components/Toast';
import {
    createEntry, getEntry, getRepairMembership, listNotifications, markNotificationsRead, removeEntry, updateEntry,
    repairDb, requestRepairMembership, searchEntries, signedPhotoUrls,
    unreadNotificationCount, updateRepairMemberProfile,
} from './data';
import {
    ENTRY_CATEGORIES, PRODUCT_FAMILIES, REPAIR_JOB_TITLES, type EntryCategory, type EntryFilters,
    type RepairEntry, type RepairJobTitle, type RepairMembership, type RepairNotification,
} from './types';
import './repair.css';

type IconName = 'star' | 'home' | 'search' | 'book' | 'bell' | 'plus' | 'user' | 'wrench' | 'image' | 'check' | 'arrow' | 'logout' | 'shield';

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
    const shapes: Record<IconName, ReactNode> = {
        star: <path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9Z" />,
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

function Mark() {
    return (
        <span className="rn-mark" aria-hidden="true">
            <Icon name="wrench" size={21} />
        </span>
    );
}

function LoadingScreen() {
    return (
        <div className="rn-boot">
            <Mark />
            <span>수리노트</span>
            <i className="rn-spinner" aria-hidden="true" />
        </div>
    );
}

function AuthApp() {
    return (
        <AuthProvider>
            <ToastProvider>
                <HashRouter>
                    <RepairGate />
                </HashRouter>
            </ToastProvider>
        </AuthProvider>
    );
}

function RepairGate() {
    const { session, profile, isAdmin, loading } = useAuth();
    const userId = session?.user.id;
    const [membership, setMembership] = useState<RepairMembership | null>(null);
    const [membershipLoading, setMembershipLoading] = useState(true);
    const [membershipError, setMembershipError] = useState('');

    const refreshMembership = useCallback(async () => {
        if (!userId) {
            setMembership(null);
            setMembershipLoading(false);
            return;
        }
        setMembershipLoading(true);
        setMembershipError('');
        try {
            setMembership(await getRepairMembership(userId));
        } catch (error) {
            setMembershipError(messageOf(error));
        } finally {
            setMembershipLoading(false);
        }
    }, [userId]);

    useEffect(() => { void refreshMembership(); }, [refreshMembership]);

    useEffect(() => {
        if (!userId) return;
        const channel = repairDb.channel('repair-membership-' + userId)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'repair_memberships',
                filter: 'user_id=eq.' + userId,
            }, () => void refreshMembership())
            .subscribe();
        return () => { void repairDb.removeChannel(channel); };
    }, [refreshMembership, userId]);

    if (loading) return <LoadingScreen />;
    if (!session) return <LoginScreen />;
    if (membershipLoading || (membership && membership.user_id !== userId)) return <LoadingScreen />;
    const initialName = profile?.name || String(session.user.user_metadata?.name ?? '');
    if (membershipError) return <MembershipLoadError error={membershipError} retry={refreshMembership} />;
    if (!membership || membership.status === 'pending') {
        return <RepairAccessScreen name={membership?.display_name || initialName}
            membership={membership} refresh={refreshMembership} />;
    }

    return <RepairWorkspace membership={membership} isAdmin={isAdmin} onProfileChange={refreshMembership} />;
}

function LoginScreen() {
    const toast = useToast();
    const [busy, setBusy] = useState<'kakao' | 'apple' | null>(null);

    const login = async (provider: 'kakao' | 'apple') => {
        setBusy(provider);
        try {
            if (provider === 'kakao') await signInWithKakao();
            else await signInWithApple();
        } catch (error) {
            toast(messageOf(error), 'error');
            setBusy(null);
        }
    };

    return (
        <main className="rn-auth-screen">
            <section className="rn-auth-card">
                <Mark />
                <div className="rn-eyebrow">FIELD KNOWLEDGE · LG ELECTRONICS</div>
                <h1>수리노트</h1>
                <p className="rn-auth-sub">현장 엔지니어의 수리 및 점검방법을<br />모델별로 빠르게 찾고 공유하세요.</p>
                <div className="rn-auth-divider"><span>승인된 회원 전용</span></div>
                <button className="rn-login-kakao" onClick={() => void login('kakao')} disabled={!!busy}>
                    {busy === 'kakao' ? <span className="rn-spinner" /> : <><b>톡</b> 카카오로 시작하기</>}
                </button>
                <button className="rn-login-apple" onClick={() => void login('apple')} disabled={!!busy}>
                    {busy === 'apple' ? <span className="rn-spinner" /> : <><span className="rn-apple">●</span> Apple로 시작하기</>}
                </button>
                <p className="rn-auth-note">
                    로그인 후 운영자 승인이 완료되면 이용할 수 있습니다.<br />
                    고객의 이름·주소·연락처가 포함된 사진은 올리지 마세요.
                </p>
            </section>
        </main>
    );
}

function MembershipLoadError({ error, retry }: { error: string; retry: () => Promise<void> }) {
    return (
        <main className="rn-auth-screen">
            <section className="rn-auth-card rn-pending">
                <span className="rn-pending-icon"><Icon name="shield" size={27} /></span>
                <h1>회원 정보를 불러오지 못했습니다</h1>
                <p className="rn-auth-sub">{error}</p>
                <button className="rn-primary-btn rn-wide" onClick={() => void retry()}>다시 불러오기</button>
            </section>
        </main>
    );
}

function RepairAccessScreen({
    name, membership, refresh,
}: { name: string; membership: RepairMembership | null; refresh: () => Promise<void> }) {
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const isPending = membership?.status === 'pending';
    const check = async () => {
        setBusy(true);
        await refresh();
        setBusy(false);
        if (isPending) toast('승인 상태를 확인했습니다.', 'ok');
    };
    const apply = async () => {
        setBusy(true);
        try {
            await requestRepairMembership(name);
            await refresh();
            toast('수리노트 가입 신청이 완료됐습니다.', 'ok');
        } catch (error) {
            toast(messageOf(error), 'error');
        } finally {
            setBusy(false);
        }
    };
    return (
        <main className="rn-auth-screen">
            <section className="rn-auth-card rn-pending">
                <span className="rn-pending-icon"><Icon name="shield" size={27} /></span>
                <div className="rn-eyebrow">MEMBERSHIP REVIEW</div>
                <h1>{isPending ? '승인 대기 중입니다' : '수리노트 가입 신청'}</h1>
                <p className="rn-auth-sub">
                    {name ? name + '님, ' : ''}{isPending
                        ? '회원 확인이 끝나면 제품별 수리 자료를 볼 수 있습니다.'
                        : '가입 신청 후 운영자 승인이 완료되면 이용할 수 있습니다.'}
                </p>
                <div className="rn-pending-info">
                    <strong>{isPending ? '승인 후 이용 가능' : '가입 신청 대상'}</strong>
                    <span>수리 및 점검방법 · 테스트 모드 · 에러 코드 · 부품교체 노하우</span>
                </div>
                <button className="rn-primary-btn rn-wide" onClick={() => void (isPending ? check() : apply())} disabled={busy}>
                    {busy ? <span className="rn-spinner" /> : isPending ? '승인 상태 확인' : '가입 신청하기'}
                </button>
                <button className="rn-text-btn" onClick={() => void supabase.auth.signOut()}>
                    로그아웃
                </button>
            </section>
        </main>
    );
}

function ProfileSetupDialog({ userId, onComplete }: { userId: string; onComplete: () => Promise<void> }) {
    const [name, setName] = useState('');
    const [jobTitle, setJobTitle] = useState<RepairJobTitle | ''>('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const toast = useToast();

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (saving) return;
        const displayName = name.trim();
        const selectedTitle = REPAIR_JOB_TITLES.find(title => title === jobTitle);
        if (!displayName || displayName.length > 40 || !selectedTitle) {
            setError('직급을 선택하고 이름을 1~40자로 입력해 주세요.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            await updateRepairMemberProfile(userId, displayName, selectedTitle, null);
            await onComplete();
            toast('수리노트 프로필이 등록됐습니다.', 'ok');
        } catch (reason) {
            setError(messageOf(reason));
            setSaving(false);
        }
    };

    return (
        <div className="rn-dialog-backdrop rn-setup-backdrop">
            <form className="rn-dialog rn-setup-dialog" role="dialog" aria-modal="true"
                  aria-labelledby="rn-setup-title" aria-describedby="rn-setup-description"
                  onSubmit={event => void submit(event)}>
                <span className="rn-eyebrow">WELCOME TO REPAIR NOTE</span>
                <h2 id="rn-setup-title">직급을 선택하고 이름을 입력해 주세요</h2>
                <p id="rn-setup-description">동료에게 표시할 수리노트 회원 정보를 등록합니다.</p>
                <label className="rn-field">
                    <span>직급 <b>*</b></span>
                    <select value={jobTitle} onChange={event => setJobTitle(event.target.value as RepairJobTitle | '')} required>
                        <option value="">직급 선택</option>
                        {REPAIR_JOB_TITLES.map(title => <option key={title} value={title}>{title}</option>)}
                    </select>
                </label>
                <label className="rn-field">
                    <span>이름 <b>*</b></span>
                    <input value={name} onChange={event => setName(event.target.value)}
                           placeholder="실제로 사용할 이름을 입력하세요" maxLength={40} required />
                </label>
                {error && <p className="rn-setup-error" role="alert">{error}</p>}
                <button className="rn-primary-btn rn-wide" type="submit" disabled={saving}>
                    {saving ? '저장 중…' : '저장하고 시작하기'}
                </button>
                <button className="rn-text-btn rn-setup-logout" type="button"
                        onClick={() => void supabase.auth.signOut()} disabled={saving}>다른 계정으로 로그인</button>
            </form>
        </div>
    );
}

function RepairWorkspace({ membership, isAdmin, onProfileChange }: {
    membership: RepairMembership; isAdmin: boolean; onProfileChange: () => Promise<void>;
}) {
    const userId = membership.user_id;
    const needsProfile = !membership.profile_completed_at || !membership.job_title;
    useEffect(() => {
        // 이전 판의 수리노트 웹 구독을 까꿍 발송 목록에서 안전하게 옮긴다.
        void syncRepairPushSubscription(userId).catch(error =>
            console.warn('[repair] 알림 구독 이전 실패', error))
            .finally(() => window.dispatchEvent(new Event('repair-push-changed')));
    }, [userId]);
    // 홈 화면 아이콘의 뱃지는 수리노트를 열거나 다시 돌아오면 비운다.
    // 아직 안 읽은 알림함 숫자는 Header가 별도로 표시한다.
    useEffect(() => watchBadge(), []);
    return (
        <>
            <div className="rn-app" inert={needsProfile}>
                <Header membership={membership} isAdmin={isAdmin} onProfileChange={onProfileChange} />
                <div className="rn-layout">
                    <aside className="rn-sidebar">
                        <SidebarNav isAdmin={isAdmin} />
                        <div className="rn-sidebar-foot">
                            <span className="rn-sidebar-dot" />
                            <span>승인된 회원 전용 공간</span>
                        </div>
                    </aside>
                    <main className="rn-main">
                        <Routes>
                            <Route path="/" element={<KnowledgeHome key="case" userId={userId} scope="case" />} />
                            <Route path="/saved" element={<KnowledgeHome key="saved" userId={userId} scope="saved" />} />
                            <Route path="/mine" element={<KnowledgeHome key="mine" userId={userId} scope="mine" />} />
                            <Route path="/new" element={<EntryForm userId={userId} />} />
                            <Route path="/entry/:id/edit" element={<EntryForm userId={userId} isAdmin={isAdmin} />} />
                            <Route path="/entry/:id" element={<EntryDetail userId={userId} isAdmin={isAdmin} />} />
                            <Route path="/alerts" element={<NotificationCenter userId={userId} />} />
                            <Route path="/members" element={<MemberApprovals isAdmin={isAdmin} />} />
                            <Route path="/guide" element={<GuidePage />} />
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </main>
                </div>
                <MobileNav />
            </div>
            {needsProfile && <ProfileSetupDialog userId={userId} onComplete={onProfileChange} />}
        </>
    );
}

function Header({ membership, isAdmin, onProfileChange }: {
    membership: RepairMembership; isAdmin: boolean; onProfileChange: () => Promise<void>;
}) {
    const userId = membership.user_id;
    const name = membership.display_name || '회원';
    const [count, setCount] = useState(0);
    const [menuOpen, setMenuOpen] = useState(false);
    const [nameEditOpen, setNameEditOpen] = useState(false);
    const [nameDraft, setNameDraft] = useState(name);
    const [jobTitleDraft, setJobTitleDraft] = useState<RepairJobTitle | ''>(membership.job_title ?? '');
    const [savingName, setSavingName] = useState(false);
    const toast = useToast();
    const navigate = useNavigate();

    const refreshCount = useCallback(async () => {
        try {
            setCount(await unreadNotificationCount(userId));
        } catch { /* 알림함을 열면 다시 읽는다 */ }
    }, [userId]);

    useEffect(() => {
        void refreshCount();
        const channel = repairDb.channel('repair-badge-' + userId)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'repair_notifications',
                filter: 'user_id=eq.' + userId,
            }, () => void refreshCount())
            .subscribe();
        return () => { void repairDb.removeChannel(channel); };
    }, [refreshCount, userId]);

    const [push, setPush] = useState<PushState | null>(null);
    useEffect(() => {
        const refresh = () => { void pushState('repair', userId).then(setPush); };
        refresh();
        window.addEventListener('repair-push-changed', refresh);
        return () => window.removeEventListener('repair-push-changed', refresh);
    }, [userId]);

    const turnOnPush = async () => {
        if (push === 'on') { toast('수리노트 알림이 이미 켜져 있습니다.', 'ok'); return; }
        try {
            const state = await enablePush(userId, 'repair');
            setPush(state);
            window.dispatchEvent(new Event('repair-push-changed'));
            if (state === 'on') toast('이 기기에서 새 수리 정보 알림을 받습니다.', 'ok');
            else if (state === 'standalone-required') toast('홈 화면에 추가한 앱에서 알림을 켤 수 있습니다.', 'error');
            else if (state === 'denied') toast('브라우저 설정에서 알림 권한을 허용해 주세요.', 'error');
            else toast('이 기기에서 푸시 알림을 사용할 수 없습니다.', 'error');
        } catch (error) {
            toast(messageOf(error), 'error');
        }
    };

    const saveProfile = async () => {
        const nextName = nameDraft.trim();
        const nextTitle = REPAIR_JOB_TITLES.find(title => title === jobTitleDraft);
        if (!nextName || nextName.length > 40 || !nextTitle) {
            toast('직급을 선택하고 이름을 1~40자로 입력해 주세요.', 'error');
            return;
        }
        setSavingName(true);
        try {
            await updateRepairMemberProfile(userId, nextName, nextTitle, membership.profile_completed_at);
            await onProfileChange();
            setNameEditOpen(false);
            setMenuOpen(false);
            toast('수리노트 프로필을 변경했습니다.', 'ok');
        } catch (error) {
            toast(messageOf(error), 'error');
        } finally {
            setSavingName(false);
        }
    };

    return (
        <>
            <header className="rn-header">
                <Link className="rn-brand" to="/">
                    <Mark />
                    <span className="rn-brand-copy">
                        <strong>수리노트</strong>
                        <small>광산센터 기술 지식 공유 플랫폼</small>
                    </span>
                </Link>
                <div className="rn-header-actions">
                    <button className="rn-bell-btn" aria-label="알림함" onClick={() => navigate('/alerts')}>
                        <Icon name="bell" size={20} />
                        {count > 0 && <span className="rn-badge">{count > 99 ? '99+' : count}</span>}
                    </button>
                    <div className="rn-user-wrap">
                        <button className="rn-user-btn" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
                            <span className="rn-avatar">{name.slice(0, 1)}</span>
                            <span className="rn-user-name">{name}</span>
                            <span className="rn-chevron">⌄</span>
                        </button>
                        {menuOpen && (
                            <div className="rn-user-menu">
                                <span className="rn-menu-label">{name}님 · {membership.job_title}</span>
                                <button onClick={() => { setNameDraft(name); setJobTitleDraft(membership.job_title ?? ''); setNameEditOpen(true); }}>
                                    <Icon name="user" size={16} /> 이름·직급 변경
                                </button>
                                <button onClick={() => { setMenuOpen(false); void turnOnPush(); }}>
                                    <Icon name="bell" size={16} /> {push === 'on' ? '알림 켜짐' : push === 'off' || push === null ? '알림 켜기' : '알림 설정 안내'}
                                </button>
                                <Link to="/members" onClick={() => setMenuOpen(false)}>
                                    <Icon name="user" size={16} /> {isAdmin ? '회원·가입 신청 관리' : '회원 명단'}
                                </Link>
                                <button onClick={() => void supabase.auth.signOut()}>
                                    <Icon name="logout" size={16} /> 로그아웃
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </header>
            {nameEditOpen && (
                <div className="rn-dialog-backdrop" onClick={() => setNameEditOpen(false)}>
                    <section className="rn-dialog" role="dialog" aria-modal="true" aria-labelledby="rn-name-title"
                             onClick={event => event.stopPropagation()}>
                        <span className="rn-eyebrow">PROFILE</span>
                        <h2 id="rn-name-title">내 정보 변경</h2>
                        <p>직급과 이름은 수리노트 회원 명단에 표시됩니다.</p>
                        <label className="rn-field">
                            <span>직급</span>
                            <select value={jobTitleDraft} onChange={event => setJobTitleDraft(event.target.value as RepairJobTitle | '')}>
                                <option value="">직급 선택</option>
                                {REPAIR_JOB_TITLES.map(title => <option key={title} value={title}>{title}</option>)}
                            </select>
                        </label>
                        <label className="rn-field">
                            <span>표시 이름</span>
                            <input value={nameDraft} onChange={event => setNameDraft(event.target.value)}
                                   maxLength={40} autoFocus />
                        </label>
                        <div className="rn-dialog-actions">
                            <button className="rn-secondary-btn" onClick={() => setNameEditOpen(false)}>취소</button>
                            <button className="rn-primary-btn" onClick={() => void saveProfile()} disabled={savingName}>
                                {savingName ? '저장 중…' : '저장'}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </>
    );
}

function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
    const location = useLocation();
    const links = [
        { to: '/', label: '지식 홈', icon: 'home' as const },
        { to: '/saved', label: '저장한 글', icon: 'star' as const },
        { to: '/mine', label: '내 글', icon: 'book' as const },
        { to: '/alerts', label: '알림함', icon: 'bell' as const },
        { to: '/guide', label: '등록 안내', icon: 'book' as const },
    ];
    return (
        <nav className="rn-side-nav" aria-label="주 메뉴">
            <div className="rn-side-label">WORKSPACE</div>
            {links.map(link => (
                <Link key={link.to} to={link.to}
                      className={'rn-side-link' + (location.pathname === link.to ? ' active' : '')}>
                    <Icon name={link.icon} size={18} />
                    <span>{link.label}</span>
                </Link>
            ))}
        <Link to="/members" className={'rn-side-link' + (location.pathname === '/members' ? ' active' : '')}>
            <Icon name="user" size={18} /><span>{isAdmin ? '회원 관리' : '회원 명단'}</span>
        </Link>
            <Link to="/new" className="rn-side-create"><Icon name="plus" size={18} />수리 정보 등록</Link>
            <div className="rn-side-tip">
                <span className="rn-side-tip-icon"><Icon name="wrench" size={17} /></span>
                <strong>현장 경험을 지식으로</strong>
                <span>모델과 증상을 구체적으로 적으면 다음 엔지니어가 더 빨리 찾을 수 있습니다.</span>
            </div>
        </nav>
    );
}

function MobileNav() {
    const location = useLocation();
    const links = [
        { to: '/', label: '홈', icon: 'home' as const },
        { to: '/saved', label: '저장한 글', icon: 'star' as const },
        { to: '/mine', label: '내 글', icon: 'book' as const },
    ];
    return (
        <nav className="rn-mobile-nav" aria-label="모바일 메뉴">
            {links.map(link => (
                <Link key={link.to} to={link.to}
                      className={'rn-mobile-link' + (location.pathname === link.to ? ' active' : '')}>
                    <Icon name={link.icon} size={20} /><span>{link.label}</span>
                </Link>
            ))}
        </nav>
    );
}

function KnowledgeHome({ userId, scope }: { userId: string; scope: 'case' | 'saved' | 'mine' }) {
    const [entries, setEntries] = useState<RepairEntry[] | null>(null);
    const [loading, setLoading] = useState(true);
    const personalTitle = scope === 'saved' ? '저장한 글' : '내 글';
    const [visibleCount, setVisibleCount] = useState(5);
    const [error, setError] = useState('');
    const [filters, setFilters] = useState<EntryFilters>({});
    const [push, setPush] = useState<PushState | null>(null);
    const [pushBusy, setPushBusy] = useState(false);
    const toast = useToast();

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setEntries(await searchEntries(filters, scope));
        } catch (reason) {
            setError(messageOf(reason));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [filters, scope]);

    useEffect(() => {
        const timer = window.setTimeout(() => void load(), 220);
        return () => window.clearTimeout(timer);
    }, [load]);

    useEffect(() => { setVisibleCount(5); }, [filters, scope]);

    useEffect(() => {
        const refresh = () => { void pushState('repair', userId).then(setPush); };
        refresh();
        window.addEventListener('repair-push-changed', refresh);
        const channel = repairDb.channel('repair-entries-list')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'repair_entries' },
                () => void load())
            .subscribe();
        return () => {
            window.removeEventListener('repair-push-changed', refresh);
            void repairDb.removeChannel(channel);
        };
    }, [load, userId]);

    const change = (key: keyof EntryFilters, value: string) =>
        setFilters(current => ({ ...current, [key]: value }));

    const enableNotifications = async () => {
        setPushBusy(true);
        try {
            const state = await enablePush(userId, 'repair');
            setPush(state);
            window.dispatchEvent(new Event('repair-push-changed'));
            if (state === 'on') toast('새 수리 정보 알림이 켜졌습니다.', 'ok');
            else if (state === 'standalone-required') toast('홈 화면에 추가한 앱에서 알림을 켤 수 있습니다.', 'error');
            else if (state === 'denied') toast('브라우저 설정에서 알림 권한을 허용해 주세요.', 'error');
            else toast('이 기기에서 푸시 알림을 사용할 수 없습니다.', 'error');
        } catch (error) {
            toast(messageOf(error), 'error');
        } finally {
            setPushBusy(false);
        }
    };

    const clearFilters = () => setFilters({});
    const hasFilters = Boolean(filters.query || filters.family || filters.category);
    const activeCategory = filters.category ?? '';

    return (
        <div className="rn-page">
            {scope === 'case' && <section className="rn-hero">
                <div className="rn-hero-copy">
                    <span className="rn-hero-kicker">FIELD KNOWLEDGE BASE</span>
                    <h1>고장 증상부터 점검 절차까지<br /><em>모델별로 빠르게 찾으세요.</em></h1>
                    <p>현장의 수리 및 점검 방법과 수리 노하우를 함께 모아<br className="rn-desktop-only" /> 더 빠르고 정확한 수리를 돕습니다.</p>
                    <Link to="/new" className="rn-hero-action">등록하기 <Icon name="arrow" size={17} /></Link>
                </div>
                <div className="rn-hero-art" aria-hidden="true">
                    <div className="rn-orbit rn-orbit-a" />
                    <div className="rn-orbit rn-orbit-b" />
                    <div className="rn-hero-tool"><Icon name="wrench" size={60} /></div>
                    <span className="rn-art-chip rn-chip-one">MODEL</span>
                    <span className="rn-art-chip rn-chip-two">CHECK</span>
                    <span className="rn-art-dot" />
                </div>
            </section>}

            {scope === 'case' && push !== 'on' && push !== 'unsupported' && (
                <section className="rn-notice-bar">
                    <span className="rn-notice-icon"><Icon name="bell" size={17} /></span>
                    <span className="rn-notice-text">
                        <strong>새로 등록된 점검 정보, 놓치지 마세요.</strong>
                        <small>{push === 'standalone-required' ? '홈 화면에 추가한 앱에서 푸시 알림을 켤 수 있습니다.' : push === 'denied' ? '브라우저 설정에서 알림 권한을 변경할 수 있습니다.' : '푸시 알림을 켜면 앱을 닫아도 소식을 받을 수 있습니다.'}</small>
                    </span>
                    {(push === 'off' || push === null || push === 'denied' || push === 'standalone-required') && (
                        <button onClick={() => void enableNotifications()} disabled={pushBusy}>
                            {pushBusy ? '확인 중…' : push === 'off' || push === null ? '알림 켜기' : '설정 안내'}
                        </button>
                    )}
                </section>
            )}

            <section className="rn-search-panel">
                <div className="rn-search-title">
                    <div>
                        <span className="rn-eyebrow">KNOWLEDGE LIBRARY</span>
                        <h2>{scope === 'case' ? '수리 정보 찾기' : personalTitle}</h2>
                    </div>
                    <span className="rn-result-count">{loading ? '검색 중…' : (entries?.length ?? 0) + '건'}</span>
                </div>
                <label className="rn-search-box">
                    <Icon name="search" size={21} />
                    <input
                        value={filters.query ?? ''}
                        onChange={event => change('query', event.target.value)}
                        placeholder="모델명·증상·에러 코드 검색"
                        aria-label="수리 정보 검색"
                    />
                    {hasFilters && <button onClick={clearFilters} type="button">초기화</button>}
                </label>
                <div className="rn-filter-row">
                    <label className="rn-filter-select">
                        <span>제품군</span>
                        <select value={filters.family ?? ''} onChange={event => change('family', event.target.value)}>
                            <option value="">전체 제품군</option>
                            {PRODUCT_FAMILIES.map(family => <option key={family} value={family}>{family}</option>)}
                        </select>
                    </label>
                </div>
                <div className="rn-category-filter" role="group" aria-label="정보 유형">
                    <button className={!activeCategory ? 'active' : ''} onClick={() => change('category', '')}>전체 유형</button>
                    {ENTRY_CATEGORIES.map(category => (
                        <button key={category.id}
                                className={activeCategory === category.id ? 'active' : ''}
                                onClick={() => change('category', category.id)}>
                            {category.label}
                        </button>
                    ))}
                </div>
            </section>

            <section className="rn-results">
                <div className="rn-section-heading">
                    <div>
                        <span className="rn-eyebrow">{hasFilters ? 'SEARCH RESULTS' : 'LATEST KNOWLEDGE'}</span>
                        <h2>{hasFilters ? '검색 결과' : scope === 'case' ? '최근 등록된 정보' : '글 목록'}</h2>
                    </div>
                    <Link to="/new" className="rn-inline-link">수리 정보 등록 <Icon name="arrow" size={15} /></Link>
                </div>
                {error && (
                    <div className="rn-error-panel">
                        <strong>정보를 불러오지 못했습니다.</strong>
                        <span>{/search_repair_entries|schema cache|does not exist/i.test(error)
                            ? '데이터베이스 설정을 확인해 주세요. 관리자에게 앱 설치 안내를 전달할 수 있습니다.'
                            : '네트워크 연결을 확인하고 다시 시도해 주세요.'}</span>
                        <button onClick={() => void load()}>다시 시도</button>
                    </div>
                )}
                {loading && !entries && <div className="rn-loading-line"><span className="rn-spinner" /> 정보 불러오는 중</div>}
                {!loading && !error && entries?.length === 0 && (
                    <div className="rn-empty">
                        <span><Icon name="search" size={26} /></span>
                        <strong>{hasFilters ? '검색 결과가 없습니다.' : scope === 'saved' ? '아직 저장한 글이 없습니다.' : scope === 'mine' ? '아직 작성한 글이 없습니다.' : '아직 등록된 수리 정보가 없습니다.'}</strong>
                        <p>{hasFilters ? '모델명이나 검색어를 바꾸어 다시 찾아보세요.' : scope === 'saved' ? '글 상세에서 ☆ 저장을 눌러 주세요.' : '첫 수리 및 점검 정보를 등록해 주세요.'}</p>
                        {scope !== 'saved' && !hasFilters && <Link to="/new" className="rn-primary-btn">첫 정보 등록하기</Link>}
                    </div>
                )}
                {!!entries?.length && (
                    <>
                        <div className="rn-entry-grid">
                            {entries.slice(0, visibleCount).map(entry => <EntryCard key={entry.id} entry={entry} />)}
                        </div>
                        {visibleCount < entries.length && (
                            <div className="rn-load-more-wrap">
                                <button className="rn-secondary-btn rn-load-more" onClick={() => setVisibleCount(count => count + 5)}>
                                    더 보기 <span>{Math.min(5, entries.length - visibleCount)}건</span>
                                </button>
                            </div>
                        )}
                    </>
                )}
            </section>
        </div>
    );
}

function EntryCard({ entry }: { entry: RepairEntry }) {
    const category = ENTRY_CATEGORIES.find(item => item.id === entry.category);
    return (
        <Link to={'/entry/' + entry.id} className="rn-entry-card">
            <div className="rn-entry-card-top">
                <span className={'rn-category-tag cat-' + entry.category}>
                    <span>{category?.icon ?? '•'}</span>{category?.label ?? '수리 정보'}
                </span>
            </div>
            <div className="rn-model-line">
                <span className="rn-family">{entry.product_family}</span>
                <strong>{entry.model_code || '제품군 공통'}</strong>
            </div>
            <h3>{entry.title}</h3>
            {entry.symptoms && <p className="rn-card-symptom">{entry.symptoms}</p>}
            <div className="rn-card-footer">
                <span className="rn-author-dot">{(entry.author_name ?? '회').slice(0, 1)}</span>
                <span>{entry.author_name ?? '회원'}</span>
                <span className="rn-separator">·</span>
                <time>{dateLabel(entry.created_at)}</time>
                {entry.photo_paths.length > 0 && <span className="rn-card-photo"><Icon name="image" size={15} /> {entry.photo_paths.length}</span>}
            </div>
            {entry.tags?.length > 0 && (
                <div className="rn-tag-row">
                    {entry.tags.slice(0, 3).map(tag => <span key={tag}>#{tag}</span>)}
                </div>
            )}
        </Link>
    );
}

function EntryForm({ userId, isAdmin = false }: { userId: string; isAdmin?: boolean }) {
    const toast = useToast();
    const navigate = useNavigate();
    const { id: editId } = useParams();
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(!!editId);
    const [existingEntry, setExistingEntry] = useState<RepairEntry | null>(null);
    const [existingPhotos, setExistingPhotos] = useState<{ path: string; url: string }[]>([]);
    const [files, setFiles] = useState<File[]>([]);
    const [tagsText, setTagsText] = useState('');
    const [form, setForm] = useState({
        product_family: '',
        model_code: '',
        category: 'inspection' as EntryCategory,
        title: '',
        symptoms: '',
        inspection_steps: '',
        cautions: '',
    });

    const previews = useMemo(() => files.map(file => URL.createObjectURL(file)), [files]);
    useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews]);

    useEffect(() => {
        if (!editId) return;
        let active = true;
        void getEntry(editId).then(async entry => {
            if (!active) return;
            if (entry.created_by !== userId && !isAdmin) {
                toast('본인이 작성한 글만 수정할 수 있습니다.', 'error');
                navigate('/entry/' + editId, { replace: true });
                return;
            }
            setExistingEntry(entry);
            setForm({
                product_family: entry.product_family,
                model_code: entry.model_code,
                category: entry.category as EntryCategory,
                title: entry.title,
                symptoms: entry.symptoms ?? '',
                inspection_steps: entry.inspection_steps,
                cautions: entry.cautions ?? '',
            });
            setTagsText((entry.tags ?? []).join(', '));
            const urls = await signedPhotoUrls(entry.photo_paths);
            if (active) setExistingPhotos(entry.photo_paths.map((path, index) => ({ path, url: urls[index] ?? '' })));
        }).catch(error => {
            if (active) toast(messageOf(error), 'error');
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [editId, isAdmin, navigate, toast, userId]);

    const field = (name: keyof typeof form, value: string) =>
        setForm(current => ({ ...current, [name]: value }));

    const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
        const incoming = Array.from(event.target.files ?? []);
        const maxNew = 6 - existingPhotos.length;
        const next = [...files, ...incoming].slice(0, maxNew);
        if (files.length + incoming.length > maxNew) toast('사진은 최대 6장까지 첨부할 수 있습니다.', 'error');
        setFiles(next);
        event.target.value = '';
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!form.product_family || !form.title.trim() || !form.inspection_steps.trim()) {
            toast('제품군, 제목, 수리 및 점검방법을 입력해 주세요.', 'error');
            return;
        }
        setSaving(true);
        try {
            const input = {
                ...form,
                model_code: form.model_code.trim().toUpperCase(),
                title: form.title.trim(),
                symptoms: form.symptoms.trim(),
                inspection_steps: form.inspection_steps.trim(),
                result_notes: '',
                cautions: form.cautions.trim(),
                tags: tagsText.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean).slice(0, 10),
            };
            if (editId && existingEntry) {
                const keptPaths = existingPhotos.map(photo => photo.path);
                const removedPaths = existingEntry.photo_paths.filter(path => !keptPaths.includes(path));
                await updateEntry(editId, input, files, userId, keptPaths, removedPaths);
                toast('수리 정보가 수정됐습니다.', 'ok');
                navigate('/entry/' + editId);
            } else {
                const newId = await createEntry(input, files, userId);
                toast('수리 정보가 등록되었습니다. 회원 알림함에 공유됐습니다.', 'ok');
                navigate('/entry/' + newId);
            }
        } catch (error) {
            toast(messageOf(error), 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="rn-page"><div className="rn-loading-line"><span className="rn-spinner" /> 작성한 정보 불러오는 중</div></div>;
    if (editId && !existingEntry) return <div className="rn-page"><div className="rn-error-panel"><strong>수리 정보를 불러오지 못했습니다.</strong><span>다시 시도해 주세요.</span><Link to="/">지식 홈으로</Link></div></div>;

    return (
        <div className="rn-page rn-form-page">
            <div className="rn-page-heading">
                <Link className="rn-back-link" to="/"><span>‹</span> 지식 홈으로</Link>
                <span className="rn-eyebrow">SHARE FIELD KNOWLEDGE</span>
                <h1>{editId ? '수리 정보 수정' : '수리 정보 등록'}</h1>
                <p>모델과 증상을 구체적으로 기록하면 동료가 더 빠르게 찾을 수 있습니다.</p>
            </div>
            <form className="rn-form-card" onSubmit={submit}>
                <div className="rn-form-section">
                    <div className="rn-form-section-title">
                        <span className="rn-step-number">01</span>
                        <div><strong>제품과 정보 유형</strong><small>찾기 쉬운 분류를 선택해 주세요.</small></div>
                    </div>
                    <div className="rn-form-grid">
                        <label className="rn-field">
                            <span>제품군 <b>*</b></span>
                            <select value={form.product_family} onChange={e => field('product_family', e.target.value)} required>
                                <option value="">제품군 선택</option>
                                {PRODUCT_FAMILIES.map(family => <option key={family}>{family}</option>)}
                            </select>
                        </label>
                        <label className="rn-field">
                            <span>정보 유형 <b>*</b></span>
                            <select value={form.category} onChange={e => field('category', e.target.value)}>
                                {ENTRY_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
                            </select>
                        </label>
                        <label className="rn-field rn-span-2">
                            <span>모델명 <small>(선택)</small></span>
                            <input value={form.model_code} onChange={e => field('model_code', e.target.value)}
                                   placeholder="특정 모델에 해당할 때 입력하세요" maxLength={50} />
                            <small>제품군 공통 내용이면 비워두세요. 특정 모델에만 해당하면 모델명을 적어 주세요.</small>
                        </label>
                        <label className="rn-field rn-span-2">
                            <span>제목 <b>*</b></span>
                            <input value={form.title} onChange={e => field('title', e.target.value)}
                                   placeholder="예: 얼음 생성 불가 점검" maxLength={120} required />
                        </label>
                    </div>
                </div>

                <div className="rn-form-section">
                    <div className="rn-form-section-title">
                        <span className="rn-step-number">02</span>
                        <div><strong>수리 및 점검 내용</strong><small>증상과 점검 순서, 주의사항을 구체적으로 적어 주세요.</small></div>
                    </div>
                    <label className="rn-field">
                        <span>고객 증상·발생 조건</span>
                        <textarea value={form.symptoms} onChange={e => field('symptoms', e.target.value)}
                                  placeholder="언제, 어떤 조건에서 증상이 나타나는지 적어 주세요." rows={3} maxLength={1200} />
                    </label>
                    <label className="rn-field">
                        <span>수리 및 점검방법 <b>*</b></span>
                        <textarea value={form.inspection_steps} onChange={e => field('inspection_steps', e.target.value)}
                                  placeholder={'1. 먼저 확인할 항목\n2. 측정 또는 테스트 조건\n3. 결과에 따른 다음 점검'} rows={7} maxLength={8000} required />
                    </label>
                    <label className="rn-field">
                        <span>주의 사항</span>
                        <textarea value={form.cautions} onChange={e => field('cautions', e.target.value)}
                                  placeholder="전원 차단, 잔류 압력, 고온부 등 현장에서 놓치기 쉬운 주의점을 적어 주세요." rows={3} maxLength={1800} />
                    </label>
                    {form.category === 'test_mode' ? (
                        <div className="rn-safety-note"><Icon name="shield" size={17} />
                            모델과 절차를 다시 확인하고, 현장 안전 기준에 따라 사용해 주세요.
                        </div>
                    ) : null}
                </div>

                <div className="rn-form-section">
                    <div className="rn-form-section-title">
                        <span className="rn-step-number">03</span>
                        <div><strong>사진과 검색 태그</strong><small>사진은 승인된 회원만 볼 수 있습니다.</small></div>
                    </div>
                    <div className="rn-upload-area">
                        <label className="rn-upload-button">
                            <Icon name="image" size={19} />
                            <span>사진 추가</span>
                            <small>{existingPhotos.length + files.length}/6</small>
                            <input type="file" accept="image/*" multiple onChange={addFiles} />
                        </label>
                        <p>JPG, PNG, WebP · 최대 6장 · 사진의 고객 정보는 가려 주세요.</p>
                    </div>
                    {!!files.length && (
                        <div className="rn-photo-preview-grid">
                            {files.map((file, index) => (
                                <div className="rn-photo-preview" key={file.name + index}>
                                    <img src={previews[index]} alt={'첨부 사진 ' + (index + 1)} />
                                    <button type="button" onClick={() => setFiles(current => current.filter((_, i) => i !== index))}
                                            aria-label="사진 삭제">×</button>
                                </div>
                            ))}
                        </div>
                    )}
                    {!!existingPhotos.length && (
                        <div className="rn-photo-preview-grid">
                            {existingPhotos.map((photo, index) => <div className="rn-photo-preview" key={photo.path}>
                                {photo.url && <img src={photo.url} alt={'기존 사진 ' + (index + 1)} />}
                                <span className="rn-existing-photo-label">기존</span>
                                <button type="button" onClick={() => setExistingPhotos(current => current.filter(item => item.path !== photo.path))}
                                        aria-label={'기존 사진 ' + (index + 1) + ' 삭제'}>×</button>
                            </div>)}
                        </div>
                    )}
                    {editId && <p className="rn-photo-save-hint">사진 삭제는 ‘수정 내용 저장’을 누르면 반영됩니다.</p>}
                    <label className="rn-field">
                        <span>검색 태그 <small>(쉼표로 구분)</small></span>
                        <input value={tagsText} onChange={e => setTagsText(e.target.value)}
                               placeholder="예: 냉방불량, 센서, EEV" maxLength={200} />
                    </label>
                </div>
                <div className="rn-form-actions">
                    <Link to={editId ? '/entry/' + editId : '/'} className="rn-secondary-btn">취소</Link>
                    <button type="submit" className="rn-primary-btn" disabled={saving}>
                        {saving ? <><span className="rn-spinner" /> 저장 중…</> : editId ? '수정 내용 저장' : '등록하기'}
                    </button>
                </div>
            </form>
        </div>
    );
}

function EntryDetail({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
    const { id: entryId = '' } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const [entry, setEntry] = useState<RepairEntry | null>(null);
    const [saved, setSaved] = useState(false);
    const [photos, setPhotos] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await getEntry(entryId);
            const bookmark = await repairDb.from('repair_bookmarks').select('entry_id')
                .eq('user_id', userId).eq('entry_id', entryId).maybeSingle();
            if (bookmark.error) throw bookmark.error;
            setSaved(Boolean(bookmark.data));
            setEntry(data);
            setPhotos(await signedPhotoUrls(data.photo_paths));
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setLoading(false);
        }
    }, [entryId, userId]);
    useEffect(() => { void load(); }, [load]);

    const toggleSaved = async () => {
        setBusy(true);
        try {
            const bookmarks = repairDb.from('repair_bookmarks');
            const result = saved
                ? await bookmarks.delete().eq('user_id', userId).eq('entry_id', entryId)
                : await bookmarks.upsert({ user_id: userId, entry_id: entryId }, { ignoreDuplicates: true });
            if (result.error) throw result.error;
            setSaved(!saved);
        } catch (reason) {
            toast(messageOf(reason), 'error');
        } finally {
            setBusy(false);
        }
    };

    const destroy = async () => {
        if (!entry || !window.confirm('이 수리 정보를 삭제할까요?')) return;
        setBusy(true);
        try {
            await removeEntry(entry);
            toast('수리 정보가 삭제됐습니다.', 'ok');
            navigate('/');
        } catch (reason) {
            toast(messageOf(reason), 'error');
            setBusy(false);
        }
    };

    if (loading) return <div className="rn-page"><div className="rn-loading-line"><span className="rn-spinner" /> 정보 불러오는 중</div></div>;
    if (error || !entry) return (
        <div className="rn-page">
            <Link className="rn-back-link" to="/"><span>‹</span> 지식 홈으로</Link>
            <div className="rn-error-panel"><strong>수리 정보를 열 수 없습니다.</strong><span>{error}</span></div>
        </div>
    );

    const category = ENTRY_CATEGORIES.find(item => item.id === entry.category);
    const canDelete = isAdmin || entry.created_by === userId;
    const canEdit = canDelete;
    return (
        <div className="rn-page rn-detail-page">
            <Link className="rn-back-link" to="/"><span>‹</span> 검색 결과로 돌아가기</Link>
            <article className="rn-detail-card">
                <div className="rn-detail-topline">
                    <span className={'rn-category-tag cat-' + entry.category}><span>{category?.icon ?? '•'}</span>{category?.label ?? '수리 정보'}</span>
                    <button type="button" className="rn-secondary-btn" aria-pressed={saved}
                            disabled={busy} onClick={() => void toggleSaved()}>
                        {saved ? '★ 저장됨' : '☆ 저장'}
                    </button>
                </div>
                <div className="rn-detail-model">
                    <span>{entry.product_family}</span><b>{entry.model_code || '제품군 공통'}</b>
                </div>
                <h1>{entry.title}</h1>
                <div className="rn-detail-author">
                    <span className="rn-author-dot">{(entry.author_name ?? '회').slice(0, 1)}</span>
                    <strong>{entry.author_name ?? '회원'}</strong>
                    <span>등록</span><time>{dateLabel(entry.created_at)}</time>
                    {entry.updated_at !== entry.created_at && <span className="rn-edited">수정됨</span>}
                </div>

                {entry.symptoms && <DetailSection title="고객 증상·발생 조건"><p>{entry.symptoms}</p></DetailSection>}
                <DetailSection title="수리 및 점검방법·테스트 절차">
                    <div className="rn-detail-text">{entry.inspection_steps}</div>
                </DetailSection>
                {entry.result_notes && <DetailSection title="추가 기록"><div className="rn-detail-text">{entry.result_notes}</div></DetailSection>}
                {entry.cautions && <DetailSection title="주의 사항" warning><div className="rn-detail-text">{entry.cautions}</div></DetailSection>}

                {!!entry.tags?.length && (
                    <div className="rn-detail-tags">{entry.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>
                )}
                {!!photos.filter(Boolean).length && (
                    <section className="rn-detail-section">
                        <h2><Icon name="image" size={17} /> 첨부 사진 <span>{photos.filter(Boolean).length}</span></h2>
                        <div className="rn-detail-photos">
                            {photos.filter(Boolean).map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">
                                <img src={url} alt={entry.title + ' 참고 사진 ' + (index + 1)} />
                            </a>)}
                        </div>
                    </section>
                )}

                {canDelete && (
                    <div className="rn-detail-actions">
                        {canEdit && <Link className="rn-secondary-btn" to={'/entry/' + entry.id + '/edit'}>수정</Link>}
                        <button className="rn-delete-btn" onClick={() => void destroy()} disabled={busy}>이 정보 삭제</button>
                    </div>
                )}
            </article>
        </div>
    );
}

function DetailSection({ title, children, warning = false }: { title: string; children: ReactNode; warning?: boolean }) {
    return (
        <section className={'rn-detail-section' + (warning ? ' warning' : '')}>
            <h2>{title}</h2>
            {children}
        </section>
    );
}

function NotificationCenter({ userId }: { userId: string }) {
    const [items, setItems] = useState<RepairNotification[]>([]);
    const [fresh, setFresh] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const toast = useToast();

    const refresh = useCallback(async () => {
        try {
            const rows = await listNotifications(userId);
            const unread = rows.filter(row => !row.read_at).map(row => row.id);
            if (unread.length) setFresh(current => new Set([...current, ...unread]));
            setItems(rows);
            // 알림함을 열면 화면에 보이지 않는 이전 알림까지 읽은 것으로 본다.
            await markNotificationsRead(userId);
            clearBadge();
        } catch (error) {
            toast(messageOf(error), 'error');
        } finally {
            setLoading(false);
        }
    }, [userId, toast]);

    useEffect(() => {
        void refresh();
        const channel = repairDb.channel('repair-notifications-' + userId)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'repair_notifications',
                filter: 'user_id=eq.' + userId,
            }, () => void refresh())
            .subscribe();
        return () => { void repairDb.removeChannel(channel); };
    }, [refresh, userId]);

    const open = (item: RepairNotification) => {
        if (!item.url) return;
        navigate(item.url.replace(/^#/, ''));
    };

    return (
        <div className="rn-page rn-alert-page">
            <div className="rn-page-heading">
                <span className="rn-eyebrow">YOUR UPDATES</span>
                <h1>알림함</h1>
                <p>새 수리 정보가 등록되면 회원 알림함에 공유됩니다.</p>
            </div>
            {loading && <div className="rn-loading-line"><span className="rn-spinner" /> 알림 불러오는 중</div>}
            {!loading && !items.length && (
                <div className="rn-empty">
                    <span><Icon name="bell" size={25} /></span><strong>아직 도착한 알림이 없습니다.</strong>
                    <p>새 수리 및 점검 정보가 등록되면 여기에 표시됩니다.</p>
                </div>
            )}
            <div className="rn-alert-list">
                {items.map(item => (
                    <button key={item.id} className={'rn-alert-row' + (fresh.has(item.id) ? ' fresh' : '')}
                            onClick={() => open(item)} disabled={!item.url}>
                        <span className="rn-alert-icon"><Icon name={item.kind === 'repair_entries' || item.kind === 'repair_entry' ? 'wrench' : 'bell'} size={18} /></span>
                        <span className="rn-alert-copy">
                            <strong>{item.title}</strong>
                            {item.body && <span>{item.body}</span>}
                            <small>{dateTimeLabel(item.created_at)}</small>
                        </span>
                        {fresh.has(item.id) && <span className="rn-new-dot">NEW</span>}
                        <Icon name="arrow" size={17} />
                    </button>
                ))}
            </div>
        </div>
    );
}

function MemberApprovals({ isAdmin }: { isAdmin: boolean }) {
    const toast = useToast();
    const [members, setMembers] = useState<RepairMembership[]>([]);
    const [requests, setRequests] = useState<RepairMembership[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [approved, pending] = await Promise.all([
                repairDb.from('repair_memberships')
                    .select('user_id, display_name, job_title, profile_completed_at, status, requested_at, approved_at')
                    .eq('status', 'member').order('display_name'),
                isAdmin
                    ? repairDb.from('repair_memberships')
                        .select('user_id, display_name, job_title, profile_completed_at, status, requested_at, approved_at')
                        .eq('status', 'pending').order('requested_at')
                    : Promise.resolve({ data: [], error: null }),
            ]);
            if (approved.error) throw approved.error;
            if (pending.error) throw pending.error;
            setMembers((approved.data ?? []) as RepairMembership[]);
            setRequests((pending.data ?? []) as RepairMembership[]);
        } catch (error) {
            toast(messageOf(error), 'error');
        } finally {
            setLoading(false);
        }
    }, [isAdmin, toast]);

    useEffect(() => { void load(); }, [load]);

    const approve = async (id: string) => {
        setBusyId(id);
        try {
            const { error } = await repairDb.rpc('approve_repair_membership', { p_user_id: id });
            if (error) throw error;
            toast('회원 승인이 완료됐습니다.', 'ok');
            await load();
        } catch (error) {
            toast(messageOf(error), 'error');
        } finally {
            setBusyId('');
        }
    };

    const deleteApplication = async (request: RepairMembership) => {
        if (!window.confirm(`${request.display_name}님의 수리노트 가입 신청을 삭제할까요? 계정과 JTFAG 회원 정보는 삭제되지 않습니다.`)) return;
        setBusyId(request.user_id);
        try {
            const { error } = await repairDb.rpc('delete_repair_application', { p_user_id: request.user_id });
            if (error) throw error;
            toast('가입 신청을 삭제했습니다.', 'ok');
            await load();
        } catch (error) {
            toast(messageOf(error), 'error');
        } finally {
            setBusyId('');
        }
    };

    return (
        <div className="rn-page">
            <div className="rn-page-heading">
                <span className="rn-eyebrow">MEMBER ACCESS</span>
                <h1>수리노트 회원 명단</h1>
                <p>여기에 표시되는 이름과 가입 관리는 수리노트에만 적용됩니다.</p>
            </div>
            {isAdmin && (
                <section className="rn-form-card rn-member-card">
                    <div className="rn-section-heading">
                        <div><span className="rn-eyebrow">PENDING REQUESTS</span><h2>가입 신청 <span className="rn-result-count">{requests.length}명</span></h2></div>
                        <button className="rn-secondary-btn" onClick={() => void load()}>새로고침</button>
                    </div>
                    {loading && <div className="rn-loading-line"><span className="rn-spinner" /> 확인 중</div>}
                    {!loading && !requests.length && <div className="rn-empty compact"><strong>가입 신청이 없습니다.</strong></div>}
                    {requests.map(request => (
                        <div className="rn-member-row" key={request.user_id}>
                            <span className="rn-avatar">{(request.display_name || '회').slice(0, 1)}</span>
                            <span><strong>{request.display_name || '이름 미등록'}</strong><small>가입 신청 · {dateLabel(request.requested_at)}</small></span>
                            <div className="rn-member-actions">
                                <button className="rn-secondary-btn rn-delete-request" onClick={() => void deleteApplication(request)} disabled={busyId === request.user_id}>삭제</button>
                                <button className="rn-primary-btn" onClick={() => void approve(request.user_id)} disabled={busyId === request.user_id}>
                                    {busyId === request.user_id ? '처리 중…' : '승인'}
                                </button>
                            </div>
                        </div>
                    ))}
                </section>
            )}
            <section className="rn-form-card rn-member-card">
                <div className="rn-section-heading">
                    <div><span className="rn-eyebrow">APPROVED MEMBERS</span><h2>가입된 회원 <span className="rn-result-count">{members.length}명</span></h2></div>
                    {!isAdmin && <button className="rn-secondary-btn" onClick={() => void load()}>새로고침</button>}
                </div>
                {loading && <div className="rn-loading-line"><span className="rn-spinner" /> 확인 중</div>}
                {!loading && !members.length && <div className="rn-empty compact"><strong>등록된 회원이 없습니다.</strong></div>}
                {members.map(member => (
                    <div className="rn-member-row" key={member.user_id}>
                        <span className="rn-avatar">{(member.display_name || '회').slice(0, 1)}</span>
                        <span><strong>{member.display_name || '이름 미등록'}{member.job_title ? ` ${member.job_title}` : ''}</strong>
                            {!member.job_title && <small>직급 입력 전</small>}</span>
                    </div>
                ))}
            </section>
        </div>
    );
}

function GuidePage() {
    const tips = [
        ['모델 적용 범위를 기록', '제품군 공통 내용이면 모델명을 비워두고, 특정 모델에만 해당하면 모델명과 적용 범위를 함께 적어 주세요.'],
        ['점검 순서를 단계별로 기록', '증상과 발생 조건, 측정 조건, 조치 후 결과를 나누어 적으면 다른 엔지니어가 재현하기 쉽습니다.'],
        ['테스트 모드 표기', '어떤 제품군과 모델에서 동작하는지, 진입 순서와 복귀 방법을 함께 기록합니다.'],
        ['사진 속 고객 정보를 가리기', '이름, 주소, 전화번호, 주문 정보 등이 보이지 않는지 확인한 뒤 첨부해 주세요.'],
        ['안전 주의 사항을 함께 남기기', '전원, 고온부, 냉매·압력 등 작업 전 확인할 조건과 주의점을 빠뜨리지 않습니다.'],
    ];
    return (
        <div className="rn-page">
            <div className="rn-page-heading">
                <span className="rn-eyebrow">SHARE CLEARLY</span>
                <h1>좋은 수리 기록 작성법</h1>
                <p>다음 엔지니어가 현장에서 바로 이해할 수 있게 기록해 주세요.</p>
            </div>
            <div className="rn-guide-list">
                {tips.map((tip, index) => (
                    <article className="rn-guide-item" key={tip[0]}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div><strong>{tip[0]}</strong><p>{tip[1]}</p></div>
                    </article>
                ))}
            </div>
            <div className="rn-guide-callout">
                수리 정보는 회원 간 참고용으로 공유됩니다. 실제 작업 전에는 해당 모델의 공식 서비스 기준과 현장 안전 절차를 확인해 주세요.
            </div>
        </div>
    );
}

function DemoPreview() {
    const [query, setQuery] = useState('');
    const demo = [
        { family: '에어컨', model: '제품군 공통', type: '수리 및 점검 노하우', title: '냉방이 약할 때 기본 점검 순서', text: '제품군 공통으로 참고할 점검 내용을 기록하는 예시입니다.' },
        { family: '세탁기', model: '제품군 공통', type: '테스트 모드', title: '배수 불량 기본 확인 항목', text: '제품군 공통으로 적용되는 확인 항목과 주의사항을 적는 예시입니다.' },
        { family: 'TV·모니터', model: '제품군 공통', type: '부품교체 노하우', title: '부품 교체 시 분리 순서', text: '특정 모델 자료가 아니면 모델명 없이 제품군 기준으로 등록할 수 있습니다.' },
    ];
    const shown = demo.filter(item => (item.family + item.model + item.type + item.title).toLowerCase().includes(query.toLowerCase()));
    return (
        <div className="rn-app rn-demo-app">
            <header className="rn-header">
                <Link className="rn-brand" to="/"><Mark /><span className="rn-brand-copy"><strong>수리노트</strong><small>광산센터 기술 지식 공유 플랫폼</small></span></Link>
                <span className="rn-demo-pill">미리보기</span>
            </header>
            <main className="rn-demo-main">
                <section className="rn-hero">
                    <div className="rn-hero-copy">
                        <span className="rn-hero-kicker">FIELD KNOWLEDGE BASE</span>
                        <h1>고장 증상부터 점검 절차까지<br /><em>모델별로 빠르게 찾으세요.</em></h1>
                        <p>현장의 수리 및 점검 방법과 수리 노하우를 함께 모아<br className="rn-desktop-only" /> 더 빠르고 정확한 수리를 돕습니다.</p>
                        <span className="rn-hero-action">승인된 회원 전용 앱</span>
                    </div>
                    <div className="rn-hero-art" aria-hidden="true"><div className="rn-hero-tool"><Icon name="wrench" size={60} /></div></div>
                </section>
                <section className="rn-search-panel">
                    <div className="rn-search-title"><div><span className="rn-eyebrow">KNOWLEDGE LIBRARY</span><h2>수리 정보 찾기</h2></div><span className="rn-result-count">미리보기</span></div>
                    <label className="rn-search-box"><Icon name="search" size={21} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="모델명, 증상, 에러 코드, 점검 내용을 검색" /></label>
                    <div className="rn-category-filter">{ENTRY_CATEGORIES.map(item => <button key={item.id}>{item.label}</button>)}</div>
                </section>
                <section className="rn-results">
                    <div className="rn-section-heading"><div><span className="rn-eyebrow">APP PREVIEW</span><h2>이런 정보를 모을 수 있어요</h2></div></div>
                    <div className="rn-entry-grid">
                        {shown.map(item => (
                            <article className="rn-entry-card rn-demo-entry" key={item.family + item.type}>
                                <div className="rn-entry-card-top"><span className="rn-category-tag"><span>•</span>{item.type}</span><span className="rn-verify-tag">예시</span></div>
                                <div className="rn-model-line"><span className="rn-family">{item.family}</span><strong>{item.model}</strong></div>
                                <h3>{item.title}</h3><p className="rn-card-symptom">{item.text}</p>
                                <div className="rn-card-footer"><span className="rn-author-dot">✓</span><span>승인 회원 공유</span></div>
                            </article>
                        ))}
                    </div>
                </section>
                <div className="rn-config-notice">
                    현재 화면은 기능 미리보기입니다. 실제 회원 로그인, 자료 저장, 검색, 사진, 알림은 배포 환경의 Supabase 설정으로 연결됩니다.
                </div>
            </main>
        </div>
    );
}

function dateLabel(value: string) {
    return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(value));
}

function dateTimeLabel(value: string) {
    return new Intl.DateTimeFormat('ko-KR', {
        month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(value));
}

function messageOf(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    const maybe = error as { message?: string } | null;
    return maybe?.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export default function RepairApp() {
    return isConfigured ? <AuthApp /> : <HashRouter><DemoPreview /></HashRouter>;
}
