package com.kkakkung.app.chat

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ViewConfiguration
import android.widget.FrameLayout
import kotlin.math.abs

/** Keep buttons tappable, but take over a vertical drag anywhere on the profile. */
internal class ChatProfileDragView(context: Context, private val close: () -> Unit) : FrameLayout(context) {
    val sheet = FrameLayout(context)
    private val density = resources.displayMetrics.density
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var startOffset = 0f
    private var dragging = false
    private var blocked = false
    private var velocity: VelocityTracker? = null
    private var returning: ValueAnimator? = null

    init {
        isClickable = true
        setBackgroundColor(Color.BLACK)
        addView(sheet, LayoutParams(-1, -1))
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
            returning?.cancel(); returning = null
            velocity?.recycle(); velocity = VelocityTracker.obtain()
            downX = event.x; downY = event.y
            startOffset = sheet.translationY
            dragging = false; blocked = false
        }
        velocity?.addMovement(event)
        if (event.actionMasked == MotionEvent.ACTION_POINTER_DOWN) {
            blocked = true
            restore()
        }
        val handled = super.dispatchTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
            // A tap during the return animation must also finish returning to rest.
            if (!dragging && sheet.translationY != 0f) restore()
            velocity?.recycle(); velocity = null
            dragging = false
        }
        return handled
    }

    override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        if (blocked) return dragging
        if (event.actionMasked == MotionEvent.ACTION_MOVE) {
            val dy = event.y - downY
            if (abs(dy) > slop && abs(dy) > abs(event.x - downX)) dragging = true
        }
        return dragging
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_MOVE -> if (!blocked) {
                val dy = event.y - downY
                if (abs(dy) > slop && abs(dy) > abs(event.x - downX)) dragging = true
                if (dragging) {
                    val raw = (if (startOffset < 0f) startOffset * 3f else startOffset) + dy
                    moveSheet(if (raw >= 0f) raw else raw / 3f)
                }
            }
            MotionEvent.ACTION_UP -> {
                velocity?.computeCurrentVelocity(1000)
                val distance = sheet.translationY
                val speed = velocity?.yVelocity ?: 0f
                if (!blocked && dragging && (distance > 120f * density ||
                    (distance > 40f * density && speed > 900f * density))) close()
                else restore()
            }
            MotionEvent.ACTION_CANCEL -> restore()
        }
        return true
    }

    private fun moveSheet(y: Float) {
        sheet.translationY = y
        val fraction = (y / height.coerceAtLeast(1)).coerceIn(0f, 1f)
        setBackgroundColor(Color.argb((255 * (1f - fraction)).toInt(), 0, 0, 0))
    }

    private fun restore() {
        returning?.cancel()
        returning = ValueAnimator.ofFloat(sheet.translationY, 0f).apply {
            duration = 200
            addUpdateListener { moveSheet(it.animatedValue as Float) }
            start()
        }
    }

    override fun onDetachedFromWindow() {
        returning?.cancel(); returning = null
        velocity?.recycle(); velocity = null
        super.onDetachedFromWindow()
    }
}
