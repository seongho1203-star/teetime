import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, signOut } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import {
    BIRTH_MAX, BIRTH_MIN, REGION_MAX, ROLE_LABEL, birthValue, personLabel, type Gender,
} from '../lib/types';
import { GenderAge } from '../components/GenderAge';
import { Hinted } from '../components/Hinted';
import { saveMyProfile } from '../lib/db';
import { canInstall, onInstallChange, promptInstall } from '../lib/install';
import { shrinkImage } from '../lib/image';
import {
    chatPush, disablePush, enablePush, pushState, setChatPush, type PushState,
} from '../lib/push';
import { Switch } from '../components/Switch';
import './Home.css';

export function Me() {
    const { profile, contact, session, refresh } = useAuth();
    const toast = useToast();
    const confirm = useConfirm();

    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(profile?.name ?? '');
    const [phone, setPhone] = useState(contact?.phone ?? '');
    const [car, setCar] = useState(contact?.car ?? '');
    /* 조 편성의 `성별 조합`·`나이 조합`이 보는 값이다. **둘 다 필수라
       여기서도 비울 수 없다** — 비울 수 있게 두면 로그인할 때 다시 막힌다. */
    const [gender, setGender] = useState<Gender | null>(profile?.gender ?? null);
    const [birth, setBirth] = useState(
        profile?.birth_year ? String(profile.birth_year) : '');
    const [region, setRegion] = useState(profile?.region ?? '');
    const [saving, setSaving] = useState(false);
    const [photoBusy, setPhotoBusy] = useState(false);
    const photoRef = useRef<HTMLInputElement>(null);

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
        setEditing(false);
        toast('저장했습니다.', 'ok');
    };

    /**
     * 프로필 사진 바꾸기.
     *
     * **자기 폴더(`<내 id>/…`)에만 올린다** — 저장소 정책이 그것만 허용한다.
     * 파일 이름에 지금 시각을 넣어 **주소가 매번 달라지게** 한다: 같은 주소로
     * 덮어쓰면 브라우저가 예전 사진을 캐시에서 꺼내 와 안 바뀐 것처럼 보인다.
     * 아바타로만 쓰이므로 400px로 줄여 올린다.
     */
    const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';          // 같은 파일을 다시 고를 수 있게
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast('사진만 올릴 수 있습니다.', 'error');
            return;
        }
        setPhotoBusy(true);
        try {
            const blob = await shrinkImage(file, 400);
            const path = `${session!.user.id}/${Date.now()}.jpg`;
            const { error: upErr } = await supabase.storage.from('avatars')
                .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
            if (upErr) throw upErr;

            const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
            const { error: dbErr } = await supabase.from('profiles')
                .update({ avatar_url: pub.publicUrl }).eq('id', session!.user.id);
            if (dbErr) throw dbErr;

            await refresh();
            toast('프로필 사진을 바꿨습니다.', 'ok');
        } catch (err) {
            toast(readableError(err), 'error');
        } finally {
            setPhotoBusy(false);
        }
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
                {/* 사진을 누르면 바로 바꾼다. 프로필 수정 안으로 넣으면
                    거기까지 들어가야 해서, 제일 자주 바꿀 것을 밖에 둔다. */}
                <button className="avatar-pick" onClick={() => photoRef.current?.click()}
                        disabled={photoBusy} aria-label="프로필 사진 바꾸기">
                    <Avatar name={profile?.name} url={profile?.avatar_url}
                              gender={profile?.gender} size="lg" />
                    <span className="avatar-pick-mark" aria-hidden="true">
                        {photoBusy ? '…' : '＋'}
                    </span>
                </button>
                <input ref={photoRef} type="file" accept="image/*" onChange={pickPhoto} hidden />
                <div className="grow" style={{ minWidth: 0 }}>
                    <div className="b truncate" style={{ fontSize: 'var(--fs-lg)' }}>
                        {personLabel(profile) || '닉네임 없음'}
                    </div>
                    {/* **차량번호는 여기 적지 않는다**(사용자 요청). 보이는
                        곳은 회원 명단 하나이고, 내 것은 아래 `프로필 수정`을
                        열면 칸에 그대로 들어 있다. */}
                    <div className="sm faint">
                        {profile ? ROLE_LABEL[profile.role] : '일반회원'}
                    </div>
                </div>
            </div>

            {editing ? (
                <div className="card">
                    <div className="field">
                        <label htmlFor="m-name">닉네임</label>
                        <input id="m-name" className="input" value={name}
                               onChange={e => setName(e.target.value)} maxLength={20} />
                    </div>
                    <div className="field">
                        <label htmlFor="m-phone">전화번호</label>
                        <input id="m-phone" className="input" value={phone}
                               onChange={e => setPhone(e.target.value)}
                               inputMode="tel" maxLength={20} placeholder="010-0000-0000" />
                    </div>
                    <GenderAge
                        id="m" gender={gender} birth={birth}
                        onGender={setGender} onBirth={setBirth}
                    />
                    <div className="field">
                        <label htmlFor="m-car">차량번호</label>
                        <input id="m-car" className="input" value={car}
                               onChange={e => setCar(e.target.value)}
                               placeholder="12가 3456" maxLength={20} />
                    </div>
                    <div className="field">
                        <label htmlFor="m-region">거주지역</label>
                        <Hinted hint="광산구" empty={!region}>
                            <input id="m-region" className="input" value={region}
                                   onChange={e => setRegion(e.target.value.slice(0, REGION_MAX))}
                                   maxLength={REGION_MAX} />
                        </Hinted>
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
                    {/* **가이드는 여기 없다** — 홈 머리말의 `📖 앱 가이드`로
                        옮겼다(사용자 요청). 메뉴 안에 있으면 열어야 보여서
                        처음 들어온 분이 정작 못 찾았다. 되돌리지 말 것. */}
                    <Link className="menu-item" to="/members">
                        <span className="grow">회원 명단</span>
                        <span className="chev">›</span>
                    </Link>
                    {/* **회원 누구나 들어간다** — 정산을 만드는 것이 누구나라
                        걷는 사람도 누구나다. 탭바에는 안 넣는다: 탭 다섯의
                        순서는 사용자가 정한 것이고, 라운드를 여는 달에만
                        쓰는 화면 때문에 모두의 탭을 늘릴 이유가 없다. */}
                    <Link className="menu-item" to="/settle">
                        <span className="grow">
                            <span className="b">정산 현황</span>
                            <br /><span className="xs faint">
                                내가 걷는 돈과 아직 안 내신 분을 한 번에 봅니다
                            </span>
                        </span>
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
                                {/* 꺼도 `@언급`과 내 글에 달린 답장은
                                    온다는 것을 적어 둔다. 안 적으면 껐는데
                                    왜 오냐가 되고, 부른 쪽은 왜 안 보냐가
                                    된다. */}
                                <div className="switch-desc">
                                    {chat
                                        ? '새 메시지가 올 때마다 옵니다'
                                        : '꺼짐 — @언급과 내 글에 온 답장은 그래도 옵니다'}
                                </div>
                            </div>
                            <Switch label="대화 알림"
                                    on={chat} onChange={toggleChat} disabled={chatBusy} />
                        </div>
                    )}

                    {/* 소리 시험 줄은 걷어냈다(사용자 요청). 소리 자체는
                        그대로 나고, 잠금 푸는 일은 `lib/sound.ts`가 첫 손짓에서
                        알아서 한다 — 이 단추가 있어야 도는 것이 아니었다. */}
                </div>
            )}

            <button className="btn ghost block" onClick={logout}>로그아웃</button>

            {/* 빌드 시각·뱃지 진단 줄은 걷어냈다(사용자 요청). 그때그때
                필요하면 다시 넣더라도, 평소에 회원이 볼 화면에는 두지 않는다.
                **지금은 잠시 도로 붙여 두었다** — 글칸이 깜빡인다는 제보를
                쫓는 중인데, 폰에 옛 화면이 남은 것인지 코드가 아직 틀린
                것인지 가릴 방법이 그것뿐이다. 가려지면 이 한 줄만 지운다. */}
            {/* 임시 — 글칸 깜빡임을 가리는 시험 화면. 가려지면 이 줄과
                위의 판 표시, `screens/KbTest.tsx`, route를 함께 지운다. */}
            <Link className="btn ghost block" to="/kbtest"
                  style={{ marginTop: 10 }}>⌨️ 글칸 시험</Link>

            <p className="xs faint me-foot">앱제작: 악마제리 · 판 {__BUILD__}</p>
        </div>
    );
}
