import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, fetchProfiles } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { ROLE_LABEL, type Profile, type Role } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import './Home.css';

/**
 * 회원 명단. 운영진에게는 여기가 **가입 승인 창구**다.
 *
 * 카카오로 로그인만 하면 누구나 pending 상태로 들어오므로,
 * 승인하지 않으면 아무것도 볼 수 없다. 이게 이 앱의 문이다.
 *
 * 승인·거절은 운영진(운영자·부운영자)이 하고, **부운영자 임명은 운영자만**
 * 한다. DB도 같게 막아 두었다(`profiles_staff_upd`) — 화면만 감추면
 * 그만이 아니기 때문이다.
 */
export function Members() {
    const { isAdmin, isOwner, session } = useAuth();
    const me = session!.user.id;
    const toast = useToast();
    const confirm = useConfirm();

    const { data, loading, error, reload } = useAsync<Profile[]>(fetchProfiles, []);
    useRealtime('profiles', reload);

    if (loading && !data) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }
    if (error) {
        return (
            <div className="page">
                <TopBar title="회원 명단" />
                <div className="notice danger">{error}</div>
            </div>
        );
    }

    const all = data ?? [];
    const pending = all.filter(p => p.role === 'pending');
    const members = all.filter(p => p.role !== 'pending');

    const setRole = async (p: Profile, role: Role) => {
        const { error: err } = await supabase.from('profiles')
            .update({ role }).eq('id', p.id);
        if (err) { toast(readableError(err), 'error'); return; }
        toast(
            role === 'member' && p.role === 'pending' ? `${p.name}님을 승인했습니다.`
            : role === 'staff' ? `${p.name}님을 부운영자로 임명했습니다.`
            : role === 'member' ? `${p.name}님의 부운영자를 풀었습니다.`
            : role === 'admin' ? `${p.name}님을 운영자로 올렸습니다.`
            : `${p.name}님을 대기로 되돌렸습니다.`,
            'ok'
        );
        reload();
    };

    const reject = async (p: Profile) => {
        const ok = await confirm({
            title: `${p.name || '이 분'}의 가입을 거절할까요?`,
            detail: '명단에서 사라집니다. 그 사람이 다시 로그인하면 가입 신청부터 다시 하게 됩니다.',
            confirmLabel: '거절',
            danger: true,
        });
        if (!ok) return;
        const { error: err } = await supabase.from('profiles').delete().eq('id', p.id);
        if (err) { toast(readableError(err), 'error'); return; }
        toast('거절했습니다.');
        reload();
    };

    const demote = async (p: Profile) => {
        const ok = await confirm({
            title: `${p.name}님을 내보낼까요?`,
            detail: '승인 대기 상태로 되돌아가 아무것도 볼 수 없게 됩니다. 신청 기록은 남습니다.',
            confirmLabel: '내보내기',
            danger: true,
        });
        if (ok) setRole(p, 'pending');
    };

    return (
        <div className="page">
            <TopBar title="회원 명단" />

            {isAdmin && pending.length > 0 && (
                <>
                    <div className="section-title">가입 신청 {pending.length}</div>
                    <div className="card" style={{ padding: 0, gap: 0 }}>
                        {pending.map(p => (
                            <div className="member-row" key={p.id}>
                                <Avatar name={p.name} url={p.avatar_url} />
                                <div className="grow" style={{ minWidth: 0 }}>
                                    <div className="b truncate">{p.name || '이름 없음'}</div>
                                    <div className="xs faint">
                                        {p.phone ? `${p.phone} · ` : ''}
                                        {formatDate(p.created_at)} 신청
                                    </div>
                                </div>
                                <button className="btn ghost sm" onClick={() => reject(p)}>거절</button>
                                <button className="btn primary sm" onClick={() => setRole(p, 'member')}>
                                    승인
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}

            <div className="section-title">회원 {members.length}명</div>
            <div className="card" style={{ padding: 0, gap: 0 }}>
                {members.length === 0 && <div className="empty">아직 회원이 없습니다.</div>}
                {members.map(p => (
                    <div className="member-row" key={p.id}>
                        <Avatar name={p.name} url={p.avatar_url} />
                        <div className="grow" style={{ minWidth: 0 }}>
                            <div className="row" style={{ gap: 6 }}>
                                <span className="b truncate">{p.name || '이름 없음'}</span>
                                {(p.role === 'admin' || p.role === 'staff') && (
                                    <span className={`role-tag ${p.role === 'admin' ? 'role-admin' : 'role-staff'}`}>
                                        {ROLE_LABEL[p.role]}
                                    </span>
                                )}
                                {p.id === me && <span className="xs faint">(나)</span>}
                            </div>
                            <div className="xs faint">
                                {p.handicap != null ? `핸디캡 ${p.handicap}` : '핸디캡 미등록'}
                                {isAdmin && p.phone ? ` · ${p.phone}` : ''}
                            </div>
                        </div>
                        {/* 부운영자 임명은 운영자만. 운영자 행은 아무도 못 건드린다. */}
                        {isOwner && p.id !== me && p.role !== 'admin' && (
                            <button
                                className="btn ghost sm"
                                onClick={() => setRole(p, p.role === 'staff' ? 'member' : 'staff')}
                            >
                                {p.role === 'staff' ? '부운영자 해제' : '부운영자로'}
                            </button>
                        )}
                        {isAdmin && p.id !== me && p.role !== 'admin' && (
                            <button className="btn ghost sm" onClick={() => demote(p)}
                                    aria-label="내보내기">✕</button>
                        )}
                    </div>
                ))}
            </div>

            {isAdmin && (
                <p className="xs faint" style={{ lineHeight: 1.7 }}>
                    카카오로 로그인한 사람은 승인 전까지 아무것도 볼 수 없습니다.
                    {isOwner
                        ? ' 부운영자는 가입 승인과 공지 쓰기를 함께 맡습니다. 임명은 운영자만 할 수 있습니다.'
                        : ' 부운영자 임명은 운영자만 할 수 있습니다.'}
                </p>
            )}
        </div>
    );
}
