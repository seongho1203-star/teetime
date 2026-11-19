import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ENTRY_PAGE_SIZE, repairDb, searchEntries } from './data';
import { ENTRY_CATEGORIES, PRODUCT_FAMILIES, type EntryFilters, type RepairEntry } from './types';
import { dateLabel, Icon } from './ui';

type Results = Awaited<ReturnType<typeof searchEntries>> & { key: string };

const CATEGORY_FILTER_LABELS: Record<(typeof ENTRY_CATEGORIES)[number]['id'], string> = {
    inspection: '수리·점검',
    test_mode: '테스트',
    error_code: '에러 코드',
    parts: '부품·회로',
};

export function KnowledgeHome() {
    const [params, setParams] = useSearchParams();
    const filters = useMemo<EntryFilters>(() => ({
        query: params.get('q')?.slice(0, 120) ?? '',
        model: params.get('model')?.slice(0, 50) ?? '',
        family: PRODUCT_FAMILIES.find(family => family === params.get('family')) ?? '',
        category: ENTRY_CATEGORIES.find(category => category.id === params.get('category'))?.id ?? '',
        kind: params.get('view') === 'questions' ? 'question' : 'case',
    }), [params]);
    const key = params.toString();
    const hasFilters = Boolean(filters.query?.trim() || filters.model?.trim() || filters.family || filters.category);
    const isQuestion = filters.kind === 'question';
    const [results, setResults] = useState<Results | null>(null);
    const [pending, setPending] = useState<'first' | 'more' | null>('first');
    const [failure, setFailure] = useState<{ key: string; more: boolean } | null>(null);
    const [revision, setRevision] = useState(0);
    const request = useRef<AbortController | null>(null);
    const current = results?.key === key ? results : null;
    const error = failure?.key === key ? failure : null;
    const loading = !error && (!current || pending === 'first');
    const homeTo = key ? '/?' + key : '/';

    const load = useCallback(async (previous?: Results) => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setPending(previous ? 'more' : 'first');
        setFailure(null);
        try {
            const page = await searchEntries(filters, previous?.nextOffset ?? 0, controller.signal);
            if (controller.signal.aborted) return;
            const alreadyShown = new Set(previous?.entries.map(entry => entry.id));
            setResults({
                ...page,
                key,
                entries: previous ? [...previous.entries, ...page.entries.filter(entry => !alreadyShown.has(entry.id))] : page.entries,
            });
        } catch {
            if (!controller.signal.aborted) setFailure({ key, more: Boolean(previous) });
        } finally {
            if (!controller.signal.aborted) setPending(null);
        }
    }, [filters, key]);

    useEffect(() => {
        const timer = window.setTimeout(() => void load(), 220);
        return () => {
            window.clearTimeout(timer);
            request.current?.abort();
        };
    }, [load, revision]);

    useEffect(() => {
        const channel = repairDb.channel('repair-entries-list')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'repair_entries' },
                () => setRevision(value => value + 1))
            .subscribe();
        return () => { void repairDb.removeChannel(channel); };
    }, []);

    const change = (field: string, value: string) => {
        const next = new URLSearchParams(params);
        if (value) next.set(field, value);
        else next.delete(field);
        setParams(next, { replace: true });
    };

    const questionParams = new URLSearchParams({ kind: 'question' });
    if (filters.query?.trim()) questionParams.set('q', filters.query.trim());
    if (filters.family) questionParams.set('family', filters.family);
    if (filters.model?.trim()) questionParams.set('model', filters.model.trim());
    if (filters.category) questionParams.set('category', filters.category);
    const questionTo = '/new?' + questionParams.toString();
    const heading = isQuestion ? '미해결 질문' : hasFilters ? '검색 결과' : '최근 등록된 사례';
    const showResults = !error || error.more ? current : null;

    return (
        <div className="rn-page rn-knowledge-home">
            <section className="rn-search-panel" aria-labelledby="rn-search-title">
                <div className="rn-home-heading">
                    <h1 id="rn-search-title">수리 정보 찾기</h1>
                    <Link to="/new" state={{ homeTo }} className="rn-home-create"><Icon name="plus" size={16} /> 등록하기</Link>
                </div>
                <form role="search" onSubmit={event => { event.preventDefault(); void load(); }}>
                    <div className="rn-search-box">
                        <Icon name="search" size={18} />
                        <input type="search" enterKeyHint="search" maxLength={120} aria-label="수리 정보 검색"
                               value={filters.query} onChange={e => change('q', e.target.value)}
                               placeholder="예: 물이 안 빠짐, OE, 모델명" />
                        {hasFilters && (
                            <button type="button" onClick={() => setParams(isQuestion ? { view: 'questions' } : {}, { replace: true })}>초기화</button>
                        )}
                    </div>
                    <div className="rn-filter-row" role="group" aria-label="제품 필터">
                        <select className="rn-filter-control" aria-label="제품군"
                                value={filters.family} onChange={e => change('family', e.target.value)}>
                            <option value="">전체 제품군</option>
                            {PRODUCT_FAMILIES.map(family => <option key={family} value={family}>{family}</option>)}
                        </select>
                        <input className="rn-filter-control" aria-label="모델명"
                               value={filters.model} onChange={e => change('model', e.target.value)}
                               maxLength={50} placeholder="모델명" />
                    </div>
                </form>
                <div className="rn-category-filter" role="group" aria-label="정보 유형">
                    <button type="button" className={!filters.category ? 'active' : ''} aria-pressed={!filters.category}
                            aria-label="전체 유형" onClick={() => change('category', '')}>전체</button>
                    {ENTRY_CATEGORIES.map(category => (
                        <button key={category.id} type="button" className={filters.category === category.id ? 'active' : ''}
                                aria-label={category.label} aria-pressed={filters.category === category.id}
                                onClick={() => change('category', category.id)}>{CATEGORY_FILTER_LABELS[category.id]}</button>
                    ))}
                </div>
            </section>

            <section className="rn-results" aria-labelledby="rn-results-title">
                <div className="rn-library-switch">
                    <div className="rn-library-tabs" role="group" aria-label="글 목록">
                        <button type="button" aria-pressed={!isQuestion} onClick={() => change('view', '')}>수리 사례</button>
                        <button type="button" aria-pressed={isQuestion} onClick={() => change('view', 'questions')}>미해결 질문</button>
                    </div>
                    <Link to={questionTo} className="rn-inline-link" state={{ homeTo }}>팀에 질문</Link>
                </div>
                <div className="rn-section-heading">
                    <h2 id="rn-results-title">{heading}</h2>
                    <span className="rn-result-count" aria-live="polite">{loading ? '검색 중…' : showResults ? showResults.entries.length + '건 표시' : '조회 실패'}</span>
                </div>
                {error && (
                    <div className="rn-error-panel" role="alert">
                        <strong>{error.more ? '다음 글을 불러오지 못했습니다.' : '글을 불러오지 못했습니다.'}</strong>
                        <span>연결을 확인하고 다시 시도해 주세요.</span>
                        <button type="button" onClick={() => void load(error.more ? current ?? undefined : undefined)}>다시 시도</button>
                    </div>
                )}
                {loading && !current && <div className="rn-loading-line" role="status"><span className="rn-spinner" /> 정보 불러오는 중</div>}
                {!loading && showResults?.entries.length === 0 && (
                    <div className="rn-empty">
                        <strong>{hasFilters ? '검색 결과가 없습니다.' : isQuestion ? '미해결 질문이 없습니다.' : '아직 등록된 수리 사례가 없습니다.'}</strong>
                        {hasFilters && <p>검색어를 바꾸거나 현재 증상을 팀에 물어보세요.</p>}
                        <Link to={hasFilters || isQuestion ? questionTo : '/new'} state={{ homeTo }} className="rn-primary-btn">
                            {hasFilters ? '이 증상 질문하기' : isQuestion ? '질문하기' : '첫 사례 등록하기'}
                        </Link>
                    </div>
                )}
                {showResults && showResults.entries.length > 0 && (
                    <>
                        <div className="rn-entry-grid">
                            {showResults.entries.map(entry => <EntryCard key={entry.id} entry={entry} homeTo={homeTo} />)}
                        </div>
                        {showResults.hasMore && !error && (
                            <div className="rn-load-more-wrap">
                                <button type="button" className="rn-secondary-btn rn-load-more" disabled={pending !== null}
                                        onClick={() => void load(showResults)}>
                                    {pending === 'more' ? '불러오는 중…' : <>더 보기 <span>최대 {ENTRY_PAGE_SIZE}건</span></>}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </section>
        </div>
    );
}

function EntryCard({ entry, homeTo }: { entry: RepairEntry; homeTo: string }) {
    const category = ENTRY_CATEGORIES.find(item => item.id === entry.category);
    const isQuestion = entry.entry_kind === 'question';
    const summary = entry.inspection_steps.trim().split(/\r?\n/, 1)[0];
    return (
        <Link to={'/entry/' + entry.id} state={{ homeTo }} className="rn-entry-card">
            <div className="rn-entry-context">
                <span className="rn-entry-product">{entry.product_family} · {entry.model_code || '제품군 공통'}</span>
                <span className="rn-entry-category">{category?.label ?? '수리 정보'}</span>
                {(isQuestion || entry.accepted_answer_id) && (
                    <span className={isQuestion ? 'rn-entry-status' : 'rn-entry-status resolved'}>{isQuestion ? '미해결' : '질문에서 해결'}</span>
                )}
            </div>
            <h3>{entry.title}</h3>
            {entry.symptoms && entry.symptoms !== entry.title && <p className="rn-card-symptom">{entry.symptoms}</p>}
            {!isQuestion && summary && <p className="rn-case-summary"><strong>점검·조치</strong> {summary}</p>}
            <div className="rn-card-footer">
                <span>{entry.author_name ?? '회원'}</span>
                <span className="rn-separator" aria-hidden="true">·</span>
                <time dateTime={entry.created_at}>{dateLabel(entry.created_at)}</time>
                {entry.photo_paths.length > 0 && (
                    <span className="rn-card-photo" aria-label={`사진 ${entry.photo_paths.length}장`}>
                        <Icon name="image" size={14} /> {entry.photo_paths.length}
                    </span>
                )}
            </div>
            {entry.tags?.length > 0 && (
                <div className="rn-tag-row">
                    {entry.tags.slice(0, 3).map(tag => <span key={tag}>#{tag}</span>)}
                </div>
            )}
        </Link>
    );
}
