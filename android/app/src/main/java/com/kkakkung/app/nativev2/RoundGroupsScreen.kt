package com.kkakkung.app.nativev2

import android.app.TimePickerDialog
import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import androidx.appcompat.app.AlertDialog
import org.json.JSONObject
import java.time.LocalTime

/*
 * **조 편성** — 아이폰 `RoundGroupsViewController.swift`를 코틀린으로 옮긴 것이다.
 * 규칙이 그쪽(그리고 웹 `RoundGroups.tsx`)과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - **모집을 연 사람과 운영진만** 들어온다(DB `set_round_groups`도 같게 막혀 있다).
 *  - **확정자만** 짠다. 대기에서 올라온 사람은 `미배정`으로 뜬다.
 *  - **`p_grps`가 곧 전부다** — 확정자 전원을 실어 보낸다(안 넣은 사람은 `null`).
 *  - **빈 조 하나를 늘 더 보여 준다** — 그 빈 칸이 곧 `새 조 만들기`다.
 *  - 조가 여섯을 넘으면 칩 대신 고르는 단추다(웹 `CHIPS_UP_TO`).
 *  - 조별 시각은 **시·분만** 받고 저장할 때 라운드의 한국 날짜에 붙인다. **쓰는 조의 시각만** 보낸다.
 *    팀별 시각을 적어 둔 모집이면 **처음 짤 때만** 그대로 채운다(팀 n = 조 n).
 *  - 나누는 규칙은 `GroupRules`(웹 `lib/groups.ts`와 한 벌). 끌어서 옮기지 않는다 — 칩을 눌러 옮긴다.
 */
