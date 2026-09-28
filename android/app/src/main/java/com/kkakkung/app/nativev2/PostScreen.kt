package com.kkakkung.app.nativev2

import android.content.Context
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import org.json.JSONObject

/*
 * **공지 상세 + 댓글** — 아이폰 `PostViewController.swift`를 코틀린으로 옮긴 것이다.
 * 생김새·말·규칙이 그쪽과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - `수정`은 올린 사람과 운영진(머리말 오른쪽).
 *  - `📣 대화방에 공유`는 누구나 — `system` 글 + `post_id` + `notify`, 없는 칸은 하나씩 빼며
 *    다시 넣는다. 본문은 **첫 줄만 60자**.
 *  - `맨 위에 고정`·`지우기`는 운영진만. 지울 때 댓글 수를 세어 한 번 더 묻는다.
 *  - 댓글은 누구나 달고, 지우는 것은 쓴 사람과 운영진. 댓글 칸은 카드 안에 그대로 선다.
 */
class PostScreen(ctx: Context, host: ScreenHost, private val postId: String) : NativeScreen(ctx, host, "공지") {
    private val scroll: ScrollView
    private val stack: LinearLayout
    private val commentInput = CommentInput(ui)

    private var post: JSONObject? = null
    private var comments: List<AppComment> = emptyList()
    private var people: Map<String, AppProfile> = emptyMap()

    private val me get() = people[myId]
    private val isAdmin get() = AppRole.isAdmin(me?.role ?: "member")
    private val canEdit get() = isAdmin || post?.strOrNull("author_id") == myId

    init {
        val (s, st) = scrollStack(); scroll = s; stack = st
        stack.setPadding(ui.dp(16), ui.dp(4), ui.dp(16), ui.dp(24))
        rightButton.text = "수정"
        rightButton.setTextColor(AppSkin.text)
        rightButton.setOnClickListener { post?.let { host.editPost(it) } }
        body.addView(scroll, 0, FrameLayout.LayoutParams(-1, -1))
        scroll.visibility = View.GONE
        commentInput.onSend = { send(it) }
    }

    override fun load() {
        if (post == null) spinner.visibility = View.VISIBLE
        launch {
            try {
                val p = api.post(postId)
                comments = api.postComments(postId).map(::AppComment)
                people = api.people().associate { it.str("id") to AppProfile(it) }
                post = p
                render()
            } catch (e: Exception) {
                flash(e.message ?: "불러오지 못했습니다.", error = true)
            }
            spinner.visibility = View.GONE
        }
    }

