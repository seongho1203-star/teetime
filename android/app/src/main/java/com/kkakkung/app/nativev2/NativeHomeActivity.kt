package com.kkakkung.app.nativev2

import android.graphics.Color
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import coil.load
import com.kkakkung.app.R
import com.kkakkung.app.chat.ChatConfig
import com.kkakkung.app.chat.ChatScreen
import com.kkakkung.app.chat.ChatService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.time.OffsetDateTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.ZoneId
import java.util.Locale
import java.util.TimeZone

/**
 * Android Native V2 첫 앱 Shell.
 *
 * 이 화면 안에서는 WebView/React Router/NativeNav를 사용하지 않는다.
 * 홈·라운드·투표는 Supabase를 Kotlin에서 직접 읽고, 채팅은 이미 완성된
 * ChatScreen을 그대로 붙인다. 세부 기능을 이 shell 안에서 하나씩 네이티브화한다.
 */
class NativeHomeActivity : AppCompatActivity(), ScreenHost {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var content: NativeScreenStack
    private lateinit var bottom: LinearLayout
    private lateinit var api: NativeApi
    private lateinit var session: NativeSession
    private var chat: ChatScreen? = null
    private var detail = false
    private var pendingKey = "/"
    private var pendingRefresh: (() -> Unit)? = null
    private var buildingTabPreview = false
    private var builtPreview: NativeScreenStack.Screen? = null
    private var resumedOnce = false
    private fun prepareScreen(key: String, refresh: () -> Unit) { pendingKey = key; pendingRefresh = refresh }
    private fun navigateBack() {
        (getSystemService(INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager)?.hideSoftInputFromWindow(content.windowToken, 0)
        currentFocus?.clearFocus()
        if (!content.pop()) showTab("home")
    }

    // ── 앱 화면(`NativeScreen`)이 부탁하는 것들 ─────────────────
    /** 주소마다 살아 있는 앱 화면 — 다시 받을 때(`refresh`) 그 화면의 `load()`를 부른다. */
    private val screens = mutableMapOf<String, NativeScreen>()
    override val hostApi: NativeApi get() = api
    override val hostScope: CoroutineScope get() = scope
    override val myId: String get() = session.userId
    override fun back(refreshBehind: Boolean) {
        if (refreshBehind) content.invalidatePrevious()
        navigateBack()
    }
    override fun editRound(r: JSONObject) = roundForm(r)
    override fun copyRound(r: JSONObject) = roundForm(r, copy = true)
    override fun roundGroups(r: JSONObject, people: List<JSONObject>) = showGroups(r, people)
    override fun newSettlement(roundId: String, joined: List<String>, people: List<JSONObject>) = settlementForm(roundId, joined, people)
    override fun editPoll(p: JSONObject) = pollEditForm(p)
    override fun editPost(p: JSONObject) = postForm(p)
    override fun open(path: String) = if (path == "/" || path.isEmpty()) showTab("home") else openNativeUrl(path)

    /** 앱 화면을 올린다 — 머리말·본문을 화면이 스스로 그리므로 `mount`처럼 감싸지 않는다. */
    private fun mountScreen(screen: NativeScreen) {
        val key = pendingKey
        screens.keys.retainAll { k -> content.contains(k) }
        screens[key] = screen
        content.show(key, screen.root, false, pendingRefresh, replace = replaceNextMount)
        replaceNextMount = false
        screen.load()
    }

    private var currentTab = "home"
    private val tabs = linkedMapOf<String, Button>()
    private val tabBadges = linkedMapOf<String, TextView>()
    private var badgeJob: Job? = null
    private var bellBadge: TextView? = null
    private fun refreshBadges() {
        if (!::api.isInitialized || badgeJob?.isActive == true) return
        badgeJob = scope.launch {
            suspend fun safe(block: suspend () -> Int) = try { block() } catch (_: Exception) { 0 }
            val since = getSharedPreferences("native-seen", MODE_PRIVATE).getString("board:${session.userId}", "1970-01-01T00:00:00Z")!!
            val values = mapOf(
                "home" to safe { if (api.profile()?.optString("role") in setOf("staff", "admin", "superadmin")) api.pendingCount() else 0 },
                "board" to safe { api.rows("posts", listOf("select" to "id", "created_at" to "gt.$since", "limit" to "100")).size },
                "chat" to safe { api.unreadChatCount() },
                "rounds" to safe { api.upcomingRounds(200).count { it.optString("status") == "open" } },
                "polls" to safe { api.openPolls(200).count { !it.optBoolean("closed") && !pollExpired(it.optString("closes_at")) } }
            )
            values.forEach { (id, n) -> tabBadges[id]?.let { badge -> badge.text = if (n > 99) "99+" else "$n"; badge.visibility = if (n > 0) View.VISIBLE else View.GONE } }
            val alerts = safe { api.unreadAlertCount() }
            bellBadge?.let { it.text = if (alerts > 99) "99+" else "$alerts"; it.visibility = if (alerts > 0) View.VISIBLE else View.GONE }
        }
    }


    /* src/styles/tokens.css와 숫자까지 같은 까꿍 디자인 토큰.
       Native V2에서 새 색을 만들지 않는다. */
    private val brand = Color.rgb(217, 43, 142)       // #d92b8e
    private val brandDeep = Color.rgb(180, 31, 114)   // #b41f72
    private val grass = Color.rgb(124, 184, 40)       // #7cb828
    private val grassDeep = Color.rgb(91, 141, 24)    // #5b8d18
    private val bg = Color.rgb(245, 247, 241)          // #f5f7f1
    private val card = Color.WHITE                     // --surface
    private val surface2 = Color.rgb(239, 242, 233)   // #eff2e9
    private val line = Color.rgb(221, 227, 209)        // #dde3d1
    private val ink = Color.rgb(27, 31, 25)            // #1b1f19
    private val dim = Color.rgb(91, 100, 85)           // #5b6455
    private val faint = Color.rgb(139, 148, 134)       // #8b9486
    private val danger = Color.rgb(226, 64, 42)        // #e2402a
    private val warn = Color.rgb(185, 124, 0)          // #b97c00

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) enableNativePush() else toast("알림 권한이 꺼져 있습니다.")
    }

    private val avatarPicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@registerForActivityResult
        scope.launch {
            try {
                val raw = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
                    ?: throw NativeApiError("사진을 읽지 못했습니다.")
                val ratio = minOf(1f, 400f / maxOf(raw.width, raw.height).toFloat())
                val scaled = if (ratio < 1f) Bitmap.createScaledBitmap(
                    raw, (raw.width * ratio).toInt(), (raw.height * ratio).toInt(), true
                ) else raw
                val bytes = ByteArrayOutputStream().use {
                    scaled.compress(Bitmap.CompressFormat.JPEG, 88, it); it.toByteArray()
                }
                api.uploadAvatar(bytes)
                toast("프로필 사진을 바꿨습니다.")
                showMe()
            } catch (e: Exception) {
                toast(e.message ?: "사진을 바꾸지 못했습니다.")
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NativeSessionStore.init(this)
        session = NativeSessionStore.current ?: NativeSessionStore.restore(this) ?: run {
            finish(); return
        }
        api = NativeApi(session)
        NativeChatShared.load(this)
        window.statusBarColor = bg
        window.navigationBarColor = card
        buildShell()
        /* 만료 직전이면 첫 화면을 읽기 전에 갱신한다. 실패하면 저장 세션을
           지우고 뒤의 웹 로그인 화면으로 돌아간다. */
        if (session.needsRefresh) {
            val page = page("까꿍")
            val loading = ProgressBar(this); page.addView(loading); mount(page)
            scope.launch {
                try { NativeAuth.refresh(session); showHome() }
                catch (e: Exception) {
                    NativeSessionStore.clear(this@NativeHomeActivity)
                    toast(e.message ?: "다시 로그인해 주세요.")
                    startActivity(android.content.Intent(this@NativeHomeActivity, NativeLoginActivity::class.java)
                        .addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK or android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
                    finish()
                }
            }
        } else {
            routeAfterLogin()
        }

        /* Android 13+ 뒤로 제스처/버튼을 같은 native stack으로 보낸다.
           IME가 떠 있으면 첫 뒤로가기는 키보드만 내리고 화면은 유지한다. */
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val imeVisible = ViewCompat.getRootWindowInsets(content)
                    ?.isVisible(WindowInsetsCompat.Type.ime()) == true
                if (imeVisible) {
                    val imm = getSystemService(android.content.Context.INPUT_METHOD_SERVICE)
                        as? android.view.inputmethod.InputMethodManager
                    imm?.hideSoftInputFromWindow(content.windowToken, 0)
                    content.clearFocus()
                    return
                }
                when {
                    content.canPop -> navigateBack()
                    currentTab != "home" -> showHome()
                    else -> {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra("native_url")?.takeIf { it.isNotBlank() }?.let(::openNativeUrl)
    }

    override fun onDestroy() {
        chat?.destroy()
        scope.cancel()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        if (!::api.isInitialized || !::content.isInitialized) return
        if (resumedOnce && currentFocus !is EditText && !content.transitioning) content.current?.refresh?.invoke()
        resumedOnce = true
        NativePushForeground.active = true
        refreshBadges()
        val pushPrefs = getSharedPreferences("native-push", MODE_PRIVATE)
        if (pushPrefs.getBoolean("asked", false) && !pushPrefs.getBoolean("disabled", false) && NativePush.permissionGranted(this)) {
            scope.launch { try { api.enablePush(NativePush.token()) } catch (_: Exception) { } }
        }
        content.postDelayed({
            if (!isFinishing && NativePushForeground.active) {
                val prefs = getSharedPreferences("native-push", MODE_PRIVATE)
                if (!prefs.getBoolean("asked", false) && !prefs.getBoolean("disabled", false)) {
                    prefs.edit().putBoolean("asked", true).apply()
                    if (NativePush.requestIfNeeded(this, notificationPermission)) enableNativePush()
                }
            }
        }, 1500)

    }

    override fun onPause() {
        NativePushForeground.active = false
        super.onPause()
    }

    private fun routeAfterLogin() {
        val loading = page("까꿍")
        val spin = ProgressBar(this); loading.addView(spin); mount(loading)
        scope.launch {
            try {
                val profile = api.ensurePendingProfile(session.displayName)
                val contact = api.privateProfile()
                when (profile.optString("role")) {
                    "banned" -> showAccountGate(profile, contact, banned = true)
                    "pending", "" -> showAccountGate(profile, contact, banned = false)
                    else -> {
                        if (nativeNeedsProfile(profile, contact)) showRequiredProfile(profile, contact)
                        else {
                            showHome()
                            intent.getStringExtra("native_url")?.takeIf { it.isNotBlank() }?.let { target ->
                                content.post { openNativeUrl(target) }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                loading.removeView(spin); error(loading, e.message ?: "회원 정보를 불러오지 못했습니다.")
            }
        }
    }

    private fun nativeNeedsProfile(p: JSONObject, c: JSONObject?): Boolean {
        /* 웹 needsProfile/needsBirthday와 같은 기준. DB에 칸 자체가 없으면 막지 않는다. */
        val publicMissing = p.has("gender") && p.has("birth_year") && p.has("region") &&
            (p.optString("gender").isBlank() || p.optInt("birth_year", 0) <= 0 || p.optString("region").isBlank())
        val birthdayMissing = c != null && c.has("birth_md") && c.optString("birth_md").isBlank()
        return publicMissing || birthdayMissing
    }

    private fun showAccountGate(profile: JSONObject, contact: JSONObject?, banned: Boolean) {
        detail = true
        bottom.visibility = View.GONE
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(16), dp(24), dp(16), dp(24))
        }
        page.addView(TextView(this).apply {
            text = if (banned) "이용 제한" else "가입 승인 대기중"
            textSize = 24f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink); gravity = Gravity.CENTER
        })
        page.addView(TextView(this).apply {
            text = if (banned)
                "이 계정은 이용이 제한되었습니다.\n궁금한 점은 운영진에게 물어봐 주세요."
            else "운영진이 명단에서 승인하면 바로 들어갈 수 있습니다.\n알아볼 수 있게 아래 정보를 적어 주세요."
            textSize = 13f; setTextColor(dim); gravity = Gravity.CENTER; setLineSpacing(0f, 1.5f)
            setPadding(0, dp(8), 0, dp(14))
        })
        if (banned) {
            page.addView(action("로그아웃", danger = true) { logoutNative() })
            mount(page); return
        }
        val cardBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
            }
        }
        profileGateForm(cardBox, profile, contact, pending = true)
        page.addView(cardBox, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        page.addView(action("승인 여부 다시 확인") { routeAfterLogin() })
        page.addView(action("로그아웃", danger = true) { logoutNative() })
        mount(page)
    }

    private fun showRequiredProfile(profile: JSONObject, contact: JSONObject?) {
        detail = true
        bottom.visibility = View.GONE
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(24), dp(16), dp(24))
        }
        title(page, "몇 가지만 더 알려 주세요")
        body(page, "생년월일 · 성별 · 거주지역이 빠져 있습니다.\n조 편성과 생일 축하에 사용합니다.")
        val cardBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
            }
        }
        profileGateForm(cardBox, profile, contact, pending = false)
        page.addView(cardBox)
        page.addView(action("로그아웃", danger = true) { logoutNative() })
        mount(page)
    }

    private fun profileGateForm(
        page: LinearLayout, profile: JSONObject, contact: JSONObject?, pending: Boolean
    ) {
        fun field(hintText: String, value: String = "", numeric: Boolean = false): EditText {
            val e = EditText(this).apply {
                hint = hintText; setText(value); textSize = 15f
                if (numeric) inputType = InputType.TYPE_CLASS_NUMBER
            }
            page.addView(e); return e
        }
        val name = field("닉네임", profile.optString("name"))
        val phone = field("전화번호", contact?.optString("phone").orEmpty())
        val year = field("태어난 해 (예: 1984)", profile.optInt("birth_year", 0).takeIf { it > 0 }?.toString().orEmpty(), true)
        val month = field("생일 월", contact?.optString("birth_md")?.substringBefore('-')?.takeIf { it.isNotBlank() }.orEmpty(), true)
        val day = field("생일 일", contact?.optString("birth_md")?.substringAfter('-', "")?.takeIf { it.isNotBlank() }.orEmpty(), true)
        val male = CheckBox(this).apply {
            text = "남성 (체크 해제 = 여성)"; isChecked = profile.optString("gender") != "f"
        }
        page.addView(male)
        val car = field("차량번호", contact?.optString("car").orEmpty())
        val region = field("거주지역", profile.optString("region"))
        val lunar = CheckBox(this).apply {
            text = "음력 생일"; isChecked = contact?.optString("birth_cal") == "lunar"
        }
        page.addView(lunar)
        page.addView(action(if (pending) "저장" else "저장하고 시작하기", primary = true) {
            val y = year.text.toString().toIntOrNull() ?: 0
            val m = month.text.toString().toIntOrNull() ?: 0
            val d = day.text.toString().toIntOrNull() ?: 0
            val n = name.text.toString().trim()
            val r = region.text.toString().trim()
            if (n.isBlank()) { toast("닉네임을 적어 주세요."); return@action }
            if (pending && phone.text.toString().trim().isBlank()) { toast("전화번호를 적어 주세요."); return@action }
            if (pending && car.text.toString().trim().isBlank()) { toast("차량번호를 적어 주세요."); return@action }
            if (y !in 1900..2100) { toast("태어난 해를 확인해 주세요."); return@action }
            if (m !in 1..12 || d !in 1..31) { toast("생일의 월·일을 확인해 주세요."); return@action }
            if (r.isBlank()) { toast("거주지역을 적어 주세요."); return@action }
            val md = "%02d-%02d".format(m, d)
            mutate {
                api.updateMyProfile(
                    n, if (male.isChecked) "m" else "f", y, r,
                    phone.text.toString().trim(), car.text.toString().trim(),
                    md, if (lunar.isChecked) "lunar" else "solar"
                )
                toast(if (pending) "저장했습니다. 운영진이 승인하면 들어갈 수 있습니다." else "저장했습니다.")
                routeAfterLogin()
            }
        })
    }

    private fun logoutNative() {
        NativeSessionStore.clear(this)
        startActivity(android.content.Intent(this, NativeLoginActivity::class.java)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }

    private fun buildShell() {
        val root = FrameLayout(this).apply { setBackgroundColor(bg) }
        content = NativeScreenStack(this).apply {
            setBackgroundColor(bg)
            changed = {
                detail = content.canPop
                val top = content.current
                if (!detail) (top?.view?.tag as? LinearLayout)?.let { bar -> bindBottomBar(bar) }
                if (top?.key == "/chat") {
                    chat?.attach(top.view as ViewGroup)
                } else chat?.let { if (it.parent != null) it.detach(keepView = content.contains("/chat")) }
                refreshBadges()
            }
            tabSelected = { key ->
                currentTab = key.removePrefix("/").ifEmpty { "home" }
                if (currentTab == "board") getSharedPreferences("native-seen", MODE_PRIVATE).edit().putString("board:${session.userId}", java.time.Instant.now().toString()).apply()
            }
            tabNeighbor = { direction ->
                val order = listOf("home", "board", "rounds", "polls")
                val index = order.indexOf(currentTab) + direction
                if (index !in order.indices) null else {
                    val before = currentTab
                    buildingTabPreview = true; builtPreview = null
                    showTab(order[index])
                    buildingTabPreview = false
                    currentTab = before; selectTabCompat(before)
                    builtPreview
                }
            }
        }
        bottom = makeBottomBar()
        root.addView(content, FrameLayout.LayoutParams(-1, -1))

        /* Android 15(target 35)의 edge-to-edge 보정.
           - 평소: 기존 까꿍 디자인/64dp 탭바는 그대로 두고 system bar만 피한다.
           - 키보드: 기존 웹의 useKeyboardChrome과 똑같이 하단 탭바만 숨긴다.
             ChatScreen은 별도로 IME inset을 받아 입력창을 키보드 바로 위에 붙인다.
           디자인 수치·색상·카드에는 손대지 않는다. */
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, ins ->
            val bars = ins.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = ins.getInsets(WindowInsetsCompat.Type.ime())
            val imeVisible = ins.isVisible(WindowInsetsCompat.Type.ime())
            /* Native V2에서는 shell 한 곳만 IME를 처리한다.
               키보드가 뜨면 content의 실제 바닥을 IME 윗선으로 올리고 탭바를
               숨긴다. ChatScreen/댓글칸이 따로 IME 높이를 더하지 않으므로
               '키보드는 떴는데 입력창은 아래에 남음'과 이중 여백을 함께 막는다. */
            v.setPadding(0, bars.top, 0, if (imeVisible) ime.bottom else bars.bottom)
            if (!content.canPop) bottom.visibility = if (imeVisible) View.GONE else View.VISIBLE
            ins
        }

        setContentView(root)
        ViewCompat.requestApplyInsets(root)

    }

    private fun makeBottomBar(): LinearLayout {
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setBackgroundColor(card) }
        listOf(Triple("home", "홈", R.drawable.ic_tab_home), Triple("board", "공지", R.drawable.ic_tab_board),
            Triple("rounds", "라운드", R.drawable.ic_tab_round), Triple("polls", "투표", R.drawable.ic_tab_poll),
            Triple("chat", "대화", R.drawable.ic_tab_chat)).forEach { (id, label, icon) ->
            val cell = FrameLayout(this)
            val b = Button(this).apply {
                tag = id; text = label; textSize = 11.5f; isAllCaps = false; gravity = Gravity.CENTER
                typeface = Typeface.DEFAULT_BOLD; setPadding(0, dp(5), 0, dp(3))
                setTextColor(if (id == currentTab) brand else faint)
                setCompoundDrawablesWithIntrinsicBounds(0, icon, 0, 0); compoundDrawablePadding = dp(3)
                compoundDrawableTintList = ColorStateList.valueOf(if (id == currentTab) brand else faint)
                setBackgroundColor(Color.TRANSPARENT); minHeight = 0; minimumHeight = 0
                setOnClickListener { if (!content.transitioning) showTab(id) }
            }
            cell.addView(b, FrameLayout.LayoutParams(-1, -1))
            cell.addView(TextView(this).apply {
                textSize = 10f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
                setPadding(dp(4), 0, dp(4), 0); minWidth = dp(16); visibility = View.GONE
                background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(if (id in setOf("rounds", "polls")) grassDeep else danger) }
            }, FrameLayout.LayoutParams(-2, dp(16), Gravity.TOP or Gravity.END).apply { rightMargin = dp(9); topMargin = dp(2) })
            bar.addView(cell, LinearLayout.LayoutParams(0, dp(58), 1f))
        }
        return bar
    }

    private fun bindBottomBar(bar: LinearLayout) {
        bottom = bar; tabs.clear(); tabBadges.clear()
        for (i in 0 until bar.childCount) {
            val cell = bar.getChildAt(i) as FrameLayout
            val button = cell.getChildAt(0) as Button
            tabs[button.tag as String] = button
            tabBadges[button.tag as String] = cell.getChildAt(1) as TextView
        }
        selectTabCompat(currentTab)
    }

    private fun showTab(id: String) {
        if (id == "chat") { showChat(); return }
        detail = false
        currentTab = id
        tabs.forEach { (key, b) ->
            val c = if (key == id) brand else faint
            b.setTextColor(c)
            b.compoundDrawableTintList = ColorStateList.valueOf(c)
            b.typeface = Typeface.DEFAULT_BOLD
        }
        when (id) {
            "home" -> showHome()
            "board" -> showBoard()
            "rounds" -> showRoundsList()
            "polls" -> showPollsList()
            "chat" -> showChat()
        }
    }

    private fun selectTabCompat(id: String) {
        tabs.forEach { (key, b) ->
            val c = if (key == id) brand else faint
            b.setTextColor(c)
            b.compoundDrawableTintList = ColorStateList.valueOf(c)
            b.typeface = Typeface.DEFAULT_BOLD
        }
    }

    /* 탭 넷은 TabPages가 그린다(아이폰 HomeTab.swift·ShellTabs.swift). 여기서는 여는 것만 한다. */
    private val tabPages by lazy {
        TabPages(this, api, scope, session.userId, object : TabNav {
            override fun openRound(id: String) = showRound(id)
            override fun openPoll(id: String) = showPoll(id)
            override fun openPost(id: String) = showPost(id)
            override fun openMe() = showMe()
            override fun openAlerts() = showAlerts()
            override fun openMembers() = showMembers()
            override fun openChat() = showChat()
            override fun newRound() = roundForm(null)
            override fun newPoll() = pollForm()
            override fun newPost() = postForm(null)
            override fun toast(msg: String) = this@NativeHomeActivity.toast(msg)
            override fun ask(title: String, msg: String, ok: () -> Unit) = confirm(title, msg, ok)
        })
    }

    private fun showTabPage(key: String, make: () -> TabPages.Page) {
        val pg = make()
        mount(pg.body, pg.head)
        pg.load()
    }

    private fun showHome() {
        prepareScreen("/") { showHome() }
        currentTab = "home"
        selectTabCompat("home")
        bottom.visibility = View.VISIBLE
        showTabPage("/") {
            tabPages.home().also { if (!buildingTabPreview) bellBadge = tabPages.homeHead?.dot }
        }
    }

    private fun nativeAvatar(profile: JSONObject?, size: Int): View =
        Ui(this).avatar(profile?.let(::AppProfile), size)

    private fun showRoundsList() {
        prepareScreen("/rounds") { showRoundsList() }
        showTabPage("/rounds") { tabPages.rounds() }
    }

    private fun showPollsList() {
        prepareScreen("/polls") { showPollsList() }
        showTabPage("/polls") { tabPages.polls() }
    }

    private fun infoPair(a: Pair<String, String>, b: Pair<String, String>): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(infoCell(a.first, a.second), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(infoCell(b.first, b.second), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(1)
            })
        }

    private fun infoCell(label: String, value: String): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(13), dp(8), dp(13), dp(8))
            setBackgroundColor(card)
            addView(TextView(this@NativeHomeActivity).apply {
                text = label; textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(faint)
            })
            addView(TextView(this@NativeHomeActivity).apply {
                text = value; textSize = 14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
            })
        }

    private fun fullDate(raw: String): String = try {
        val z = OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.of("Asia/Seoul"))
        z.format(DateTimeFormatter.ofPattern("M월 d일 (E)", Locale.KOREAN))
    } catch (_: Exception) { date(raw) }

    private fun timeOnly(raw: String): String = try {
        val z = OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.of("Asia/Seoul"))
        z.format(DateTimeFormatter.ofPattern("HH:mm", Locale.KOREAN))
    } catch (_: Exception) { "" }

    private fun listHeader(titleText: String, actionText: String, click: () -> Unit): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(TextView(this@NativeHomeActivity).apply {
                text = titleText; textSize = 24f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(this@NativeHomeActivity).apply {
                text = actionText; textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE)
                gravity = Gravity.CENTER; setPadding(dp(12), dp(7), dp(12), dp(7))
                background = GradientDrawable().apply { cornerRadius = dp(11).toFloat(); setColor(brand) }
                isClickable = true; setOnClickListener { click() }
            })
            setPadding(0, dp(2), 0, dp(12))
        }

    private fun badge(label: String, color: Int): TextView = TextView(this).apply {
        text = label; textSize = 10.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(color)
        setPadding(dp(6), dp(3), dp(6), dp(3))
        background = GradientDrawable().apply { cornerRadius = dp(99).toFloat(); setColor(surface2) }
    }.also {
        it.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { marginEnd = dp(5) }
    }

    private fun emptyBox(parent: LinearLayout, message: String) {
        parent.addView(TextView(this).apply {
            text = message; textSize = 14f; setTextColor(dim); gravity = Gravity.CENTER
            setPadding(dp(16), dp(28), dp(16), dp(28))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
            }
        })
    }

    private fun epoch(raw: String): Long = try { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        catch (_: Exception) { 0L }

    private fun daysUntil(raw: String): Long = try {
        val target = OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()
        java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.now(ZoneId.of("Asia/Seoul")), target)
    } catch (_: Exception) { 99L }

    // ── 공지 ───────────────────────────────────────────────────

    private fun showBoard() {
        prepareScreen("/board") { showBoard() }
        if (!buildingTabPreview) getSharedPreferences("native-seen", MODE_PRIVATE).edit().putString("board:${session.userId}", java.time.Instant.now().toString()).apply()
        detail = false
        currentTab = "board"; selectTabCompat("board")
        showTabPage("/board") { tabPages.board() }
    }

    private fun timeAgo(raw: String): String {
        val ms = epoch(raw)
        if (ms <= 0) return date(raw)
        val sec = maxOf(0L, (System.currentTimeMillis() - ms) / 1000)
        return when {
            sec < 60 -> "방금 전"
            sec < 3600 -> "${sec / 60}분 전"
            sec < 86400 -> "${sec / 3600}시간 전"
            sec < 604800 -> "${sec / 86400}일 전"
            else -> date(raw)
        }
    }

    private fun showPost(id: String) {
        prepareScreen("/board/$id") { screens["/board/$id"]?.load() }
        detail = true
        mountScreen(PostScreen(this, this, id))
    }

    private fun postForm(existing: JSONObject?) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(4), dp(18), 0)
        }
        val t = EditText(this).apply {
            hint = "제목"; setText(existing?.optString("title").orEmpty()); maxLines = 2
        }
        val b = EditText(this).apply {
            hint = "내용"; setText(existing?.optString("body").orEmpty()); minLines = 7
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }
        val pin = CheckBox(this).apply {
            text = "맨 위에 고정"; isChecked = existing?.optBoolean("pinned") == true
        }
        box.addView(t); box.addView(b); box.addView(pin)
        val dialog = AlertDialog.Builder(this)
            .setTitle(if (existing == null) "공지 쓰기" else "공지 수정")
            .setView(box).setNegativeButton("취소", null).setPositiveButton("저장", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val title = t.text.toString().trim()
                if (title.isBlank()) { toast("제목을 적어 주세요."); return@setOnClickListener }
                dialog.dismiss()
                mutate {
                    val id = if (existing == null)
                        api.createPost(title, b.text.toString().trim(), pin.isChecked)
                    else {
                        api.updatePost(existing.optString("id"), title, b.text.toString().trim(), pin.isChecked)
                        existing.optString("id")
                    }
                    toast(if (existing == null) "공지를 올렸습니다." else "수정했습니다.")
                    showPost(id)
                }
            }
        }
        dialog.show()
    }

    private fun showRound(id: String) {
        prepareScreen("/rounds/$id") { screens["/rounds/$id"]?.load() }
        detail = true
        mountScreen(RoundScreen(this, this, id))
    }

    private fun showGroups(round: JSONObject, people: List<JSONObject>) {
        val id = round.optString("id")
        prepareScreen("/rounds/$id/groups") { } // Editing screens are never rebuilt on resume.
        detail = true
        val page = detailPage("조 편성")
        val members = jsonObjects(round.optJSONArray("signups")).filter { it.optString("state") == "confirmed" }.sortedBy { it.optInt("seq") }
        val names = people.associateBy { it.optString("id") }
        val persons = members.map { m ->
            val uid = m.optString("user_id"); val p = names[uid]
            GroupPerson(uid, p?.optString("gender"), p?.optInt("birth_year", 0)?.takeIf { it > 0 })
        }
        val sizes = android.widget.Spinner(this).apply {
            adapter = android.widget.ArrayAdapter(this@NativeHomeActivity, android.R.layout.simple_spinner_dropdown_item, listOf("최대 2명", "최대 3명", "최대 4명"))
            setSelection(2)
        }
        page.addView(sizes)
        var assignments: Map<String, Int> = members.associate { it.optString("user_id") to it.optInt("grp", 0) }
        var tees = JSONObject()
        val editedTees = mutableSetOf<String>()
        val roster = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun paint() {
            roster.removeAllViews()
            assignments.values.filter { it > 0 }.distinct().sorted().forEach { group ->
                section(roster, RoundFormRules.groupTitle(round, group))
                roster.addView(action(tees.optString(group.toString()).takeIf { it.isNotBlank() }?.let { "티오프 ${timeOnly(it)}" } ?: "조별 티오프") {
                    val base = OffsetDateTime.parse(tees.optString(group.toString()).takeIf { it.isNotBlank() } ?: round.optString("tee_at")).atZoneSameInstant(ZoneId.of("Asia/Seoul"))
                    TimePickerDialog(this, { _, h, minute ->
                        editedTees.add(group.toString())
                        tees.put(group.toString(), base.withHour(h).withMinute(minute).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)); paint()
                    }, base.hour, base.minute, true).show()
                })
                roster.addView(action("시각 지우기") { editedTees.add(group.toString()); tees.remove(group.toString()); paint() })
                assignments.filterValues { it == group }.keys.forEach { uid -> body(roster, personLabel(names[uid])) }
            }
            val unassigned = assignments.filterValues { it <= 0 }.keys
            if (unassigned.isNotEmpty()) { section(roster, "미배정"); unassigned.forEach { body(roster, personLabel(names[it])) } }
        }
        val modes = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("seq" to "신청순", "random" to "랜덤", "gender" to "성별", "age" to "나이").forEach { (mode, label) ->
            modes.addView(action(label) { assignments = GroupRules.splitGroups(persons, sizes.selectedItemPosition + 2, mode); paint() }, LinearLayout.LayoutParams(0, -2, 1f))
        }
        page.addView(modes); page.addView(roster)
        val saveGroups = action("조 편성 저장", primary = true) {
            if (assignments.size != persons.size || assignments.values.any { it <= 0 }) { toast("확정자 모두를 편성해 주세요."); return@action }
            val result = JSONObject(); assignments.forEach { (uid, group) -> result.put(uid, group) }
            val kept = JSONObject(); assignments.values.distinct().forEach { group ->
                if (tees.has(group.toString())) kept.put(group.toString(), tees.get(group.toString()))
            }
            mutate { api.setRoundGroups(id, result, kept); toast("조 편성을 저장했습니다."); content.invalidatePrevious(); navigateBack() }
        }.apply { isEnabled = false }
        page.addView(saveGroups)
        mount(page); paint()
        scope.launch { try {
            val loaded = RoundFormRules.groupTees(round, api.groupTees(id))
            loaded.keys().forEach { key -> if (key !in editedTees) tees.put(key, loaded.get(key)) }
            paint(); saveGroups.isEnabled = true
        } catch (_: Exception) { toast("조별 시각을 받지 못했습니다. 다시 열어 주세요.") } }
    }

    private fun showPoll(id: String) {
        prepareScreen("/polls/$id") { screens["/polls/$id"]?.load() }
        detail = true
        mountScreen(PollScreen(this, this, id))
    }

    private fun showChat() {
        if (content.current?.key == "/chat") return
        prepareScreen("/chat") { chat?.let { c -> (c.parent as? ViewGroup)?.let { c.attach(it) } } }
        detail = true
        val holder = FrameLayout(this)
        val config = NativeChatShared.applyTo(JSONObject()
            .put("user", session.userId)
            .put("token", session.accessToken)
            .put("url", session.supabaseUrl)
            .put("key", session.anonKey)
            .put("seen", "1970-01-01T00:00:00Z")
            .put("back", true))
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
                            path.startsWith("/board/") -> showPost(path.substringAfter("/board/").substringBefore('/'))
                        }
                    }
                    "back" -> navigateBack()
                }
            }
        }
        content.show("/chat", holder, false, pendingRefresh)
        c.attach(holder)
    }

    // ── 알림함 ─────────────────────────────────────────────────

    private fun showAlerts() {
        prepareScreen("/alerts") { screens["/alerts"]?.load() }
        detail = true
        mountScreen(AlertsScreen(this, this))
    }

    private fun openNativeUrl(raw: String) {
        val path = raw.removePrefix("#")
        when {
            path.startsWith("/rounds/") -> showRound(path.substringAfter("/rounds/").substringBefore('/'))
            path.startsWith("/polls/") -> showPoll(path.substringAfter("/polls/").substringBefore('/'))
            path.startsWith("/board/") -> showPost(path.substringAfter("/board/").substringBefore('/'))
            path == "/rounds" -> showTab("rounds")
            path == "/polls" -> showTab("polls")
            path == "/board" -> showTab("board")
            path == "/chat" -> showTab("chat")
            path == "/alerts" -> showAlerts()
            path == "/settle" -> showSettlements()
            path == "/members" -> showMembers()
            path == "/me" -> showMe()
            path == "/help" -> showHelp()
        }
    }

    private fun showHelp() {
        prepareScreen("/help") { }
        detail = true
        mountScreen(HelpScreen(this, this))
    }

    private fun settlementForm(roundId: String, joined: List<String>, people: List<JSONObject>) {
        val candidates = people.filter { it.optString("role") !in setOf("pending", "banned") }
        val labels = candidates.map { personLabel(it).ifBlank { it.optString("name") } }.toTypedArray()
        val checked = BooleanArray(candidates.size) { i -> joined.contains(candidates[i].optString("id")) }
        val picked = candidates.mapIndexedNotNull { i, p -> if (checked[i]) p.optString("id") else null }.toMutableSet()

        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(4), dp(18), 0)
        }
        fun f(h: String, numeric: Boolean = false): EditText {
            body(box, h)
            val e = EditText(this).apply {
                contentDescription = h
                if (numeric) inputType = InputType.TYPE_CLASS_NUMBER
            }
            box.addView(e); return e
        }
        val titleField = f("정산 제목")
        val totalField = f("총금액", true)
        val bankField = f("은행")
        val accountField = f("계좌번호")
        val noteField = f("안내 (선택)")
        val peopleBtn = Button(this).apply {
            isAllCaps = false
            fun label() { text = "정산할 사람 ${picked.size}명 선택" }
            label()
            setOnClickListener {
                AlertDialog.Builder(this@NativeHomeActivity)
                    .setTitle("정산할 사람")
                    .setMultiChoiceItems(labels, checked) { _, which, on ->
                        checked[which] = on
                        val uid = candidates[which].optString("id")
                        if (on) picked.add(uid) else picked.remove(uid)
                    }
                    .setPositiveButton("완료") { _, _ -> label() }
                    .show()
            }
        }
        box.addView(peopleBtn)

        val custom = linkedMapOf<String, Int>()
        lateinit var amountBtn: Button
        amountBtn = Button(this).apply {
            text = "사람별 금액 조정"; isAllCaps = false
            setOnClickListener {
                val total = totalField.text.toString().replace(Regex("[^0-9]"), "").toIntOrNull() ?: 0
                val ids = picked.toList()
                if (total <= 0 || ids.isEmpty()) {
                    toast("총금액과 정산할 사람을 먼저 정해 주세요.")
                    return@setOnClickListener
                }
                val preview = try { SettlementRules.split(total, ids, custom) } catch (_: IllegalArgumentException) {
                    toast("고정 금액 합계를 확인해 주세요."); return@setOnClickListener
                }
                val editBox = LinearLayout(this@NativeHomeActivity).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(4), dp(18), 0)
                }
                val fields = linkedMapOf<String, EditText>()
                ids.forEachIndexed { i, uid ->
                    val who = candidates.firstOrNull { it.optString("id") == uid }
                    val value = preview.getValue(uid)
                    val name = personLabel(who).ifBlank { who?.optString("name").orEmpty() }
                    body(editBox, name)
                    val e = EditText(this@NativeHomeActivity).apply {
                        contentDescription = name
                        setText(value.toString()); inputType = InputType.TYPE_CLASS_NUMBER
                    }
                    fields[uid] = e; editBox.addView(e)
                }
                val amountDialog = AlertDialog.Builder(this@NativeHomeActivity)
                    .setTitle("사람별 금액").setView(editBox)
                    .setNegativeButton("취소", null).setPositiveButton("적용", null).create()
                amountDialog.setOnShowListener {
                    amountDialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                        val next = fields.mapValues { it.value.text.toString().toIntOrNull() ?: 0 }
                        val fixed = custom.filterKeys { it in ids }.toMutableMap()
                        next.forEach { (uid, value) -> if (value != preview[uid]) fixed[uid] = value }
                        try { SettlementRules.split(total, ids, fixed) } catch (_: IllegalArgumentException) {
                            toast("고정 금액 합계를 확인해 주세요."); return@setOnClickListener
                        }
                        custom.clear(); custom.putAll(fixed)
                        amountBtn.text = "사람별 금액 조정 ✓"
                        amountDialog.dismiss()
                    }
                }
                amountDialog.show()
            }
        }
        box.addView(amountBtn)

        val dialog = AlertDialog.Builder(this).setTitle("정산 만들기").setView(box)
            .setNegativeButton("취소", null).setPositiveButton("보내기", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val title = titleField.text.toString().trim()
                val total = totalField.text.toString().replace(Regex("[^0-9]"), "").toIntOrNull() ?: 0
                if (title.isBlank()) { toast("정산 제목을 적어 주세요."); return@setOnClickListener }
                if (picked.isEmpty()) { toast("정산할 사람을 골라 주세요."); return@setOnClickListener }
                if (total <= 0) { toast("총금액을 적어 주세요."); return@setOnClickListener }
                val ids = picked.toList()
                val amounts = try { SettlementRules.split(total, ids, custom) } catch (_: IllegalArgumentException) {
                    toast("고정 금액과 총금액을 확인해 주세요."); return@setOnClickListener
                }
                dialog.dismiss()
                mutate {
                    api.createSettlement(
                        roundId, title, noteField.text.toString().trim(),
                        bankField.text.toString().trim(), accountField.text.toString().trim(), amounts
                    )
                    toast("${ids.size}명에게 정산을 보냈습니다.")
                    showRound(roundId)
                }
            }
        }
        dialog.show()
    }

    // ── 정산 현황 ───────────────────────────────────────────────

    private fun showSettlements() {
        prepareScreen("/settle") { showSettlements() }
        detail = true
        val page = detailPage("정산 현황")
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val list = api.settlements()
                val people = api.people().associateBy { it.optString("id") }
                val roundIds = list.map { it.optString("round_id") }.filter { it.isNotBlank() }.distinct()
                val rounds = api.roundNames(roundIds)
                page.removeView(loading)
                val mine = list.filter { it.optString("created_by") == session.userId }
                val open = mine.filter { s -> jsonObjects(s.optJSONArray("settlement_shares")).any { !it.optBoolean("paid") } }
                val owed = open.sumOf { s ->
                    jsonObjects(s.optJSONArray("settlement_shares")).filter { !it.optBoolean("paid") }
                        .sumOf { it.optInt("amount") }
                }
                val summary = LinearLayout(this@NativeHomeActivity).apply {
                    orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
                    setPadding(dp(13), dp(16), dp(13), dp(16))
                    background = GradientDrawable().apply {
                        cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
                    }
                }
                if (open.isEmpty()) {
                    summary.addView(TextView(this@NativeHomeActivity).apply {
                        text = "다 걷혔습니다 👏"; textSize = 16.3f; typeface = Typeface.DEFAULT_BOLD
                        setTextColor(grassDeep)
                    })
                } else {
                    summary.addView(TextView(this@NativeHomeActivity).apply {
                        text = money(owed); textSize = 30f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
                    })
                    summary.addView(TextView(this@NativeHomeActivity).apply {
                        text = "아직 안 걷힌 정산 ${open.size}건"; textSize = 13f; setTextColor(dim)
                        setPadding(0, dp(4), 0, 0)
                    })
                }
                page.addView(summary, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(10) })
                if (mine.isEmpty()) {
                    empty(page, "내가 올린 정산이 없습니다. 라운드 상세에서 정산을 만들 수 있습니다.")
                }
                mine.forEach { settlement ->
                    val shares = jsonObjects(settlement.optJSONArray("settlement_shares"))
                    val unpaid = shares.filter { !it.optBoolean("paid") }
                    val box = LinearLayout(this@NativeHomeActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(14), dp(12), dp(14), dp(12))
                        background = GradientDrawable().apply {
                            cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
                        }
                    }
                    val titleRow = LinearLayout(this@NativeHomeActivity).apply {
                        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    }
                    titleRow.addView(TextView(this@NativeHomeActivity).apply {
                        text = settlement.optString("title"); textSize = 16.3f
                        typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
                    }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                    titleRow.addView(TextView(this@NativeHomeActivity).apply {
                        text = "›"; textSize = 20f; setTextColor(faint)
                    })
                    box.addView(titleRow)
                    val course = rounds[settlement.optString("round_id")].orEmpty()
                    if (course.isNotBlank()) box.addView(TextView(this@NativeHomeActivity).apply {
                        text = course; textSize = 11.5f; setTextColor(faint); setPadding(0, dp(3), 0, dp(5))
                    })
                    if (unpaid.isEmpty()) {
                        box.addView(badge("입금 완료", grassDeep))
                    } else {
                        box.addView(TextView(this@NativeHomeActivity).apply {
                            text = "미입금 ${unpaid.size}명 · ${money(unpaid.sumOf { it.optInt("amount") })}"
                            textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(dim)
                            setPadding(0, dp(8), 0, dp(3))
                        })
                        unpaid.forEach { share ->
                            val uid = share.optString("user_id")
                            val row = personRow(
                                personLabel(people[uid]).ifBlank { "알 수 없음" },
                                money(share.optInt("amount"))
                            )
                            row.setOnClickListener {
                                confirm("입금완료로 바꿀까요?", personLabel(people[uid])) {
                                    mutate { api.markSharePaid(share.optString("id")); showSettlements() }
                                }
                            }
                            box.addView(row)
                        }
                        box.addView(action("미입금자에게 알림 보내기", primary = true) {
                            confirm("입금 알림을 보낼까요?", "아직 안 내신 ${unpaid.size}명에게만 갑니다.") {
                                mutate { api.remindSettlement(settlement.optString("id")); toast("알림을 보냈습니다.") }
                            }
                        })
                    }
                    box.addView(action("정산 삭제", danger = true) {
                        confirm("이 정산을 지울까요?", "${shares.size}명의 몫이 함께 사라집니다.") {
                            mutate { api.deleteSettlement(settlement.optString("id")); toast("지웠습니다."); showSettlements() }
                        }
                    })
                    box.setOnClickListener {
                        val rid = settlement.optString("round_id")
                        if (rid.isNotBlank()) showRound(rid)
                    }
                    page.addView(box, LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { bottomMargin = dp(10) })
                }
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "정산을 불러오지 못했습니다.")
            }
        }
    }

    private fun showMe() {
        prepareScreen("/me") { showMe() }
        detail = true
        val page = detailPage("내 정보")
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val p = api.profile()
                val priv = api.privateProfile()
                val pushToken = try { NativePush.token() } catch (_: Exception) { "" }
                val pushOn = pushToken.isNotBlank() && NativePush.permissionGranted(this@NativeHomeActivity) &&
                    api.pushEnabled(pushToken)
                page.removeView(loading)
                if (p == null) { error(page, "프로필을 불러오지 못했습니다."); return@launch }

                /* Home.css .me-head — 얼굴 64px + 이름/직책/지역을 한 줄 머리말로. */
                val head = LinearLayout(this@NativeHomeActivity).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    setPadding(0, dp(8), 0, dp(12))
                }
                val avatarWrap = FrameLayout(this@NativeHomeActivity).apply {
                    isClickable = true; setOnClickListener { avatarPicker.launch("image/*") }
                }
                val avatar = nativeAvatar(p, 64)
                avatarWrap.addView(avatar, FrameLayout.LayoutParams(dp(64), dp(64)))
                avatarWrap.addView(TextView(this@NativeHomeActivity).apply {
                    text = "+"; textSize = 12f; typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.WHITE); gravity = Gravity.CENTER
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL; setColor(brand); setStroke(dp(2), bg)
                    }
                }, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.END or Gravity.BOTTOM))
                head.addView(avatarWrap, LinearLayout.LayoutParams(dp(66), dp(66)))

                val who = LinearLayout(this@NativeHomeActivity).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(dp(14), 0, 0, 0)
                }
                who.addView(TextView(this@NativeHomeActivity).apply {
                    text = p.optString("name").ifBlank { session.displayName.ifBlank { "회원" } }
                    textSize = 20.8f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
                })
                val meta = listOfNotNull(
                    roleLabel(p.optString("role")).takeIf { it.isNotBlank() },
                    p.optString("region").takeIf { it.isNotBlank() }
                ).joinToString(" · ")
                who.addView(TextView(this@NativeHomeActivity).apply {
                    text = meta; textSize = 13f; setTextColor(dim); setPadding(0, dp(3), 0, 0)
                })
                head.addView(who, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                page.addView(head)

                val info = LinearLayout(this@NativeHomeActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    background = GradientDrawable().apply {
                        cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
                    }
                }
                info.addView(menuInfoRow("성별", when (p.optString("gender")) { "m" -> "남성"; "f" -> "여성"; else -> "미입력" }))
                info.addView(menuInfoRow("생년월일", birthDisplay(p, priv)))
                info.addView(menuInfoRow("전화번호", priv?.optString("phone").orEmpty().ifBlank { "미입력" }))
                info.addView(menuInfoRow("차량번호", priv?.optString("car").orEmpty().ifBlank { "미입력" }))
                page.addView(info)

                section(page, "설정")
                val menu = LinearLayout(this@NativeHomeActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    background = GradientDrawable().apply {
                        cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
                    }
                }
                menu.addView(menuLink("프로필 수정") { profileForm(p, priv) })
                menu.addView(menuLink(if (pushOn) "이 기기 알림 끄기" else "이 기기로 알림 받기") {
                    if (pushOn && pushToken.isNotBlank()) {
                        mutate {
                            api.disablePush(pushToken)
                            getSharedPreferences("native-push", MODE_PRIVATE).edit().putBoolean("disabled", true).putBoolean("asked", true).apply()
                            toast("이 기기의 알림을 껐습니다.")
                            showMe()
                        }
                    } else if (NativePush.requestIfNeeded(this@NativeHomeActivity, notificationPermission)) {
                        enableNativePush()
                    }
                })
                menu.addView(menuLink("정산 현황") { showSettlements() })
                if (p.optString("role") in setOf("staff", "admin", "superadmin")) {
                    menu.addView(menuLink("회원 명단") { showMembers() })
                }
                menu.addView(menuLink("로그아웃", danger = true) { logoutNative() })
                if (p.optString("role") != "superadmin") menu.addView(menuLink("회원 탈퇴", danger = true) {
                    confirm("회원 탈퇴", "프로필과 계정이 삭제됩니다. 탈퇴하시겠습니까?") {
                        mutate { api.deleteMe(); logoutNative() }
                    }
                })
                page.addView(menu)
                page.addView(TextView(this@NativeHomeActivity).apply {
                    text = "앱제작: 악마제리\n버전 " + RoundFormRules.displayVersion(com.kkakkung.app.BuildConfig.VERSION_NAME)
                    textSize = 12f; setTextColor(faint); gravity = Gravity.CENTER
                    setPadding(0, dp(24), 0, dp(8))
                }, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ))
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "프로필을 불러오지 못했습니다.")
            }
        }
    }

    private fun menuInfoRow(label: String, value: String): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            addView(TextView(this@NativeHomeActivity).apply {
                text = label; textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(dim)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(this@NativeHomeActivity).apply {
                text = value; textSize = 13f; setTextColor(ink)
            })
        }

    private fun menuLink(label: String, danger: Boolean = false, click: () -> Unit): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(15), dp(14), dp(15))
            addView(TextView(this@NativeHomeActivity).apply {
                text = label; textSize = 14f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (danger) this@NativeHomeActivity.danger else ink)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(this@NativeHomeActivity).apply {
                text = "›"; textSize = 20f; setTextColor(faint)
            })
            isClickable = true; setOnClickListener { click() }
        }

    private fun birthDisplay(p: JSONObject, priv: JSONObject?): String {
        val y = p.optInt("birth_year", 0)
        val md = priv?.optString("birth_md").orEmpty()
        if (y <= 0 && md.isBlank()) return "미입력"
        val cal = if (priv?.optString("birth_cal") == "lunar") "음력 " else ""
        return buildString {
            if (y > 0) append(y).append("년 ")
            if (md.isNotBlank()) {
                val bits = md.split("-")
                if (bits.size == 2) append(cal).append(bits[0].toIntOrNull() ?: bits[0]).append("월 ")
                    .append(bits[1].toIntOrNull() ?: bits[1]).append("일")
            }
        }.trim()
    }

    private fun roleLabel(role: String): String = when (role) {
        "superadmin" -> "앱관리자"; "admin" -> "운영자"; "staff" -> "부운영자"
        "treasurer" -> "총무"; "pending" -> "승인 대기"; "banned" -> "추방"
        "member" -> "회원"; else -> role
    }

    private fun profileForm(profile: JSONObject, priv: JSONObject?) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(4), dp(18), 0)
        }
        fun field(h: String, v: String, numeric: Boolean = false): EditText {
            val e = EditText(this).apply {
                hint = h; setText(v); textSize = 14f
                if (numeric) inputType = InputType.TYPE_CLASS_NUMBER
                background = GradientDrawable().apply {
                    cornerRadius = dp(11).toFloat(); setColor(surface2); setStroke(dp(1), line)
                }
                setPadding(dp(12), dp(10), dp(12), dp(10))
            }
            box.addView(e, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(7) })
            return e
        }
        val name = field("닉네임", profile.optString("name"))
        val phone = field("전화번호", priv?.optString("phone").orEmpty())
        val car = field("차량번호", priv?.optString("car").orEmpty())
        val birthYear = field("태어난 해", profile.optInt("birth_year", 0).takeIf { it > 0 }?.toString().orEmpty(), true)
        val md = priv?.optString("birth_md").orEmpty().split("-")
        val month = field("생일 월", md.getOrNull(0).orEmpty(), true)
        val day = field("생일 일", md.getOrNull(1).orEmpty(), true)
        val region = field("거주지역", profile.optString("region"))

        val male = CheckBox(this).apply {
            text = "남성 (체크 해제 = 여성)"; isChecked = profile.optString("gender") != "f"
        }
        val lunar = CheckBox(this).apply {
            text = "음력 생일"; isChecked = priv?.optString("birth_cal") == "lunar"
        }
        box.addView(male); box.addView(lunar)

        val dialog = AlertDialog.Builder(this).setTitle("프로필 수정").setView(box)
            .setNegativeButton("취소", null).setPositiveButton("저장", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val n = name.text.toString().trim()
                val ph = phone.text.toString().trim()
                val ca = car.text.toString().trim()
                val y = birthYear.text.toString().toIntOrNull() ?: 0
                val m = month.text.toString().toIntOrNull() ?: 0
                val d = day.text.toString().toIntOrNull() ?: 0
                val reg = region.text.toString().trim()
                if (n.isBlank()) { toast("닉네임을 적어 주세요."); return@setOnClickListener }
                if (ph.isBlank()) { toast("전화번호를 적어 주세요."); return@setOnClickListener }
                if (ca.isBlank()) { toast("차량번호를 적어 주세요."); return@setOnClickListener }
                if (y !in 1900..2100) { toast("태어난 해를 확인해 주세요."); return@setOnClickListener }
                if (m !in 1..12 || d !in 1..31) { toast("생일의 월·일을 확인해 주세요."); return@setOnClickListener }
                if (reg.isBlank()) { toast("거주지역을 적어 주세요."); return@setOnClickListener }
                val birthMd = "%02d-%02d".format(m, d)
                dialog.dismiss()
                mutate {
                    api.updateMyProfile(
                        n, if (male.isChecked) "m" else "f", y, reg, ph, ca,
                        birthMd, if (lunar.isChecked) "lunar" else "solar"
                    )
                    toast("저장했습니다."); showMe()
                }
            }
        }
        dialog.show()
    }

    private fun showMembers() {
        prepareScreen("/members") { showMembers() }
        detail = true
        val page = detailPage("회원 명단")
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val me = api.profile()
                val people = api.people()
                val contacts = api.contacts().associateBy { it.optString("id") }
                page.removeView(loading)
                val myRole = me?.optString("role").orEmpty()
                val canManage = myRole in setOf("staff", "admin", "superadmin")
                val pending = people.filter { it.optString("role") == "pending" }
                val members = people.filter { it.optString("role") !in setOf("pending", "banned") }
                    .sortedBy { it.optString("name") }
                val banned = people.filter { it.optString("role") == "banned" }

                if (canManage && pending.isNotEmpty()) {
                    section(page, "가입 신청 ${pending.size}")
                    pending.forEach { p ->
                        val box = memberManageRow(p, contacts[p.optString("id")])
                        val actions = LinearLayout(this@NativeHomeActivity).apply { orientation = LinearLayout.HORIZONTAL }
                        actions.addView(action("거절", danger = true) {
                            confirm("${p.optString("name")}님의 가입을 거절할까요?", "명단에서 사라지고 다시 로그인하면 가입 신청부터 하게 됩니다.") {
                                mutate { api.rejectMember(p.optString("id")); toast("거절했습니다."); showMembers() }
                            }
                        }, LinearLayout.LayoutParams(0, dp(44), 1f))
                        actions.addView(action("승인", primary = true) {
                            mutate { api.setMemberRole(p.optString("id"), "member"); toast("승인했습니다."); showMembers() }
                        }, LinearLayout.LayoutParams(0, dp(44), 1f))
                        box.addView(actions); page.addView(box)
                    }
                }

                section(page, "회원 ${members.size}명")
                if (members.isEmpty()) empty(page, "아직 회원이 없습니다.")
                members.forEach { p ->
                    val box = memberManageRow(p, contacts[p.optString("id")])
                    val role = p.optString("role")
                    val above = role == "superadmin" || (role == "admin" && myRole != "superadmin")
                    val manageable = canManage && p.optString("id") != session.userId && !above
                    if (manageable) {
                        val actions = LinearLayout(this@NativeHomeActivity).apply { orientation = LinearLayout.VERTICAL }
                        if (myRole == "superadmin") {
                            actions.addView(action(if (role == "admin") "운영자 해제" else "운영자로 임명") {
                                mutate {
                                    api.setMemberRole(p.optString("id"), if (role == "admin") "member" else "admin")
                                    showMembers()
                                }
                            })
                        }
                        if (myRole in setOf("admin", "superadmin") && role != "admin") {
                            actions.addView(action(if (role == "staff") "부운영자 해제" else "부운영자로 임명") {
                                mutate {
                                    api.setMemberRole(p.optString("id"), if (role == "staff") "member" else "staff")
                                    showMembers()
                                }
                            })
                            actions.addView(action(if (role == "treasurer") "총무 해제" else "총무로 임명") {
                                mutate {
                                    api.setMemberRole(p.optString("id"), if (role == "treasurer") "member" else "treasurer")
                                    showMembers()
                                }
                            })
                        }
                        actions.addView(action("승인 대기로 내보내기", danger = true) {
                            confirm("${p.optString("name")}님을 내보낼까요?", "승인 대기 상태가 되어 앱을 볼 수 없게 됩니다.") {
                                mutate { api.setMemberRole(p.optString("id"), "pending"); showMembers() }
                            }
                        })
                        actions.addView(action("추방", danger = true) {
                            confirm("${p.optString("name")}님을 추방할까요?", "다시 로그인해도 가입 신청이 되지 않습니다.") {
                                mutate { api.setMemberRole(p.optString("id"), "banned"); showMembers() }
                            }
                        })
                        actions.visibility = View.GONE
                        val manage = TextView(this@NativeHomeActivity).apply {
                            text = "관리"; textSize = 12f; typeface = Typeface.DEFAULT_BOLD
                            setTextColor(dim); gravity = Gravity.CENTER
                            setPadding(dp(10), dp(7), dp(10), dp(7))
                            background = GradientDrawable().apply {
                                cornerRadius = dp(11).toFloat(); setColor(surface2); setStroke(dp(1), line)
                            }
                            setOnClickListener {
                                actions.visibility = if (actions.visibility == View.VISIBLE) View.GONE else View.VISIBLE
                                text = if (actions.visibility == View.VISIBLE) "닫기" else "관리"
                            }
                        }
                        box.addView(manage, LinearLayout.LayoutParams(
                            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT
                        ).apply { gravity = Gravity.END; topMargin = dp(5) })
                        box.addView(actions)
                    }
                    page.addView(box)
                }

                if (canManage && banned.isNotEmpty()) {
                    section(page, "추방 ${banned.size}명")
                    banned.forEach { p ->
                        val box = memberManageRow(p, contacts[p.optString("id")])
                        box.addView(action("추방 해제 · 승인 대기로") {
                            mutate { api.setMemberRole(p.optString("id"), "pending"); showMembers() }
                        })
                        page.addView(box)
                    }
                }
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "회원 명단을 불러오지 못했습니다.")
            }
        }
    }

    private fun memberManageRow(p: JSONObject, contact: JSONObject?): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(11), dp(14), dp(11))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
            }

            val main = LinearLayout(this@NativeHomeActivity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            }
            main.addView(nativeAvatar(p, 36), LinearLayout.LayoutParams(dp(36), dp(36)))
            val textCol = LinearLayout(this@NativeHomeActivity).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(10), 0, 0, 0)
            }
            val nameRow = LinearLayout(this@NativeHomeActivity).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            }
            nameRow.addView(TextView(this@NativeHomeActivity).apply {
                text = personLabel(p).ifBlank { p.optString("name") }
                textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink); maxLines = 1
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            val role = p.optString("role")
            if (role != "member" && role.isNotBlank()) {
                nameRow.addView(TextView(this@NativeHomeActivity).apply {
                    text = roleLabel(role); textSize = 10.5f; typeface = Typeface.DEFAULT_BOLD
                    setTextColor(when (role) {
                        "superadmin" -> brandDeep; "admin" -> brand; "staff" -> Color.rgb(46,111,178)
                        "treasurer" -> warn; "pending" -> warn; "banned" -> danger; else -> dim
                    })
                    setPadding(dp(7), 0, 0, 0)
                })
            }
            textCol.addView(nameRow)
            val details = listOfNotNull(
                contact?.optString("car")?.takeIf { it.isNotBlank() }?.let { "🚗 $it" },
                contact?.optString("phone")?.takeIf { it.isNotBlank() }?.let { "☎ $it" }
            ).joinToString(" · ")
            if (details.isNotBlank()) textCol.addView(TextView(this@NativeHomeActivity).apply {
                text = details; textSize = 11.5f; setTextColor(faint); setPadding(0, dp(3), 0, 0)
            })
            main.addView(textCol, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(main)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(7) }
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
            setPadding(dp(16), dp(10), dp(16), dp(24))
        }
        title(col, title)
        return col
    }

    private fun detailPage(label: String): LinearLayout {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(24))
        }
        /* TopBar.css: 36px back + fs-md 800 title + min-height 40px. */
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_nav_back); imageTintList = ColorStateList.valueOf(dim)
            contentDescription = "뒤로"; scaleType = ImageView.ScaleType.CENTER
            isClickable = true
            background = GradientDrawable().apply { cornerRadius = dp(11).toFloat(); setColor(Color.TRANSPARENT) }
            setOnClickListener { navigateBack() }
        }, LinearLayout.LayoutParams(dp(36), dp(40)))
        top.addView(TextView(this).apply {
            text = label; textSize = 16.3f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
            gravity = Gravity.CENTER_VERTICAL
        }, LinearLayout.LayoutParams(0, dp(40), 1f))
        col.addView(top, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(40)))
        return col
    }

    private var replaceNextMount = false
    /** `head`가 있으면 위에 붙박고 본문만 굴린다(아이폰 `ShellTabController`의 머리말). */
    private fun mount(page: LinearLayout, head: View? = null) {
        val key = pendingKey
        val root = key in setOf("/", "/board", "/rounds", "/polls")
        val scroll = ScrollView(this).apply { setBackgroundColor(bg) }
        scroll.addView(page, ViewGroup.LayoutParams(-1, -2))
        val body: View = if (head == null) scroll else LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            (head.parent as? ViewGroup)?.removeView(head)
            addView(head)
            addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        val view: View = if (root) FrameLayout(this).apply {
            setBackgroundColor(bg)
            addView(body, FrameLayout.LayoutParams(-1, -1).apply { bottomMargin = dp(58) })
            val bar = if (buildingTabPreview) makeBottomBar() else this@NativeHomeActivity.bottom
            (bar.parent as? ViewGroup)?.removeView(bar)
            bar.visibility = View.VISIBLE
            addView(bar, FrameLayout.LayoutParams(-1, dp(58), Gravity.BOTTOM)); tag = bar
        } else body
        if (buildingTabPreview) builtPreview = NativeScreenStack.Screen(key, view, pendingRefresh)
        else { content.show(key, view, root, pendingRefresh, replace = replaceNextMount); replaceNextMount = false }
    }

    private fun title(parent: LinearLayout, value: String) {
        parent.addView(TextView(this).apply {
            text = value; textSize = 24f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
            setPadding(0, dp(6), 0, dp(16))
        })
    }

    private fun section(parent: LinearLayout, value: String) {
        parent.addView(TextView(this).apply {
            text = value; textSize = 14.7f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
            setPadding(0, dp(20), 0, dp(8))
        })
    }

    private fun line(parent: LinearLayout, label: String, value: String) {
        if (value.isBlank()) return
        parent.addView(TextView(this).apply {
            text = "$label  $value"; textSize = 15f; setTextColor(ink)
            setPadding(0, dp(5), 0, dp(5))
        })
    }

    private fun body(parent: LinearLayout, value: String) {
        if (value.isBlank()) return
        parent.addView(TextView(this).apply {
            text = value; textSize = 15f; setTextColor(ink); setLineSpacing(0f, 1.25f)
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
                cornerRadius = dp(18).toFloat()
                setColor(card)
                setStroke(dp(1), line)
            }
            elevation = 0f
            isClickable = true
            isFocusable = true
            setOnClickListener { click() }
            addView(TextView(this@NativeHomeActivity).apply {
                text = title; textSize = 17f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
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

    private fun roundForm(existing: JSONObject?, copy: Boolean = false) {
        prepareScreen(if (existing == null || copy) "/rounds/new" else "/rounds/${existing.optString("id")}/edit") { }
        detail = true
        val page = detailPage(if (existing == null || copy) "모집 열기" else "라운드 수정")
        page.addView(NativeRoundEditor(this, existing, copy) { payload, button ->
            button.isEnabled = false
            scope.launch {
                try {
                    val id = if (existing == null || copy) api.createRound(payload)
                    else { api.updateRound(existing.optString("id"), payload); existing.optString("id") }
                    toast(if (existing == null || copy) "모집을 열었습니다." else "수정했습니다.")
                    if (existing != null && !copy) { content.invalidatePrevious(); navigateBack() }
                    else { replaceNextMount = true; showRound(id) }
                } catch (e: Exception) { button.isEnabled = true; toast(e.message ?: "저장하지 못했습니다.") }
            }
        })
        mount(page)
    }
    private fun pollEditForm(existing: JSONObject) {
        val options = jsonObjects(existing.optJSONArray("poll_options")).sortedBy { it.optInt("sort") }
        val votes = jsonObjects(existing.optJSONArray("poll_votes"))
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(4), dp(18), 0)
        }
        fun edit(h: String, value: String): EditText {
            val e = EditText(this).apply { hint = h; setText(value); textSize = 15f }
            box.addView(e); return e
        }
        val titleField = edit("투표 제목", existing.optString("title"))
        val desc = edit("설명", existing.optString("body"))
        val opts = edit("선택지 — 줄마다 하나", options.joinToString("\n") { it.optString("label") }).apply {
            minLines = 3; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        }
        val multi = CheckBox(this).apply { text = "복수 선택"; isChecked = existing.optBoolean("multi") }
        val anonymous = CheckBox(this).apply { text = "익명"; isChecked = existing.optBoolean("anonymous") }
        if (votes.isNotEmpty()) { multi.isEnabled = false; anonymous.isEnabled = false }
        box.addView(multi); box.addView(anonymous)
        if (votes.isNotEmpty()) body(box, "표가 들어온 뒤에는 복수 선택/익명 설정은 바꿀 수 없습니다.")
        var closes = existing.optString("closes_at")
        val closeBtn = Button(this).apply {
            text = if (closes.isBlank()) "마감 날짜·시간 고르기" else date(closes)
            isAllCaps = false
            setOnClickListener { pickDateTime { iso -> closes = iso; text = date(iso) } }
        }
        box.addView(closeBtn)
        val dialog = AlertDialog.Builder(this).setTitle("투표 수정").setView(box)
            .setNegativeButton("취소", null).setPositiveButton("저장", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val title = titleField.text.toString().trim()
                val labels = opts.text.toString().lines().map { it.trim() }.filter { it.isNotEmpty() }.distinct()
                if (title.isBlank()) { toast("제목을 적어 주세요."); return@setOnClickListener }
                if (labels.size < 2) { toast("선택지를 두 개 이상 남겨 주세요."); return@setOnClickListener }
                if (closes.isBlank()) { toast("마감 시각을 골라 주세요."); return@setOnClickListener }
                dialog.dismiss()
                mutate {
                    api.updatePoll(
                        existing.optString("id"), title, desc.text.toString().trim(),
                        multi.isChecked, anonymous.isChecked, closes, labels
                    )
                    toast("수정했습니다."); showPoll(existing.optString("id"))
                }
            }
        }
        dialog.show()
    }

    private fun pollForm() {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(4), dp(18), 0)
        }
        fun edit(hintText: String): EditText {
            val e = EditText(this).apply { hint = hintText; textSize = 15f }
            box.addView(e, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ))
            return e
        }
        val titleField = edit("투표 제목")
        val desc = edit("설명 (선택)")
        val opts = edit("선택지 — 줄마다 하나").apply {
            minLines = 3
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        }
        val multi = CheckBox(this).apply { text = "복수 선택" }; box.addView(multi)
        val anonymous = CheckBox(this).apply { text = "익명" }; box.addView(anonymous)
        fun deadline(days: Int) = ZonedDateTime.now(ZoneId.of("Asia/Seoul")).plusDays(days.toLong())
            .withHour(21).withMinute(0).withSecond(0).withNano(0).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
        var closes = deadline(7)
        val closeBtn = Button(this).apply {
            text = date(closes); isAllCaps = false
            setOnClickListener { pickDateTime(7) { iso -> closes = iso; text = date(iso) } }
        }
        box.addView(closeBtn)
        val quick = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf(3, 7, 14).forEach { days -> quick.addView(action(if (days == 14) "2주 후" else "${days}일 후") {
            closes = deadline(days); closeBtn.text = date(closes)
        }, LinearLayout.LayoutParams(0, -2, 1f)) }
        box.addView(quick)

        val dialog = AlertDialog.Builder(this).setTitle("투표 만들기").setView(box)
            .setNegativeButton("취소", null).setPositiveButton("올리기", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val title = titleField.text.toString().trim()
                val labels = opts.text.toString().lines().map { it.trim() }
                    .filter { it.isNotEmpty() }.distinct()
                if (title.isBlank()) { toast("제목을 적어 주세요."); return@setOnClickListener }
                if (labels.size < 2) { toast("선택지를 두 개 이상 적어 주세요."); return@setOnClickListener }
                if (closes.isBlank()) { toast("마감 시각을 골라 주세요."); return@setOnClickListener }
                dialog.dismiss()
                mutate {
                    val id = api.createPoll(
                        title, desc.text.toString().trim(), multi.isChecked,
                        anonymous.isChecked, closes, labels
                    )
                    toast("투표를 올렸습니다."); showPoll(id)
                }
            }
        }
        dialog.show()
    }

    private fun pickDateTime(days: Int = 1, done: (String) -> Unit) {
        val zone = ZoneId.of("Asia/Seoul")
        val base = ZonedDateTime.now(zone).plusDays(days.toLong()).withSecond(0).withNano(0)
        DatePickerDialog(this, { _, y, m, d ->
            TimePickerDialog(this, { _, h, min ->
                val z = ZonedDateTime.of(y, m + 1, d, h, min, 0, 0, zone)
                done(z.format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
            }, base.hour, base.minute, true).show()
        }, base.year, base.monthValue - 1, base.dayOfMonth).show()
    }

    private fun action(
        label: String, primary: Boolean = false, danger: Boolean = false, click: () -> Unit
    ): Button = Button(this).apply {
        text = label; textSize = 15f; isAllCaps = false
        setTextColor(if (primary) Color.WHITE else if (danger) this@NativeHomeActivity.danger else ink)
        background = GradientDrawable().apply {
            cornerRadius = dp(11).toFloat()
            setColor(if (primary) brand else card)
            if (!primary) setStroke(dp(1), if (danger) this@NativeHomeActivity.danger else line)
        }
        setOnClickListener { click() }
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(48)
        ).apply { topMargin = dp(8); bottomMargin = dp(4) }
    }

    private fun personRow(name: String, state: String): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(14), dp(11), dp(14), dp(11))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
            }
            addView(TextView(this@NativeHomeActivity).apply {
                text = name; textSize = 15f; setTextColor(ink)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(this@NativeHomeActivity).apply {
                text = state; textSize = 12f; setTextColor(dim)
            })
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(6) }
        }

    private fun commentsBlock(
        parent: LinearLayout,
        comments: List<JSONObject>,
        names: Map<String, JSONObject>,
        submit: (String) -> Unit
    ) {
        section(parent, "댓글 ${comments.size}")
        if (comments.isEmpty()) empty(parent, "아직 댓글이 없습니다.")
        comments.forEach { c ->
            val uid = c.optString("author_id")
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(10), dp(14), dp(10))
                background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(Color.WHITE) }
                val head = LinearLayout(this@NativeHomeActivity).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                }
                head.addView(TextView(this@NativeHomeActivity).apply {
                    text = personLabel(names[uid]).ifBlank { "알 수 없음" }
                    textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                head.addView(TextView(this@NativeHomeActivity).apply {
                    text = timeAgo(c.optString("created_at")); textSize = 11.5f; setTextColor(faint)
                })
                addView(head)
                addView(TextView(this@NativeHomeActivity).apply {
                    text = c.optString("body"); textSize = 14f; setTextColor(ink)
                    setLineSpacing(0f, 1.35f); setPadding(0, dp(4), 0, 0)
                })
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(6) }
            }
            if (uid == session.userId) {
                row.setOnLongClickListener {
                    confirm("댓글을 지울까요?", "지운 댓글은 되돌릴 수 없습니다.") {
                        mutate {
                            val table = when {
                                c.has("round_id") -> "round_comments"
                                c.has("post_id") -> "post_comments"
                                else -> "poll_comments"
                            }
                            api.deleteRow(table, c.optString("id"))
                            when (table) {
                                "round_comments" -> showRound(c.optString("round_id"))
                                "post_comments" -> showPost(c.optString("post_id"))
                                else -> showPoll(c.optString("poll_id"))
                            }
                        }
                    }
                    true
                }
            }
            parent.addView(row)
        }

        val input = EditText(this).apply {
            hint = "댓글 남기기"; textSize = 15f; setTextColor(ink); setHintTextColor(dim)
            minHeight = dp(48); maxLines = 5
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or
                InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setPadding(dp(14), dp(10), dp(14), dp(10))
            background = GradientDrawable().apply {
                cornerRadius = dp(11).toFloat(); setColor(surface2)
                setStroke(dp(1), line)
            }
        }
        parent.addView(input, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(8) })
        parent.addView(action("등록", primary = true) {
            val value = input.text.toString().trim()
            if (value.isNotEmpty()) submit(value)
        })
    }

    private fun jsonObjects(a: JSONArray?): List<JSONObject> {
        if (a == null) return emptyList()
        return buildList { for (i in 0 until a.length()) a.optJSONObject(i)?.let(::add) }
    }

    private fun personLabel(p: JSONObject?): String {
        if (p == null) return ""
        val parts = ArrayList<String>()
        val y = p.optInt("birth_year", 0)
        if (y > 0) parts.add((y % 100).toString().padStart(2, '0'))
        p.optString("name").trim().takeIf { it.isNotEmpty() }?.let(parts::add)
        p.optString("region").trim().takeIf { it.isNotEmpty() }?.let(parts::add)
        return parts.joinToString("/")
    }

    private fun isPast(raw: String): Boolean = try {
        val day = OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()
        day.isBefore(java.time.LocalDate.now(ZoneId.of("Asia/Seoul")))
    } catch (_: Exception) { false }

    private fun pollExpired(raw: String): Boolean {
        if (raw.isBlank() || raw == "null") return false
        return try { OffsetDateTime.parse(raw).toInstant().toEpochMilli() < System.currentTimeMillis() }
        catch (_: Exception) { false }
    }

    private fun confirm(title: String, message: String, yes: () -> Unit) {
        AlertDialog.Builder(this)
            .setTitle(title).setMessage(message)
            .setNegativeButton("취소", null)
            .setPositiveButton("확인") { _, _ -> yes() }
            .show()
    }

    private fun mutate(work: suspend () -> Unit) {
        scope.launch {
            try { work() }
            catch (e: Exception) { toast(e.message ?: "처리하지 못했습니다.") }
        }
    }

    private fun enableNativePush() {
        mutate {
            val token = NativePush.token()
            api.enablePush(token)
            getSharedPreferences("native-push", MODE_PRIVATE).edit().putBoolean("disabled", false).putBoolean("asked", true).apply()
            toast("이 기기로 알림을 받습니다.")
            if (content.current?.key == "/me") showMe()
        }
    }

    private fun toast(message: String) =
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

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
