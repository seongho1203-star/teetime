import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDate, formatTime, kstDate } from '../lib/format';
import type { Message, Profile, Room } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
import { shrinkImage } from '../lib/image';
import { markSeen } from '../lib/unread';
import './Chat.css';

/** 한 번에 불러오는 지난 대화 수. 위로 올리면 더 받는다. */
const PAGE = 50;

interface Loaded { room: Room | null; people: Profile[]; }

export function Chat() {
    const { session } = useAuth();
    const me = session!.user.id;
    const toast = useToast();

    const [messages, setMessages] = useState<Message[]>([]);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const listRef = useRef<HTMLDivElement>(null);
    // 맨 아래를 보고 있을 때만 새 글에 따라 내려간다. 지난 대화를 읽는
    // 도중에 남이 글을 쓰면 화면이 튀어서는 안 된다.
    const atBottom = useRef(true);

    const { data, loading, error } = useAsync<Loaded>(async () => {
        const [room, people] = await Promise.all([
            supabase.from('rooms').select('*').is('round_id', null)
                    .order('created_at').limit(1).maybeSingle(),
            fetchProfiles(),
        ]);
        return { room: unwrap(room), people };
    }, []);

    const roomId = data?.room?.id;
    const names = byId(data?.people ?? []);

    // 첫 묶음을 불러온다. 최근 것부터 받아 뒤집는다.
    useEffect(() => {
        if (!roomId) return;
        let alive = true;
        (async () => {
            const { data: rows, error: err } = await supabase
                .from('messages').select('*').eq('room_id', roomId)
                .order('created_at', { ascending: false }).limit(PAGE);
            if (!alive) return;
            if (err) { toast(readableError(err), 'error'); return; }
            const list = (rows ?? []).slice().reverse();
            setMessages(list);
            setHasMore((rows ?? []).length === PAGE);
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId]);

    // 새 글은 통째로 다시 불러오지 않고 **들어온 행만 덧붙인다** —
    // 대화는 지난 것이 바뀌지 않으므로 이 방식이 맞고, 훨씬 가볍다.
    useEffect(() => {
        if (!roomId) return;
        const channel = supabase
            .channel(`chat:${roomId}`)
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
                payload => {
                    const row = payload.new as Message;
                    setMessages(prev =>
                        // 내가 보낸 글은 이미 넣어 두었다. 두 번 그리지 않는다.
                        prev.some(m => m.id === row.id) ? prev : [...prev, row]);
                })
            .on('postgres_changes',
                { event: 'DELETE', schema: 'public', table: 'messages' },
                payload => {
                    const gone = payload.old as { id?: string };
                    if (gone.id) setMessages(prev => prev.filter(m => m.id !== gone.id));
                })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [roomId]);

    /** 맨 아래를 보고 있었으면 다시 맨 아래로 붙인다. */
    const pinBottom = useCallback(() => {
        const el = listRef.current;
        if (el && atBottom.current) el.scrollTop = el.scrollHeight;
    }, []);

    // 그리기가 끝난 프레임에 해야 높이가 확정된다.
    useLayoutEffect(() => { pinBottom(); }, [messages, pinBottom]);

    // 이 화면을 보고 있으면 안 읽음이 쌓이지 않는다. 새 글이 들어올 때마다
    // 다시 남겨 두어야 탭바의 빨간 숫자가 곧바로 사라진다.
    useEffect(() => { markSeen('chat', me); }, [messages, me]);

    /**
     * 키보드가 올라온 만큼 화면을 줄인다.
     *
     * 이 화면만 `100dvh`로 제 안에서 스크롤하는데, `dvh`는 브라우저 막대는
     * 세어도 **키보드는 세지 않는다.** 그래서 키보드가 뜨면 iOS가 페이지를
     * 통째로 밀어 올리고, 바닥에 붙어 있던 탭바와 입력칸이 키보드 위에
     * 겹겹이 쌓여 **대화가 한 줄도 안 보였다.**
     *
     * `visualViewport`가 실제로 보이는 높이를 알려 주므로 그만큼을 `--kb`에
     * 담아 화면 높이에서 뺀다. 겹친 동안에는 탭바를 감춰(`kb-open`) 자리를
     * 되찾고, iOS가 밀어 올린 페이지는 되돌려 놓는다.
     * 키보드가 아닌 잔잔한 높이 변화(주소 막대가 접히는 것 등)에 걸리지
     * 않도록 120px 넘게 가릴 때만 키보드로 친다.
     *
     * **입력칸을 누른 것 자체도 신호로 쓴다.** `visualViewport`가 언제
     * 알려 줄지는 기기마다 다르고, iOS는 키보드가 다 올라온 뒤에야
     * 알려 주기도 한다. 누르는 순간 탭바부터 감춰 두면 그 사이에도
     * 대화가 가려지지 않는다. 높이는 알려 줄 때 채워 넣는다.
     */
    const kbRef = useRef({ typing: false, hidden: 0 });

    const syncKeyboard = useCallback(() => {
        const vv = window.visualViewport;
        const hidden = vv
            ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
            : 0;
        const s = kbRef.current;
        s.hidden = hidden;

        const open = s.typing || hidden > 120;
        document.documentElement.style.setProperty('--kb', `${hidden > 120 ? hidden : 0}px`);
        document.body.classList.toggle('kb-open', open);

        if (open) {
            // iOS가 페이지를 밀어 올린 것을 되돌린다. 이걸 안 하면
            // 고정된 것들이 화면 밖으로 나간다.
            window.scrollTo(0, 0);
            const el = listRef.current;
            if (el && atBottom.current) el.scrollTop = el.scrollHeight;
        }
    }, []);

    useEffect(() => {
        const vv = window.visualViewport;
        syncKeyboard();
        vv?.addEventListener('resize', syncKeyboard);
        vv?.addEventListener('scroll', syncKeyboard);
        return () => {
            vv?.removeEventListener('resize', syncKeyboard);
            vv?.removeEventListener('scroll', syncKeyboard);
            document.documentElement.style.removeProperty('--kb');
            document.body.classList.remove('kb-open');
        };
    }, [syncKeyboard]);

    const onComposerFocus = () => {
        kbRef.current.typing = true;
        syncKeyboard();
        // 키보드가 올라오는 동안에도 높이가 여러 번 바뀐다.
        setTimeout(syncKeyboard, 120);
        setTimeout(syncKeyboard, 400);
    };

    const onComposerBlur = () => {
        kbRef.current.typing = false;
        syncKeyboard();
    };

    const onScroll = () => {
        const el = listRef.current;
        if (!el) return;
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };

    const loadMore = async () => {
        const el = listRef.current;
        if (!roomId || !messages.length || !el) return;
        setLoadingMore(true);
        const before = messages[0].created_at;
        const prevHeight = el.scrollHeight;

        const { data: rows } = await supabase
            .from('messages').select('*').eq('room_id', roomId)
            .lt('created_at', before)
            .order('created_at', { ascending: false }).limit(PAGE);

        setMessages(prev => [...(rows ?? []).slice().reverse(), ...prev]);
        setHasMore((rows ?? []).length === PAGE);
        setLoadingMore(false);

        // 위에 글이 붙은 만큼 스크롤을 내려 읽던 자리를 지킨다.
        requestAnimationFrame(() => {
            atBottom.current = false;
            el.scrollTop = el.scrollHeight - prevHeight;
        });
    };

    /** 글 한 줄(또는 사진 한 장)을 보낸다. 보내기와 사진 올리기가 같이 쓴다. */
    const push = async (body: string, imageUrl: string | null) => {
        if (!roomId) return false;
        const { data: row, error: err } = await supabase
            .from('messages')
            // **사진이 없으면 image_url을 아예 보내지 않는다.** DB에 그 칸을
            // 아직 안 만들었어도(스키마를 다시 안 돌렸어도) 글은 그대로
            // 오가게 하려는 것이다. 사진만 그때 실패한다.
            .insert({ room_id: roomId, user_id: me, body, ...(imageUrl ? { image_url: imageUrl } : {}) })
            .select('*').single();
        if (err) { toast(readableError(err), 'error'); return false; }

        setDraft('');
        atBottom.current = true;
        // 실시간 이벤트가 오기 전에 먼저 그린다. 내 글이 늦게 뜨면 답답하다.
        if (row) setMessages(prev =>
            prev.some(m => m.id === (row as Message).id) ? prev : [...prev, row as Message]);
        return true;
    };

    const send = async () => {
        const body = draft.trim();
        if (!body || !roomId) return;
        setSending(true);
        await push(body, null);
        setSending(false);
    };

    /**
     * 사진을 골라 보낸다.
     *
     * 줄여서 Storage에 올린 뒤 **주소만** 글로 남긴다. 적어 둔 글이 있으면
     * 사진에 같이 붙는다 (카톡처럼 사진 밑에 한 줄).
     * 올리다 실패하면 글은 그대로 두어 다시 시도할 수 있게 한다.
     */
    const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // 같은 사진을 연달아 고를 수 있게 비워 둔다.
        e.target.value = '';
        if (!file || !roomId) return;
        if (!file.type.startsWith('image/')) {
            toast('사진만 올릴 수 있습니다.', 'error');
            return;
        }

        setUploading(true);
        try {
            const blob = await shrinkImage(file);
            const path = `${roomId}/${crypto.randomUUID()}.jpg`;
            const { error: upErr } = await supabase.storage
                .from('chat-photos')
                .upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
            if (upErr) throw upErr;

            const { data: pub } = supabase.storage.from('chat-photos').getPublicUrl(path);
            await push(draft.trim(), pub.publicUrl);
        } catch (err) {
            toast(readableError(err), 'error');
        } finally {
            setUploading(false);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // PC에서는 Enter로 보내고 Shift+Enter로 줄을 바꾼다.
        // 모바일 키보드는 Enter가 줄바꿈이어야 해서 화면 폭으로 가른다.
        if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 640) {
            e.preventDefault();
            send();
        }
    };

    if (loading) return <div className="page center-fill"><div className="spinner" /></div>;
    if (error || !data?.room) {
        return (
            <div className="page">
                <h1 className="page-title">대화</h1>
                <div className="notice danger">
                    {error ?? '대화방을 찾지 못했습니다. schema.sql을 실행했는지 확인해 주세요.'}
                </div>
            </div>
        );
    }

    return (
        <div className="chat">
            <div className="chat-head">
                <h1 className="chat-title">{data.room.name}</h1>
                <span className="xs faint chat-sub">라운드·투표·공지는 각 탭에 남습니다</span>
            </div>

            <div className="chat-list" ref={listRef} onScroll={onScroll}>
                {hasMore && (
                    <button className="btn ghost sm chat-more" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? '불러오는 중…' : '지난 대화 더 보기'}
                    </button>
                )}
                {messages.length === 0 && (
                    <div className="empty">첫 마디를 남겨 보세요.</div>
                )}
                {messages.map((m, i) => {
                    const prev = messages[i - 1];
                    const newDay = !prev || kstDate(prev.created_at) !== kstDate(m.created_at);
                    // 같은 사람이 5분 안에 이어 쓰면 이름과 사진을 다시 넣지 않는다.
                    const grouped = !newDay && prev
                        && prev.user_id === m.user_id
                        && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
                    return (
                        <div key={m.id}>
                            {newDay && <div className="chat-day">{formatDate(m.created_at)}</div>}
                            <Bubble
                                message={m}
                                who={names[m.user_id ?? '']}
                                mine={m.user_id === me}
                                grouped={grouped}
                                onImageLoad={pinBottom}
                            />
                        </div>
                    );
                })}
            </div>

            <div className="chat-input">
                <input
                    ref={fileRef} type="file" accept="image/*"
                    onChange={onPickPhoto} hidden
                />
                <button className="btn ghost chat-photo" onClick={() => fileRef.current?.click()}
                        disabled={uploading} aria-label="사진 보내기">
                    {uploading
                        ? <span className="spinner sm" />
                        : <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.9"
                               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M12 5.5v13M5.5 12h13" />
                          </svg>}
                </button>
                <textarea
                    className="textarea grow" value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    onFocus={onComposerFocus}
                    onBlur={onComposerBlur}
                    placeholder="메시지" rows={1} maxLength={1000}
                    aria-label="메시지 입력"
                />
                <button className="btn primary chat-send" onClick={send}
                        disabled={sending || !draft.trim()} aria-label="보내기">
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 12h15M13 6l6 6-6 6" />
                    </svg>
                </button>
            </div>
        </div>
    );
}

