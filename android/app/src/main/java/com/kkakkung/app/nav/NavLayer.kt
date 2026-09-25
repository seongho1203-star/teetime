package com.kkakkung.app.nav

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.activity.BackEventCompat
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * **화면 전환과 뒤로 끌기를 맡는 층**(`src/lib/native-nav.ts`).
 *
 * Capacitor의 웹뷰를 이 `FrameLayout` 안으로 옮겨 담고(`install`), 그 위아래에
 * **찍어 둔 화면(판)** 을 깔거나 얹어 움직인다. 아이폰의 `NativeNavPlugin.swift`와
 * 같은 짜임·같은 값이다 — **한쪽만 고치지 말 것.**
 *
 * ```
 * [판(prev)]  ← 뒤에 깔린 앞 화면. 들어갈 때 1/4만큼 따라 나가며 어두워진다
 * [막(dim)]
 * [웹뷰]      ← 들어갈 때 오른쪽 끝에서 제자리로 온다
 * [앱 화면]   ← 대화(`ChatScreen`). 이 층에 얹혀야 끌어서 뒤로가 된다
 * [떠남(exit)]← 뒤로 갈 때·끌 때 맨 위에서 오른쪽으로 빠져나가는 지금 화면
 * ```
 *
 * - **찍는 것은 `PixelCopy`다**(안드로이드 8부터). 창 표면에서 그 순간의
 *   픽셀을 그대로 떠 오므로 웹뷰가 하드웨어로 그려도 빈 그림이 안 나온다.
 *   그 아래 판(7)에서는 `draw(canvas)`로 물러난다.
 * - **웹이 `push`·`pop`을 부를 때 웹뷰에는 아직 옛 화면이 덮여 있다**
 *   (`lib/tabs.ts`의 `holdScreen`). 그래서 여기서 찍는 것이 곧 앞 화면이다.
 * - **끌기는 `onInterceptTouchEvent`로 가로챈다.** 가로로 `WAKE`만큼 그으면
 *   우리 것이고, 그 뒤 웹뷰는 `ACTION_CANCEL`을 받는다. 손을 댄 자리가 다른
 *   손짓의 임자인지는 웹이 `touch({free})`로 알려 준다(앱은 DOM을 모른다).
 * - **안드로이드 뒤로 손짓(예측형)** 도 같은 움직임이다 — `OnBackPressedCallback`의
 *   `handleOnBackProgressed`가 손가락 대신 `dx`를 준다. 매니페스트의
 *   `enableOnBackInvokedCallback`이 한 쌍이다.
 * - **값은 웹과 같다**: `TAKE` 0.34 · `FLICK` 0.8px/ms · `FLICK_MIN` 40 ·
 *   `STALE` 120 · `WAKE` 12 · `SLOPE` 1.2 · `PARALLAX` 0.25 · `DIM` 0.18 ·
 *   되돌아가는 230ms · 곡선 `cubic-bezier(.32,.72,0,1)`.
 */
class NavLayer(context: Context) : FrameLayout(context) {
    companion object {
        var instance: NavLayer? = null
        const val TAKE = 0.34f
        const val FLICK = 0.8f
        const val FLICK_MIN = 40f
        const val STALE = 120L
        const val WAKE = 12f
        const val SLOPE = 1.2f
        const val PARALLAX = 0.25f
        const val DIM = 0.18f
        const val BACK_MS = 230L
        /** 왼쪽 가장자리 — 여기서 시작한 손짓은 웹이 뭐라 하든 우리 것이다(dp). */
        const val EDGE_DP = 24f
        val EASE = PathInterpolator(0.32f, 0.72f, 0f, 1f)

        /**
         * 웹뷰를 이 층 안으로 옮겨 담는다. `MainActivity.onCreate`에서
         * `super.onCreate` **뒤에** 부른다(그때 웹뷰가 선다).
         */
        fun install(activity: AppCompatActivity, webView: View): NavLayer {
            instance?.let { return it }
            val parent = webView.parent as ViewGroup
            val at = parent.indexOfChild(webView)
            val lp = webView.layoutParams
            parent.removeView(webView)
            val layer = NavLayer(activity)
            layer.web = webView
            layer.addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            parent.addView(layer, at, lp)
            layer.installBack(activity)
            instance = layer
            return layer
        }
    }

