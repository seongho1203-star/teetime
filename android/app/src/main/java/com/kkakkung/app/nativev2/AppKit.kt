package com.kkakkung.app.nativev2

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextUtils
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import coil.load
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/*
 * **앱 화면들이 같이 쓰는 조각** — 아이폰의 `AppSkin`(NativeAppPlugin.swift) ·
 * `CardView`·`BadgeLabel`·`hrow`·`mkLabel`(ShellController.swift) ·
 * `appButton`·`InfoCell`(RoundViewController.swift) · `AppDate`·`AppRound`…
 * (NativeAppData.swift)를 코틀린으로 옮긴 것이다.
 *
 * **안드로이드의 기준은 아이폰이다.** 값(색·크기·말)을 바꿀 때는 Swift 쪽과
 * 함께 볼 것 — 한쪽만 고치면 두 앱이 또 달라진다.
 */

/** 색 — `src/styles/tokens.css`와 숫자까지 같다(아이폰 `AppSkin`). */
object AppSkin {
    val bg = Color.parseColor("#f5f7f1")
    val surface = Color.WHITE
    val surface2 = Color.parseColor("#eff2e9")
    val line = Color.parseColor("#dde3d1")
    val text = Color.parseColor("#1b1f19")
    val dim = Color.parseColor("#5b6455")
    val faint = Color.parseColor("#8b9486")
    val brand = Color.parseColor("#d92b8e")
    val brandDeep = Color.parseColor("#b41f72")
    val grass = Color.parseColor("#7cb828")
    val grassDeep = Color.parseColor("#5b8d18")
    val warn = Color.parseColor("#b97c00")
    val danger = Color.parseColor("#e2402a")
    val info = Color.parseColor("#2c7bd4")
    val wait = Color.parseColor("#7a55d6")
    val male = Color.parseColor("#2f8fd6")
    val female = Color.parseColor("#ef6ba8")
    /** 모서리 — 스티커처럼 통통하게(`--r` 18 · `--r-sm` 11). */
    const val radius = 18
    const val radiusSm = 11

