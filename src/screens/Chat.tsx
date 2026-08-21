import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAsync, unwrap, fetchProfiles, byId } from '../lib/db';
import { useAuth } from '../lib/auth';
import { formatDate, formatTime, kstDate } from '../lib/format';
import type { Message, Profile, Room } from '../lib/types';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';
import { readableError } from '../lib/errors';
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

    // 맨 아래에 붙여 둔다. 그리기가 끝난 프레임에 해야 높이가 확정된다.
    useLayoutEffect(() => {
        const el = listRef.current;
        if (el && atBottom.current) el.scrollTop = el.scrollHeight;
    }, [messages]);

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

    const send = async () => {
        const body = draft.trim();
        if (!body || !roomId) return;
        setSending(true);
        const { data: row, error: err } = await supabase
            .from('messages').insert({ room_id: roomId, user_id: me, body })
            .select('*').single();
        setSending(false);
        if (err) { toast(readableError(err), 'error'); return; }

        setDraft('');
        atBottom.current = true;
        // 실시간 이벤트가 오기 전에 먼저 그린다. 내 글이 늦게 뜨면 답답하다.
        if (row) setMessages(prev =>
            prev.some(m => m.id === (row as Message).id) ? prev : [...prev, row as Message]);
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
                <span className="xs faint">라운드·투표·공지는 각 탭에 남습니다</span>
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
                            />
                        </div>
                    );
                })}
            </div>

            <div className="chat-input">
                <textarea
                    className="textarea grow" value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
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
    message, who, mine, grouped,
}: {
    message: Message;
    who?: Profile;
    mine: boolean;
    grouped: boolean;
}) {
    return (
        <div className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`}>
            {!mine && (
                <div className="chat-avatar">
                    {!grouped && <Avatar name={who?.name} url={who?.avatar_url} size="sm" />}
                </div>
            )}
            <div className="chat-col">
                {!mine && !grouped && (
                    <span className="xs faint chat-who">{who?.name ?? '알 수 없음'}</span>
                )}
                <div className="chat-line">
                    <div className="chat-bubble">{message.body}</div>
                    <span className="chat-time">{formatTime(message.created_at)}</span>
                </div>
            </div>
        </div>
    );
}
