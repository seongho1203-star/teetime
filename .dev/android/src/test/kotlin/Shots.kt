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
                val f = File(fixtures, "$path.json")
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
}
