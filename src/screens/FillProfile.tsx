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

/**
 * 성별·태어난 해·거주지역을 아직 안 적은 **이미 승인된 회원**에게 한 번 받는 화면.
 *
 * **가입 화면(`Pending`)만으로는 못 받는다.** 그 화면은 승인 전에만 보이는데,
 * 이 기능이 생기기 전에 가입한 100명은 이미 승인이 끝나 그리로 안 간다 —
 * 물어볼 자리가 아예 없다. 그래서 로그인 뒤 앱에 들어가기 직전에 한 번 막는다.
 *
 * **한 번만 막힌다.** 적고 나면 다시는 안 뜨고, 나중에 고치는 것은
 * `내 정보 → 프로필 수정`에서 한다.
 *
 * **DB에 칸이 없으면 여기까지 오지 않는다**(`needsProfile`) — 그때 막으면
 * 저장도 안 되는 화면에 회원 모두가 갇힌다.
 */
export function FillProfile() {
    const { profile, session, refresh } = useAuth();
    const toast = useToast();
    const [gender, setGender] = useState<Gender | null>(profile?.gender ?? null);
    const [birth, setBirth] = useState(
        profile?.birth_year ? String(profile.birth_year) : '');
    const [region, setRegion] = useState(profile?.region ?? '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
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
            session!.user.id, { gender, birth_year: year, region: region.trim() });
        setSaving(false);
        if (error) { toast(readableError(error), 'error'); return; }
        /* 새로 받아 와야 `needsProfile`이 false가 되어 앱으로 들어간다. */
        await refresh();
    };

    return (
        <div className="page bare" style={{ gap: 'var(--gap-lg)' }}>
            <div className="row" style={{ paddingTop: 'var(--gap)' }}>
                <Avatar name={profile?.name} url={profile?.avatar_url}
                        gender={profile?.gender} size="lg" />
                <div className="grow">
                    <div className="b" style={{ fontSize: 'var(--fs-md)' }}>
                        {profile?.name || '회원'}님
                    </div>
                    <div className="sm faint">세 가지만 더 알려 주세요</div>
                </div>
            </div>

            {/* **왜 받는지 적는다.** 잘 쓰던 앱이 갑자기 뭘 물어보면
                무슨 일인가 싶다 — 한 줄이면 납득한다. */}
            <div className="notice warn">
                <b>세 가지</b>가 빠져 있습니다.<br />
                남녀와 나이가 고르게 섞이도록 조를 짜는 데 쓰고,
                이름은 <b>83/신성호/광산구</b>처럼 보이게 됩니다.
            </div>

            <div className="card">
                <GenderAge
                    id="fp" gender={gender} birth={birth}
                    onGender={setGender} onBirth={setBirth}
                />
                <div className="field">
                    <label htmlFor="fp-region">거주지역</label>
                    <Hinted hint="광산구" empty={!region}>
                        <input
                            id="fp-region" className="input" value={region}
                            onChange={e => setRegion(e.target.value.slice(0, REGION_MAX))}
                            maxLength={REGION_MAX}
                        />
                    </Hinted>
                </div>
                <button className="btn primary block" onClick={save} disabled={saving}>
                    {saving ? '저장 중…' : '저장하고 시작하기'}
                </button>
            </div>

            <button className="btn ghost block" onClick={signOut}>로그아웃</button>
        </div>
    );
}
