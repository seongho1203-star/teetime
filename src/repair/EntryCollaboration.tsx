import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import {
    acceptAnswer, addAnswer, addApplication, editApplication, listAnswers, listApplications,
    removeAnswer, removeApplication, repairDb,
} from './data';
import type { RepairAnswer, RepairApplication, RepairEntry } from './types';
import { dateLabel, Icon, messageOf } from './ui';

export function AnswerThread({ entry, userId, onAccepted }: {
    entry: RepairEntry;
    userId: string;
    onAccepted: (entry: RepairEntry) => void;
}) {
    const [params] = useSearchParams();
    const replyId = params.get('answer');
    const [answers, setAnswers] = useState<RepairAnswer[] | null>(null);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState('');
    const [loadError, setLoadError] = useState(false);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const toast = useToast();
    const isQuestion = entry.entry_kind === 'question';
    const canAccept = isQuestion && entry.created_by === userId;

    useEffect(() => {
        let active = true;
        setLoadError(false);
        void listAnswers(entry.id).then(rows => {
            if (active) setAnswers(rows);
        }).catch(() => {
            if (active) setLoadError(true);
        });
        return () => { active = false; };
    }, [entry.id, revision]);

    useEffect(() => {
        const channel = repairDb.channel('repair-answers-' + entry.id)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'repair_entry_answers', filter: 'entry_id=eq.' + entry.id,
            }, () => setRevision(value => value + 1))
            .subscribe();
        return () => { void repairDb.removeChannel(channel); };
    }, [entry.id]);

    useEffect(() => {
        if (replyId && answers?.some(answer => answer.id === replyId)) {
            document.getElementById('rn-answer-' + replyId)?.scrollIntoView({ block: 'center' });
        }
    }, [answers, replyId]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (busy) return;
        const body = draft.trim();
        if ([...body].length < 2) {
            setError('답변을 두 글자 이상 적어 주세요.');
            return;
        }
        setBusy('answer');
        setError('');
        try {
            await addAnswer(entry.id, userId, body);
            setDraft('');
            setRevision(value => value + 1);
            toast('답변을 등록했습니다.', 'ok');
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setBusy('');
        }
    };

    const choose = async (answer: RepairAnswer) => {
        if (busy || !window.confirm('이 답변을 해결 방법으로 남기고 질문을 수리 사례로 바꿀까요?')) return;
        setBusy(answer.id);
        setError('');
        try {
            const updated = await acceptAnswer(entry.id, answer.id);
            onAccepted(updated);
            toast('수리 사례로 등록했습니다. 이제 수리 사례 검색에서 찾을 수 있어요.', 'ok');
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setBusy('');
        }
    };

    const discard = async (answerId: string) => {
        if (busy || !window.confirm('이 답변을 삭제할까요?')) return;
        setBusy(answerId);
        setError('');
        try {
            await removeAnswer(answerId);
            setAnswers(current => current?.filter(answer => answer.id !== answerId) ?? null);
            setRevision(value => value + 1);
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setBusy('');
        }
    };

    const thread = (
        <>
            {loadError && <p className="rn-inline-error" role="alert">
                답변을 불러오지 못했습니다. <button type="button" onClick={() => setRevision(value => value + 1)}>다시 시도</button>
            </p>}
            {!answers && !loadError && <p className="rn-form-note" role="status">답변 불러오는 중…</p>}
            {answers?.length === 0 && <p className="rn-form-note">아직 답변이 없습니다.</p>}
            {canAccept && Boolean(answers?.length) && <p className="rn-form-note">해결에 도움이 된 답변을 채택하면 수리 사례로 저장됩니다.</p>}
            {!!answers?.length && (
                <div className="rn-thread-list">
                    {answers.map(answer => (
                        <article className={'rn-thread-item' + (replyId === answer.id ? ' selected' : '')}
                                 id={'rn-answer-' + answer.id} key={answer.id}>
                            <div className="rn-thread-meta">
                                <strong>{answer.author_name ?? '회원'}</strong>
                                <time dateTime={answer.created_at}>{dateLabel(answer.created_at)}</time>
                                {entry.accepted_answer_id === answer.id && <span className="rn-entry-status resolved">채택한 답변</span>}
                            </div>
                            <p>{answer.body}</p>
                            {isQuestion && (canAccept || answer.author_id === userId) && (
                                <div className="rn-thread-actions">
                                    {canAccept && (
                                        <button type="button" className="rn-secondary-btn" disabled={Boolean(busy)}
                                                onClick={() => void choose(answer)}>답변 채택</button>
                                    )}
                                    {answer.author_id === userId && (
                                        <button type="button" className="rn-text-btn" disabled={Boolean(busy)}
                                                onClick={() => void discard(answer.id)}>답변 삭제</button>
                                    )}
                                </div>
                            )}
                        </article>
                    ))}
                </div>
            )}
            {isQuestion && (
                <form className="rn-thread-form" onSubmit={submit}>
                    <label className="rn-field">
                        <span>답변 남기기</span>
                        <textarea value={draft} onChange={e => setDraft(e.target.value)}
                                  placeholder="확인해 볼 항목이나 해결한 방법을 적어 주세요." required rows={3}
                                  maxLength={8000} disabled={Boolean(busy)} />
                    </label>
                    <div className="rn-thread-actions">
                        <button className="rn-primary-btn" disabled={Boolean(busy)}>{busy === 'answer' ? '등록 중…' : '답변 등록'}</button>
                    </div>
                </form>
            )}
            {error && <p className="rn-inline-error" role="alert">{error}</p>}
        </>
    );

    if (!isQuestion) {
        return (
            <details className="rn-collaboration rn-entry-options" open={Boolean(replyId)}>
                <summary>질문에 달린 답변 {answers ? '(' + answers.length + '건)' : ''}</summary>
                <div className="rn-entry-options-body">{thread}</div>
            </details>
        );
    }
    return (
        <section className="rn-collaboration">
            <h2>팀원 답변 {answers ? '(' + answers.length + '건)' : ''}</h2>
            {thread}
        </section>
    );
}

