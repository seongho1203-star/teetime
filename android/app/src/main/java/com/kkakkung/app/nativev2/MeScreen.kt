package com.kkakkung.app.nativev2

import androidx.appcompat.app.AlertDialog
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject

/*
 * **내 정보** — 아이폰 `MeViewController.swift`를 코틀린으로 옮긴 것이다.
 * 생김새·말·규칙이 그쪽(그리고 웹 `Me.tsx`)과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - 머리말: 얼굴 64(누르면 사진 바꾸기 · 분홍 `＋`) · 이름표 19 굵게 · 직책 · 🎂 내 생일.
 *    **차량번호는 머리말에 안 적는다**(프로필 수정 안에만).
 *  - 메뉴 카드 넷(같은 굵기): 프로필 수정 · 앱 사용자 가이드 · 회원 명단 · 정산 현황.
 *  - 알림 카드: `이 기기로 받기` · 켜져 있을 때만 `💬 대화 알림`(꺼도 `@언급`·답장은 온다).
 *  - 로그아웃, 그 바로 아래 **회원 탈퇴**(빨강 테두리 · 앱관리자에게는 안 보인다 — 애플 5.1.1(v)).
 *  - 맨 아래 `앱제작: 악마제리` · `버전 1.24`.
 */
class MeScreen(ctx: Context, host: ScreenHost) : NativeScreen(ctx, host, "내 정보") {
    private val scroll: ScrollView
    private val stack: LinearLayout
    private var profile: AppProfile? = null
    private var contact: JSONObject? = null
    private var push = "check"    // on · off · denied · unsupported · check
    private var chat = true
    private var token = ""
    private var pushBusy = false
    private var chatBusy = false
    private var photoBusy = false
    private var leaving = false
    private val prefs get() = ctx.getSharedPreferences("native-push", Context.MODE_PRIVATE)

    init {
        val (s, st) = scrollStack(); scroll = s; stack = st
        body.addView(scroll, 0, FrameLayout.LayoutParams(-1, -1))
    }

    override fun load() {
        if (profile == null) spinner.visibility = View.VISIBLE
        launch {
            try { api.profile()?.let { profile = AppProfile(it) } } catch (_: Exception) {}
            contact = api.privateProfile()
            spinner.visibility = View.GONE
            render()
            readPush()
        }
    }

    /** 이 기기가 지금 알림을 받는가 — 토큰을 못 받으면 켤 수 없는 판이다. */
    private suspend fun readPush() {
        val act = ctx as? Activity
        if (act == null) { push = "off"; render(); return }
        val t = try { withTimeoutOrNull(6000) { NativePush.token() } } catch (_: Exception) { null }
        if (t.isNullOrBlank()) { push = "unsupported"; render(); return }
        token = t
        push = when {
            !NativePush.permissionGranted(act) -> if (prefs.getBoolean("asked", false)) "denied" else "off"
            api.pushEnabled(t) -> "on"
            else -> "off"
        }
        if (push == "on") chat = api.chatPush(t)
        render()
    }

    private fun render() {
        stack.removeAllViews()
        stack.addView(headView())
        stack.addView(menuCard())
        stack.addView(pushCard())
        stack.addView(ui.button("로그아웃") { logoutTapped() }, LinearLayout.LayoutParams(-1, ui.dp(44)))
        /* **찾기 쉬운 자리에 둔다**(애플 심사 5.1.1(v)) · 빨강 테두리 · 앱관리자에게는 안 보인다. */
        if (profile?.role != "superadmin") {
            stack.addView(ui.button(if (leaving) "탈퇴 중…" else "회원 탈퇴", AppSkin.danger) { leaveTapped() }.apply {
                background = ui.rounded(AppSkin.surface, 20, AppSkin.alpha(AppSkin.danger, .5f))
                isEnabled = !leaving
            }, LinearLayout.LayoutParams(-1, ui.dp(44)))
        }
        val version = try { RoundFormRules.displayVersion(com.kkakkung.app.BuildConfig.VERSION_NAME) } catch (_: Throwable) { "" }
        stack.addView(ui.label("앱제작: 악마제리\n버전 $version", 12f, color = AppSkin.faint, lines = 0).apply { gravity = Gravity.CENTER })
    }

