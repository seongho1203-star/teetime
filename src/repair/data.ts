import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { shrinkImage } from '../lib/image';
import type {
    EntryFilters, RepairEntry, RepairJobTitle, RepairMembership, RepairNotification, VerificationStatus,
} from './types';

// 새 수리 지식 테이블은 기존 골프 테이블과 분리되어 있다.
export const repairDb = supabase as unknown as SupabaseClient;
const db = repairDb;
const PHOTO_BUCKET = 'repair-photos';
const PHOTO_LIMIT = 6;
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

function id() {
    return globalThis.crypto?.randomUUID?.()
        ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
}

async function authorNames(entries: RepairEntry[]): Promise<RepairEntry[]> {
    const ids = [...new Set(entries.map(entry => entry.created_by).filter(Boolean))];
    if (!ids.length) return entries;

    const { data } = await db.from('repair_memberships')
        .select('user_id, display_name').in('user_id', ids);
    const names = new Map((data ?? []).map((row: { user_id: string; display_name: string }) => [row.user_id, row.display_name]));
    return entries.map(entry => ({ ...entry, author_name: names.get(entry.created_by) ?? '회원' }));
}

export async function getRepairMembership(userId: string): Promise<RepairMembership | null> {
    const { data, error } = await db.from('repair_memberships')
        .select('user_id, display_name, job_title, profile_completed_at, status, requested_at, approved_at')
        .eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data as RepairMembership | null;
}

export async function requestRepairMembership(displayName: string): Promise<void> {
    const { error } = await db.rpc('request_repair_membership', {
        p_display_name: displayName.trim(),
    });
    if (error) throw error;
}

export async function updateRepairMemberProfile(
    userId: string, displayName: string, jobTitle: RepairJobTitle,
    completedAt: string | null,
): Promise<void> {
    const { data, error } = await db.from('repair_memberships')
        .update({
            display_name: displayName.trim(),
            job_title: jobTitle,
            profile_completed_at: completedAt ?? new Date().toISOString(),
        })
        .eq('user_id', userId).eq('status', 'member')
        .select('user_id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('승인된 회원 정보를 찾지 못했습니다. 다시 로그인해 주세요.');
}

export async function searchEntries(filters: EntryFilters = {}): Promise<RepairEntry[]> {
    const { data, error } = await db.rpc('search_repair_entries', {
        p_query: filters.query?.trim() || null,
        p_family: filters.family || null,
        p_category: filters.category || null,
        p_model: filters.model?.trim() || null,
        p_limit: 80,
    });
    if (error) throw error;
    return authorNames((data ?? []) as RepairEntry[]);
}

export async function getEntry(entryId: string): Promise<RepairEntry> {
    const { data, error } = await db.from('repair_entries')
        .select('*').eq('id', entryId).single();
    if (error) throw error;
    const [withName] = await authorNames([data as RepairEntry]);
    return withName;
}

export async function signedPhotoUrls(paths: string[]): Promise<string[]> {
    return Promise.all(paths.map(async path => {
        const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(path, 60 * 60);
        if (error || !data?.signedUrl) return '';
        return data.signedUrl;
    }));
}

async function preparePhoto(file: File): Promise<{ blob: Blob; mime: string; ext: string }> {
    if (!file.type.startsWith('image/')) throw new Error('사진 파일만 첨부할 수 있습니다.');
    const blob = await shrinkImage(file, 2048);
    let normalized = blob;
    let mime = blob.type || file.type;

    // 브라우저에서 미리 보거나 압축할 수 있는 형식으로 바꾼다.
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
        try {
            const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
            canvas.width = Math.round(bitmap.width * scale);
            canvas.height = Math.round(bitmap.height * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('사진을 변환하지 못했습니다.');
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close?.();
            const jpeg = await new Promise<Blob | null>(resolve =>
                canvas.toBlob(resolve, 'image/jpeg', 0.82));
            if (!jpeg) throw new Error('사진을 변환하지 못했습니다.');
            normalized = jpeg;
            mime = 'image/jpeg';
        } catch {
            throw new Error('이 사진 형식은 변환할 수 없습니다. JPG, PNG 또는 WebP로 다시 선택해 주세요.');
        }
    }

    if (normalized.size > PHOTO_MAX_BYTES) {
        throw new Error('사진 한 장은 8MB 이하로 첨부해 주세요.');
    }
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    return { blob: normalized, mime, ext };
}

export interface NewEntryInput {
    product_family: string;
    model_code: string;
    category: string;
    title: string;
    symptoms: string;
    inspection_steps: string;
    result_notes: string;
    cautions: string;
    tags: string[];
}

export async function createEntry(
    input: NewEntryInput,
    files: File[],
    userId: string,
): Promise<string> {
    if (files.length > PHOTO_LIMIT) throw new Error('사진은 최대 6장까지 첨부할 수 있습니다.');

    const entryId = id();
    const uploaded: string[] = [];
    try {
        for (const file of files) {
            const prepared = await preparePhoto(file);
            const path = userId + '/' + entryId + '/' + id() + '.' + prepared.ext;
            const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, prepared.blob, {
                contentType: prepared.mime,
                upsert: false,
            });
            if (error) throw error;
            uploaded.push(path);
        }

        const { error } = await db.from('repair_entries').insert({
            id: entryId,
            ...input,
            photo_paths: uploaded,
            created_by: userId,
        });
        if (error) throw error;
        return entryId;
    } catch (error) {
        if (uploaded.length) {
            await db.storage.from(PHOTO_BUCKET).remove(uploaded).catch(() => {});
        }
        throw error;
    }
}

