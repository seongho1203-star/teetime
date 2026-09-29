package com.kkakkung.app.nativev2

import android.content.Context
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewGroup
import android.view.ViewConfiguration
import android.view.animation.PathInterpolator
import android.widget.*
import androidx.recyclerview.widget.RecyclerView
import kotlin.math.abs

/** Retain actual screens (including scroll positions/drafts), never recreate on pop. */
internal class NativeScreenStack(context: Context) : FrameLayout(context) {
    companion object {
        internal fun completesTab(progress: Float, along: Float) = along > 800f || (progress > .34f && along > -800f)
    }
    data class Screen(val key: String, val view: View, val refresh: (() -> Unit)?)
    private val screens = mutableListOf<Screen>()
    val current: Screen? get() = screens.lastOrNull()
    val canPop get() = screens.size > 1
    fun contains(key: String) = screens.any { it.key == key }
    var changed: (() -> Unit)? = null
    var rootMotion: ((Float, Boolean) -> Unit)? = null
    var tabNeighbor: ((Int) -> Screen?)? = null
    var tabSelected: ((String) -> Unit)? = null
    /**
     * 화면이 밀리는 만큼 알린다 — `front`가 `t`(0~1)만큼 보인다. 껍데기가 이 값으로
     * 바닥 띠(내비게이션 바) 색을 섞는다: 대화방만 보라라, 한 번에 바꾸면 밀려 들어오기
     * 시작하는 순간 바닥만 툭 바뀌었다(사용자 제보). 움직임이 끝나면 `changed`가 제자리를 맞춘다.
     */
    var motion: ((front: Screen, back: Screen?, t: Float) -> Unit)? = null
    private fun tell(front: Screen, back: Screen?) {
        val w = width.coerceAtLeast(1).toFloat()
        motion?.invoke(front, back, (1f - abs(front.view.translationX) / w).coerceIn(0f, 1f))
    }
    /**
     * 탭 사이를 미는 동안 **탭바는 제자리에 둔다**(아이폰과 같다 · 사용자 요청 — `탭바까지도
     * 이동해서 불편해`). 탭바는 탭 화면 안(`view.tag`)에 붙어 있으므로, 끄는 동안만 이 층으로
     * 옮겨 맨 위에 얹었다가 남는 화면에 도로 붙인다. **같은 탭바 하나를 옮기는 것이라 뱃지가
     * 안 사라진다** — 예전에는 옆 탭을 미리 그리며 새 탭바를 만들어 숫자가 없다가 다시 떴다.
     */
    private var floatingBar: View? = null
    private fun liftBar(from: View) {
        val bar = from.tag as? View ?: return
        if (bar.parent !== from) return
        val h = bar.layoutParams?.height ?: return
        (from as ViewGroup).removeView(bar)
        addView(bar, LayoutParams(-1, h, android.view.Gravity.BOTTOM))
        bar.bringToFront()
        floatingBar = bar
    }
    private fun dropBar(into: View) {
        val bar = floatingBar ?: return
        floatingBar = null
        val h = (bar.layoutParams as? LayoutParams)?.height ?: -2
        removeView(bar)
        if (into is FrameLayout) {
            into.addView(bar, LayoutParams(-1, h, android.view.Gravity.BOTTOM))
            into.tag = bar
        }
    }
    private var busy = false
    private var dragging = false
    val transitioning get() = busy || dragging
    private var rejected = false
    private var startX = 0f
    private var startY = 0f
    private var velocity: VelocityTracker? = null
    private var preview: Screen? = null
    private var direction = 0
    private val density = resources.displayMetrics.density
    private var refreshAfterPop = false
    fun invalidatePrevious() { refreshAfterPop = true }
    private fun animationsEnabled() = android.os.Build.VERSION.SDK_INT < 26 || android.animation.ValueAnimator.areAnimatorsEnabled()
    private val ease = PathInterpolator(.32f, .72f, 0f, 1f)
    private fun attach(screen: Screen) {
        (screen.view.parent as? ViewGroup)?.removeView(screen.view)
        addView(screen.view, LayoutParams(-1, -1))
        screen.view.visibility = View.VISIBLE
    }
    private fun scrollView(view: View): View? {
        if (view is ScrollView) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) scrollView(view.getChildAt(i))?.let { return it }
        return null
    }
    fun show(key: String, view: View, root: Boolean, refresh: (() -> Unit)? = null, replace: Boolean = false) {
        if (busy || dragging) return
        val entry = Screen(key, view, refresh)
        val old = current
        if (root || old == null || old.key == key || replace) {
            if (root) screens.clear() else if (old != null) screens.removeAt(screens.lastIndex)
            val oldY = if (old?.key == key) scrollView(old.view)?.scrollY ?: old.view.scrollY else 0
            removeAllViews(); screens.add(entry); attach(entry)
            view.post { (scrollView(view) ?: view).scrollTo(0, oldY) }; changed?.invoke(); return
        }
        screens.add(entry); attach(entry)
        busy = true
        view.translationX = width.toFloat()
        val duration = if (animationsEnabled()) 500L else 0L
        old.view.animate().translationX(-width * .25f).setDuration(duration).setInterpolator(ease).setUpdateListener(null).start()
        rootMotion?.invoke(-width * .25f, screens.size == 2)
        view.animate().translationX(0f).setDuration(duration).setInterpolator(ease)
            .setUpdateListener { tell(entry, old) }.withEndAction {
            view.animate().setUpdateListener(null)
            tell(entry, old)
            removeView(old.view); old.view.translationX = 0f
            busy = false; changed?.invoke()
        }.start()
    }
    fun pop(): Boolean {
        if (!canPop) return false
        if (busy || dragging) return true
        val behind = screens[screens.lastIndex - 1]
        attach(behind); current!!.view.bringToFront()
        behind.view.translationX = -width * .25f
        settlePop(true)
        return true
    }
    private fun settlePop(go: Boolean, gesture: Boolean = false) {
        val front = current ?: return
        val behind = screens[screens.lastIndex - 1]
        busy = true
        val duration = if (!animationsEnabled()) 0L else if (gesture) 230L else 500L
        behind.view.animate().translationX(if (go) 0f else -width * .25f).setDuration(duration).setInterpolator(ease).setUpdateListener(null).start()
        rootMotion?.invoke(if (go) 0f else -width * .25f, screens.size == 2)
        front.view.animate().translationX(if (go) width.toFloat() else 0f).setDuration(duration).setInterpolator(ease)
            .setUpdateListener { tell(front, behind) }.withEndAction {
            front.view.animate().setUpdateListener(null)
            tell(front, behind)
            if (go) { removeView(front.view); screens.removeAt(screens.lastIndex) }
            else removeView(behind.view)
            front.view.translationX = 0f; behind.view.translationX = 0f
            busy = false; dragging = false; changed?.invoke()
            if (go && refreshAfterPop) { refreshAfterPop = false; behind.refresh?.invoke() }
        }.start()
    }
    private fun protected(view: View, x: Float, y: Float): Boolean {
        if (view.visibility != View.VISIBLE || x < 0 || y < 0 || x >= view.width || y >= view.height) return false
        if (view is EditText || view is Spinner || view is RadioGroup || view is CompoundButton || view is AbsSeekBar || view.tag == "swipe-excluded" ||
            view is HorizontalScrollView || view.canScrollHorizontally(-1) || view.canScrollHorizontally(1)) return true
        if (view is ViewGroup) for (i in view.childCount - 1 downTo 0) {
            val c = view.getChildAt(i)
            if (protected(c, x + view.scrollX - c.x, y + view.scrollY - c.y)) return true
        }
        return false
    }
    private fun stopScroll(view: View) {
        if (view is RecyclerView) view.stopScroll()
        if (view is ScrollView) view.fling(0)
        if (view is ViewGroup) for (i in 0 until view.childCount) stopScroll(view.getChildAt(i))
    }
    override fun onInterceptTouchEvent(e: MotionEvent): Boolean {
        if (busy) return true
        if (e.actionMasked == MotionEvent.ACTION_DOWN) {
            startX = e.x; startY = e.y; dragging = false; preview = null
            rejected = current?.let { protected(it.view, e.x, e.y) } ?: true
            velocity?.recycle(); velocity = VelocityTracker.obtain(); velocity?.addMovement(e)
        }
        if (e.actionMasked == MotionEvent.ACTION_MOVE && !rejected) {
            val dx = e.x - startX; val dy = e.y - startY
            val slop = ViewConfiguration.get(context).scaledTouchSlop
            if (abs(dy) > slop && abs(dy) >= abs(dx)) rejected = true
            if (abs(dx) > slop && abs(dx) > abs(dy) * 1.2f) {
                if (canPop && dx > 0) {
                    val behind = screens[screens.lastIndex - 1]
                    behind.view.translationX = if (animationsEnabled()) -width * .25f else 0f
                    attach(behind); current!!.view.bringToFront()
                } else if (!canPop) {
                    direction = if (dx < 0) 1 else -1
                    preview = tabNeighbor?.invoke(direction)
                    if (preview == null) { rejected = true; return false }
                    preview!!.view.translationX = direction * width.toFloat()
                    attach(preview!!); current!!.view.bringToFront()
                    liftBar(current!!.view)
                } else { rejected = true; return false }
                dragging = true; stopScroll(current!!.view)
                parent?.requestDisallowInterceptTouchEvent(true)
                return true // ViewGroup sends CANCEL to the scrolling child.
            }
        }
        return dragging
    }
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (busy) return true
        if (!dragging) return false
        velocity?.addMovement(e)
        val dx = e.x - startX
        val front = current ?: return false
        if (e.actionMasked == MotionEvent.ACTION_MOVE) {
            if (!animationsEnabled()) return true
            if (canPop) {
                val x = dx.coerceIn(0f, width.toFloat())
                front.view.translationX = x
                screens[screens.lastIndex-1].view.translationX = (x-width)*.25f
                rootMotion?.invoke((x-width)*.25f, screens.size == 2)
                tell(front, screens[screens.lastIndex-1])
            } else {
                val x = if (direction > 0) dx.coerceIn(-width.toFloat(), 0f) else dx.coerceIn(0f, width.toFloat())
                front.view.translationX = x
                preview?.view?.translationX = x + direction * width
            }
        }
        if (e.actionMasked == MotionEvent.ACTION_UP || e.actionMasked == MotionEvent.ACTION_CANCEL) {
            velocity?.computeCurrentVelocity(1000)
            val vx = (velocity?.xVelocity ?: 0f) / density
            val cancelled = e.actionMasked == MotionEvent.ACTION_CANCEL
            if (canPop) settlePop(!cancelled && (dx > width*.34f || vx > 800f), gesture = true)
            else {
                val next = preview ?: return true
                val along = -direction * vx
                val progress = -direction * dx / width.coerceAtLeast(1)
                val go = !cancelled && completesTab(progress, along)
                busy = true
                val duration = if (animationsEnabled()) 300L else 0L
                front.view.animate().translationX(if (go) -direction*width.toFloat() else 0f).setDuration(duration).setInterpolator(ease).setUpdateListener(null).start()
                next.view.animate().translationX(if (go) 0f else direction*width.toFloat()).setDuration(duration).setInterpolator(ease).setUpdateListener(null).withEndAction {
                    dropBar(if (go) next.view else front.view)
                    if (go) { removeView(front.view); screens.clear(); screens.add(next); tabSelected?.invoke(next.key) }
                    else removeView(next.view)
                    front.view.translationX = 0f; next.view.translationX = 0f
                    preview = null; busy = false; dragging = false; changed?.invoke()
                }.start()
            }
            velocity?.recycle(); velocity = null
        }
        return true
    }
}
