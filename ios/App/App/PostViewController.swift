import UIKit

/*
 * **공지 상세 + 댓글** — 웹의 `screens/PostDetail.tsx`와 `components/Comments.tsx`를
 * Swift로 옮긴 것이다(`docs/아이폰-네이티브.md` 2단계).
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - `수정`은 **올린 사람과 운영진**에게만(머리말 오른쪽). 쓰는 화면은 아직
 *    웹이라 `/board/<id>/edit`로 넘긴다(`navigate`).
 *  - `📣 대화방에 공유`는 **누구나** 누른다 — 공지는 회원 누구나 읽는 것이고,
 *    묻힌 것을 다시 올리는 일에 등급을 따질 이유가 없다. `system` 글 +
 *    `post_id`(눌리는 카드) + `notify`(폰 한 번)이고, **없는 칸을 하나씩
 *    빼며 다시 넣는다**(`shareToChat`). 본문은 **첫 줄만 60자**까지 곁줄이다.
 *  - `맨 위에 고정`·`지우기`는 **운영진만**. 지울 때 댓글 수를 세어 한 번
 *    더 묻는다.
 *  - 댓글은 누구나 달고, **지우는 것은 쓴 사람과 운영진**. 댓글에는 알림을
 *    안 보낸다(웹과 같다 — 발송기가 애초에 안 듣는다).
 *  - 글 지우기가 끝나면 목록으로 **바꿔치기**해 간다(`replace`) — 지운 글이
 *    히스토리에 남으면 뒤로 갔을 때 없는 글이 뜬다.
 *
 * 댓글 칸은 **화면 아래 붙박이 바**다 — `keyboardLayoutGuide`에 묶여 키보드와
 * 한 몸으로 오르내린다(네이티브 글칸이라 천지인 깜빡임도 없다). 웹은 카드
 * 안에 칸이 있었지만 그건 `textarea`가 키보드에 붙을 길이 없어서였다.
 */
final class PostViewController: NativeScreenController, UITextViewDelegate {
    private let postId: String

    private let scroll = UIScrollView()
    private let stack = UIStackView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let refresh = UIRefreshControl()

    private let pinBadge = PillLabel()
    private let titleText = UILabel()
    private let metaLabel = UILabel()
    private let bodyLabel = UILabel()
    private let shareRow = UIStackView()
    private let shareBtn = UIButton(type: .system)
    private let adminRow = UIStackView()
    private let pinBtn = UIButton(type: .system)
    private let delBtn = UIButton(type: .system)
    private let commentCard = UIStackView()
    private let commentTitle = UILabel()
    private let commentList = UIStackView()

    private let composer = UIView()
    private let field = UITextView()
    private let hint = UILabel()
    private let sendBtn = UIButton(type: .system)
    private var fieldH: NSLayoutConstraint?

    private var post: AppPost?
    private var comments: [AppComment] = []
    private var people: [String: AppProfile] = [:]
    private var busy = false

    private var me: AppProfile? { people[service.config.user] }
    private var isAdmin: Bool { AppRole.isAdmin(me?.role ?? "member") }
    private var canEdit: Bool { isAdmin || post?.authorId == service.config.user }

