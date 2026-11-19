import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
    HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams,
} from 'react-router-dom';
import { AuthProvider, useAuth } from '../lib/auth';
import { enablePush, pushState, type PushState } from '../lib/push';
import { isConfigured, signInWithApple, signInWithKakao, supabase } from '../lib/supabase';
import { ToastProvider, useToast } from '../components/Toast';
import {
    getEntry, getRepairMembership, listNotifications, markNotificationsRead, removeEntry,
    repairDb, requestRepairMembership, signedPhotoUrls, unreadNotificationCount, updateRepairMemberName,
} from './data';
import {
    ENTRY_CATEGORIES, type RepairEntry, type RepairMembership, type RepairNotification,
} from './types';
import { AnswerThread, ApplicationPanel } from './EntryCollaboration';
import { EntryForm } from './EntryForm';
import { KnowledgeHome } from './KnowledgeHome';
import { dateLabel, Icon, messageOf } from './ui';
import './repair.css';

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
    if (membershipLoading) return <LoadingScreen />;
    const initialName = profile?.name || String(session.user.user_metadata?.name ?? '');
    if (membershipError) return <MembershipLoadError error={membershipError} retry={refreshMembership} />;
    if (!membership || membership.status === 'pending') {
        return <RepairAccessScreen name={membership?.display_name || initialName}
            membership={membership} refresh={refreshMembership} />;
    }

    return <RepairWorkspace userId={session.user.id} name={membership.display_name || '회원'} isAdmin={isAdmin} />;
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
                    <span>수리 및 점검방법 · 테스트 모드 · 에러 코드 · 부품·회로</span>
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

function RepairWorkspace({ userId, name, isAdmin }: { userId: string; name: string; isAdmin: boolean }) {
    const [displayName, setDisplayName] = useState(name);
    const { pathname } = useLocation();

    useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

    return (
        <div className="rn-app">
            <Header userId={userId} name={displayName} isAdmin={isAdmin} onNameChange={setDisplayName} />
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
                        <Route path="/" element={<KnowledgeHome />} />
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
    );
}

