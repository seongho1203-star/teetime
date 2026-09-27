package com.kkakkung.app.chat

import android.app.Dialog
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import coil.load
import coil.network.HttpException
import kotlinx.coroutines.*

/** Screen-owned dialog: back/dismiss cancels work; no session token is saved in arguments. */
internal class ChatGalleryDialog(
    activity: AppCompatActivity,
    private val service: ChatService,
    private val room: String,
    private val openMedia: (String) -> Unit
) : Dialog(activity, com.kkakkung.app.R.style.ChatPhotoTheme) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val items = ArrayList<ChatMessage>()
    private val seen = HashSet<String>()
    private var cursor: ChatMessage? = null
    private var more = true
    private var loading = false
    private var failed = false
    private lateinit var status: TextView
    private lateinit var grid: RecyclerView
    private val adapter = MediaAdapter()
    private fun dp(n: Int) = (n * context.resources.displayMetrics.density).toInt()

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE)
        }
        val head = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        head.addView(TextView(context).apply {
            text = "닫기"; textSize = 15f; gravity = Gravity.CENTER
            setTextColor(Color.DKGRAY); setOnClickListener { dismiss() }
        }, LinearLayout.LayoutParams(dp(64), dp(52)))
        head.addView(TextView(context).apply {
            text = "사진·동영상"; textSize = 18f; setTextColor(Color.BLACK)
        })
        column.addView(head)
        grid = RecyclerView(context).apply {
            layoutManager = GridLayoutManager(context, 3)
            adapter = this@ChatGalleryDialog.adapter
            addOnScrollListener(object : RecyclerView.OnScrollListener() {
                override fun onScrolled(view: RecyclerView, dx: Int, dy: Int) {
                    val last = (view.layoutManager as GridLayoutManager).findLastVisibleItemPosition()
                    if (dy > 0 && last >= items.size - 6 && !failed) loadMore()
                }
            })
        }
        column.addView(grid, LinearLayout.LayoutParams(-1, 0, 1f))
        status = TextView(context).apply {
            gravity = Gravity.CENTER; textSize = 14f; setTextColor(Color.DKGRAY)
            setOnClickListener { loadMore() }
        }
        column.addView(status, LinearLayout.LayoutParams(-1, dp(52)))
        setContentView(column)
        window?.setLayout(-1, -1)
        loadMore()
    }

    override fun dismiss() {
        scope.cancel()
        super.dismiss()
    }

    private fun loadMore() {
        if (loading || !more || !scope.isActive) return
        loading = true; failed = false; status.text = "불러오는 중…"
        scope.launch {
            try {
                val page = service.recentMedia(room, 60, cursor)
                // Advance by the server page even when an unavailable image is removed locally.
                cursor = page.lastOrNull() ?: cursor
                more = page.size == 60
                val start = items.size
                items.addAll(page.filter { message ->
                    message.image?.startsWith("https://") == true && seen.add(message.id)
                })
                adapter.notifyItemRangeInserted(start, items.size - start)
                updateStatus()
            } catch (e: CancellationException) { throw e
            } catch (_: Exception) {
                failed = true; status.text = "불러오지 못했습니다 · 눌러서 다시 시도"
            } finally { loading = false }
        }
    }

    private fun updateStatus() {
        status.text = when {
            more -> "이전 사진·동영상 더 보기"
            items.isEmpty() -> "아직 올린 사진·동영상이 없습니다."
            else -> "모두 불러왔습니다"
        }
    }

    private inner class MediaHolder(val box: FrameLayout) : RecyclerView.ViewHolder(box) {
        val photo = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(0xFFE5E5E5.toInt())
        }
        val label = TextView(context).apply {
            gravity = Gravity.CENTER; setTextColor(Color.DKGRAY); textSize = 13f
        }
        var boundId: String? = null
        init { box.addView(photo, FrameLayout.LayoutParams(-1, -1)); box.addView(label, FrameLayout.LayoutParams(-1, -1)) }
    }

    private inner class MediaAdapter : RecyclerView.Adapter<MediaHolder>() {
        override fun getItemCount() = items.size
        override fun onCreateViewHolder(parent: ViewGroup, type: Int): MediaHolder {
            val box = object : FrameLayout(context) {
                override fun onMeasure(w: Int, h: Int) {
                    super.onMeasure(w, View.MeasureSpec.makeMeasureSpec(View.MeasureSpec.getSize(w), View.MeasureSpec.EXACTLY))
                }
            }.apply { setPadding(dp(1), dp(1), dp(1), dp(1)); layoutParams = RecyclerView.LayoutParams(-1, -2) }
            return MediaHolder(box)
        }
        override fun onBindViewHolder(holder: MediaHolder, position: Int) {
            val item = items[position]; val url = item.image ?: return
            holder.boundId = item.id
            holder.label.text = ""
            holder.box.contentDescription = if (ChatMedia.isVideo(url)) "동영상 열기" else "사진 열기"
            holder.box.setOnClickListener { openMedia(url) }
            if (ChatMedia.isVideo(url)) {
                holder.photo.load(null)
                holder.label.text = "▶\n동영상"
                return
            }
            holder.photo.load(url) {
                crossfade(false)
                listener(onError = { _, result ->
                    if (holder.boundId == item.id) {
                        val code = (result.throwable as? HttpException)?.response?.code
                        if (code == 400 || code == 404) {
                            grid.post {
                                val index = items.indexOfFirst { it.id == item.id }
                                if (index >= 0) { items.removeAt(index); notifyItemRemoved(index); if (!failed) updateStatus() }
                            }
                        } else {
                            holder.label.text = "다시 불러오기"
                            holder.box.setOnClickListener {
                                val index = items.indexOfFirst { it.id == item.id }
                                if (index >= 0) notifyItemChanged(index)
                            }
                        }
                    }
                })
            }
        }
        override fun onViewRecycled(holder: MediaHolder) {
            holder.boundId = null
            holder.photo.load(null)
            super.onViewRecycled(holder)
        }
    }
}
