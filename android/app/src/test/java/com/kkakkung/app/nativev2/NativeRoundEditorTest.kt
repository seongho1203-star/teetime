package com.kkakkung.app.nativev2

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NativeRoundEditorTest {
    private fun children(view: View): List<View> = listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { children(view.getChildAt(it)) } else emptyList()
    @Test fun changingOnlyFeeInActualEditorKeepsExistingFieldData() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val base = JSONObject("""{"id":"round","kind":"field","course":"목록 밖 필드","capacity":4,"fee":100000,"caddie":"none","cart":"included","lat":37.12,"lon":127.34,"tee_at":"2026-09-30T07:00:00+09:00"}""")
        var saved: JSONObject? = null
        val form = NativeRoundEditor(activity, base, false) { row, _ -> saved = row }
        activity.setContentView(form)
        val fee = children(form).filterIsInstance<EditText>().first { it.contentDescription == "1인 비용" }
        assertEquals("100,000", fee.text.toString())
        fee.setText("120000")
        assertEquals("120,000", fee.text.toString())
        children(form).filterIsInstance<Button>().first { it.text == "수정 저장" }.performClick()
        assertEquals(120000, saved!!.getInt("fee"))
        for (key in listOf("caddie", "cart", "lat", "lon")) assertEquals(base.get(key), saved!!.get(key))
        val catalogue = JSONArray(activity.assets.open("courses.json").bufferedReader().use { it.readText() })
        assertTrue(catalogue.length() >= 574)
        activity.finish()
    }
}
