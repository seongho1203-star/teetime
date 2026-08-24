import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fromKstInput } from '../lib/format';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { Switch } from '../components/Switch';
import './Polls.css';

/** 투표 만들기. 회원 누구나. */
export function PollEdit() {
    const { session } = useAuth();
    const nav = useNavigate();
    const toast = useToast();

    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [options, setOptions] = useState(['', '']);
    const [multi, setMulti] = useState(false);
    const [anonymous, setAnonymous] = useState(false);
    const [closesAt, setClosesAt] = useState('');
    const [saving, setSaving] = useState(false);

    const setOption = (i: number, v: string) =>
        setOptions(prev => prev.map((o, j) => (j === i ? v : o)));

    const addOption = () => setOptions(prev => [...prev, '']);
    const removeOption = (i: number) =>
        setOptions(prev => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)));

    const save = async () => {
        const t = title.trim();
        const labels = options.map(o => o.trim()).filter(Boolean);
        if (!t) { toast('제목을 적어 주세요.', 'error'); return; }
        if (labels.length < 2) { toast('항목을 두 개 이상 적어 주세요.', 'error'); return; }
        if (new Set(labels).size !== labels.length) {
            toast('같은 항목이 두 번 있습니다.', 'error'); return;
        }

        setSaving(true);
        const { data, error } = await supabase.from('polls').insert({
            title: t,
            body: body.trim(),
            multi,
            anonymous,
            closes_at: fromKstInput(closesAt),
            created_by: session!.user.id,
        }).select('id').single();

        if (error || !data) {
            setSaving(false);
            toast(readableError(error), 'error');
            return;
        }

        const { error: optErr } = await supabase.from('poll_options').insert(
            labels.map((label, sort) => ({ poll_id: (data as { id: string }).id, label, sort }))
        );
        setSaving(false);

        if (optErr) {
            // 항목이 없는 투표는 쓸모가 없다. 껍데기를 남기지 않고 되돌린다.
            await supabase.from('polls').delete().eq('id', (data as { id: string }).id);
            toast(readableError(optErr), 'error');
            return;
        }

        toast('투표를 올렸습니다.', 'ok');
        nav('/polls', { replace: true });
    };

    return (
        <div className="page">
            <TopBar title="투표 만들기" fallback="/polls" />

            <div className="card">
                <div className="field">
                    <label htmlFor="v-title">무엇을 물어볼까요?</label>
                    <input id="v-title" className="input" value={title}
                           onChange={e => setTitle(e.target.value)}
                           placeholder="예) 9월 정기 라운드 날짜" maxLength={80} />
                </div>
                <div className="field">
                    <label htmlFor="v-body">설명 <span className="faint">(선택)</span></label>
                    <textarea id="v-body" className="textarea" value={body}
                              onChange={e => setBody(e.target.value)}
                              style={{ minHeight: 70 }} maxLength={500} />
                </div>
            </div>

            <div className="card">
                <div className="section-title">항목</div>
                {options.map((o, i) => (
                    <div className="option-row" key={i}>
                        <input
                            className="input grow" value={o}
                            onChange={e => setOption(i, e.target.value)}
                            placeholder={`항목 ${i + 1}`} maxLength={60}
                            aria-label={`항목 ${i + 1}`}
                        />
                        <button
                            className="btn ghost sm"
                            onClick={() => removeOption(i)}
                            disabled={options.length <= 2}
                            aria-label={`항목 ${i + 1} 지우기`}
                        >✕</button>
                    </div>
                ))}
                <button className="btn ghost block sm" onClick={addOption}>+ 항목 추가</button>
            </div>

            <div className="card">
                <div className="switch-row">
                    <div className="grow">
                        <div className="switch-label">복수 선택</div>
                        <div className="switch-desc">되는 날짜를 여러 개 고르게 할 때</div>
                    </div>
                    <Switch label="복수 선택" on={multi} onChange={setMulti} />
                </div>
                <div className="switch-row">
                    <div className="grow">
                        <div className="switch-label">익명</div>
                        <div className="switch-desc">누가 무엇을 골랐는지 숨깁니다</div>
                    </div>
                    <Switch label="익명" on={anonymous} onChange={setAnonymous} />
                </div>
                <div className="field" style={{ marginTop: 'var(--gap-xs)' }}>
                    <label htmlFor="v-close">마감 시각 <span className="faint">(선택)</span></label>
                    <input id="v-close" className="input" type="datetime-local"
                           value={closesAt} onChange={e => setClosesAt(e.target.value)} />
                </div>
            </div>

            <div className="form-actions">
                <button className="btn primary block" onClick={save} disabled={saving}>
                    {saving ? '올리는 중…' : '투표 올리기'}
                </button>
            </div>
        </div>
    );
}