class RoundGroupsScreen(ctx: Context, host: ScreenHost, roundRaw: JSONObject, people: List<JSONObject>) :
    FormScreen(ctx, host, "조 편성") {
    private val round = AppRound(roundRaw)
    private val names = people.map(::AppProfile).associateBy { it.id }
    private var role = "member"
    private val confirmed = round.confirmed
    private val grp = mutableMapOf<String, Int>()
    private val tees = mutableMapOf<Int, LocalTime>()
    private var size = 4
    private val groupsBox = ui.vstack(10)
    private val cards = TabCards(ui)
    private val sizeHolder = android.widget.FrameLayout(ctx)

    private val numbers: List<Int> get() {
        val highest = grp.values.maxOrNull() ?: 0
        return (1..minOf(maxOf(highest + 1, 1), MAX_GROUPS)).toList()
    }

    override fun load() {
        if (built) return
        spinner.visibility = View.VISIBLE
        launch {
            role = names[myId]?.role ?: try { api.profile()?.strOrNull("role") ?: "member" } catch (_: Exception) { "member" }
            val saved = try { api.groupTees(round.id) } catch (_: Exception) { JSONObject() }
            for (k in saved.keys()) {
                val n = k.toIntOrNull() ?: continue
                AppDate.parse(saved.optString(k))?.let { tees[n] = it.toLocalTime().withSecond(0).withNano(0) }
            }
            /* 모집을 열며 팀별 시각을 적어 두었으면 **처음 짤 때만** 그대로 채운다(팀 n = 조 n). */
            if (saved.length() == 0) round.teeSlots.forEachIndexed { i, s -> tees[i + 1] = LocalTime.of(s.h, s.m) }
            build()
        }
    }

    private fun build() {
        built = true
        if (!AppRole.isAdmin(role) && round.createdBy != myId) { showNotice("모집을 연 사람과 운영진만 조를 짤 수 있습니다."); return }
        confirmed.forEach { s -> s.grp?.let { grp[s.userId] = it } }
        card(listOf(ui.label(round.place, 17f, bold = true, lines = 0),
            ui.label("${AppDate.fullDate(round.teeAt)} · 확정 ${confirmed.size}명", 13f, color = AppSkin.dim, lines = 0)), spacing = 4)
        if (confirmed.isEmpty()) {
            stack.addView(ui.label("아직 확정된 참가자가 없습니다.\n신청이 들어오면 그때 조를 짜 주세요.", 14f, color = AppSkin.faint, lines = 0).apply { gravity = Gravity.CENTER })
            spinner.visibility = View.GONE
            scroll.visibility = View.VISIBLE
            return
        }
        buildConditions()
        stack.addView(groupsBox)
        stack.addView(ui.hrow(listOf(ui.button("조 편성 지우기", AppSkin.dim) { clearTapped() })))
        paintGroups()
        showForm("저장")
    }

    // ── 조 편성 조건 ─────────────────────────────────────────────

    /* **누르면 바로 나뉜다**(`적용`을 따로 두지 않는다). **분홍은 `저장` 하나뿐이다.** */
    private fun buildConditions() {
        paintSize()
        val head = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(ui.label("조 편성 조건", 16f, bold = true), LinearLayout.LayoutParams(0, -2, 1f))
            addView(ui.label("한 조에", 12f, color = AppSkin.faint), LinearLayout.LayoutParams(-2, -2).apply { marginEnd = ui.dp(6) })
            addView(sizeHolder, LinearLayout.LayoutParams(ui.dp(176), -2))
        }
        fun mode(label: String, key: String) = ui.button(label) {
            val roster = confirmed.map { s -> names[s.userId].let { GroupPerson(s.userId, it?.gender, it?.birthYear) } }
            grp.clear(); grp.putAll(GroupRules.splitGroups(roster, size, key)); paintGroups()
        }
        val views = mutableListOf<View>(head,
            equalRow(ui, listOf(mode("신청 순서", "seq"), mode("랜덤", "random"))),
            equalRow(ui, listOf(mode("성별 조합", "gender"), mode("나이 조합", "age"))),
            ui.label("누르면 바로 나뉘고, 그다음 아래에서 손으로 옮기면 됩니다.\n성별 조합은 남녀가 고르게 섞이도록(남남여여 · 남남남여), 나이 조합은 나이가 고르게 섞이도록(신구 조화) 나눕니다.",
                12f, color = AppSkin.faint, lines = 0))
        /* **정보가 빈 사람이 몇인지 알려 준다** — 안 적으면 그 조건이 반쪽으로 돈다. */
        val roster = confirmed.map { names[it.userId] }
        val noGender = roster.count { it?.gender != "m" && it?.gender != "f" }
        val noAge = roster.count { it?.birthYear == null }
        if (noGender > 0 || noAge > 0) {
            val parts = listOfNotNull(if (noGender > 0) "성별 안 적은 분 ${noGender}명" else null, if (noAge > 0) "태어난 해 안 적은 분 ${noAge}명" else null)
            views.add(ui.label(parts.joinToString(" · "), 12f, bold = true, color = AppSkin.warn, lines = 0))
            views.add(ui.label("그분들은 나머지 뒤에 고르게 넣습니다. 각자 내 정보 → 프로필 수정에서 적을 수 있습니다.", 12f, color = AppSkin.faint, lines = 0))
        }
        card(views, spacing = 10)
    }

    private fun paintSize() {
        sizeHolder.removeAllViews()
        sizeHolder.addView(cards.segments(listOf(2, 3, 4, 5).map { "${it}명" }, size - 2) { size = it + 2; paintSize() }
            .apply { (layoutParams as? LinearLayout.LayoutParams)?.let { it.topMargin = 0; it.bottomMargin = 0 } })
    }

    private fun clearTapped() {
        confirm("조 편성을 지울까요?", "사람들 화면에서도 조가 사라집니다. 저장을 눌러야 반영됩니다.", "지우기", true) {
            grp.clear(); tees.clear(); paintGroups()
        }
    }

    // ── 조 카드 ──────────────────────────────────────────────────

    private fun groupCard(): LinearLayout = ui.vstack(8).apply {
        background = ui.rounded(AppSkin.surface, AppSkin.radius, AppSkin.line)
        setPadding(ui.dp(14), ui.dp(11), ui.dp(14), ui.dp(11))
    }

    private fun paintGroups() {
        groupsBox.removeAllViews()
        val nums = numbers
        val slots = round.teeSlots
        for (n in nums) {
            val members = confirmed.filter { grp[it.userId] == n }
            val c = groupCard()
            val course = slots.getOrNull(n - 1)?.course.orEmpty()
            val head = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            head.addView(ui.label("${n}조", 16f, bold = true))
            head.addView(ui.label((if (course.isEmpty()) "" else " · $course") + " · ${members.size}명", 12f, color = AppSkin.faint),
                LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(8) })
            /* 빈 조에는 시각 칸을 안 띄운다 — 아직 아무도 없는 조의 시각을 정할 일이 없다. */
            if (members.isNotEmpty()) head.addView(teeControl(n))
            c.addView(head)
            if (members.isEmpty()) {
                c.alpha = .7f
                c.addView(ui.label("아래에서 사람을 이 조로 옮기면 채워집니다.", 12f, color = AppSkin.faint, lines = 0))
            } else members.forEach { c.addView(personRow(it, n, nums)) }
            groupsBox.addView(c)
        }
        val rest = confirmed.filter { it.userId !in grp }
        if (rest.isNotEmpty()) {
            val c = groupCard()
            c.addView(ui.hrow(listOf(ui.label("미배정", 16f, bold = true), ui.label(" · ${rest.size}명", 12f, color = AppSkin.faint)), spacing = 0))
            rest.forEach { c.addView(personRow(it, null, nums)) }
            groupsBox.addView(c)
        }
    }

    /** 조마다의 시각 — 안 정했으면 `🕐 티오프` 단추, 정했으면 시·분 칸과 `✕`. */
    private fun teeControl(n: Int): View {
        val kind = round.teeLabel
        val t = tees[n] ?: return ui.button("🕐 $kind", AppSkin.dim) {
            /* 처음 정할 때는 팀 시각, 없으면 라운드 시각에서 시작한다 — 조마다 몇 분씩 미는 것이 흔하다. */
            tees[n] = round.teeSlots.getOrNull(n - 1)?.let { LocalTime.of(it.h, it.m) }
                ?: AppDate.parse(round.teeAt)?.toLocalTime()?.withSecond(0)?.withNano(0) ?: LocalTime.of(7, 0)
            paintGroups()
        }.apply { contentDescription = "${n}조 $kind 정하기" }
        val time = ui.label("%02d:%02d".format(t.hour, t.minute), 16f).apply {
            gravity = Gravity.CENTER
            background = ui.rounded(AppSkin.surface2, AppSkin.radiusSm)
            setPadding(ui.dp(12), 0, ui.dp(12), 0)
            isClickable = true
            contentDescription = "${n}조 $kind"
            setOnClickListener { TimePickerDialog(ctx, { _, h, m -> tees[n] = LocalTime.of(h, m); paintGroups() }, t.hour, t.minute, false).show() }
        }
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(time, LinearLayout.LayoutParams(-2, ui.dp(36)))
            addView(ui.smallX("${n}조 $kind 지우기") { tees.remove(n); paintGroups() }, LinearLayout.LayoutParams(ui.dp(32), ui.dp(40)))
        }
    }

    /** 한 사람과, 그 사람을 옮기는 자리. **지금 조가 곧 눌린 칩이다.** */
    private fun personRow(s: AppSignup, current: Int?, nums: List<Int>): View {
        val p = names[s.userId]
        val label = p?.label?.ifEmpty { null } ?: "알 수 없음"
        /* **왜 이렇게 갈렸는지 보이게 한다** — `여 · 65년생`(나이는 해가 바뀌면 틀린다). */
        val tag = listOf(when (p?.gender) { "f" -> "여"; "m" -> "남"; else -> "" },
            p?.birthYear?.let { "%02d년생".format(it % 100) }.orEmpty()).filter { it.isNotEmpty() }.joinToString(" · ")
        val texts = ui.vstack(1)
        texts.addView(ui.label(label, 14f, bold = true))
        if (tag.isNotEmpty()) texts.addView(ui.label(tag, 11f, color = AppSkin.faint))
        val pick: View = if (nums.size <= CHIPS_UP_TO) {
            LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                nums.forEachIndexed { i, n ->
                    val on = current == n
                    addView(ui.label("$n", 14f, bold = true, color = if (on) Color.WHITE else AppSkin.dim).apply {
                        gravity = Gravity.CENTER
                        background = ui.rounded(if (on) AppSkin.grass else AppSkin.surface, 8, if (on) null else AppSkin.line)
                        isClickable = true
                        isSelected = on
                        contentDescription = "$label · ${n}조로 옮기기"
                        setOnClickListener { move(s.userId, if (on) null else n) }
                    }, LinearLayout.LayoutParams(ui.dp(32), ui.dp(32)).apply { if (i > 0) marginStart = ui.dp(4) })
                }
            }
        } else {
            /* 조가 여섯을 넘으면 고르는 단추로 — 칩이 두 줄로 접히면 이름이 밀린다. */
            ui.button(current?.let { "${it}조 ▾" } ?: "미배정 ▾") {
                val items = listOf("미배정") + nums.map { "${it}조" }
                AlertDialog.Builder(ctx).setTitle(label)
                    .setItems(items.toTypedArray()) { _, i -> move(s.userId, if (i == 0) null else nums[i - 1]) }
                    .setNegativeButton("취소", null).show()
            }.apply { contentDescription = "${label}의 조" }
        }
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(ui.avatar(p, 28))
            addView(texts, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(8); marginEnd = ui.dp(8) })
            addView(pick)
        }
    }

    private fun move(uid: String, to: Int?) {
        if (to == null) grp.remove(uid) else grp[uid] = to
        paintGroups()
    }

    // ── 저장 ─────────────────────────────────────────────────────

    override fun save() {
        if (saving) return
        /* **쓰는 조의 시각만 보낸다** — 조를 넷에서 둘로 줄이면 3·4조의 시각이 남는다. */
        val day = AppDate.parse(round.teeAt)?.toLocalDate() ?: return
        val keep = JSONObject()
        for (n in numbers) {
            val t = tees[n] ?: continue
            if (confirmed.none { grp[it.userId] == n }) continue
            keep.put(n.toString(), day.atTime(t).atZone(AppDate.seoul).toInstant().toString())
        }
        /* **확정자 전원을 실어 보낸다** — 안 넣은 사람은 `null`이다. */
        val grps = JSONObject()
        confirmed.forEach { grps.put(it.userId, grp[it.userId] ?: JSONObject.NULL) }
        setSave("저장", true)
        launch {
            try {
                api.setRoundGroups(round.id, grps, keep)
                host.back(refreshBehind = true)
            } catch (e: Exception) {
                setSave("저장", false)
                flash(e.message ?: "저장하지 못했습니다.", error = true)
            }
        }
    }

    companion object { const val MAX_GROUPS = 20; const val CHIPS_UP_TO = 6 }
}