    private fun headView(): View {
        val p = profile
        val pick = FrameLayout(ctx).apply {
            isClickable = true
            contentDescription = "프로필 사진 바꾸기"
            setOnClickListener { photoTapped() }
            clipChildren = false
        }
        pick.addView(ui.avatar(p, 64), FrameLayout.LayoutParams(ui.dp(64), ui.dp(64)))
        pick.addView(ui.label(if (photoBusy) "…" else "＋", 13f, bold = true, color = Color.WHITE).apply {
            gravity = Gravity.CENTER
            background = ui.rounded(AppSkin.brand, 11)
        }, FrameLayout.LayoutParams(ui.dp(22), ui.dp(22), Gravity.END or Gravity.BOTTOM).apply {
            marginEnd = -ui.dp(3); bottomMargin = -ui.dp(3)
        })
        val texts = ui.vstack(2)
        texts.addView(ui.label(p?.label?.ifEmpty { null } ?: "닉네임 없음", 19f, bold = true))
        texts.addView(ui.label(AppRole.label[p?.role ?: "member"] ?: "일반회원", 13f, color = AppSkin.faint))
        contact?.strOrNull("birth_md")?.ifBlank { null }?.let { md ->
            val cal = contact?.strOrNull("birth_cal") ?: "solar"
            var line = "🎂 " + AppDate.birthLabel(p?.birthYear, md, cal)
            /* 음력이면 **올해 양력 며칠인가**를 함께(웹 `MeRoute`·아이폰 `birthdayThisYear`와 같다). */
            if (cal == "lunar") {
                val mm = md.take(2).toIntOrNull(); val dd = md.takeLast(2).toIntOrNull()
                val got = if (mm != null && dd != null) Lunar.lunarToSolar(java.time.LocalDate.now(AppDate.seoul).year, mm, dd) else null
                if (got != null) line += " · 올해 ${got.monthValue}월 ${got.dayOfMonth}일"
            }
            texts.addView(ui.label(line, 13f, color = AppSkin.faint, lines = 0))
        }
        return LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            clipChildren = false
            setPadding(ui.dp(2), ui.dp(8), ui.dp(2), ui.dp(8))
            addView(pick, LinearLayout.LayoutParams(ui.dp(64), ui.dp(64)))
            addView(texts, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(14) })
        }
    }

    private fun menuCard(): View {
        val c = ui.vstack(0).apply {
            background = ui.rounded(AppSkin.surface, AppSkin.radius, AppSkin.line)
            setPadding(ui.dp(14), ui.dp(1), ui.dp(14), ui.dp(1))
        }
        /* 네 줄 다 같은 굵기다(사용자 제보 — `내정보 글씨가 다름`). */
        fun item(title: String, sub: String?, act: () -> Unit) {
            if (c.childCount > 0) c.addView(View(ctx).apply { setBackgroundColor(AppSkin.line) }, LinearLayout.LayoutParams(-1, ui.dp(1)))
            val t = ui.vstack(2)
            t.addView(ui.label(title, 16f, bold = true))
            if (sub != null) t.addView(ui.label(sub, 12f, color = AppSkin.faint, lines = 0))
            c.addView(LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = ui.dp(44)
                setPadding(0, ui.dp(10), 0, ui.dp(10))
                addView(t, LinearLayout.LayoutParams(0, -2, 1f))
                addView(ui.label("›", 20f, color = AppSkin.faint), LinearLayout.LayoutParams(-2, -2).apply { marginStart = ui.dp(8) })
                isClickable = true
                contentDescription = title
                ui.pressable(this)
                setOnClickListener { act() }
            })
        }
        item("프로필 수정", null) { host.editProfile(profile?.raw, contact) }
        item("앱 사용자 가이드", "처음이시면 여기부터 보세요") { host.open("/help") }
        item("회원 명단", null) { host.open("/members") }
        item("정산 현황", "내가 걷는 돈과 아직 안 내신 분을 한 번에 봅니다") { host.open("/settle") }
        return c
    }

    /** 알림 칸의 첫 줄 — 켤 수 없으면 왜인지와 무엇을 하면 되는지(웹 `pushLine`). */
    private fun pushLine(): Pair<String, Boolean> = when (push) {
        "on" -> "라운드 모집, 투표, 공지 알림을 받습니다." to true
        "off" -> "앱을 안 보고 있어도 소식이 옵니다" to true
        "denied" -> "폰 설정 → 알림에서 까꿍을 켜 주세요" to true
        "unsupported" -> "앱을 최신 판으로 받으면 켤 수 있습니다" to false
        else -> "확인 중…" to false
    }

    private fun pushCard(): View {
        val c = ui.vstack(12).apply {
            background = ui.rounded(AppSkin.surface, AppSkin.radius, AppSkin.line)
            setPadding(ui.dp(14), ui.dp(11), ui.dp(14), ui.dp(11))
        }
        c.addView(ui.label("알림", 16f, bold = true))
        val (hint, can) = pushLine()
        val (row, sw) = appSwitchRow(ui, "이 기기로 받기", if (pushBusy) "켜는 중…" else hint, push == "on")
        sw.isEnabled = can && !pushBusy
        sw.contentDescription = "이 기기로 알림 받기"
        sw.setOnCheckedChangeListener { _, on -> pushToggled(on) }
        c.addView(row)
        /* 켜져 있을 때만 — 안 받는 기기에서 갈래를 나누는 칸은 누를 일이 없다. */
        if (push == "on") {
            val (r2, s2) = appSwitchRow(ui, "💬 대화 알림",
                if (chat) "새 메시지가 올 때마다 알림을 받습니다." else "꺼짐 — @언급과 내 글에 온 답장은 그래도 옵니다", chat)
            s2.isEnabled = !chatBusy
            s2.setOnCheckedChangeListener { _, on -> chatToggled(on) }
            c.addView(r2)
        }
        return c
    }

    private fun pushToggled(on: Boolean) {
        if (pushBusy) return
        pushBusy = true; render()
        if (!on) {
            launch {
                try {
                    api.disablePush(token)
                    prefs.edit().putBoolean("disabled", true).putBoolean("asked", true).apply()
                    push = "off"
                } catch (e: Exception) { flash(e.message ?: "알림을 끄지 못했습니다.", error = true) }
                pushBusy = false; render()
            }
            return
        }
        host.askPushPermission { granted ->
            prefs.edit().putBoolean("asked", true).apply()
            if (!granted) {
                push = "denied"; pushBusy = false; render()
                flash("폰 설정에서 이 앱의 알림을 켜 주세요.", error = true)
                return@askPushPermission
            }
            launch {
                try {
                    if (token.isEmpty()) token = NativePush.token()
                    api.enablePush(token)
                    prefs.edit().putBoolean("disabled", false).apply()
                    push = "on"
                    chat = api.chatPush(token)
                    flash("이 기기로 알림을 보냅니다.")
                } catch (e: Exception) { flash(e.message ?: "알림을 켜지 못했습니다.", error = true) }
                pushBusy = false; render()
            }
        }
    }

    private fun chatToggled(on: Boolean) {
        /* 스위치는 먼저 움직인다 — 통신을 기다리면 눌러도 안 켜지는 것처럼 보인다. */
        chat = on; chatBusy = true; render()
        launch {
            try { api.setChatPush(token, on); flash(if (on) "대화 알림을 켰습니다." else "대화 알림을 껐습니다.") }
            catch (e: Exception) { chat = !on; flash(e.message ?: "저장하지 못했습니다.", error = true) }   // 안 됐으면 되돌린다
            chatBusy = false; render()
        }
    }

    private fun logoutTapped() {
        confirm("로그아웃할까요?", "이 기기에서 로그아웃합니다.", "로그아웃", false) { host.logout() }
    }

    private fun leaveTapped() {
        if (leaving) return
        val who = profile?.name?.ifEmpty { null } ?: "회원"
        val detail = "${who}님의 계정이 지워집니다. 되돌릴 수 없습니다.\n\n· 프로필과 전화번호·차량번호\n· 신청해 둔 라운드와 던진 표\n· 프로필 사진과 알림 설정\n\n대화방에 남긴 글은 지워지지 않습니다. 다시 들어오시려면 처음처럼 가입 신청을 하셔야 합니다."
        confirm("정말 탈퇴하시겠습니까?", detail, "탈퇴하기", true) {
            leaving = true; render()
            launch {
                /* 순서가 있다 — 알림 → 사진 → 계정(웹 `leaveAccount`). `deleteMe`가 그 순서로 한다. */
                try { api.deleteMe(); host.logout() }
                catch (e: Exception) { leaving = false; render(); flash(e.message ?: "탈퇴하지 못했습니다.", error = true) }
            }
        }
    }

    /**
     * 누르면 먼저 고르게 한다 — `앨범에서 사진 선택` / `커스텀 프로필 만들기` / (사진이 있으면) `기본 이미지로 변경`
     * (아이폰 `photoTapped`와 같다). 기본 이미지는 `avatar_url`을 비우는 것이다 — 이름 두 글자가 그려진다.
     */
    private fun photoTapped() {
        if (photoBusy) return
        val items = mutableListOf<Pair<String, () -> Unit>>(
            "앨범에서 사진 선택" to { openPicker() },
            "커스텀 프로필 만들기" to { host.makeAvatar(profile?.name.orEmpty()) },
        )
        if (!profile?.avatar.isNullOrBlank()) items += "기본 이미지로 변경" to { clearPhoto() }
        AlertDialog.Builder(ctx)
            .setItems(items.map { it.first }.toTypedArray()) { _, i -> items[i].second() }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun clearPhoto() {
        photoBusy = true; render()
        launch {
            try { api.clearAvatar(); photoBusy = false; flash("기본 이미지로 바꿨습니다."); load() }
            catch (e: Exception) { photoBusy = false; render(); flash(e.message ?: "기본 이미지로 바꾸지 못했습니다.", error = true) }
        }
    }

    private fun openPicker() {
        host.pickAvatar { bytes ->
            if (bytes == null) return@pickAvatar
            photoBusy = true; render()
            launch {
                try { api.uploadAvatar(bytes); photoBusy = false; flash("프로필 사진을 바꿨습니다."); load() }
                catch (e: Exception) { photoBusy = false; render(); flash(e.message ?: "사진을 바꾸지 못했습니다.", error = true) }
            }
        }
    }
}

