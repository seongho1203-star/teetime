import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import { toKstInput, fromKstInput } from '../lib/format';
import type { Round } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';

/** 라운드 모집 열기 / 수정. 총무만 들어온다. */
export function RoundEdit() {
    const { id } = useParams<{ id: string }>();
    const editing = Boolean(id);
    const { isAdmin, session } = useAuth();
    const nav = useNavigate();
    const toast = useToast();

    const { data, loading } = useAsync<Round | null>(async () => {
        if (!id) return null;
        return unwrap(await supabase.from('rounds').select('*').eq('id', id).maybeSingle());
    }, [id]);

    if (!isAdmin) {
        return (
            <div className="page">
                <TopBar title="라운드" fallback="/rounds" />
                <div className="notice danger">총무만 열 수 있습니다.</div>
            </div>
        );
    }
    if (editing && loading) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }

    return (
        <Form
            key={data?.id ?? 'new'}
            round={data}
            onDone={rid => nav(`/rounds/${rid}`, { replace: true })}
            authorId={session!.user.id}
            toast={toast}
        />
    );
}

function Form({
    round, onDone, authorId, toast,
}: {
    round: Round | null;
    onDone: (id: string) => void;
    authorId: string;
    toast: (t: string, k?: 'ok' | 'error' | 'info') => void;
}) {
    const [course, setCourse] = useState(round?.course ?? '');
    const [title, setTitle] = useState(round?.title ?? '');
    const [teeAt, setTeeAt] = useState(toKstInput(round?.tee_at));
    const [capacity, setCapacity] = useState(String(round?.capacity ?? 4));
    const [fee, setFee] = useState(String(round?.fee ?? 0));
    const [note, setNote] = useState(round?.note ?? '');
    const [opensAt, setOpensAt] = useState(toKstInput(round?.opens_at));
    const [saving, setSaving] = useState(false);

    const save = async () => {
        const tee = fromKstInput(teeAt);
        if (!tee) { toast('티오프 시각을 골라 주세요.', 'error'); return; }
        if (!course.trim()) { toast('골프장 이름을 적어 주세요.', 'error'); return; }

        const cap = parseInt(capacity, 10);
        if (!cap || cap < 1) { toast('정원은 1명 이상이어야 합니다.', 'error'); return; }

        const payload = {
            course: course.trim(),
            title: title.trim(),
            tee_at: tee,
            capacity: cap,
            fee: parseInt(fee, 10) || 0,
            note: note.trim(),
            opens_at: fromKstInput(opensAt),
        };

        setSaving(true);
        const res = round
            ? await supabase.from('rounds').update(payload).eq('id', round.id).select('id').single()
            : await supabase.from('rounds').insert({ ...payload, created_by: authorId })
                            .select('id').single();
        setSaving(false);

        if (res.error) { toast(readableError(res.error), 'error'); return; }
        toast(round ? '수정했습니다.' : '모집을 열었습니다.', 'ok');
        onDone((res.data as { id: string }).id);
    };

    return (
        <div className="page">
            <TopBar title={round ? '라운드 수정' : '모집 열기'} fallback="/rounds" />

            <div className="card">
                <div className="field">
                    <label htmlFor="f-course">골프장</label>
                    <input id="f-course" className="input" value={course}
                           onChange={e => setCourse(e.target.value)}
                           placeholder="예) 무등산CC" maxLength={40} />
                </div>

                <div className="field">
                    <label htmlFor="f-title">한 줄 설명 <span className="faint">(선택)</span></label>
                    <input id="f-title" className="input" value={title}
                           onChange={e => setTitle(e.target.value)}
                           placeholder="예) 8월 정기 라운드" maxLength={60} />
                </div>

                <div className="field">
                    <label htmlFor="f-tee">티오프 (한국 시각)</label>
                    <input id="f-tee" className="input" type="datetime-local"
                           value={teeAt} onChange={e => setTeeAt(e.target.value)} />
                </div>

                <div className="row" style={{ gap: 'var(--gap-sm)', alignItems: 'flex-end' }}>
                    <div className="field grow">
                        <label htmlFor="f-cap">정원</label>
                        <input id="f-cap" className="input" type="number" min={1} max={100}
                               inputMode="numeric" value={capacity}
                               onChange={e => setCapacity(e.target.value)} />
                    </div>
                    <div className="field grow">
                        <label htmlFor="f-fee">1인 참가비</label>
                        <input id="f-fee" className="input" type="number" min={0} step={1000}
                               inputMode="numeric" value={fee}
                               onChange={e => setFee(e.target.value)} />
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="field">
                    <label htmlFor="f-opens">
                        신청 시작 <span className="faint">(선택)</span>
                    </label>
                    <input id="f-opens" className="input" type="datetime-local"
                           value={opensAt} onChange={e => setOpensAt(e.target.value)} />
                    <p className="xs faint" style={{ lineHeight: 1.6 }}>
                        비워 두면 지금부터 바로 받습니다. 시각을 정해 두면 그때까지
                        신청 버튼이 잠기므로, 인기 있는 라운드를 같은 출발선에서 받을 수 있습니다.
                    </p>
                </div>

                <div className="field">
                    <label htmlFor="f-note">안내 <span className="faint">(선택)</span></label>
                    <textarea id="f-note" className="textarea" value={note}
                              onChange={e => setNote(e.target.value)}
                              placeholder={'모이는 곳, 카풀, 준비물 같은 것\n예) 6시 30분 동광주 IC 앞 집합'}
                              maxLength={1000} />
                </div>
            </div>

            <button className="btn primary block" onClick={save} disabled={saving}>
                {saving ? '저장 중…' : round ? '수정 저장' : '모집 열기'}
            </button>
        </div>
    );
}
