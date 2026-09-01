import { useState } from 'react';
import { signOut } from '../lib/supabase';
import { saveMyProfile } from '../lib/db';
import { useAuth } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { Hinted } from '../components/Hinted';
import { GenderAge } from '../components/GenderAge';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { BIRTH_MAX, BIRTH_MIN, REGION_MAX, birthValue, type Gender } from '../lib/types';
import { Help } from './Help';

/**
 * 로그인은 됐지만 아직 회원이 아닌 사람이 보는 화면.
 *
 * 여기서 닉네임을 바로잡아 두면 운영진이 명단에서 누군지 알아본다 —
 * 카카오 닉네임이 `골프왕`이면 승인할 수가 없다.
 *
 * **여섯 가지를 다 받고 다 필수다** — 사용자가 정해 준 차례 그대로
 * `닉네임 · 전화번호 · 태어난 해 · 성별 · 차량번호 · 거주지역`이다.
 * 전화는 급한 연락에, **차량번호는 골프장에 미리 차를 등록할 때** 쓴다
 * (카풀 때문이 아니다). 성별·태어난 해는 조 편성의 `성별 조합`·`나이 조합`이
 * 보고, **태어난 해와 거주지역은 이름표에도 적힌다**(`83/신성호/광산구`).
 *
 * 여기서 받아 두지 않으면 나중에 100명에게 따로 물어보러 다녀야 한다.
 * 이 기능 이전에 승인된 분들은 이 화면을 다시 안 보므로 로그인 뒤에
 * 따로 받는다(`screens/FillProfile.tsx`).
 *
 * **전화번호·차량번호는 다른 표에 저장된다**(`profile_private`) — 운영진만
 * 남의 것을 볼 수 있게 나눠 두었다. 저장은 `saveMyProfile()` 한 곳에서 한다.
 *
 * 운영진이 승인하면 auth.tsx의 실시간 구독이 profiles 변경을 받아
 * 새로고침 없이 앱으로 들어간다.
 */
export function Pending() {
    const { profile, contact, session, refresh } = useAuth();
    const banned = profile?.role === 'banned';
    const [name, setName] = useState(profile?.name ?? '');
    const [phone, setPhone] = useState(contact?.phone ?? '');
    const [car, setCar] = useState(contact?.car ?? '');
    const [region, setRegion] = useState(profile?.region ?? '');
    const [gender, setGender] = useState<Gender | null>(profile?.gender ?? null);
    const [birth, setBirth] = useState(
        profile?.birth_year ? String(profile.birth_year) : '');
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
        if (!gender) { toast('성별을 골라 주세요.', 'error'); return; }
        const year = birthValue(birth);
        if (year === null) { toast('태어난 해를 적어 주세요.', 'error'); return; }
        if (year === false) {
            toast(`태어난 해는 ${BIRTH_MIN}~${BIRTH_MAX} 사이로 적어 주세요.`, 'error');
            return;
        }
        if (!region.trim()) { toast('거주지역을 적어 주세요.', 'error'); return; }

        setSaving(true);
        const error = await saveMyProfile(
            session!.user.id,
            { name: trimmed, gender, birth_year: year, region: region.trim() },
            { phone: phone.trim(), car: car.trim() },
        );
        setSaving(false);

        if (error) { toast(readableError(error), 'error'); return; }
        await refresh();
        toast('저장했습니다. 운영진이 확인하면 들어갈 수 있습니다.', 'ok');
    };

    if (help) return <Help onBack={() => setHelp(false)} />;

    return (
        <div className="page bare" style={{ gap: 'var(--gap-lg)' }}>
            <div className="row" style={{ paddingTop: 'var(--gap)' }}>
                <Avatar name={profile?.name} url={profile?.avatar_url}
                        gender={profile?.gender} size="lg" />
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
                <GenderAge
                    id="p" gender={gender} birth={birth}
                    onGender={setGender} onBirth={setBirth}
                />
                <div className="field">
                    <label htmlFor="p-car">차량번호</label>
                    <input
                        id="p-car" className="input" value={car}
                        onChange={e => setCar(e.target.value)}
                        placeholder="12가 3456" maxLength={20}
                    />
                </div>
                <div className="field">
                    <label htmlFor="p-region">거주지역</label>
                    <Hinted hint="광산구" empty={!region}>
                        <input
                            id="p-region" className="input" value={region}
                            onChange={e => setRegion(e.target.value.slice(0, REGION_MAX))}
                            maxLength={REGION_MAX}
                        />
                    </Hinted>
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
