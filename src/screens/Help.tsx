import { Link } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import './Help.css';

/**
 * 사용법.
 *
 * **처음 들어온 분에게 보여 줄 곳이다.** 공지로 올리는 길도 있었지만
 * 새 공지가 쌓이면 묻힌다 — 앱 안에 두면 언제든 같은 자리에서 찾는다.
 * 들어가는 문은 둘이다: `내 정보 → 사용법`, 그리고 **승인 대기 화면** —
 * 기다리는 동안 읽어 두면 승인되자마자 쓸 수 있다.
 *
 * **화면을 고치면 여기도 고칠 것.** 여기 적힌 것은 전부 실제 화면의
 * 말이라(`신청하기`·`대기 신청`·`입금완료` 등), 말이 바뀌면 설명이
 * 거짓말이 된다.
 */

/** 한 꼭지. 제목·이끄는 말·줄들. */
function Part({ icon, title, lead, children }: {
    icon: string; title: string; lead?: string; children?: React.ReactNode;
}) {
    return (
        <div className="card help-part">
            <h2 className="help-h">
                <span className="help-icon" aria-hidden="true">{icon}</span>
                {title}
            </h2>
            {lead && <p className="help-lead">{lead}</p>}
            {children}
        </div>
    );
}

/** 번호가 붙는 한 단계. 손으로 따라 할 일에만 쓴다. */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
    return (
        <div className="help-step">
            <span className="help-n">{n}</span>
            <div className="help-step-body">{children}</div>
        </div>
    );
}

