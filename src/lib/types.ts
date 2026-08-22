/**
 * DB 테이블 모양. supabase/schema.sql 과 짝이다 — 한쪽만 고치지 말 것.
 *
 * Supabase CLI로 자동 생성할 수도 있지만(`supabase gen types`), 그러려면
 * CLI 로그인과 프로젝트 연결이 필요하다. 테이블이 열 개뿐이라 손으로 적었다.
 */

export type Role = 'pending' | 'member' | 'admin';
export type RoundStatus = 'open' | 'closed' | 'done' | 'cancelled';
export type SignupState = 'confirmed' | 'waitlist';

export type Profile = {
    id: string;
    name: string;
    avatar_url: string | null;
    role: Role;
    handicap: number | null;
    phone: string | null;
    memo: string;
    created_at: string;
};

export type Round = {
    id: string;
    title: string;
    course: string;
    lat: number | null;
    lon: number | null;
    tee_at: string;
    capacity: number;
    fee: number;
    note: string;
    status: RoundStatus;
    opens_at: string | null;
    created_by: string | null;
    created_at: string;
};

export type Signup = {
    id: string;
    round_id: string;
    user_id: string;
    state: SignupState;
    seq: number;
    note: string;
    created_at: string;
};

export type Poll = {
    id: string;
    title: string;
    body: string;
    multi: boolean;
    anonymous: boolean;
    closes_at: string | null;
    closed: boolean;
    created_by: string | null;
    created_at: string;
};

export type PollOption = {
    id: string;
    poll_id: string;
    label: string;
    sort: number;
};

export type PollVote = {
    id: string;
    poll_id: string;
    option_id: string;
    user_id: string;
    created_at: string;
};

export type Post = {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    author_id: string | null;
    created_at: string;
    updated_at: string;
};

export type PostComment = {
    id: string;
    post_id: string;
    author_id: string | null;
    body: string;
    created_at: string;
};

export type Room = {
    id: string;
    name: string;
    round_id: string | null;
    created_at: string;
};

export type Message = {
    id: string;
    room_id: string;
    user_id: string | null;
    body: string;
    /** 함께 보낸 사진의 공개 주소. 사진이 없으면 null. */
    image_url: string | null;
    created_at: string;
};

/** supabase-js 제네릭에 넣을 최소한의 형태. */
type Table<Row> = {
    Row: Row;
    Insert: Partial<Row>;
    Update: Partial<Row>;
    Relationships: [];
};

export interface Database {
    public: {
        Tables: {
            profiles: Table<Profile>;
            rounds: Table<Round>;
            signups: Table<Signup>;
            polls: Table<Poll>;
            poll_options: Table<PollOption>;
            poll_votes: Table<PollVote>;
            posts: Table<Post>;
            post_comments: Table<PostComment>;
            rooms: Table<Room>;
            messages: Table<Message>;
        };
        Views: Record<string, never>;
        Functions: {
            join_round: { Args: { p_round: string; p_note?: string }; Returns: Signup };
            leave_round: { Args: { p_round: string }; Returns: void };
            kick_signup: { Args: { p_round: string; p_user: string }; Returns: void };
            cast_vote: { Args: { p_option: string }; Returns: void };
            retract_vote: { Args: { p_option: string }; Returns: void };
            is_member: { Args: Record<string, never>; Returns: boolean };
            is_admin: { Args: Record<string, never>; Returns: boolean };
        };
        Enums: Record<string, never>;
        CompositeTypes: Record<string, never>;
    };
};
