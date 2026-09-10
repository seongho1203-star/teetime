import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, signOut } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { canPickNative, composerReady, pickNativePhoto } from '../lib/composer';
import { Avatar } from '../components/Avatar';
import { TopBar } from '../components/TopBar';
import { useConfirm } from '../components/Confirm';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import {
    APP_VERSION, BIRTH_MAX, BIRTH_MIN, REGION_MAX, ROLE_LABEL, birthValue, personLabel,
    type Gender,
} from '../lib/types';
import { GenderAge } from '../components/GenderAge';
import { Hinted } from '../components/Hinted';
import { saveMyProfile } from '../lib/db';
import { canInstall, onInstallChange, promptInstall } from '../lib/install';
import { IS_NATIVE } from '../lib/native';
import { shrinkImage } from '../lib/image';
import {
    chatPush, disablePush, enablePush, pushState, setChatPush, watchPushStep,
    type PushState,
} from '../lib/push';
import { Switch } from '../components/Switch';
import './Home.css';

export function Me() {
    const { profile, contact, session, refresh, isSuper } = useAuth();
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
    const [leaving, setLeaving] = useState(false);
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
    const upload = async (raw: Blob) => {
        setPhotoBusy(true);
        try {
            const blob = await shrinkImage(raw, 400);
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

    const gotFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';          // 같은 파일을 다시 고를 수 있게
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast('사진만 올릴 수 있습니다.', 'error');
            return;
        }
        await upload(file);
    };

    /**
     * **앱에서는 앱이 고르게 한다** — 대화의 `+`와 같은 길이다
     * (`pickNativePhoto` in lib/composer).
     *
     * **사용자 제보로 잡은 자리다** — 앱에서 프로필 사진을 바꾸려는데
     * 아무 일도 안 일어났다. 웹 `<input type="file">`을 코드로 누르면
     * iOS가 고르는 창을 붙일 손짓이 없어 제 맘대로 띄우거나 아예 안 띄운다.
     * 대화에서 이미 겪고 앱 쪽으로 옮겨 둔 그 자리인데, 여기만 남아 있었다.
     *
     * **`await`보다 먼저 웹 칸을 눌러야 한다** — 기다린 뒤에 부르면 iOS가
     * 사용자 손짓으로 안 쳐서 창이 아예 안 열린다. 그래서 앱인지 아닌지는
     * `canPickNative()`로 **그 자리에서** 가른다(`composerReady()`는 이
     * 화면이 뜰 때 미리 물어봐 둔다).
     */
    const changePhoto = async () => {
        if (!canPickNative()) { photoRef.current?.click(); return; }
        const got = await pickNativePhoto();
        if (got.kind === 'fail') {
            toast(`사진을 못 불러왔습니다 — ${got.why}`, 'error');
            photoRef.current?.click();
            return;
        }
        if (got.kind === 'cancel') return;
        await upload(got.blob);
    };

    /* 설치 신호는 lib/install이 앱 시작 때부터 붙잡아 둔다. */
    const [installable, setInstallable] = useState(canInstall());
    useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);

    /* **사진을 누를 때가 아니라 지금 물어본다.** 누른 뒤에 물어보면
       `await` 뒤에 웹 칸을 눌러야 하는데, 기다린 뒤의 `click()`은 iOS가
       사용자 손짓으로 안 쳐서 **고르는 창이 아예 안 열린다.**
       한 번만 물어보고 기억하므로 여기서 불러도 값이 늘지 않는다. */
    useEffect(() => { void composerReady(); }, []);

    /* ── 알림 ────────────────────────────────────────────────
       기기마다 따로 켠다. 폰에서 켜도 PC는 안 켜진다 — 알림을 받을 곳이
       기기이기 때문이다. iOS는 홈 화면에 추가한 앱에서만 켤 수 있다.

       **대화만 따로 끌 수 있다.** 모집·공지·투표는 하루 몇 번이지만 대화는
       종일 울려서, 그것 때문에 알림을 통째로 끄면 라운드 소식까지 놓친다. */
    const [push, setPush] = useState<PushState | null>(null);
    const [chat, setChat] = useState(true);
    const [pushBusy, setPushBusy] = useState(false);
    const [chatBusy, setChatBusy] = useState(false);

    /* **어느 걸음에서 막혔는지 화면에 적는다.** 알림을 켜는 일은 폰에서만
       도는 네 걸음이라(플러그인 · 권한 · 토큰 · 서버) 밖에서는 알 길이
       없다 — 안 켜진다는 제보를 받으면 짐작만 하게 되므로, 도는 동안에는
       걸음을 적고 실패하면 **그 까닭을 줄에 남겨 둔다.**
       **토스트로만 알리지 말 것** — 몇 초 뒤 사라져 사진으로 못 찍는다. */
    const [step, setStep] = useState('');
    const [why, setWhy] = useState('');

    useEffect(() => {
        pushState().then(async s => {
            setPush(s);
            if (s === 'on') setChat(await chatPush());
        });
    }, []);

    useEffect(() => watchPushStep(setStep), []);

    const togglePush = async () => {
        setPushBusy(true);
        setWhy('');
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
            setWhy(readableError(e));
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
            /* **앱에서는 뜻이 다르다** — 브라우저가 못 받는 것이 아니라
               **알림이 붙기 전 판을 쓰고 있는 것**이다. 거기서 `이 브라우저는`
               이라고 적으면 고칠 길이 없는 말이 된다. */
            case 'unsupported': return {
                hint: IS_NATIVE
                    ? '앱을 최신 판으로 받으면 켤 수 있습니다'
                    : '이 브라우저는 알림을 못 받습니다',
                can: false };
            default: return { hint: '확인 중…', can: false };
        }
    };

    const logout = async () => {
        const ok = await confirm({ title: '로그아웃할까요?', confirmLabel: '로그아웃' });
        if (ok) await signOut();
    };

    /**
     * 회원 탈퇴.
     *
     * **스토어가 요구하는 자리다** — 계정을 만드는 앱은 그 계정을 **앱 안에서
     * 지울 수 있어야 한다**(애플 심사 규정 5.1.1(v)). 없으면 그것만으로
     * 반려된다(`docs/출시-전-할일.md` 0-7번).
     *
     * **지우는 일은 DB가 한다**(`delete_me`) — 화면이 표를 하나씩 지우면
     * 중간에 끊겼을 때 반쯤 지워진 사람이 남고, 대기자를 올리는 규칙도
     * 두 벌이 된다. 여기서 하는 것은 **DB가 못 하는 둘**뿐이다:
     * 이 기기의 알림 등록을 끊는 것과 저장소의 사진 파일을 지우는 것.
     *
     * **순서가 있다.** 알림 → 사진 → 계정이다. 계정을 먼저 지우면 그다음
     * 두 줄이 권한을 잃어 **사진이 저장소에 영영 남는다.**
     * 앞의 둘은 실패해도 그냥 넘어간다 — 알림 한 줄 때문에 나갈 길이
     * 막히면 안 된다(행 자체는 계정과 함께 딸려 지워진다).
     */
    const leaveClub = async () => {
        const ok = await confirm({
            title: '정말 탈퇴하시겠습니까?',
            danger: true,
            confirmLabel: '탈퇴하기',
            detail: (
                <>
                    <b>{profile?.name || '회원'}</b>님의 계정이 지워집니다.
                    {' '}<b>되돌릴 수 없습니다.</b>
                    <br /><br />
                    · 프로필과 전화번호·차량번호<br />
                    · 신청해 둔 라운드와 던진 표<br />
                    · 프로필 사진과 알림 설정
                    <br /><br />
                    대화방에 남긴 글은 지워지지 않습니다.
                    다시 들어오시려면 처음처럼 가입 신청을 하셔야 합니다.
                </>
            ),
        });
        if (!ok) return;

        setLeaving(true);
        try {
            const uid = session!.user.id;

            /* 이 기기의 알림 등록을 먼저 끊는다. 행만 사라지면 폰은 계속
               등록돼 있어, 발송기가 미처 못 지운 옛 토큰으로 한 번 더
               울릴 수 있다(`disablePush`가 있는 까닭이다). */
            await disablePush().catch(() => { /* 안 돼도 나가는 것을 막지 않는다 */ });

            /* 저장소 파일은 행을 지운다고 같이 사라지지 않는다 — 손으로
               치운다. 자기 폴더만 지울 수 있게 정책이 막고 있어 남의 것은
               건드릴 수 없다(`avatars_del`). */
            try {
                const { data: files } = await supabase.storage.from('avatars').list(uid);
                if (files?.length) {
                    await supabase.storage.from('avatars')
                        .remove(files.map(f => `${uid}/${f.name}`));
                }
            } catch { /* 사진이 남는 것뿐이다 */ }

            const { error } = await supabase.rpc('delete_me');
            if (error) throw error;

            /* 계정이 이미 없어 로그아웃이 거절될 수 있다 — 그래도 화면은
               로그인으로 돌아가야 하므로 실패를 삼킨다. */
            await signOut().catch(() => { /* 세션은 어차피 죽었다 */ });
            toast('탈퇴했습니다. 그동안 함께해 주셔서 고맙습니다.', 'ok');
        } catch (err) {
            toast(readableError(err), 'error');
        } finally {
            setLeaving(false);
        }
    };

    return (
        <div className="page">
            <TopBar title="내 정보" />

            <div className="me-head">
                {/* 사진을 누르면 바로 바꾼다. 프로필 수정 안으로 넣으면
                    거기까지 들어가야 해서, 제일 자주 바꿀 것을 밖에 둔다. */}
                <span className="avatar-slot">
                    <button className="avatar-pick" onClick={changePhoto}
                            disabled={photoBusy} aria-label="프로필 사진 바꾸기">
                        <Avatar name={profile?.name} url={profile?.avatar_url}
                                  gender={profile?.gender} size="lg" />
                        <span className="avatar-pick-mark" aria-hidden="true">
                            {photoBusy ? '…' : '＋'}
                        </span>
                    </button>
                    {/* **`hidden`으로 두지 말 것**(대화의 `.file-anchor`와 같은
                        자리다). iOS는 고르는 창을 **이 칸이 있는 자리**에
                        붙이는데, 자리가 없으면 화면 아무 데나 띄운다.
                        얼굴에 겹쳐 안 보이게만 둔다 — 배치에는 몫이 없다. */}
                    <input ref={photoRef} type="file" accept="image/*" onChange={gotFile}
                           className="file-anchor" tabIndex={-1} aria-hidden="true" />
                </span>
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
                            {/* 도는 동안에는 걸음을 적는다 — 아무 말이 없으면
                                눌리지 않은 줄 알고 또 누르게 된다. */}
                            <div className="switch-desc">
                                {pushBusy ? `켜는 중… ${step}` : pushLine().hint}
                            </div>
                            {/* 실패한 까닭은 남겨 둔다. 토스트는 사라져서
                                무엇이 막혔는지 물어볼 수가 없다. */}
                            {!!why && !pushBusy && (
                                <div className="switch-desc err">
                                    {step && `${step} — `}{why}
                                </div>
                            )}
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

            {/* **찾기 쉬운 자리에 둔다.** 애플은 계정을 지우는 길이 앱 안에
                있어야 한다고만 하지 않고 **쉽게 찾을 수 있어야** 한다고 적어
                두었다 — 메뉴 속에 숨기면 그것으로 반려될 수 있다.
                대신 분홍(지금 눌러야 할 것)이 아니라 빨강 테두리라, 로그아웃
                옆에서 잘못 누를 만한 단추로는 안 읽힌다.

                **앱관리자에게는 안 보인다.** `delete_me()`가 그 사람만은
                막는데(나가 버리면 운영자를 임명할 사람이 없다), 단추를 그냥
                두면 **눌러도 오류만 나는 자리**가 된다. */}
            {!isSuper && (
                <button className="btn danger block" onClick={leaveClub} disabled={leaving}>
                    {leaving ? '탈퇴 중…' : '회원 탈퇴'}
                </button>
            )}

            {/* **진단 줄 둘은 걷어냈다**(출시용으로 넘어가면서 · 사용자 요청).
                `화면 판 {__BUILD__}`는 앱이 웹 주소를 띄우던 때 **옛 화면이
                남았는지**를 가리려고 붙여 둔 것이고, `ncStatus()`는 글칸이
                웹인지 앱인지 보려던 것이다. 둘 다 회원이 볼 값이 아니다.
                **다시 팔 일이 생기면 이 자리에 그대로 도로 붙이면 된다** —
                `vite.config.ts`의 `define: __BUILD__`도, `lib/composer.ts`의
                `ncStatus()`도 남겨 두었다. */}
            <p className="xs faint me-foot">
                앱제작: 악마제리<br />
                버전 {APP_VERSION}
            </p>
        </div>
    );
}
