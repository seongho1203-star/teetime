import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAsync, useRealtime, fetchProfiles, fetchContacts, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import {
    FIND_AT, ROLE_LABEL, ROLE_TAG, personLabel,
    type Contact, type Profile, type Role,
} from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Avatar } from '../components/Avatar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import './Home.css';

/**
 * 회원 명단. 운영진에게는 여기가 **가입 승인 창구**이자 **임명 창구**다.
 *
 * 카카오로 로그인만 하면 누구나 pending 상태로 들어오므로,
 * 승인하지 않으면 아무것도 볼 수 없다. 이게 이 앱의 문이다.
 *
 * **임명은 위에서 아래로만 된다:**
 *   앱관리자 → 운영자
 *   운영자   → 부운영자 · 총무 (인원 제한 없음)
 *
 * DB도 같게 막아 두었다(`profiles_owner` · `profiles_staff_upd`) —
 * 화면에서 버튼을 감추는 것만으로는 부족하다.
 */
export function Members() {
    const { isAdmin, isOwner, isSuper, session } = useAuth();
    const me = session!.user.id;
    const toast = useToast();
    const confirm = useConfirm();

    /* **전화번호·차량번호는 다른 표에 있다**(`profile_private`). 정책이
       운영진에게만 전원을 돌려주므로, 일반회원이 받으면 자기 한 줄뿐이라
       아래 `연락처` 줄이 저절로 비고 검색도 안 걸린다 — 화면에서 감추는
       것이 아니라 **애초에 안 실려 오는 것**이 요점이다. */
    const { data, loading, error, reload } = useAsync<
        { list: Profile[]; contacts: Record<string, Contact> }
    >(async () => {
        const [list, contacts] = await Promise.all([fetchProfiles(), fetchContacts()]);
        return { list, contacts: byId(contacts) };
    }, [], 'members');
    useRealtime('profiles', reload);

    // 관리 버튼은 **누른 사람 것만** 펼친다. 줄마다 세 개씩 늘어놓으면
    // 이름 칸이 밀려 잘리고, 아랫줄로 내리면 명단이 두 배로 길어진다.
    const [openId, setOpenId] = useState<string | null>(null);
    /** 이름·차량번호·전화번호로 찾기. 사람이 많을 때만 칸이 나온다. */
    const [find, setFind] = useState('');

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

    const all = data?.list ?? [];
    const contacts = data?.contacts ?? {};
    const pending = all.filter(p => p.role === 'pending');
    const members = all.filter(p => p.role !== 'pending' && p.role !== 'banned');
    const banned = all.filter(p => p.role === 'banned');

    /* **사람이 많으면 찾아서 본다.** 100명으로 재 보니 명단이 6,495px —
       화면 여덟 장어치라, 한 사람을 임명하려면 끝까지 훑어야 했다.
       정산에서 사람 고를 때와 같은 잣대(`FIND_AT`)를 쓴다. 열둘 이하면
       칸을 안 띄운다 — 훑는 게 빠르고, 칸만 하나 더 생겨 성가시다.
       **차량번호와 전화번호로도 찾는다** — 골프장에 차를 등록하다 `1234`가
       누구 것인지 되짚는 자리가 실제로 있다. */
    const bigList = members.length > FIND_AT;
    const q = find.replace(/\s/g, '').toLowerCase();
    const shown = bigList && q
        ? members.filter(p => [p.name, p.region, contacts[p.id]?.car, contacts[p.id]?.phone]
            .some(v => String(v ?? '').replace(/\s/g, '').toLowerCase().includes(q)))
        : members;

    const setRole = async (p: Profile, role: Role) => {
        const { error: err } = await supabase.from('profiles')
            .update({ role }).eq('id', p.id);
        if (err) { toast(readableError(err), 'error'); return; }
        toast(
            role === 'member' && p.role === 'pending' ? `${p.name}님을 승인했습니다.`
            : role === 'member' ? `${p.name}님의 ${ROLE_LABEL[p.role]}를 풀었습니다.`
            : role === 'banned' ? `${p.name}님을 추방했습니다.`
            : role === 'pending' ? `${p.name}님을 대기로 되돌렸습니다.`
            : `${p.name}님을 ${ROLE_LABEL[role]}로 임명했습니다.`,
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

    /**
     * 추방. **행을 지우지 않고 `banned`로 남겨 둔다** — 지우면 그 사람이
     * 다시 로그인할 때 앱이 대기 상태로 되살려 신청이 또 들어온다.
     */
    const ban = async (p: Profile) => {
        const ok = await confirm({
            title: `${p.name || '이 분'}을 추방할까요?`,
            detail: '앱을 볼 수 없게 되고, 다시 로그인해도 가입 신청이 되지 않습니다. '
                  + '나중에 명단 아래쪽에서 되돌릴 수 있습니다.',
            confirmLabel: '추방',
            danger: true,
        });
        if (ok) setRole(p, 'banned');
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
                                <Avatar name={p.name} url={p.avatar_url} gender={p.gender} />
                                <div className="grow" style={{ minWidth: 0 }}>
                                    <div className="b truncate">
                                        {personLabel(p) || '이름 없음'}
                                    </div>
                                    <div className="xs faint">
                                        {contacts[p.id]?.phone ? `${contacts[p.id].phone} · ` : ''}
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

            {bigList && (
                <div className="field member-find">
                    <label htmlFor="m-find">
                        {isAdmin ? '이름 · 사는곳 · 차량번호 · 전화번호로 찾기'
                                 : '이름 · 사는곳으로 찾기'}
                    </label>
                    <input id="m-find" className="input" value={find}
                           onChange={e => setFind(e.target.value)} />
                </div>
            )}

            <div className="card" style={{ padding: 0, gap: 0 }}>
                {members.length === 0 && <div className="empty">아직 회원이 없습니다.</div>}
                {bigList && q && shown.length === 0 && (
                    <div className="empty">'{find.trim()}' 님을 못 찾았습니다.</div>
                )}
                {shown.map(p => {
                    /* **나보다 위에 있는 사람은 못 건드린다.** 앱관리자만
                       운영자를 다루고, 운영자는 그 아래만 다룬다.
                       DB의 `profiles_owner`가 같은 규칙을 다시 본다. */
                    const above = p.role === 'superadmin'
                        || (p.role === 'admin' && !isSuper);
                    const manageable = isAdmin && p.id !== me && !above;
                    const open = openId === p.id;
                    return (
                        <div key={p.id}>
                            <div className="member-row">
                                <Avatar name={p.name} url={p.avatar_url} gender={p.gender} />
                                <div className="grow" style={{ minWidth: 0 }}>
                                    <div className="row" style={{ gap: 6 }}>
                                        <span className="b truncate">
                                            {personLabel(p) || '이름 없음'}
                                        </span>
                                        {ROLE_TAG[p.role] && (
                                            <span className={`role-tag ${ROLE_TAG[p.role]}`}>
                                                {ROLE_LABEL[p.role]}
                                            </span>
                                        )}
                                        {p.id === me && <span className="xs faint">(나)</span>}
                                    </div>
                                    {/* **운영진에게만 값이 있다.** 회원에게는
                                        빈 줄이 되므로 아예 안 그린다. */}
                                    {isAdmin && (
                                        <div className="xs faint">
                                            {contacts[p.id]?.car || '차량번호 미등록'}
                                            {contacts[p.id]?.phone
                                                ? ` · ${contacts[p.id].phone}` : ''}
                                        </div>
                                    )}
                                </div>
                                {manageable && (
                                    <button className="btn ghost sm"
                                            aria-expanded={open}
                                            onClick={() => setOpenId(open ? null : p.id)}>
                                        {open ? '닫기' : '관리'}
                                    </button>
                                )}
                            </div>
                            {manageable && open && (
                                <div className="member-actions">
                                    {/* **앱관리자만 운영자를 임명한다.** */}
                                    {isSuper && (
                                        <button className="btn ghost sm"
                                                onClick={() => setRole(p, p.role === 'admin' ? 'member' : 'admin')}>
                                            {p.role === 'admin' ? '운영자 해제' : '운영자'}
                                        </button>
                                    )}
                                    {/* **방장은 부운영자·총무를 인원 제한 없이 임명한다.** */}
                                    {isOwner && p.role !== 'admin' && (
                                        <>
                                            <button className="btn ghost sm"
                                                    onClick={() => setRole(p, p.role === 'staff' ? 'member' : 'staff')}>
                                                {p.role === 'staff' ? '부운영자 해제' : '부운영자'}
                                            </button>
                                            <button className="btn ghost sm"
                                                    onClick={() => setRole(p, p.role === 'treasurer' ? 'member' : 'treasurer')}>
                                                {p.role === 'treasurer' ? '총무 해제' : '총무'}
                                            </button>
                                        </>
                                    )}
                                    <button className="btn ghost sm" onClick={() => demote(p)}>
                                        내보내기
                                    </button>
                                    <button className="btn danger sm" onClick={() => ban(p)}>
                                        추방
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {isAdmin && banned.length > 0 && (
                <>
                    <div className="section-title">추방 {banned.length}명</div>
                    <div className="card" style={{ padding: 0, gap: 0 }}>
                        {banned.map(p => (
                            <div className="member-row" key={p.id}>
                                <Avatar name={p.name} url={p.avatar_url} gender={p.gender} />
                                <div className="grow" style={{ minWidth: 0 }}>
                                    <div className="row" style={{ gap: 6 }}>
                                        <span className="b truncate">
                                            {personLabel(p) || '이름 없음'}
                                        </span>
                                        <span className="role-tag role-banned">추방</span>
                                    </div>
                                    <div className="xs faint">다시 신청할 수 없습니다</div>
                                </div>
                                <button className="btn ghost sm" onClick={() => setRole(p, 'pending')}>
                                    되돌리기
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {isAdmin && (
                <p className="xs faint" style={{ lineHeight: 1.7 }}>
                    <b>내보내기</b>는 대기 상태로 되돌립니다 — 바로 다시 승인할 수
                    있습니다. <b>추방</b>은 다시 신청조차 못 하게 막습니다.
                    카카오로 로그인한 사람은 승인 전까지 아무것도 볼 수 없습니다.
                    <br />
                    <b>직책</b>은 넷입니다 — 앱관리자 · 운영자 · 부운영자 · 총무.
                    운영자·부운영자는 가입 승인과 공지를 맡고,
                    <b>총무</b>는 라운드 정산을 맡습니다.
                    {isSuper
                        ? ' 운영자 임명은 앱관리자만, 부운영자·총무 임명은 운영자가 합니다.'
                        : isOwner
                            ? ' 부운영자·총무는 인원 제한 없이 임명할 수 있습니다. 운영자 임명은 앱관리자만 합니다.'
                            : ' 임명은 운영자 이상만 할 수 있습니다.'}
                </p>
            )}
        </div>
    );
}
