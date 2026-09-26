package com.kkakkung.app.nativev2

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Native OAuth 전용 Activity.
 *
 * 아직 LAUNCHER로 바꾸지 않는다. 기존 로그인 디자인을 그대로 재현한 뒤
 * 한 번에 전환하기 위해 인증 엔진/콜백부터 분리해 둔다.
 */
class NativeLoginActivity : AppCompatActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NativeSessionStore.restore(this)?.let {
            openHome(); return
        }
        handleCallback(intent?.data)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleCallback(intent.data)
    }

    fun startKakao() = startOAuth("kakao")
    fun startApple() = startOAuth("apple")

    private fun startOAuth(provider: String) {
        val uri = NativeAuth.oauthUrl(this, provider)
        startActivity(Intent(Intent.ACTION_VIEW, uri))
    }

    private fun handleCallback(uri: Uri?) {
        if (uri == null || uri.scheme != "kkakkung" || uri.host != "auth") return
        scope.launch {
            try {
                NativeAuth.exchangeCallback(this@NativeLoginActivity, uri)
                openHome()
            } catch (_: Exception) {
                /* 실제 로그인 UI를 붙일 때 기존 까꿍 오류 표시와 동일하게 연결한다. */
            }
        }
    }

    private fun openHome() {
        startActivity(Intent(this, NativeHomeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        finish()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
