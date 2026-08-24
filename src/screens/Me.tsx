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
import {
    chatPush, disablePush, enablePush, pushState, setChatPush, type PushState,
} from '../lib/push';
import { Switch } from '../components/Switch';
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
       기기이기 때문이다. iOS는 홈 화면에 추가한 앱에서만 켤 수 있다.

       **대화만 따로 끌 수 있다.** 모집·공지·투표는 하루 몇 번이지만 대화는
       종일 울려서, 그것 때문에 알림을 통째로 끄면 라운드 소식까지 놓친다. */
    const [push, setPush] = useState<PushState | null>(null);
    const [chat, setChat] = useState(true);
    const [pushBusy, setPushBusy] = useState(false);
    const [chatBusy, setChatBusy] = useState(false);

    useEffect(() => {
        pushState().then(async s => {
            setPush(s);
            if (s === 'on') setChat(await chatPush());
        });
    }, []);

    const togglePush = async () => {
        setPushBusy(true);
        try {
            const next = push === 'on'
                ? await disablePush()
                : await enablePush(session!.user.id);
            setPush(next);
            if (next === 'on') {
                // 껐다 켜도 대화만 꺼 둔 것은 남는다(행이 그대로면 그 값을 읽는다).
                setChat(await chatPush());
                toast('이 기기로 알림을 보냅니다.', 'ok');
            }
            else if (next === 'denied') toast('폰 설정에서 이 앱의 알림을 켜 주세요.', 'error');
            else if (next === 'off' && push !== 'on') toast('알림을 켜지 않았습니다.', 'info');
        } catch (e) {
            toast(readableError(e), 'error');
        } finally {
            setPushBusy(false);
        }
    };

    const toggleChat = async () => {
        const next = !chat;
        setChatBusy(true);
        // 스위치는 먼저 움직인다 — 통신을 기다리면 눌러도 안 켜지는 것처럼 보인다.
        setChat(next);
        try {
            await setChatPush(next);
            toast(next ? '대화 알림을 켰습니다.' : '대화 알림을 껐습니다.', 'ok');
        } catch (e) {
            setChat(!next);   // 저장이 안 됐으면 되돌린다
            toast(readableError(e), 'error');
        } finally {
            setChatBusy(false);
        }
    };

    /** 알림 칸의 첫 줄. 켤 수 없는 상태면 왜인지와 무엇을 하면 되는지를 적는다. */
    const pushLine = (): { hint: string; can: boolean } => {
        switch (push) {
            case 'on':   return { hint: '새 모집 · 공지 · 투표를 폰으로 받습니다', can: true };
            case 'off':  return { hint: '앱을 안 보고 있어도 소식이 옵니다', can: true };
            case 'denied': return {
                hint: '폰 설정 → 알림에서 까꿍을 켜 주세요', can: false };
            case 'standalone-required': return {
                hint: '공유 → 홈 화면에 추가 → 그 아이콘으로 열면 켤 수 있습니다', can: false };
            case 'unsupported': return { hint: '이 브라우저는 알림을 못 받습니다', can: false };
            default: return { hint: '확인 중…', can: false };
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
                </div>
            )}

            {!editing && (
                <div className="card">
                    <div className="section-title">알림</div>

                    <div className="switch-row">
                        <div className="grow">
                            <div className="switch-label">이 기기로 받기</div>
                            <div className="switch-desc">{pushLine().hint}</div>
                        </div>
                        <Switch label="이 기기로 알림 받기"
                                on={push === 'on'} onChange={togglePush}
                                disabled={!pushLine().can || pushBusy} />
                    </div>

                    {/* 켜져 있을 때만 나온다. 안 받는 기기에서 갈래를 나누는
                        칸은 누를 일이 없는 자리만 만든다. */}
                    {push === 'on' && (
                        <div className="switch-row">
                            <div className="grow">
                                <div className="switch-label">💬 대화 알림</div>
                                <div className="switch-desc">
                                    {chat
                                        ? '새 메시지가 올 때마다 옵니다'
                                        : '꺼짐 — 모집 · 공지 · 투표만 옵니다'}
                                </div>
                            </div>
                            <Switch label="대화 알림"
                                    on={chat} onChange={toggleChat} disabled={chatBusy} />
                        </div>
                    )}
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
