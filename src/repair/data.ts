import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { shrinkImage } from '../lib/image';
import type {
    EntryCategory, EntryFilters, EntryKind, RepairAnswer, RepairApplication, RepairEntry,
    RepairMembership, RepairNotification,
} from './types';

// 새 수리 지식 테이블은 기존 골프 테이블과 분리되어 있다.
export const repairDb = supabase as unknown as SupabaseClient;
const db = repairDb;
const PHOTO_BUCKET = 'repair-photos';
export const PHOTO_LIMIT = 6;
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const ENTRY_PAGE_SIZE = 5;
const REPAIR_NOTICE_KINDS = ['repair_entries', 'repair_answers'];

function id() {
    return globalThis.crypto?.randomUUID?.()
        ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
}

async function memberNames(userIds: (string | null)[], signal?: AbortSignal): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter(id => id !== null))];
    if (!ids.length) return new Map();

    const query = db.from('repair_memberships')
        .select('user_id, display_name').in('user_id', ids);
    const { data } = await (signal ? query.abortSignal(signal) : query);
    return new Map((data ?? []).map(row => [row.user_id, row.display_name]));
}

export async function getRepairMembership(userId: string): Promise<RepairMembership | null> {
    const { data, error } = await db.from('repair_memberships')
        .select('user_id, display_name, status, requested_at, approved_at')
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

export async function updateRepairMemberName(userId: string, displayName: string): Promise<void> {
    const { error } = await db.from('repair_memberships')
        .update({ display_name: displayName.trim() }).eq('user_id', userId);
    if (error) throw error;
}

export async function searchEntries(filters: EntryFilters, offset: number, signal: AbortSignal) {
    const { data, error } = await db.rpc('search_repair_library', {
        p_query: filters.query?.trim() || null,
        p_family: filters.family || null,
        p_category: filters.category || null,
        p_model: filters.model?.trim() || null,
        p_kind: filters.kind ?? 'case',
        p_offset: offset,
        p_limit: ENTRY_PAGE_SIZE + 1,
    }).abortSignal(signal);
    if (error) throw error;

    const rows = (data ?? []) as RepairEntry[];
    const visible = rows.slice(0, ENTRY_PAGE_SIZE);
    const names = await memberNames(visible.map(entry => entry.created_by), signal);
    return {
        entries: visible.map(entry => ({ ...entry, author_name: names.get(entry.created_by ?? '') ?? '회원' })),
        hasMore: rows.length > ENTRY_PAGE_SIZE,
        nextOffset: offset + visible.length,
    };
}

export async function getEntry(entryId: string): Promise<RepairEntry> {
    const { data, error } = await db.from('repair_entries')
        .select('*').eq('id', entryId).single();
    if (error) throw error;
    const entry = data as RepairEntry;
    const names = await memberNames([entry.created_by]);
    return { ...entry, author_name: names.get(entry.created_by ?? '') ?? '회원' };
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

export interface EntryInput {
    product_family: string;
    model_code: string;
    category: EntryCategory;
    title: string;
    symptoms: string;
    inspection_steps: string;
    cautions: string;
    tags: string[];
}

export async function createEntry(
    input: EntryInput,
    files: File[],
    userId: string,
    kind: EntryKind,
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
            entry_kind: kind,
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
    entry: RepairEntry,
    input: EntryInput,
    files: File[],
    userId: string,
): Promise<void> {
    if (entry.photo_paths.length + files.length > PHOTO_LIMIT) {
        throw new Error('사진은 최대 6장까지 첨부할 수 있습니다.');
    }
    const uploaded: string[] = [];
    try {
        for (const file of files) {
            const prepared = await preparePhoto(file);
            const path = userId + '/' + entry.id + '/' + id() + '.' + prepared.ext;
            const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, prepared.blob, {
                contentType: prepared.mime,
                upsert: false,
            });
            if (error) throw error;
            uploaded.push(path);
        }

        const { data, error } = await db.from('repair_entries').update({
            ...input,
            photo_paths: [...entry.photo_paths, ...uploaded],
        }).eq('id', entry.id).eq('updated_at', entry.updated_at).select('id').maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('글이 이미 변경됐거나 수정할 수 없습니다. 최신 내용을 확인해 주세요.');
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

export async function listAnswers(entryId: string): Promise<RepairAnswer[]> {
    const { data, error } = await db.from('repair_entry_answers')
        .select('id, author_id, body, created_at')
        .eq('entry_id', entryId).order('created_at');
    if (error) throw error;
    const rows = (data ?? []) as RepairAnswer[];
    const names = await memberNames(rows.map(answer => answer.author_id));
    return rows.map(answer => ({ ...answer, author_name: names.get(answer.author_id ?? '') ?? '회원' }));
}

export async function addAnswer(entryId: string, userId: string, body: string) {
    const { error } = await db.from('repair_entry_answers')
        .insert({ entry_id: entryId, author_id: userId, body });
    if (error) throw error;
}

export async function removeAnswer(answerId: string) {
    const { error } = await db.from('repair_entry_answers')
        .delete().eq('id', answerId).select('id').single();
    if (error) throw error;
}

export async function acceptAnswer(entryId: string, answerId: string): Promise<RepairEntry> {
    const { data, error } = await db.rpc('accept_repair_answer', {
        p_entry_id: entryId,
        p_answer_id: answerId,
    }).single();
    if (error) throw error;
    return data as RepairEntry;
}

export async function listApplications(entryId: string): Promise<RepairApplication[]> {
    const { data, error } = await db.from('repair_entry_applications')
        .select('user_id, model_code, note').eq('entry_id', entryId).order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as RepairApplication[];
}

export async function addApplication(entryId: string, userId: string): Promise<RepairApplication> {
    const { data, error } = await db.from('repair_entry_applications')
        .insert({ entry_id: entryId, user_id: userId })
        .select('user_id, model_code, note').single();
    if (error) throw error;
    return data as RepairApplication;
}

export async function editApplication(entryId: string, application: RepairApplication): Promise<RepairApplication> {
    const { user_id, model_code, note } = application;
    const { data, error } = await db.from('repair_entry_applications')
        .update({ model_code, note }).eq('entry_id', entryId).eq('user_id', user_id)
        .select('user_id, model_code, note').single();
    if (error) throw error;
    return data as RepairApplication;
}

export async function removeApplication(entryId: string, userId: string) {
    const { error } = await db.from('repair_entry_applications')
        .delete().eq('entry_id', entryId).eq('user_id', userId);
    if (error) throw error;
}

export async function listNotifications(userId: string): Promise<RepairNotification[]> {
    const { data, error } = await db.from('notifications')
        .select('id, kind, title, body, url, created_at, read_at')
        .eq('user_id', userId).in('kind', REPAIR_NOTICE_KINDS)
        .order('created_at', { ascending: false })
        .limit(80);
    if (error) throw error;
    return (data ?? []) as RepairNotification[];
}

export async function unreadNotificationCount(userId: string): Promise<number> {
    const { count, error } = await db.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId).in('kind', REPAIR_NOTICE_KINDS)
        .is('read_at', null);
    if (error) throw error;
    return count ?? 0;
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<void> {
    let query = db.from('notifications').update({ read_at: new Date().toISOString() })
        .eq('user_id', userId).in('kind', REPAIR_NOTICE_KINDS).is('read_at', null);
    if (ids?.length) query = query.in('id', ids);
    const { error } = await query;
    if (error) throw error;
}
