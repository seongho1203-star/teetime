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

    @Test fun round() = shoot("round") { RoundScreen(RuntimeEnvironment.getApplication(), it, "r1") }
    @Test fun poll() = shoot("poll") { PollScreen(RuntimeEnvironment.getApplication(), it, "p1") }
}