    init(service: NativeChatService, id: String) {
        postId = id
        super.init(service: service, title: "공지")
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidLoad() {
        super.viewDidLoad()
        rightButton.setTitle("수정", for: .normal)
        rightButton.addTarget(self, action: #selector(editTapped), for: .touchUpInside)

        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = true
        scroll.keyboardDismissMode = .interactive
        refresh.addTarget(self, action: #selector(pulled), for: .valueChanged)
        scroll.refreshControl = refresh

        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 4, left: 16, bottom: 24, right: 16)

        /* 고정 표 — 노랑은 '기다리는 것'(`.badge warn`). */
        pinBadge.text = "고정"
        pinBadge.pad = UIEdgeInsets(top: 3, left: 9, bottom: 3, right: 9)
        pinBadge.font = .systemFont(ofSize: 11.5, weight: .heavy)
        pinBadge.textColor = AppSkin.warn
        pinBadge.backgroundColor = AppSkin.warn.withAlphaComponent(0.14)
        pinBadge.layer.cornerRadius = 10
        pinBadge.layer.masksToBounds = true
        pinBadge.isHidden = true
        let pinRow = UIStackView(arrangedSubviews: [pinBadge, UIView()])
        pinRow.axis = .horizontal

        titleText.font = .systemFont(ofSize: 20, weight: .bold)
        titleText.textColor = AppSkin.text
        titleText.numberOfLines = 0
        metaLabel.font = .systemFont(ofSize: 12)
        metaLabel.textColor = AppSkin.faint
        metaLabel.numberOfLines = 1
        bodyLabel.font = .systemFont(ofSize: 16)
        bodyLabel.textColor = AppSkin.text
        bodyLabel.numberOfLines = 0

        style(shareBtn, title: "📣 대화방에 공유", color: AppSkin.text, filled: false)
        shareBtn.addTarget(self, action: #selector(shareTapped), for: .touchUpInside)
        shareRow.axis = .horizontal
        shareRow.addArrangedSubview(UIView())
        shareRow.addArrangedSubview(shareBtn)

        style(pinBtn, title: "맨 위에 고정", color: AppSkin.text, filled: false)
        pinBtn.addTarget(self, action: #selector(pinTapped), for: .touchUpInside)
        style(delBtn, title: "지우기", color: AppSkin.danger, filled: true)
        delBtn.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside)
        adminRow.axis = .horizontal
        adminRow.spacing = 10
        adminRow.addArrangedSubview(pinBtn)
        adminRow.addArrangedSubview(delBtn)
        adminRow.addArrangedSubview(UIView())
        adminRow.isHidden = true

        /* 댓글 카드 — 흰 카드에 제목 줄과 댓글이 쌓인다(웹 `.card` + `.comment`). */
        commentCard.axis = .vertical
        commentCard.spacing = 0
        commentCard.backgroundColor = AppSkin.surface
        commentCard.layer.cornerRadius = AppSkin.radius
        commentCard.layer.cornerCurve = .continuous
        commentCard.isLayoutMarginsRelativeArrangement = true
        commentCard.layoutMargins = UIEdgeInsets(top: 14, left: 14, bottom: 6, right: 14)
        commentTitle.font = .systemFont(ofSize: 14, weight: .bold)
        commentTitle.textColor = AppSkin.dim
        commentList.axis = .vertical
        commentList.spacing = 0
        commentCard.addArrangedSubview(commentTitle)
        commentCard.setCustomSpacing(6, after: commentTitle)
        commentCard.addArrangedSubview(commentList)

        [pinRow, titleText, metaLabel, bodyLabel, shareRow, adminRow, commentCard].forEach { stack.addArrangedSubview($0) }
        stack.setCustomSpacing(4, after: titleText)
        stack.setCustomSpacing(16, after: metaLabel)
        stack.setCustomSpacing(16, after: bodyLabel)

        scroll.addSubview(stack)

        /* 댓글 적는 바 — 위쪽 가는 선 · 글칸 + `등록`. */
        composer.backgroundColor = AppSkin.bg
        composer.translatesAutoresizingMaskIntoConstraints = false
        let rule = UIView()
        rule.backgroundColor = AppSkin.line
        rule.translatesAutoresizingMaskIntoConstraints = false
        field.translatesAutoresizingMaskIntoConstraints = false
        field.font = .systemFont(ofSize: 16)
        field.textColor = AppSkin.text
        field.backgroundColor = AppSkin.surface
        field.layer.cornerRadius = AppSkin.radiusSm
        field.layer.borderWidth = 1
        field.layer.borderColor = AppSkin.line.cgColor
        field.textContainerInset = UIEdgeInsets(top: 11, left: 9, bottom: 11, right: 9)
        field.delegate = self
        field.isScrollEnabled = false
        hint.text = "댓글 남기기"
        hint.font = .systemFont(ofSize: 16)
        hint.textColor = AppSkin.faint
        hint.translatesAutoresizingMaskIntoConstraints = false
        hint.isUserInteractionEnabled = false
        style(sendBtn, title: "등록", color: AppSkin.brand, filled: true)
        sendBtn.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
        composer.addSubview(rule); composer.addSubview(field); composer.addSubview(hint); composer.addSubview(sendBtn)

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true

        body.addSubview(scroll); body.addSubview(composer); body.addSubview(spinner)
        let fh = field.heightAnchor.constraint(equalToConstant: 44)
        fieldH = fh
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: body.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: composer.topAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            composer.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            composer.trailingAnchor.constraint(equalTo: body.trailingAnchor),
            /* **키보드에 묶는다** — 내려가 있으면 안전 영역 위, 올라오면 키보드 위. */
            composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            rule.topAnchor.constraint(equalTo: composer.topAnchor),
            rule.leadingAnchor.constraint(equalTo: composer.leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: composer.trailingAnchor),
            rule.heightAnchor.constraint(equalToConstant: 1),
            field.topAnchor.constraint(equalTo: composer.topAnchor, constant: 9),
            field.bottomAnchor.constraint(equalTo: composer.bottomAnchor, constant: -9),
            field.leadingAnchor.constraint(equalTo: composer.leadingAnchor, constant: 16),
            fh,
            hint.leadingAnchor.constraint(equalTo: field.leadingAnchor, constant: 14),
            hint.topAnchor.constraint(equalTo: field.topAnchor, constant: 11),
            sendBtn.leadingAnchor.constraint(equalTo: field.trailingAnchor, constant: 10),
            sendBtn.trailingAnchor.constraint(equalTo: composer.trailingAnchor, constant: -16),
            sendBtn.bottomAnchor.constraint(equalTo: field.bottomAnchor),
            sendBtn.heightAnchor.constraint(equalToConstant: 44),
            spinner.centerXAnchor.constraint(equalTo: body.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: body.centerYAnchor)
        ])
        scroll.isHidden = true
        composer.isHidden = true
    }

    /// 단추 모양 — 웹 `.btn ghost sm` / `.btn primary` / `.btn danger sm`.
    private func style(_ b: UIButton, title: String, color: UIColor, filled: Bool) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        b.setTitleColor(filled ? .white : color, for: .normal)
        b.backgroundColor = filled ? color : AppSkin.surface
        b.layer.cornerRadius = 20
        b.layer.borderWidth = filled ? 0 : 1
        b.layer.borderColor = AppSkin.line.cgColor
        b.contentEdgeInsets = UIEdgeInsets(top: 10, left: 16, bottom: 10, right: 16)
        b.heightAnchor.constraint(greaterThanOrEqualToConstant: 40).isActive = true
    }

