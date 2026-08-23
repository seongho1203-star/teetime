import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, signOut } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { ROLE_LABEL } from '../lib/types';
import { canInstall, onInstallChange, promptInstall } from '../lib/install';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import './Home.css';

export function Me() {
    const { profile, session, refresh } = useAuth();
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

    /* 설치 신호는 lib/install이 앱 시작 때부터 붙잡아 둔다. */
    const [installable, setInstallable] = useState(canInstall());
    useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);

    /* ── 알림 ────────────────────────────────────────────────
       기기마다 따로 켠다. 폰에서 켜도 PC는 안 켜진다 — 알림을 받을 곳이
       기기이기 때문이다. iOS는 홈 화면에 추가한 앱에서만 켤 수 있다. */
    const [push, setPush] = useState<PushState | null>(null);
    const [pushBusy, setPushBusy] = useState(false);

    useEffect(() => { pushState().then(setPush); }, []);

    const togglePush = async () => {
        setPushBusy(true);
        try {
            const next = push === 'on'
                ? await disablePush()
                : await enablePush(session!.user.id);
            setPush(next);
            if (next === 'on') toast('이 기기로 알림을 보냅니다.', 'ok');
            else if (next === 'denied') toast('폰 설정에서 이 앱의 알림을 켜 주세요.', 'error');
            else if (next === 'off' && push !== 'on') toast('알림을 켜지 않았습니다.', 'info');
        } catch (e) {
            toast(readableError(e), 'error');
        } finally {
            setPushBusy(false);
        }
    };

    const pushLine = (): { text: string; hint?: string; can: boolean } => {
        switch (push) {
            case 'on':   return { text: '알림 끄기', hint: '이 기기로 오고 있습니다', can: true };
            case 'off':  return { text: '알림 켜기', hint: '새 대화 · 모집 · 공지를 폰으로 받습니다', can: true };
            case 'denied': return {
                text: '알림이 막혀 있습니다',
                hint: '폰 설정 → 알림에서 까꿍을 켜 주세요', can: false };
            case 'standalone-required': return {
                text: '알림을 받으려면 홈 화면에 추가하세요',
                hint: '공유 → 홈 화면에 추가 → 그 아이콘으로 열면 켤 수 있습니다', can: false };
            case 'unsupported': return { text: '이 브라우저는 알림을 못 받습니다', can: false };
            default: return { text: '알림', hint: '확인 중…', can: false };
        }
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
                        {profile ? ROLE_LABEL[profile.role] : '회원'}
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
                    {installable && (
                        <button className="menu-item" onClick={() => promptInstall()}>
                            <span className="grow">
                                <span className="b">앱으로 설치</span>
                                <br /><span className="xs faint">
                                    홈 화면에 놓고 앱처럼 씁니다
                                </span>
                            </span>
                            <span className="chev">›</span>
                        </button>
                    )}
                    <button className="menu-item" onClick={togglePush}
                            disabled={!pushLine().can || pushBusy}>
                        <span className="grow">
                            <span className="b">{pushLine().text}</span>
                            {pushLine().hint && (
                                <><br /><span className="xs faint">{pushLine().hint}</span></>
                            )}
                        </span>
                        {push === 'on' && <span className="badge brand">켜짐</span>}
                    </button>
                </div>
            )}

            <button className="btn ghost block" onClick={logout}>로그아웃</button>

            <p className="xs faint" style={{ textAlign: 'center' }}>
                까꿍 · {session?.user?.email ?? '카카오 계정'}
                <br />
                {/* 지금 떠 있는 판. 고친 게 안 먹을 때 여기부터 본다. */}
                <span className="xs faint">화면 판 {__BUILD__}</span>
            </p>
        </div>
    );
}
