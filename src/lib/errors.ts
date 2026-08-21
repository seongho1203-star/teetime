/**
 * Supabase가 돌려주는 오류 메시지를 사람이 읽을 말로 바꾼다.
 * RPC에서 raise exception으로 던진 한국어 문구는 그대로 쓰고,
 * 나머지 영문 오류는 흔한 것만 옮긴다.
 */
export function readableError(err: unknown): string {
    const msg = (err as { message?: string })?.message ?? String(err);
    if (/duplicate key|already exists/i.test(msg)) return '이미 처리된 요청입니다.';
    if (/row-level security|permission denied/i.test(msg)) return '권한이 없습니다.';
    if (/JWT|not authenticated/i.test(msg)) return '로그인이 필요합니다.';
    if (/Failed to fetch|NetworkError/i.test(msg)) return '연결이 끊겼습니다. 잠시 뒤 다시 시도해 주세요.';
    return msg;
}
