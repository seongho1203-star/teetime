import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { createEntry, getEntry, PHOTO_LIMIT, signedPhotoUrls, updateEntry, type EntryInput } from './data';
import { ENTRY_CATEGORIES, PRODUCT_FAMILIES, type EntryCategory, type EntryKind, type RepairEntry } from './types';
import { Icon, messageOf } from './ui';

export function EntryForm({ userId, isAdmin = false }: { userId: string; isAdmin?: boolean }) {
    const { id: editId } = useParams();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [entry, setEntry] = useState<RepairEntry | null>(null);
    const [error, setError] = useState('');
    const homeTo: string = location.state?.homeTo ?? '/';
    const backTo = editId ? '/entry/' + editId : homeTo;
    const state = { homeTo };

    useEffect(() => {
        if (!editId) return;
        let active = true;
        setEntry(null);
        setError('');
        void getEntry(editId).then(record => {
            if (!active) return;
            if (!isAdmin && record.created_by !== userId) {
                navigate('/entry/' + editId, { replace: true, state: { homeTo } });
                return;
            }
            setEntry(record);
        }).catch(() => {
            if (active) setError('글을 불러오지 못했습니다. 연결을 확인하고 다시 열어 주세요.');
        });
        return () => { active = false; };
    }, [editId, homeTo, isAdmin, navigate, userId]);

    if (editId && entry?.id !== editId) {
        return (
            <div className="rn-page">
                {error ? (
                    <div className="rn-error-panel" role="alert">
                        <strong>{error}</strong><Link to={backTo} state={state}>글로 돌아가기</Link>
                    </div>
                ) : <div className="rn-loading-line" role="status"><span className="rn-spinner" /> 글 불러오는 중</div>}
            </div>
        );
    }

    return <EntryEditor key={editId ?? params.toString()} userId={userId} entry={editId ? entry : null}
                        params={params} backTo={backTo} homeTo={homeTo} />;
}

