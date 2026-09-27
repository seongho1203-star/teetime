package com.kkakkung.app.nativev2

import android.app.Activity
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@LooperMode(LooperMode.Mode.PAUSED)
class NativeScreenStackTest {
    private fun fixture(): Pair<Activity, NativeScreenStack> {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val stack = NativeScreenStack(activity)
        activity.setContentView(stack)
        stack.measure(View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY))
        stack.layout(0, 0, 400, 800)
        return activity to stack
    }
    private fun settle() { shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(2)) }
    private fun event(action: Int, x: Float, y: Float = 200f, time: Long = 1000) = MotionEvent.obtain(1000, time, action, x, y, 0)
    @Test fun alertsRoundBackRestoresTheSameScreenAndDraft() {
        val (activity, stack) = fixture()
        stack.show("/", FrameLayout(activity), true)
        val alerts = EditText(activity).apply { setText("보관한 초안") }
        stack.show("/alerts", alerts, false); settle()
        stack.show("/rounds/id", FrameLayout(activity), false); settle()
        assertTrue(stack.pop())
        assertEquals(500L, stack.current!!.view.animate().duration)
        settle()
        assertEquals("/alerts", stack.current?.key)
        assertSame(alerts, stack.current?.view)
        assertEquals("보관한 초안", alerts.text.toString())
        assertEquals(0f, alerts.translationX, .001f)
        activity.finish()
    }
    @Test fun cancelledSwipeRetainsTopThenNextSwipePops() {
        val (activity, stack) = fixture()
        val home = FrameLayout(activity); val detail = FrameLayout(activity)
        stack.show("/", home, true); stack.show("/rounds/id", detail, false); settle()
        stack.onInterceptTouchEvent(event(MotionEvent.ACTION_DOWN, 10f))
        assertTrue(stack.onInterceptTouchEvent(event(MotionEvent.ACTION_MOVE, 90f)))
        stack.onTouchEvent(event(MotionEvent.ACTION_MOVE, 90f))
        assertEquals(80f, detail.translationX, .001f)
        stack.onTouchEvent(event(MotionEvent.ACTION_CANCEL, 90f))
        assertEquals(230L, detail.animate().duration)
        settle()
        assertSame(detail, stack.current?.view); assertEquals(0f, detail.translationX, .001f)
        stack.onInterceptTouchEvent(event(MotionEvent.ACTION_DOWN, 10f))
        assertTrue(stack.onInterceptTouchEvent(event(MotionEvent.ACTION_MOVE, 220f)))
        stack.onTouchEvent(event(MotionEvent.ACTION_MOVE, 220f))
        stack.onTouchEvent(event(MotionEvent.ACTION_UP, 220f, time = 2000)); settle()
        assertSame(home, stack.current?.view); assertFalse(stack.canPop)
        activity.finish()
    }
    @Test fun editingFieldDoesNotStartTabSwipe() {
        val (activity, stack) = fixture()
        var requested = false
        val edit = EditText(activity)
        stack.show("/", edit, true); settle()
        edit.layout(0, 0, 400, 800)
        stack.tabNeighbor = { requested = true; NativeScreenStack.Screen("/board", FrameLayout(activity), null) }
        stack.onInterceptTouchEvent(event(MotionEvent.ACTION_DOWN, 300f))
        assertFalse(stack.onInterceptTouchEvent(event(MotionEvent.ACTION_MOVE, 100f)))
        assertFalse(requested)
        activity.finish()
    }

    @Test fun tabSwipeFollowsFingerAndCancelledPreviewDoesNotChangeSelection() {
        val (activity, stack) = fixture()
        val home = FrameLayout(activity)
        val board = FrameLayout(activity)
        var selected: String? = null
        stack.show("/", home, true); settle()
        stack.tabNeighbor = { if (it == 1) NativeScreenStack.Screen("/board", board, null) else null }
        stack.tabSelected = { selected = it }
        val width = stack.width.toFloat()
        fun begin() {
            stack.onInterceptTouchEvent(event(MotionEvent.ACTION_DOWN, width * .9f))
            assertTrue(stack.onInterceptTouchEvent(event(MotionEvent.ACTION_MOVE, width * .7f)))
            assertEquals(width, board.translationX, .001f)
            stack.onTouchEvent(event(MotionEvent.ACTION_MOVE, width * .7f))
            assertEquals(-width * .2f, home.translationX, .01f)
            assertEquals(width * .8f, board.translationX, .01f)
        }
        begin()
        stack.onTouchEvent(event(MotionEvent.ACTION_CANCEL, width * .7f))
        assertEquals(300L, board.animate().duration)
        settle()
        assertSame(home, stack.current?.view); assertNull(selected)
        assertNull(board.parent)
        begin()
        stack.onTouchEvent(event(MotionEvent.ACTION_MOVE, width * .3f))
        stack.onTouchEvent(event(MotionEvent.ACTION_UP, width * .3f, time = 2000)); settle()
        assertSame(board, stack.current?.view); assertEquals("/board", selected)
        assertNull(home.parent); assertEquals(0f, board.translationX, .001f)
        activity.finish()
    }

    @Test fun reverseFlingCancelsTabEvenBeyondDistanceThreshold() {
        assertFalse(NativeScreenStack.completesTab(.8f, -801f))
        assertFalse(NativeScreenStack.completesTab(.8f, -800f))
        assertTrue(NativeScreenStack.completesTab(.35f, -799f))
        assertFalse(NativeScreenStack.completesTab(.34f, 0f))
        assertTrue(NativeScreenStack.completesTab(.1f, 801f))
    }
}
