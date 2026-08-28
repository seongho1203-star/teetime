import { Link } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import './Help.css';

/**
 * 까꿍 사용자 가이드.
 *
 * **처음 들어온 분에게 보여 줄 곳이다.** 공지로 올리는 길도 있었지만
 * 새 공지가 쌓이면 묻힌다 — 앱 안에 두면 언제든 같은 자리에서 찾는다.
 * 들어가는 문은 둘이다: `내 정보 → 까꿍 사용법`, 그리고 **승인 대기 화면** —
 * 기다리는 동안 읽어 두면 승인되자마자 쓸 수 있다.
 *
 * **글은 사용자가 직접 써 준 것이다.** 말투와 짜임을 임의로 고치지 말 것.
 * 다만 여기 적힌 버튼 이름은 실제 화면의 말이라(`신청하기`·`대기 신청`·
 * `입금 완료`·`이 기기로 받기`), **화면 문구를 바꾸면 여기도 함께 고쳐야**
 * 설명이 거짓말이 안 된다.
 *
 * 6번의 `홈 화면에 추가`는 **웹으로 쓰는 동안만 필요한 안내다.**
 * 앱(Capacitor)으로 감싸면 그 단계가 없어지므로 그때 이 꼭지를 손볼 것
 * (`docs/출시-전-할일.md`).
 */