/*
 * **프로필 수정** — 아이폰 `MeEditViewController`. 받는 것은 여섯이고 다 필수다 —
 * 사용자가 정해 준 차례 그대로 **닉네임 · 전화번호 · 생년월일 · 성별 · 차량번호 · 거주지역**.
 * **`profiles`를 먼저 쓴다** — 첫 앱관리자를 가리는 트리거가 `profile_private`에 걸려 있다
 * (`updateMyProfile`이 그 순서다).
 */
class MeEditScreen(ctx: Context, host: ScreenHost, private val profile: JSONObject?, private val contact: JSONObject?) :
    FormScreen(ctx, host, "프로필 수정") {
    private val nameField = textField(max = 20)
    private val phoneField = textField("010-0000-0000", 20, InputType.TYPE_CLASS_PHONE)
    private val birth = GenderAgeFields(ui)
    private val carField = textField("12가 3456", 20)
    private val regionField = textField("광산구", GenderAgeFields.REGION_MAX)

    override fun load() {
        if (built) return
        built = true
        val p = profile?.let(::AppProfile)
        nameField.setText(p?.name.orEmpty())
        phoneField.setText(contact?.strOrNull("phone").orEmpty())
        birth.fill(profile, contact)
        carField.setText(contact?.strOrNull("car").orEmpty())
        regionField.setText(p?.region.orEmpty())
        card(listOf(field("닉네임", nameField), field("전화번호", phoneField)) + birth.views() +
            listOf(field("차량번호", carField), field("거주지역", regionField)))
        showForm("저장")
    }

    override fun save() {
        if (saving) return
        val name = text(nameField); val phone = text(phoneField); val car = text(carField); val region = text(regionField)
        if (name.isEmpty()) { flash("닉네임을 적어 주세요.", error = true); return }
        if (phone.isEmpty()) { flash("전화번호를 적어 주세요.", error = true); return }
        if (car.isEmpty()) { flash("차량번호를 적어 주세요.", error = true); return }
        val b = birth.value { flash(it, error = true) } ?: return
        if (region.isEmpty()) { flash("거주지역을 적어 주세요.", error = true); return }
        hideKeyboard()
        setSave("저장", true)
        launch {
            try {
                api.updateMyProfile(name, b.gender, b.year, region.take(GenderAgeFields.REGION_MAX), phone, car, b.md, b.cal)
                setSave("저장", false)
                host.back(refreshBehind = true)
            } catch (e: Exception) {
                setSave("저장", false)
                flash(e.message ?: "저장하지 못했습니다.", error = true)
            }
        }
    }
}