export async function updateEntry(
    entryId: string,
    input: NewEntryInput,
    files: File[],
    userId: string,
    existingPhotoPaths: string[],
): Promise<void> {
    if (existingPhotoPaths.length + files.length > PHOTO_LIMIT) {
        throw new Error('사진은 최대 6장까지 첨부할 수 있습니다.');
    }
    const uploaded: string[] = [];
    try {
        for (const file of files) {
            const prepared = await preparePhoto(file);
            const path = userId + '/' + entryId + '/' + id() + '.' + prepared.ext;
            const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, prepared.blob, {
                contentType: prepared.mime,
                upsert: false,
            });
            if (error) throw error;
            uploaded.push(path);
        }

        // result_notes와 검증 필드는 수정 폼에 노출하지 않으며, 기존 값을 보존한다.
        const { error } = await db.from('repair_entries').update({
            product_family: input.product_family,
            model_code: input.model_code,
            category: input.category,
            title: input.title,
            symptoms: input.symptoms,
            inspection_steps: input.inspection_steps,
            cautions: input.cautions,
            tags: input.tags,
            photo_paths: [...existingPhotoPaths, ...uploaded],
        }).eq('id', entryId);
        if (error) throw error;
    } catch (error) {
        if (uploaded.length) await db.storage.from(PHOTO_BUCKET).remove(uploaded).catch(() => {});
        throw error;
    }
}

export async function removeEntry(entry: RepairEntry): Promise<void> {
    const { error } = await db.from('repair_entries').delete().eq('id', entry.id);
    if (error) throw error;
    if (entry.photo_paths.length) {
        const { error: photoError } = await db.storage.from(PHOTO_BUCKET).remove(entry.photo_paths);
        if (photoError) console.warn('[repair] 사진 정리 실패', photoError.message);
    }
}

export async function setVerification(
    entryId: string,
    status: VerificationStatus,
    userId: string,
): Promise<void> {
    const { error } = await db.from('repair_entries').update({
        verification_status: status,
        verified_by: status === 'verified' ? userId : null,
        verified_at: status === 'verified' ? new Date().toISOString() : null,
    }).eq('id', entryId);
    if (error) throw error;
}

export async function listNotifications(userId: string): Promise<RepairNotification[]> {
    const { data, error } = await db.from('notifications')
        .select('id, kind, title, body, url, created_at, read_at')
        .eq('user_id', userId).eq('kind', 'repair_entries')
        .order('created_at', { ascending: false })
        .limit(80);
    if (error) throw error;
    return (data ?? []) as RepairNotification[];
}

export async function unreadNotificationCount(userId: string): Promise<number> {
    const { count, error } = await db.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('kind', 'repair_entries')
        .is('read_at', null);
    if (error) throw error;
    return count ?? 0;
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<void> {
    let query = db.from('notifications').update({ read_at: new Date().toISOString() })
        .eq('user_id', userId).eq('kind', 'repair_entries').is('read_at', null);
    if (ids?.length) query = query.in('id', ids);
    const { error } = await query;
    if (error) throw error;
}
