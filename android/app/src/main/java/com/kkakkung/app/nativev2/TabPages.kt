package com.kkakkung.app.nativev2

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import org.json.JSONObject

/** 탭 화면이 바깥에 부탁하는 일 — 화면을 여는 것은 `NativeHomeActivity`가 한다. */
interface TabNav {
    fun openRound(id: String)
    fun openPoll(id: String)
    fun openPost(id: String)
    fun openMe()
    fun openAlerts()
    fun openMembers()
    fun openChat()
    fun newRound()
    fun newPoll()
    fun newPost()
    fun toast(msg: String)
    fun ask(title: String, msg: String, ok: () -> Unit)
}

/**
 * **탭 넷의 본문** — 아이폰 `HomeTab.swift`·`ShellTabs.swift`를 옮긴 것이다.
 * 머리말(`head`)은 위에 붙박이고 본문(`page`)만 굴러간다(아이폰 `ShellTabController`).
 * 받는 것·차례·말이 아이폰과 같아야 한다 — **한쪽만 고치지 말 것.**
 */
class TabPages(
    private val ctx: Context,
    private val api: NativeApi,
    private val scope: CoroutineScope,
    private val me: String,
    private val nav: TabNav,
) {
    class Page(val head: View, val body: LinearLayout, val load: () -> Unit)

    private val ui = Ui(ctx)
    private val cards = TabCards(ui)
    var homeHead: TabCards.HomeHead? = null
        private set
    /** 홈을 처음 다 그렸을 때 한 번 — 첫 화면 가리개를 걷는 신호(아이폰 `onFirstLoad`). 실패해도 부른다. */
    var onHomeLoaded: (() -> Unit)? = null

    private fun body(): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(ui.dp(16), ui.dp(4), ui.dp(16), ui.dp(24))
    }

    private fun spinner(page: LinearLayout) {
        page.removeAllViews()
        page.addView(ProgressBar(ctx), LinearLayout.LayoutParams(-2, -2).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = ui.dp(120) })
    }

    private fun fail(page: LinearLayout, e: Exception) {
        page.removeAllViews()
        page.addView(cards.empty(e.message ?: "불러오지 못했습니다."))
    }

    private suspend fun peopleMap(): Map<String, AppProfile> = try {
        api.people().map(::AppProfile).associateBy { it.id }
    } catch (_: Exception) { emptyMap() }

    // ── 홈 ─────────────────────────────────────────────────────

    fun home(): Page {
        val head = cards.HomeHead(onFace = nav::openMe, onBell = nav::openAlerts)
        homeHead = head
        val page = body()
        return Page(head.view, page) {
            if (page.childCount == 0) spinner(page)
            scope.launch {
                try {
                    val profile = async { runCatching { api.profile() }.getOrNull() }
                    val rounds = async { api.roundsUpcoming() }
                    val polls = async { api.livePolls() }
                    val voted = async { runCatching { api.myVotedPolls() }.getOrDefault(emptySet()) }
                    val people = async { peopleMap() }
                    val chat = async { runCatching { api.unreadChatCount() }.getOrDefault(0) }
                    val alerts = async { runCatching { api.unreadAlertCount() }.getOrDefault(0) }
                    val prof = profile.await()?.let(::AppProfile)
                    head.show(prof, "")
                    head.alerts(alerts.await())
                    val admin = AppRole.isAdmin(prof?.role ?: "")
                    val pending = if (admin) runCatching { api.pendingCount() }.getOrDefault(0) else 0
                    val live = polls.await()
                    api.announceClosedPolls(live)
                    val upcoming = rounds.await().map(::AppRound)
                        .filter { it.status != "cancelled" && !it.isPast }
                    val ppl = people.await()
                    val first = upcoming.firstOrNull()
                    val tees = mutableMapOf<String, String>()
                    val weather = if (first != null) {
                        if (first.mine(me)?.grp != null) runCatching {
                            val t = api.groupTees(first.id); t.keys().forEach { k -> tees[k] = t.optString(k) }
                        }
                        NativeWeather.weather(first.raw)
                    } else null

                    page.removeAllViews()
                    page.addView(if (first != null) cards.nextRound(first, me, ppl, tees, weather) { nav.openRound(first.id) }
                        else cards.emptyNext { nav.newRound() })

                    val todo = mutableListOf<View>()
                    val votedSet = voted.await()
                    live.map(::AppPoll).filter { !it.closed && it.id !in votedSet }.forEach { p ->
                        todo.add(cards.homeRow(ui.badge("투표", Ui.Badge.BRAND), p.title, null) { nav.openPoll(p.id) })
                    }
                    if (pending > 0) todo.add(cards.homeRow(ui.badge("승인", Ui.Badge.WARN), "가입 신청 ${pending}명", null) { nav.openMembers() })
                    val unread = chat.await()
                    if (unread > 0) todo.add(cards.homeRow(ui.badge("대화", Ui.Badge.DANGER), "안 읽은 메시지 ${if (unread >= 100) "99+" else "$unread"}개", null) { nav.openChat() })
                    if (todo.isNotEmpty()) {
                        page.addView(cards.section("내가 할 일"))
                        todo.forEach(page::addView)
                    }
                    val others = upcoming.drop(1)
                    if (others.isNotEmpty()) {
                        page.addView(cards.section("모집중"))
                        others.forEach { r -> page.addView(cards.homeRound(r, me) { nav.openRound(r.id) }) }
                    }
                } catch (e: Exception) { fail(page, e) }
                onHomeLoaded?.let { onHomeLoaded = null; it() }
            }
        }
    }

    // ── 공지 ───────────────────────────────────────────────────

    fun board(): Page {
        val head = cards.tabHead("공지", "+ 글쓰기") { nav.newPost() }
        head.action?.visibility = View.GONE   // 운영진인 것이 보이면 내놓는다
        val page = body()
        return Page(head.view, page) {
            if (page.childCount == 0) spinner(page)
            scope.launch {
                try {
                    val prof = async { runCatching { api.profile() }.getOrNull() }
                    val people = async { peopleMap() }
                    val posts = api.posts()
                    val admin = AppRole.isAdmin(prof.await()?.optString("role").orEmpty())
                    head.action?.visibility = if (admin) View.VISIBLE else View.GONE
                    val ppl = people.await()
                    page.removeAllViews()
                    if (posts.isEmpty()) page.addView(cards.empty("아직 공지가 없습니다.\n중요한 것만 여기 남기세요. 대화는 대화 탭에서 합니다."))
                    posts.forEach { p ->
                        val who = p.strOrNull("author_id")?.let { ppl[it]?.label }.orEmpty()
                        page.addView(cards.post(p, who) { nav.openPost(p.str("id")) })
                    }
                } catch (e: Exception) { fail(page, e) }
            }
        }
    }

    // ── 라운드 ─────────────────────────────────────────────────

    private var roundFilter = 0          // 0 전체 · 1 필드 · 2 스크린
    private var pastMax = PAST_ROUNDS

    fun rounds(): Page {
        val head = cards.tabHead("라운드", "+ 모집 열기") { nav.newRound() }
        val page = body()
        var upcomingRaw = emptyList<AppRound>()
        var pastRaw = emptyList<AppRound>()
        var pastGot = 0

        fun render() {
            page.removeAllViews()
            val all = upcomingRaw + pastRaw.filter { p -> upcomingRaw.none { it.id == p.id } }
            val kinds = all.map { it.isScreen }.toSet()
            if (kinds.size > 1) page.addView(cards.segments(listOf("전체", "⛳ 필드", "🎯 스크린"), roundFilter) { roundFilter = it; render() })
            val shown = all.filter { roundFilter == 0 || it.isScreen == (roundFilter == 2) }
            val upcoming = shown.filter { it.status != "cancelled" && !it.isPast }.sortedBy { it.teeAt }
            val past = shown.filter { it !in upcoming }.sortedByDescending { it.teeAt }
            if (upcoming.isEmpty()) page.addView(cards.empty(when (roundFilter) {
                1 -> "예정된 필드 라운드가 없습니다."
                2 -> "예정된 스크린 라운드가 없습니다."
                else -> "예정된 라운드가 없습니다.\n위의 모집 열기로 새 라운드를 올려 보세요."
            }).apply { (layoutParams as LinearLayout.LayoutParams).topMargin = ui.dp(60) })
            upcoming.forEach { r -> page.addView(cards.round(r, me, false) { nav.openRound(r.id) }) }
            if (past.isNotEmpty()) {
                page.addView(cards.section("지난 라운드"))
                past.forEach { r -> page.addView(cards.round(r, me, true) { nav.openRound(r.id) }) }
            }
            if (pastGot >= pastMax) page.addView(cards.more("지난 라운드 더 보기") {
                pastMax += MORE_ROUNDS
                scope.launch {
                    try { val more = api.roundsPast(pastMax); pastGot = more.size; pastRaw = more.map(::AppRound); render() }
                    catch (e: Exception) { nav.toast(e.message ?: "지난 라운드를 불러오지 못했습니다.") }
                }
            })
        }

        return Page(head.view, page) {
            if (page.childCount == 0) spinner(page)
            scope.launch {
                try {
                    val up = async { api.roundsUpcoming() }
                    val past = api.roundsPast(pastMax)
                    upcomingRaw = up.await().map(::AppRound)
                    pastRaw = past.map(::AppRound); pastGot = past.size
                    render()
                } catch (e: Exception) { fail(page, e) }
            }
        }
    }

    // ── 투표 ───────────────────────────────────────────────────

    private val expanded = mutableSetOf<String>()
    private var doneMax = DONE_POLLS

    fun polls(): Page {
        val head = cards.tabHead("투표", "+ 투표 만들기") { nav.newPoll() }
        val page = body()
        var live = emptyList<AppPoll>()
        var done = emptyList<AppPoll>()
        var doneGot = 0
        var people = emptyMap<String, AppProfile>()
        var myRole = ""
        lateinit var reload: () -> Unit

        fun render() {
            page.removeAllViews()
            val open = live.filter { !it.closed }
            val closed = (live.filter { it.closed } + done.filter { it.closed }).distinctBy { it.id }
            if (open.isEmpty() && closed.isEmpty()) {
                page.addView(cards.empty("아직 투표가 없습니다.\n날짜 정하기, 골프장 고르기 같은 걸 올려 보세요."))
                return
            }
            fun card(p: AppPoll) = cards.poll(p, me, people,
                canManage = AppRole.isAdmin(myRole) || p.createdBy == me,
                expanded = p.id in expanded, max = OPTIONS_SHOWN,
                on = TabCards.PollActions(
                    open = { nav.openPoll(p.id) },
                    more = { expanded.add(p.id); render() },
                    pick = { oid ->
                        val mine = p.votes.any { it.userId == me && it.optionId == oid }
                        scope.launch {
                            try { if (mine) api.retractVote(oid) else api.castVote(oid); reload() }
                            catch (e: Exception) { nav.toast(e.message ?: "표를 넣지 못했습니다.") }
                        }
                    },
                    close = {
                        scope.launch {
                            try { api.setPollClosed(p, true); reload() }
                            catch (e: Exception) { nav.toast(e.message ?: "마감하지 못했습니다.") }
                        }
                    },
                    delete = {
                        nav.ask("이 투표를 지울까요?", "${p.title}\n${p.votes.size}표가 함께 사라집니다.") {
                            scope.launch {
                                try { api.deletePoll(p.id); reload() }
                                catch (e: Exception) { nav.toast(e.message ?: "지우지 못했습니다.") }
                            }
                        }
                    }))
            open.forEach { page.addView(card(it)) }
            if (closed.isNotEmpty()) {
                page.addView(cards.section("마감된 투표"))
                closed.forEach { page.addView(card(it)) }
            }
            if (doneGot >= doneMax) page.addView(cards.more("지난 투표 더 보기") {
                doneMax += MORE_POLLS
                reload()
            })
        }

        reload = {
            scope.launch {
                try {
                    val at = java.time.Instant.now().toString()
                    val l = async { api.livePolls(at) }
                    val prof = async { runCatching { api.profile() }.getOrNull() }
                    val ppl = async { peopleMap() }
                    val d = api.pastPolls(0, at, doneMax)
                    val lv = l.await()
                    api.announceClosedPolls(lv + d)
                    live = lv.map(::AppPoll); done = d.map(::AppPoll); doneGot = d.size
                    people = ppl.await(); myRole = prof.await()?.optString("role").orEmpty()
                    render()
                } catch (e: Exception) { fail(page, e) }
            }
        }
        return Page(head.view, page) {
            if (page.childCount == 0) spinner(page)
            reload()
        }
    }

    companion object {
        /** 지난 것만 자르고 안 끝난 것은 다 받는다(웹 `PAST_ROUNDS`·`DONE_POLLS`와 같은 값). */
        const val PAST_ROUNDS = 10
        const val MORE_ROUNDS = 20
        const val DONE_POLLS = 10
        const val MORE_POLLS = 20
        const val OPTIONS_SHOWN = 5
    }
}