    /** 이 층 안의 웹뷰. */
    lateinit var web: View
    /** 뒤에 깔린 앞 화면들 — 히스토리 한 칸에 하나. 탭으로 간 자리는 null이다. */
    private val stack = ArrayList<Bitmap?>()
    private val maxStack = 5
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private val main = Handler(Looper.getMainLooper())

    /** 웹이 `back({on})`으로 알려 준 값 — 이 화면에서 끌 수 있는가. */
    var armed = false
        set(v) { field = v; backGuard?.isEnabled = v || topNative() != null }
    /** 웹이 `touch({free})`로 알려 준 값 — 지금 손이 닿은 자리가 비었는가. */
    var free = true

    /** 앱이 그리는 화면(대화)이 이 층에 얹혀 있으면 그것. */
    private fun topNative(): View? {
        for (i in childCount - 1 downTo 0) {
            val v = getChildAt(i)
            if (v is NavPage) return v
        }
        return null
    }

    /** 이 층에 얹히는 앱 화면. 끌기가 어디서 시작하면 안 되는지를 답한다. */
    interface NavPage { fun freeAt(x: Float, y: Float): Boolean }

    // ── 화면 찍기 ─────────────────────────────────────────────

    /** 지금 보이는 것(웹뷰든 앱 화면이든)을 한 장 찍는다. 못 찍으면 null. */
    private fun snap(done: (Bitmap?) -> Unit) {
        val w = width; val h = height
        if (w <= 0 || h <= 0) { done(null); return }
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val act = context as? AppCompatActivity
        val win = act?.window
        if (Build.VERSION.SDK_INT >= 26 && win != null && isAttachedToWindow) {
            val loc = IntArray(2); getLocationInWindow(loc)
            val rect = Rect(loc[0], loc[1], loc[0] + w, loc[1] + h)
            try {
                PixelCopy.request(win, rect, bmp, { r -> done(if (r == PixelCopy.SUCCESS) bmp else null) }, main)
                return
            } catch (e: Exception) { /* 아래 길로 */ }
        }
        try { draw(Canvas(bmp)); done(bmp) } catch (e: Exception) { done(null) }
    }

    private fun plateView(bmp: Bitmap?): ImageView = ImageView(context).apply {
        scaleType = ImageView.ScaleType.FIT_XY
        setImageBitmap(bmp)
        setBackgroundColor(Color.WHITE)
        isClickable = false
    }
    private fun dimView(): View = View(context).apply { setBackgroundColor(Color.BLACK); alpha = 0f }

    // ── 들어가기 · 뒤로 가기(눌러서) ─────────────────────────────

    private var moving = false
    private var pending: (() -> Unit)? = null

