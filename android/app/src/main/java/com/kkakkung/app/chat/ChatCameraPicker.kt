package com.kkakkung.app.chat

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.fragment.app.Fragment
import java.io.File

/**
 * `+` → `사진 찍기`/`동영상 찍기` — 아이폰 `composerTapped`의 카메라 줄 자리(사용자 제보 —
 * `아이폰은 채팅에서 파일버튼누르면 촬영이있는데 안드로이드는 사진보관함뿐이야`).
 *
 * 찍은 것은 앱 캐시(`chat-camera/`)에 받고, 보관함에서 고른 것과 **같은 결과 열쇠**로
 * uri 하나를 돌려준다 — 올리는 길은 `sendSelectedMedia` 그대로다(두 벌로 만들지 말 것).
 *
 * **카메라 권한을 매니페스트에 넣지 말 것** — 안 넣으면 `ACTION_IMAGE_CAPTURE`는 권한 없이
 * 되지만, 넣는 순간 런타임 허락을 받아야 해서 허락 전에는 카메라가 아예 안 열린다.
 * 안드로이드 카메라 앱은 한 번에 사진·동영상을 오갈 수 없어(아이폰과 다르다) 줄을 둘로 둔다.
 */
class ChatCameraPicker : Fragment() {
    private var out: Uri? = null
    private val taker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val uri = out ?: savedUri
        val file = uri?.lastPathSegment?.let { File(dir(), it) }
        val ok = r.resultCode == android.app.Activity.RESULT_OK && file != null && file.exists() && file.length() > 0
        parentFragmentManager.setFragmentResult(requireArguments().getString("result")!!,
            Bundle().apply { putStringArrayList("uris", if (ok) arrayListOf(uri.toString()) else arrayListOf()) })
        parentFragmentManager.beginTransaction().remove(this).commitAllowingStateLoss()
    }
    private var savedUri: Uri? = null

    private fun dir() = File(requireContext().cacheDir, "chat-camera").apply { mkdirs() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        savedUri = savedInstanceState?.getString("out")?.let(Uri::parse)
        if (savedInstanceState != null) return
        val video = requireArguments().getBoolean("video")
        /* 지난번에 찍어 두고 못 올린 것까지 쌓이지 않게 비운다. */
        dir().listFiles()?.forEach { it.delete() }
        val file = File(dir(), "cam-${System.currentTimeMillis()}.${if (video) "mp4" else "jpg"}")
        val uri = FileProvider.getUriForFile(requireContext(), requireContext().packageName + ".fileprovider", file)
        out = uri
        val intent = Intent(if (video) MediaStore.ACTION_VIDEO_CAPTURE else MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { taker.launch(intent) } catch (_: Exception) {
            parentFragmentManager.setFragmentResult(requireArguments().getString("result")!!,
                Bundle().apply { putStringArrayList("uris", arrayListOf()); putBoolean("noCamera", true) })
            parentFragmentManager.beginTransaction().remove(this).commitAllowingStateLoss()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        (out ?: savedUri)?.let { outState.putString("out", it.toString()) }
    }
}
