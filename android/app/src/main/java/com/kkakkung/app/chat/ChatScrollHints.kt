package com.kkakkung.app.chat

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import com.kkakkung.app.R

internal data class ChatScrollInfo(val date: String?, val offset: Int, val range: Int, val extent: Int, val moved: Boolean, val scrollable: Boolean, val canScrollDown: Boolean)

/** Non-intercepting overlay: only the 48dp latest-message target handles touches. */
internal class ChatScrollHints(context: Context, onLatest: () -> Unit) : FrameLayout(context) {
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private val datePill = TextView(context).apply {
        textSize = 13f; typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setTextColor(Color.WHITE); gravity = Gravity.CENTER
        setPadding(dp(8), 0, dp(8), 0)
        includeFontPadding = false
        background = GradientDrawable().apply { cornerRadius = dp(11).toFloat(); setColor(0x66000000) }
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        visibility = View.GONE
    }
    private val jump = FrameLayout(context).apply {
        contentDescription = "최근 대화로"
        isFocusable = true; isClickable = true
        visibility = View.GONE
        setOnClickListener { onLatest() }
        addView(ImageView(context).apply {
            setImageResource(R.drawable.ic_chat_latest)
            scaleType = ImageView.ScaleType.CENTER
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) }
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LayoutParams(dp(38), dp(38), Gravity.CENTER))
    }
    private val hideDate = Runnable {
        datePill.animate().alpha(0f).setDuration(250).withEndAction { datePill.visibility = View.GONE }.start()
    }

    init {
        isClickable = false
        addView(datePill, LayoutParams(LayoutParams.WRAP_CONTENT, dp(22), Gravity.TOP or Gravity.END).apply { rightMargin = dp(4) })
        // 38dp 동그라미는 목록 아래 가운데, 바닥에서 8dp 위다(아이폰 `JumpBar`와 같은 자리).
        // 오른쪽 끝으로 되돌리지 말 것 — 사용자 요청: `우측 끝에있으니까 잘 안보여`.
        addView(jump, LayoutParams(dp(48), dp(48), Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = dp(3)
        })
    }

    fun update(info: ChatScrollInfo) {
        val travel = (info.range - info.extent).coerceAtLeast(0)
        jump.visibility = if (info.canScrollDown && travel - info.offset > dp(240)) View.VISIBLE else View.GONE
        if (!info.scrollable || travel <= 0 || info.date.isNullOrBlank()) { hideDateNow(); return }
        if (!info.moved && datePill.visibility != View.VISIBLE) return
        if (datePill.text.toString() != info.date) datePill.text = info.date
        val viewport = height.toFloat()
        val thumbHeight = maxOf(dp(40).toFloat(), viewport * info.extent / info.range.coerceAtLeast(1)).coerceAtMost(viewport)
        val fraction = (info.offset.toFloat() / travel).coerceIn(0f, 1f)
        val pillHeight = dp(22).toFloat()
        val maxWidth = (width - dp(40)).coerceAtLeast(dp(56))
        if (datePill.maxWidth != maxWidth) datePill.maxWidth = maxWidth
        datePill.translationY = ((viewport - thumbHeight) * fraction + (thumbHeight - pillHeight) / 2f)
            .coerceIn(0f, (viewport - pillHeight).coerceAtLeast(0f))
        if (info.moved) {
            removeCallbacks(hideDate)
            datePill.animate().cancel()
            datePill.alpha = 1f; datePill.visibility = View.VISIBLE
            postDelayed(hideDate, 1_200)
        }
    }

    private fun hideDateNow() {
        removeCallbacks(hideDate)
        datePill.animate().cancel()
        datePill.visibility = View.GONE
    }

    fun reset() {
        hideDateNow()
        jump.visibility = View.GONE
    }

    override fun onDetachedFromWindow() {
        reset()
        super.onDetachedFromWindow()
    }
}
