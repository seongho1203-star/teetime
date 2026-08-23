import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import { toKstInput, fromKstInput } from '../lib/format';
import { courseGeo, searchCourses } from '../lib/courses';
import type { Round } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';

/** 라운드 모집 열기 / 수정. 회원 누구나 열고, 고치는 것은 연 사람과 운영진이다. */
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

    if (editing && loading) {
        return <div className="page center-fill"><div className="spinner" /></div>;
    }

    // 모집은 회원 누구나 연다. 다만 남이 올린 것을 고치지는 못한다.
    if (editing && data && data.created_by !== session!.user.id && !isAdmin) {
        return (
            <div className="page">
                <TopBar title="라운드" fallback="/rounds" />
                <div className="notice danger">올린 사람만 고칠 수 있습니다.</div>
            </div>
        );
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
    const [caddie, setCaddie] = useState<Round['caddie']>(round?.caddie ?? null);
    const [cart, setCart] = useState<Round['cart']>(round?.cart ?? null);
    const [opensAt, setOpensAt] = useState(toKstInput(round?.opens_at));
    const [saving, setSaving] = useState(false);
    const [picking, setPicking] = useState(false);

    // 딱 맞는 이름을 이미 골랐으면 목록을 접는다 — 고르고 나서도
    // 남아 있으면 다음 칸을 가린다.
    const hits = courseGeo(course)?.name === course.trim()
        ? [] : searchCourses(course);

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
            caddie,
            cart,
            opens_at: fromKstInput(opensAt),
            // **좌표는 이름에서 찾아 함께 넣는다.** 사람에게 위도·경도를
            // 치라고 할 수는 없다. 목록에 없는 곳이면 비워 두고, 그때는
            // 날씨칸만 빠진다.
            lat: courseGeo(course)?.lat ?? null,
            lon: courseGeo(course)?.lon ?? null,
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
                           onChange={e => { setCourse(e.target.value); setPicking(true); }}
                           onFocus={() => setPicking(true)}
                           placeholder="예) 무등산CC" maxLength={40}
                           autoComplete="off" />
                    {/* 목록에서 고르면 좌표가 함께 붙어 날씨가 뜬다.
                        목록에 없는 곳도 그냥 쳐 넣으면 되고, 그때는 날씨만 빠진다. */}
                    {picking && hits.length > 0 && (
                        <div className="course-hits">
                            {hits.map(c => (
                                <button key={c.name} type="button" className="course-hit"
                                        onClick={() => { setCourse(c.name); setPicking(false); }}>
                                    {c.name}
                                </button>
                            ))}
                        </div>
                    )}
                    <span className="xs faint">
                        {courseGeo(course)
                            ? '날씨가 함께 표시됩니다'
                            : course.trim()
                                ? '목록에 없는 곳입니다 — 날씨는 표시되지 않습니다'
                                : '치면 목록에서 찾아 줍니다'}
                    </span>
                </div>

                {/* **한 줄에 하나만 켜진다.** 캐디와 노캐디를 함께 켤 수는
                    없으니, 같은 줄에서 하나를 누르면 다른 하나가 꺼진다.
                    누른 것을 다시 누르면 '안 정함'으로 돌아간다 —
                    예전 라운드처럼 비워 둘 수도 있어야 한다. */}
                <div className="field">
                    <label>라운드 조건 <span className="faint">(선택)</span></label>
                    <div className="opt-row">
                        <Opt on={caddie === 'caddie'} onClick={() =>
                            setCaddie(caddie === 'caddie' ? null : 'caddie')}>캐디</Opt>
                        <Opt on={caddie === 'none'} onClick={() =>
                            setCaddie(caddie === 'none' ? null : 'none')}>노캐디</Opt>
                    </div>
                    <div className="opt-row">
                        <Opt on={cart === 'included'} onClick={() =>
                            setCart(cart === 'included' ? null : 'included')}>카포</Opt>
                        <Opt on={cart === 'excluded'} onClick={() =>
                            setCart(cart === 'excluded' ? null : 'excluded')}>카트 미포함</Opt>
                    </div>
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

/** 체크칸 하나. 켜지면 초록 체크가 들어온다. */
function Opt({ on, onClick, children }: {
    on: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button type="button" className={`opt${on ? ' on' : ''}`}
                onClick={onClick} aria-pressed={on}>
            <span className="opt-box" aria-hidden="true">{on ? '✓' : ''}</span>
            {children}
        </button>
    );
}