    /**
     * **들어간다.** 지금 웹뷰를 찍어 뒤에 깔고, 웹뷰를 오른쪽 끝에서 제자리로
     * 민다. `native`면(목적지가 앱 화면) 찍어 두기만 한다 — 그 화면이 스스로
     * 밀려 들어온다(`NativeChatPlugin.open`).
     * `ms`가 0이면(탭으로 가는 길) 자리만 하나 더한다.
     */
    fun push(ms: Long, native: Boolean, done: () -> Unit) {
        if (ms <= 0 && !native) { pushPlate(null); done(); return }
        snap { bmp ->
            pushPlate(bmp)
            if (native || bmp == null || ms <= 40) { done(); return@snap }
            endMove()
            val w = width.toFloat()
            val plate = plateView(bmp); val dim = dimView()
            addView(plate, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            addView(dim, 1, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            web.translationX = w
            moving = true
            /* 웹이 사본을 걷을 틈을 준다 — 답을 받고 한 프레임 뒤에 걷는다. */
            done()
            val anim = ValueAnimator.ofFloat(0f, 1f).setDuration(ms)
            anim.interpolator = EASE
            anim.startDelay = 32
            anim.addUpdateListener { a ->
                val p = a.animatedValue as Float
                web.translationX = w * (1 - p)
                plate.translationX = -w * PARALLAX * p
                dim.alpha = DIM * p
            }
            val finish = {
                removeView(plate); removeView(dim); web.translationX = 0f; moving = false; pending = null
            }
            pending = finish
            anim.doOnEnd { if (pending === finish) finish() }
            anim.start()
            main.postDelayed({ if (pending === finish) finish() }, ms + 700)
        }
    }

    /**
     * **뒤로 간다.** 지금 웹뷰를 찍어 맨 위에 얹고 오른쪽으로 내보내며, 그 밑에서
     * 웹뷰가 1/4 자리에서 돌아온다. 뒤에 깔린 앞 화면(판)은 웹뷰가 곧 그 화면을
     * 그리므로 안 쓰고 버린다. `native`면(대화방에서 나오는 길) 판만 버린다 —
     * 그 화면은 스스로 빠져나간다(`NativeChatPlugin.close`).
     */
    fun pop(ms: Long, native: Boolean, done: () -> Unit) {
        popPlate()?.recycle()
        if (native || ms <= 40) { done(); return }
        snap { bmp ->
            if (bmp == null) { done(); return@snap }
            endMove()
            val w = width.toFloat()
            val exit = plateView(bmp); val dim = dimView()
            addView(dim, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            addView(exit, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            dim.alpha = DIM
            web.translationX = -w * PARALLAX
            moving = true
            done()
            val anim = ValueAnimator.ofFloat(0f, 1f).setDuration(ms)
            anim.interpolator = EASE
            anim.startDelay = 32
            anim.addUpdateListener { a ->
                val p = a.animatedValue as Float
                exit.translationX = w * p
                web.translationX = -w * PARALLAX * (1 - p)
                dim.alpha = DIM * (1 - p)
            }
            val finish = {
                removeView(exit); removeView(dim)
                bmp.recycle(); web.translationX = 0f; moving = false; pending = null
            }
            pending = finish
            anim.doOnEnd { if (pending === finish) finish() }
            anim.start()
            main.postDelayed({ if (pending === finish) finish() }, ms + 700)
        }
    }

    private fun endMove() { pending?.invoke(); pending = null; moving = false }

    private fun pushPlate(bmp: Bitmap?) {
        stack.add(bmp)
        while (stack.size > maxStack) stack.removeAt(0)?.recycle()
    }
    private fun popPlate(): Bitmap? = if (stack.isEmpty()) null else stack.removeAt(stack.size - 1)

    // ── 끌어서 뒤로 ───────────────────────────────────────────

    /** 끄는 동안의 자리(맨 위 떠남 · 그 밑 목적지 판 · 막). */
    private var drag: Drag? = null
    private class Drag(val w: Float, val exit: View, val under: View?, val dim: View, val page: View?, val plate: Bitmap?) {
        var dx = 0f
    }
    /** 끌어서 넘어간 뒤 웹이 목적지를 다 그리기를 기다리는 동안 남겨 둔 것. */
    private var settling: Drag? = null
    /** 앱(`NativeNavPlugin`)으로 보내는 신호 — `commit`·`cancel`. */
    var onBack: ((String) -> Unit)? = null

    /** 찍는 중이다(`beginDrag`가 답을 기다린다) — 그동안 온 손짓은 `dxNow`에 쌓아 둔다. */
    private var waking = false
    private var dxNow = 0f
    /** 찍는 동안 손을 뗐으면 그 답(넘어가는가)을 적어 두었다가 그림이 오면 마무리한다. */
    private var upWhileWaking: Boolean? = null

    private fun canDrag(): Boolean = !moving && !waking && drag == null && settling == null && (armed || topNative() != null)

    /**
     * 끌기를 시작한다. 지금 화면을 찍어 맨 위에 얹고(앱 화면이면 그 뷰를 그대로
     * 민다), 뒤에 깔린 앞 화면 판을 **웹뷰 위에** 깐다 — 웹뷰는 아직 이 화면을
     * 그리고 있어서 판이 위에 있어야 목적지가 보인다.
     *
     * **찍는 것은 비동기다**(`PixelCopy`). 그 한두 프레임 사이에 온 손짓은
     * `dxNow`로 받아 두고 그림이 오면 그 자리부터 그린다.
     */
    private fun beginDrag() {
        val page = topNative()
        val plate = stack.lastOrNull()
        if (page == null && plate == null) return
        waking = true; dxNow = 0f; upWhileWaking = null
        val start = { bmp: Bitmap? ->
            waking = false
            if (page == null && bmp == null) {
                upWhileWaking = null
            } else {
                val w = width.toFloat()
                val under = plateView(plate)
                val dim = dimView()
                val exit: View = page ?: plateView(bmp)
                val below = if (page != null) indexOfChild(page) else childCount
                addView(under, below, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
                addView(dim, below + 1, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
                if (page == null) addView(exit, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
                val d = Drag(w, exit, under, dim, page, plate)
                drag = d
                paint(d, dxNow)
                upWhileWaking?.let { go -> upWhileWaking = null; endDrag(go) }
            }
        }
        if (page != null) start(null) else snap(start)
    }

    private fun paint(d: Drag, dx: Float) {
        d.dx = dx
        val p = max(0f, min(1f, dx / d.w))
        d.exit.translationX = dx
        d.under?.translationX = (p - 1) * d.w * PARALLAX
        d.dim.alpha = DIM * (1 - p)
    }

    /** 손을 뗐다 — 넘어가거나 제자리로. */
    private fun endDrag(go: Boolean) {
        val d = drag ?: return
        drag = null
        val from = d.dx
        val to = if (go) d.w else 0f
        val anim = ValueAnimator.ofFloat(0f, 1f).setDuration(BACK_MS)
        anim.interpolator = EASE
        anim.addUpdateListener { a -> paint(d, from + (to - from) * (a.animatedValue as Float)) }
        anim.doOnEnd {
            if (go) {
                /* 넘어갔다 — 떠난 화면을 걷고, 목적지 판은 웹이 다 그릴 때까지
                   둔다(`rendered`). 앱 화면이면 이 층에서 뗀다 — 그러면
                   `NativeChatPlugin.close`가 곧바로 정리한다. */
                popPlate()
                if (d.page != null) removeView(d.page) else removeView(d.exit)
                settling = d
                onBack?.invoke("commit")
                main.postDelayed({ if (settling === d) rendered() }, 1500)
            } else {
                d.under?.let { removeView(it) }; removeView(d.dim)
                if (d.page == null) removeView(d.exit)
                onBack?.invoke("cancel")
            }
        }
        anim.start()
    }

    /** 웹이 목적지를 다 그렸다 — 깔아 둔 판을 걷는다. */
    fun rendered() {
        val d = settling ?: return
        settling = null
        d.under?.let { removeView(it) }; removeView(d.dim)
        d.plate?.recycle()
    }

    // ── 손짓 ─────────────────────────────────────────────────

    private var x0 = 0f; private var y0 = 0f; private var lastX = 0f; private var lastT = 0L
    private var vx = 0f
    private var cand = false; private var edge = false

    override fun requestDisallowInterceptTouchEvent(disallow: Boolean) {
        /* 웹뷰가 굴리기 시작하며 막아 달라고 해도 **가로로 그은 것은 우리가
           본다** — 안 그러면 조금만 세로로 흔들려도 뒤로 가기가 통째로 죽는다.
           세로가 큰 손짓은 우리가 스스로 넘긴다(`cand = false`). */
    }

    override fun onInterceptTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                cand = false
                if (drag != null || !canDrag()) return false
                x0 = e.x; y0 = e.y; lastX = e.x; lastT = e.eventTime; vx = 0f
                edge = e.x < EDGE_DP * resources.displayMetrics.density
                val page = topNative()
                val pageFree = (page as? NavPage)?.freeAt(e.x, e.y) ?: true
                if (page != null && !pageFree && !edge) return false
                cand = true
                return false
            }
            MotionEvent.ACTION_MOVE -> {
                if (!cand || drag != null || waking) return false
                val gx = e.x - x0; val gy = e.y - y0
                if (abs(gy) > abs(gx) && abs(gy) > WAKE * density()) { cand = false; return false }
                if (gx < WAKE * density() || gx < abs(gy) * SLOPE) return false
                /* 웹이 `taken`이라 했으면 넘긴다 — 가장자리에서 시작한 것은 예외다. */
                if (!free && !edge && topNative() == null) { cand = false; return false }
                cand = false
                if (!canDrag()) return false
                /* **여기서부터 우리 손짓이다** — 웹뷰는 `ACTION_CANCEL`을 받는다.
                   그림은 한두 프레임 뒤에 오므로 그때까지의 자리는 `dxNow`에 쌓인다. */
                beginDrag()
                return waking || drag != null
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { cand = false; return false }
        }
        return false
    }

    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (drag == null && !waking) return false
        when (e.actionMasked) {
            MotionEvent.ACTION_MOVE -> {
                val dt = e.eventTime - lastT
                if (dt > 0) vx = (e.x - lastX) / dt
                lastX = e.x; lastT = e.eventTime
                dxNow = max(0f, e.x - x0)
                drag?.let { paint(it, dxNow) }
                return true
            }
            MotionEvent.ACTION_UP -> {
                val still = e.eventTime - lastT > STALE
                val flick = !still && vx > FLICK * density() && dxNow > FLICK_MIN * density()
                val go = dxNow > width * TAKE || flick
                if (drag != null) endDrag(go) else upWhileWaking = go
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                if (drag != null) endDrag(false) else upWhileWaking = false
                return true
            }
        }
        return true
    }

    private fun density() = resources.displayMetrics.density

    // ── 안드로이드 뒤로(단추·예측형 손짓) ────────────────────────

    private var backGuard: OnBackPressedCallback? = null
    private fun installBack(activity: AppCompatActivity) {
        val guard = object : OnBackPressedCallback(false) {
            /* 예측형 손짓(안드로이드 14부터) — 손가락 대신 진행률이 온다. */
            override fun handleOnBackStarted(e: BackEventCompat) {
                if (!canDrag()) return
                beginDrag()
            }
            override fun handleOnBackProgressed(e: BackEventCompat) {
                dxNow = width * e.progress
                drag?.let { paint(it, dxNow) }
            }
            override fun handleOnBackPressed() {
                if (drag != null) { endDrag(true); return }
                if (waking) { upWhileWaking = true; return }
                /* 단추로 누른 뒤로(손짓이 없는 판) — 앱 화면이든 웹 화면이든
                   **곧바로 넘어간다**: 웹이 `뒤로`를 하고 여느 길(`pop`)로 민다. */
                onBack?.invoke("plain")
            }
            override fun handleOnBackCancelled() {
                if (drag != null) endDrag(false) else if (waking) upWhileWaking = false
            }
        }
        activity.onBackPressedDispatcher.addCallback(activity, guard)
        backGuard = guard
    }

    /** 앱 화면을 이 층에 얹는다 — 끌어서 뒤로가 되려면 여기 있어야 한다. */
    fun host(): ViewGroup = this
    fun refreshBack() { backGuard?.isEnabled = armed || topNative() != null }
}

private inline fun ValueAnimator.doOnEnd(crossinline run: () -> Unit) {
    addListener(object : android.animation.AnimatorListenerAdapter() {
        override fun onAnimationEnd(a: android.animation.Animator) { run() }
    })
}
