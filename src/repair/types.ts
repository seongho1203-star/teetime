export const PRODUCT_FAMILIES = [
    '에어컨',
    '냉장고',
    '김치냉장고',
    '세탁기',
    '건조기',
    '식기세척기',
    '정수기',
    'TV·모니터',
    '청소기',
    '전자레인지·오븐',
    '기타 가전',
] as const;

export const ENTRY_CATEGORIES = [
    { id: 'inspection', label: '수리 및 점검방법', icon: '⌕' },
    { id: 'test_mode', label: '테스트 모드', icon: '▦' },
    { id: 'error_code', label: '에러 코드', icon: '!' },
    { id: 'parts', label: '부품·회로', icon: '⌁' },
] as const;

export type EntryCategory = typeof ENTRY_CATEGORIES[number]['id'];
export type VerificationStatus = 'unverified' | 'verified' | 'needs_review';

export interface RepairMembership {
    user_id: string;
    display_name: string;
    status: 'pending' | 'member';
    requested_at: string;
    approved_at: string | null;
}

export interface RepairEntry {
    id: string;
    product_family: string;
    model_code: string;
    category: EntryCategory;
    title: string;
    symptoms: string;
    inspection_steps: string;
    result_notes: string;
    cautions: string;
    tags: string[];
    photo_paths: string[];
    created_by: string;
    created_at: string;
    updated_at: string;
    verification_status: VerificationStatus;
    verified_by: string | null;
    verified_at: string | null;
    author_name?: string;
}

export interface RepairNotification {
    id: string;
    kind: string;
    title: string;
    body: string;
    url: string;
    created_at: string;
    read_at: string | null;
}

export interface EntryFilters {
    query?: string;
    family?: string;
    category?: EntryCategory | '';
    model?: string;
}