function EntryEditor({ userId, entry, params, backTo, homeTo }: {
    userId: string;
    entry: RepairEntry | null;
    params: URLSearchParams;
    backTo: string;
    homeTo: string;
}) {
    const toast = useToast();
    const navigate = useNavigate();
    const [kind, setKind] = useState<EntryKind>(entry?.entry_kind ?? (params.get('kind') === 'question' ? 'question' : 'case'));
    const [form, setForm] = useState<Omit<EntryInput, 'tags'>>(() => ({
        product_family: entry?.product_family ?? PRODUCT_FAMILIES.find(family => family === params.get('family')) ?? '',
        category: entry?.category ?? ENTRY_CATEGORIES.find(category => category.id === params.get('category'))?.id ?? 'inspection',
        model_code: entry?.model_code ?? params.get('model')?.slice(0, 50) ?? '',
        symptoms: entry?.symptoms ?? params.get('q')?.slice(0, 1200) ?? '',
        title: entry?.title ?? '',
        inspection_steps: entry?.inspection_steps ?? '',
        cautions: entry?.cautions ?? '',
    }));
    const [tagsText, setTagsText] = useState(entry?.tags.join(', ') ?? '');
    const [files, setFiles] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const [existingUrls, setExistingUrls] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const isQuestion = kind === 'question';
    const needsSymptom = !entry || isQuestion;
    const firstLine = form.symptoms.trim().split(/\r?\n/, 1)[0].trim();
    const suggestedTitle = [...firstLine].slice(0, 120).join('');
    const photoCount = (entry?.photo_paths.length ?? 0) + files.length;

    useEffect(() => {
        const urls = files.map(file => URL.createObjectURL(file));
        setPreviews(urls);
        return () => urls.forEach(url => URL.revokeObjectURL(url));
    }, [files]);

    useEffect(() => {
        if (!entry?.photo_paths.length) return;
        let active = true;
        void signedPhotoUrls(entry.photo_paths).then(urls => {
            if (active) setExistingUrls(urls);
        }).catch(() => { /* 사진 경로는 미리보기가 없어도 그대로 보존한다. */ });
        return () => { active = false; };
    }, [entry]);

    const field = <K extends keyof typeof form>(name: K, value: typeof form[K]) =>
        setForm(current => ({ ...current, [name]: value }));

    const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
        const incoming = Array.from(event.target.files ?? []);
        const slots = PHOTO_LIMIT - photoCount;
        setFiles(current => [...current, ...incoming.slice(0, slots)]);
        if (incoming.length > slots) toast('사진은 최대 6장까지 첨부할 수 있습니다.', 'error');
        event.target.value = '';
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (saving) return;
        const symptoms = form.symptoms.trim();
        const inspectionSteps = isQuestion ? '' : form.inspection_steps.trim();
        const title = form.title.trim() || ([...suggestedTitle].length >= 2
            ? suggestedTitle : form.product_family + (isQuestion ? ' 수리 질문' : ' 수리 사례'));
        if (!form.product_family || (needsSymptom && [...symptoms].length < 2)) {
            setError('제품군을 고르고 증상을 두 글자 이상 적어 주세요.');
            return;
        }
        if (!isQuestion && [...inspectionSteps].length < 2) {
            setError('확인한 내용이나 해결 방법을 두 글자 이상 적어 주세요.');
            return;
        }
        if ([...title].length < 2) {
            setError('제목은 두 글자 이상 적어 주세요.');
            return;
        }

        setSaving(true);
        setError('');
        try {
            const input: EntryInput = {
                ...form,
                model_code: form.model_code.trim().toUpperCase(),
                title,
                symptoms,
                inspection_steps: inspectionSteps,
                cautions: form.cautions.trim(),
                tags: [...new Set(tagsText.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean))].slice(0, 10),
            };
            if (entry) {
                await updateEntry(entry, input, files, userId);
                toast('글을 수정했습니다.', 'ok');
                navigate('/entry/' + entry.id, { replace: true, state: { homeTo } });
            } else {
                const id = await createEntry(input, files, userId, kind);
                toast(isQuestion ? '질문을 등록했습니다.' : '수리 사례를 등록했습니다.', 'ok');
                navigate('/entry/' + id, { replace: true, state: { homeTo } });
            }
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setSaving(false);
        }
    };

    const heading = entry ? (isQuestion ? '질문 수정' : '수리 정보 수정') : (isQuestion ? '팀에 질문하기' : '빠른 사례 등록');

    return (
        <div className="rn-page rn-form-page">
            <div className="rn-page-heading">
                <Link className="rn-back-link" to={backTo} state={{ homeTo }}><span>‹</span> {entry ? '글로 돌아가기' : '목록으로'}</Link>
                <h1>{heading}</h1>
            </div>
            <form className="rn-form-card rn-quick-form" onSubmit={submit}>
                <fieldset disabled={saving}>
                    {!entry && (
                        <div className="rn-mode-picker" role="group" aria-label="등록 방식">
                            <button type="button" aria-pressed={!isQuestion} onClick={() => { setKind('case'); setError(''); }}>수리 사례</button>
                            <button type="button" aria-pressed={isQuestion} onClick={() => { setKind('question'); setError(''); }}>팀에 질문</button>
                        </div>
                    )}
                    <label className="rn-field">
                        <span>제품군 <b>*</b></span>
                        <select value={form.product_family} onChange={e => field('product_family', e.target.value)} required>
                            <option value="">제품군 선택</option>
                            {PRODUCT_FAMILIES.map(family => <option key={family}>{family}</option>)}
                        </select>
                    </label>
                    <label className="rn-field">
                        <span>증상 {needsSymptom && <b>*</b>}</span>
                        <textarea value={form.symptoms} onChange={e => field('symptoms', e.target.value)}
                                  placeholder={isQuestion ? '증상과 이미 확인한 내용을 적어 주세요.' : '예: 세탁은 되지만 배수 단계에서 물이 남음'}
                                  rows={isQuestion ? 4 : 3} maxLength={1200} required={needsSymptom} />
                    </label>
                    {!isQuestion && (
                        <label className="rn-field">
                            <span>점검·해결 내용 <b>*</b></span>
                            <textarea value={form.inspection_steps} onChange={e => field('inspection_steps', e.target.value)}
                                      placeholder="확인한 조건, 실제로 한 조치와 결과를 적어 주세요."
                                      rows={4} maxLength={8000} required />
                        </label>
                    )}

                    <details className="rn-entry-options" open={Boolean(entry)}>
                        <summary>모델명·사진·추가 항목
                            {(photoCount > 0 || form.model_code) && (
                                <span>{[form.model_code, photoCount > 0 ? '사진 ' + photoCount + '장' : ''].filter(Boolean).join(' · ')}</span>
                            )}
                        </summary>
                        <div className="rn-entry-options-body">
                            <div className="rn-form-grid">
                                <label className="rn-field">
                                    <span>모델명 <small>(선택)</small></span>
                                    <input value={form.model_code} onChange={e => field('model_code', e.target.value)}
                                           placeholder="제품군 공통이면 비워 두세요" maxLength={50} />
                                </label>
                                <label className="rn-field">
                                    <span>정보 유형</span>
                                    <select value={form.category} onChange={e => field('category', e.target.value as EntryCategory)}>
                                        {ENTRY_CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
                                    </select>
                                </label>
                            </div>
                            {form.category === 'test_mode' && (
                                <p className="rn-form-note">테스트 모드가 적용되는 모델과 복귀 방법을 적어 주세요.</p>
                            )}
                            <label className="rn-field">
                                <span>제목 <small>(선택)</small></span>
                                <input value={form.title} onChange={e => field('title', e.target.value)}
                                       placeholder={suggestedTitle || '증상의 첫 줄을 제목으로 사용합니다'} maxLength={120} />
                            </label>
                            <div className="rn-upload-area">
                                {photoCount < PHOTO_LIMIT ? (
                                    <label className="rn-upload-button">
                                        <Icon name="image" size={19} /> <span>사진 추가</span>
                                        <small>{photoCount}/{PHOTO_LIMIT}</small>
                                        <input type="file" aria-label="사진 추가" accept="image/*" multiple onChange={addFiles} />
                                    </label>
                                ) : <span className="rn-form-note">사진 {PHOTO_LIMIT}장 첨부됨</span>}
                                <p>사진에서 고객 정보가 보이지 않게 해 주세요.</p>
                            </div>
                            {photoCount > 0 && (
                                <div className="rn-photo-preview-grid">
                                    {entry?.photo_paths.map((path, index) => (
                                        <div className="rn-photo-preview" key={path}>
                                            {existingUrls[index] && <img src={existingUrls[index]} alt={'기존 사진 ' + (index + 1)} />}
                                            <span className="rn-existing-photo-label">기존 사진</span>
                                        </div>
                                    ))}
                                    {files.map((file, index) => (
                                        <div className="rn-photo-preview" key={file.name + index}>
                                            {previews[index] && <img src={previews[index]} alt={'첨부 사진 ' + (index + 1)} />}
                                            <button type="button" onClick={() => setFiles(current => current.filter((_, i) => i !== index))}
                                                    aria-label={'첨부 사진 ' + (index + 1) + ' 빼기'}>×</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <label className="rn-field">
                                <span>주의 사항 <small>(선택)</small></span>
                                <textarea value={form.cautions} onChange={e => field('cautions', e.target.value)} rows={3} maxLength={1800} />
                            </label>
                            <label className="rn-field">
                                <span>검색 태그 <small>(쉼표로 구분)</small></span>
                                <input value={tagsText} onChange={e => setTagsText(e.target.value)}
                                       placeholder="예: 배수, 간헐, OE" maxLength={200} />
                            </label>
                        </div>
                    </details>
                    {error && <p className="rn-inline-error" role="alert">{error}</p>}
                    <div className="rn-form-actions">
                        <Link to={backTo} state={{ homeTo }} className="rn-secondary-btn">취소</Link>
                        <button type="submit" className="rn-primary-btn" disabled={saving}>
                            {saving ? <><span className="rn-spinner" /> 저장 중…</> : entry ? '수정 내용 저장' : '등록하기'}
                        </button>
                    </div>
                </fieldset>
            </form>
        </div>
    );
}