export function ApplicationPanel({ entry, userId }: { entry: RepairEntry; userId: string }) {
    const [items, setItems] = useState<RepairApplication[] | null>(null);
    const [editing, setEditing] = useState<RepairApplication | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const [expanded, setExpanded] = useState(false);
    const mine = items?.find(item => item.user_id === userId);
    const examples = items?.filter(item => item.model_code || item.note) ?? [];

    useEffect(() => {
        let active = true;
        setError('');
        void listApplications(entry.id).then(rows => {
            if (active) setItems(rows);
        }).catch(() => {
            if (active) setError('해결 경험을 불러오지 못했습니다.');
        });
        return () => { active = false; };
    }, [entry.id, revision]);

    const record = async () => {
        if (busy || !items || mine) return;
        setBusy(true);
        setError('');
        try {
            const saved = await addApplication(entry.id, userId);
            setItems(current => [saved, ...(current ?? [])]);
        } catch (reason) {
            if ((reason as { code?: string } | null)?.code === '23505') setRevision(value => value + 1);
            else setError(messageOf(reason));
        } finally {
            setBusy(false);
        }
    };

    const edit = async (event: FormEvent) => {
        event.preventDefault();
        if (!editing || busy) return;
        setBusy(true);
        setError('');
        try {
            const saved = await editApplication(entry.id, {
                ...editing, model_code: editing.model_code.trim().toUpperCase(), note: editing.note.trim(),
            });
            setItems(current => current?.map(item => item.user_id === userId ? saved : item) ?? []);
            setEditing(null);
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setBusy(false);
        }
    };

    const undo = async () => {
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            await removeApplication(entry.id, userId);
            setItems(current => current?.filter(item => item.user_id !== userId) ?? []);
            setEditing(null);
        } catch (reason) {
            setError(messageOf(reason));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="rn-collaboration rn-application-panel">
            <div className="rn-application-heading">
                <h2>동료의 해결 경험</h2>
                {items && <span className="rn-entry-status resolved" aria-live="polite">{items.length}명 해결</span>}
            </div>
            {!items && !error && <p className="rn-form-note" role="status">해결 경험 불러오는 중…</p>}
            {items && entry.created_by !== userId && !mine && (
                <button type="button" className="rn-secondary-btn" disabled={busy} onClick={() => void record()}>
                    <Icon name="check" size={17} /> {busy ? '저장 중…' : '이 방법으로 해결했어요'}
                </button>
            )}
            {mine && !editing && (
                <div className="rn-application-own">
                    <span><Icon name="check" size={16} /> 내 해결 경험을 기록했어요</span>
                    <div className="rn-thread-actions">
                        <button type="button" className="rn-secondary-btn" disabled={busy} onClick={() => setEditing(mine)}>
                            {mine.model_code || mine.note ? '모델·메모 수정' : '모델·메모 추가'}
                        </button>
                        <button type="button" className="rn-text-btn" disabled={busy} onClick={() => void undo()}>기록 취소</button>
                    </div>
                </div>
            )}
            {editing && (
                <form className="rn-thread-form" onSubmit={edit}>
                    <label className="rn-field">
                        <span>적용 모델 <small>(선택)</small></span>
                        <input value={editing.model_code} onChange={e => setEditing({ ...editing, model_code: e.target.value })}
                               maxLength={50} placeholder="해결에 적용한 모델명" disabled={busy} />
                    </label>
                    <label className="rn-field">
                        <span>달랐던 점 <small>(선택)</small></span>
                        <textarea value={editing.note} onChange={e => setEditing({ ...editing, note: e.target.value })}
                                  rows={2} maxLength={300} placeholder="적용 조건이나 다른 조치를 적어 주세요." disabled={busy} />
                    </label>
                    <div className="rn-thread-actions">
                        <button type="button" className="rn-secondary-btn" disabled={busy} onClick={() => setEditing(null)}>닫기</button>
                        <button type="submit" className="rn-primary-btn" disabled={busy}>{busy ? '저장 중…' : '메모 저장'}</button>
                    </div>
                </form>
            )}
            {!!examples.length && (
                <div className="rn-thread-list">
                    {examples.slice(0, expanded ? examples.length : 3).map(item => (
                        <div className="rn-thread-item" key={item.user_id}>
                            {item.model_code && <strong>{item.model_code}</strong>}
                            {item.note && <p>{item.note}</p>}
                        </div>
                    ))}
                    {examples.length > 3 && (
                        <button className="rn-text-btn" type="button" onClick={() => setExpanded(value => !value)}>
                            {expanded ? '접기' : '해결 경험 더 보기'}
                        </button>
                    )}
                </div>
            )}
            {error && <p className="rn-inline-error" role="alert">
                {error} {!items && <button type="button" onClick={() => setRevision(value => value + 1)}>다시 시도</button>}
            </p>}
        </section>
    );
}
