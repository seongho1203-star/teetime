package com.kkakkung.app.nativev2

import android.graphics.Color
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.text.InputType
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
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
import kotlinx.coroutines.withContext
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
    override fun editPoll(p: JSONObject) = showPollEdit(p)
    override fun editPost(p: JSONObject) = showPostEdit(p)
    override fun replaceWith(path: String) { content.invalidatePrevious(); replaceNextMount = true; open(path) }
    /* 승인 전에는 가이드의 `홈으로 가기`가 막는 화면으로 돌아간다(홈이 아직 없다). */
    override fun open(path: String) = if (gated) navigateBack() else if (path == "/" || path.isEmpty()) showTab("home") else openNativeUrl(path)
    override fun pickAvatar(done: (ByteArray?) -> Unit) { avatarDone = done; avatarPicker.launch("image/*") }
    override fun askPushPermission(done: (Boolean) -> Unit) {
        if (NativePush.requestIfNeeded(this, notificationPermission)) done(true) else pushDone = done
    }
    override fun logout() = logoutNative()
    override fun editProfile(profile: JSONObject?, contact: JSONObject?) = showMeEdit(profile, contact)
    override fun makeAvatar(name: String) {
        prepareScreen("/me/avatar") { }
        detail = true
        mountScreen(AvatarMakerScreen(this, this, name))
    }
    private var avatarDone: ((ByteArray?) -> Unit)? = null
    private var pushDone: ((Boolean) -> Unit)? = null

    /** 앱 화면을 올린다 — 머리말·본문을 화면이 스스로 그리므로 `mount`처럼 감싸지 않는다. */
    private fun mountScreen(screen: NativeScreen) {
        /* 화면이 밀리는 중이면 아무것도 안 한다 — 예전에는 `content.show`만 돌아서고
           화면 등록·조회·`detail`은 그대로 남아, 보이지 않는 화면이 반쯤 열린 채 남았다. */
        if (content.transitioning) { detail = content.canPop; return }
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
    /** 마지막으로 받은 알림 수 — 새로 그린 홈의 종에 **받아 오기 전부터** 붙인다(없다가 다시 뜨지 않게). */
    private var lastAlerts = 0
    private fun paintBell(dot: TextView?) {
        dot ?: return
        dot.text = if (lastAlerts > 99) "99+" else "$lastAlerts"
        dot.visibility = if (lastAlerts > 0) View.VISIBLE else View.GONE
    }
    /**
     * 생일이면 대화방에 축하 글 — **앱을 연 사람의 화면이 하루 한 번** 부른다(웹 `announceBirthdays`와 같은 결 ·
     * pg_cron을 새로 켜지 않는다). 기기마다 하루 한 번만 묻고, 실패하면 표를 지워 다음에 다시 해 본다.
     */
    private fun announceBirthdays() {
        val today = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Seoul"))
        val prefs = getSharedPreferences("native-birthday", MODE_PRIVATE)
        if (prefs.getString("day", "") == today.toString()) return
        prefs.edit().putString("day", today.toString()).apply()
        scope.launch {
            try { api.postBirthdays(today) }
            catch (_: Exception) { prefs.edit().remove("day").apply() }   // 함수가 없는 저장소 — 조용히 넘긴다
        }
    }

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
            lastAlerts = safe { api.unreadAlertCount() }
            paintBell(bellBadge)
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
        val done = pushDone
        pushDone = null
        if (done != null) done(granted)
        else if (granted) enableNativePush() else toast("알림 권한이 꺼져 있습니다.")
    }

    /** 얼굴 사진 고르기 — 400px JPEG로 줄여 화면에 넘긴다(올리는 것은 `MeScreen`이 한다). */
    private val avatarPicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val done = avatarDone
        avatarDone = null
        if (uri == null || done == null) { done?.invoke(null); return@registerForActivityResult }
        scope.launch {
            val bytes = withContext(Dispatchers.IO) {
                try {
                    val raw = contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) } ?: return@withContext null
                    val ratio = minOf(1f, 400f / maxOf(raw.width, raw.height).toFloat())
                    val scaled = if (ratio < 1f) Bitmap.createScaledBitmap(raw, (raw.width * ratio).toInt(), (raw.height * ratio).toInt(), true) else raw
                    ByteArrayOutputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, 82, it); it.toByteArray() }
                } catch (_: Exception) { null }
            }
            if (bytes == null) toast("사진을 못 불러왔습니다.")
            done(bytes)
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
        putCover()
        /* 서버가 갱신 열쇠를 거절했으면(정말로 로그인이 끝났으면) 로그인 화면으로. */
        NativeAuth.onExpired = { runOnUiThread { if (!isFinishing) logoutNative() } }
        /* 만료 직전이면 첫 화면을 읽기 전에 갱신한다. **로그인을 지우는 것은 서버가
           거절했을 때뿐이다**(`NativeAuth.refresh`가 `onExpired`로 보낸다) — 깨어나자마자
           인터넷이 덜 붙어 실패한 것이면 그대로 홈을 열고, 조회가 다시 갱신해 본다. */
        if (session.needsRefresh) {
            val page = page("까꿍")
            val loading = ProgressBar(this); page.addView(loading); mount(page)
            scope.launch {
                try { NativeAuth.refresh(session); showHome() }
                catch (e: Exception) {
                    if ((e as? NativeApiError)?.code == "expired") return@launch
                    showHome()
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
        NativeAuth.onExpired = null
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
        announceBirthdays()
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

    /*
     * **홈이 다 받아질 때까지 까꿍 첫 화면을 그대로 둔다**(아이폰 `ShellController.putCover`와
     * 같다 · 사용자 요청 — `처음 접속할때 까꿍로고가 전체화면으로 뜨는데 그때 백그라운드에서
     * 미리 로딩하고 띄우면 어떨까?`). 흰 바탕 · 가운데 200dp — 웹 `.boot`와 같은 그림이다
     * (`boot_logo` · 앱 아이콘에서 뽑았다).
     * **창 바탕(`AppTheme.Boot`)과 같은 `boot_window` 한 장을 깐다**(사용자 제보 — `로고가 중간에
     * 한번 깜빡이던데`). 로그인 창 → 홈 창 → 이 가리개로 넘어가는 동안 셋이 같은 그림이라
     * 이어 보인다. 폭의 52%로 줄이는 셈(웹·아이폰)은 창 바탕 그림이 못 하므로 200dp로 못박았다 —
     * 둘을 따로 재면 넘어가는 순간 크기가 한 번 바뀐다.
     * 걷는 신호는 홈을 처음 다 그렸을 때(`TabPages.onHomeLoaded`) · 막는 화면(승인 대기 등)이
     * 설 때 · 오류가 날 때이고, **그래도 4초 뒤에는 무조건 걷는다** — 통신이 막혀 첫 화면에
     * 갇히면 앱이 죽은 것처럼 보인다.
     */
    private var cover: View? = null
    private fun putCover() {
        val c = FrameLayout(this).apply {
            background = ContextCompat.getDrawable(this@NativeHomeActivity, R.drawable.boot_window)
            isClickable = true
            contentDescription = "까꿍"
        }
        (window.decorView as ViewGroup).addView(c, ViewGroup.LayoutParams(-1, -1))
        cover = c
        tabPages.onHomeLoaded = { dropCover() }
        c.postDelayed({ dropCover() }, 4000)
    }
    private fun dropCover() {
        val c = cover ?: return
        cover = null
        tabPages.onHomeLoaded = null
        /* 창 바탕의 로고도 이제 걷는다 — 남겨 두면 키보드가 화면을 줄일 때 틈으로 비친다. */
        window.setBackgroundDrawable(ColorDrawable(bg))
        c.animate().alpha(0f).setDuration(200).withEndAction { (c.parent as? ViewGroup)?.removeView(c) }.start()
    }

    private fun routeAfterLogin() {
        val loading = page("까꿍")
        val spin = ProgressBar(this); loading.addView(spin); mount(loading)
        scope.launch {
            try {
                val profile = api.ensurePendingProfile(session.displayName)
                val contact = api.privateProfile()
                when (profile.optString("role")) {
                    "banned" -> showGate(AccountGateScreen.Mode.BANNED, profile, contact)
                    "pending", "" -> showGate(AccountGateScreen.Mode.PENDING, profile, contact)
                    else -> {
                        if (nativeNeedsProfile(profile, contact)) showGate(AccountGateScreen.Mode.FILL, profile, contact)
                        else {
                            gated = false
                            showHome()
                            intent.getStringExtra("native_url")?.takeIf { it.isNotBlank() }?.let { target ->
                                content.post { openNativeUrl(target) }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                dropCover()
                loading.removeView(spin); error(loading, e.message ?: "회원 정보를 불러오지 못했습니다.")
            }
        }
    }

    private fun nativeNeedsProfile(p: JSONObject, c: JSONObject?): Boolean {
        /* 웹 needsProfile/needsBirthday와 같은 기준. DB에 칸 자체가 없으면 막지 않는다. */
        val publicMissing = p.has("gender") && p.has("birth_year") && p.has("region") &&
            (p.optString("gender").isBlank() || p.optInt("birth_year", 0) <= 0 || p.optString("region").isBlank())
        val birthdayMissing = c != null && c.has("birth_md") && c.optString("birth_md").isBlank()
        /* 애플로 들어오면 이름이 없다 — 이름이 빈 사람은 명단에서 누군지 알 수 없다(웹 `needsProfile`). */
        val nameMissing = p.optString("name").isBlank()
        return publicMissing || birthdayMissing || nameMissing
    }

    /** 들어가기 전에 막는 화면(승인 대기·추방·빠진 정보) — 뿌리에 세워 끌어서 뒤로 못 가게 한다. */
    private var gated = false
    private fun showGate(mode: AccountGateScreen.Mode, profile: JSONObject, contact: JSONObject?) {
        dropCover()
        detail = true
        gated = true
        bottom.visibility = View.GONE
        val screen = AccountGateScreen(this, this, mode, profile, contact,
            enter = { gated = false; routeAfterLogin() },
            showHelp = { showHelp() },
            logout = { logoutNative() })
        screens.keys.retainAll { k -> content.contains(k) }
        screens["/gate"] = screen
        content.show("/gate", screen.root, true, { screens["/gate"]?.load() })
        screen.load()
    }

    private fun logoutNative() {
        NativeSessionStore.clear(this)
        startActivity(android.content.Intent(this, NativeLoginActivity::class.java)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK))
        finish()
    }

    /**
     * 바닥 띠(내비게이션 바 자리) 색 — **화면이 밀리는 만큼 섞는다**(사용자 제보 — `대화버튼을
     * 눌러서 채팅화면이 밀려들어오고 밀려나갈때 탭바 아랫부분이 색이 바뀌면서 들어오는데 뭔가
     * 부자연스러워`). 예전에는 대화 화면이 붙는 순간 `navigationBarColor`를 한 번에 보라로
     * 바꿔, 화면은 아직 오른쪽 끝에 있는데 바닥만 먼저 물들었다.
     * 안드로이드 15(target 35)는 `navigationBarColor`를 무시하므로 **뿌리가 제 아래 여백
     * (시스템 바 몫)을 직접 칠한다** — 둘 다 같은 값을 쓴다. 대화방만 보라 · 나머지는 탭바의 흰색.
     */
    private var navTint = Color.WHITE
    private lateinit var shellRoot: FrameLayout
    private val navPaint = android.graphics.Paint()
    private fun navColorOf(s: NativeScreenStack.Screen?) = if (s?.key == "/chat") com.kkakkung.app.chat.ChatSkin.bg else card
    private fun setNavTint(c: Int) {
        if (c == navTint) return
        navTint = c
        window.navigationBarColor = c
        if (::shellRoot.isInitialized) shellRoot.invalidate()
    }
    private val blend = android.animation.ArgbEvaluator()

    private fun buildShell() {
        val root = object : FrameLayout(this) {
            override fun dispatchDraw(canvas: android.graphics.Canvas) {
                super.dispatchDraw(canvas)
                if (paddingBottom > 0) {
                    navPaint.color = navTint
                    canvas.drawRect(0f, (height - paddingBottom).toFloat(), width.toFloat(), height.toFloat(), navPaint)
                }
            }
        }.apply { setBackgroundColor(bg) }
        shellRoot = root
        content = NativeScreenStack(this).apply {
            setBackgroundColor(bg)
            motion = { front, back, t ->
                setNavTint(blend.evaluate(t, navColorOf(back), navColorOf(front)) as Int)
            }
            changed = {
                detail = content.canPop
                val top = content.current
                setNavTint(navColorOf(top))
                if (!detail) (top?.view?.tag as? LinearLayout)?.let { bar -> bindBottomBar(bar) }
                if (top?.key == "/chat") {
                    chat?.attach(top.view as ViewGroup)
                } else chat?.let { if (it.parent != null) it.detach(keepView = content.contains("/chat")) }
                refreshBadges()
            }
            tabSelected = { key ->
                currentTab = key.removePrefix("/").ifEmpty { "home" }
                /* 밀어서 넘어온 홈은 미리 그린 그 화면이다 — 종도 그 화면의 것으로 옮긴다. */
                if (key == "/") tabPages.homeHead?.dot?.let { bellBadge = it }
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
            override fun openRoundSettle(id: String) { RoundScreen.focusSettle = id; showRound(id) }
            override fun openSettle() = showSettlements()
            override fun openPoll(id: String) = showPoll(id)
            override fun openPost(id: String) = showPost(id)
            override fun openMe() = showMe()
            override fun openAlerts() = showAlerts()
            override fun openMembers() = showMembers()
            override fun openChat() = showChat()
            override fun newRound() = roundForm(null)
            override fun newPoll() = showPollEdit(null)
            override fun newPost() = showPostEdit(null)
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
            tabPages.home().also {
                paintBell(tabPages.homeHead?.dot)
                if (!buildingTabPreview) bellBadge = tabPages.homeHead?.dot
            }
        }
    }

    private fun showRoundsList() {
        prepareScreen("/rounds") { showRoundsList() }
        showTabPage("/rounds") { tabPages.rounds() }
    }

    private fun showPollsList() {
        prepareScreen("/polls") { showPollsList() }
        showTabPage("/polls") { tabPages.polls() }
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

    // ── 공지 ───────────────────────────────────────────────────

    private fun showBoard() {
        prepareScreen("/board") { showBoard() }
        if (!buildingTabPreview) getSharedPreferences("native-seen", MODE_PRIVATE).edit().putString("board:${session.userId}", java.time.Instant.now().toString()).apply()
        detail = false
        currentTab = "board"; selectTabCompat("board")
        showTabPage("/board") { tabPages.board() }
    }

    private fun showPost(id: String) {
        prepareScreen("/board/$id") { screens["/board/$id"]?.load() }
        detail = true
        mountScreen(PostScreen(this, this, id))
    }

    private fun showPollEdit(p: JSONObject?) {
        prepareScreen(if (p == null) "/polls/new" else "/polls/${p.optString("id")}/edit") { }
        detail = true
        mountScreen(PollEditScreen(this, this, p))
    }

    private fun showPostEdit(p: JSONObject?) {
        prepareScreen(if (p == null) "/board/new" else "/board/${p.optString("id")}/edit") { }
        detail = true
        mountScreen(PostEditScreen(this, this, p))
    }

    private fun showRound(id: String) {
        prepareScreen("/rounds/$id") { screens["/rounds/$id"]?.load() }
        detail = true
        mountScreen(RoundScreen(this, this, id))
    }

    private fun showGroups(round: JSONObject, people: List<JSONObject>) {
        prepareScreen("/rounds/${round.optString("id")}/groups") { }
        detail = true
        mountScreen(RoundGroupsScreen(this, this, round, people))
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
        /* 대화가 401을 받으면 앱이 토큰을 새로 받아 갈아 끼운다 — 웹뷰가 없는 판이라
           부탁할 데가 없다. 이게 없으면 대화를 한 시간 넘게 켜 두면 만료로 굳었다. */
        c.service.authNeeded = {
            val stale = c.service.config.token
            scope.launch {
                try { NativeAuth.refresh(session, stale = stale); c.updateToken(session.accessToken) }
                catch (_: Exception) { /* 대화가 기다리다 스스로 알린다 */ }
            }
        }
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
        prepareScreen("/rounds/$roundId/settle-new") { }
        detail = true
        /* 고르는 명단은 **회원 전체**(대기·추방만 뺀다) — 참가자로 좁히면 뒷풀이만 온 사람을 못 넣는다. */
        val members = people.map(::AppProfile).filter { it.role != "pending" && it.role != "banned" }.sortedBy { it.name }
        mountScreen(SettlementEditScreen(this, this, roundId, members, joined, NativeChatShared.banks()))
    }

    private fun showSettlements() {
        prepareScreen("/settle") { screens["/settle"]?.load() }
        detail = true
        mountScreen(SettleScreen(this, this))
    }

    private fun showMe() {
        prepareScreen("/me") { screens["/me"]?.load() }
        detail = true
        mountScreen(MeScreen(this, this))
    }

    private fun showMeEdit(profile: JSONObject?, contact: JSONObject?) {
        prepareScreen("/me/edit") { }
        detail = true
        mountScreen(MeEditScreen(this, this, profile, contact))
    }

    private fun showMembers() {
        prepareScreen("/members") { screens["/members"]?.load() }
        detail = true
        mountScreen(MembersScreen(this, this))
    }

    private fun page(title: String): LinearLayout {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(24))
        }
        title(col, title)
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
            /* 옆 탭을 미리 그릴 때는 탭바를 안 만든다 — 미는 동안 탭바는 `NativeScreenStack`이
               제자리에 붙들고 있다가 남는 화면에 옮겨 붙인다(새로 만들면 뱃지가 빈 채로 떴다). */
            if (!buildingTabPreview) {
                val bar = this@NativeHomeActivity.bottom
                (bar.parent as? ViewGroup)?.removeView(bar)
                bar.visibility = View.VISIBLE
                addView(bar, FrameLayout.LayoutParams(-1, dp(58), Gravity.BOTTOM)); tag = bar
            }
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

    private fun error(parent: LinearLayout, value: String) {
        parent.addView(TextView(this).apply {
            text = value; textSize = 15f; setTextColor(Color.rgb(190, 40, 40))
            setPadding(dp(12), dp(12), dp(12), dp(12))
        })
    }

    private fun roundForm(existing: JSONObject?, copy: Boolean = false) {
        prepareScreen(if (existing == null || copy) "/rounds/new" else "/rounds/${existing.optString("id")}/edit") { }
        detail = true
        mountScreen(RoundEditScreen(this, this, existing, copy))
    }
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
            if (content.current?.key == "/me") screens["/me"]?.load()
        }
    }

    private fun toast(message: String) =
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}
