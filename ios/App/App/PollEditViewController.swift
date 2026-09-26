import UIKit

/*
 * **투표 만들기·고치기** — 웹 `screens/PollEdit.tsx`를 Swift로 옮긴 것이다
 * (`docs/아이폰-네이티브.md` 3단계). 주소는 `/polls/new`와 `/polls/<id>/edit`.
 *
 * **규칙은 웹과 같다 — 한쪽만 고치지 말 것:**
 *  - 누구나 올리고, 고치는 것은 **올린 사람과 운영진**만.
 *  - **표가 하나라도 들어오면 `익명`·`복수 선택`이 잠긴다** — 익명을 끄면
 *    비밀인 줄 알고 고른 사람이 드러나고, 복수를 끄면 두 표를 가진 사람이
 *    남는다. 제목·설명·마감 시각·항목 글자는 그대로 고친다.
 *  - 항목은 두 개 이상 · 같은 글자 두 번 안 됨. **두 줄까지 줄면 지우는 대신
 *    글자만 비운다.** 표가 있는 항목을 지우면 몇 표가 사라지는지 한 번 더 묻는다.
 *  - **마감 시각은 필수다.** 새로 올릴 때만 지난 시각을 막는다(고칠 때 지난
 *    시각을 넣는 것은 곧 '지금 닫는다'). 바로누름 셋(`3일 후`·`7일 후`·`2주 후`).
 *  - `📅 날짜로 항목 넣기` — 날을 누르면 `10월 4일 (일)` 항목이 되고 다시
 *    누르면 빠진다. **빈 줄부터 채운다.** 달력은 시스템 것(`UICalendarView`)이다.
 *  - 고칠 때는 안 바뀐 항목에 쓰기를 안 보내고, `sort`는 보이는 차례로 다시 매긴다.
 *  - 새로 올리다 항목이 실패하면 **껍데기 투표를 지운다.**
 */
final class PollEditViewController: FormScreenController {
    private struct Row {
        var id: String?
        var label: String
        var votes: Int
    }

    private let pollId: String?
    private var poll: AppPoll?
    private var role = "member"
    private var rows: [Row] = []
    private var initial: [Row] = []
    private var dropped: [String] = []
    /// 달력으로 넣은 날 — 글자로는 연도를 되찾을 수 없어 들고 있는다.
    private var known: [String: DateComponents] = [:]

    private let titleField = FormTextField(hint: "예) 9월 정기 라운드 날짜", max: 80)
    private let bodyField = FormTextView(minHeight: 70, max: 500)
    private let optionsStack = UIStackView()
    private var multiSwitch: UISwitch?
    private var anonSwitch: UISwitch?
    private let when = WhenPicker(hour: 21, minute: 0, quick: [("3일 후", 3), ("7일 후", 7), ("2주 후", 14)])
    private var selection: AnyObject?
    /// 달력의 대리자 — 그 규약이 iOS 16부터라 화면 자체에 달 수 없어 따로 둔다.
    private var calendarPick: AnyObject?

    private var locked: Bool { poll != nil && initial.reduce(0) { $0 + $1.votes } > 0 }

    init(service: NativeChatService, id: String?) {
        pollId = id
        super.init(service: service, title: id == nil ? "투표 만들기" : "투표 수정")
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadScreen() {
        guard !built else { return }
        spinner.startAnimating()
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            self.role = await self.service.myRole()
            if let id = self.pollId {
                do { self.poll = try await self.service.poll(id) }
                catch { self.showNotice(error.localizedDescription); return }
                guard let p = self.poll else { self.showNotice("없는 투표입니다."); return }
                self.initial = p.options.map { Row(id: $0.id, label: $0.label, votes: p.count($0.id)) }
            }
            self.build()
        }
    }

