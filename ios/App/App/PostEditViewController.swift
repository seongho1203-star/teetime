import UIKit

/*
 * **공지 쓰기·고치기** — 웹 `screens/PostEdit.tsx`를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 3단계). 주소는 `/board/new`와 `/board/<id>/edit`.
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - 새 글은 **운영진만**, 고치는 것은 **쓴 사람과 운영진**만 — 아니면 안내
 *    한 줄만 뜬다(DB 정책도 같게 막혀 있다).
 *  - 제목은 비울 수 없고 100자, 내용은 5000자까지.
 *  - `맨 위에 고정`은 운영진에게만 보인다.
 *  - 새로 올리면 그 글로 **바꿔치기**해 간다(`replace`) — 쓰는 화면이
 *    히스토리에 남으면 뒤로 갔을 때 빈 쓰기 화면이 또 뜬다. 고친 것은
 *    **뒤로 간다** — 밑에 깔린 그 글이 돌아올 때 다시 받는다.
 */
final class PostEditViewController: FormScreenController {
    private let postId: String?
    private var post: AppPost?
    private var role = "member"

    private let titleField = FormTextField(hint: "예) 9월 회비 안내", max: 100)
    private let bodyField = FormTextView(minHeight: 220, max: 5000)
    private var pinSwitch: UISwitch?

    private var isAdmin: Bool { AppRole.isAdmin(role) }

    init(service: NativeChatService, id: String?) {
        postId = id
        super.init(service: service, title: id == nil ? "공지 쓰기" : "공지 수정")
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadScreen() {
        guard !built else { return }
        spinner.startAnimating()
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            self.role = await self.service.myRole()
            if let id = self.postId {
                do { self.post = try await self.service.post(id) }
                catch { self.showNotice(error.localizedDescription); return }
                if self.post == nil { self.showNotice("없는 글입니다."); return }
            }
            self.build()
        }
    }

    private func build() {
        built = true
        let mayEdit = isAdmin || (post != nil && post?.authorId == service.config.user)
        guard mayEdit else {
            showNotice(postId != nil ? "내가 쓴 글만 고칠 수 있습니다." : "운영진만 공지를 쓸 수 있습니다.")
            return
        }
        titleField.text = post?.title ?? ""
        bodyField.setText(post?.body ?? "")
        bodyField.onChange = { [weak self] in
            guard let self = self, let end = self.bodyField.selectedTextRange?.end else { return }
            self.reveal(self.bodyField, rect: self.bodyField.caretRect(for: end))
        }
        card([field("제목", titleField), field("내용", bodyField)])
        if isAdmin {
            let (row, sw) = switchRow("맨 위에 고정", desc: "새 글이 올라와도 목록 맨 위에 남습니다", on: post?.pinned ?? false)
            pinSwitch = sw
            card([row])
        }
        showForm(saveTitle: post == nil ? "올리기" : "수정 저장")
    }

    override func saveTapped() {
        guard !saving else { return }
        let title = (titleField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { flash("제목을 적어 주세요.", error: true); return }
        let bodyText = bodyField.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let pinned = pinSwitch?.isOn ?? post?.pinned ?? false
        view.endEditing(true)
        let saveTitle = post == nil ? "올리기" : "수정 저장"
        setSave(saveTitle, busy: true)
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                if let p = self.post {
                    try await self.service.updatePost(p.id, title: title, body: bodyText, pinned: pinned)
                    self.flash("수정했습니다.")
                    self.goBack()
                } else {
                    let id = try await self.service.insertPost(title: title, body: bodyText, pinned: pinned)
                    self.flash("올렸습니다.")
                    self.navigate("/board/\(id)", replace: true)
                }
            } catch {
                self.setSave(saveTitle, busy: false)
                self.flash(error.localizedDescription, error: true)
            }
        }
    }
}
