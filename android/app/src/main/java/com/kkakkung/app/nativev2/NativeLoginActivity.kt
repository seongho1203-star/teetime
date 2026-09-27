package com.kkakkung.app.nativev2

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.media.AudioAttributes
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.AppCompatButton
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.kkakkung.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * 기존 React Login.tsx / Login.css를 Android View로 그대로 옮긴 로그인 화면.
 *
 * 디자인 기준:
 * - #f5f7f1 바탕
 * - 96dp 앱 아이콘 / 26dp 둥근 모서리
 * - 상단 safe area + 화면 높이 15% 지점
 * - Kakao/Apple 모두 52dp, 11dp radius
 * - 하단 설명과 24dp 여백
 *
 * 바뀐 것은 화면 기술뿐이다. OAuth는 WebView가 아니라 외부 브라우저에서 한다.
 */
class NativeLoginActivity : AppCompatActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var busy = false
    private lateinit var kakao: AppCompatButton
    private lateinit var apple: AppCompatButton
    private lateinit var error: TextView

    private val bg = Color.rgb(245, 247, 241)       // --bg
    private val ink = Color.rgb(27, 31, 25)        // --text
    private val dim = Color.rgb(91, 100, 85)       // --text-dim
    private val danger = Color.rgb(226, 64, 42)    // --danger

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NativeSessionStore.init(this)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        createNotifyChannel()

        NativeSessionStore.restore(this)?.let {
            openHome(pushTarget(intent))
            return
        }

        buildLogin()
        handleCallback(intent?.data)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val callback = intent.data
        if (callback?.scheme == "kkakkung" && callback.host == "auth") {
            handleCallback(callback)
        } else if (NativeSessionStore.restore(this) != null) {
            openHome(pushTarget(intent))
        }
    }

    private fun buildLogin() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            setPadding(dp(16), 0, dp(16), 0)
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, ins ->
            val bars = ins.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(dp(16), bars.top, dp(16), bars.bottom + dp(24))
            ins
        }

        val brand = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val mark = ImageView(this).apply {
            setImageResource(R.mipmap.ic_launcher)
            scaleType = ImageView.ScaleType.CENTER_CROP
            elevation = dp(6).toFloat()
            background = GradientDrawable().apply {
                cornerRadius = dp(26).toFloat()
                setColor(Color.WHITE)
            }
            clipToOutline = true
        }
        brand.addView(mark, LinearLayout.LayoutParams(dp(96), dp(96)).apply {
            bottomMargin = dp(6)
        })
        brand.addView(TextView(this).apply {
            text = "까꿍"
            textSize = 38.4f // 2.4rem
            typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            setTextColor(ink)
            gravity = Gravity.CENTER
        })
        brand.addView(TextView(this).apply {
            text = "골프에 열정이 가득하신 여러분\n환영합니다"
            textSize = 13.1f // --fs-sm 0.82rem
            setTextColor(dim)
            gravity = Gravity.CENTER
            setLineSpacing(0f, 1.7f)
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(10) })

        val top = (resources.displayMetrics.heightPixels * 0.15f).toInt()
        root.addView(brand, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = top })

        // CSS justify-content:space-between 과 같은 빈 공간.
        root.addView(View(this), LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ))

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        kakao = loginButton(
            "카카오로 시작하기", Color.rgb(254, 229, 0), Color.rgb(25, 22, 0),
            R.drawable.ic_kakao_login
        ) { startOAuth("kakao") }
        apple = loginButton(
            "Apple로 계속하기", Color.BLACK, Color.WHITE,
            R.drawable.ic_apple_login
        ) { startOAuth("apple") }
        actions.addView(kakao, buttonParams())
        actions.addView(apple, buttonParams().apply { topMargin = dp(16) })

        error = TextView(this).apply {
            textSize = 12f
            setTextColor(danger)
            gravity = Gravity.CENTER
            visibility = View.GONE
            setPadding(0, dp(8), 0, 0)
        }
        actions.addView(error)

        actions.addView(TextView(this).apply {
            text = "로그인하면 운영진에게 가입 신청이 갑니다.\n승인된 뒤부터 라운드 신청을 할 수 있습니다."
            textSize = 11.5f // --fs-xs
            setTextColor(Color.rgb(139, 148, 134)) // --text-faint
            gravity = Gravity.CENTER
            setLineSpacing(0f, 1.7f)
        }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(16) })

        root.addView(actions, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
        ))
        setContentView(root)
        ViewCompat.requestApplyInsets(root)
    }

    private fun loginButton(
        label: String, background: Int, foreground: Int, icon: Int, click: () -> Unit
    ): AppCompatButton = AppCompatButton(this).apply {
        text = label
        textSize = 16.3f // --fs-md
        typeface = Typeface.DEFAULT_BOLD
        isAllCaps = false
        gravity = Gravity.CENTER
        setTextColor(foreground)
        setCompoundDrawablesWithIntrinsicBounds(
            ContextCompat.getDrawable(this@NativeLoginActivity, icon), null, null, null
        )
        compoundDrawablePadding = dp(8)
        this.background = GradientDrawable().apply {
            cornerRadius = dp(11).toFloat()
            setColor(background)
        }
        setOnClickListener { if (!busy) click() }
    }

    private fun buttonParams() = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, dp(52)
    )

    private fun startOAuth(provider: String) {
        setBusy(true)
        error.visibility = View.GONE
        try {
            startActivity(Intent(Intent.ACTION_VIEW, NativeAuth.oauthUrl(this, provider)))
        } catch (e: Exception) {
            showError(e.message ?: "로그인을 시작하지 못했습니다.")
        }
    }

    override fun onResume() {
        super.onResume()
        // 브라우저에서 그냥 뒤로 돌아온 경우 버튼을 다시 누를 수 있어야 한다.
        if (intent?.data == null && busy) setBusy(false)
    }

    private fun handleCallback(uri: Uri?) {
        if (uri == null || uri.scheme != "kkakkung" || uri.host != "auth") return
        setBusy(true)
        scope.launch {
            try {
                NativeAuth.exchangeCallback(this@NativeLoginActivity, uri)
                // 재생성/재처리 방지.
                intent.data = null
                openHome()
            } catch (e: Exception) {
                intent.data = null
                showError(e.message ?: "로그인을 완료하지 못했습니다.")
            }
        }
    }

    private fun setBusy(on: Boolean) {
        busy = on
        if (!::kakao.isInitialized) return
        kakao.isEnabled = !on
        apple.isEnabled = !on
        kakao.alpha = if (on) 0.6f else 1f
        apple.alpha = if (on) 0.6f else 1f
    }

    private fun showError(message: String) {
        setBusy(false)
        error.text = message
        error.visibility = View.VISIBLE
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun pushTarget(i: Intent?): String? =
        i?.getStringExtra("url") ?: i?.getStringExtra("path")

    private fun openHome(target: String? = null) {
        val i = Intent(this, NativeHomeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (!target.isNullOrBlank()) i.putExtra("native_url", target)
        startActivity(i)
        finish()
    }

    /** MainActivity가 더 이상 LAUNCHER가 아니므로 알림 채널도 Native 시작점에서
        앱 화면보다 먼저 만든다. 기존 까꿍 채널 id/소리/중요도는 그대로다. */
    private fun createNotifyChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val ch = NotificationChannel(
            getString(R.string.notify_channel_id),
            getString(R.string.notify_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        )
        ch.description = getString(R.string.notify_channel_desc)
        ch.enableVibration(true)
        val sound = Uri.parse("android.resource://$packageName/${R.raw.kkakkung}")
        ch.setSound(sound, AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .build())
        nm.createNotificationChannel(ch)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