    private func build() {
        built = true
        if let p = poll, p.createdBy != service.config.user, !AppRole.isAdmin(role) {
            showNotice("올린 사람만 고칠 수 있습니다.")
            return
        }
        rows = initial.isEmpty ? [Row(label: "", votes: 0), Row(label: "", votes: 0)] : initial
        titleField.text = poll?.title ?? ""
        bodyField.setText(poll?.body ?? "")
        card([field("무엇을 물어볼까요?", titleField), field("설명 (선택)", bodyField)])

        optionsStack.axis = .vertical
        optionsStack.spacing = 8
        let add = UIButton(type: .system)
        appButton(add, title: "+ 항목 추가", color: AppSkin.dim, filled: false)
        add.setContentHuggingPriority(.defaultLow, for: .horizontal)
        add.addTarget(self, action: #selector(addTapped), for: .touchUpInside)
        var parts: [UIView] = [mkLabel("항목", size: 13, weight: .bold, color: AppSkin.dim), optionsStack, add]
        if #available(iOS 16.0, *) {
            let cal = UICalendarView()
            cal.calendar = WhenPicker.calendar
            cal.locale = Locale(identifier: "ko_KR")
            cal.timeZone = WhenPicker.seoul
            cal.tintColor = AppSkin.brand
            let pick = CalendarPick()
            pick.onSelect = { [weak self] dc in self?.daySelected(dc) }
            pick.onDeselect = { [weak self] dc in self?.dayDeselected(dc) }
            calendarPick = pick
            let sel = UICalendarSelectionMultiDate(delegate: pick)
            cal.selectionBehavior = sel
            selection = sel
            parts.append(mkLabel("📅 날짜로 항목 넣기", size: 14, weight: .bold))
            parts.append(cal)
            parts.append(mkLabel("누르면 바로 항목이 됩니다. 다시 누르면 빠집니다.", size: 12, color: AppSkin.faint, lines: 0))
        }
        if locked {
            parts.append(mkLabel("항목 글자를 고치면 이미 그 항목을 고른 분들의 표가 그대로 따라갑니다.", size: 12, color: AppSkin.faint, lines: 0))
        }
        card(parts, spacing: 10)

        let lockedDesc = "표가 들어와 바꿀 수 없습니다"
        let (mRow, mSw) = switchRow("복수 선택", desc: locked ? lockedDesc : "되는 날짜를 여러 개 고르게 할 때", on: poll?.multi ?? false)
        let (aRow, aSw) = switchRow("익명", desc: locked ? lockedDesc : "누가 무엇을 골랐는지 숨깁니다", on: poll?.anonymous ?? false)
        mSw.isEnabled = !locked; aSw.isEnabled = !locked
        multiSwitch = mSw; anonSwitch = aSw
        when.date = poll?.closesAt.map { NativeChatRows.date($0) }
        card([mRow, aRow, field("마감 시각", when)])

        renderRows()
        showForm(saveTitle: poll == nil ? "투표 올리기" : "저장")
    }

    // ── 항목 ─────────────────────────────────────────────────────

