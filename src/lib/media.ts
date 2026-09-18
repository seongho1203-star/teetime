/**
 * 대화에 올라간 것이 **사진인가 동영상인가** — 주소 끝으로 가른다.
 *
 * **DB에 칸을 새로 만들지 않았다**(사용자 요청으로 동영상을 넣으면서도).
 * 동영상 주소도 사진이 쓰던 `messages.image_url`에 그대로 들어간다 —
 * 이모티콘이 같은 칸을 `sticker:<id>`로 쓰는 그 방식이다. 덕분에
 * **붙여넣을 SQL도, 새 표도, 발송기 고침도 거의 없고** 그 칸이 아직
 * 없는 저장소에서도 예전과 똑같이 군다.
 *
 * **앱에도 같은 규칙이 있다**(`ios/App/App/ChatList.swift`의 `ChatMedia`) —
 * **한쪽만 고치지 말 것.** 갈리면 앱에서는 재생기가 뜨는데 웹에서는
 * 깨진 그림이 뜨는 식으로 어긋난다.
 */

/** 우리가 올리는 동영상 형식. 아이폰이 주는 것이 `.mov`이고 그 밖은 `.mp4`다. */
export const VIDEO_EXTS = ['mp4', 'mov', 'm4v'];

/** 이 주소가 동영상인가. 이모티콘(`sticker:`)은 여기 안 든다. */
export function isVideo(url: string | null | undefined): boolean {
    if (!url || url.startsWith('sticker:')) return false;
    const path = url.split('?')[0].split('#')[0].toLowerCase();
    return VIDEO_EXTS.some(ext => path.endsWith(`.${ext}`));
}

/**
 * 파일 하나를 올릴 때 쓸 끝(`ext`)과 형식(`type`).
 *
 * **사진은 원본 그대로 올린다**(사용자 요청 — `원본으로 올릴수있게`).
 * 다만 **HEIC만은 JPEG으로 바꿔서 올린다** — 아이폰 기본 형식인데
 * 안드로이드와 PC 브라우저가 못 열어, 그대로 두면 대화방 절반이 빈
 * 네모를 보게 된다. 바꾸는 일은 파일을 고르는 자리에서 한다
 * (앱은 `PickedMedia`, 웹은 `toUploadable`).
 */
export function extOf(file: Blob & { name?: string }): string {
    const fromName = (file.name ?? '').split('.').pop()?.toLowerCase() ?? '';
    if (fromName && /^[a-z0-9]{2,4}$/.test(fromName)) return fromName;
    const sub = (file.type || '').split('/')[1] ?? '';
    return sub.split(';')[0] || 'bin';
}

/**
 * 무료 통(Storage)의 **한 건 한도가 50MB다.** 넘으면 올리다 막히는데
 * 그 오류는 사람 말이 아니라, 고르는 자리에서 미리 잡아 알린다.
 */
export const UPLOAD_LIMIT = 50 * 1024 * 1024;
