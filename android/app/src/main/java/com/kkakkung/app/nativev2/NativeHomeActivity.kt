package com.kkakkung.app.nativev2

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.kkakkung.app.chat.ChatConfig
import com.kkakkung.app.chat.ChatScreen
import com.kkakkung.app.chat.ChatService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Android Native V2 첫 앱 Shell.
 *
 * 이 화면 안에서는 WebView/React Router/NativeNav를 사용하지 않는다.
 * 홈·라운드·투표는 Supabase를 Kotlin에서 직접 읽고, 채팅은 이미 완성된
 * ChatScreen을 그대로 붙인다. 세부 기능을 이 shell 안에서 하나씩 네이티브화한다.
 */
class NativeHomeActivity : AppCompatActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var content: FrameLayout
    private lateinit var bottom: LinearLayout
    private lateinit var api: NativeApi
    private lateinit var session: NativeSession
    private var chat: ChatScreen? = null
    private var detail = false
    private var currentTab = "home"
    private val tabs = linkedMapOf<String, Button>()

    private val brand = Color.rgb(109, 76, 255)
    private val bg = Color.rgb(247, 247, 250)
    private val card = Color.WHITE
    private val text = Color.rgb(35, 35, 42)
    private val dim = Color.rgb(110, 110, 120)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = NativeSessionStore.current ?: run { finish(); return }
        api = NativeApi(session)
        window.statusBarColor = bg
        window.navigationBarColor = Color.WHITE
        buildShell()
        showHome()
    }

    override fun onDestroy() {
        chat?.destroy()
        scope.cancel()
        super.onDestroy()
    }

    @Deprecated("Native V2 detail stack")
    override fun onBackPressed() {
        if (detail) {
            detail = false
            showTab(currentTab)
            return
        }
        if (currentTab != "home") {
            showHome()
            return
        }
        super.onBackPressed()
    }

    private fun buildShell() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
        }
        content = FrameLayout(this).apply { setBackgroundColor(bg) }
        bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.WHITE)
            elevation = dp(10).toFloat()
        }
        root.addView(content, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ))
        root.addView(bottom, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(64)
        ))
        setContentView(root)

        listOf(
            "home" to "홈",
            "rounds" to "라운드",
            "polls" to "투표",
            "chat" to "채팅",
            "me" to "내정보"
        ).forEach { (id, label) ->
            val b = Button(this).apply {
                text = label
                textSize = 13f
                isAllCaps = false
                setBackgroundColor(Color.TRANSPARENT)
                setOnClickListener { showTab(id) }
            }
            tabs[id] = b
            bottom.addView(b, LinearLayout.LayoutParams(0, dp(56), 1f))
        }
    }

    private fun showTab(id: String) {
        detail = false
        currentTab = id
        tabs.forEach { (key, b) ->
            b.setTextColor(if (key == id) brand else dim)
            b.typeface = if (key == id) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        chat?.let { if (it.parent != null && id != "chat") it.detach() }
        when (id) {
            "home" -> showHome()
            "rounds" -> loadList("라운드") { api.rounds() }
            "polls" -> loadList("투표") { api.polls() }
            "chat" -> showChat()
            "me" -> showMe()
        }
    }

    private fun showHome() {
        currentTab = "home"
        tabs.forEach { (key, b) ->
            b.setTextColor(if (key == "home") brand else dim)
            b.typeface = if (key == "home") Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        chat?.let { if (it.parent != null) it.detach() }
        val page = page("까꿍")
        val hello = TextView(this).apply {
            text = if (session.displayName.isBlank()) "오늘도 즐거운 라운드 되세요." else "${session.displayName}님, 반갑습니다."
            textSize = 17f; setTextColor(text)
            setPadding(0, 0, 0, dp(14))
        }
        page.addView(hello)
        val loading = ProgressBar(this)
        page.addView(loading)
        mount(page)
        scope.launch {
            try {
                val rounds = api.upcomingRounds(8)
                val polls = api.openPolls(8)
                page.removeView(loading)
                section(page, "다가오는 라운드")
                rounds.take(4).forEach { page.addView(roundCard(it)) }
                if (rounds.isEmpty()) empty(page, "예정된 라운드가 없습니다.")
                section(page, "진행중인 투표")
                polls.take(4).forEach { page.addView(pollCard(it)) }
                if (polls.isEmpty()) empty(page, "진행중인 투표가 없습니다.")
            } catch (e: Exception) {
                page.removeView(loading)
                error(page, e.message ?: "불러오지 못했습니다.")
            }
        }
    }

    private fun loadList(title: String, loader: suspend () -> List<JSONObject>) {
        val page = page(title)
        val loading = ProgressBar(this)
        page.addView(loading)
        mount(page)
        scope.launch {
            try {
                val rows = loader()
                page.removeView(loading)
                if (rows.isEmpty()) empty(page, "표시할 내용이 없습니다.")
                rows.forEach { row ->
                    page.addView(if (title == "라운드") roundCard(row) else pollCard(row))
                }
            } catch (e: Exception) {
                page.removeView(loading)
                error(page, e.message ?: "불러오지 못했습니다.")
            }
        }
    }

    private fun showRound(id: String) {
        detail = true
        chat?.let { if (it.parent != null) it.detach() }
        val page = detailPage("라운드")
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val r = api.round(id)
                page.removeView(loading)
                if (r == null) { error(page, "라운드를 찾지 못했습니다."); return@launch }
                title(page, r.optString("title").ifBlank { r.optString("course") })
                line(page, "장소", r.optString("course"))
                line(page, "일시", date(r.optString("tee_at")))
                line(page, "정원", "${r.optInt("capacity")}명")
                line(page, "비용", money(r.optInt("fee")))
                line(page, "상태", r.optString("status"))
                val note = r.optString("note")
                if (note.isNotBlank()) {
                    section(page, "안내")
                    body(page, note)
                }
                section(page, "Native V2 진행")
                body(page, "참가/취소 · 조편성 · 댓글은 다음 단계에서 이 화면에 직접 연결합니다.")
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "불러오지 못했습니다.")
            }
        }
    }

    private fun showPoll(id: String) {
        detail = true
        chat?.let { if (it.parent != null) it.detach() }
        val page = detailPage("투표")
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val p = api.poll(id)
                page.removeView(loading)
                if (p == null) { error(page, "투표를 찾지 못했습니다."); return@launch }
                title(page, p.optString("title"))
                body(page, p.optString("body"))
                line(page, "마감", date(p.optString("closes_at")))
                line(page, "상태", if (p.optBoolean("closed")) "마감" else "진행중")
                section(page, "Native V2 진행")
                body(page, "선택지 · 투표하기 · 댓글은 다음 단계에서 이 화면에 직접 연결합니다.")
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "불러오지 못했습니다.")
            }
        }
    }

    private fun showChat() {
        content.removeAllViews()
        val config = JSONObject()
            .put("user", session.userId)
            .put("token", session.accessToken)
            .put("url", session.supabaseUrl)
            .put("key", session.anonKey)
            .put("seen", "1970-01-01T00:00:00Z")
            .put("back", true)
        val c = chat ?: ChatScreen(this, ChatService(ChatConfig(config))).also { chat = it }
        c.service.config = ChatConfig(config)
        c.updateToken(session.accessToken)
        c.event = { type, data ->
            runOnUiThread {
                when (type) {
                    "navigate" -> {
                        val path = data.optString("path")
                        when {
                            path.startsWith("/rounds/") -> showRound(path.substringAfter("/rounds/").substringBefore('/'))
                            path.startsWith("/polls/") -> showPoll(path.substringAfter("/polls/").substringBefore('/'))
                        }
                    }
                    "back" -> showHome()
                }
            }
        }
        c.attach(content)
    }

    private fun showMe() {
        val page = page("내정보")
        title(page, session.displayName.ifBlank { "회원" })
        line(page, "사용자 ID", session.userId.take(8) + "…")
        body(page, "프로필 수정과 회원 관리도 Native V2에서 순차적으로 옮깁니다.")
        mount(page)
        scope.launch {
            try {
                val p = api.profile() ?: return@launch
                line(page, "닉네임", p.optString("name"))
                line(page, "등급", p.optString("role"))
                line(page, "지역", p.optString("region"))
            } catch (_: Exception) { }
        }
    }

    private fun roundCard(r: JSONObject): View = cardView(
        (if (r.optString("kind") == "screen") "🎯 " else "⛳ ") +
            r.optString("title").ifBlank { r.optString("course") },
        "${r.optString("course")}  ·  ${date(r.optString("tee_at"))}"
    ) { showRound(r.optString("id")) }

    private fun pollCard(p: JSONObject): View = cardView(
        "🗳 ${p.optString("title")}",
        if (p.optBoolean("closed")) "마감" else "진행중"
    ) { showPoll(p.optString("id")) }

    private fun page(title: String): LinearLayout {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(18), dp(18), dp(24))
        }
        title(col, title)
        return col
    }

    private fun detailPage(label: String): LinearLayout {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(18), dp(24))
        }
        val back = Button(this).apply {
            text = "‹  $label"
            textSize = 17f
            isAllCaps = false
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setTextColor(text)
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { detail = false; showTab(currentTab) }
        }
        col.addView(back, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        return col
    }

    private fun mount(page: LinearLayout) {
        content.removeAllViews()
        val scroll = ScrollView(this)
        scroll.addView(page, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        content.addView(scroll, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ))
    }

    private fun title(parent: LinearLayout, value: String) {
        parent.addView(TextView(this).apply {
            text = value; textSize = 26f; typeface = Typeface.DEFAULT_BOLD; setTextColor(text)
            setPadding(0, dp(6), 0, dp(16))
        })
    }

    private fun section(parent: LinearLayout, value: String) {
        parent.addView(TextView(this).apply {
            text = value; textSize = 16f; typeface = Typeface.DEFAULT_BOLD; setTextColor(text)
            setPadding(0, dp(20), 0, dp(8))
        })
    }

    private fun line(parent: LinearLayout, label: String, value: String) {
        if (value.isBlank()) return
        parent.addView(TextView(this).apply {
            text = "$label  $value"; textSize = 15f; setTextColor(text)
            setPadding(0, dp(5), 0, dp(5))
        })
    }

    private fun body(parent: LinearLayout, value: String) {
        if (value.isBlank()) return
        parent.addView(TextView(this).apply {
            text = value; textSize = 15f; setTextColor(text); setLineSpacing(0f, 1.25f)
            setPadding(0, dp(4), 0, dp(8))
        })
    }

    private fun empty(parent: LinearLayout, value: String) = body(parent, value)

    private fun error(parent: LinearLayout, value: String) {
        parent.addView(TextView(this).apply {
            text = value; textSize = 15f; setTextColor(Color.rgb(190, 40, 40))
            setPadding(dp(12), dp(12), dp(12), dp(12))
        })
    }

    private fun cardView(title: String, sub: String, click: () -> Unit): View {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(card)
            }
            elevation = dp(1).toFloat()
            isClickable = true
            isFocusable = true
            setOnClickListener { click() }
            addView(TextView(this@NativeHomeActivity).apply {
                text = title; textSize = 17f; typeface = Typeface.DEFAULT_BOLD; setTextColor(text)
            })
            addView(TextView(this@NativeHomeActivity).apply {
                text = sub; textSize = 13f; setTextColor(dim); setPadding(0, dp(5), 0, 0)
            })
        }.also {
            it.layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(10) }
        }
    }

    private fun date(raw: String): String {
        if (raw.isBlank() || raw == "null") return ""
        return try {
            val input = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
            input.timeZone = TimeZone.getTimeZone("UTC")
            val d = input.parse(raw.take(19)) ?: return raw
            val out = SimpleDateFormat("M월 d일 HH:mm", Locale.KOREA)
            out.timeZone = TimeZone.getTimeZone("Asia/Seoul")
            out.format(d)
        } catch (_: Exception) { raw.take(16).replace("T", " ") }
    }

    private fun money(v: Int): String =
        if (v <= 0) "미정" else NumberFormat.getNumberInstance(Locale.KOREA).format(v) + "원"

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