    private func renderRows() {
        optionsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for (i, r) in rows.enumerated() {
            let f = FormTextField(hint: "항목 \(i + 1)", max: 60)
            f.text = r.label
            f.tag = i
            f.accessibilityLabel = "항목 \(i + 1)"
            f.addTarget(self, action: #selector(labelChanged(_:)), for: .editingChanged)
            var views: [UIView] = [f]
            if r.votes > 0 {
                let v = mkLabel("\(r.votes)표", size: 12, color: AppSkin.faint)
                v.setContentHuggingPriority(.required, for: .horizontal)
                views.append(v)
            }
            let x = UIButton(type: .system)
            x.translatesAutoresizingMaskIntoConstraints = false
            x.setImage(UIImage(systemName: "xmark"), for: .normal)
            x.tintColor = AppSkin.dim
            x.isEnabled = rows.count > 2
            x.tag = i
            x.accessibilityLabel = "항목 \(i + 1) 지우기"
            x.addTarget(self, action: #selector(removeTapped(_:)), for: .touchUpInside)
            x.widthAnchor.constraint(equalToConstant: 40).isActive = true
            x.heightAnchor.constraint(equalToConstant: 44).isActive = true
            views.append(x)
            let row = UIStackView(arrangedSubviews: views)
            row.axis = .horizontal
            row.alignment = .center
            row.spacing = 6
            optionsStack.addArrangedSubview(row)
        }
        syncCalendar()
    }

    @objc private func labelChanged(_ f: UITextField) {
        guard rows.indices.contains(f.tag) else { return }
        rows[f.tag].label = f.text ?? ""
        syncCalendar()
    }

    @objc private func addTapped() {
        rows.append(Row(label: "", votes: 0))
        renderRows()
    }

    @objc private func removeTapped(_ b: UIButton) {
        guard rows.count > 2 else { return }
        dropRow(b.tag, then: nil)
    }

    /// 한 줄을 걷어낸다 — 두 줄까지 줄면 글자만 비운다. 표가 있으면 한 번 더 묻는다.
    private func dropRow(_ i: Int, then: ((Bool) -> Void)?) {
        guard rows.indices.contains(i) else { then?(false); return }
        let row = rows[i]
        let go = { [weak self] in
            guard let self = self else { return }
            if let id = row.id { self.dropped.append(id) }
            if self.rows.count <= 2 { self.rows[i] = Row(label: "", votes: 0) }
            else { self.rows.remove(at: i) }
            self.renderRows()
            then?(true)
        }
        if row.id != nil && row.votes > 0 {
            confirm(title: "'\(row.label)' 항목을 지울까요?",
                    detail: "이 항목에 들어온 \(row.votes)표가 함께 사라집니다.\n되돌릴 수 없습니다.",
                    ok: "지우기", danger: true) { ok in
                if ok { go() } else { then?(false) }
            }
        } else { go() }
    }

    /// 날짜 한 줄 넣기 — 같은 글자는 두 번 안 넣고, 빈 줄부터 채운다.
    private func addDate(_ label: String) {
        guard !label.isEmpty, !rows.contains(where: { $0.label.trimmingCharacters(in: .whitespaces) == label }) else { return }
        if let at = rows.firstIndex(where: { $0.label.trimmingCharacters(in: .whitespaces).isEmpty }) {
            rows[at] = Row(label: label, votes: 0)
        } else {
            rows.append(Row(label: label, votes: 0))
        }
        renderRows()
    }

    /// 달력의 칠 = 항목에 있는 날(웹 `marked`와 같은 잣대).
    private func syncCalendar() {
        guard #available(iOS 16.0, *), let sel = selection as? UICalendarSelectionMultiDate else { return }
        let labels = Set(rows.map { $0.label.trimmingCharacters(in: .whitespaces) })
        sel.setSelectedDates(known.filter { labels.contains($0.key) }.map { $0.value }, animated: false)
    }

    private func daySelected(_ dateComponents: DateComponents) {
        let label = WhenPicker.dayLabel(dateComponents)
        known[label] = dateComponents
        if let at = rows.firstIndex(where: { $0.label.trimmingCharacters(in: .whitespaces) == label }) {
            /* 이미 있는 글자(달력이 모르던 날) — 다시 누른 것으로 보고 뺀다. */
            dropRow(at) { [weak self] _ in self?.syncCalendar() }
        } else {
            addDate(label)
        }
    }

    private func dayDeselected(_ dateComponents: DateComponents) {
        let label = WhenPicker.dayLabel(dateComponents)
        guard let at = rows.firstIndex(where: { $0.label.trimmingCharacters(in: .whitespaces) == label }) else { return }
        dropRow(at) { [weak self] _ in self?.syncCalendar() }
    }

    // ── 저장 ─────────────────────────────────────────────────────

    override func saveTapped() {
        guard !saving else { return }
        view.endEditing(true)
        let title = (titleField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let kept = rows.map { Row(id: $0.id, label: $0.label.trimmingCharacters(in: .whitespacesAndNewlines), votes: $0.votes) }
            .filter { !$0.label.isEmpty }
        guard !title.isEmpty else { flash("제목을 적어 주세요.", error: true); return }
        guard kept.count >= 2 else { flash("항목을 두 개 이상 적어 주세요.", error: true); return }
        guard Set(kept.map { $0.label }).count == kept.count else { flash("같은 항목이 두 번 있습니다.", error: true); return }
        guard let closes = when.date else { flash("마감 시각을 정해 주세요.", error: true); return }
        if poll == nil && closes <= Date() { flash("마감 시각이 이미 지났습니다. 다시 골라 주세요.", error: true); return }

        let fields: ChatJSON = [
            "title": title,
            "body": bodyField.text.trimmingCharacters(in: .whitespacesAndNewlines),
            "multi": multiSwitch?.isOn ?? false,
            "anonymous": anonSwitch?.isOn ?? false,
            "closes_at": WhenPicker.iso(closes)
        ]
        let saveTitle = poll == nil ? "투표 올리기" : "저장"
        setSave(saveTitle, busy: true)
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                if let p = self.poll {
                    try await self.service.patchRow("polls", id: p.id, fields)
                    if !self.dropped.isEmpty { try await self.service.deleteRows("poll_options", ids: self.dropped) }
                    for (i, r) in kept.enumerated() {
                        if let id = r.id {
                            /* 안 바뀐 줄에는 쓰기를 안 보낸다(글자도 차례도 그대로면). */
                            if let at = self.initial.firstIndex(where: { $0.id == id }),
                               self.initial[at].label == r.label, at == i { continue }
                            try await self.service.patchRow("poll_options", id: id, ["label": r.label, "sort": i])
                        } else {
                            _ = try await self.service.insertRows("poll_options", [["poll_id": p.id, "label": r.label, "sort": i]])
                        }
                    }
                    self.flash("고쳤습니다.")
                    self.goBack()
                } else {
                    var row = fields
                    row["created_by"] = self.service.config.user
                    guard let id = try await self.service.insertRows("polls", [row]).first?["id"] as? String else {
                        throw NativeChatError(message: "올리지 못했습니다. 다시 시도해 주세요.")
                    }
                    do {
                        _ = try await self.service.insertRows("poll_options",
                            kept.enumerated().map { ["poll_id": id, "label": $0.element.label, "sort": $0.offset] })
                    } catch {
                        /* 항목이 없는 투표는 쓸모가 없다 — 껍데기를 남기지 않는다. */
                        try? await self.service.deleteRow("polls", id: id)
                        throw error
                    }
                    self.flash("투표를 올렸습니다.")
                    self.navigate("/polls", replace: true)   // 웹과 같다 — 목록으로
                }
            } catch {
                self.setSave(saveTitle, busy: false)
                self.flash(error.localizedDescription, error: true)
            }
        }
    }
}

/// `UICalendarSelectionMultiDate`의 대리자 — 누른 날·뗀 날을 화면에 넘긴다.
@available(iOS 16.0, *)
final class CalendarPick: NSObject, UICalendarSelectionMultiDateDelegate {
    var onSelect: ((DateComponents) -> Void)?
    var onDeselect: ((DateComponents) -> Void)?
    func multiDateSelection(_ selection: UICalendarSelectionMultiDate, didSelectDate dateComponents: DateComponents) {
        onSelect?(dateComponents)
    }
    func multiDateSelection(_ selection: UICalendarSelectionMultiDate, didDeselectDate dateComponents: DateComponents) {
        onDeselect?(dateComponents)
    }
}
