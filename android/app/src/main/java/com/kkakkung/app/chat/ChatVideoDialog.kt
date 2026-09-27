package com.kkakkung.app.chat

import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.MediaController
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.fragment.app.DialogFragment
import com.kkakkung.app.R

/** 사진과 같은 대화 위 전체화면. 재생 상태는 앱을 떠날 때 직접 보관한다. */
class ChatVideoDialog : DialogFragment() {
    companion object {
        private const val TAG = "chat-video"
        fun show(activity: AppCompatActivity, url: String) {
            val manager = activity.supportFragmentManager
            if (manager.isStateSaved || manager.findFragmentByTag(TAG) != null) return
            ChatVideoDialog().apply { arguments = Bundle().apply { putString("url", url) } }
                .showNow(manager, TAG)
        }
    }

    private lateinit var root: FrameLayout
    private lateinit var video: VideoView
    private lateinit var controls: MediaController
    private lateinit var progress: ProgressBar
    private lateinit var error: TextView
    private var position = 0
    private var playWhenReady = true
    private var prepared = false
    private var failed = false
    private var released = false

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        position = savedInstanceState?.getInt("position") ?: 0
        playWhenReady = savedInstanceState?.getBoolean("playing", true) ?: true
        val context = requireContext()
        root = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }
        video = VideoView(context).apply { contentDescription = "대화 동영상" }
        root.addView(video, FrameLayout.LayoutParams(-1, -1, Gravity.CENTER))
        controls = MediaController(context).apply { setAnchorView(root) }
        video.setMediaController(controls)
        progress = ProgressBar(context)
        root.addView(progress, FrameLayout.LayoutParams(dp(40), dp(40), Gravity.CENTER))
        error = TextView(context).apply {
            gravity = Gravity.CENTER; textSize = 15f; setTextColor(Color.WHITE)
            setPadding(dp(24), dp(24), dp(24), dp(24))
            visibility = View.GONE
            setOnClickListener { playWhenReady = true; loadVideo() }
        }
        root.addView(error, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        val close = ImageButton(context).apply {
            setImageResource(R.drawable.ic_chat_close)
            contentDescription = "동영상 닫기"
            background = ColorDrawable(Color.TRANSPARENT)
            setPadding(dp(12), dp(12), dp(12), dp(12))
            setOnClickListener { dismiss() }
        }
        root.addView(close, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.TOP or Gravity.END).apply {
            topMargin = dp(4); rightMargin = dp(8)
        })
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            root.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        video.setOnPreparedListener {
            if (released) return@setOnPreparedListener
            prepared = true; failed = false
            progress.visibility = View.GONE
            video.seekTo(position.coerceAtLeast(1))
            if (isResumed && playWhenReady) video.start()
            if (isResumed) controls.show(3000)
        }
        video.setOnInfoListener { _, what, _ ->
            if (!released && !failed) when (what) {
                MediaPlayer.MEDIA_INFO_BUFFERING_START -> progress.visibility = View.VISIBLE
                MediaPlayer.MEDIA_INFO_BUFFERING_END, MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START -> progress.visibility = View.GONE
            }
            false
        }
        video.setOnCompletionListener {
            position = 0; playWhenReady = false
            progress.visibility = View.GONE
            if (isResumed) controls.show(0)
        }
        video.setOnErrorListener { _, _, detail ->
            if (!released) {
                prepared = false; failed = true
                controls.hide(); progress.visibility = View.GONE
                error.text = if (detail == MediaPlayer.MEDIA_ERROR_UNSUPPORTED)
                    "이 기기에서 지원하지 않는 동영상 형식입니다.\n눌러서 다시 시도"
                else "동영상을 재생하지 못했습니다.\n연결을 확인하고 눌러서 다시 시도"
                error.visibility = View.VISIBLE
            }
            true // 기본 오류 창 대신 화면 안에 재시도를 남긴다.
        }
        loadVideo()
        return Dialog(context, R.style.ChatPhotoTheme).apply {
            setContentView(root)
            window?.apply {
                setBackgroundDrawable(ColorDrawable(Color.BLACK))
                clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            }
        }
    }

    private fun loadVideo() {
        prepared = false; failed = false; released = false
        controls.hide(); error.visibility = View.GONE; progress.visibility = View.VISIBLE
        video.stopPlayback()
        val uri = Uri.parse(requireArguments().getString("url"))
        video.setVideoURI(uri)
    }

    override fun onStart() {
        super.onStart()
        dialog?.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        ViewCompat.requestApplyInsets(root)
    }

    override fun onResume() {
        super.onResume()
        if (released && !failed) loadVideo()
        else if (prepared && playWhenReady) video.start()
    }

    override fun onPause() {
        if (prepared) {
            position = video.currentPosition.coerceAtLeast(0)
            playWhenReady = video.isPlaying
        }
        // 준비 중에도 목표 재생 상태를 PAUSED로 바꿔 배경에서 소리가 나지 않게 한다.
        video.pause()
        controls.hide()
        super.onPause()
    }

    override fun onStop() {
        // Surface가 없어졌다 다시 생겨도 위치/일시정지를 직접 복원한다.
        released = true; prepared = false
        video.stopPlayback()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (prepared && isResumed) {
            position = video.currentPosition.coerceAtLeast(0)
            playWhenReady = video.isPlaying
        }
        outState.putInt("position", position)
        outState.putBoolean("playing", playWhenReady)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroyView() {
        released = true
        controls.hide()
        video.setOnPreparedListener(null)
        video.setOnInfoListener(null)
        video.setOnCompletionListener(null)
        video.setOnErrorListener(null)
        video.stopPlayback()
        super.onDestroyView()
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value).toInt()
}