/** 한 꼭지. 번호·아이콘·제목·이끄는 말·본문. */
function Part({ n, icon, title, lead, children }: {
    n: number; icon: string; title: string; lead?: string; children?: React.ReactNode;
}) {
    return (
        <div className="card help-part">
            <h2 className="help-h">
                <span className="help-icon" aria-hidden="true">{icon}</span>
                <span className="help-num">{n}.</span>
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
            <TopBar title="까꿍 사용자 가이드" fallback="/me" onBack={onBack} />

            <p className="help-intro">
                카카오톡 단체방에서 유실되기 쉬운 <b>라운드 모집과 투표, 정산 내역</b>을
                체계적으로 관리하기 위해 개발된 전용 플랫폼입니다.
                아래의 핵심 가이드를 참고하여 더욱 편리한 모임 활동을 경험해 보세요.
            </p>

            <Part n={1} icon="🏠" title="홈 (대시보드) — 맞춤형 일정 관리"
                  lead="사용자의 현재 상태에 맞춰 필요한 액션만 우선적으로 화면에 노출됩니다. 대기 중인 일정이 없다면 화면이 간결해집니다.">
                <ul className="help-list">
                    <li><b>다음 라운드</b> — 일시, 장소, 날씨, 잔여 티오(T/O)를 한눈에
                        확인하고 즉시 참가 신청을 할 수 있습니다.</li>
                    <li><b>나의 할 일</b> — 미참여 투표, 미확인 대화 등 누락된 일정을
                        모아 보여줍니다.</li>
                    <li><b>모집 중</b> — 현재 참가 신청이 가능한 전체 라운드 목록입니다.</li>
                </ul>
                <p className="help-tip">
                    <b>Tip</b> · 하단 탭 메뉴는 버튼 터치뿐만 아니라, 화면을
                    <b> 좌우로 스와이프</b>하여 편리하게 이동할 수 있습니다.
                </p>
            </Part>

            <Part n={2} icon="⛳" title="라운드 운영 — 모집 및 자동 대기 시스템"
                  lead="필드 라운드와 스크린 골프가 시각적인 표 형태로 명확히 구분됩니다.">
                <ul className="help-list">
                    <li><b>신청 및 확정</b> — 잔여 자리가 있을 경우 신청과 동시에
                        참석이 확정됩니다.</li>
                    <li><b>자동 대기(Waitlist)</b> — 정원이 마감(<b>모집 마감</b>)되더라도
                        <b> 대기 신청</b>이 가능합니다. 기존 참석자가 취소할 경우 대기
                        순번에 따라 자동으로 참석이 확정되며, 별도의 확인 연락이
                        필요하지 않습니다.</li>
                    <li><b>라운드 전용 댓글</b> — 카풀 조율이나 개별 문의 사항은 단체
                        대화방이 아닌, 해당 라운드 게시글 하단의 전용 댓글란을 이용해
                        주시기 바랍니다.</li>
                </ul>
            </Part>

            <Part n={3} icon="💰" title="1/N 정산 — 원클릭 송금 및 확인"
                  lead="라운드 종료 후 총무가 정산을 등록하면, 개인별 청구 금액이 개별 알림으로 발송됩니다.">
                <ul className="help-list">
                    <li><b>간편 송금</b> — 알림을 통해 상세 페이지로 이동한 후,
                        계좌번호 우측의 <b>[복사]</b> 버튼을 터치하여 쉽게 송금할 수
                        있습니다.</li>
                    <li><b>입금 완료 처리</b> — 송금 후 반드시 <b>[입금완료]</b> 버튼을
                        눌러주셔야 총무가 실시간으로 수납 상태를 확인할 수 있습니다.
                        <span className="dim"> (실수로 누른 경우 한 번 더 누르면
                        취소됩니다.)</span> 이 버튼을 통해 상태가 공유되므로 대화방에
                        별도로 입금 확인 메시지를 남기실 필요가 없습니다.</li>
                </ul>
            </Part>

            <Part n={4} icon="🗳" title="투표 및 📢 공지 — 투명한 의견 취합"
                  lead="일정 및 장소 선정 등 주요 의사결정은 투표를 통해 진행됩니다.">
                <ul className="help-list">
                    <li>목록에서 항목을 터치하여 즉시 투표할 수 있으며,
                        <b> 다중 선택</b> 기능도 지원합니다.</li>
                    <li>투표 제목을 클릭하면 <b>항목별 참여자 명단과 미참여 인원</b>을
                        투명하게 조회할 수 있습니다.</li>
                    <li>상단에 <b>고정</b>된 공지 게시물은 모임의 중요 안내 사항이므로
                        최우선으로 확인해 주시기 바랍니다.</li>
                </ul>
            </Part>

            <Part n={5} icon="💬" title="커뮤니케이션 (대화방) — 맞춤형 소통"
                  lead="일반적인 메신저와 동일하게 사진 전송 및 실시간 대화가 가능합니다. (보안상 입장 이전의 대화 내역은 노출되지 않습니다.)">
                <ul className="help-list">
                    <li><b>지정 답장</b> — 특정 말풍선을 <b>왼쪽으로 밀어(스와이프)</b>
                        {' '}답장을 보낼 수 있습니다.</li>
                    <li><b>멘션(@) 호출</b> — 대화창에 <b>@</b>를 입력해 특정 멤버를
                        호출할 수 있습니다. 멘션된 멤버는 <b>대화방 알림을 비활성화해
                        두었더라도</b> 개별 알림을 수신하게 됩니다.</li>
                </ul>
            </Part>

            <Part n={6} icon="🔔" title="앱 설치 및 알림 설정 (필수 사항)"
                  lead="모집 오픈 등 중요 일정을 놓치지 않기 위해 알림 설정은 필수입니다.">
                <Step n={1}>
                    <b>홈 화면에 추가 (아이폰 사용자)</b> — Safari 브라우저 하단의
                    {' '}<b>[공유]</b> 버튼을 누른 후 <b>[홈 화면에 추가]</b>를 선택해
                    주세요. 바탕화면에 생성된 앱 아이콘으로 접속해야만 정상적인 푸시
                    알림 수신이 가능합니다.
                </Step>
                <Step n={2}>
                    <b>알림 활성화</b> — <b>[내 정보]</b> 메뉴에서
                    {' '}<b>'이 기기로 받기'</b>를 켜주세요. 알림은 기기(스마트폰, PC 등)별로
                    각각 설정해야 합니다.
                    <span className="dim"> (알림 피로도를 줄이기 위해 대화 알림만
                    개별적으로 끄는 것도 가능합니다.)</span>
                </Step>
            </Part>

            <Part n={7} icon="🙋" title="기타 참고 사항">
                <ul className="help-list">
                    <li><b>차량번호 등록</b> — 스크린 골프장 차량등록을 위한 등록으로,
                        가입 시 등록한 차량번호는 <b>[내 정보]</b> 메뉴에서 언제든
                        수정할 수 있습니다.</li>
                    <li><b>프로필 설정</b> — 대화방에서 서로를 쉽게 식별할 수 있도록
                        본인의 프로필 사진을 등록해 주시기를 권장합니다.</li>
                    <li><b>자동 시스템 메시지</b> — 새로운 모집이나 투표가 등록되면
                        대화방에 시스템 알림이 자동 발송되므로, 게시자가 별도로 공유할
                        필요가 없습니다.</li>
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
