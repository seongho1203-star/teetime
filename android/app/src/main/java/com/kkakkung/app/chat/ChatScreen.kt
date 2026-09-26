package com.kkakkung.app.chat

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.text.style.ForegroundColorSpan
import android.view.inputmethod.BaseInputConnection
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.kkakkung.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

/**
 * 대화 화면 전체 — 아이폰 `NativeChatViewController`의 몫이다.
 *
 * 머리말(`←` · 🔍 · ☰) · 말풍선 목록 · 글칸 한 줄. **1단계는 목록·보내기·
 * 읽음·실시간·카드 이동·뒤로**까지다(`docs/안드로이드-네이티브.md`).
 *
 * 웹뷰 위에 통째로 얹힌다(`NativeChatPlugin`). 웹에 남는 것은 자리를
 * 지키는 스피너 한 장이라 여기가 대화의 전부다.
 */
class ChatScreen(private val activity: AppCompatActivity, val service: ChatService)
    : FrameLayout(activity), com.kkakkung.app.nav.NavLayer.NavPage {
    /** 뒤로 끌기는 글칸 위에서 시작하지 않는다. 키보드 글 선택 손짓을 지킨다. */
    override fun freeAt(x: Float, y: Float): Boolean {
        val r = android.graphics.Rect()
        if (!composer.getGlobalVisibleRect(r)) return true
        val loc = IntArray(2); getLocationOnScreen(loc)
        return !r.contains((x + loc[0]).toInt(), (y + loc[1]).toInt())
    }

    /** Native V2 shell로 보내는 소식(`navigate`·`read`·`auth`·`back`). */
    var event: ((String, JSONObject) -> Unit)? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val column = LinearLayout(activity)
    private val header = LinearLayout(activity)
    private val backBtn = ImageView(activity)
    private val list = ChatListView(activity)
    private val status = TextView(activity)
    private val mentionPanel = LinearLayout(activity)
    private val composer = LinearLayout(activity)
    private val input = EditText(activity)
    private val sendBtn = ImageView(activity)

    private var room = ""
    private var people: List<JSONObject> = emptyList()
    private var messages: ArrayList<ChatMessage> = ArrayList()
    private var reads: Map<String, String> = emptyMap()
    private var reactions: List<JSONObject> = emptyList()
    private var unread: String? = null
    private var loaded = false
    private var hasMore = false
    private var loadingMore = false
    private var busy = false
    private var lastRead = ""
    private var visible = false
    private var navigating = false
    private var realtime: ChatRealtime? = null
    private var loadJob: Job? = null
    private var readJob: Job? = null
    private var metaJob: Job? = null
    private var syncJob: Job? = null
    private var softInputBefore: Int? = null
    private val stage2 get() = ChatCatchup.stage2(activity)
    private var pullY = 0f
    private var lastIme = false
    private var navColorBefore: Int? = null
    private var mentionStart = -1
    private var mentionEnd = -1
    private var paintingMentions = false

    init {
        setBackgroundColor(ChatSkin.bg)
        column.orientation = LinearLayout.VERTICAL
        addView(column, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        /* 머리말 — 제목이 없다(사용자 요청 — `채팅 좌측상단 전체대화 삭제해줘`).
           왼쪽에 `←` 하나, 오른쪽의 🔍·☰은 3단계에서 온다. */
        header.orientation = LinearLayout.HORIZONTAL
        header.gravity = Gravity.CENTER_VERTICAL
        header.setBackgroundColor(ChatSkin.head)
        backBtn.setImageResource(R.drawable.ic_chat_back)
        backBtn.scaleType = ImageView.ScaleType.CENTER
        backBtn.contentDescription = "뒤로"
        backBtn.setOnClickListener { goBack() }
        header.addView(backBtn, LinearLayout.LayoutParams(dp(44f), dp(44f)).apply { leftMargin = dp(8f) })
        column.addView(header, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52f)))

        val body = FrameLayout(activity)
        body.addView(list, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        status.setTextColor(Color.WHITE); status.textSize = 15f; status.gravity = Gravity.CENTER
        status.setPadding(dp(16f), dp(8f), dp(16f), dp(8f))
        status.setOnClickListener { startLoad() }
        body.addView(status, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.CENTER })
        column.addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        /* 2-2 @언급 카드 — 흰 카드만 떠 있고 그 뒤는 대화 보라다. */
        mentionPanel.orientation = LinearLayout.VERTICAL
        mentionPanel.visibility = View.GONE
        mentionPanel.setPadding(dp(10f), dp(6f), dp(10f), dp(6f))
        mentionPanel.background = GradientDrawable().apply {
            cornerRadius = dp(16f).toFloat(); setColor(Color.WHITE)
        }
        column.addView(mentionPanel, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { leftMargin = dp(10f); rightMargin = dp(10f); bottomMargin = dp(4f) })

        /* 글칸 줄 — 카톡처럼 뒤에 판을 안 깔고(보라 그대로) 흰 알약 하나가 뜬다.
           한 줄 48 · 둥글기 24 (CLAUDE.md `글칸 한 줄은 48px`). */
        composer.orientation = LinearLayout.HORIZONTAL
        composer.gravity = Gravity.BOTTOM
        composer.setBackgroundColor(ChatSkin.bg)
        /* 문서 2-2: 뒤에 흰 판/위 선 없이 보라가 그대로 보인다.
           한 줄 글칸은 정확히 48dp, radius 24. */
        composer.setPadding(dp(6f), dp(6f), dp(6f), dp(6f))
        input.background = GradientDrawable().apply { cornerRadius = dp(24f).toFloat(); setColor(ChatSkin.bubble) }
        input.setTextColor(ChatSkin.text); input.textSize = 16f
        input.setHintTextColor(0xFF9AA090.toInt()); input.hint = "메시지"
        input.minHeight = dp(48f); input.maxHeight = dp(120f); input.maxLines = 5
        input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        input.setPadding(dp(16f), dp(10f), dp(16f), dp(10f))
        composer.addView(input, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = dp(6f) })
        sendBtn.setImageResource(R.drawable.ic_chat_send_up)
        sendBtn.scaleType = ImageView.ScaleType.CENTER
        sendBtn.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(ChatSkin.brand) }
        sendBtn.contentDescription = "보내기"
        sendBtn.setOnClickListener { send() }
        composer.addView(sendBtn, LinearLayout.LayoutParams(dp(34f), dp(34f)).apply { bottomMargin = dp(7f) })
        column.addView(composer, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(x: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(x: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(e: Editable?) {
                if (!stage2 || e == null || paintingMentions) return
                /* 한글 조합 중에는 범위/색/글을 손대지 않는다. */
                if (BaseInputConnection.getComposingSpanStart(e) >= 0) return
                paintMentionText(e)
                updateMentionCard()
            }
        })

        /* 상태 막대와 홈/제스처 영역만 피한다.
         *
         * **IME 높이를 여기서 또 padding 하면 안 된다.** Activity는 manifest에서
         * `adjustResize`라 키보드가 올라올 때 이 ChatScreen이 이미 키보드 윗선까지
         * 줄어든다. 그런데 예전 코드는 그 줄어든 화면 안에서 `ime.bottom`만큼을
         * **한 번 더** 비워 입력창과 키보드 사이에 키보드 높이만 한 틈을 만들었다.
         * (사용자 제보 — "입력창과 키보드가 붙어있지 않는 것 같아")
         *
         * 키보드가 보일 때는 화면 바닥 자체가 곧 IME 윗선이므로 bottom=0.
         * 키보드가 없을 때만 navigation/system bar만큼 안전 여백을 둔다.
         * Android 공식 권장도 adjustResize + WindowInsets로 IME 상태를 관찰하되,
         * 부모 ViewGroup에서 IME inset을 중복 소비하지 않는 방식이다. */
        ViewCompat.setOnApplyWindowInsetsListener(this) { v, ins ->
            val bars = ins.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = ins.getInsets(WindowInsetsCompat.Type.ime())
            val imeVisible = ins.isVisible(WindowInsetsCompat.Type.ime())
            val nativeV2 = activity.javaClass.name.endsWith(".nativev2.NativeHomeActivity")

            if (nativeV2) {
                v.setPadding(0, 0, 0, 0)
            } else {
                /* 하이브리드 Activity는 adjustResize가 IME 윗선까지 창을 줄인다.
                   키보드가 없을 때만 system bar를 피한다. */
                v.setPadding(0, bars.top, 0, if (imeVisible) 0 else bars.bottom)
            }
            if (stage2 && imeVisible != lastIme) {
                val wasBottom = list.atBottom
                lastIme = imeVisible
                if (wasBottom) list.post { list.scrollToBottom(false) }
            }
            ins
        }
        ViewCompat.requestApplyInsets(this)

        /* 2-2: 목록을 아래로 끌면 키보드를 내린다. RecyclerView의
           스크롤 자체는 가로채지 않고 ACTION_UP에서만 판단한다. */
        list.setOnTouchListener { _, e ->
            if (stage2) {
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> pullY = e.rawY
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        if (e.rawY - pullY >= dp(28f)) hideKeyboard()
                    }
                }
            }
            false
        }

        list.onCard = { path -> navigate(path) }
        list.onQuote = { id -> list.scrollTo(id) }
        list.onPhoto = { url -> openOutside(url) }
        list.onTop = { loadMore() }
        list.onBottom = { bottom -> if (bottom) markRead() }
    }

    val me: String get() = service.config.user
    private fun dp(v: Float): Int = context.dp(v)

    // ── 열고 닫기 ──────────────────────────────────────────────

    fun attach(parent: ViewGroup) {
        if (this.parent == null) parent.addView(this, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (Build.VERSION.SDK_INT < 30) {
            softInputBefore = activity.window.attributes.softInputMode
            activity.window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        visible = true; navigating = false
        if (stage2 && navColorBefore == null) {
            navColorBefore = activity.window.navigationBarColor
            activity.window.navigationBarColor = ChatSkin.bg
        }
        if (!loaded) startLoad() else { realtime?.start(); sync(); markRead() }
        ViewCompat.requestApplyInsets(this)
    }

    fun detach() {
        visible = false
        hideMentionCard()
        hideKeyboard()
        navColorBefore?.let { activity.window.navigationBarColor = it; navColorBefore = null }
        realtime?.stop()
        softInputBefore?.let { activity.window.setSoftInputMode(it); softInputBefore = null }
        (parent as? ViewGroup)?.removeView(this)
    }

    fun destroy() {
        detach(); loadJob?.cancel(); scope.cancel()
    }

    fun updateToken(token: String) {
        service.config.token = token
        realtime?.updateToken()
    }

    private class MentionPaint(color: Int) : ForegroundColorSpan(color)

    private fun mentionNames(): List<Pair<String, String>> =
        people.mapNotNull { p ->
            val name = p.optString("name")
            if (name.isBlank()) null else name to ChatRows.label(p).ifBlank { name }
        }.distinctBy { it.first }.sortedByDescending { it.first.length }

    private fun paintMentionText(e: Editable) {
        e.getSpans(0, e.length, MentionPaint::class.java).forEach { e.removeSpan(it) }
        val mineName = people.firstOrNull { it.optString("id") == me }?.optString("name").orEmpty()
        val text = e.toString()
        for ((name, _) in mentionNames()) {
            var from = 0
            val token = "@$name"
            while (from < text.length) {
                val at = text.indexOf(token, from)
                if (at < 0) break
                e.setSpan(
                    MentionPaint(if (name == mineName) 0xFFD92B8E.toInt() else 0xFF2C7BD4.toInt()),
                    at, at + token.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
                )
                from = at + token.length
            }
        }
    }

    private fun updateMentionCard() {
        if (!stage2 || !input.hasFocus()) { hideMentionCard(); return }
        val text = input.text.toString()
        val caret = input.selectionStart.coerceIn(0, text.length)
        val before = text.substring(0, caret)
        val at = before.lastIndexOf('@')
        if (at < 0 || (at > 0 && !before[at - 1].isWhitespace())) { hideMentionCard(); return }
        val query = before.substring(at + 1)
        if (query.contains(' ') || query.contains('\n') || query.length > 12) { hideMentionCard(); return }
        mentionStart = at; mentionEnd = caret
        val hits = mentionNames().filter { (name, label) ->
            name.contains(query, ignoreCase = true) || label.contains(query, ignoreCase = true)
        }.take(6)
        showMentionCard(hits)
    }

    private fun showMentionCard(items: List<Pair<String, String>>) {
        mentionPanel.removeAllViews()
        if (items.isEmpty()) { mentionPanel.visibility = View.GONE; return }
        val text = input.text.toString()
        for ((name, label) in items) {
            val selected = text.contains("@$name")
            val row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(10f), dp(7f), dp(8f), dp(7f))
                isClickable = true
                setOnClickListener { toggleMention(name) }
            }
            row.addView(TextView(activity).apply {
                this.text = label; textSize = 14f; setTextColor(ChatSkin.text)
                typeface = Typeface.DEFAULT_BOLD
            }, LinearLayout.LayoutParams(0, dp(30f), 1f))
            if (selected) row.addView(ImageView(activity).apply {
                setImageResource(R.drawable.ic_chat_check)
                contentDescription = "선택됨"
            }, LinearLayout.LayoutParams(dp(24f), dp(24f)))
            mentionPanel.addView(row)
        }
        mentionPanel.visibility = View.VISIBLE
    }

    private fun toggleMention(name: String) {
        if (mentionStart < 0 || mentionEnd < mentionStart) return
        val original = input.text.toString()
        val token = "@$name"
        var out = original
        var caret: Int

        val existing = out.indexOf(token)
        if (existing >= 0 && existing !in mentionStart until maxOf(mentionEnd, mentionStart + 1)) {
            var end = existing + token.length
            if (end < out.length && out[end] == ' ') end++
            out = out.removeRange(existing, end)
            var s = mentionStart
            var e = mentionEnd
            val cut = end - existing
            if (existing < s) { s -= cut; e -= cut }
            if (e > s && e <= out.length) out = out.removeRange(s, e)
            caret = s.coerceIn(0, out.length)
        } else {
            val replacement = "$token "
            out = out.replaceRange(mentionStart, mentionEnd, replacement)
            caret = mentionStart + replacement.length
        }

        paintingMentions = true
        input.setText(out)
        input.setSelection(caret.coerceIn(0, input.text.length))
        paintMentionText(input.text)
        paintingMentions = false

        /* 고른 뒤에도 목록을 남겨 이어 고른다. */
        mentionStart = input.selectionStart
        mentionEnd = mentionStart
        showMentionCard(mentionNames().take(6))
        input.requestFocus()
    }

    private fun hideMentionCard() {
        mentionStart = -1; mentionEnd = -1
        mentionPanel.visibility = View.GONE
    }

    private fun hideKeyboard() {
        val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
        imm?.hideSoftInputFromWindow(windowToken, 0)
        input.clearFocus()
    }

    /** `←`·안드로이드 뒤로 — 갈 곳은 웹이 정한다(히스토리가 비었으면 홈). */
    fun goBack() {
        if (navigating) return
        navigating = true
        hideKeyboard()
        event?.invoke("back", JSONObject().put("phase", "plain"))
    }

    private fun navigate(path: String) {
        if (navigating) return
        navigating = true
        hideKeyboard()
        event?.invoke("navigate", JSONObject().put("path", path).put("shot", ""))
    }

    private fun openOutside(url: String) {
        try {
            val i = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(httpsUrl(url)))
            activity.startActivity(i)
        } catch (e: Exception) { notice("사진을 열지 못했습니다.") }
    }

    private fun notice(text: String) { Toast.makeText(activity, text, Toast.LENGTH_SHORT).show() }

    // ── 불러오기 ───────────────────────────────────────────────

    private fun startLoad() {
        if (!visible) return
        loadJob?.cancel()
        status.visibility = View.VISIBLE; status.text = "대화를 불러오는 중…"
        loadJob = scope.launch {
            try {
                val r = async { service.room() }
                val p = async { service.people() }
                val roomRow = r.await(); people = p.await()
                room = roomRow.optString("id")
                val latest = service.messages(room, limit = 100)
                messages = ArrayList(latest.reversed()); hasMore = latest.size == 100
                reads = try { service.reads(room) } catch (e: Exception) { emptyMap() }
                reactions = try { service.reactions(realIDs()) } catch (e: Exception) { emptyList() }
                val seen = Iso.ms(service.config.seen)
                if (seen > Iso.ms("1970-01-02T00:00:00Z")) {
                    val first = messages.indexOfFirst { Iso.ms(it.at) > seen && it.user != me }
                    if (first > 0) unread = messages[first].id
                }
                loaded = true
                status.visibility = View.GONE
                render(keepBottom = false)
                val u = unread
                if (u != null) list.scrollTo(u) else list.scrollToBottom(false)
                installRealtime(); markRead()
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) return@launch
                status.visibility = View.VISIBLE
                status.text = (e.message ?: "불러오지 못했습니다.") + "\n눌러서 다시 시도"
            }
        }
    }

    private fun installRealtime() {
        realtime?.stop()
        val ch = ChatRealtime(service, room)
        ch.changed = { d -> changed(d) }
        ch.connected = { sync() }
        realtime = ch
        if (visible) ch.start()
    }

    private fun merge(rows: List<ChatMessage>) {
        val byID = LinkedHashMap<String, ChatMessage>()
        for (m in messages) byID[m.id] = m
        for (m in rows) byID[m.id] = m
        messages = ArrayList(byID.values.sortedWith(compareBy({ Iso.ms(it.at) }, { it.id })))
    }

    private fun render(keepBottom: Boolean) {
        val rows = ChatRows.make(messages, me, people, reads, reactions, unread)
        list.submit(rows, keepBottom && list.atBottom)
    }

    private fun changed(d: JSONObject) {
        if (!visible) return
        if (d.optString("table") == "messages") {
            val raw = d.optJSONObject("record") ?: JSONObject()
            val old = d.optJSONObject("old_record") ?: JSONObject()
            if (d.optString("type") == "DELETE") {
                val gone = old.optString("id"); messages.removeAll { it.id == gone }
            } else if (raw.optString("room_id") == room && raw.optString("id").isNotEmpty()) {
                merge(listOf(ChatMessage(raw)))
            }
            render(keepBottom = true); markRead()
        }
        metaJob?.cancel()
        metaJob = scope.launch {
            delay(250)
            try {
                reads = service.reads(room)
                reactions = service.reactions(realIDs())
                render(keepBottom = true)
            } catch (e: Exception) { /* 다시 이을 때의 sync가 또 받는다 */ }
        }
    }

    /** 다시 이었을 때 — 떠나 있던 동안 온 글을 마지막 글 뒤로 받아 온다. */
    private fun sync() {
        if (!visible || !loaded || syncJob != null) return
        val tail = messages.lastOrNull()
        syncJob = scope.launch {
            try {
                var more = true
                var from = tail
                while (more) {
                    val filters = if (from != null)
                        listOf("or" to "(created_at.gt.${from.at},and(created_at.eq.${from.at},id.gt.${from.id}))")
                    else emptyList()
                    val add = service.messages(room, filters, ascending = true, limit = 100)
                    merge(add); more = add.size == 100; from = add.lastOrNull() ?: from
                    if (add.isEmpty()) break
                }
                reads = service.reads(room)
                reactions = service.reactions(realIDs())
                render(keepBottom = true); markRead()
            } catch (e: Exception) { /* 다음 이음에 다시 */ } finally { syncJob = null }
        }
    }

    private fun markRead() {
        if (!visible || !list.atBottom) return
        val newest = messages.lastOrNull { !it.id.startsWith("tmp:") }?.at ?: return
        if (newest == lastRead) return
        readJob?.cancel()
        readJob = scope.launch {
            delay(700)
            if (!visible || !list.atBottom) return@launch
            try {
                service.markRead(room); lastRead = newest
                event?.invoke("read", JSONObject().put("at", newest))
            } catch (e: Exception) { /* 다음 굴리기·새 글에 다시 */ }
        }
    }

    private fun loadMore() {
        if (!visible || !loaded || !hasMore || loadingMore) return
        val first = messages.firstOrNull() ?: return
        loadingMore = true
        scope.launch {
            try {
                val rows = service.messages(room, listOf(
                    "or" to "(created_at.lt.${first.at},and(created_at.eq.${first.at},id.lt.${first.id}))"))
                hasMore = rows.size == 50
                merge(rows); render(keepBottom = false)
            } catch (e: Exception) { notice(e.message ?: "더 불러오지 못했습니다.") }
            finally { loadingMore = false }
        }
    }

    // ── 보내기 ─────────────────────────────────────────────────

    private fun send() {
        val text = input.text.toString().trim()
        if (busy || !loaded || text.isEmpty()) return
        if (text.length > 1000) { notice("메시지는 1,000자까지 보낼 수 있습니다."); return }
        busy = true
        /* 단추는 Swift처럼 늘 그 자리에 둔다. 비활성일 때 alpha만 낮춘다. */
        sendBtn.isEnabled = false; sendBtn.alpha = 0.5f

        val stableId = UUID.randomUUID().toString().lowercase()
        val row = JSONObject().put("id", stableId)
            .put("room_id", room).put("user_id", me).put("body", text)

        var tempId: String? = null
        if (stage2) {
            /* 2-2 시험: 서버 답을 기다리지 않고 바로 말풍선을 세운다.
               tmp: id는 realIDs() 문지기를 지나 reactions 조회에 절대 안 간다. */
            tempId = "tmp:" + stableId
            val raw = JSONObject(row.toString())
                .put("id", tempId)
                .put("created_at", java.time.Instant.now().toString())
            merge(listOf(ChatMessage(raw)))
            input.setText("")
            render(keepBottom = false)
            list.scrollToBottom(false)
        }

        scope.launch {
            try {
                val sent = service.send(row)
                tempId?.let { id -> messages.removeAll { it.id == id } }
                if (!stage2 && input.text.toString().trim() == text) input.setText("")
                merge(listOf(sent)); render(keepBottom = false)
                list.scrollToBottom(false); markRead()
            } catch (e: Exception) {
                tempId?.let { id -> messages.removeAll { it.id == id } }
                if (stage2 && input.text.isEmpty()) {
                    /* 실패한 글을 입력칸에 돌려놓는다. 포커스/한글 IME는
                       화면을 재생성하지 않고 EditText만 복원한다. */
                    input.setText(text); input.setSelection(input.text.length)
                }
                render(keepBottom = true)
                notice((e.message ?: "보내지 못했습니다.") + "\n내용은 보관했습니다. 보내기를 눌러 다시 시도하세요.")
            } finally {
                busy = false; sendBtn.isEnabled = true; sendBtn.alpha = 1f
            }
        }
    }

    /** 서버에 실제로 있는 글만. tmp:를 in.(...)에 섞으면 PostgREST가 400이다. */
    private fun realIDs(): List<String> = messages.map { it.id }.filter { !it.startsWith("tmp:") }
}
