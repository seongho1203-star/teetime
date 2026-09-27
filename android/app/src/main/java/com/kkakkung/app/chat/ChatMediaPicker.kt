package com.kkakkung.app.chat

import android.os.Bundle
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment

/** Activity가 이미 시작된 뒤에도 안전하게 결과를 받는, 화면 없는 선택기. */
class ChatMediaPicker : Fragment() {
    private val picker = registerForActivityResult(object : ActivityResultContracts.PickMultipleVisualMedia(10) {
        override fun createIntent(context: android.content.Context, input: PickVisualMediaRequest): android.content.Intent =
            super.createIntent(context, input).apply {
                if (action == "android.provider.action.PICK_IMAGES")
                    putExtra("android.provider.extra.PICK_IMAGES_IN_ORDER", true)
            }
    }) { uris ->
        parentFragmentManager.setFragmentResult(requireArguments().getString("result")!!,
            Bundle().apply { putStringArrayList("uris", ArrayList(uris.map { it.toString() })) })
        parentFragmentManager.beginTransaction().remove(this).commitAllowingStateLoss()
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
    }
}