    fun alpha(color: Int, a: Float): Int =
        Color.argb((a * 255).toInt().coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
}

// ── JSON — `optString`은 null을 "null"로 돌려준다. 그 함정을 한 곳에서 막는다. ──

fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key)
fun JSONObject.strOrNull(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
fun JSONObject.intOrNull(key: String): Int? = if (!has(key) || isNull(key)) null else optInt(key)
fun JSONArray?.objects(): List<JSONObject> {
    if (this == null) return emptyList()
    return buildList { for (i in 0 until length()) optJSONObject(i)?.let(::add) }
}

/** 화면에서 쓰는 조각을 만드는 곳 — 크기는 dp, 글자는 sp. */
class Ui(val ctx: Context) {
    private val density = ctx.resources.displayMetrics.density
    fun dp(v: Int): Int = (v * density + .5f).toInt()
    fun dpf(v: Float): Float = v * density

    /** 글자 한 줄(아이폰 `mkLabel`). `lines` 0이면 몇 줄이든 편다. */
    fun label(text: CharSequence, size: Float, bold: Boolean = false, color: Int = AppSkin.text, lines: Int = 1): TextView =
        TextView(ctx).apply {
            this.text = text
            setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
            setTextColor(color)
            typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            includeFontPadding = false
            if (lines > 0) { maxLines = lines; ellipsize = TextUtils.TruncateAt.END }
            setLineSpacing(0f, 1.15f)
        }

    /** 가로 한 줄(아이폰 `hrow`) — 가운데 정렬. `fill`이 아니면 끝에 빈 자리를 둔다(왼쪽으로 몰린다). */
    fun hrow(views: List<View>, spacing: Int = 6, fill: Boolean = false): LinearLayout =
        LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            views.forEachIndexed { i, v ->
                val lp = (v.layoutParams as? LinearLayout.LayoutParams) ?: LinearLayout.LayoutParams(-2, -2)
                if (i > 0) lp.marginStart = dp(spacing)
                addView(v, lp)
            }
            if (!fill) addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        }

    fun spacer(): View = View(ctx)

    /** 세로 묶음 — `spacing`만큼 띄워 쌓는다. */
    fun vstack(spacing: Int = 8): LinearLayout = VStack(ctx, dp(spacing))

    fun rounded(color: Int, radius: Int, stroke: Int? = null, strokeW: Int = 1): GradientDrawable =
        GradientDrawable().apply {
            cornerRadius = dpf(radius.toFloat())
            setColor(color)
            if (stroke != null) setStroke(dp(strokeW), stroke)
        }

    /** 흰 카드(웹 `.card` — 흰 바탕 · 가는 테두리 · 모서리 18 · 안여백 11/14). */
    fun card(): LinearLayout = VStack(ctx, dp(8)).apply {
        background = rounded(AppSkin.surface, AppSkin.radius, AppSkin.line)
        setPadding(dp(14), dp(11), dp(14), dp(11))
    }

    enum class Badge { LIVE, DONE, DIM, WARN, DANGER, WAIT, BRAND, FIELD, SCREEN }

    /** 표(`.badge`) — 색은 뜻으로 가른다(잔디=열림 · 회색=끝남 · 노랑=기다림 · 빨강=안 본 것 · 보라=대기). */
    fun badge(text: String, kind: Badge): TextView = TextView(ctx).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
        typeface = Typeface.DEFAULT_BOLD
        includeFontPadding = false
        maxLines = 1
        setPadding(dp(8), dp(3), dp(8), dp(3))
        val (fg, bgc, border) = when (kind) {
            Badge.LIVE -> Triple(AppSkin.grassDeep, AppSkin.alpha(AppSkin.grass, .16f), null)
            Badge.DONE -> Triple(AppSkin.faint, AppSkin.surface2, null)
            Badge.DIM -> Triple(AppSkin.faint, Color.TRANSPARENT, AppSkin.line)
            Badge.WARN -> Triple(AppSkin.warn, AppSkin.alpha(AppSkin.warn, .14f), null)
            Badge.DANGER -> Triple(AppSkin.danger, AppSkin.alpha(AppSkin.danger, .12f), null)
            Badge.WAIT -> Triple(AppSkin.wait, AppSkin.alpha(AppSkin.wait, .14f), null)
            Badge.BRAND -> Triple(AppSkin.brand, AppSkin.alpha(AppSkin.brand, .12f), null)
            Badge.FIELD -> Triple(Color.WHITE, AppSkin.grass, null)
            Badge.SCREEN -> Triple(Color.WHITE, AppSkin.dim, null)
        }
        setTextColor(fg)
        background = rounded(bgc, 10, border)
    }

    /** 단추(웹 `.btn ghost sm` / `.btn primary` / `.btn danger sm` — 아이폰 `appButton`). */
    fun button(title: String, color: Int = AppSkin.text, filled: Boolean = false, click: (() -> Unit)? = null): TextView =
        TextView(ctx).apply {
            text = title
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            maxLines = 1
            includeFontPadding = false
            setTextColor(if (filled) Color.WHITE else color)
            background = if (filled) rounded(color, 20) else rounded(AppSkin.surface, 20, AppSkin.line)
            setPadding(dp(16), dp(10), dp(16), dp(10))
            minHeight = dp(40)
            isClickable = true; isFocusable = true
            if (click != null) setOnClickListener { click() }
            pressable(this)
        }

    /** 누르면 살짝 옅어진다 — 아이폰 단추의 눌림과 같은 몫. */
    fun pressable(v: View) {
        v.setOnTouchListener { view, e ->
            when (e.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> view.alpha = .6f
                android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> view.alpha = 1f
            }
            false
        }
    }

    /** 정보 표의 한 칸(웹 `.info-cell`) — 옅은 바탕에 이름(작게)·값. */
    fun infoCell(name: String, value: String): LinearLayout = VStack(ctx, dp(2)).apply {
        background = rounded(AppSkin.surface2, AppSkin.radiusSm)
        setPadding(dp(12), dp(9), dp(12), dp(9))
        addView(label(name, 11f, bold = true, color = AppSkin.faint))
        addView(label(value, 15f, bold = true, lines = 0))
    }

    /** 카드 안 묶음 제목(`.section-title`). */
    fun sectionTitle(t: String): TextView = label(t, 14f, bold = true, color = AppSkin.dim)

    /** 작은 `✕` — 흐리고 작게(아이폰 `smallX` · 누르는 자리는 36). */
    fun smallX(desc: String, click: () -> Unit): TextView = TextView(ctx).apply {
        text = "✕"
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        typeface = Typeface.DEFAULT_BOLD
        setTextColor(AppSkin.faint)
        gravity = Gravity.CENTER
        contentDescription = desc
        isClickable = true
        setOnClickListener { click() }
        layoutParams = LinearLayout.LayoutParams(dp(36), dp(36))
    }

    /** 얼굴 — 모서리 둥근 네모(10/29 비율) · 없으면 이름 끝 두 글자 · 남녀는 테두리 색. */
    fun avatar(p: AppProfile?, size: Int): View {
        val box = FrameLayout(ctx)
        val r = dpf(size * 10f / 29f)
        val edge = p?.edge
        box.background = GradientDrawable().apply {
            cornerRadius = r; setColor(AppSkin.faint)
            if (edge != null) setStroke(dp(2), edge)
        }
        box.clipToOutline = true
        val name = p?.name.orEmpty()
        box.addView(TextView(ctx).apply {
            text = if (name.isEmpty()) "?" else name.takeLast(2)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, size * .34f)
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }, FrameLayout.LayoutParams(-1, -1))
        val url = p?.avatar?.let(::httpsUrl)
        if (!url.isNullOrBlank()) {
            box.addView(ImageView(ctx).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                load(url) { crossfade(false) }
            }, FrameLayout.LayoutParams(-1, -1).apply { if (edge != null) setMargins(dp(2), dp(2), dp(2), dp(2)) })
        }
        box.layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
        return box
    }

    /** 굵은 조각과 옅은 조각을 한 줄에(아이폰의 `NSMutableAttributedString`). */
    fun rich(vararg parts: Triple<String, Float, Pair<Boolean, Int>>): CharSequence {
        val b = SpannableStringBuilder()
        for ((t, size, style) in parts) {
            val start = b.length
            b.append(t)
            b.setSpan(AbsoluteSizeSpan(size.toInt(), true), start, b.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            b.setSpan(ForegroundColorSpan(style.second), start, b.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (style.first) b.setSpan(StyleSpan(Typeface.BOLD), start, b.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return b
    }
}

/** 카카오가 주는 `http://` 얼굴 주소를 `https`로 올린다(웹 `httpsUrl` — 안 올리면 앱에서 막힌다). */
fun httpsUrl(url: String): String = if (url.startsWith("http://")) "https://" + url.removePrefix("http://") else url

/** 세로로 쌓되 사이를 띄운다 — `UIStackView(spacing:)`의 몫. */
class VStack(context: Context, private val gap: Int) : LinearLayout(context) {
    init { orientation = VERTICAL }
    override fun addView(child: View, index: Int, params: ViewGroup.LayoutParams) {
        val lp = (params as? LayoutParams) ?: LayoutParams(-1, -2)
        if (childCount > 0 && index != 0) lp.topMargin = maxOf(lp.topMargin, gap)
        super.addView(child, index, lp)
    }
    override fun generateDefaultLayoutParams(): LayoutParams = LayoutParams(-1, -2)
}

// ── 날짜 — 한국 시각 · 웹 `lib/format.ts`와 같은 모양 ──────────────────

object AppDate {
    val seoul: ZoneId = ZoneId.of("Asia/Seoul")
    private val ko = Locale.KOREAN
    fun parse(iso: String?): ZonedDateTime? = try {
        if (iso.isNullOrBlank() || iso == "null") null else OffsetDateTime.parse(iso).atZoneSameInstant(seoul)
    } catch (_: Exception) {
        try { Instant.parse(iso).atZone(seoul) } catch (_: Exception) { null }
    }
    private fun f(pattern: String) = DateTimeFormatter.ofPattern(pattern, ko)
    /** `8월 21일 (금)`. */
    fun day(iso: String?): String = parse(iso)?.format(f("M월 d일 (E)")).orEmpty()
    /** `2026년 8월 21일 (금)`. */
    fun fullDate(iso: String?): String = parse(iso)?.format(f("yyyy년 M월 d일 (E)")).orEmpty()
    /** `오전 7:30`. */
    fun time(iso: String?): String = parse(iso)?.format(f("a h:mm")).orEmpty()
    /** `8월 21일 (금) 오전 7:30`. */
    fun dateTime(iso: String?): String = parse(iso)?.let { it.format(f("M월 d일 (E)")) + " " + it.format(f("a h:mm")) }.orEmpty()
    /** `8/21 오후 3:04`. */
    fun stamp(iso: String?): String = parse(iso)?.format(f("M/d a h:mm")).orEmpty()
    /** 오늘(한국 날짜)부터 며칠 뒤인가 — **날짜끼리** 뺀다. */
    fun daysUntil(iso: String?): Int {
        val d = parse(iso)?.toLocalDate() ?: return 0
        return ChronoUnit.DAYS.between(LocalDate.now(seoul), d).toInt()
    }
    /** `D-3` · `D-DAY` · `종료`. */
    fun dday(iso: String?): String {
        val d = daysUntil(iso)
        return if (d > 0) "D-$d" else if (d == 0) "D-DAY" else "종료"
    }
    /** `120,000원`. */
    fun won(n: Int): String = NumberFormat.getNumberInstance(Locale.KOREA).format(n) + "원"
    /** `방금` · `12분 전` · `3시간 전` · `2일 전` · 그보다 오래면 날짜. */
    fun ago(iso: String?): String {
        val d = parse(iso) ?: return ""
        val secs = (System.currentTimeMillis() - d.toInstant().toEpochMilli()) / 1000
        return when {
            secs < 60 -> "방금"
            secs < 3600 -> "${secs / 60}분 전"
            secs < 86400 -> "${secs / 3600}시간 전"
            secs < 86400 * 7 -> "${secs / 86400}일 전"
            else -> day(iso)
        }
    }
    fun isBeforeNow(iso: String?): Boolean = parse(iso)?.toInstant()?.isBefore(Instant.now()) ?: false
}

// ── 자료 — 아이폰 NativeAppData.swift의 struct들과 같은 뜻 ─────────────────

class AppProfile(val raw: JSONObject) {
    val id get() = raw.str("id")
    val name get() = raw.str("name").trim()
    val avatar get() = raw.strOrNull("avatar_url")
    val role get() = raw.strOrNull("role") ?: "member"
    val gender get() = raw.strOrNull("gender")
    val birthYear get() = raw.intOrNull("birth_year")?.takeIf { it > 0 }
    val region get() = raw.str("region").trim().takeIf { it.isNotEmpty() }
    /** `83/신성호/광산구` — 모르는 조각은 뺀다(웹 `personLabel`). */
    val label: String get() = listOfNotNull(birthYear?.let { "%02d".format(it % 100) }, name.takeIf { it.isNotEmpty() }, region).joinToString("/")
    val edge: Int? get() = when (gender) { "m" -> AppSkin.male; "f" -> AppSkin.female; else -> null }
}

object AppRole {
    val label = mapOf("pending" to "대기", "member" to "일반회원", "treasurer" to "총무", "staff" to "부운영자",
        "admin" to "운영자", "superadmin" to "앱관리자", "banned" to "추방")
    fun tagColor(role: String): Int? = when (role) {
        "superadmin" -> AppSkin.brandDeep; "admin" -> AppSkin.brand; "staff" -> AppSkin.info; "treasurer" -> AppSkin.warn; else -> null
    }
    /** 운영진 — DB `is_admin()`과 같다. 총무는 아니다. */
    fun isAdmin(r: String) = r == "staff" || r == "admin" || r == "superadmin"
    fun isOwner(r: String) = r == "admin" || r == "superadmin"
    fun isSuper(r: String) = r == "superadmin"
}

class AppComment(val raw: JSONObject) {
    val id get() = raw.str("id")
    val authorId get() = raw.strOrNull("author_id")
    val body get() = raw.str("body")
    val createdAt get() = raw.str("created_at")
}

class AppSignup(val raw: JSONObject) {
    val userId get() = raw.str("user_id")
    val state get() = raw.str("state")
    val seq get() = raw.optInt("seq")
    val grp: Int? get() = raw.intOrNull("grp")
}

class AppRound(val raw: JSONObject) {
    val signups: List<AppSignup> = raw.optJSONArray("signups").objects().map(::AppSignup)
    val id get() = raw.str("id")
    val course get() = raw.str("course")
    val title get() = raw.str("title")
    val teeAt get() = raw.str("tee_at")
    val capacity get() = raw.optInt("capacity")
    val fee get() = raw.optInt("fee")
    val status get() = raw.strOrNull("status") ?: "open"
    /** `field`/`screen` — 칸이 없는 저장소에서는 필드다(웹 `roundKind`). */
    val isScreen get() = raw.str("kind") == "screen"
    val caddie get() = raw.strOrNull("caddie")
    val cart get() = raw.strOrNull("cart")
    val note get() = raw.str("note")
    val createdBy get() = raw.strOrNull("created_by")
    val kindIcon get() = if (isScreen) "🎯" else "⛳"
    val kindLabel get() = if (isScreen) "스크린" else "필드"
    val teeLabel get() = if (isScreen) "시작" else "티오프"
    val feeLabel get() = if (isScreen) "게임비" else "그린피"
    /** 장소 — 비어 있으면 제목, 그것도 없으면 `골프장 미정`/`매장 미정`. */
    val place: String get() = course.ifEmpty { title.ifEmpty { if (isScreen) "매장 미정" else "골프장 미정" } }
    val confirmed get() = signups.filter { it.state == "confirmed" }.sortedBy { it.seq }
    val waiting get() = signups.filter { it.state == "waitlist" }.sortedBy { it.seq }
    fun mine(me: String) = signups.firstOrNull { it.userId == me }
    val isPast get() = AppDate.daysUntil(teeAt) < 0

    data class Slot(val course: String, val h: Int, val m: Int) { val time get() = "%02d:%02d".format(h, m) }
    /** 팀별 코스·시각(`tee_slots`) — 팀 n = 조 n. 스크린·옛 저장소는 빈 배열. */
    val teeSlots: List<Slot> get() = if (isScreen) emptyList() else raw.optJSONArray("tee_slots").objects().mapNotNull { d ->
        val t = d.str("time").split(":")
        val h = t.getOrNull(0)?.toIntOrNull(); val m = t.getOrNull(1)?.toIntOrNull()
        if (h == null || m == null || h !in 0..23 || m !in 0..59) null else Slot(d.str("course").trim(), h, m)
    }
    /** 코스별로 묶은 줄 — `스카이 07:21 · 07:28`. 코스는 처음 나온 차례 그대로. */
    val slotLines: List<String> get() {
        val bag = LinkedHashMap<String, MutableList<String>>()
        for (s in teeSlots) bag.getOrPut(s.course) { mutableListOf() }.add(s.time)
        return bag.map { (c, times) -> if (c.isEmpty()) times.joinToString(" · ") else "$c ${times.joinToString(" · ")}" }
    }
    /** 조별로 묶은 확정자 — 조가 하나도 없으면 빈 목록(한 줄로 그린다). 미배정은 맨 뒤. */
    fun grouped(): List<Pair<Int?, List<AppSignup>>> {
        val list = confirmed
        if (list.none { it.grp != null }) return emptyList()
        val bag = LinkedHashMap<Int?, MutableList<AppSignup>>()
        for (s in list) bag.getOrPut(s.grp) { mutableListOf() }.add(s)
        return bag.keys.sortedWith(compareBy<Int?> { it == null }.thenBy { it ?: 0 }).map { it to bag[it].orEmpty() }
    }

    companion object {
        /** 상세의 표만 짧은 말이다(웹 `CADDIE_SHORT`·`CART_SHORT`). */
        val caddieShort = mapOf("caddie" to "있음", "none" to "없음")
        val cartShort = mapOf("included" to "포함", "excluded" to "미포함")
        val caddieLabel = mapOf("caddie" to "캐디", "none" to "노캐디")
        val cartLabel = mapOf("included" to "카트 포함", "excluded" to "카트 미포함")
    }
}

class AppSettlement(val raw: JSONObject) {
    val id get() = raw.str("id")
    val title get() = raw.str("title")
    val body get() = raw.str("body")
    val bank get() = raw.str("bank").trim()
    val account get() = raw.str("account").trim()
    val total get() = raw.optInt("total")
    val createdBy get() = raw.strOrNull("created_by")
    val createdAt get() = raw.str("created_at")
    val shares: List<AppShare> get() = raw.optJSONArray("settlement_shares").objects().map(::AppShare)
    /** 토스 송금 화면 — 끝의 `은행`을 떼고 계좌의 `-`를 뺀다(웹 `tossUrl`). */
    fun tossUri(amount: Int?): android.net.Uri {
        val b = android.net.Uri.Builder().scheme("supertoss").authority("send")
            .appendQueryParameter("bank", bank.replace(Regex("은행$"), ""))
            .appendQueryParameter("accountNo", account.filter { it.isDigit() })
        if (amount != null && amount > 0) b.appendQueryParameter("amount", amount.toString())
        return b.build()
    }
}

class AppShare(val raw: JSONObject) {
    val id get() = raw.str("id")
    val userId get() = raw.str("user_id")
    val amount get() = raw.optInt("amount")
    val paid get() = raw.optBoolean("paid")
}

class AppPoll(val raw: JSONObject) {
    class Option(val id: String, val label: String, val sort: Int)
    class Vote(val optionId: String, val userId: String)
    val options: List<Option> = raw.optJSONArray("poll_options").objects()
        .map { Option(it.str("id"), it.str("label"), it.optInt("sort")) }.sortedBy { it.sort }
    val votes: List<Vote> = raw.optJSONArray("poll_votes").objects().map { Vote(it.str("option_id"), it.str("user_id")) }
    val id get() = raw.str("id")
    val title get() = raw.str("title")
    val body get() = raw.str("body")
    val multi get() = raw.optBoolean("multi")
    val anonymous get() = raw.optBoolean("anonymous")
    val closedFlag get() = raw.optBoolean("closed")
    val closesAt get() = raw.strOrNull("closes_at")
    val createdBy get() = raw.strOrNull("created_by")
    val createdAt get() = raw.str("created_at")
    /** 웹 `pollClosed()`와 같은 잣대 — 손으로 닫았거나 마감 시각이 지났거나. */
    val closed: Boolean get() = closedFlag || AppDate.isBeforeNow(closesAt)
    fun count(optionId: String) = votes.count { it.optionId == optionId }
}
