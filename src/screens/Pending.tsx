import { useState } from 'react';
import { supabase, signOut } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { Hinted } from '../components/Hinted';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { Help } from './Help';

/**
 * 로그인은 됐지만 아직 회원이 아닌 사람이 보는 화면.
 *
 * 여기서 닉네임을 바로잡아 두면 운영진이 명단에서 누군지 알아본다 —
 * 카카오 닉네임이 `골프왕`이면 승인할 수가 없다.
 *
 * **셋 다 필수다**(닉네임·전화번호·차량번호). 전화는 급한 연락에,
 * **차량번호는 골프장에 미리 차를 등록할 때** 쓴다 — 나중에 물어보러
 * 다니느니 처음에 받아 둔다. (카풀 때문이 아니다.)
 *
 * 운영진이 승인하면 auth.tsx의 실시간 구독이 profiles 변경을 받아
 * 새로고침 없이 앱으로 들어간다.
 */
export function Pending() {
    const { profile, session, refresh } = useAuth();
    const banned = profile?.role === 'banned';
    const [name, setName] = useState(profile?.name ?? '');
    const [phone, setPhone] = useState(profile?.phone ?? '');
    const [car, setCar] = useState(profile?.car ?? '');
    const [saving, setSaving] = useState(false);
    /* **기다리는 동안 읽을 거리.** 승인 전에는 라우터가 안 열려
       `/help`로 못 가므로 여기서 직접 띄운다. */
    const [help, setHelp] = useState(false);
    const toast = useToast();

    const save = async () => {
        const trimmed = name.trim();
        if (!trimmed) { toast('닉네임을 적어 주세요.', 'error'); return; }
        if (!phone.trim()) { toast('전화번호를 적어 주세요.', 'error'); return; }
        if (!car.trim()) { toast('차량번호를 적어 주세요.', 'error'); return; }

        setSaving(true);
        const { error } = await supabase
            .from('profiles')
            .update({ name: trimmed, phone: phone.trim(), car: car.trim() })
            .eq('id', session!.user.id);
        setSaving(false);

        if (error) { toast(readableError(error), 'error'); return; }
        await refresh();
        toast('저장했습니다. 운영진이 확인하면 들어갈 수 있습니다.', 'ok');
    };

    if (help) return <Help onBack={() => setHelp(false)} />;

    return (
        <div className="page bare" style={{ gap: 'var(--gap-lg)' }}>
            <div className="row" style={{ paddingTop: 'var(--gap)' }}>
                <Avatar name={profile?.name} url={profile?.avatar_url} size="lg" />
                <div className="grow">
                    <div className="b" style={{ fontSize: 'var(--fs-md)' }}>
                        {profile?.name || '닉네임 없음'}
                    </div>
                    <div className="sm faint">{session?.user?.email ?? '카카오 계정'}</div>
                </div>
            </div>

            <div className="notice warn">
                {banned
                    ? <>이 계정은 <b>이용이 제한</b>되었습니다.<br />
                       궁금한 점은 운영진에게 물어봐 주세요.</>
                    : <>아직 <b>가입 승인 대기중</b>입니다.<br />
                       운영진이 명단에서 승인하면 바로 들어갈 수 있습니다.</>}
            </div>

            {!banned && (
            <div className="card">
                <div className="section-title">운영진이 알아볼 수 있게 적어 주세요</div>
                <div className="field">
                    <label htmlFor="p-name">닉네임</label>
                    <Hinted hint="모임에서 부르는 이름" empty={!name}>
                        <input
                            id="p-name" className="input" value={name}
                            onChange={e => setName(e.target.value)}
                            maxLength={20}
                        />
                    </Hinted>
                </div>
                <div className="field">
                    <label htmlFor="p-phone">전화번호</label>
                    <input
                        id="p-phone" className="input" value={phone}
                        onChange={e => setPhone(e.target.value)}
                        placeholder="010-0000-0000" inputMode="tel" maxLength={20}
                    />
                </div>
                <div className="field">
                    <label htmlFor="p-car">차량번호</label>
                    <input
                        id="p-car" className="input" value={car}
                        onChange={e => setCar(e.target.value)}
                        placeholder="12가 3456" maxLength={20}
                    />
                </div>
                <button className="btn primary block" onClick={save} disabled={saving}>
                    {saving ? '저장 중…' : '저장'}
                </button>
            </div>
            )}

            {/* 기다리는 동안 미리 읽어 두면 승인되자마자 쓸 수 있다. */}
            {!banned && (
                <button className="btn block" onClick={() => setHelp(true)}>
                    📖 기다리는 동안 사용법 보기
                </button>
            )}

            <button className="btn ghost block" onClick={signOut}>로그아웃</button>
        </div>
    );
}