export function Help({ onBack }: { onBack?: () => void }) {
    return (
        <div className="page help">
            {/* `onBack`은 **승인 대기 화면**에서 띄울 때 쓴다 — 거기서는
                라우터로 옮겨 봐야 같은 화면이 다시 나온다. */}
            <TopBar title="까꿍 사용법" fallback="/me" onBack={onBack} />

            <p className="help-intro">
                라운드 모집과 투표가 카톡 대화에 묻히지 않게 만든 앱입니다.
                <b> 아래 다섯 개만 알면 다 쓰신 겁니다.</b>
            </p>

            <Part icon="🏠" title="홈 — 여기만 봐도 됩니다"
                  lead="지금 내가 뭘 해야 하는지가 위에서부터 순서대로 쌓입니다. 할 게 없는 칸은 아예 사라지니, 화면이 짧으면 한가한 주입니다.">
                <ul className="help-list">
                    <li><b>다음 라운드</b> — 언제·어디·날씨·남은 자리.
                        <b> 신청은 여기서 바로</b> 누르시면 됩니다.</li>
                    <li><b>내가 할 일</b> — 아직 안 한 투표, 안 읽은 대화.</li>
                    <li><b>모집중</b> — 그 밖에 열려 있는 라운드.</li>
                </ul>
                <p className="help-tip">
                    아래 <b>탭은 손가락으로 좌우로 밀어서도</b> 넘어갑니다.
                </p>
            </Part>

            <Part icon="⛳" title="라운드 — 신청하고 기다리기"
                  lead="필드와 스크린 두 가지가 있고, 표로 구분됩니다.">
                <ul className="help-list">
                    <li><b>신청하기</b> — 자리가 있으면 바로 확정됩니다.</li>
                    <li><b>대기 신청</b> — 자리가 찼을 때. 앞사람이 취소하면
                        <b> 자동으로 올라갑니다.</b> 따로 연락 안 하셔도 됩니다.</li>
                    <li><b>모집 마감</b>이라고 적혀 있어도 <b>대기 신청은 됩니다.</b></li>
                </ul>
                <p className="help-tip">
                    카풀이나 물어볼 것은 그 라운드 <b>맨 아래 댓글</b>에 남기세요.
                    대화방에 쓰면 묻힙니다.
                </p>
            </Part>

            <Part icon="💰" title="정산 — 돈 보내고 눌러 주기"
                  lead="라운드가 끝나면 총무가 정산을 올립니다. 내 몫만 알림으로 따로 옵니다.">
                <Step n={1}>알림을 누르면 그 라운드로 갑니다.</Step>
                <Step n={2}>
                    <b>입금금액</b>을 확인하고, 계좌 옆 <b>복사</b>를 눌러
                    옮겨 적지 말고 붙여넣으세요.
                </Step>
                <Step n={3}>
                    돈을 보내신 뒤 <b>입금완료</b> 단추를 눌러 주세요.
                    <span className="dim"> 잘못 누르셨으면 한 번 더 누르면 취소됩니다.</span>
                </Step>
                <p className="help-tip">
                    이 단추를 눌러 주셔야 총무가 누가 보냈는지 압니다.
                    따로 말씀 안 하셔도 됩니다.
                </p>
            </Part>

            <Part icon="🗳" title="투표 · 📢 공지"
                  lead="날짜 정하기 같은 것은 투표로 합니다.">
                <ul className="help-list">
                    <li>투표는 <b>목록에서 바로</b> 누르면 됩니다.
                        여러 개 고를 수 있는 투표도 있습니다.</li>
                    <li>제목을 누르면 <b>누가 뭘 골랐는지</b>와
                        <b> 아직 안 한 사람</b>까지 볼 수 있습니다.</li>
                    <li>공지는 위에 <b>고정</b>된 것부터 읽어 주세요.</li>
                </ul>
            </Part>

            <Part icon="💬" title="대화 — 카톡처럼 쓰시면 됩니다"
                  lead="사진도 보내고 답장도 됩니다.">
                <ul className="help-list">
                    <li><b>답장</b>은 그 말풍선을 <b>왼쪽으로 밀면</b> 걸립니다.</li>
                    <li><b>@를 치면</b> 이름 목록이 뜹니다. 부르면 그 사람에게는
                        <b> 대화 알림을 꺼 뒀어도</b> 알림이 갑니다.</li>
                    <li><b>들어오기 전 대화는 안 보입니다.</b> 카톡과 같습니다.</li>
                </ul>
            </Part>

            <Part icon="🔔" title="알림 켜기 — 이것만은 꼭"
                  lead="안 켜시면 모집이 열려도 모르고 지나갑니다.">
                <Step n={1}>
                    <b>아이폰이라면 먼저 홈 화면에 추가하세요.</b>
                    <span className="dim"> 사파리 아래 </span><b>공유 → 홈 화면에 추가</b>
                    <span className="dim">. 그 아이콘으로 연 뒤에만 알림을 켤 수 있습니다.</span>
                </Step>
                <Step n={2}><b>내 정보 → 이 기기로 받기</b>를 켜 주세요.</Step>
                <p className="help-tip">
                    알림은 <b>기기마다 따로</b> 켭니다. 폰에서 켜도 PC는 또 켜셔야 합니다.
                    대화가 너무 잦으면 <b>대화 알림만</b> 따로 끌 수 있습니다.
                </p>
            </Part>

            <Part icon="🙋" title="이건 알아 두세요">
                <ul className="help-list">
                    <li><b>차량번호</b>는 카풀 때문에 받습니다.
                        <b> 내 정보</b>에서 언제든 고치실 수 있습니다.</li>
                    <li><b>프로필 사진</b>을 넣어 주시면 대화에서 알아보기 쉽습니다.</li>
                    <li>모집·투표를 열면 <b>대화방에 한 줄 자동으로</b> 남습니다.
                        따로 알리지 않으셔도 됩니다.</li>
                </ul>
            </Part>

            <div className="card help-foot">
                <p className="sm">
                    잘 안 되는 게 있으면 <b>대화방에 편하게 물어보세요.</b>
                </p>
                {onBack
                    ? <button className="btn block" onClick={onBack}>닫기</button>
                    : <Link to="/me" className="btn block">내 정보로 가기</Link>}
            </div>
        </div>
    );
}
