package com.kkakkung.app.nativev2

import android.content.Context
import android.view.View
import android.widget.Switch
import org.json.JSONObject

/*
 * **공지 쓰기·고치기** — 아이폰 `PostEditViewController.swift`를 코틀린으로 옮긴 것이다.
 * 규칙이 그쪽(그리고 웹 `PostEdit.tsx`)과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - 새 글은 **운영진만**, 고치는 것은 **쓴 사람과 운영진**만 — 아니면 안내 한 줄만 뜬다.
 *  - 제목은 비울 수 없고 100자, 내용은 5000자까지.
 *  - `맨 위에 고정`은 운영진에게만 보인다.
 *  - 새로 올리면 그 글로 **바꿔치기**해 간다 — 쓰는 화면이 뒤에 남으면 뒤로 갔을 때 빈
 *    쓰기 화면이 또 뜬다. 고친 것은 **뒤로 가고**, 밑에 깔린 그 글을 다시 받는다.
 */
class PostEditScreen(ctx: Context, host: ScreenHost, private val given: JSONObject?) :
    FormScreen(ctx, host, if (given == null) "공지 쓰기" else "공지 수정") {
    private val titleField = textField("예) 9월 회비 안내", 100)
    private val bodyField = textArea(220, 5000)
    private var pinSwitch: Switch? = null
    private var role = "member"
    private val isAdmin get() = AppRole.isAdmin(role)
    private val saveTitle get() = if (given == null) "올리기" else "수정 저장"

    override fun load() {
        if (built) return
        spinner.visibility = View.VISIBLE
        launch {
            role = try { api.profile()?.strOrNull("role") ?: "member" } catch (_: Exception) { "member" }
            build()
        }
    }

    private fun build() {
        built = true
        val mayEdit = isAdmin || (given != null && given.strOrNull("author_id") == myId)
        if (!mayEdit) {
            showNotice(if (given != null) "내가 쓴 글만 고칠 수 있습니다." else "운영진만 공지를 쓸 수 있습니다.")
            return
        }
        titleField.setText(given?.str("title").orEmpty())
        bodyField.setText(given?.str("body").orEmpty())
        card(listOf(field("제목", titleField), field("내용", bodyField)))
        if (isAdmin) {
            val (row, sw) = switchRow("맨 위에 고정", "새 글이 올라와도 목록 맨 위에 남습니다", given?.optBoolean("pinned") ?: false)
            pinSwitch = sw
            card(listOf(row))
        }
        showForm(saveTitle)
    }

    override fun save() {
        if (saving) return
        val title = text(titleField)
        if (title.isEmpty()) { flash("제목을 적어 주세요.", error = true); return }
        val body = text(bodyField)
        val pinned = pinSwitch?.isChecked ?: given?.optBoolean("pinned") ?: false
        hideKeyboard()
        setSave(saveTitle, true)
        launch {
            try {
                if (given != null) {
                    api.updatePost(given.str("id"), title, body, pinned)
                    host.back(refreshBehind = true)
                } else {
                    val id = api.createPost(title, body, pinned)
                    host.replaceWith("/board/$id")
                }
            } catch (e: Exception) {
                setSave(saveTitle, false)
                flash(e.message ?: "저장하지 못했습니다.", error = true)
            }
        }
    }
}
