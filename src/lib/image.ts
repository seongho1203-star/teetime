/**
 * 올리기 전에 사진을 줄인다.
 *
 * 요즘 폰 사진은 한 장에 3~5MB다. 그대로 올리면 저장 공간이 금방 차고,
 * 데이터가 넉넉하지 않은 곳에서 대화를 열 때마다 그걸 다 받아야 한다.
 * 긴 변 1600px · JPEG 82%면 폰 화면에서는 차이를 못 느끼면서 대개
 * 300KB 안쪽으로 떨어진다.
 *
 * **줄이지 못하면 원본을 그대로 돌려준다.** 사진을 못 올리는 것보다
 * 큰 사진이라도 올라가는 편이 낫다.
 */

const MAX_EDGE = 1600;
const QUALITY = 0.82;

export async function shrinkImage(file: File): Promise<Blob> {
    try {
        // 아이폰 사진은 방향이 EXIF에만 적혀 있다. from-image를 줘야
        // 세로로 찍은 사진이 눕지 않는다.
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const w = Math.round(bitmap.width * scale);
        const h = Math.round(bitmap.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close?.();

        const blob = await new Promise<Blob | null>(res =>
            canvas.toBlob(res, 'image/jpeg', QUALITY));
        // 줄인 게 더 크면(작은 PNG 같은 것) 원본이 낫다.
        return blob && blob.size < file.size ? blob : file;
    } catch {
        return file;
    }
}