function Header({ userId, name, isAdmin, onNameChange }: {
    userId: string; name: string; isAdmin: boolean; onNameChange: (name: string) => void;
}) {
    const [count, setCount] = useState(0);
    const [menuOpen, setMenuOpen] = useState(false);
    const [nameEditOpen, setNameEditOpen] = useState(false);
    const [nameDraft, setNameDraft] = useState(name);
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
                event: '*', schema: 'public', table: 'notifications',
                filter: 'user_id=eq.' + userId,
            }, () => void refreshCount())
            .subscribe();
        return () => { void repairDb.removeChannel(channel); };
    }, [refreshCount, userId]);

    const [push, setPush] = useState<PushState | null>(null);
    useEffect(() => { void pushState().then(setPush); }, []);

    const turnOnPush = async () => {
        try {
            const state = await enablePush(userId);
            setPush(state);
            if (state === 'on') toast('이 기기에서 새 수리 정보 알림을 받습니다.', 'ok');
            else if (state === 'standalone-required') toast('홈 화면에 추가한 앱에서 알림을 켤 수 있습니다.', 'error');
            else if (state === 'denied') toast('브라우저 설정에서 알림 권한을 허용해 주세요.', 'error');
            else toast('이 기기에서 푸시 알림을 사용할 수 없습니다.', 'error');
        } catch (error) {
            toast(messageOf(error), 'error');
        }
    };

    const saveName = async () => {
        const nextName = nameDraft.trim();
        if (!nextName || nextName.length > 40) {
            toast('이름은 1~40자로 입력해 주세요.', 'error');
            return;
        }
        setSavingName(true);
        try {
            await updateRepairMemberName(userId, nextName);
            onNameChange(nextName);
            setNameEditOpen(false);
            setMenuOpen(false);
            toast('수리노트 프로필 이름을 변경했습니다.', 'ok');
        } catch (error) {
            toast(messageOf(error), 'error');
        } finally {
            setSavingName(false);
        }
    };

    const pushLabel = push === 'standalone-required'
        ? '홈 화면에 추가 후 알림을 켤 수 있어요'
        : push === 'denied' ? '브라우저 설정에서 알림 권한을 허용해 주세요'
        : push === 'unsupported' ? '이 기기는 푸시 알림을 지원하지 않습니다'
        : '앱을 닫아도 새 수리 정보를 받아보세요';

    return (
        <>
            <header className="rn-header">
                <Link className="rn-brand" to="/">
                    <Mark />
                    <span className="rn-brand-copy">
                        <strong>수리노트</strong>
                        <small>현장 기술 지식 공유</small>
                    </span>
                </Link>
                <div className="rn-header-actions">
                    {push !== 'on' && push !== 'unsupported' && (
                        <button className="rn-push-setup" onClick={() => void turnOnPush()} title={pushLabel}>
                            <Icon name="bell" size={17} />
                            <span>{push === 'off' || push === null ? '알림 켜기' : '알림 안내'}</span>
                        </button>
                    )}
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
                                <span className="rn-menu-label">{name}님</span>
                                <button onClick={() => { setNameDraft(name); setNameEditOpen(true); }}>
                                    <Icon name="user" size={16} /> 이름 변경
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
                        <h2 id="rn-name-title">수리노트 이름 변경</h2>
                        <p>이 이름은 수리노트에서만 표시됩니다.</p>
                        <label className="rn-field">
                            <span>표시 이름</span>
                            <input value={nameDraft} onChange={event => setNameDraft(event.target.value)}
                                   maxLength={40} autoFocus />
                        </label>
                        <div className="rn-dialog-actions">
                            <button className="rn-secondary-btn" onClick={() => setNameEditOpen(false)}>취소</button>
                            <button className="rn-primary-btn" onClick={() => void saveName()} disabled={savingName}>
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
        { to: '/alerts', label: '알림', icon: 'bell' as const },
        { to: '/new', label: '등록', icon: 'plus' as const },
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

function EntryDetail({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
    const { id: entryId = '' } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const homeTo: string = location.state?.homeTo ?? '/';
    const toast = useToast();
    const [entry, setEntry] = useState<RepairEntry | null>(null);
    const [photos, setPhotos] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const data = await getEntry(entryId);
            setEntry(data);
            setPhotos(await signedPhotoUrls(data.photo_paths));
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setLoading(false);
        }
    }, [entryId]);
    useEffect(() => { void load(); }, [load]);

    const destroy = async () => {
        if (!entry || !window.confirm('이 수리 정보를 삭제할까요?')) return;
        setBusy(true);
        try {
            await removeEntry(entry);
            toast('수리 정보가 삭제됐습니다.', 'ok');
            navigate(homeTo);
        } catch (reason) {
            toast(messageOf(reason), 'error');
            setBusy(false);
        }
    };

    if (loading || (!error && entry?.id !== entryId)) return <div className="rn-page"><div className="rn-loading-line"><span className="rn-spinner" /> 정보 불러오는 중</div></div>;
    if (error || !entry) return (
        <div className="rn-page">
            <Link className="rn-back-link" to={homeTo}><span>‹</span> 목록으로</Link>
            <div className="rn-error-panel"><strong>수리 정보를 열 수 없습니다.</strong><span>{error}</span></div>
        </div>
    );

    const category = ENTRY_CATEGORIES.find(item => item.id === entry.category);
    const canDelete = isAdmin || entry.created_by === userId;
    const isQuestion = entry.entry_kind === 'question';
    return (
        <div className="rn-page rn-detail-page">
            <Link className="rn-back-link" to={homeTo}><span>‹</span> 목록으로</Link>
            <article className="rn-detail-card">
                <div className="rn-detail-topline">
                    <span className={'rn-category-tag cat-' + entry.category}><span>{category?.icon ?? '•'}</span>{category?.label ?? '수리 정보'}</span>
                    {(isQuestion || entry.accepted_answer_id) && (
                        <span className={isQuestion ? 'rn-entry-status' : 'rn-entry-status resolved'}>{isQuestion ? '미해결 질문' : '질문에서 해결'}</span>
                    )}
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
                {!isQuestion && (
                    <DetailSection title={entry.accepted_answer_id ? '채택한 해결 방법' : '수리 및 점검방법·테스트 절차'}>
                        <div className="rn-detail-text">{entry.inspection_steps}</div>
                    </DetailSection>
                )}
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

                {(isQuestion || entry.accepted_answer_id) && (
                    <AnswerThread key={entry.id} entry={entry} userId={userId}
                                  onAccepted={updated => setEntry({ ...updated, author_name: entry.author_name })} />
                )}
                {!isQuestion && <ApplicationPanel key={entry.id} entry={entry} userId={userId} />}

                {canDelete && (
                    <div className="rn-detail-actions">
                        <Link className="rn-secondary-btn" to={'/entry/' + entry.id + '/edit'} state={{ homeTo }}>수정</Link>
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
            if (unread.length) await markNotificationsRead(userId, unread);
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
                event: '*', schema: 'public', table: 'notifications',
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
                <p>새 수리 사례, 미해결 질문과 내 질문에 달린 답변을 볼 수 있습니다.</p>
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
                        <span className="rn-alert-icon"><Icon name={item.kind === 'repair_answers' ? 'book' : 'wrench'} size={18} /></span>
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
                    .select('user_id, display_name, status, requested_at, approved_at')
                    .eq('status', 'member').order('display_name'),
                isAdmin
                    ? repairDb.from('repair_memberships')
                        .select('user_id, display_name, status, requested_at, approved_at')
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
                        <span><strong>{member.display_name || '이름 미등록'}</strong><small>수리노트 회원</small></span>
                    </div>
                ))}
            </section>
        </div>
    );
}

