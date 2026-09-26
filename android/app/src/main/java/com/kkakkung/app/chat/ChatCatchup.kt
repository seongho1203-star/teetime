package com.kkakkung.app.chat

import android.content.Context

/**
 * docs/안드로이드-따라잡기.md 단계별 시험 스위치.
 *
 * 완성되지 않은 2절 기능을 기본 대화에 섞지 않는다. 각 단계가 폰에서
 * 확인되면 다음 단계가 이 스위치 뒤에 붙는다.
 */
object ChatCatchup {
    private const val PREF = "kk_android_catchup"
    private const val STAGE2 = "chat_stage2"

    fun stage2(context: Context): Boolean =
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).getBoolean(STAGE2, false)

    fun setStage2(context: Context, on: Boolean) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putBoolean(STAGE2, on).apply()
    }
}