    // ── 받아 오기 ────────────────────────────────────────────────

    override func loadScreen() {
        if post == nil { spinner.startAnimating() }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let p = try await self.service.post(self.postId)
                self.comments = try await self.service.postComments(self.postId)
                self.people = try await self.service.peopleById()
                self.post = p
                self.render()
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
            self.spinner.stopAnimating()
            self.refresh.endRefreshing()
        }
    }

    @objc private func pulled() { loadScreen() }

    private func render() {
        guard let p = post else {
            scroll.isHidden = true; composer.isHidden = true
            flash("없는 글입니다.", error: true)
            return
        }
        scroll.isHidden = false
        composer.isHidden = false
        rightButton.isHidden = !canEdit
        pinBadge.isHidden = !p.pinned
        (pinBadge.superview as? UIStackView)?.isHidden = !p.pinned
        titleText.text = p.title
        let who = p.authorId.flatMap { people[$0] }?.label ?? ""
        metaLabel.text = "\(who.isEmpty ? "알 수 없음" : who) · \(AppDate.stamp(p.createdAt))"
        let para = NSMutableParagraphStyle()
        para.lineSpacing = 8
        bodyLabel.attributedText = NSAttributedString(string: p.body, attributes: [
            .font: UIFont.systemFont(ofSize: 16), .foregroundColor: AppSkin.text, .paragraphStyle: para
        ])
        bodyLabel.isHidden = p.body.isEmpty
        adminRow.isHidden = !isAdmin
        pinBtn.setTitle(p.pinned ? "고정 해제" : "맨 위에 고정", for: .normal)
        renderComments()
    }

    private func renderComments() {
        commentTitle.text = "댓글 \(comments.count)"
        commentList.arrangedSubviews.forEach { $0.removeFromSuperview() }
        if comments.isEmpty {
            let l = UILabel()
            l.text = "아직 댓글이 없습니다."
            l.font = .systemFont(ofSize: 12)
            l.textColor = AppSkin.faint
            commentList.addArrangedSubview(l)
            return
        }
        for (i, c) in comments.enumerated() {
            let row = CommentRow()
            let who = c.authorId.flatMap { people[$0] }
            row.fill(c, who: who, canDelete: isAdmin || c.authorId == service.config.user, first: i == 0)
            row.onDelete = { [weak self] in self?.deleteComment(c) }
            commentList.addArrangedSubview(row)
        }
    }

    // ── 위쪽 단추들 ─────────────────────────────────────────────

    @objc private func editTapped() { navigate("/board/\(postId)/edit") }

    @objc private func shareTapped() {
        guard let p = post, !busy else { return }
        confirm(title: "대화방에 올릴까요?",
                detail: "전체 대화방에 이 공지 카드가 올라가고, 회원들에게 알림도 갑니다.\n\(p.title)",
                ok: "올리기", danger: false) { [weak self] ok in
            guard ok, let self = self else { return }
            self.busy = true
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                defer { self.busy = false }
                /* 첫 줄이 흐린 머리말, 둘째 줄이 제목, 본문은 **첫 줄만 60자**(`LinkCard`). */
                var lines = ["\(self.me?.name ?? "누군가")님이 공지를 공유했습니다", p.title]
                if let lead = p.body.split(separator: "\n").map({ $0.trimmingCharacters(in: .whitespaces) }).first(where: { !$0.isEmpty }) {
                    lines.append(lead.count > 60 ? String(lead.prefix(60)) + "…" : lead)
                }
                do {
                    try await self.service.shareToChat(body: lines.joined(separator: "\n"),
                                                       extra: ["post_id": p.id, "notify": true],
                                                       drops: ["notify", "post_id"])
                    self.flash("대화방에 올렸습니다.")
                } catch {
                    self.flash(error.localizedDescription, error: true)
                }
            }
        }
    }

    @objc private func pinTapped() {
        guard let p = post, !busy else { return }
        busy = true
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.busy = false }
            do {
                try await self.service.setPinned(p.id, !p.pinned)
                self.loadScreen()
            } catch {
                self.flash(error.localizedDescription, error: true)
            }
        }
    }

    @objc private func deleteTapped() {
        guard let p = post, !busy else { return }
        let n = comments.count
        confirm(title: "이 글을 지울까요?",
                detail: n > 0 ? "댓글 \(n)개가 함께 사라집니다." : "되돌릴 수 없습니다.",
                ok: "지우기", danger: true) { [weak self] ok in
            guard ok, let self = self else { return }
            self.busy = true
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                defer { self.busy = false }
                do {
                    try await self.service.deleteRow("posts", id: p.id)
                    self.flash("지웠습니다.")
                    self.navigate("/board", replace: true)
                } catch {
                    self.flash(error.localizedDescription, error: true)
                }
            }
        }
    }

    // ── 댓글 ─────────────────────────────────────────────────────

    @objc private func sendTapped() {
        let text = field.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        busy = true
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            defer { self.busy = false }
            do {
                try await self.service.addComment(table: "post_comments", parentKey: "post_id", parentId: self.postId, body: text)
                self.field.text = ""
                self.textViewDidChange(self.field)
                self.comments = (try? await self.service.postComments(self.postId)) ?? self.comments
                self.renderComments()
                /* 방금 단 줄이 보이게 아래로 — 목록이 자란 뒤에 굴린다. */
                self.view.layoutIfNeeded()
                let y = max(0, self.scroll.contentSize.height - self.scroll.bounds.height + self.scroll.adjustedContentInset.bottom)
                self.scroll.setContentOffset(CGPoint(x: 0, y: y), animated: true)
            } catch {
                self.flash(error.localizedDescription, error: true)   // 실패하면 적은 글을 남긴다
            }
        }
    }

    private func deleteComment(_ c: AppComment) {
        guard !busy else { return }
        confirm(title: "댓글을 지울까요?", detail: "", ok: "지우기", danger: true) { [weak self] ok in
            guard ok, let self = self else { return }
            self.busy = true
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                defer { self.busy = false }
                do {
                    try await self.service.deleteRow("post_comments", id: c.id)
                    self.comments.removeAll { $0.id == c.id }
                    self.renderComments()
                } catch {
                    self.flash(error.localizedDescription, error: true)
                }
            }
        }
    }

    /// 적은 만큼 늘어난다(44~140) — 웹 `growDraft`와 같은 한도다.
    func textViewDidChange(_ textView: UITextView) {
        hint.isHidden = !textView.text.isEmpty || textView.isFirstResponder
        let fit = textView.sizeThatFits(CGSize(width: textView.bounds.width, height: .greatestFiniteMagnitude)).height
        let h = min(140, max(44, fit))
        textView.isScrollEnabled = fit > 140
        if fieldH?.constant != h { fieldH?.constant = h; view.layoutIfNeeded() }
    }
    /* 안내 글씨는 **초점이 가는 순간** 치운다(웹 규칙 그대로). */
    func textViewDidBeginEditing(_ textView: UITextView) { hint.isHidden = true }
    func textViewDidEndEditing(_ textView: UITextView) { hint.isHidden = !textView.text.isEmpty }
}

