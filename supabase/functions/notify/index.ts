/**
 * 알림 발송기 (Supabase Edge Function).
 *
 * DB 웹훅이 새 행을 여기로 보내면, 받을 사람을 골라 폰으로 밀어 준다.
 * 앱에는 서버가 없으므로 **밀어 주는 일은 여기 한 곳에서만** 한다.
 *
 *   messages  새 글  → 쓴 사람 빼고 회원 모두
 *   profiles  새 가입 → 운영진 모두 ('pending'으로 들어온 행)
 *   rounds    새 모집 → 연 사람 빼고 회원 모두
 *
 * 웹훅은 Supabase 화면(Database → Webhooks)에서 건다. 보낼 때
 * `x-notify-secret` 헤더에 NOTIFY_SECRET을 넣게 해 두었다 — 이 함수는
 * 인증 없이 열려 있으므로 그 값이 맞을 때만 일한다.
 *
 * 필요한 Secret (Edge Functions → Secrets):
 *   VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · VAPID_SUBJECT · NOTIFY_SECRET
 * SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY는 자동으로 들어 있다.
 */

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const env = (k: string) => Deno.env.get(k) ?? '';

webpush.setVapidDetails(
    env('VAPID_SUBJECT') || 'mailto:noreply@example.com',
    env('VAPID_PUBLIC_KEY'),
    env('VAPID_PRIVATE_KEY'),
);

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

interface Hook {
    type: 'INSERT' | 'UPDATE' | 'DELETE';
    table: string;
    record: Record<string, unknown> | null;
    old_record: Record<string, unknown> | null;
}

interface Note {
    title: string;
    body: string;
    tag: string;
    url: string;
    /** 이 사람들에게만. 비우면 (보낸 사람 빼고) 회원 모두. */
    only?: string[];
    except?: string | null;
    /**
     * 기기가 따로 끌 수 있는 갈래. 지금은 대화 하나뿐이다 —
     * 종일 울리는 것이 그것뿐이라, 그것 때문에 알림을 통째로 끄는 일을
     * 막으려고 두었다. 갈래가 없는 알림(모집·공지·투표·가입)은 켜 둔
     * 기기 모두에게 간다.
     */
    channel?: 'chat';
    /**
     * 갈래를 껐어도 이 사람들에게는 보낸다. `@언급`과 **내 글에 달린
     * 답장**이 그렇다 — 한 사람을 콕 집은 글은 '알아 두라'가 아니라
     * '지금 봐 달라'라서, 그것까지 막히면 부르거나 답할 이유가 없어진다.
     */
    always?: string[];
}

