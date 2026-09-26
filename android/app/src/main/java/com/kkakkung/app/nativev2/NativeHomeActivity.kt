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
        val page = page(if (banned) "이용 제한" else "가입 승인 대기중")
        if (banned) {
            body(page, "이 계정은 이용이 제한되었습니다.\n궁금한 점은 운영진에게 물어봐 주세요.")
            page.addView(action("로그아웃", danger = true) { logoutNative() })
            mount(page); return
        }
        body(page, "아직 가입 승인 대기중입니다.\n운영진이 명단에서 승인하면 바로 들어갈 수 있습니다.")
        body(page, "운영진이 알아볼 수 있게 아래 정보를 적어 주세요.")
        profileGateForm(page, profile, contact, pending = true)
        page.addView(action("승인 여부 다시 확인") { routeAfterLogin() })
        page.addView(action("로그아웃", danger = true) { logoutNative() })
        mount(page)
    }

    private fun showRequiredProfile(profile: JSONObject, contact: JSONObject?) {
        detail = true
        bottom.visibility = View.GONE
        val page = page("몇 가지만 더 알려 주세요")
        body(page, "생년월일 · 성별 · 거주지역이 빠져 있습니다.\n조 편성과 생일 축하에 사용합니다.")
        profileGateForm(page, profile, contact, pending = false)
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
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
        }
        content = FrameLayout(this).apply { setBackgroundColor(bg) }
        bottom = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(card)
            elevation = 0f
        }
        root.addView(content, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ))
        root.addView(bottom, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(58)
        ))

        /* Android 15(target 35)의 edge-to-edge 보정.
           - 평소: 기존 까꿍 디자인/64dp 탭바는 그대로 두고 system bar만 피한다.
           - 키보드: 기존 웹의 useKeyboardChrome과 똑같이 하단 탭바만 숨긴다.
             ChatScreen은 별도로 IME inset을 받아 입력창을 키보드 바로 위에 붙인다.
           디자인 수치·색상·카드에는 손대지 않는다. */
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, ins ->
            val bars = ins.getInsets(WindowInsetsCompat.Type.systemBars())
            val imeVisible = ins.isVisible(WindowInsetsCompat.Type.ime())
            v.setPadding(0, bars.top, 0, bars.bottom)
            bottom.visibility = if (imeVisible) View.GONE else View.VISIBLE
            ins
        }

        setContentView(root)
        ViewCompat.requestApplyInsets(root)

        val tabSpecs = listOf(
            Triple("home", "홈", R.drawable.ic_tab_home),
            Triple("board", "공지", R.drawable.ic_tab_board),
            Triple("rounds", "라운드", R.drawable.ic_tab_round),
            Triple("polls", "투표", R.drawable.ic_tab_poll),
            Triple("chat", "대화", R.drawable.ic_tab_chat)
        )
        tabSpecs.forEach { (id, label, icon) ->
            val b = Button(this).apply {
                text = label
                textSize = 11.5f // --fs-xs
                typeface = Typeface.DEFAULT_BOLD
                isAllCaps = false
                gravity = Gravity.CENTER
                setPadding(0, dp(5), 0, dp(3))
                setTextColor(faint)
                setCompoundDrawablesWithIntrinsicBounds(0, icon, 0, 0)
                compoundDrawablePadding = dp(3)
                compoundDrawableTintList = ColorStateList.valueOf(faint)
                setBackgroundColor(Color.TRANSPARENT)
                minHeight = 0; minimumHeight = 0
                setOnClickListener { showTab(id) }
            }
            tabs[id] = b
            bottom.addView(b, LinearLayout.LayoutParams(0, dp(58), 1f))
        }
    }

    private fun showTab(id: String) {
        detail = false
        currentTab = id
        tabs.forEach { (key, b) ->
            val c = if (key == id) brand else faint
            b.setTextColor(c)
            b.compoundDrawableTintList = ColorStateList.valueOf(c)
            b.typeface = Typeface.DEFAULT_BOLD
        }
        chat?.let { if (it.parent != null && id != "chat") it.detach() }
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

    private fun showHome() {
        currentTab = "home"
        selectTabCompat("home")
        bottom.visibility = View.VISIBLE
        chat?.let { if (it.parent != null) it.detach() }

        /* 웹 Home.tsx와 같은 구조: 머리말 → 다음 라운드 → 내가 할 일 → 모집중.
           임시 '알림/내정보/정산' 버튼 줄은 제거했다. */
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(10), dp(16), dp(16))
        }
        val loading = ProgressBar(this)
        page.addView(loading)
        mount(page)

        scope.launch {
            try {
                val profile = api.profile()
                val rounds = api.upcomingRounds(20)
                val polls = api.openPolls(20)
                val alerts = api.unreadAlertCount()
                val admin = profile?.optString("role") in setOf("staff", "admin", "superadmin")
                val pending = if (admin) api.pendingCount() else 0
                page.removeAllViews()

                page.addView(homeHeader(profile, alerts))

                if (rounds.isNotEmpty()) {
                    page.addView(nextRoundCard(rounds.first()))
                } else {
                    page.addView(homeEmptyRound())
                }

                val todoCount = polls.size + pending
                if (todoCount > 0) {
                    section(page, "내가 할 일")
                    polls.forEach { p ->
                        page.addView(homeRow("투표", p.optString("title")) { showPoll(p.optString("id")) })
                    }
                    if (pending > 0) {
                        page.addView(homeRow("승인", "가입 신청 ${pending}명", warn) { showMembers() })
                    }
                }

                if (rounds.size > 1) {
                    section(page, "모집중")
                    rounds.drop(1).forEach { r ->
                        page.addView(homeRoundRow(r))
                    }
                }
            } catch (e: Exception) {
                page.removeAllViews()
                error(page, e.message ?: "불러오지 못했습니다.")
            }
        }
    }

    private fun homeHeader(profile: JSONObject?, alerts: Int): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, dp(8))
        }
        val left = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        left.addView(TextView(this).apply {
            text = "안녕하세요"; textSize = 13f; setTextColor(faint)
        })
        val nameLine = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        val avatar = nativeAvatar(profile, 38)
        avatar.setOnClickListener { showMe() }
        nameLine.addView(avatar)
        nameLine.addView(TextView(this).apply {
            text = (profile?.optString("name").orEmpty().ifBlank { session.displayName.ifBlank { "회원" } }) + "님"
            textSize = 24f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
            setPadding(dp(10), 0, 0, 0)
        })
        left.addView(nameLine)
        row.addView(left, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))

        val bellBox = FrameLayout(this).apply {
            isClickable = true; isFocusable = true
            setOnClickListener { showAlerts() }
        }
        bellBox.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_bell)
        }, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
        if (alerts > 0) {
            bellBox.addView(TextView(this).apply {
                text = if (alerts > 99) "99+" else alerts.toString()
                textSize = 10f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.WHITE); gravity = Gravity.CENTER
                background = GradientDrawable().apply {
                    cornerRadius = dp(9).toFloat(); setColor(danger)
                }
                setPadding(dp(4), 0, dp(4), 0)
            }, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(17), Gravity.TOP or Gravity.END
            ))
        }
        row.addView(bellBox, LinearLayout.LayoutParams(dp(40), dp(40)))
        return row
    }

    private fun nativeAvatar(profile: JSONObject?, size: Int): View {
        val url = profile?.optString("avatar_url").orEmpty()
        if (url.isNotBlank()) {
            return ImageView(this).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                load(url)
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL; setColor(surface2)
                }
                clipToOutline = true
                layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
            }
        }
        val name = profile?.optString("name").orEmpty().ifBlank { session.displayName.ifBlank { "회" } }
        return TextView(this).apply {
            text = name.take(2); textSize = 11f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(dim); gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; setColor(surface2); setStroke(dp(1), line)
            }
            layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
        }
    }

    private fun nextRoundCard(r: JSONObject): View {
        val signups = jsonObjects(r.optJSONArray("signups"))
        val confirmed = signups.count { it.optString("state") == "confirmed" }
        val mine = signups.firstOrNull { it.optString("user_id") == session.userId }
        val cardView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(15), dp(15), dp(15), dp(15))
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.rgb(143, 201, 58), Color.rgb(111, 170, 34), grassDeep)
            ).apply {
                cornerRadius = dp(24).toFloat(); setStroke(dp(1), grassDeep)
            }
            elevation = dp(2).toFloat()
            isClickable = true; setOnClickListener { showRound(r.optString("id")) }
        }
        val top = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        top.addView(TextView(this).apply {
            text = "다음 라운드"; textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.argb(210, 255, 255, 255))
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(TextView(this).apply {
            text = dday(r.optString("tee_at")); textSize = 20f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.rgb(255, 225, 77))
        })
        cardView.addView(top)
        cardView.addView(TextView(this).apply {
            text = date(r.optString("tee_at")); textSize = 20.8f; typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE); setPadding(0, dp(8), 0, 0)
        })
        cardView.addView(TextView(this).apply {
            text = (if (r.optString("kind") == "screen") "🎯 " else "⛳ ") +
                r.optString("course").ifBlank { r.optString("title") }
            textSize = 14.7f; setTextColor(Color.argb(230, 255, 255, 255))
            setPadding(0, dp(2), 0, dp(8))
        })
        cardView.addView(TextView(this).apply {
            text = "참가 ${confirmed}/${r.optInt("capacity")}명"
            textSize = 13f; setTextColor(Color.argb(230, 255, 255, 255))
        })
        cardView.addView(TextView(this).apply {
            text = when (mine?.optString("state")) {
                "confirmed" -> "참가 확정"
                "waitlist" -> "대기중"
                else -> "라운드 보기"
            }
            textSize = 14.7f; typeface = Typeface.DEFAULT_BOLD; gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            background = GradientDrawable().apply {
                cornerRadius = dp(11).toFloat()
                setColor(if (mine == null) brand else Color.argb(56, 255, 255, 255))
            }
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(11) })
        return cardView
    }

    private fun homeEmptyRound(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
        setPadding(dp(16), dp(24), dp(16), dp(24))
        background = GradientDrawable().apply {
            cornerRadius = dp(24).toFloat(); setColor(card); setStroke(dp(1), line)
        }
        addView(TextView(this@NativeHomeActivity).apply {
            text = "열린 라운드가 없습니다"; textSize = 15f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
        })
        addView(TextView(this@NativeHomeActivity).apply {
            text = "먼저 모집을 열어 보세요"; textSize = 13f; setTextColor(faint)
        })
        addView(TextView(this@NativeHomeActivity).apply {
            text = "+ 모집 열기"; textSize = 12f; typeface = Typeface.DEFAULT_BOLD; setTextColor(brand)
            setPadding(0, dp(6), 0, 0)
        })
        isClickable = true; setOnClickListener { roundForm(null) }
    }

    private fun homeRow(badge: String, label: String, badgeColor: Int = dim, click: () -> Unit): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(13), dp(11), dp(13), dp(11))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
            }
            addView(TextView(this@NativeHomeActivity).apply {
                text = badge; textSize = 11.5f; typeface = Typeface.DEFAULT_BOLD
                setTextColor(badgeColor)
                setPadding(dp(7), dp(3), dp(7), dp(3))
                background = GradientDrawable().apply {
                    cornerRadius = dp(999).toFloat(); setColor(surface2)
                }
            })
            addView(TextView(this@NativeHomeActivity).apply {
                text = label; textSize = 14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
                setPadding(dp(10), 0, 0, 0)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(this@NativeHomeActivity).apply {
                text = "›"; textSize = 20f; setTextColor(faint)
            })
            isClickable = true; setOnClickListener { click() }
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(6) }
        }

    private fun homeRoundRow(r: JSONObject): View =
        homeRow(if (r.optString("kind") == "screen") "스크린" else "필드",
            "${r.optString("course")} · ${date(r.optString("tee_at"))}") {
            showRound(r.optString("id"))
        }

    private fun dday(raw: String): String = try {
        val target = OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.of("Asia/Seoul")).toLocalDate()
        val today = java.time.LocalDate.now(ZoneId.of("Asia/Seoul"))
        val n = java.time.temporal.ChronoUnit.DAYS.between(today, target)
        when (n) { 0L -> "D-DAY"; else -> "D-$n" }
    } catch (_: Exception) { "" }

    private fun showRoundsList() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(10), dp(16), dp(24))
        }
        page.addView(listHeader("라운드", "+ 모집 열기") { roundForm(null) })
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val rows = api.rounds(80)
                page.removeView(loading)
                val now = System.currentTimeMillis()
                val upcoming = rows.filter { epoch(it.optString("tee_at")) >= now }
                    .sortedBy { epoch(it.optString("tee_at")) }
                val past = rows.filter { epoch(it.optString("tee_at")) < now }
                    .sortedByDescending { epoch(it.optString("tee_at")) }

                if (upcoming.isEmpty()) {
                    emptyBox(page, "예정된 라운드가 없습니다.\n위의 모집 열기로 새 라운드를 올려 보세요.")
                }
                upcoming.forEach { page.addView(roundListCard(it, false)) }
                if (past.isNotEmpty()) {
                    section(page, "지난 라운드")
                    past.take(20).forEach { page.addView(roundListCard(it, true)) }
                }
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "라운드를 불러오지 못했습니다.")
            }
        }
    }

    private fun roundListCard(r: JSONObject, past: Boolean): View {
        val signups = jsonObjects(r.optJSONArray("signups"))
        val confirmed = signups.count { it.optString("state") == "confirmed" }
        val waiting = signups.count { it.optString("state") == "waitlist" }
        val mine = signups.firstOrNull { it.optString("user_id") == session.userId }
        val full = confirmed >= r.optInt("capacity")
        val shut = past || r.optString("status") in setOf("closed", "cancelled")
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(12), dp(13), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat()
                setColor(if (shut) surface2 else card); setStroke(dp(1), line)
            }
            alpha = if (past) 0.68f else 1f
            isClickable = true; setOnClickListener { showRound(r.optString("id")) }
        }
        val badges = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        badges.addView(badge(if (r.optString("kind") == "screen") "🎯 스크린" else "⛳ 필드", dim))
        val status = when {
            r.optString("status") == "cancelled" -> "취소됨" to danger
            past -> "종료" to faint
            r.optString("status") == "closed" || full -> "모집 마감" to faint
            else -> "모집중" to grassDeep
        }
        badges.addView(badge(status.first, status.second))
        if (!past && r.optString("status") != "cancelled") {
            badges.addView(badge(dday(r.optString("tee_at")), if (daysUntil(r.optString("tee_at")) <= 3) warn else dim))
        }
        if (mine != null) {
            badges.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
            badges.addView(badge(if (mine.optString("state") == "confirmed") "참가 확정" else "대기중",
                if (mine.optString("state") == "confirmed") dim else warn))
        }
        box.addView(badges)
        box.addView(TextView(this).apply {
            text = (if (r.optString("kind") == "screen") "🎯 " else "⛳ ") +
                r.optString("course").ifBlank { r.optString("title") }
            textSize = 17.3f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
            setPadding(0, dp(7), 0, dp(2))
        })
        box.addView(TextView(this).apply {
            text = date(r.optString("tee_at")); textSize = 13f; setTextColor(dim)
        })
        val foot = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        val cap = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        val track = FrameLayout(this).apply {
            background = GradientDrawable().apply { cornerRadius = dp(99).toFloat(); setColor(Color.rgb(231,235,224)) }
            val fill = View(this@NativeHomeActivity).apply {
                background = GradientDrawable().apply { cornerRadius = dp(99).toFloat(); setColor(grass) }
            }
            addView(fill, FrameLayout.LayoutParams(
                dp((76 * minOf(1f, confirmed.toFloat() / maxOf(1, r.optInt("capacity")))).toInt()), dp(6)
            ))
        }
        cap.addView(track, LinearLayout.LayoutParams(dp(76), dp(6)))
        cap.addView(TextView(this).apply {
            text = "${confirmed}/${r.optInt("capacity")}명" + if (waiting > 0) " · 대기 ${waiting}" else ""
            textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(if (waiting > 0) warn else dim)
            setPadding(dp(10), 0, 0, 0)
        })
        foot.addView(cap, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (r.optInt("fee") > 0) foot.addView(TextView(this).apply {
            text = money(r.optInt("fee")); textSize = 13f; setTextColor(faint)
        })
        box.addView(foot)
        box.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(8) }
        return box
    }

    private fun showPollsList() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(10), dp(16), dp(24))
        }
        page.addView(listHeader("투표", "+ 투표 만들기") { pollForm() })
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val rows = api.polls(80)
                page.removeView(loading)
                val live = rows.filter { !it.optBoolean("closed") && !pollExpired(it.optString("closes_at")) }
                val done = rows.filterNot { live.contains(it) }
                if (rows.isEmpty()) emptyBox(page, "아직 투표가 없습니다.\n날짜 정하기, 골프장 고르기 같은 걸 올려 보세요.")
                live.forEach { page.addView(pollListCard(it, false)) }
                if (done.isNotEmpty()) {
                    section(page, "마감된 투표")
                    done.take(20).forEach { page.addView(pollListCard(it, true)) }
                }
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "투표를 불러오지 못했습니다.")
            }
        }
    }

    private fun pollListCard(p: JSONObject, closed: Boolean): View {
        val options = jsonObjects(p.optJSONArray("poll_options")).sortedBy { it.optInt("sort") }
        val votes = jsonObjects(p.optJSONArray("poll_votes"))
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(13), dp(12), dp(13), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(18).toFloat(); setColor(if (closed) surface2 else card); setStroke(dp(1), line)
            }
            alpha = if (closed) 0.82f else 1f
        }
        val head = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            isClickable = true; setOnClickListener { showPoll(p.optString("id")) }
        }
        head.addView(TextView(this).apply {
            text = p.optString("title"); textSize = 16.3f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        head.addView(TextView(this).apply { text = "›"; textSize = 20f; setTextColor(faint) })
        box.addView(head)

        if (closed) {
            val counts = options.associateWith { o -> votes.count { it.optString("option_id") == o.optString("id") } }
            val best = counts.values.maxOrNull() ?: 0
            val winners = if (best > 0) counts.filterValues { it == best }.keys.joinToString(", ") { it.optString("label") } else ""
            box.addView(TextView(this).apply {
                text = if (winners.isBlank()) "아직 받은 표가 없습니다" else "결과  ${winners} · ${best}표"
                textSize = 13f; setTextColor(dim); setPadding(dp(10), dp(8), dp(10), dp(8))
                background = GradientDrawable().apply { cornerRadius = dp(11).toFloat(); setColor(Color.rgb(239,242,233)) }
            })
        } else {
            options.take(5).forEach { o ->
                val oid = o.optString("id")
                val chosen = votes.any { it.optString("option_id") == oid && it.optString("user_id") == session.userId }
                val n = votes.count { it.optString("option_id") == oid }
                val row = TextView(this).apply {
                    text = (if (chosen) "✓  " else "    ") + o.optString("label") + "    ${n}표"
                    textSize = 14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
                    setPadding(dp(13), dp(10), dp(13), dp(10))
                    background = GradientDrawable().apply {
                        cornerRadius = dp(11).toFloat(); setColor(surface2)
                        if (chosen) setStroke(dp(1), brandDeep)
                    }
                    isClickable = true
                    setOnClickListener {
                        mutate {
                            if (chosen) api.retractVote(oid) else api.castVote(oid)
                            showPollsList()
                        }
                    }
                }
                box.addView(row, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(6) })
            }
            if (options.size > 5) box.addView(TextView(this).apply {
                text = "+${options.size - 5}개 더 보기"; textSize = 12f; typeface = Typeface.DEFAULT_BOLD; setTextColor(dim)
                setPadding(0, dp(7), 0, 0); isClickable = true; setOnClickListener { showPoll(p.optString("id")) }
            })
        }
        val voters = votes.map { it.optString("user_id") }.distinct().size
        box.addView(TextView(this).apply {
            val close = p.optString("closes_at")
            text = "${voters}명 참여" + if (close.isNotBlank()) " · 마감 ${date(close)}" else ""
            textSize = 12f; setTextColor(if (!closed && p.optString("closes_at").isNotBlank()) danger else faint)
            setPadding(0, dp(8), 0, 0)
        })
        box.layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(8) }
        return box
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

    private fun loadList(title: String, loader: suspend () -> List<JSONObject>) {
        val page = page(title)
        page.addView(action(if (title == "라운드") "＋ 모집 열기" else "＋ 투표 만들기", primary = true) {
            if (title == "라운드") roundForm(null) else pollForm()
        })
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

    // ── 공지 ───────────────────────────────────────────────────

    private fun showBoard() {
        detail = false
        currentTab = "board"; selectTabCompat("board")
        chat?.let { if (it.parent != null) it.detach() }
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(10), dp(16), dp(24))
        }
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val profile = api.profile()
                val admin = profile?.optString("role") in setOf("staff", "admin", "superadmin")
                val people = api.people().associateBy { it.optString("id") }
                val posts = api.posts()
                page.removeAllViews()
                val head = LinearLayout(this@NativeHomeActivity).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                }
                head.addView(TextView(this@NativeHomeActivity).apply {
                    text = "공지"; textSize = 24f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                if (admin) head.addView(TextView(this@NativeHomeActivity).apply {
                    text = "+ 글쓰기"; textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE)
                    gravity = Gravity.CENTER; setPadding(dp(12), dp(7), dp(12), dp(7))
                    background = GradientDrawable().apply { cornerRadius = dp(11).toFloat(); setColor(brand) }
                    isClickable = true; setOnClickListener { postForm(null) }
                })
                page.addView(head, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { bottomMargin = dp(12) })

                if (posts.isEmpty()) {
                    emptyBox(page, "아직 공지가 없습니다.\n중요한 것만 여기 남기세요. 대화는 대화 탭에서 합니다.")
                }
                posts.forEach { p ->
                    val box = LinearLayout(this@NativeHomeActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(13), dp(12), dp(13), dp(12))
                        background = GradientDrawable().apply {
                            cornerRadius = dp(18).toFloat(); setColor(card); setStroke(dp(1), line)
                        }
                        isClickable = true; setOnClickListener { showPost(p.optString("id")) }
                    }
                    val titleRow = LinearLayout(this@NativeHomeActivity).apply {
                        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    }
                    if (p.optBoolean("pinned")) titleRow.addView(badge("고정", warn))
                    titleRow.addView(TextView(this@NativeHomeActivity).apply {
                        text = p.optString("title"); textSize = 16.3f
                        typeface = Typeface.DEFAULT_BOLD; setTextColor(ink); maxLines = 1
                    }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                    box.addView(titleRow)
                    val preview = p.optString("body").replace(Regex("\\s+"), " ").trim()
                    if (preview.isNotBlank()) box.addView(TextView(this@NativeHomeActivity).apply {
                        text = preview; textSize = 13f; setTextColor(dim); maxLines = 2
                        setPadding(0, dp(5), 0, dp(5))
                    })
                    box.addView(TextView(this@NativeHomeActivity).apply {
                        val who = personLabel(people[p.optString("author_id")]).ifBlank { "알 수 없음" }
                        text = "$who · ${timeAgo(p.optString("created_at"))}"
                        textSize = 11.5f; setTextColor(faint)
                    })
                    page.addView(box, LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                    ).apply { bottomMargin = dp(8) })
                }
            } catch (e: Exception) {
                page.removeAllViews(); error(page, e.message ?: "공지를 불러오지 못했습니다.")
            }
        }
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
        detail = true
        val page = detailPage("공지")
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val post = api.post(id)
                val comments = api.postComments(id)
                val peopleList = api.people()
                val profile = api.profile()
                page.removeView(loading)
                if (post == null) { error(page, "없는 공지입니다."); return@launch }
                val people = peopleList.associateBy { it.optString("id") }
                val admin = profile?.optString("role") in setOf("staff", "admin", "superadmin")
                val canEdit = admin || post.optString("author_id") == session.userId
                if (post.optBoolean("pinned")) body(page, "📌 고정 공지")
                title(page, post.optString("title"))
                line(page, "작성", personLabel(people[post.optString("author_id")]))
                line(page, "시각", date(post.optString("created_at")))
                body(page, post.optString("body"))
                if (canEdit) page.addView(action("수정") { postForm(post) })
                if (admin) {
                    page.addView(action(if (post.optBoolean("pinned")) "고정 해제" else "맨 위에 고정") {
                        mutate { api.togglePostPin(id, !post.optBoolean("pinned")); showPost(id) }
                    })
                    page.addView(action("공지 삭제", danger = true) {
                        confirm("이 공지를 지울까요?", "댓글도 함께 사라지며 되돌릴 수 없습니다.") {
                            mutate { api.deletePost(id); toast("지웠습니다."); showBoard() }
                        }
                    })
                }
                commentsBlock(page, comments, people) { text ->
                    mutate { api.addComment("post_comments", "post_id", id, text); showPost(id) }
                }
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "공지를 불러오지 못했습니다.")
            }
        }
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
        detail = true
        chat?.let { if (it.parent != null) it.detach() }
        val page = detailPage("라운드")
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val r = api.round(id)
                val comments = api.roundComments(id)
                val people = api.people()
                val myProfile = api.profile()
                page.removeView(loading)
                if (r == null) { error(page, "라운드를 찾지 못했습니다."); return@launch }
                renderRound(page, r, comments, people, myProfile)
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "불러오지 못했습니다.")
            }
        }
    }

    private fun renderRound(
        page: LinearLayout, r: JSONObject, comments: List<JSONObject>,
        people: List<JSONObject>, myProfile: JSONObject?
    ) {
        val id = r.optString("id")
        val names = people.associateBy { it.optString("id") }
        val signups = jsonObjects(r.optJSONArray("signups"))
        val confirmed = signups.filter { it.optString("state") == "confirmed" }.sortedBy { it.optInt("seq") }
        val waiting = signups.filter { it.optString("state") == "waitlist" }.sortedBy { it.optInt("seq") }
        val mine = signups.firstOrNull { it.optString("user_id") == session.userId }
        val open = r.optString("status") == "open" && !isPast(r.optString("tee_at"))
        val admin = myProfile?.optString("role") in setOf("staff", "admin", "superadmin")
        val owner = r.optString("created_by") == session.userId
        val screen = r.optString("kind") == "screen"

        val heroBadges = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        heroBadges.addView(badge(if (screen) "🎯 스크린" else "⛳ 필드", if (screen) dim else grassDeep))
        val statusText = when (r.optString("status")) {
            "cancelled" -> "취소됨"
            "closed" -> "모집 마감"
            else -> if (open && confirmed.size < r.optInt("capacity")) "모집중"
                    else if (open) "모집 마감" else "종료"
        }
        heroBadges.addView(badge(statusText, when (statusText) {
            "모집중" -> grassDeep; "취소됨" -> danger; else -> faint
        }))
        if (r.optString("status") != "cancelled" && !isPast(r.optString("tee_at")))
            heroBadges.addView(badge(dday(r.optString("tee_at")), if (daysUntil(r.optString("tee_at")) <= 3) warn else dim))
        page.addView(heroBadges)

        title(page, (if (screen) "🎯 " else "⛳ ") +
            r.optString("course").ifBlank { r.optString("title") })
        if (r.optString("title").isNotBlank() && r.optString("course").isNotBlank())
            body(page, r.optString("title"))

        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = dp(11).toFloat(); setColor(line)
            }
            setPadding(dp(1), dp(1), dp(1), dp(1))
        }
        info.addView(infoPair(
            "날짜" to fullDate(r.optString("tee_at")),
            (if (screen) "시작" else "티오프") to timeOnly(r.optString("tee_at"))
        ))
        info.addView(infoPair(
            "정원" to "${r.optInt("capacity")}명",
            (if (screen) "게임비" else "그린피") to money(r.optInt("fee"))
        ))
        if (!screen) info.addView(infoPair(
            "캐디" to r.optString("caddie").ifBlank { "미정" },
            "카트" to r.optString("cart").ifBlank { "미정" }
        ))
        page.addView(info, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(4); bottomMargin = dp(8) })

        r.optString("note").takeIf { it.isNotBlank() }?.let { note ->
            val noteBox = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(13), dp(11), dp(13), dp(11))
                background = GradientDrawable().apply {
                    cornerRadius = dp(18).toFloat(); setColor(Color.rgb(255,248,225))
                    setStroke(dp(1), Color.rgb(239,207,126))
                }
            }
            noteBox.addView(TextView(this).apply {
                text = "전달 내용"; textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(warn)
            })
            noteBox.addView(TextView(this).apply {
                text = note; textSize = 14f; setTextColor(ink); setLineSpacing(0f, 1.35f)
                setPadding(0, dp(5), 0, 0)
            })
            page.addView(noteBox, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(8) })
        }

        if (mine == null && open) {
            page.addView(action("참가 신청", primary = true) {
                confirm("참가 신청", "이 라운드에 신청할까요?") {
                    mutate {
                        val state = api.joinRound(id)
                        toast(if (state == "confirmed") "참가가 확정되었습니다." else "자리가 차서 대기자로 올렸습니다.")
                        showRound(id)
                    }
                }
            })
        } else if (mine != null) {
            page.addView(action(if (mine.optString("state") == "confirmed") "신청 취소" else "대기 취소", danger = true) {
                val msg = if (mine.optString("state") == "confirmed" && waiting.isNotEmpty())
                    "취소하면 대기 1번인 ${personLabel(names[waiting.first().optString("user_id")])}님이 올라갑니다."
                else "다시 신청하면 순번은 맨 뒤가 됩니다."
                confirm("신청을 취소할까요?", msg) {
                    mutate { api.leaveRound(id); toast("신청을 취소했습니다."); showRound(id) }
                }
            })
        }

        if (admin || owner) {
            val status = r.optString("status")
            page.addView(action("라운드 수정") { roundForm(r) })
            page.addView(action(if (status == "open") "모집 마감" else "다시 열기") {
                mutate { api.setRoundStatus(id, if (status == "open") "closed" else "open"); showRound(id) }
            })
            if (confirmed.isNotEmpty()) {
                page.addView(action("조 편성 · 신청순") {
                    confirm("신청 순서로 조를 짤까요?", "4명씩 1조부터 자동으로 나눕니다.") {
                        val groups = JSONObject()
                        confirmed.forEachIndexed { i, signup ->
                            groups.put(signup.optString("user_id"), i / 4 + 1)
                        }
                        mutate { api.setRoundGroups(id, groups); toast("조 편성을 저장했습니다."); showRound(id) }
                    }
                })
            }
        }

        page.addView(action("＋ 정산 만들기") {
            settlementForm(id, confirmed.map { it.optString("user_id") }, people)
        })

        section(page, "참가자 ${confirmed.size}/${r.optInt("capacity")}")
        if (confirmed.isEmpty()) empty(page, "아직 참가자가 없습니다.")
        confirmed.forEach { signup ->
            val uid = signup.optString("user_id")
            val row = personRow(personLabel(names[uid]).ifBlank { "알 수 없음" }, "확정")
            if ((admin || owner) && uid != session.userId) {
                row.setOnLongClickListener {
                    confirm("명단에서 뺄까요?", "대기자가 있으면 맨 앞 사람이 자동으로 올라갑니다.") {
                        mutate { api.kickSignup(id, uid); showRound(id) }
                    }
                    true
                }
            }
            page.addView(row)
        }
        if (waiting.isNotEmpty()) {
            section(page, "대기 ${waiting.size}명")
            waiting.forEachIndexed { i, signup ->
                page.addView(personRow(
                    personLabel(names[signup.optString("user_id")]).ifBlank { "알 수 없음" },
                    "대기 ${i + 1}"
                ))
            }
        }

        commentsBlock(page, comments, names) { text ->
            mutate { api.addComment("round_comments", "round_id", id, text); showRound(id) }
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
                val comments = api.pollComments(id)
                val people = api.people()
                val myProfile = api.profile()
                page.removeView(loading)
                if (p == null) { error(page, "투표를 찾지 못했습니다."); return@launch }
                renderPoll(page, p, comments, people, myProfile)
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "불러오지 못했습니다.")
            }
        }
    }

    private fun renderPoll(
        page: LinearLayout, p: JSONObject, comments: List<JSONObject>,
        people: List<JSONObject>, myProfile: JSONObject?
    ) {
        val id = p.optString("id")
        val names = people.associateBy { it.optString("id") }
        val options = jsonObjects(p.optJSONArray("poll_options")).sortedBy { it.optInt("sort") }
        val votes = jsonObjects(p.optJSONArray("poll_votes"))
        val closed = p.optBoolean("closed") || pollExpired(p.optString("closes_at"))
        title(page, "🗳 ${p.optString("title")}")
        body(page, p.optString("body"))
        line(page, "상태", if (closed) "마감" else "진행중")
        line(page, "마감", date(p.optString("closes_at")))
        if (p.optBoolean("multi")) body(page, "복수 선택 가능")

        val mayEdit = p.optString("created_by") == session.userId ||
            myProfile?.optString("role") in setOf("staff", "admin", "superadmin")
        if (mayEdit) {
            page.addView(action("투표 수정") { pollEditForm(p) })
            page.addView(action(if (closed) "다시 열기" else "투표 마감") {
                mutate {
                    api.togglePollClosed(id, closed, p.optString("closes_at"))
                    toast(if (closed) "다시 열었습니다." else "마감했습니다.")
                    showPoll(id)
                }
            })
            page.addView(action("투표 삭제", danger = true) {
                confirm("이 투표를 지울까요?", "${votes.size}표와 댓글 ${comments.size}개가 함께 사라집니다.") {
                    mutate { api.deletePoll(id); toast("지웠습니다."); showTab("polls") }
                }
            })
        }

        section(page, if (closed) "결과" else "선택")
        options.forEach { option ->
            val oid = option.optString("id")
            val selected = votes.any {
                it.optString("option_id") == oid && it.optString("user_id") == session.userId
            }
            val count = votes.count { it.optString("option_id") == oid }
            val button = action(
                (if (selected) "✓ " else "") + option.optString("label") + "  ·  ${count}표",
                primary = selected
            ) {
                if (!closed) mutate {
                    if (selected) api.retractVote(oid) else api.castVote(oid)
                    showPoll(id)
                }
            }
            button.isEnabled = !closed
            page.addView(button)
        }
        if (options.isEmpty()) empty(page, "선택지가 없습니다.")

        commentsBlock(page, comments, names) { text ->
            mutate { api.addComment("poll_comments", "poll_id", id, text); showPoll(id) }
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
                            path.startsWith("/board/") -> showPost(path.substringAfter("/board/").substringBefore('/'))
                        }
                    }
                    "back" -> showHome()
                }
            }
        }
        c.attach(content)
    }

    // ── 알림함 ─────────────────────────────────────────────────

    private fun showAlerts() {
        detail = true
        val page = detailPage("알림")
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val list = api.notifications()
                api.markNotificationsRead()
                api.purgeNotifications()
                page.removeView(loading)
                if (list.isEmpty()) {
                    empty(page, "아직 온 알림이 없습니다.\n모집·정산·조 편성 소식이 여기 쌓입니다.")
                }
                list.forEach { n ->
                    val titleText = n.optString("title").ifBlank { "알림" }
                    val url = n.optString("url")
                    val row = cardView(
                        (if (n.isNull("read_at") || n.optString("read_at").isBlank()) "N  " else "") + titleText,
                        n.optString("body").take(90) + if (n.optString("body").length > 90) "…" else ""
                    ) { openNativeUrl(url) }
                    if (url.isBlank()) row.isClickable = false
                    page.addView(row)
                }
                if (list.isNotEmpty()) body(page, "90일이 지난 알림은 저절로 지워집니다.")
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "알림을 불러오지 못했습니다.")
            }
        }
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
        }
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
            val e = EditText(this).apply {
                hint = h
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
                val each = (total / ids.size / 10) * 10
                val left = total - each * ids.size
                val editBox = LinearLayout(this@NativeHomeActivity).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(4), dp(18), 0)
                }
                val fields = linkedMapOf<String, EditText>()
                ids.forEachIndexed { i, uid ->
                    val who = candidates.firstOrNull { it.optString("id") == uid }
                    val value = custom[uid] ?: each + if (i == 0) left else 0
                    val e = EditText(this@NativeHomeActivity).apply {
                        hint = personLabel(who).ifBlank { who?.optString("name").orEmpty() }
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
                        if (next.values.any { it < 0 } || next.values.sum() != total) {
                            toast("사람별 금액 합계가 총금액 ${money(total)}과 같아야 합니다.")
                            return@setOnClickListener
                        }
                        custom.clear(); custom.putAll(next)
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
                val amounts = if (custom.keys.containsAll(ids) && custom.size == ids.size) {
                    LinkedHashMap(custom)
                } else {
                    val each = (total / ids.size / 10) * 10
                    val left = total - each * ids.size
                    linkedMapOf<String, Int>().apply {
                        ids.forEachIndexed { i, uid -> put(uid, each + if (i == 0) left else 0) }
                    }
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
                if (open.isEmpty()) body(page, "다 걷혔습니다 👏")
                else {
                    title(page, money(owed))
                    body(page, "아직 안 걷힌 정산 ${open.size}건")
                }
                if (mine.isEmpty()) {
                    empty(page, "내가 올린 정산이 없습니다. 라운드 상세에서 정산을 만들 수 있습니다.")
                }
                mine.forEach { settlement ->
                    val shares = jsonObjects(settlement.optJSONArray("settlement_shares"))
                    val unpaid = shares.filter { !it.optBoolean("paid") }
                    val box = LinearLayout(this@NativeHomeActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(dp(14), dp(12), dp(14), dp(12))
                        background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.WHITE) }
                    }
                    box.addView(TextView(this@NativeHomeActivity).apply {
                        text = settlement.optString("title"); textSize = 17f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
                    })
                    body(box, rounds[settlement.optString("round_id")].orEmpty())
                    if (unpaid.isEmpty()) body(box, "입금 완료")
                    else {
                        body(box, "미입금 ${unpaid.size}명 · ${money(unpaid.sumOf { it.optInt("amount") })}")
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
        detail = true
        val page = detailPage("내 정보")
        val loading = ProgressBar(this); page.addView(loading); mount(page)
        scope.launch {
            try {
                val p = api.profile()
                val priv = api.privateProfile()
                page.removeView(loading)
                if (p == null) { error(page, "프로필을 불러오지 못했습니다."); return@launch }
                val avatar = p.optString("avatar_url")
                if (avatar.isNotBlank()) {
                    page.addView(ImageView(this@NativeHomeActivity).apply {
                        scaleType = ImageView.ScaleType.CENTER_CROP
                        load(avatar)
                        background = GradientDrawable().apply {
                            shape = GradientDrawable.OVAL; setColor(Color.rgb(235, 235, 240))
                        }
                        clipToOutline = true
                    }, LinearLayout.LayoutParams(dp(88), dp(88)).apply {
                        gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(8)
                    })
                }
                page.addView(action("프로필 사진 바꾸기") { avatarPicker.launch("image/*") })
                title(page, p.optString("name").ifBlank { session.displayName.ifBlank { "회원" } })
                line(page, "등급", p.optString("role"))
                line(page, "성별", when (p.optString("gender")) { "m" -> "남성"; "f" -> "여성"; else -> "" })
                line(page, "태어난 해", p.optInt("birth_year", 0).takeIf { it > 0 }?.toString().orEmpty())
                line(page, "거주지역", p.optString("region"))
                line(page, "전화번호", priv?.optString("phone").orEmpty())
                line(page, "차량번호", priv?.optString("car").orEmpty())
                page.addView(action("프로필 수정", primary = true) { profileForm(p, priv) })
                page.addView(action("이 기기로 알림 받기") {
                    if (NativePush.requestIfNeeded(this@NativeHomeActivity, notificationPermission)) enableNativePush()
                })
                page.addView(action("정산 현황") { showSettlements() })
                if (p.optString("role") in setOf("staff", "admin", "superadmin")) {
                    page.addView(action("회원 명단") { showMembers() })
                }
            } catch (e: Exception) {
                page.removeView(loading); error(page, e.message ?: "프로필을 불러오지 못했습니다.")
            }
        }
    }

    private fun profileForm(profile: JSONObject, priv: JSONObject?) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(4), dp(18), 0)
        }
        fun field(h: String, v: String, numeric: Boolean = false): EditText {
            val e = EditText(this).apply {
                hint = h; setText(v)
                if (numeric) inputType = InputType.TYPE_CLASS_NUMBER
            }
            box.addView(e); return e
        }
        val name = field("닉네임", profile.optString("name"))
        val birth = field("태어난 해", profile.optInt("birth_year", 0).takeIf { it > 0 }?.toString().orEmpty(), true)
        val region = field("거주지역", profile.optString("region"))
        val phone = field("전화번호", priv?.optString("phone").orEmpty())
        val car = field("차량번호", priv?.optString("car").orEmpty())
        val male = CheckBox(this).apply {
            text = "남성 (체크 해제 = 여성)"; isChecked = profile.optString("gender") == "m"
        }
        box.addView(male)
        val dialog = AlertDialog.Builder(this).setTitle("프로필 수정").setView(box)
            .setNegativeButton("취소", null).setPositiveButton("저장", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val y = birth.text.toString().toIntOrNull() ?: 0
                if (name.text.toString().trim().isBlank()) { toast("닉네임을 적어 주세요."); return@setOnClickListener }
                if (y !in 1900..2100) { toast("태어난 해를 확인해 주세요."); return@setOnClickListener }
                if (region.text.toString().trim().isBlank()) { toast("거주지역을 적어 주세요."); return@setOnClickListener }
                dialog.dismiss()
                mutate {
                    api.updateMyProfile(
                        name.text.toString().trim(), if (male.isChecked) "m" else "f", y,
                        region.text.toString().trim(), phone.text.toString().trim(), car.text.toString().trim()
                    )
                    toast("저장했습니다."); showMe()
                }
            }
        }
        dialog.show()
    }

    private fun showMembers() {
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
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.WHITE) }
            addView(TextView(this@NativeHomeActivity).apply {
                text = personLabel(p).ifBlank { p.optString("name") }
                textSize = 16f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
            })
            val meta = listOfNotNull(
                p.optString("role").takeIf { it.isNotBlank() },
                contact?.optString("car")?.takeIf { it.isNotBlank() },
                contact?.optString("phone")?.takeIf { it.isNotBlank() }
            ).joinToString(" · ")
            if (meta.isNotBlank()) body(this, meta)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(8) }
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
        val back = Button(this).apply {
            text = "‹  $label"
            textSize = 17f
            isAllCaps = false
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setTextColor(ink)
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

    private fun roundForm(existing: JSONObject?) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(4), dp(18), 0)
        }
        fun field(hintText: String, value: String = "", numeric: Boolean = false): EditText {
            val e = EditText(this).apply {
                hint = hintText; setText(value); textSize = 15f
                if (numeric) inputType = InputType.TYPE_CLASS_NUMBER
            }
            box.addView(e, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
            ))
            return e
        }
        val course = field("골프장/매장", existing?.optString("course").orEmpty())
        val cap = field("정원", existing?.optInt("capacity", 4)?.toString() ?: "4", true)
        val fee = field("1인 비용", existing?.optInt("fee", 0)?.toString() ?: "0", true)
        val note = field("전달 내용", existing?.optString("note").orEmpty())
        val screen = CheckBox(this).apply {
            text = "스크린"; isChecked = existing?.optString("kind") == "screen"
        }
        box.addView(screen)
        var tee = existing?.optString("tee_at").orEmpty()
        val whenBtn = Button(this).apply {
            text = if (tee.isBlank()) "날짜·시간 고르기" else date(tee)
            isAllCaps = false
            setOnClickListener { pickDateTime { iso -> tee = iso; text = date(iso) } }
        }
        box.addView(whenBtn)

        val dialog = AlertDialog.Builder(this)
            .setTitle(if (existing == null) "모집 열기" else "라운드 수정")
            .setView(box).setNegativeButton("취소", null).setPositiveButton("저장", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val place = course.text.toString().trim()
                val capacity = cap.text.toString().toIntOrNull() ?: 0
                if (place.isBlank()) { toast("장소를 적어 주세요."); return@setOnClickListener }
                if (tee.isBlank()) { toast("날짜와 시간을 골라 주세요."); return@setOnClickListener }
                if (capacity < 1) { toast("정원은 1명 이상이어야 합니다."); return@setOnClickListener }
                val payload = JSONObject()
                    .put("kind", if (screen.isChecked) "screen" else "field")
                    .put("course", place).put("tee_at", tee).put("capacity", capacity)
                    .put("fee", fee.text.toString().toIntOrNull() ?: 0)
                    .put("note", note.text.toString().trim())
                    .put("caddie", JSONObject.NULL).put("cart", JSONObject.NULL)
                    .put("lat", JSONObject.NULL).put("lon", JSONObject.NULL)
                dialog.dismiss()
                mutate {
                    val id = if (existing == null) api.createRound(payload)
                    else { api.updateRound(existing.optString("id"), payload); existing.optString("id") }
                    toast(if (existing == null) "모집을 열었습니다." else "수정했습니다.")
                    showRound(id)
                }
            }
        }
        dialog.show()
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
        var closes = ""
        val closeBtn = Button(this).apply {
            text = "마감 날짜·시간 고르기"; isAllCaps = false
            setOnClickListener { pickDateTime(7) { iso -> closes = iso; text = date(iso) } }
        }
        box.addView(closeBtn)

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
                addView(TextView(this@NativeHomeActivity).apply {
                    text = personLabel(names[uid]).ifBlank { "알 수 없음" }
                    textSize = 13f; typeface = Typeface.DEFAULT_BOLD; setTextColor(ink)
                })
                addView(TextView(this@NativeHomeActivity).apply {
                    text = c.optString("body"); textSize = 15f; setTextColor(ink); setPadding(0, dp(4), 0, 0)
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
            toast("이 기기로 알림을 받습니다.")
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
