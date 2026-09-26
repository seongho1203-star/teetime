import { supabase, signOut } from './supabase';
import { disablePush } from './push';

/**
 * 회원 탈퇴 — `내 정보`의 웹 화면과 앱 화면(`MeViewController` → `MeRoute`)이
 * 같이 쓴다. **묻는 것은 부르는 쪽이 한다**(앱 화면은 제 창으로 묻는다 —
 * 웹 확인창은 앱 화면 뒤에 깔려 안 보인다).
 *
 * **지우는 일은 DB가 한다**(`delete_me`). 여기서 하는 것은 **DB가 못 하는 둘**
 * 뿐이다 — 이 기기의 알림 등록을 끊는 것과 저장소의 사진 파일을 지우는 것.
 * **순서가 있다: 알림 → 사진 → 계정.** 계정을 먼저 지우면 그다음 두 줄이
 * 권한을 잃어 사진이 저장소에 영영 남는다. 앞의 둘은 실패해도 그냥 넘어간다 —
 * 나갈 길이 막히면 안 된다. 실패하면 `delete_me`의 오류를 던진다.
 */
export async function leaveAccount(uid: string): Promise<void> {
    /* 행만 사라지면 폰은 계속 등록돼 있어, 옛 토큰으로 한 번 더 울릴 수 있다. */
    await disablePush().catch(() => { /* 안 돼도 나가는 것을 막지 않는다 */ });

    /* 저장소 파일은 행을 지운다고 같이 사라지지 않는다 — 자기 폴더만 지울 수 있다(`avatars_del`). */
    try {
        const { data: files } = await supabase.storage.from('avatars').list(uid);
        if (files?.length) {
            await supabase.storage.from('avatars').remove(files.map(f => `${uid}/${f.name}`));
        }
    } catch { /* 사진이 남는 것뿐이다 */ }

    const { error } = await supabase.rpc('delete_me');
    if (error) throw error;

    /* 계정이 이미 없어 로그아웃이 거절될 수 있다 — 화면은 로그인으로 돌아가야 하므로 삼킨다. */
    await signOut().catch(() => { /* 세션은 어차피 죽었다 */ });
}