function GuidePage() {
    const tips = [
        ['증상과 조치를 짧게 기록', '등록 화면에서 제품군을 고르고 증상과 해결한 조치를 적습니다. 증상 첫 줄이 제목으로 들어갑니다.'],
        ['모델 적용 범위를 기록', '제품군 공통 내용이면 모델명을 비워두고, 특정 모델에만 해당하면 모델명과 적용 범위를 함께 적어 주세요.'],
        ['점검 순서를 단계별로 기록', '증상과 발생 조건, 측정 조건, 조치 후 결과를 나누어 적으면 다른 엔지니어가 재현하기 쉽습니다.'],
        ['테스트 모드 표기', '어떤 제품군과 모델에서 동작하는지, 진입 순서와 복귀 방법을 함께 기록합니다.'],
        ['사진 속 고객 정보를 가리기', '이름, 주소, 전화번호, 주문 정보 등이 보이지 않는지 확인한 뒤 첨부해 주세요.'],
        ['안전 주의 사항을 함께 남기기', '전원, 고온부, 냉매·압력 등 작업 전 확인할 조건과 주의점을 빠뜨리지 않습니다.'],
        ['막힌 증상은 팀에 질문', '검색 화면에서 팀에 질문을 누르면 검색어가 옮겨집니다. 답변으로 해결했다면 그 답변을 채택해 사례로 남길 수 있습니다.'],
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
        { family: 'TV·모니터', model: '제품군 공통', type: '부품·회로', title: '화면 이상 점검 기록 예시', text: '특정 모델 자료가 아니면 모델명 없이 제품군 기준으로 등록할 수 있습니다.' },
    ];
    const shown = demo.filter(item => (item.family + item.model + item.type + item.title).toLowerCase().includes(query.toLowerCase()));
    return (
        <div className="rn-app rn-demo-app">
            <header className="rn-header">
                <Link className="rn-brand" to="/"><Mark /><span className="rn-brand-copy"><strong>수리노트</strong><small>현장 기술 지식 공유</small></span></Link>
                <span className="rn-demo-pill">미리보기</span>
            </header>
            <main className="rn-demo-main">
                <section className="rn-hero">
                    <div className="rn-hero-copy">
                        <span className="rn-hero-kicker">FIELD KNOWLEDGE BASE</span>
                        <h1>고장 증상부터 점검 절차까지<br /><em>모델별로 빠르게 찾으세요.</em></h1>
                        <p>현장의 수리 및 점검 정보와 테스트 내용을 함께 모아<br className="rn-desktop-only" /> 더 빠르고 정확한 수리를 돕습니다.</p>
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

function dateTimeLabel(value: string) {
    return new Intl.DateTimeFormat('ko-KR', {
        month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(value));
}

export default function RepairApp() {
    return isConfigured ? <AuthApp /> : <HashRouter><DemoPreview /></HashRouter>;
}
