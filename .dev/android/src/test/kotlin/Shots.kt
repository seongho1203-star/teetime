package shots

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.View
import android.widget.FrameLayout
import com.kkakkung.app.nativev2.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** 안드로이드 화면을 JVM에서 그려 PNG로 떨군다(여기서는 진짜 기기가 없다). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(manifest = Config.NONE, sdk = [35], qualifiers = "w390dp-h844dp-xhdpi")
class Shots {
    private val fixtures = File(System.getProperty("shots.dir"), "../../fixtures")

    private fun server(): MockWebServer = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.requestUrl!!.encodedPath.removePrefix("/rest/v1/").replace('/', '_')
                /* 여러 쪽을 넘겨 받는 조회(livePolls)가 끝나게 — 두 번째 쪽부터는 빈손이다. */
                if ((request.requestUrl!!.queryParameter("offset")?.toIntOrNull() ?: 0) > 0) return MockResponse().setBody("[]")
                /* 고치기·넣기에는 빈손 — 알림함의 읽음 찍기가 고정 자료를 통째로 '방금 읽음'으로 만들지 않게. */
                val f = File(fixtures, "$path.json")
                if (request.method != "GET" && !(path.startsWith("rpc_") && f.exists())) return MockResponse().setBody("[]")
                return MockResponse().setBody(if (f.exists()) f.readText() else "[]")
            }
        }
        start()
    }

    private fun host(api: NativeApi) = object : ScreenHost {
        override val hostApi = api
        override val hostScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
        override val myId = "me"
        override fun back(refreshBehind: Boolean) {}
        override fun editRound(r: JSONObject) {}
        override fun copyRound(r: JSONObject) {}
        override fun roundGroups(r: JSONObject, people: List<JSONObject>) {}
        override fun newSettlement(roundId: String, joined: List<String>, people: List<JSONObject>) {}
        override fun editPoll(p: JSONObject) {}
        override fun editPost(p: JSONObject) {}
        override fun open(path: String) {}
        override fun replaceWith(path: String) {}
        override fun pickAvatar(done: (ByteArray?) -> Unit) {}
        override fun askPushPermission(done: (Boolean) -> Unit) {}
        override fun logout() {}
        override fun editProfile(profile: JSONObject?, contact: JSONObject?) {}
        override fun makeAvatar(name: String) {}
    }

    private fun shoot(name: String, make: (ScreenHost) -> NativeScreen) {
        val srv = server()
        val api = NativeApi(NativeSession("me", "t", "", 0, srv.url("/").toString(), "anon"))
        val ctx = RuntimeEnvironment.getApplication()
        val screen = make(host(api))
        val frame = FrameLayout(ctx)
        frame.addView(screen.root, FrameLayout.LayoutParams(-1, -1))
        screen.load()
        repeat(60) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(50) }
        val w = ctx.resources.displayMetrics.widthPixels
        val full = System.getProperty("shots.full") == "1"
        val h = if (full) 4000 else ctx.resources.displayMetrics.heightPixels
        frame.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        frame.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        frame.draw(Canvas(bmp))
        File(System.getProperty("shots.dir"), "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        srv.shutdown()
    }

    /** 앱 화면이 아닌 조각 하나를 찍는다(목록 없이). */
    private fun shootView(name: String, h: Int, make: (android.content.Context) -> View) {
        val ctx = RuntimeEnvironment.getApplication()
        val v = make(ctx)
        val w = ctx.resources.displayMetrics.widthPixels
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.AT_MOST))
        v.layout(0, 0, w, v.measuredHeight)
        val bmp = Bitmap.createBitmap(w, maxOf(1, v.measuredHeight), Bitmap.Config.ARGB_8888)
        v.draw(Canvas(bmp))
        File(System.getProperty("shots.dir"), "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun chatCards() = shootView("chat-cards", 4000) { ctx ->
        val col = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setBackgroundColor(com.kkakkung.app.chat.ChatSkin.bg)
            setPadding(0, 40, 0, 40)
        }
        val w = (320 * ctx.resources.displayMetrics.density).toInt()
        fun add(body: String, icon: String, go: String) {
            col.addView(com.kkakkung.app.chat.ChatLinkCard(ctx).apply { bind(body, icon, go) },
                android.widget.LinearLayout.LayoutParams(w, -2).apply { gravity = android.view.Gravity.CENTER_HORIZONTAL; bottomMargin = 40 })
        }
        add("악마제리님이 스크린을 공유했습니다\n골프존파크 상무점\n9월 8일 (화) · 오전 7:30 · 정원 6명 · 6자리 남음", "round", "라운드 보러 가기 ›")
        add("악마제리님이 라운드 모집을 열었습니다\n무등산CC", "round", "라운드 보러 가기 ›")
        add("악마제리님이 투표를 올렸습니다\n테스트1", "poll", "투표 보러 가기 ›")
        add("투표가 끝났습니다\n테스트1\n1위 · 9월 19일 (토) (2표)", "poll", "투표 보러 가기 ›")
        add("악마제리님이 공지를 공유했습니다\n10월 정기 모임 안내\n이번 달은 무등산에서 모입니다", "post", "공지 보러 가기 ›")
        col
    }

    @Test fun chat() {
        val srv = server()
        val act = org.robolectric.Robolectric.buildActivity(androidx.appcompat.app.AppCompatActivity::class.java).setup().get()
        val shared = File(System.getProperty("shots.dir"), "../gen-assets/chat-shared.json").takeIf { it.exists() }?.readText()
        val cfg = JSONObject(shared ?: "{}").put("user", "me").put("token", "t").put("url", srv.url("/").toString()).put("key", "anon").put("back", true)
        val chat = com.kkakkung.app.chat.ChatScreen(act, com.kkakkung.app.chat.ChatService(com.kkakkung.app.chat.ChatConfig(cfg)))
        val frame = FrameLayout(act)
        act.setContentView(frame)
        chat.attach(frame)
        repeat(80) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(40) }
        val ctx = act
        val w = ctx.resources.displayMetrics.widthPixels; val h = ctx.resources.displayMetrics.heightPixels
        frame.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        frame.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        frame.draw(Canvas(bmp))
        File(System.getProperty("shots.dir"), "chat.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        srv.shutdown()
    }

    @Test fun round() = shoot("round") { RoundScreen(RuntimeEnvironment.getApplication(), it, "r1") }
    @Test fun poll() = shoot("poll") { PollScreen(RuntimeEnvironment.getApplication(), it, "p1") }
    @Test fun post() = shoot("post") { PostScreen(RuntimeEnvironment.getApplication(), it, "n1") }
    @Test fun alerts() = shoot("alerts") { AlertsScreen(RuntimeEnvironment.getApplication(), it) }
    @Test fun members() = shoot("members") { MembersScreen(RuntimeEnvironment.getApplication(), it) }
    @Test fun me() = shoot("me") { MeScreen(RuntimeEnvironment.getApplication(), it) }
    @Test fun meEdit() = shoot("me-edit") {
        MeEditScreen(RuntimeEnvironment.getApplication(), it,
            JSONObject("""{"id":"me","name":"악마제리","role":"superadmin","gender":"m","birth_year":1983,"region":"광산구"}"""),
            JSONObject("""{"id":"me","phone":"010-1234-5678","car":"12가3456","birth_md":"05-10","birth_cal":"lunar"}"""))
    }
    @Test fun postEdit() = shoot("post-edit") { PostEditScreen(RuntimeEnvironment.getApplication(), it, null) }
    @Test fun pollEdit() = shoot("poll-edit") { PollEditScreen(RuntimeEnvironment.getApplication(), it, null) }
    private fun courses() = org.json.JSONArray(File(System.getProperty("shots.dir"), "../gen-assets/courses.json").readText()).let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
    @Test fun roundEdit() = shoot("round-edit") {
        val r = JSONObject("""{"id":"r1","course":"무등산CC","kind":"field","tee_at":"2026-09-30T07:10:00+00:00","capacity":8,"fee":140000,"caddie":"none","cart":"included","note":"테스트입니다","created_by":"me","tee_slots":[{"course":"스카이","time":"07:21"},{"course":"베르힐","time":"07:14"}]}""")
        RoundEditScreen(RuntimeEnvironment.getApplication(), it, r, false, courses())
    }
    @Test fun roundNew() = shoot("round-new") { RoundEditScreen(RuntimeEnvironment.getApplication(), it, null, false, courses()) }
    @Test fun settlementNew() = shoot("settlement-new") {
        val people = JSONArray(File(fixtures, "profiles.json").readText()).let { a -> (0 until a.length()).map { AppProfile(a.getJSONObject(it)) } }
            .filter { p -> p.role != "pending" && p.role != "banned" }
        SettlementEditScreen(RuntimeEnvironment.getApplication(), it, "r1", people, listOf("me", "u2", "u4"), listOf("국민은행", "광주은행")).also { s ->
            s.load(); s.totalField.setWon(420000); s.allTapped()
        }
    }
    @Test fun settle() = shoot("settle") { SettleScreen(RuntimeEnvironment.getApplication(), it) }
    @Test fun groups() = shoot("groups") {
        val r = JSONArray(File(fixtures, "rounds.json").readText()).getJSONObject(0)
        val people = JSONArray(File(fixtures, "profiles.json").readText()).let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
        RoundGroupsScreen(RuntimeEnvironment.getApplication(), it, r, people)
    }
    private fun gate(mode: AccountGateScreen.Mode, profile: String, contact: String?) = { h: ScreenHost ->
        AccountGateScreen(RuntimeEnvironment.getApplication(), h, mode, JSONObject(profile), contact?.let(::JSONObject), {}, {}, {})
    }
    @Test fun gatePending() = shoot("gate-pending", gate(AccountGateScreen.Mode.PENDING, """{"id":"u9","name":"골프왕","role":"pending"}""", null))
    @Test fun gateFill() = shoot("gate-fill", gate(AccountGateScreen.Mode.FILL, """{"id":"u9","name":"김지명","role":"member","gender":"f"}""", """{"id":"u9","phone":"010","car":"12가"}"""))
    @Test fun gateBanned() = shoot("gate-banned", gate(AccountGateScreen.Mode.BANNED, """{"id":"u9","name":"정추방","role":"banned"}""", null))
    @Test fun avatarMaker() = shoot("avatar-maker") { AvatarMakerScreen(RuntimeEnvironment.getApplication(), it, "악마제리") }
    @Test fun avatarMakerEmoji() = shoot("avatar-maker-emoji") { AvatarMakerScreen(RuntimeEnvironment.getApplication(), it, "악마제리").apply { tab(0) } }
    @Test fun avatarMakerText() = shoot("avatar-maker-text") { AvatarMakerScreen(RuntimeEnvironment.getApplication(), it, "악마제리").apply { tab(2) } }
    /** 키보드가 올라온 것처럼 화면을 줄여 찍는다 — 미리보기가 줄고 글자 칸이 보여야 한다. */
    @Test fun avatarMakerKeyboard() {
        val srv = server()
        val api = NativeApi(NativeSession("me", "t", "", 0, srv.url("/").toString(), "anon"))
        val ctx = RuntimeEnvironment.getApplication()
        val screen = AvatarMakerScreen(ctx, host(api), "악마제리").apply { tab(2) }
        val frame = FrameLayout(ctx)
        frame.addView(screen.root, FrameLayout.LayoutParams(-1, -1))
        val w = ctx.resources.displayMetrics.widthPixels
        fun lay(h: Int) {
            frame.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
            frame.layout(0, 0, w, h)
            repeat(10) { shadowOf(Looper.getMainLooper()).idle() }
        }
        val full = ctx.resources.displayMetrics.heightPixels
        lay(full); val h = full * 55 / 100; lay(h); lay(h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        frame.draw(Canvas(bmp))
        File(System.getProperty("shots.dir"), "avatar-maker-keyboard.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
    @Test fun avatarArt() = shootView("avatar-art", 1200) { ctx ->
        android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            listOf(AvatarArt.Spec(text = "악마제리"), AvatarArt.Spec(color = "#f6c343", text = "신성호", bold = true, emoji = "⛳"),
                AvatarArt.Spec(color = "#3f5ba9", showText = false, emoji = "🐻"), AvatarArt.Spec(color = "#f5f1e8", text = "김지명")).forEach { s ->
                addView(android.widget.ImageView(ctx).apply { setImageBitmap(AvatarArt.render(s, 240)) }, android.widget.LinearLayout.LayoutParams(240, 240))
            }
        }
    }
    @Test fun help() = shoot("help") { HelpScreen(RuntimeEnvironment.getApplication(), it, File(System.getProperty("shots.dir"), "../gen-assets/guide.json").readText()) }

    /** 탭 넷(홈·공지·라운드·투표) — 머리말은 붙박이, 본문만 굴러간다. */
    private fun shootTab(name: String, make: (TabPages) -> TabPages.Page) {
        val srv = server()
        val api = NativeApi(NativeSession("me", "t", "", 0, srv.url("/").toString(), "anon"))
        val ctx = RuntimeEnvironment.getApplication()
        val nav = object : TabNav {
            override fun openRound(id: String) {}; override fun openPoll(id: String) {}; override fun openPost(id: String) {}
            override fun openMe() {}; override fun openAlerts() {}; override fun openMembers() {}; override fun openChat() {}
            override fun newRound() {}; override fun newPoll() {}; override fun newPost() {}
            override fun toast(msg: String) {}; override fun ask(title: String, msg: String, ok: () -> Unit) {}
        }
        val pages = TabPages(ctx, api, CoroutineScope(SupervisorJob() + Dispatchers.Main), "me", nav)
        val pg = make(pages)
        val col = android.widget.LinearLayout(ctx).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setBackgroundColor(AppSkin.bg)
            addView(pg.head)
            addView(android.widget.ScrollView(ctx).apply { addView(pg.body) }, android.widget.LinearLayout.LayoutParams(-1, 0, 1f))
        }
        pg.load()
        repeat(60) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(50) }
        val w = ctx.resources.displayMetrics.widthPixels
        val h = if (System.getProperty("shots.full") == "1") 4000 else ctx.resources.displayMetrics.heightPixels
        col.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        col.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        col.draw(Canvas(bmp))
        File(System.getProperty("shots.dir"), "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        srv.shutdown()
    }

    @Test fun tabHome() = shootTab("tab-home") { it.home() }
    @Test fun tabBoard() = shootTab("tab-board") { it.board() }
    @Test fun tabRounds() = shootTab("tab-rounds") { it.rounds() }
    @Test fun tabPolls() = shootTab("tab-polls") { it.polls() }
}