function Bubble({
    message, who, mine, grouped, onImageLoad,
}: {
    message: Message;
    who?: Profile;
    mine: boolean;
    grouped: boolean;
    /** 사진은 늦게 뜨면서 목록을 밀어낸다. 다 뜨면 다시 바닥에 붙이라고 알린다. */
    onImageLoad: () => void;
}) {
    return (
        <div className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}>
            {!mine && (
                <div className="chat-avatar">
                    {!grouped && <Avatar name={who?.name} url={who?.avatar_url} />}
                </div>
            )}
            <div className="chat-col">
                {!mine && !grouped && (
                    <span className="xs faint chat-who">{who?.name ?? '알 수 없음'}</span>
                )}
                <div className="chat-line">
                    {message.image_url
                        // 사진은 말풍선 없이 그 자체로 보여 준다. 눌러서 원본을
                        // 새 창에 띄운다 — 저장은 거기서 길게 눌러 한다.
                        ? <a className="chat-photo-link" href={message.image_url}
                             target="_blank" rel="noreferrer">
                              <img className="chat-image" src={message.image_url}
                                   alt="보낸 사진" loading="lazy" onLoad={onImageLoad} />
                          </a>
                        : <div className="chat-bubble">{message.body}</div>}
                    <span className="chat-time">{formatTime(message.created_at)}</span>
                </div>
                {/* 사진에 글을 함께 보냈으면 그 아래 한 줄로 붙인다. */}
                {message.image_url && message.body && (
                    <div className="chat-bubble">{message.body}</div>
                )}
            </div>
        </div>
    );
}
