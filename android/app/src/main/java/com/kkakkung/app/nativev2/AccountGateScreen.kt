package com.kkakkung.app.nativev2

import android.content.Context
import android.text.InputType
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import org.json.JSONObject

/*
 * **들어가기 전에 막는 두 화면** — 웹 `screens/Pending.tsx`(승인 대기·추방)와 `FillProfile.tsx`
 * (이미 승인된 회원에게 빠진 정보를 한 번 받기)를 코틀린으로 옮긴 것이다(아이폰은 이 둘을 웹이 그린다).
 * 생김새·말·규칙이 웹과 같아야 한다 — 한쪽만 고치지 말 것.
 *
 *  - 머리: 얼굴 + 이름(굵게) + 작은 흐린 줄 · 노란 안내(`.notice warn`) · 흰 카드에 칸들 · 분홍 `저장`.
 *  - **승인 대기**: 여섯 칸 다 필수(닉네임·전화번호·생년월일·성별·차량번호·거주지역 — 사용자가 정한 차례) ·
 *    `📖 기다리는 동안 사용자 가이드 보기` · `로그아웃`. 저장해도 이 화면에 남는다(웹과 같다).
 *    **승인되면 저절로 들어간다** — 웹은 실시간 구독으로, 여기서는 20초마다와 앱으로 돌아올 때 다시 본다.
 *  - **추방**: 안내와 `로그아웃`만.
 *  - **빠진 정보 받기**: 생년월일·성별·거주지역(+ 이름이 비었으면 닉네임 — 애플 로그인) ·
 *    **보낸 칸만 고친다**(전화·차량은 안 물으므로 그대로 둔다) · `저장하고 시작하기`.
 */
