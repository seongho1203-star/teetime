package com.kkakkung.app.nativev2

import android.content.Context
import android.text.InputType
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.appcompat.app.AlertDialog
import org.json.JSONObject

/*
 * **회원 명단** — 아이폰 `MembersViewController.swift`를 코틀린으로 옮긴 것이다.
 * 규칙이 그쪽(그리고 웹 `Members.tsx`)과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - 이름표는 `83/신성호/광산구`(`AppProfile.label`).
 *  - 차례는 이름·나이·지역·성별 넷, **모르는 값은 늘 뒤로**, 같은 값끼리는 이름순.
 *    기본은 이름순이고 기억해 두지 않는다. **거른 뒤에 줄 세운다.**
 *  - 열둘(`FIND_AT`)을 넘으면 찾기 칸 — 이름·지역·차량번호·전화번호.
 *  - **전화번호·차량번호·생일·참석 횟수는 운영진에게만.** 참석 횟수는 못 받으면 줄째 안 적는다.
 *  - 임명은 한 계단씩 — 앱관리자만 운영자를, 운영자 이상이 부운영자·총무를.
 *  - 관리는 **그 줄을 누르면** 창이 뜬다.
 */
class MembersScreen(ctx: Context, host: ScreenHost) : NativeScreen(ctx, host, "회원 명단") {
    private val cards = TabCards(ui)
    private val search = EditText(ctx).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setTextColor(AppSkin.text)
        setHintTextColor(AppSkin.faint)
        hint = "이름 · 지역 · 차량번호 · 전화번호"
        background = ui.rounded(AppSkin.surface, AppSkin.radiusSm, AppSkin.line)
        setPadding(ui.dp(12), 0, ui.dp(12), 0)
        isSingleLine = true
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        imeOptions = EditorInfo.IME_ACTION_SEARCH
        visibility = View.GONE
    }
    private val sortHolder = FrameLayout(ctx)
    private val scroll: ScrollView
    private val stack: LinearLayout

    private var sort = 0   // 0 이름 · 1 나이 · 2 지역 · 3 성별
    private var all: List<AppProfile> = emptyList()
    private var contacts: Map<String, JSONObject> = emptyMap()
    private var attend: Map<String, Int>? = null
    private var me: AppProfile? = null

    private val myRole get() = me?.role ?: "member"
    private val isAdmin get() = AppRole.isAdmin(myRole)
    private val isOwner get() = AppRole.isOwner(myRole)
    private val isSuper get() = AppRole.isSuper(myRole)

    init {
        val column = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val controls = ui.vstack(8).apply { setPadding(ui.dp(16), ui.dp(4), ui.dp(16), 0) }
        controls.addView(search, LinearLayout.LayoutParams(-1, ui.dp(44)))
        controls.addView(sortHolder)
        column.addView(controls)
        val (s, st) = scrollStack(); scroll = s; stack = st
        stack.setPadding(ui.dp(16), 0, ui.dp(16), ui.dp(24))
        column.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        body.addView(column, 0, FrameLayout.LayoutParams(-1, -1))
        search.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) { rebuild() }
        })
        search.setOnEditorActionListener { _, _, _ -> hideKeyboard(); true }
        paintSort()
    }

    private fun paintSort() {
        sortHolder.removeAllViews()
        sortHolder.addView(cards.segments(listOf("이름", "나이", "지역", "성별"), sort) { sort = it; paintSort(); rebuild() })
    }

    override fun load() {
        if (all.isEmpty()) spinner.visibility = View.VISIBLE
        launch {
            try {
                val list = api.profiles().map(::AppProfile)
                me = list.firstOrNull { it.id == myId }
                /* 표가 없는 저장소는 빈 것으로 물러난다. */
                contacts = api.contacts().associateBy { it.optString("id") }
                /* 참석 횟수는 **운영진만 부른다** — 회원에게는 애초에 안 보이는 값이다. */
                attend = if (isAdmin) api.attendance() else null
                all = list
                rebuild()
            } catch (e: Exception) {
                flash(e.message ?: "회원 명단을 불러오지 못했습니다.", error = true)
            }
            spinner.visibility = View.GONE
        }
    }

    private val byName = Comparator<AppProfile> { a, b -> a.name.compareTo(b.name) }

    /** 차례 넷 — 웹 `sortPeople`과 같다. **모르는 값은 뒤로.** */
    private fun sorted(list: List<AppProfile>): List<AppProfile> = when (sort) {
        1 -> list.sortedWith(compareBy<AppProfile> { it.birthYear ?: 9999 }.then(byName))
        2 -> list.sortedWith(compareBy<AppProfile> { if (it.region == null) 1 else 0 }.thenBy { it.region.orEmpty() }.then(byName))
        3 -> list.sortedWith(compareBy<AppProfile> { when (it.gender) { "m" -> 0; "f" -> 1; else -> 2 } }.then(byName))
        else -> list.sortedWith(byName)
    }

    private fun rebuild() {
        val pending = all.filter { it.role == "pending" }
        val members = all.filter { it.role != "pending" && it.role != "banned" }
        val banned = all.filter { it.role == "banned" }

        val big = members.size > FIND_AT
        search.visibility = if (big) View.VISIBLE else View.GONE
        val q = search.text.toString().replace(" ", "").lowercase()
        val found = if (big && q.isNotEmpty()) members.filter { p ->
            val c = contacts[p.id]
            listOf(p.name, p.region.orEmpty(), c?.str("car").orEmpty(), c?.str("phone").orEmpty())
                .any { it.replace(" ", "").lowercase().contains(q) }
        } else members
        val shown = sorted(found)

        stack.removeAllViews()
        if (isAdmin && pending.isNotEmpty()) section("가입 신청 ${pending.size}명", AppSkin.warn, sorted(pending))
        section("회원 ${members.size}명" + (if (shown.size != members.size) " · ${shown.size}명 찾음" else ""), AppSkin.dim, shown)
        if (isAdmin && banned.isNotEmpty()) section("추방 ${banned.size}명", AppSkin.danger, sorted(banned))
    }

    /** 묶음 제목(13 굵게 · 위 14 아래 6) + 흰 카드 한 장에 줄이 쌓인다(사이는 가는 선). */
    private fun section(title: String, color: Int, rows: List<AppProfile>) {
        stack.addView(ui.label(title, 13f, bold = true, color = color),
            LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(14); bottomMargin = -ui.dp(4) })   // 카드 사이 10에서 4를 빼 6
        if (rows.isEmpty()) return
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = ui.rounded(AppSkin.surface, AppSkin.radius)
            clipToOutline = true
        }
        rows.forEachIndexed { i, p -> card.addView(row(p, last = i == rows.size - 1)) }
        stack.addView(card)
    }

    private fun row(p: AppProfile, last: Boolean): View {
        val c = contacts[p.id]
        val subs = mutableListOf<String>()
        /* 참석 횟수·차량번호·전화번호 한 줄 — 운영진에게만(웹과 같은 잣대). */
        attend?.let { subs.add("올해 ${it[p.id] ?: 0}회") }
        if (isAdmin) subs.add(c?.strOrNull("car")?.ifBlank { null } ?: "차량번호 미등록")
        if (isAdmin) c?.strOrNull("phone")?.ifBlank { null }?.let(subs::add)
        /* 생일은 **안 적은 사람은 줄째 안 그린다** — `1975년`만 적으면 받아 둔 것처럼 보인다. */
        val md = if (isAdmin) c?.strOrNull("birth_md")?.ifBlank { null } else null
        val birth = md?.let { "🎂 " + AppDate.birthLabel(p.birthYear, it, c?.strOrNull("birth_cal") ?: "solar") }.orEmpty()
        val manage = manageable(p)

        val wrap = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        val line = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = ui.dp(56)
            setPadding(ui.dp(12), ui.dp(10), ui.dp(12), ui.dp(10))
        }
        line.addView(ui.avatar(p, 36))
        val col = ui.vstack(2)
        val name = mutableListOf(Triple(p.label.ifEmpty { "이름 없음" }, 15f, true to AppSkin.text))
        val tag = AppRole.tagColor(p.role)
        if (tag != null) name.add(Triple("  " + (AppRole.label[p.role] ?: ""), 11.5f, true to tag))
        if (p.id == myId) name.add(Triple("  (나)", 11.5f, false to AppSkin.faint))
        col.addView(ui.label(ui.rich(*name.toTypedArray()), 15f))
        if (subs.isNotEmpty()) col.addView(ui.label(subs.joinToString(" · "), 12f, color = AppSkin.faint))
        if (birth.isNotEmpty()) col.addView(ui.label(birth, 12f, color = AppSkin.faint))
        line.addView(col, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(12); marginEnd = ui.dp(8) })
        if (manage) line.addView(ui.label("⋯", 18f, bold = true, color = AppSkin.faint).apply { gravity = Gravity.CENTER },
            LinearLayout.LayoutParams(ui.dp(18), ui.dp(18)))
        wrap.addView(line)
        if (!last) wrap.addView(View(ctx).apply { setBackgroundColor(AppSkin.line) },
            LinearLayout.LayoutParams(-1, ui.dp(1)).apply { marginStart = ui.dp(12); marginEnd = ui.dp(12) })
        if (manage) {
            wrap.isClickable = true
            ui.pressable(wrap)
            wrap.setOnClickListener { if (!busy) showActions(p) }
        }
        return wrap
    }

    /** 이 사람을 내가 만질 수 있는가 — 나 자신·나보다 위는 못 만진다(웹과 같다). */
    private fun manageable(p: AppProfile): Boolean {
        if (!isAdmin || p.id == myId) return false
        val above = p.role == "superadmin" || (p.role == "admin" && !isSuper)
        return !above
    }

    // ── 관리 ─────────────────────────────────────────────────────

    /** 웹의 `관리` 단추가 펼치던 것들 — 줄을 누르면 창으로 뜬다(아이폰 액션시트). */
    private fun showActions(p: AppProfile) {
        val name = p.name.ifEmpty { "이 분" }
        val items = mutableListOf<Pair<CharSequence, () -> Unit>>()
        fun danger(t: String): CharSequence = SpannableString(t).apply {
            setSpan(ForegroundColorSpan(AppSkin.danger), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        when (p.role) {
            "pending" -> {
                items.add("승인" to { setRole(p, "member") })
                items.add(danger("거절") to {
                    confirm("${name}의 가입을 거절할까요?",
                        "명단에서 사라집니다. 그 사람이 다시 로그인하면 가입 신청부터 다시 하게 됩니다.", "거절", true) { reject(p) }
                })
            }
            "banned" -> items.add("대기로 되돌리기" to { setRole(p, "pending") })
            else -> {
                /* **앱관리자만 운영자를 임명한다.** */
                if (isSuper) items.add((if (p.role == "admin") "운영자 해제" else "운영자 임명") to {
                    setRole(p, if (p.role == "admin") "member" else "admin")
                })
                /* **운영자 이상이 부운영자·총무를 인원 제한 없이 임명한다.** */
                if (isOwner && p.role != "admin") {
                    items.add((if (p.role == "staff") "부운영자 해제" else "부운영자 임명") to {
                        setRole(p, if (p.role == "staff") "member" else "staff")
                    })
                    items.add((if (p.role == "treasurer") "총무 해제" else "총무 임명") to {
                        setRole(p, if (p.role == "treasurer") "member" else "treasurer")
                    })
                }
                items.add(danger("내보내기 (대기로)") to {
                    confirm("${name}님을 내보낼까요?",
                        "승인 대기 상태로 되돌아가 아무것도 볼 수 없게 됩니다. 신청 기록은 남습니다.", "내보내기", true) { setRole(p, "pending") }
                })
                items.add(danger("추방") to {
                    confirm("${name}을 추방할까요?",
                        "앱을 볼 수 없게 되고, 다시 로그인해도 가입 신청이 되지 않습니다. 나중에 명단 아래쪽에서 되돌릴 수 있습니다.", "추방", true) { setRole(p, "banned") }
                })
            }
        }
        val head = ui.vstack(2).apply { setPadding(ui.dp(24), ui.dp(20), ui.dp(24), ui.dp(4)) }
        head.addView(ui.label(p.label.ifEmpty { "이름 없음" }, 16f, bold = true))
        AppRole.label[p.role]?.let { head.addView(ui.label(it, 13f, color = AppSkin.faint)) }
        AlertDialog.Builder(ctx)
            .setCustomTitle(head)
            .setItems(items.map { it.first }.toTypedArray()) { _, i -> items[i].second() }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun setRole(p: AppProfile, role: String) {
        if (busy) return
        busy = true
        launch {
            try {
                api.setMemberRole(p.id, role)
                val name = p.name
                val msg = when {
                    role == "member" && p.role == "pending" -> "${name}님을 승인했습니다."
                    role == "member" -> "${name}님의 ${AppRole.label[p.role] ?: "직책"}를 풀었습니다."
                    role == "banned" -> "${name}님을 추방했습니다."
                    role == "pending" -> "${name}님을 대기로 되돌렸습니다."
                    else -> "${name}님을 ${AppRole.label[role] ?: role}로 임명했습니다."
                }
                flash(msg)
                busy = false
                load()
            } catch (e: Exception) {
                busy = false
                flash(e.message ?: "바꾸지 못했습니다.", error = true)
            }
        }
    }

    private fun reject(p: AppProfile) {
        if (busy) return
        busy = true
        launch {
            try { api.rejectMember(p.id); flash("거절했습니다."); busy = false; load() }
            catch (e: Exception) { busy = false; flash(e.message ?: "거절하지 못했습니다.", error = true) }
        }
    }

    companion object { const val FIND_AT = 12 }
}