/**
 * 댓글 한 줄 — 얼굴(28pt) · 이름표 + 시각 · 본문 · (내 것이면) ✕.
 * 줄 사이는 가는 선이다(웹 `.comment + .comment`).
 */
final class CommentRow: UIView {
    private let face = AvatarView()
    private let nameLabel = UILabel()
    private let bodyLabel = UILabel()
    private let delBtn = UIButton(type: .system)
    private let rule = UIView()
    var onDelete: (() -> Void)?

    init() {
        super.init(frame: .zero)
        face.translatesAutoresizingMaskIntoConstraints = false
        face.backgroundColor = AppSkin.faint
        nameLabel.translatesAutoresizingMaskIntoConstraints = false
        nameLabel.numberOfLines = 1
        nameLabel.lineBreakMode = .byTruncatingTail
        bodyLabel.translatesAutoresizingMaskIntoConstraints = false
        bodyLabel.font = .systemFont(ofSize: 14)
        bodyLabel.textColor = AppSkin.text
        bodyLabel.numberOfLines = 0
        delBtn.translatesAutoresizingMaskIntoConstraints = false
        delBtn.setImage(UIImage(systemName: "xmark"), for: .normal)
        delBtn.tintColor = AppSkin.dim
        delBtn.accessibilityLabel = "댓글 지우기"
        delBtn.addTarget(self, action: #selector(delTapped), for: .touchUpInside)
        rule.backgroundColor = AppSkin.line
        rule.translatesAutoresizingMaskIntoConstraints = false
        addSubview(rule); addSubview(face); addSubview(nameLabel); addSubview(bodyLabel); addSubview(delBtn)
        NSLayoutConstraint.activate([
            rule.topAnchor.constraint(equalTo: topAnchor),
            rule.leadingAnchor.constraint(equalTo: leadingAnchor),
            rule.trailingAnchor.constraint(equalTo: trailingAnchor),
            rule.heightAnchor.constraint(equalToConstant: 1),
            face.leadingAnchor.constraint(equalTo: leadingAnchor),
            face.topAnchor.constraint(equalTo: topAnchor, constant: 10),
            face.widthAnchor.constraint(equalToConstant: 28),
            face.heightAnchor.constraint(equalToConstant: 28),
            nameLabel.leadingAnchor.constraint(equalTo: face.trailingAnchor, constant: 10),
            nameLabel.topAnchor.constraint(equalTo: topAnchor, constant: 10),
            nameLabel.trailingAnchor.constraint(lessThanOrEqualTo: delBtn.leadingAnchor, constant: -6),
            bodyLabel.leadingAnchor.constraint(equalTo: nameLabel.leadingAnchor),
            bodyLabel.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 3),
            bodyLabel.trailingAnchor.constraint(equalTo: delBtn.leadingAnchor, constant: -6),
            bodyLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
            delBtn.trailingAnchor.constraint(equalTo: trailingAnchor),
            delBtn.topAnchor.constraint(equalTo: topAnchor, constant: 4),
            delBtn.widthAnchor.constraint(equalToConstant: 36),
            delBtn.heightAnchor.constraint(equalToConstant: 36)
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    func fill(_ c: AppComment, who: AppProfile?, canDelete: Bool, first: Bool) {
        face.show(url: who?.avatar, letter: who?.name ?? "", edge: who?.edge, size: 28)
        let label = who?.label ?? ""
        let t = NSMutableAttributedString(string: label.isEmpty ? "알 수 없음" : label,
                                          attributes: [.font: UIFont.systemFont(ofSize: 14, weight: .bold), .foregroundColor: AppSkin.text])
        t.append(NSAttributedString(string: "  " + AppDate.ago(c.createdAt),
                                    attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: AppSkin.faint]))
        nameLabel.attributedText = t
        bodyLabel.text = c.body
        delBtn.isHidden = !canDelete
        rule.isHidden = first
    }

    @objc private func delTapped() { onDelete?() }
}