    private fun render() {
        val p = post ?: run { scroll.visibility = View.GONE; flash("없는 글입니다.", error = true); return }
        scroll.visibility = View.VISIBLE
        rightButton.visibility = if (canEdit) View.VISIBLE else View.GONE
        (commentInput.parent as? android.view.ViewGroup)?.removeView(commentInput)
        stack.removeAllViews()

        val pinned = p.optBoolean("pinned")
        /* 고정 표 — 노랑은 '기다리는 것'(`.badge warn`). */
        if (pinned) stack.addView(ui.hrow(listOf(ui.badge("고정", Ui.Badge.WARN))))
        stack.addView(ui.label(p.str("title"), 20f, bold = true, lines = 0))
        val who = p.strOrNull("author_id")?.let { people[it]?.label }.orEmpty()
        /* 제목과 사이는 4(스택 사이 10에서 6을 뺀다) — 아이폰 `setCustomSpacing(4)`. */
        stack.addView(ui.label("${who.ifEmpty { "알 수 없음" }} · ${AppDate.stamp(p.str("created_at"))}", 12f, color = AppSkin.faint),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = -ui.dp(6) })
        val text = p.str("body")
        if (text.isNotEmpty()) stack.addView(ui.label(text, 16f, lines = 0).apply { setLineSpacing(ui.dpf(8f), 1f) },
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(6) })

        // 📣 대화방에 공유 — 오른쪽 끝
        stack.addView(LinearLayout(ctx).apply {
            gravity = android.view.Gravity.END
            addView(ui.button("📣 대화방에 공유") { share() })
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(6) })

        if (isAdmin) {
            val row = ui.hrow(listOf(
                ui.button(if (pinned) "고정 해제" else "맨 위에 고정") { pin() },
                ui.button("지우기", AppSkin.danger, filled = true) { deletePost() }
            ), spacing = 10)
            stack.addView(row)
        }

        // 댓글 카드
        val card = ui.card().apply { setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
        val list = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        card.addView(ui.sectionTitle("댓글 ${comments.size}"))
        if (comments.isEmpty()) list.addView(ui.label("아직 댓글이 없습니다.", 12f, color = AppSkin.faint))
        comments.forEachIndexed { i, c ->
            list.addView(commentRow(ui, c, c.authorId?.let { people[it] }, isAdmin || c.authorId == myId, i == 0) { deleteComment(c) })
        }
        card.addView(list, LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(6) })
        card.addView(commentInput, LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(10) })
        stack.addView(card, LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(4) })
    }

    private fun share() {
        val p = post ?: return
        if (busy) return
        confirm("대화방에 올릴까요?", "전체 대화방에 이 공지 카드가 올라가고, 회원들에게 알림도 갑니다.\n${p.str("title")}", "올리기", false) {
            busy = true
            launch {
                /* 첫 줄이 흐린 머리말, 둘째 줄이 제목, 본문은 **첫 줄만 60자**(`LinkCard`). */
                val lines = mutableListOf("${me?.name?.ifEmpty { null } ?: "누군가"}님이 공지를 공유했습니다", p.str("title"))
                p.str("body").split("\n").map { it.trim() }.firstOrNull { it.isNotEmpty() }?.let {
                    lines.add(if (it.length > 60) it.take(60) + "…" else it)
                }
                try {
                    api.shareToChat(lines.joinToString("\n"), JSONObject().put("post_id", p.str("id")).put("notify", true), listOf("notify", "post_id"))
                    flash("대화방에 올렸습니다.")
                } catch (e: Exception) { flash(e.message ?: "올리지 못했습니다.", error = true) }
                busy = false
            }
        }
    }

    private fun pin() {
        val p = post ?: return
        act { api.togglePostPin(p.str("id"), !p.optBoolean("pinned")) }
    }

    private fun deletePost() {
        val p = post ?: return
        if (busy) return
        val n = comments.size
        confirm("이 글을 지울까요?", if (n > 0) "댓글 ${n}개가 함께 사라집니다." else "되돌릴 수 없습니다.", "지우기", true) {
            busy = true
            launch {
                try { api.deletePost(p.str("id")); busy = false; host.back(refreshBehind = true) }
                catch (e: Exception) { busy = false; flash(e.message ?: "지우지 못했습니다.", error = true) }
            }
        }
    }

    private fun send(text: String) {
        if (busy) return
        busy = true
        launch {
            try {
                api.addComment("post_comments", "post_id", postId, text)
                commentInput.clear()
                comments = try { api.postComments(postId).map(::AppComment) } catch (_: Exception) { comments }
                render()
                scroll.post { scroll.smoothScrollTo(0, stack.height) }
            } catch (e: Exception) {
                flash(e.message ?: "올리지 못했습니다.", error = true)   // 실패하면 적은 글을 남긴다
            }
            busy = false
        }
    }

    private fun deleteComment(c: AppComment) {
        if (busy) return
        confirm("댓글을 지울까요?", "", "지우기", true) {
            busy = true
            launch {
                try { api.deleteRow("post_comments", c.id); comments = comments.filter { it.id != c.id }; render() }
                catch (e: Exception) { flash(e.message ?: "지우지 못했습니다.", error = true) }
                busy = false
            }
        }
    }
}
