import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap } from '../lib/db';
import { useAuth } from '../lib/auth';
import { toKstInput, fromKstInput } from '../lib/format';
import { courseGeo, searchCourses } from '../lib/courses';
import { FEE_LABEL, KIND_ICON, PLACE_LABEL, TEE_LABEL, roundKind, type Round, type RoundKind } from '../lib/types';
import { TopBar } from '../components/TopBar';
import { Hinted } from '../components/Hinted';
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
    const [kind, setKind] = useState<RoundKind>(round ? roundKind(round) : 'field');
    const [course, setCourse] = useState(round?.course ?? '');
    const [teeAt, setTeeAt] = useState(toKstInput(round?.tee_at));
    const [capacity, setCapacity] = useState(String(round?.capacity ?? 4));
    const [fee, setFee] = useState(String(round?.fee ?? 0));
    const [note, setNote] = useState(round?.note ?? '');
    const [caddie, setCaddie] = useState<Round['caddie']>(round?.caddie ?? null);
    const [cart, setCart] = useState<Round['cart']>(round?.cart ?? null);
    const [saving, setSaving] = useState(false);
    const [picking, setPicking] = useState(false);

    const screen = kind === 'screen';

    // 딱 맞는 이름을 이미 골랐으면 목록을 접는다 — 고르고 나서도
    // 남아 있으면 다음 칸을 가린다.
    // **스크린은 찾아 주지 않는다.** `courses.ts`는 필드 골프장 목록이고,
    // 스크린골프방은 만들 때 일부러 걸러 낸 것들이라 쳐도 안 나온다.
    const hits = screen || courseGeo(course)?.name === course.trim()
        ? [] : searchCourses(course);

    const save = async () => {
        const tee = fromKstInput(teeAt);
        if (!tee) { toast(`${TEE_LABEL[kind]} 시각을 골라 주세요.`, 'error'); return; }
        if (!course.trim()) { toast(`${PLACE_LABEL[kind]} 이름을 적어 주세요.`, 'error'); return; }

        const cap = parseInt(capacity, 10);
        if (!cap || cap < 1) { toast('정원은 1명 이상이어야 합니다.', 'error'); return; }

        /* **`title`과 `opens_at`은 보내지 않는다.** 적는 칸을 없앴기
           때문이다 — `title`은 `안내`와 하는 일이 겹쳤고, `신청 시작`은
           우리 모임 규모에 쓸 일이 없었다. 칸은 DB에 그대로 둔다. */
        const payload = {
            kind,
            course: course.trim(),
            tee_at: tee,
            capacity: cap,
            fee: parseInt(fee, 10) || 0,
            note: note.trim(),
            // 스크린에는 캐디도 카트도 없다. 필드로 열었다가 스크린으로
            // 바꾼 경우까지 생각해 **저장할 때 지운다** — 화면에서 감추기만
            // 하면 값이 남아 상세에 조건이 그대로 뜬다.
            caddie: screen ? null : caddie,
            cart:   screen ? null : cart,
            // **좌표는 이름에서 찾아 함께 넣는다.** 사람에게 위도·경도를
            // 치라고 할 수는 없다. 목록에 없는 곳이면 비워 두고, 그때는
            // 날씨칸만 빠진다. 스크린은 실내라 아예 안 붙인다.
            lat: screen ? null : courseGeo(course)?.lat ?? null,
            lon: screen ? null : courseGeo(course)?.lon ?? null,
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
                {/* **맨 위에서 종류부터 고른다.** 아래 칸들의 말과 있고 없음이
                    여기서 갈리기 때문이다 — 골프장/매장, 티오프/시작,
                    그리고 캐디·카트 줄이 통째로 붙었다 떨어진다.
                    조건 체크칸과 달리 **비울 수 없다.** 둘 중 하나다. */}
                <div className="field">
                    <label>종류</label>
                    <div className="opt-row">
                        <Opt on={!screen} onClick={() => setKind('field')}>
                            {KIND_ICON.field} 필드
                        </Opt>
                        <Opt on={screen} onClick={() => setKind('screen')}>
                            {KIND_ICON.screen} 스크린
                        </Opt>
                    </div>
                </div>

                <div className="field">
                    <label htmlFor="f-course">{PLACE_LABEL[kind]}</label>
                    {/* **안내 글씨는 `placeholder`가 아니라 `Hinted`로 그린다.**
                        한글을 치는 칸이라 iOS가 조합 중인 글자를 '내용 없음'으로
                        봐서 **첫 글자에 한 번 번쩍인다**(사용자 제보). */}
                    <Hinted hint={screen ? '예) 신용DS' : '예) 무등산CC'} empty={!course}>
                        <input id="f-course" className="input" value={course}
                               onChange={e => { setCourse(e.target.value); setPicking(true); }}
                               onFocus={() => setPicking(true)}
                               maxLength={40} autoComplete="off" />
                    </Hinted>
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
                    {/* **비어 있을 때는 이 줄이 없다.** `치면 목록에서 찾아
                        줍니다`는 자리 안내인데 `예) 무등산CC`가 이미 그 말을
                        하고 있고, 그 한 줄(20px) 때문에 좁은 화면에서 저장
                        단추가 밀려 났다. 무언가 알려 줄 것이 생겼을 때만 뜬다. */}
                    {(screen || course.trim()) && (
                        <span className="xs faint">
                            {screen
                                ? '실내라 날씨는 표시되지 않습니다'
                                : courseGeo(course)
                                    ? '날씨가 함께 표시됩니다'
                                    : '목록에 없는 곳입니다 — 날씨는 표시되지 않습니다'}
                        </span>
                    )}
                </div>

                {/* **한 줄에 하나만 켜진다.** 캐디와 노캐디를 함께 켤 수는
                    없으니, 같은 줄에서 하나를 누르면 다른 하나가 꺼진다.
                    누른 것을 다시 누르면 '안 정함'으로 돌아간다 —
                    예전 라운드처럼 비워 둘 수도 있어야 한다.
                    스크린에는 캐디도 카트도 없으므로 이 칸이 통째로 빠진다. */}
                {!screen && (
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
                                setCart(cart === 'included' ? null : 'included')}>카트 포함</Opt>
                            <Opt on={cart === 'excluded'} onClick={() =>
                                setCart(cart === 'excluded' ? null : 'excluded')}>카트 미포함</Opt>
                        </div>
                    </div>
                )}

                <div className="field">
                    <label htmlFor="f-tee">{TEE_LABEL[kind]} (한국 시각)</label>
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
                        <label htmlFor="f-fee">1인 {FEE_LABEL[kind]}</label>
                        <input id="f-fee" className="input" type="number" min={0} step={1000}
                               inputMode="numeric" value={fee}
                               onChange={e => setFee(e.target.value)} />
                    </div>
                </div>

                {/* `신청 시작`을 없애면서 남은 `안내`를 이 카드로 합쳤다 —
                    칸 하나만 든 카드는 여백만 차지한다. */}
                <div className="field">
                    <label htmlFor="f-note">전달 내용 <span className="faint">(선택)</span></label>
                    <Hinted empty={!note}
                            hint={screen
                                ? '모이는 곳, 게임 방식, 내기 같은 것'
                                : '모이는 곳, 준비물 같은 것'}>
                        <textarea id="f-note" className="textarea" value={note}
                                  onChange={e => setNote(e.target.value)}
                                  maxLength={1000} />
                    </Hinted>
                </div>
            </div>

            <div className="form-actions">
                <button className="btn primary block" onClick={save} disabled={saving}>
                    {saving ? '저장 중…' : round ? '수정 저장' : '모집 열기'}
                </button>
            </div>
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