class AccountGateScreen(
    ctx: Context, host: ScreenHost,
    private val mode: Mode, private val profile: JSONObject?, private val contact: JSONObject?,
    private val enter: () -> Unit, private val showHelp: () -> Unit, private val logout: () -> Unit,
) : NativeScreen(ctx, host, "") {
    enum class Mode { PENDING, BANNED, FILL }

    private val stack: LinearLayout
    private val nameField = formText(ui, "", 20, InputType.TYPE_CLASS_TEXT)
    private val phoneField = formText(ui, "010-0000-0000", 20, InputType.TYPE_CLASS_PHONE)
    private val carField = formText(ui, "12가 3456", 20, InputType.TYPE_CLASS_TEXT)
    private val regionField = formText(ui, "광산구", GenderAgeFields.REGION_MAX, InputType.TYPE_CLASS_TEXT)
    private val birth = GenderAgeFields(ui)
    private val saveBtn = ui.button(if (mode == Mode.FILL) "저장하고 시작하기" else "저장", AppSkin.brand, filled = true) { save() }
    private val p = profile?.let(::AppProfile)
    /** 애플로 들어오면 이름이 없다 — 그 사람에게만 닉네임 칸을 더 띄운다(웹 `askName`). */
    private val askName = p?.name.isNullOrBlank()
    private val poll = Runnable { checkApproved() }

    init {
        header.visibility = View.GONE
        val (s, st) = scrollStack(); stack = st
        stack.setPadding(ui.dp(16), ui.dp(20), ui.dp(16), ui.dp(24))
        body.addView(s, 0, FrameLayout.LayoutParams(-1, -1))
        render()
    }

    override fun load() {
        if (mode == Mode.PENDING) checkApproved()
    }

    private fun render() {
        stack.removeAllViews()
        val name = p?.name?.ifBlank { null }
        stack.addView(LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            addView(ui.avatar(p, 48))
            addView(ui.vstack(2).apply {
                addView(ui.label(if (mode == Mode.FILL) "${name ?: "회원"}님" else name ?: "닉네임 없음", 17f, bold = true))
                addView(ui.label(when (mode) { Mode.FILL -> "몇 가지만 더 알려 주세요"; Mode.BANNED -> "이용이 제한된 계정"; else -> "가입 승인을 기다리는 중" },
                    13f, color = AppSkin.faint))
            }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = ui.dp(12) })
        })

        stack.addView(notice(when (mode) {
            Mode.BANNED -> ui.rich(Triple("이 계정은 ", 14f, false to AppSkin.warn), Triple("이용이 제한", 14f, true to AppSkin.warn),
                Triple("되었습니다.\n궁금한 점은 운영진에게 물어봐 주세요.", 14f, false to AppSkin.warn))
            Mode.PENDING -> ui.rich(Triple("아직 ", 14f, false to AppSkin.warn), Triple("가입 승인 대기중", 14f, true to AppSkin.warn),
                Triple("입니다.\n운영진이 명단에서 승인하면 바로 들어갈 수 있습니다.", 14f, false to AppSkin.warn))
            /* **왜 받는지 적는다** — 잘 쓰던 앱이 갑자기 뭘 물어보면 무슨 일인가 싶다. */
            Mode.FILL -> ui.rich(Triple("생년월일 · 성별 · 거주지역", 14f, true to AppSkin.warn),
                Triple("이 빠져 있습니다.\n남녀와 나이가 고르게 섞이도록 조를 짜는 데 쓰고, 이름은 ", 14f, false to AppSkin.warn),
                Triple("83/신성호/광산구", 14f, true to AppSkin.warn),
                Triple("처럼 보이게 됩니다.\n생일에는 대화방에 축하 인사가 올라갑니다. ", 14f, false to AppSkin.warn),
                Triple("달과 날은 운영진만", 14f, true to AppSkin.warn), Triple(" 볼 수 있습니다.", 14f, false to AppSkin.warn))
        }))

        if (mode != Mode.BANNED) {
            birth.fill(profile, contact)
            regionField.setText(p?.region.orEmpty())
            val card = ui.card().apply { setPadding(ui.dp(14), ui.dp(14), ui.dp(14), ui.dp(14)) }
            if (mode == Mode.PENDING) {
                nameField.hint = "모임에서 부르는 이름"
                nameField.setText(p?.name.orEmpty())
                phoneField.setText(contact?.strOrNull("phone").orEmpty())
                carField.setText(contact?.strOrNull("car").orEmpty())
                card.addView(ui.sectionTitle("운영진이 알아볼 수 있게 적어 주세요"))
                card.addView(formField(ui, "닉네임", nameField))
                card.addView(formField(ui, "전화번호", phoneField))
                birth.views().forEach(card::addView)
                card.addView(formField(ui, "차량번호", carField))
            } else {
                if (askName) { nameField.hint = "신성호"; card.addView(formField(ui, "닉네임", nameField)) }
                birth.views().forEach(card::addView)
            }
            card.addView(formField(ui, "거주지역", regionField))
            card.addView(saveBtn, LinearLayout.LayoutParams(-1, ui.dp(48)))
            stack.addView(card)
        }
        /* 기다리는 동안 미리 읽어 두면 승인되자마자 쓸 수 있다. */
        if (mode == Mode.PENDING) stack.addView(ui.button("📖 기다리는 동안 사용자 가이드 보기") { showHelp() }, LinearLayout.LayoutParams(-1, ui.dp(44)))
        stack.addView(ui.button("로그아웃", AppSkin.dim) { logout() }.apply {
            background = ui.rounded(android.graphics.Color.TRANSPARENT, 20)
        }, LinearLayout.LayoutParams(-1, ui.dp(44)))
    }

    /** 웹 `.notice warn` — 옅은 바탕 · 노란 테두리 · 노란 글자. */
    private fun notice(text: CharSequence) = ui.label(text, 14f, color = AppSkin.warn, lines = 0).apply {
        setLineSpacing(0f, 1.5f)
        background = ui.rounded(AppSkin.surface2, AppSkin.radiusSm, AppSkin.alpha(0xFFFBBF24.toInt(), .4f))
        setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12))
    }

    private fun save() {
        if (busy) return
        val say = { t: String -> flash(t, error = true) }
        val name = nameField.text.toString().trim()
        val region = regionField.text.toString().trim()
        if (mode == Mode.PENDING) {
            if (name.isEmpty()) return say("닉네임을 적어 주세요.")
            if (phoneField.text.isBlank()) return say("전화번호를 적어 주세요.")
            if (carField.text.isBlank()) return say("차량번호를 적어 주세요.")
        } else if (askName && name.isEmpty()) return say("닉네임을 적어 주세요.")
        val b = birth.value(say) ?: return
        if (region.isEmpty()) return say("거주지역을 적어 주세요.")
        hideKeyboard()
        busy = true
        saveBtn.text = "저장 중…"
        launch {
            try {
                if (mode == Mode.PENDING) {
                    api.updateMyProfile(name, b.gender, b.year, region, phoneField.text.toString().trim(), carField.text.toString().trim(), b.md, b.cal)
                    flash("저장했습니다. 운영진이 확인하면 들어갈 수 있습니다.")
                } else {
                    /* 이름이 있던 사람의 것을 덮어쓰지 않는다 · 전화·차량은 안 물었으므로 안 보낸다. */
                    val pub = JSONObject().put("gender", b.gender).put("birth_year", b.year).put("region", region)
                    if (askName) pub.put("name", name)
                    api.updateProfileParts(pub, JSONObject().put("birth_md", b.md).put("birth_cal", b.cal))
                    enter()
                }
            } catch (e: Exception) { flash(e.message ?: "저장하지 못했습니다.", error = true) }
            busy = false
            saveBtn.text = if (mode == Mode.FILL) "저장하고 시작하기" else "저장"
        }
    }

    /** 승인되었는가 — 되었으면 들어가고, 아니면 20초 뒤 다시 본다(웹은 실시간 구독). */
    private fun checkApproved() {
        root.removeCallbacks(poll)
        launch {
            val role = try { api.profile()?.strOrNull("role") } catch (_: Exception) { null }
            if (role != null && role != "pending" && role != "banned") enter()
            else root.postDelayed(poll, 20_000)
        }
    }
}
