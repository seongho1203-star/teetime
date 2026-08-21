import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, signOut } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import './Home.css';

export function Me() {
    const { profile, isAdmin, session, refresh } = useAuth();
    const toast = useToast();
    const confirm = useConfirm();

    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(profile?.name ?? '');
    const [phone, setPhone] = useState(profile?.phone ?? '');
    const [handicap, setHandicap] = useState(
        profile?.handicap != null ? String(profile.handicap) : '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        const trimmed = name.trim();
        if (!trimmed) { toast('이름을 적어 주세요.', 'error'); return; }

        const hc = handicap.trim() === '' ? null : Number(handicap);
        if (hc !== null && (isNaN(hc) || hc < 0 || hc > 54)) {
            toast('핸디캡은 0에서 54 사이로 적어 주세요.', 'error');
            return;
        }

        setSaving(true);
        const { error } = await supabase.from('profiles')
            .update({ name: trimmed, phone: phone.trim() || null, handicap: hc })
            .eq('id', session!.user.id);
        setSaving(false);

        if (error) { toast(readableError(error), 'error'); return; }
        await refresh();
        setEditing(false);
        toast('저장했습니다.', 'ok');
    };

    const logout = async () => {
        const ok = await confirm({ title: '로그아웃할까요?', confirmLabel: '로그아웃' });
        if (ok) await signOut();
    };

    return (
        <div className="page">
            <TopBar title="내 정보" />

            <div className="me-head">
                <Avatar name={profile?.name} url={profile?.avatar_url} size="lg" />
                <div className="grow" style={{ minWidth: 0 }}>
                    <div className="b truncate" style={{ fontSize: 'var(--fs-lg)' }}>
                        {profile?.name || '이름 없음'}
                    </div>
                    <div className="sm faint">
                        {isAdmin ? '총무' : '회원'}
                        {profile?.handicap != null && ` · 핸디캡 ${profile.handicap}`}
                    </div>
                </div>
            </div>

            {editing ? (
                <div className="card">
                    <div className="field">
                        <label htmlFor="m-name">이름</label>
                        <input id="m-name" className="input" value={name}
                               onChange={e => setName(e.target.value)} maxLength={20} />
                    </div>
                    <div className="field">
                        <label htmlFor="m-phone">연락처</label>
                        <input id="m-phone" className="input" value={phone}
                               onChange={e => setPhone(e.target.value)}
                               inputMode="tel" maxLength={20} placeholder="010-0000-0000" />
                    </div>
                    <div className="field">
                        <label htmlFor="m-hc">핸디캡 <span className="faint">(선택)</span></label>
                        <input id="m-hc" className="input" value={handicap}
                               onChange={e => setHandicap(e.target.value)}
                               inputMode="decimal" placeholder="예) 12.5" maxLength={5} />
                    </div>
                    <div className="row" style={{ gap: 'var(--gap-sm)' }}>
                        <button className="btn ghost grow" onClick={() => setEditing(false)}>
                            취소
                        </button>
                        <button className="btn primary grow" onClick={save} disabled={saving}>
                            {saving ? '저장 중…' : '저장'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="menu-list">
                    <button className="menu-item" onClick={() => setEditing(true)}>
                        <span className="grow">프로필 수정</span>
                        <span className="chev">›</span>
                    </button>
                    <Link className="menu-item" to="/members">
                        <span className="grow">회원 명단</span>
                        <span className="chev">›</span>
                    </Link>
                </div>
            )}

            <button className="btn ghost block" onClick={logout}>로그아웃</button>

            <p className="xs faint" style={{ textAlign: 'center' }}>
                teetime · {session?.user?.email ?? '카카오 계정'}
            </p>
        </div>
    );
}