/** 이름을 붙여 준다. 누가 썼는지가 알림에서 제일 중요하다. */
async function nameOf(id: unknown): Promise<string> {
    if (typeof id !== 'string') return '누군가';
    const { data } = await db.from('profiles').select('name').eq('id', id).maybeSingle();
    return (data?.name as string) || '누군가';
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 글에서 `@이름`으로 부른 사람들.
 *
 * **대화 알림을 꺼 둔 기기에도 이건 간다.** 부르는 것은 '알아 두라'가
 * 아니라 '지금 봐 달라'라서, 그것까지 막히면 부를 이유가 없어진다.
 *
 * 맞추는 규칙은 앱 화면(`src/lib/mention.ts`의 `splitMentions`)과 같아야
 * 한다 — **긴 이름 먼저**(`김지`와 `김지명`이 함께 있으면 뒤엣것).
 * 한쪽만 고치면 화면에는 도드라지는데 알림은 안 오는 일이 생긴다.
 */
async function mentionedIds(body: unknown): Promise<string[]> {
    if (typeof body !== 'string' || !body.includes('@')) return [];
    const { data } = await db.from('profiles')
        .select('id, name').in('role', ['member', 'staff', 'admin']);
    const list = (data ?? [])
        .filter(p => typeof p.name === 'string' && p.name)
        .sort((a, b) => String(b.name).length - String(a.name).length);
    if (!list.length) return [];

    const re = new RegExp(`@(${list.map(p => escapeRe(String(p.name))).join('|')})`, 'g');
    const called = new Set([...body.matchAll(re)].map(m => m[1]));
    return list.filter(p => called.has(String(p.name))).map(p => p.id as string);
}

/** 답장이면 원본을 쓴 사람. 답장이 아니거나 원본이 지워졌으면 null. */
async function repliedAuthor(replyTo: unknown): Promise<string | null> {
    if (typeof replyTo !== 'string' || !replyTo) return null;
    const { data } = await db.from('messages')
        .select('user_id').eq('id', replyTo).maybeSingle();
    return (data?.user_id as string) ?? null;
}

/**
 * 대화 알림을 꺼 두었어도 받아야 할 사람들.
 *
 * 둘 다 **한 사람을 콕 집은 글**이라 같이 다룬다 — 이름을 부른 것과
 * 내 글에 답장이 달린 것. 나머지 잡담과 달리 '지금 봐 달라'는 신호라,
 * 이것까지 막히면 부르거나 답할 이유가 없어진다.
 */
async function alwaysFor(r: Record<string, unknown>): Promise<string[]> {
    const ids = new Set(await mentionedIds(r.body));
    const replied = await repliedAuthor(r.reply_to);
    if (replied) ids.add(replied);
    return [...ids];
}

async function planFor(hook: Hook): Promise<Note | null> {
    const r = hook.record ?? {};

    if (hook.table === 'messages' && hook.type === 'INSERT') {
        const who = await nameOf(r.user_id);
        const text = typeof r.body === 'string' && r.body.trim()
            ? r.body.trim()
            : (r.image_url ? '사진을 보냈습니다' : '');
        return {
            // **무엇에 대한 알림인지 제목 첫머리에 세운다.** 알림창에는 제목
            // 한 줄만 보이는 때가 많아, 이름만 있으면 대화인지 모집인지
            // 열어 봐야 안다.
            title: `💬 대화 · ${who}`,
            body: text.slice(0, 120),
            // 대화는 한 덩어리로 묶어 알림창이 도배되지 않게 한다.
            tag: 'chat',
            url: '#/chat',
            except: typeof r.user_id === 'string' ? r.user_id : null,
            channel: 'chat',
            always: await alwaysFor(r),
        };
    }

    if (hook.table === 'rounds' && hook.type === 'INSERT') {
        const who = await nameOf(r.created_by);
        const course = typeof r.course === 'string' && r.course ? r.course : '라운드';
        // 스크린도 잦아서 알림창 한 줄만 봐도 어느 쪽인지 알아야 한다.
        // 칸이 없는(스키마를 아직 안 돌린) 저장소에서는 필드로 본다.
        const screen = r.kind === 'screen';
        return {
            title: screen ? '🎯 새 스크린' : '⛳ 새 모집',
            body: `${who}님이 ${course} 모집을 열었습니다`,
            tag: `round-${r.id}`,
            url: `#/rounds/${r.id}`,
            except: typeof r.created_by === 'string' ? r.created_by : null,
        };
    }

    if (hook.table === 'polls' && hook.type === 'INSERT') {
        const who = await nameOf(r.created_by);
        return {
            title: '🗳 새 투표',
            body: `${who}님: ${String(r.title ?? '').slice(0, 80)}`,
            tag: `poll-${r.id}`,
            url: '#/polls',
            except: typeof r.created_by === 'string' ? r.created_by : null,
        };
    }

    if (hook.table === 'posts' && hook.type === 'INSERT') {
        return {
            title: '📢 새 공지',
            body: String(r.title ?? '').slice(0, 80),
            tag: `post-${r.id}`,
            url: `#/board/${r.id}`,
            except: typeof r.author_id === 'string' ? r.author_id : null,
        };
    }

    // 가입 신청은 **운영진에게만**(운영자·부운영자). 트리거가 만든 pending 행이 들어온다.
    if (hook.table === 'profiles' && hook.type === 'INSERT' && r.role === 'pending') {
        const { data: admins } = await db.from('profiles')
            .select('id').in('role', ['admin', 'staff']);
        const only = (admins ?? []).map(a => a.id as string);
        if (!only.length) return null;
        return {
            title: '🙋 가입 신청',
            body: `${String(r.name ?? '') || '새 회원'}님이 승인을 기다립니다`,
            tag: 'pending',
            url: '#/members',
            only,
        };
    }

    return null;
}

Deno.serve(async req => {
    if (req.method !== 'POST') return new Response('ok');

    const secret = env('NOTIFY_SECRET');
    if (secret && req.headers.get('x-notify-secret') !== secret) {
        return new Response('no', { status: 401 });
    }

    let hook: Hook;
    try {
        hook = await req.json();
    } catch {
        return new Response('bad json', { status: 400 });
    }

    const note = await planFor(hook);
    if (!note) return new Response(JSON.stringify({ sent: 0, skipped: true }));

    let q = db.from('push_subscriptions').select('endpoint, p256dh, auth, user_id');
    if (note.only) q = q.in('user_id', note.only);
    else if (note.except) q = q.neq('user_id', note.except);
    // 이 갈래를 끈 기기는 뺀다. **다만 이름이 불린 사람은 껐어도 받는다.**
    // `chat` 칸이 없는(스키마를 아직 안 돌린) 저장소에서는 이 조회가 오류로
    // 돌아오고 아래에서 500으로 끝난다 — 조용히 안 가는 것보다 낫다.
    // 칸을 더하는 alter가 schema.sql에 있다.
    if (note.channel) {
        q = note.always?.length
            ? q.or(`chat.eq.true,user_id.in.(${note.always.join(',')})`)
            : q.eq('chat', true);
    }

    const { data: subs, error } = await q;
    if (error) return new Response(error.message, { status: 500 });

    const payload = JSON.stringify({
        title: note.title, body: note.body, tag: note.tag, url: note.url,
    });

    // 못 쓰게 된 구독은 404/410으로 돌아온다. 그때 지워 두지 않으면
    // 발송할 때마다 같은 실패가 쌓인다.
    const dead: string[] = [];
    let sent = 0;

    await Promise.all((subs ?? []).map(async s => {
        try {
            await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                payload,
            );
            sent++;
        } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) dead.push(s.endpoint);
        }
    }));

    if (dead.length) await db.from('push_subscriptions').delete().in('endpoint', dead);

    return new Response(JSON.stringify({ sent, dropped: dead.length }), {
        headers: { 'content-type': 'application/json' },
    });
});
