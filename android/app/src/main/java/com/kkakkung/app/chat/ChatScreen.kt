package com.kkakkung.app.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
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
import android.widget.GridLayout
import android.widget.HorizontalScrollView
import android.widget.ScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import coil.load
import com.kkakkung.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.ZoneId
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
    private val searchBtn = ImageView(activity)
    private val menuBtn = ImageView(activity)
    private val searchInput = EditText(activity)
    private val searchCancel = TextView(activity)
    private val findBar = LinearLayout(activity)
    private val findCount = TextView(activity)
    private val findUp = TextView(activity)
    private val findDown = TextView(activity)
    private val list = ChatListView(activity)
    private val status = TextView(activity)
    private val mentionPanel = LinearLayout(activity)
    private val suggestPanel = HorizontalScrollView(activity)
    private val suggestRow = LinearLayout(activity)
    private val replyPanel = LinearLayout(activity)
    private val cheerBar = ChatCheerBar(activity)
    private val stickerPreview = FrameLayout(activity)
    private val composer = LinearLayout(activity)
    private val stickerBtn = TextView(activity)
    private val stickerTray = LinearLayout(activity)
    private val stickerTabs = LinearLayout(activity)
    private val stickerGrid = GridLayout(activity)
    private val mediaBtn = ImageView(activity)
    private val mediaResultKey get() = "chat-media-${me}"
    private var selectedMedia = emptyList<android.net.Uri>()
    private val uploads: ChatUploads by lazy {
        ChatUploads(activity.applicationContext, service, { added, removed ->
            removed?.let { id -> messages.removeAll { it.id == id } }
            added?.let { merge(listOf(it)) }
            render(keepBottom = true)
        }, { states -> list.setUploads(states) })
    }
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
    private var searchJob: Job? = null
    private var cheerJob: Job? = null
    private var softInputBefore: Int? = null
    private val stage2 get() = ChatCatchup.stage2(activity)
    private var pullY = 0f
    private var lastIme = false
    private var navColorBefore: Int? = null
    private var quoted: ChatMessage? = null
    private var pickedSticker: String? = null
    private var stickerGroup = 0
    private var searching = false
    private var searchHits: List<ChatMessage> = emptyList()
    private var searchIndex = -1
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
        searchBtn.setImageResource(R.drawable.ic_chat_search)
        searchBtn.scaleType = ImageView.ScaleType.CENTER
        searchBtn.contentDescription = "대화 검색"
        searchBtn.setOnClickListener { if (stage2) enterSearch() }
        menuBtn.setImageResource(R.drawable.ic_chat_menu)
        menuBtn.scaleType = ImageView.ScaleType.CENTER
        menuBtn.contentDescription = "대화 메뉴"
        menuBtn.setOnClickListener { if (stage2) showDrawer() }
        showNormalHeader()
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

        suggestPanel.visibility = View.GONE
        suggestPanel.isHorizontalScrollBarEnabled = false
        suggestPanel.setPadding(dp(10f),0,dp(10f),0)
        suggestPanel.background = GradientDrawable().apply {
            cornerRadius=dp(25f).toFloat(); setColor(Color.WHITE)
        }
        suggestRow.orientation=LinearLayout.HORIZONTAL; suggestRow.gravity=Gravity.CENTER_VERTICAL
        suggestPanel.addView(suggestRow)
        column.addView(suggestPanel, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(68f)
        ).apply { leftMargin=dp(10f); rightMargin=dp(10f); bottomMargin=dp(4f) })

        /* 2-2 답장 카드 — Swift ReplyBox 값 그대로:
           #b0a5e5, 좌우 10, radius 18, 닫기 24. */
        replyPanel.orientation = LinearLayout.HORIZONTAL
        replyPanel.gravity = Gravity.CENTER_VERTICAL
        replyPanel.visibility = View.GONE
        replyPanel.setPadding(dp(12f), dp(8f), dp(8f), dp(8f))
        replyPanel.background = GradientDrawable().apply {
            cornerRadius = dp(18f).toFloat(); setColor(0xFFB0A5E5.toInt())
        }
        column.addView(replyPanel, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { leftMargin = dp(10f); rightMargin = dp(10f); bottomMargin = dp(4f) })

        cheerBar.visibility = View.GONE
        cheerBar.onTap = {
            cheerBar.visibility = View.GONE
            cheerBar.stopMotion()
            notice("축하합니다!")
        }
        column.addView(cheerBar, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(50f)
        ).apply { leftMargin=dp(10f); rightMargin=dp(10f) })

        findBar.orientation = LinearLayout.HORIZONTAL
        findBar.gravity = Gravity.CENTER_VERTICAL
        findBar.visibility = View.GONE
        findBar.setPadding(dp(12f), dp(7f), dp(12f), dp(7f))
        findBar.setBackgroundColor(ChatSkin.bg)
        findCount.textSize = 14f; findCount.setTextColor(Color.WHITE)
        findBar.addView(findCount, LinearLayout.LayoutParams(0, dp(38f), 1f))
        for ((button, label, step) in listOf(Triple(findUp, "⌃", 1), Triple(findDown, "⌄", -1))) {
            button.text = label; button.textSize = 22f; button.gravity = Gravity.CENTER
            button.setTextColor(Color.WHITE)
            button.setOnClickListener { stepSearch(step) }
            findBar.addView(button, LinearLayout.LayoutParams(dp(44f), dp(38f)))
        }
        column.addView(findBar, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        stickerPreview.visibility = View.GONE
        column.addView(stickerPreview, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { leftMargin=dp(10f); rightMargin=dp(10f); bottomMargin=dp(4f) })

        /* 글칸 줄 — 카톡처럼 뒤에 판을 안 깔고(보라 그대로) 흰 알약 하나가 뜬다.
           한 줄 48 · 둥글기 24 (CLAUDE.md `글칸 한 줄은 48px`). */
        composer.orientation = LinearLayout.HORIZONTAL
        composer.gravity = Gravity.BOTTOM
        composer.setBackgroundColor(ChatSkin.bg)
        /* 문서 2-2: 뒤에 흰 판/위 선 없이 보라가 그대로 보인다.
           한 줄 글칸은 정확히 48dp, radius 24. */
        composer.setPadding(dp(6f), dp(6f), dp(6f), dp(6f))
        mediaBtn.setImageResource(R.drawable.ic_chat_plus)
        mediaBtn.contentDescription = "사진·동영상 보내기"
        mediaBtn.scaleType = ImageView.ScaleType.CENTER
        mediaBtn.setOnClickListener { if (stage2) showMediaMenu() }
        composer.addView(mediaBtn, LinearLayout.LayoutParams(dp(36f), dp(48f)))
        stickerBtn.text = "☺"; stickerBtn.textSize = 23f; stickerBtn.gravity = Gravity.CENTER
        stickerBtn.setTextColor(ChatSkin.on); stickerBtn.contentDescription = "이모티콘"
        stickerBtn.setOnClickListener { if (stage2) toggleStickerTray() }
        composer.addView(stickerBtn, LinearLayout.LayoutParams(dp(42f), dp(48f)))
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

        /* 웹에서 받은 stickers만 그린다. 높이 min(38%,300), 탭 위 + 5칸 격자. */
        stickerTray.orientation = LinearLayout.VERTICAL
        stickerTray.setBackgroundColor(Color.WHITE); stickerTray.visibility = View.GONE
        stickerTabs.orientation = LinearLayout.HORIZONTAL
        val tabScroll = HorizontalScrollView(activity).apply {
            isHorizontalScrollBarEnabled = false
            addView(stickerTabs)
        }
        stickerTray.addView(tabScroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(48f)))
        stickerGrid.columnCount = 5
        val stickerScroll = ScrollView(activity).apply { addView(stickerGrid) }
        stickerTray.addView(stickerScroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        val trayH = minOf((resources.displayMetrics.heightPixels * .38f).toInt(), dp(300f))
        column.addView(stickerTray, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, trayH))

        input.setOnTouchListener { _, event ->
            if (event.actionMasked == MotionEvent.ACTION_DOWN) stickerTray.visibility = View.GONE
            false
        }
        input.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(x: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(x: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(e: Editable?) {
                if (!stage2 || e == null || paintingMentions) return
                /* 한글 조합 중에는 범위/색/글을 손대지 않는다. */
                if (BaseInputConnection.getComposingSpanStart(e) >= 0) return
                paintMentionText(e)
                updateMentionCard()
                updateSuggest(e.toString())
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
                        if (e.rawY - pullY >= dp(40f)) hideKeyboard()
                    }
                }
            }
            false
        }

        list.onCard = { path -> navigate(path) }
        list.onQuote = { id -> list.scrollTo(id) }
        list.onReply = { id -> if (stage2) setReply(id) }
        list.onPersonMessage = { id ->
            if (stage2) messages.firstOrNull { it.id == id }?.let { m ->
                people.firstOrNull { it.optString("id") == m.user }?.let(::showProfile)
            }
        }
        list.onHold = { row, anchor -> if (stage2) showHold(row, anchor) }
        list.onPhoto = { url -> showPhoto(url) }
        list.onUploadRetry = { uploads.retry(it) }
        list.onUploadCancel = { uploads.cancel(it) }
        activity.supportFragmentManager.setFragmentResultListener(mediaResultKey, activity) { _, result ->
            val uris = result.getStringArrayList("uris").orEmpty().map(android.net.Uri::parse)
            if (uris.size > 10) notice("한 번에 10개까지 선택해 주세요.")
            else if (uris.isNotEmpty()) {
                selectedMedia = uris
                sendSelectedMedia()
            }
        }
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
        activity.supportFragmentManager.clearFragmentResultListener(mediaResultKey)
        uploads.destroy()
        detach(); loadJob?.cancel(); searchJob?.cancel(); cheerJob?.cancel(); scope.cancel()
    }

    fun updateToken(token: String) {
        service.config.token = token
        realtime?.updateToken()
    }

    private class MentionPaint(color: Int) : ForegroundColorSpan(color)

    private fun mentionNames(): List<Pair<String, String>> {
        val mine = people.firstOrNull { it.optString("id") == me }
        val admin = mine?.optString("role") in setOf("staff", "admin", "superadmin")
        val rows = people.mapNotNull { p ->
            val name = p.optString("name")
            if (name.isBlank() || p.optString("role") in setOf("pending", "banned")) null
            else name to ChatRows.label(p).ifBlank { name }
        }.toMutableList()
        /* Swift ChatMentions.all과 동일. 운영진에게만 후보로 보인다. */
        if (admin) rows.add("전체" to "전체")
        return rows.distinctBy { it.first }.sortedByDescending { it.first.length }
    }

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
                    MentionPaint(if (name == mineName || name == "전체") 0xFFD92B8E.toInt() else 0xFF2C7BD4.toInt()),
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

    private fun showNormalHeader() {
        header.removeAllViews()
        header.addView(backBtn, LinearLayout.LayoutParams(dp(44f), dp(44f)).apply { leftMargin = dp(8f) })
        header.addView(View(activity), LinearLayout.LayoutParams(0, dp(1f), 1f))
        if (stage2) {
            header.addView(searchBtn, LinearLayout.LayoutParams(dp(44f), dp(44f)))
            header.addView(menuBtn, LinearLayout.LayoutParams(dp(44f), dp(44f)).apply { rightMargin = dp(8f) })
        }
    }

    private fun enterSearch() {
        if (searching) return
        searching = true
        hideMentionCard(); clearReply(); hideKeyboard()
        header.removeAllViews()
        searchInput.hint = "대화내용 검색"
        searchInput.textSize = 16f; searchInput.setSingleLine(true)
        searchInput.setTextColor(ChatSkin.text); searchInput.setHintTextColor(0xFF8B9486.toInt())
        searchInput.background = GradientDrawable().apply {
            cornerRadius = dp(18f).toFloat(); setColor(Color.WHITE)
        }
        searchInput.setPadding(dp(12f), 0, dp(12f), 0)
        searchCancel.text = "취소"; searchCancel.textSize = 14f; searchCancel.setTextColor(ChatSkin.text)
        searchCancel.gravity = Gravity.CENTER
        searchCancel.setOnClickListener { leaveSearch() }
        header.addView(searchInput, LinearLayout.LayoutParams(0, dp(38f), 1f).apply {
            leftMargin = dp(10f); rightMargin = dp(6f)
        })
        header.addView(searchCancel, LinearLayout.LayoutParams(dp(52f), dp(44f)))
        composer.visibility = View.GONE
        findBar.visibility = View.VISIBLE
        findCount.text = "두 글자 이상 입력"
        searchInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, st: Int, c: Int, a: Int) {}
            override fun onTextChanged(s: CharSequence?, st: Int, b: Int, c: Int) { queueSearch(s?.toString().orEmpty()) }
            override fun afterTextChanged(s: Editable?) {}
        })
        searchInput.requestFocus()
        (activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)
            ?.showSoftInput(searchInput, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun leaveSearch() {
        searchJob?.cancel(); searching = false; searchHits = emptyList(); searchIndex = -1
        list.setFindQuery("")
        searchInput.setText("")
        findBar.visibility = View.GONE; composer.visibility = View.VISIBLE
        showNormalHeader()
        hideKeyboard()
    }

    private fun queueSearch(raw: String) {
        if (!searching) return
        val q = raw.trim()
        searchJob?.cancel()
        if (q.length < 2 || q.contains('%') || q.contains('_')) {
            searchHits = emptyList(); searchIndex = -1
            list.setFindQuery(if (q.length >= 2) q else "")
            findCount.text = if (q.contains('%') || q.contains('_')) "% · _ 는 검색할 수 없습니다" else "두 글자 이상 입력"
            return
        }
        list.setFindQuery(q)
        searchJob = scope.launch {
            delay(300)
            try {
                val hits = service.searchMessages(room, q, 100).filter { !it.hidden }
                if (!searching || searchInput.text.toString().trim() != q) return@launch
                searchHits = hits
                searchIndex = if (hits.isEmpty()) -1 else 0 // 서버 desc = 가장 최근
                updateFindCount()
                if (searchIndex >= 0) showSearchHit(searchHits[searchIndex])
            } catch (e: Exception) {
                if (e !is kotlinx.coroutines.CancellationException) findCount.text = "검색하지 못했습니다"
            }
        }
    }

    private fun stepSearch(delta: Int) {
        if (searchHits.isEmpty()) return
        searchIndex = (searchIndex + delta).coerceIn(0, searchHits.lastIndex)
        updateFindCount(); showSearchHit(searchHits[searchIndex])
    }

    private fun updateFindCount() {
        findCount.text = if (searchHits.isEmpty() || searchIndex < 0) "0 / 0"
            else "${searchIndex + 1} / ${searchHits.size}"
    }

    private fun showSearchHit(hit: ChatMessage) {
        scope.launch {
            if (messages.none { it.id == hit.id }) {
                try {
                    merge(service.aroundMessage(room, hit))
                    render(keepBottom = false)
                } catch (_: Exception) {}
            }
            list.scrollTo(hit.id)
        }
    }

    private fun showDrawer() {
        hideKeyboard()
        val overlay = FrameLayout(activity).apply {
            setBackgroundColor(0x52000000)
            isClickable = true
        }
        val panel = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
            setPadding(dp(16f), dp(10f), dp(16f), dp(12f))
            isClickable = true
        }
        overlay.addView(panel, FrameLayout.LayoutParams(
            (resources.displayMetrics.widthPixels * 0.88f).toInt(),
            FrameLayout.LayoutParams.MATCH_PARENT,
            Gravity.END
        ))
        overlay.setOnClickListener { removeView(overlay) }

        panel.addView(TextView(activity).apply {
            text = "닫기"; textSize = 15f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(ChatSkin.text); gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, dp(8f)); setOnClickListener { removeView(overlay) }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44f)))

        val photoHead = drawerHead("▣", "사진·동영상")
        panel.addView(photoHead)
        val shots = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        val scroller = HorizontalScrollView(activity).apply {
            isHorizontalScrollBarEnabled = false; addView(shots)
        }
        panel.addView(scroller, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(72f)
        ).apply { bottomMargin = dp(14f) })

        val active = people.filter { it.optString("role") !in setOf("pending", "banned") }
            .sortedWith(compareBy<JSONObject>(
                { p -> when { p.optString("role") in setOf("staff","admin","superadmin") -> 0; p.optString("role")=="treasurer" -> 1; else -> 2 } },
                { p -> p.optInt("birth_year", 9999).let { if (it <= 0) 9999 else it } },
                { p -> p.optString("name") }
            ))
        panel.addView(drawerHead("▣", "참여자 ${active.size}명"))

        val peopleCol = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        val peopleScroll = ScrollView(activity).apply { addView(peopleCol) }
        if (active.size > 12) {
            val find = EditText(activity).apply {
                hint = "참여자 찾기"; textSize = 14f; setSingleLine(true)
                setPadding(dp(12f), 0, dp(12f), 0)
                background = GradientDrawable().apply {
                    cornerRadius = dp(12f).toFloat(); setColor(0xFFF5F7F1.toInt())
                    setStroke(dp(1f), 0xFFDDE3D1.toInt())
                }
            }
            panel.addView(find, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(40f)
            ).apply { bottomMargin = dp(8f) })
            find.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(x: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(x: CharSequence?, a: Int, b: Int, c: Int) {
                    renderDrawerPeople(peopleCol, active, x?.toString().orEmpty(), overlay)
                }
                override fun afterTextChanged(x: Editable?) {}
            })
        }
        panel.addView(peopleScroll, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))
        renderDrawerPeople(peopleCol, active, "", overlay)

        addView(overlay, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        overlay.bringToFront()

        scope.launch {
            try {
                val media = service.recentMedia(room, 30)
                media.forEach { m ->
                    val url = httpsUrl(m.image) ?: return@forEach
                    val thumb = ImageView(activity).apply {
                        scaleType = ImageView.ScaleType.CENTER_CROP
                        background = android.graphics.drawable.ColorDrawable(0xFFE5E5E5.toInt())
                        load(url) { crossfade(false) }
                        setOnClickListener { showPhoto(url) }
                    }
                    shots.addView(thumb, LinearLayout.LayoutParams(dp(64f), dp(64f)).apply {
                        marginEnd = dp(4f)
                    })
                }
                if (media.size >= 30) shots.addView(TextView(activity).apply {
                    text = "→\n더보기"; textSize = 12f; gravity = Gravity.CENTER; setTextColor(ChatSkin.text)
                }, LinearLayout.LayoutParams(dp(64f), dp(64f)))
                photoHead.visibility = if (media.isEmpty()) View.GONE else View.VISIBLE
                scroller.visibility = if (media.isEmpty()) View.GONE else View.VISIBLE
            } catch (_: Exception) {
                /* 네트워크 실패는 사진 묶음을 '지워진 사진'으로 판정하지 않는다. */
            }
        }
    }

    private fun renderDrawerPeople(
        parent: LinearLayout, source: List<JSONObject>, query: String, drawer: View
    ) {
        parent.removeAllViews()
        val q = query.trim()
        source.filter { q.isBlank() || ChatRows.label(it).contains(q, ignoreCase = true) }.forEach { p ->
            val row = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(16f), dp(7f), dp(16f), dp(7f)); isClickable = true
            }
            val face = FrameLayout(activity)
            val avatar = ImageView(activity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                background = GradientDrawable().apply {
                    cornerRadius = dp(12f).toFloat(); setColor(0xFFDDE3D1.toInt())
                    val edge = when(p.optString("gender")) {
                        "f" -> 0xFFEF6BA8.toInt(); "m" -> 0xFF2F8FD6.toInt(); else -> Color.TRANSPARENT
                    }
                    if (edge != Color.TRANSPARENT) setStroke(dp(1f), edge)
                }
                clipToOutline = true
            }
            val url = httpsUrl(p.optString("avatar_url"))
            if (!url.isNullOrBlank()) avatar.load(url) { crossfade(false) }
            else avatar.setImageDrawable(null)
            face.addView(avatar, FrameLayout.LayoutParams(dp(36f), dp(36f)))
            if (url.isNullOrBlank()) face.addView(TextView(activity).apply {
                val n=p.optString("name"); text=if(n.length>=2)n.takeLast(2) else n
                textSize=11f; gravity=Gravity.CENTER; setTextColor(ChatSkin.text)
            }, FrameLayout.LayoutParams(dp(36f),dp(36f)))

            val role = p.optString("role")
            val markText = if (role == "treasurer") "₩" else if (role in setOf("staff","admin","superadmin")) "♛" else ""
            if (markText.isNotBlank()) face.addView(TextView(activity).apply {
                text=markText; textSize=9f; gravity=Gravity.CENTER; setTextColor(Color.WHITE)
                background=GradientDrawable().apply {
                    shape=GradientDrawable.OVAL; setColor(when(role) {
                        "superadmin"->0xFFB41F72.toInt(); "admin"->0xFFE84A7F.toInt()
                        "staff"->0xFF2C7BD4.toInt(); else->0xFFB97C00.toInt()
                    })
                }
            }, FrameLayout.LayoutParams(dp(16f),dp(16f),Gravity.END or Gravity.BOTTOM))
            row.addView(face, LinearLayout.LayoutParams(dp(38f),dp(38f)))

            if (p.optString("id") == me) row.addView(TextView(activity).apply {
                text="나"; textSize=11f; typeface=Typeface.DEFAULT_BOLD; gravity=Gravity.CENTER
                setTextColor(Color.WHITE); setPadding(dp(6f),dp(2f),dp(6f),dp(2f))
                background=GradientDrawable().apply { cornerRadius=dp(8f).toFloat(); setColor(0x59000000) }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT,dp(18f)).apply { marginStart=dp(11f) })

            row.addView(TextView(activity).apply {
                text=ChatRows.label(p); textSize=16f; setTextColor(ChatSkin.text)
                setPadding(dp(8f),0,0,0)
            }, LinearLayout.LayoutParams(0,LinearLayout.LayoutParams.WRAP_CONTENT,1f))
            row.setOnClickListener { removeView(drawer); showProfile(p) }
            parent.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(50f)
            ))
        }
    }

    private fun showProfile(person: JSONObject) {
        hideKeyboard()
        val overlay = FrameLayout(activity).apply {
            setBackgroundColor(Color.BLACK)
            isClickable = true
        }
        val photo = ImageView(activity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(0xFF121212.toInt())
        }
        val avatar = httpsUrl(person.optString("avatar_url"))
        if (!avatar.isNullOrBlank()) photo.load(avatar) { crossfade(false) }
        overlay.addView(photo, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ))
        if (avatar.isNullOrBlank()) overlay.addView(TextView(activity).apply {
            text = person.optString("name").ifBlank { "?" }.takeLast(2)
            textSize = 72f; typeface = Typeface.DEFAULT_BOLD; setTextColor(0x80FFFFFF.toInt())
            gravity = Gravity.CENTER
        }, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ))

        val foot = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20f), dp(20f), dp(20f), dp(20f))
            setBackgroundColor(0x73000000)
        }
        val nameRow = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        nameRow.addView(TextView(activity).apply {
            text = ChatRows.label(person); textSize = 20f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        val role = person.optString("role")
        val roleLabel = when(role) {
            "superadmin" -> "앱관리자"; "admin" -> "운영자"; "staff" -> "부운영자"; "treasurer" -> "총무"; else -> ""
        }
        if (roleLabel.isNotBlank()) nameRow.addView(TextView(activity).apply {
            text = roleLabel; textSize = 12f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE)
            setPadding(dp(8f), dp(3f), dp(8f), dp(3f))
            background = GradientDrawable().apply {
                cornerRadius = dp(10f).toFloat()
                setColor(when(role) {
                    "superadmin" -> 0xFFB41F72.toInt(); "admin" -> 0xFFE84A7F.toInt()
                    "staff" -> 0xFF2C7BD4.toInt(); else -> 0xFFB97C00.toInt()
                })
            }
        })
        foot.addView(nameRow)

        val attend = TextView(activity).apply {
            textSize = 14f; setTextColor(0xBFFFFFFF.toInt()); visibility = View.GONE
            setPadding(0, dp(4f), 0, 0)
        }
        foot.addView(attend)

        val acts = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            setPadding(0, dp(14f), 0, 0)
        }
        fun whitePill(label: String, click: () -> Unit) = TextView(activity).apply {
            text = label; textSize = 15f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                cornerRadius = dp(22f).toFloat(); setColor(0x4DFFFFFF)
            }
            setOnClickListener { click() }
        }
        acts.addView(whitePill("@언급하기") {
            removeView(overlay)
            val n = person.optString("name")
            input.setText("@$n ")
            input.setSelection(input.text.length)
            input.requestFocus()
            (activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)
                ?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }, LinearLayout.LayoutParams(0, dp(44f), 1f).apply { marginEnd = dp(4f) })
        acts.addView(whitePill("🎁 선물하기") {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("kakaotalk://gift/home")))
            } catch (_: Exception) {
                activity.startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://gift.kakao.com/")))
            }
        }, LinearLayout.LayoutParams(0, dp(44f), 1f).apply { marginStart = dp(4f) })
        foot.addView(acts)
        overlay.addView(foot, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        ))

        val close = TextView(activity).apply {
            text = "✕"; textSize = 20f; gravity = Gravity.CENTER; setTextColor(Color.WHITE)
            setOnClickListener { removeView(overlay) }
        }
        overlay.addView(close, FrameLayout.LayoutParams(dp(44f), dp(44f), Gravity.TOP or Gravity.START).apply {
            topMargin = dp(4f); leftMargin = dp(4f)
        })

        /* Swift ChatProfile: 120px 또는 40px 이상 + 빠른 아래 flick. */
        var downY = 0f
        var downAt = 0L
        overlay.setOnTouchListener { _, e ->
            when(e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downY = e.rawY; downAt = android.os.SystemClock.uptimeMillis(); true }
                MotionEvent.ACTION_MOVE -> {
                    val dy = e.rawY - downY
                    overlay.translationY = if (dy >= 0) dy else dy / 3f
                    if (dy > 0) overlay.setBackgroundColor(Color.argb(
                        (255 * (1f - minOf(1f, dy / maxOf(1, height).toFloat()))).toInt(), 0, 0, 0
                    ))
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    val dy = e.rawY - downY
                    val dt = maxOf(1L, android.os.SystemClock.uptimeMillis() - downAt)
                    val vy = dy * 1000f / dt
                    if (dy > dp(120f) || (dy > dp(40f) && vy > 900f)) removeView(overlay)
                    else {
                        overlay.animate().translationY(0f).setDuration(200).start()
                        overlay.setBackgroundColor(Color.BLACK)
                    }
                    true
                }
                else -> true
            }
        }
        addView(overlay, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        overlay.bringToFront()

        if (isAdmin()) scope.launch {
            try {
                val year = java.time.LocalDate.now(ZoneId.of("Asia/Seoul")).year
                val raw = service.request(
                    "rest/v1/rpc/attendance_counts", method = "POST",
                    body = JSONObject().put("p_since", "$year-01-01T00:00:00+09:00")
                )
                val rows = raw as? JSONArray ?: return@launch
                val n = (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
                    .firstOrNull { it.optString("user_id") == person.optString("id") }
                    ?.optInt("n")
                if (n != null && overlay.parent != null) {
                    attend.text = "올해 ${n}회"; attend.visibility = View.VISIBLE
                }
            } catch (_: Exception) {
                /* 오류면 0회라고 거짓말하지 않고 줄 자체를 안 그린다. */
            }
        }
    }

    private fun drawerHead(mark: String, title: String): View =
        LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            val icon = TextView(activity).apply {
                text = mark; textSize = 11f; gravity = Gravity.CENTER; setTextColor(Color.WHITE)
                background = GradientDrawable().apply {
                    cornerRadius = dp(6f).toFloat(); setColor(ChatSkin.cardBadge)
                }
            }
            addView(icon, LinearLayout.LayoutParams(dp(20f), dp(20f)))
            addView(TextView(activity).apply {
                text = title; textSize = 20f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ChatSkin.text)
            }, LinearLayout.LayoutParams(0, dp(26f), 1f).apply { marginStart = dp(10f) })
        }

    private fun isAdmin(): Boolean =
        people.firstOrNull { it.optString("id") == me }?.optString("role") in setOf("staff", "admin", "superadmin")

    private fun showHold(row: ChatRow, anchor: View) {
        val message = messages.firstOrNull { it.id == row.id } ?: return
        if (row.id.startsWith("tmp:")) return

        /* 가린 글은 운영진의 '가리기 해제' 하나만. 복사·답장·반응은 없다. */
        if (row.kind == "hidden") {
            if (!isAdmin()) return
            val pop = holdPopup()
            pop.first.addView(holdLine("가리기 해제", false) {
                pop.second.dismiss()
                mutateMessage(message, JSONObject().put("hidden_at", JSONObject.NULL))
            })
            showHoldPopup(pop.second, anchor, row.mine)
            return
        }

        val pop = holdPopup()
        fun add(label: String, danger: Boolean = false, action: () -> Unit) {
            pop.first.addView(holdLine(label, danger) { pop.second.dismiss(); action() })
            if (pop.first.childCount > 1) {
                val at = pop.first.childCount - 1
                pop.first.addView(View(activity).apply { setBackgroundColor(0x1A000000) }, at,
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1f)))
            }
        }
        add("복사") { copyText(message.body) }
        add("선택 복사") { selectableCopy(message.body) }
        add("댓글") { setReply(message.id) }
        add("공유") { shareMessage(message) }
        if (isAdmin()) add("가리기") {
            mutateMessage(message, JSONObject().put("hidden_at", java.time.Instant.now().toString()))
        }
        if (message.user == me) add("삭제", true) { mutateMessage(message, null) }

        /* 반응은 메뉴와 분리된 아래 알약. 값은 config.reactions, 즉 웹에서 받은 것뿐. */
        if (service.config.reactions.isNotEmpty()) {
            val reactRow = LinearLayout(activity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
                setPadding(dp(6f), dp(6f), dp(6f), dp(6f))
            }
            service.config.reactions.forEach { emoji ->
                val mine = row.reacts.firstOrNull { it.emoji == emoji }?.mine == true
                reactRow.addView(TextView(activity).apply {
                    text = emoji; textSize = 21f; gravity = Gravity.CENTER
                    background = GradientDrawable().apply {
                        cornerRadius = dp(18f).toFloat()
                        setColor(if (mine) 0x33D92B8E else 0x33FFFFFF)
                    }
                    setOnClickListener {
                        pop.second.dismiss()
                        scope.launch {
                            try {
                                service.react(row.id, emoji, mine)
                                reactions = service.reactions(realIDs()); render(keepBottom = true)
                            } catch (e: Exception) { notice(e.message ?: "반응을 바꾸지 못했습니다.") }
                        }
                    }
                }, LinearLayout.LayoutParams(0, dp(38f), 1f).apply { marginEnd = dp(3f) })
            }
            pop.first.addView(reactRow)
        }
        showHoldPopup(pop.second, anchor, row.mine)
    }

    private fun holdPopup(): Pair<LinearLayout, PopupWindow> {
        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = dp(14f).toFloat(); setColor(0xF2FFFFFF.toInt())
            }
            elevation = dp(8f).toFloat()
        }
        val popup = PopupWindow(box, dp(300f), LinearLayout.LayoutParams.WRAP_CONTENT, true).apply {
            isOutsideTouchable = true; elevation = dp(10f).toFloat()
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
        }
        return box to popup
    }

    private fun holdLine(label: String, danger: Boolean, action: () -> Unit): View =
        TextView(activity).apply {
            text = label; textSize = 15f; gravity = Gravity.CENTER_VERTICAL
            setTextColor(if (danger) 0xFFE2402A.toInt() else ChatSkin.text)
            setPadding(dp(14f), 0, dp(14f), 0)
            setOnClickListener { action() }
            minHeight = dp(40f)
        }

    private fun showHoldPopup(popup: PopupWindow, anchor: View, mine: Boolean) {
        val loc = IntArray(2); anchor.getLocationOnScreen(loc)
        val screenW = resources.displayMetrics.widthPixels
        val screenH = resources.displayMetrics.heightPixels
        val width = dp(300f)
        val x = if (mine) (loc[0] + anchor.width - width).coerceAtLeast(dp(8f))
                else loc[0].coerceAtMost(screenW - width - dp(8f))
        /* 아래 공간을 먼저 쓰고, 300px쯤 안 나오면 위로. */
        val below = screenH - (loc[1] + anchor.height)
        val y = if (below >= dp(260f)) loc[1] + anchor.height + dp(4f)
                else (loc[1] - dp(260f)).coerceAtLeast(dp(8f))
        popup.showAtLocation(this, Gravity.TOP or Gravity.START, x, y)
    }

    private fun copyText(text: String) {
        (activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager)
            ?.setPrimaryClip(ClipData.newPlainText("대화", text))
        notice("복사했습니다.")
    }

    private fun selectableCopy(text: String) {
        val v = TextView(activity).apply {
            this.text = text; textSize = 16f; setTextColor(ChatSkin.text)
            setTextIsSelectable(true); setPadding(dp(18f), dp(14f), dp(18f), dp(14f))
        }
        AlertDialog.Builder(activity).setView(v).setPositiveButton("닫기", null).show()
    }

    private fun shareMessage(m: ChatMessage) {
        val parts = listOfNotNull(m.body.takeIf { it.isNotBlank() }, m.image)
        val i = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"; putExtra(Intent.EXTRA_TEXT, parts.joinToString("\n"))
        }
        activity.startActivity(Intent.createChooser(i, "공유"))
    }

    private fun mutateMessage(m: ChatMessage, patch: JSONObject?) {
        scope.launch {
            try {
                service.change(m, patch)
                if (patch == null) messages.removeAll { it.id == m.id }
                else sync()
                render(keepBottom = true)
            } catch (e: Exception) { notice(e.message ?: "처리하지 못했습니다.") }
        }
    }

    private fun suggestNorm(raw: String): String =
        raw.replace('？','?').replace(Regex("[\\s!~.,…'\"“”()·:;\\-_/]"), "").lowercase()

    private fun updateSuggest(raw: String) {
        if (!stage2 || raw.contains('@')) { suggestPanel.visibility=View.GONE; input.setTextColor(ChatSkin.text); return }
        val q=suggestNorm(raw)
        if (q.length < 2 || service.config.suggest.length()==0) {
            suggestPanel.visibility=View.GONE; input.setTextColor(ChatSkin.text); return
        }
        // Collect every match first, then follow the shared catalog order (suggestFor).
        val hits = HashSet<String>()
        val rules = service.config.suggest
        for (i in 0 until rules.length()) {
            val rule = rules.optJSONObject(i) ?: continue
            val words = rule.optJSONArray("words") ?: continue
            val hit = (0 until words.length()).any {
                val word = words.optString(it)
                word.isNotEmpty() && q.contains(word)
            }
            if (!hit) continue
            val ids = rule.optJSONArray("ids") ?: continue
            for (j in 0 until ids.length()) hits.add(ids.optString(j))
        }
        val selected = LinkedHashMap<String, String>()
        val max = service.config.suggestMax.coerceAtLeast(0)
        val maxAnimated = service.config.suggestAnim.coerceAtLeast(0)
        var animated = 0
        val groups = service.config.stickers
        for (i in 0 until groups.length()) {
            val stickers = groups.optJSONObject(i)?.optJSONArray("stickers") ?: continue
            for (j in 0 until stickers.length()) {
                if (selected.size >= max) break
                val sticker = stickers.optJSONObject(j) ?: continue
                val id = sticker.optString("id")
                if (id !in hits || id in selected) continue
                if (id.startsWith("mv")) {
                    if (animated >= maxAnimated) continue
                    animated++
                }
                selected[id] = sticker.optString("label", "추천 이모티콘")
            }
            if (selected.size >= max) break
        }
        if (selected.isEmpty()) {
            suggestPanel.visibility = View.GONE
            input.setTextColor(ChatSkin.text)
            return
        }
        suggestRow.removeAllViews()
        selected.forEach { (id, label) ->
            val iv = ImageView(activity).apply {
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                contentDescription = label
                load(stickerAsset(id)) { crossfade(false) }
                setOnClickListener { pickSticker(id) }
            }
            suggestRow.addView(iv, LinearLayout.LayoutParams(dp(58f), dp(58f)).apply { marginEnd = dp(4f) })
        }
        suggestPanel.visibility=View.VISIBLE
        /* 추천이 떠 있는 동안 일반 글은 파랑. @언급은 위에서 접으므로 충돌하지 않는다. */
        input.setTextColor(0xFF2C7BD4.toInt())
    }

    private fun stickerAsset(id: String): String =
        "file:///android_asset/public/stickers/" + id + if (id.startsWith("mv")) ".webp" else ".png"

    private fun toggleStickerTray() {
        if (service.config.stickers.length() == 0) return
        hideKeyboard()
        val open = stickerTray.visibility != View.VISIBLE
        stickerTray.visibility = if (open) View.VISIBLE else View.GONE
        if (open) stickerTray.post {
            if (stickerTray.visibility == View.VISIBLE) renderStickerTray()
        }
    }

    private fun renderStickerTray() {
        stickerTabs.removeAllViews()
        val groups = service.config.stickers
        if (groups.length() == 0) { stickerTray.visibility = View.GONE; return }
        stickerGroup = stickerGroup.coerceIn(0, groups.length()-1)
        for (i in 0 until groups.length()) {
            val g = groups.optJSONObject(i) ?: continue
            stickerTabs.addView(TextView(activity).apply {
                text = g.optString("tab") + " " + g.optString("name")
                textSize = 12f; gravity = Gravity.CENTER; setTextColor(ChatSkin.text)
                alpha = if (i == stickerGroup) 1f else .55f
                setPadding(dp(10f),0,dp(10f),0)
                setOnClickListener { stickerGroup=i; renderStickerTray() }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(48f)))
        }
        stickerGrid.removeAllViews()
        val stickers = groups.optJSONObject(stickerGroup)?.optJSONArray("stickers") ?: JSONArray()
        val cell = (stickerTray.width - stickerTray.paddingLeft - stickerTray.paddingRight) / 5
        if (cell <= 0) return
        for (i in 0 until stickers.length()) {
            val st = stickers.optJSONObject(i) ?: continue
            val id = st.optString("id"); if (id.isBlank()) continue
            val image = ImageView(activity).apply {
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                contentDescription = st.optString("label")
                /* mv도 웹 src를 쓰지 않는다. asset의 id.webp만 연다. */
                load(stickerAsset(id)) { crossfade(false) }
                setOnClickListener { pickSticker(id) }
            }
            stickerGrid.addView(image, GridLayout.LayoutParams().apply {
                width=cell; height=cell
                columnSpec=GridLayout.spec(GridLayout.UNDEFINED,1)
            })
        }
    }

    private fun pickSticker(id: String) {
        pickedSticker=id
        stickerPreview.removeAllViews()
        stickerPreview.setBackgroundColor(0xCC1B1F19.toInt())
        val image=ImageView(activity).apply {
            scaleType=ImageView.ScaleType.CENTER_INSIDE
            load(stickerAsset(id)) { crossfade(false) }
            setOnClickListener { sendPickedStickerOnly() }
        }
        stickerPreview.addView(image, FrameLayout.LayoutParams(dp(182f),dp(135f),Gravity.CENTER))
        stickerPreview.addView(TextView(activity).apply {
            text="✕"; textSize=16f; gravity=Gravity.CENTER; setTextColor(Color.WHITE)
            setOnClickListener { clearSticker() }
        }, FrameLayout.LayoutParams(dp(36f),dp(36f),Gravity.TOP or Gravity.END))
        stickerPreview.visibility=View.VISIBLE
    }

    private fun clearSticker() {
        pickedSticker=null; stickerPreview.visibility=View.GONE; stickerPreview.removeAllViews()
    }

    private fun sendPickedStickerOnly() {
        if (pickedSticker == null || busy) return
        send(stickerOnly = true)
    }

    private fun setReply(id: String) {
        val m = messages.firstOrNull { it.id == id } ?: return
        if (m.hidden || m.system || m.id.startsWith("tmp:")) return
        quoted = m
        replyPanel.removeAllViews()

        val text = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        val who = people.firstOrNull { it.optString("id") == m.user }?.optString("name").orEmpty()
        text.addView(TextView(activity).apply {
            this.text = if (who.isBlank()) "댓글" else "${who}에게 댓글"
            textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ChatSkin.text)
        })
        text.addView(TextView(activity).apply {
            this.text = m.preview; textSize = 13f; setTextColor(0xFF5B6455.toInt()); maxLines = 1
        })
        text.setOnClickListener { list.scrollTo(m.id) }
        replyPanel.addView(text, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        replyPanel.addView(TextView(activity).apply {
            this.text = "↳"; textSize = 16f; gravity = Gravity.CENTER; setTextColor(ChatSkin.text)
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0x33FFFFFF) }
            setOnClickListener { list.scrollTo(m.id) }
        }, LinearLayout.LayoutParams(dp(24f), dp(24f)).apply { rightMargin = dp(6f) })
        replyPanel.addView(TextView(activity).apply {
            this.text = "✕"; textSize = 14f; gravity = Gravity.CENTER; setTextColor(ChatSkin.text)
            setOnClickListener { clearReply() }
        }, LinearLayout.LayoutParams(dp(24f), dp(24f)))
        replyPanel.visibility = View.VISIBLE
        input.requestFocus()
        (activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)
            ?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun clearReply() {
        quoted = null
        replyPanel.visibility = View.GONE
        replyPanel.removeAllViews()
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

    private fun showMediaMenu() {
        if (!loaded) { notice("대화를 불러온 뒤 다시 눌러 주세요."); return }
        if (uploads.pending) { notice("전송 중인 파일을 마치거나 취소해 주세요."); return }
        val row = TextView(activity).apply {
            text = "사진·동영상 보내기\n최대 10개 · 한 파일 50MB"
            textSize = 15f; setTextColor(ChatSkin.text); gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16f), dp(12f), dp(16f), dp(12f))
            background = GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(14f).toFloat() }
        }
        val popup = PopupWindow(row, dp(240f), dp(76f), true).apply {
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
            elevation = dp(6f).toFloat(); isOutsideTouchable = true
        }
        row.setOnClickListener {
            popup.dismiss(); hideKeyboard()
            val manager = activity.supportFragmentManager
            if (!manager.isStateSaved && manager.findFragmentByTag("chat-media-picker") == null) {
                manager.beginTransaction().add(ChatMediaPicker().apply {
                    arguments = android.os.Bundle().apply { putString("result", mediaResultKey) }
                }, "chat-media-picker").commit()
            }
        }
        popup.showAsDropDown(mediaBtn, 0, -mediaBtn.height - dp(84f))
    }

    private fun sendSelectedMedia() {
        if (!loaded || selectedMedia.isEmpty()) return
        val picked = selectedMedia; selectedMedia = emptyList()
        uploads.enqueue(picked, room)
        list.scrollToBottom(false)
    }

    private fun showPhoto(url: String) {
        val source = httpsUrl(url) ?: return
        val path = android.net.Uri.parse(source).path.orEmpty().lowercase()
        if (!stage2) {
            openOutside(source)
            return
        }
        hideKeyboard()
        if (listOf(".mp4", ".mov", ".m4v").any { path.endsWith(it) }) {
            ChatVideoDialog.show(activity, source)
        } else {
            ChatPhotoDialog.show(activity, source)
        }
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
                installRealtime(); markRead(); sendSelectedMedia()
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
                val incoming = ChatMessage(raw)
                messages.removeAll { it.id == "tmp:${incoming.id}" }
                merge(listOf(incoming))
                if (isCheer(incoming.body)) showCheer()
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
        val tail = messages.lastOrNull { !it.id.startsWith("tmp:") }
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

    private fun isCheer(body: String): Boolean {
        val t = body.filterNot { it.isWhitespace() }
        return t.contains("축하") || t.contains("추카") || t.contains("ㅊㅋ")
    }

    private fun showCheer() {
        cheerJob?.cancel()
        cheerBar.visibility = View.VISIBLE
        cheerBar.play()
        cheerJob = scope.launch {
            delay(10_000)
            cheerBar.stopMotion(); cheerBar.visibility = View.GONE
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
        val first = messages.firstOrNull { !it.id.startsWith("tmp:") } ?: return
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

    private fun send(stickerOnly: Boolean = false) {
        val text = if (stickerOnly) "" else input.text.toString().trim()
        val sticker = pickedSticker
        if (busy || !loaded || (text.isEmpty() && sticker == null)) return
        if (text.length > 1000) { notice("메시지는 1,000자까지 보낼 수 있습니다."); return }
        busy = true
        /* 단추는 Swift처럼 늘 그 자리에 둔다. 비활성일 때 alpha만 낮춘다. */
        sendBtn.isEnabled = false; sendBtn.alpha = 0.5f

        val stableId = UUID.randomUUID().toString().lowercase()
        val reply = quoted
        val row = JSONObject().put("id", stableId)
            .put("room_id", room).put("user_id", me).put("body", text)
        if (sticker != null) row.put("image_url", "sticker:$sticker")
        if (reply != null) row.put("reply_to", reply.id)

        var tempId: String? = null
        if (stage2) {
            /* 2-2 시험: 서버 답을 기다리지 않고 바로 말풍선을 세운다.
               tmp: id는 realIDs() 문지기를 지나 reactions 조회에 절대 안 간다. */
            tempId = "tmp:" + stableId
            val raw = JSONObject(row.toString())
                .put("id", tempId)
                .put("created_at", java.time.Instant.now().toString())
            merge(listOf(ChatMessage(raw)))
            if (!stickerOnly) input.setText("")
            clearReply(); clearSticker()
            render(keepBottom = false)
            list.scrollToBottom(false)
        }

        scope.launch {
            try {
                val sent = service.send(row)
                tempId?.let { id -> messages.removeAll { it.id == id } }
                if (!stage2 && !stickerOnly && input.text.toString().trim() == text) input.setText("")
                if (!stage2) clearReply()
                merge(listOf(sent)); render(keepBottom = false)
                list.scrollToBottom(false); markRead()
            } catch (e: Exception) {
                tempId?.let { id -> messages.removeAll { it.id == id } }
                if (stage2) {
                    if (!stickerOnly && input.text.isEmpty()) {
                        input.setText(text); input.setSelection(input.text.length)
                    }
                    if (quoted == null) reply?.let { setReply(it.id) }
                    if (pickedSticker == null) sticker?.let { pickSticker(it) }
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
