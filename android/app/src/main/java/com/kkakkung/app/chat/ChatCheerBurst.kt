package com.kkakkung.app.chat

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.SystemClock
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * **축하 폭죽** — 아이폰 `CheerBurst`(ChatCheer.swift)를 옮긴 것이다.
 * 다섯 번(0.28초 간격) 화면 위쪽 절반에서 터지고, 조각은 1.5초 동안 떨어지며 사라진다.
 *
 *  - **캔버스 한 장이다** — 조각마다 뷰를 만들면 수백 개가 들어앉아 느린 폰이 주저앉는다.
 *  - **아무것도 안 가로막는다**(터치를 받지 않는다) — 도는 동안에도 대화가 눌린다.
 *  - **걷는 일을 그리기에만 매달지 않는다** — 타이머 하나(`postDelayed`)로 끝낸다.
 *  - 색은 여섯(웹 `Fireworks.tsx`의 `COLORS`와 같다). 움직임을 줄여 둔 폰은 한 번만.
 */
class ChatCheerBurst private constructor(context: Context) : View(context) {
    companion object {
        private const val BURSTS = 5
        private const val GAP = 280L
        private const val LIFE = 1500L
        val colors = intArrayOf(0xFFFF4E8A.toInt(), 0xFFFFD23F.toInt(), 0xFF4AD66D.toInt(), 0xFF6C5CE7.toInt(), 0xFFFF9F1C.toInt(), Color.WHITE)

        fun fire(host: ViewGroup) {
            val v = ChatCheerBurst(host.context)
            v.isClickable = false; v.isFocusable = false
            v.elevation = 100f
            host.addView(v, ViewGroup.LayoutParams(-1, -1))
            v.start()
        }
    }

    private class Bit(var x: Float, var y: Float, val vx: Float, val vy: Float, val r: Float, val color: Int, val born: Long)
    private val bits = ArrayList<Bit>()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val density = resources.displayMetrics.density

    override fun onTouchEvent(event: android.view.MotionEvent?) = false

    private fun start() {
        val reduce = try { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f } catch (_: Exception) { false }
        val count = if (reduce) 1 else BURSTS
        for (i in 0 until count) postDelayed({ boom() }, i * GAP)
        postDelayed({ (parent as? ViewGroup)?.removeView(this) }, (count - 1) * GAP + LIFE + 400)
    }

    private fun boom() {
        if (width == 0 || height == 0) return
        val x = width * Random.nextDouble(.18, .82).toFloat()
        val y = height * Random.nextDouble(.16, .50).toFloat()
        val main = colors.random()
        val now = SystemClock.uptimeMillis()
        repeat(90 + 26) { i ->
            val a = Random.nextDouble(0.0, Math.PI * 2)
            val speed = (210 + Random.nextDouble(-110.0, 110.0)).toFloat() * density
            bits.add(Bit(x, y, (cos(a) * speed).toFloat(), (sin(a) * speed).toFloat(),
                (2.2f + Random.nextFloat() * 2f) * density, if (i < 90) main else colors.random(), now))
        }
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val now = SystemClock.uptimeMillis()
        bits.removeAll { now - it.born > LIFE }
        for (b in bits) {
            val t = (now - b.born) / 1000f
            val px = b.x + b.vx * t
            val py = b.y + b.vy * t + .5f * 220 * density * t * t   // 중력
            paint.color = b.color
            paint.alpha = (255 * (1 - t * 1000 / LIFE)).toInt().coerceIn(0, 255)
            canvas.drawCircle(px, py, b.r * (1 - t * .1f), paint)
        }
        if (bits.isNotEmpty()) postInvalidateOnAnimation()
    }
}
