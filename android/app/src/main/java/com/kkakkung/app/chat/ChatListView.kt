package com.kkakkung.app.chat

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.Spannable
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import coil.dispose
import coil.load
import coil.transform.RoundedCornersTransformation

/**
 * 색·크기 — 아이폰 `ChatSkin`(ChatList.swift)을 그대로 옮겼다.
 * **카톡을 픽셀로 재서 얻은 값이라 눈대중으로 고치지 말 것**(CLAUDE.md
 * `대화 화면의 크기`).
 */
object ChatSkin {
    const val bg = 0xFF7369A0.toInt()
    const val bubble = 0xFFF5F5F5.toInt()
    const val mineBubble = 0xFFFFDF47.toInt()
    const val mineEdge = 0xFFEDC82C.toInt()
    const val text = 0xFF1B1F19.toInt()
    val soft = Color.argb((255 * 0.77).toInt(), 255, 255, 255)     // 이름
    val faint = Color.argb((255 * 0.62).toInt(), 255, 255, 255)    // 시각
    val chip = Color.argb((255 * 0.16).toInt(), 255, 255, 255)     // 날짜·안내 줄 바탕
    val on = Color.argb((255 * 0.92).toInt(), 255, 255, 255)       // 그 위의 글자
    const val unread = 0xFFFFDF47.toInt()
    const val link = 0xFF5B8D18.toInt()
    const val card = Color.WHITE
    const val cardTint = 0xFFE9F3DA.toInt()
    const val cardBadge = 0xFF7CB828.toInt()
    const val cardRule = 0xFFDDE3D1.toInt()
    val quoteRule = Color.argb((255 * 0.10).toInt(), 0, 0, 0)
    const val brand = 0xFFE84A7F.toInt()
    const val head = 0xFFF6F8EF.toInt()     // 머리말 바탕(앱 바탕색 `--bg`)
    const val headText = 0xFF1B1F19.toInt()

    const val pad = 9f          // 목록 좌우 여백
    const val avatar = 29f
    const val avatarGap = 7f
    const val radius = 11f
    const val fontSize = 15f
    const val padH = 11f
    const val padV = 8.5f
    const val nameSize = 13.5f
    const val stampSize = 10f
    const val maxRatio = 0.684f
    const val photoW = 240f
    const val photoH = 300f
    const val photoRadius = 15f
    const val sticker = 118f
    const val bigSize = 40f
    const val quoteSize = 13f
    const val dateH = 22f
    const val dateSize = 13f
    const val cardW = 320f
    const val cardPad = 13f
    const val cardRadius = 16f
}

fun Context.dp(v: Float): Int = (v * resources.displayMetrics.density + 0.5f).toInt()

/** 카카오 프사는 `http://`로 온다 — 앱은 평문을 막으니 올려 받는다(웹 `httpsUrl`). */
fun httpsUrl(u: String?): String? = u?.let { if (it.startsWith("http://")) "https://" + it.substring(7) else it }

/**
 * 말풍선 목록 — 아이폰 `ChatList`의 몫.
 *
 * 한 줄은 `RowHolder` 하나로 그리고 종류(`kind`)에 따라 칸을 켜고 끈다.
 * 종류마다 홀더를 나누는 것보다 단순하고, 300줄까지는 값이 안 든다.
 */
class ChatListView(context: Context) : RecyclerView(context) {
    var onCard: ((String) -> Unit)? = null
    var onPhoto: ((String) -> Unit)? = null
    /** 사진 옆 동그란 공유 단추 — 주소를 넘긴다(아이폰 `BubbleCell.shareBtn` · `"share"`). */
    var onShare: ((String) -> Unit)? = null
    var onQuote: ((String) -> Unit)? = null
    var onReply: ((String) -> Unit)? = null
    var onPersonMessage: ((String) -> Unit)? = null
    var onHold: ((ChatRow, View) -> Unit)? = null
    var onTop: (() -> Unit)? = null
    var onBottom: ((Boolean) -> Unit)? = null
    internal var onScrollInfo: ((ChatScrollInfo) -> Unit)? = null

    var onUploadRetry: ((String) -> Unit)? = null
    var onUploadCancel: ((String) -> Unit)? = null
    private var uploads = emptyMap<String, ChatUploadState>()

    fun setUploads(states: Map<String, ChatUploadState>) {
        uploads = states
        // 바이트가 바뀔 때 사진이나 목록을 다시 그리지 않고 보이는 진행 표시만 바꾼다.
        for (i in 0 until childCount) (getChildViewHolder(getChildAt(i)) as? RowHolder)?.bindUpload()
    }

    private val rows = ArrayList<ChatRow>()
    private var findQuery = ""
    private val lm = LinearLayoutManager(context).apply { stackFromEnd = true }
    private val rowAdapter = RowAdapter()
    var atBottom = true
        private set
    private var pausedViewport: ChatViewport? = null
    private var pendingViewport: ChatViewport? = null
    val canMarkRead: Boolean
        get() = rows.isNotEmpty() && isAttachedToWindow && pendingViewport == null &&
            !isLayoutRequested && !isComputingLayout && atBottom && !canScrollVertically(1)
    private val reportViewport = Runnable {
        if (isAttachedToWindow && pendingViewport == null && !isLayoutRequested && !isComputingLayout) {
            atBottom = !canScrollVertically(1)
            onBottom?.invoke(atBottom)
            reportScrollInfo(false)
        }
    }

    init {
        setBackgroundColor(ChatSkin.bg)
        layoutManager = lm
        setAdapter(rowAdapter)
        itemAnimator = null
        clipToPadding = false
        overScrollMode = View.OVER_SCROLL_NEVER
        /* 말풍선을 왼쪽으로 밀어 댓글 — 아이폰 `ChatList.swiped`와 같은 값이다:
           **72dp까지만 따라오고**(swipeMax) 55dp를 넘기고 놓으면 댓글이 걸린다(swipeAt).
           ItemTouchHelper의 '밀어서 지우기'를 그대로 쓰면 손을 따라 화면 밖까지
           끝없이 밀려 나갔다(사용자 제보 — `왼쪽으로 하염없이 밀려`). 그래서
           밀기가 끝나는 일은 아예 없게 두고(문턱·튕김 무한대) 놓는 순간 판단한다. */
        ItemTouchHelper(object : ItemTouchHelper.SimpleCallback(0, ItemTouchHelper.LEFT) {
            private val swipeAt = context.dp(55f).toFloat()
            private val swipeMax = context.dp(72f).toFloat()
            private var hitId: String? = null
            override fun onMove(rv: RecyclerView, a: ViewHolder, b: ViewHolder) = false
            override fun getSwipeDirs(rv: RecyclerView, holder: ViewHolder): Int {
                val row = rows.getOrNull(holder.bindingAdapterPosition) ?: return 0
                return if (row.id.startsWith("tmp:") || row.kind in setOf("system", "card", "hidden")) 0
                else super.getSwipeDirs(rv, holder)
            }
            override fun getSwipeThreshold(viewHolder: ViewHolder) = Float.MAX_VALUE
            override fun getSwipeEscapeVelocity(defaultValue: Float) = Float.MAX_VALUE
            override fun onSwiped(viewHolder: ViewHolder, direction: Int) {
                val pos = viewHolder.bindingAdapterPosition
                if (pos >= 0) rowAdapter.notifyItemChanged(pos)
            }
            override fun onChildDraw(c: android.graphics.Canvas, rv: RecyclerView, holder: ViewHolder,
                                     dX: Float, dY: Float, actionState: Int, isCurrentlyActive: Boolean) {
                val x = dX.coerceIn(-swipeMax, 0f)
                if (isCurrentlyActive) {
                    hitId = if (x <= -swipeAt) rows.getOrNull(holder.bindingAdapterPosition)?.id else null
                }
                super.onChildDraw(c, rv, holder, x, dY, actionState, isCurrentlyActive)
            }
            override fun clearView(rv: RecyclerView, holder: ViewHolder) {
                super.clearView(rv, holder)
                val id = hitId ?: return
                hitId = null
                onReply?.invoke(id)
            }
        }).attachToRecyclerView(this)

        addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(rv: RecyclerView, dx: Int, dy: Int) {
                if (pendingViewport == null && !isComputingLayout && !isLayoutRequested) {
                    val bottom = !rv.canScrollVertically(1)
                    if (bottom != atBottom) { atBottom = bottom; onBottom?.invoke(bottom) }
                }
                if (pendingViewport == null) reportScrollInfo(dy != 0 && scrollState != SCROLL_STATE_IDLE)
                if (dy < 0 && lm.findFirstVisibleItemPosition() <= 1) onTop?.invoke()
            }
        })
    }

    fun refreshScrollInfo() {
        removeCallbacks(reportViewport)
        post(reportViewport)
    }

    private fun reportScrollInfo(moved: Boolean) {
        val first = lm.findFirstVisibleItemPosition().coerceAtMost(rows.lastIndex)
        var date: String? = null
        if (first >= 0) for (index in first downTo 0) {
            if (rows[index].date != null) { date = rows[index].date; break }
        }
        onScrollInfo?.invoke(ChatScrollInfo(date, computeVerticalScrollOffset(),
            computeVerticalScrollRange(), computeVerticalScrollExtent(), moved,
            canScrollVertically(-1) || canScrollVertically(1), canScrollVertically(1)))
    }

    fun setFindQuery(query: String) {
        findQuery = query
        rowAdapter.notifyDataSetChanged()
    }

    val rowCount: Int get() = rows.size

    /** Preserve the pending session anchor even if a sync arrives before the first layout. */
    fun submit(next: List<ChatRow>, keepBottom: Boolean) {
        val anchor = pendingViewport ?: if (!keepBottom) captureViewport(false) else null
        rows.clear(); rows.addAll(next)
        rowAdapter.notifyDataSetChanged()
        if (anchor != null) restore(anchor)
        else if (keepBottom) scrollToBottom(false)
    }

    private fun captureViewport(followBottom: Boolean): ChatViewport? {
        val first = lm.findFirstVisibleItemPosition()
        if (first < 0 || first >= rows.size) return null
        val last = lm.findLastVisibleItemPosition().coerceAtMost(rows.lastIndex)
        val anchors = (first..last).mapNotNull { index ->
            lm.findViewByPosition(index)?.let { rows[index].id to (lm.getDecoratedTop(it) - paddingTop) }
        }
        return ChatViewport(followBottom && atBottom, anchors, first)
    }

    fun pauseSession() {
        stopScroll()
        if (pausedViewport == null) pausedViewport = pendingViewport ?: captureViewport(true)
    }

    fun resumeSession() {
        val saved = pausedViewport ?: return
        pausedViewport = null
        pendingViewport = saved
        atBottom = false
        restore(saved)
    }

    private fun restore(spot: ChatViewport) {
        if (spot.bottom) { scrollToBottom(false); return }
        val target = spot.resolve(rows.map { it.id }) ?: return
        lm.scrollToPositionWithOffset(target.first, target.second)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        pendingViewport = null
        removeCallbacks(reportViewport)
        post(reportViewport)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(reportViewport)
        super.onDetachedFromWindow()
    }

    fun scrollToBottom(animated: Boolean) {
        if (rows.isEmpty()) return
        if (animated) smoothScrollToPosition(rows.size - 1) else lm.scrollToPositionWithOffset(rows.size - 1, 0)
        removeCallbacks(reportViewport)
        post(reportViewport)
    }

    fun scrollTo(id: String) {
        val i = rows.indexOfFirst { it.id == id }
        if (i >= 0) {
            atBottom = false
            lm.scrollToPositionWithOffset(i, context.dp(40f))
        }
    }

    private inner class RowAdapter : RecyclerView.Adapter<RowHolder>() {
        override fun getItemCount() = rows.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = RowHolder(parent.context)
        override fun onBindViewHolder(holder: RowHolder, position: Int) {
            val w = if (width > 0) width else context.resources.displayMetrics.widthPixels
            holder.bind(rows[position], w)
        }
        override fun onViewRecycled(holder: RowHolder) {
            holder.releaseMedia()
            super.onViewRecycled(holder)
        }
    }

    private inner class RowHolder(ctx: Context) : RecyclerView.ViewHolder(LinearLayout(ctx)) {
        private val root = itemView as LinearLayout
        private val dateChip = chip(ctx)
        private val markChip = chip(ctx)
        private val noticeChip = chip(ctx)
        private val card = ChatLinkCard(ctx)
        private val msgRow = LinearLayout(ctx)
        private val avatarBox = FrameLayout(ctx)
        private val avatar = ImageView(ctx)
        private val initials = TextView(ctx)
        private val column = LinearLayout(ctx)
        private val name = TextView(ctx)
        private val contentRow = LinearLayout(ctx)
        private val content = LinearLayout(ctx)
        private val picture = ImageView(ctx)
        private val mediaBox = FrameLayout(ctx)
        private val uploadBox = LinearLayout(ctx)
        private val uploadRing = android.widget.ProgressBar(ctx)
        private val uploadLabel = TextView(ctx)
        private val uploadCancel = TextView(ctx)
        private val uploadRetry = TextView(ctx)
        private val videoMark = TextView(ctx)
        private val bubble = LinearLayout(ctx)
        private val quoteWho = TextView(ctx)
        private val quoteText = TextView(ctx)
        /* 가르는 선은 **제 폭을 안 우긴다** — 보통 View는 `AT_MOST`에서 받은 폭을
           통째로 가져가 말풍선이 화면 끝까지 퍼졌다(사용자 제보 · 사진 —
           `채팅에서 댓글이 너무커`). 말풍선이 폭을 정한 뒤 늘여 줄 때(EXACTLY)만 그 폭이다. */
        private val quoteRule = object : View(ctx) {
            override fun onMeasure(w: Int, h: Int) {
                val width = if (MeasureSpec.getMode(w) == MeasureSpec.EXACTLY) MeasureSpec.getSize(w) else 0
                setMeasuredDimension(width, MeasureSpec.getSize(h))
            }
        }
        private val body = TextView(ctx)
        private val reacts = TextView(ctx)
        private val stamp = LinearLayout(ctx)
        private val unread = TextView(ctx)
        private val time = TextView(ctx)
        /* 사진 옆 **동그란 공유 단추**(사용자 요청 — 카톡 사진을 받아 맞췄다).
           아이폰 `BubbleCell.shareBtn`과 같은 값이다 — 지름 30 · 사진에서 16 ·
           사진 세로 가운데 · 보라 위 흰색 40% · 먹색 그림. **한쪽만 고치지 말 것.**
           도장(시각·안 읽은 수)과 한 칸(`side`)에 들어 있어 같은 쪽에 선다 —
           도장은 바닥에, 단추는 사진 가운데에(`placeShare`). */
        private val shareBtn = ImageView(ctx)
        private val side = object : FrameLayout(ctx) {
            override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
                super.onLayout(changed, l, t, r, b)
                placeShare()
            }
        }
        private var current: ChatRow? = null

        /** 단추를 사진 세로 가운데로 — 도장 위로는 안 내려간다(낮은 사진에서 겹치지 않게). */
        private fun placeShare() {
            if (shareBtn.visibility != View.VISIBLE) return
            val ctx = itemView.context
            val photoTop = content.top + mediaBox.top - side.top
            val center = photoTop + mediaBox.height / 2f
            var y = center - shareBtn.height / 2f
            val stampTop = if (stamp.height > 0) stamp.top.toFloat() else side.height.toFloat()
            y = minOf(y, stampTop - ctx.dp(4f) - shareBtn.height)
            y = maxOf(y, photoTop.toFloat())
            shareBtn.translationY = y - shareBtn.top
        }

        init {
            root.orientation = LinearLayout.VERTICAL
            root.layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
            val pad = ctx.dp(ChatSkin.pad)
            root.setPadding(pad, 0, pad, 0)
            root.addView(dateChip, centerChip(ctx))
            root.addView(markChip, centerChip(ctx))
            root.addView(noticeChip, centerChip(ctx))

            /* 눌리는 카드(라운드·투표·공지) — 아이폰 `cardBox`와 같은 짜임(`ChatLinkCard`). */
            card.setOnClickListener { current?.to?.let { onCard?.invoke(it) } }
            root.addView(card, LinearLayout.LayoutParams(ctx.dp(ChatSkin.cardW), LinearLayout.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = ctx.dp(4f); bottomMargin = ctx.dp(6f) })

            /* 말풍선 줄 — [얼굴][이름 / 내용·도장] */
            msgRow.orientation = LinearLayout.HORIZONTAL
            val av = ctx.dp(ChatSkin.avatar)
            avatarBox.layoutParams = LinearLayout.LayoutParams(av, av)
            avatar.scaleType = ImageView.ScaleType.CENTER_CROP
            avatarBox.addView(avatar, FrameLayout.LayoutParams(av, av))
            initials.gravity = Gravity.CENTER; initials.textSize = 10f; initials.typeface = Typeface.DEFAULT_BOLD; initials.setTextColor(Color.WHITE)
            /* 아이폰 `AvatarView` — 보라 위에 흰 25% 칠 · 흰 글자(마지막 두 글자). */
            initials.background = GradientDrawable().apply { cornerRadius = ctx.dp(10f).toFloat(); setColor(Color.argb(64, 255, 255, 255)) }
            avatarBox.addView(initials, FrameLayout.LayoutParams(av, av))
            avatarBox.setOnClickListener { current?.id?.let { onPersonMessage?.invoke(it) } }
            msgRow.addView(avatarBox)

            column.orientation = LinearLayout.VERTICAL
            name.setTextColor(ChatSkin.soft); name.textSize = ChatSkin.nameSize
            column.addView(name, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = ctx.dp(2f) })
            contentRow.orientation = LinearLayout.HORIZONTAL
            contentRow.gravity = Gravity.BOTTOM
            content.orientation = LinearLayout.VERTICAL
            picture.scaleType = ImageView.ScaleType.FIT_CENTER
            picture.adjustViewBounds = true
            picture.setOnClickListener { current?.image?.let { if (current?.kind == "photo" && current?.id?.startsWith("tmp:") != true) onPhoto?.invoke(it) } }
            mediaBox.addView(picture, FrameLayout.LayoutParams(-2, -2))
            uploadBox.orientation = LinearLayout.VERTICAL; uploadBox.gravity = Gravity.CENTER
            uploadBox.setBackgroundColor(0xAA000000.toInt())
            uploadBox.addView(uploadRing, LinearLayout.LayoutParams(ctx.dp(28f), ctx.dp(28f)))
            uploadLabel.setTextColor(Color.WHITE); uploadLabel.textSize = 12f; uploadLabel.gravity = Gravity.CENTER
            uploadLabel.setPadding(ctx.dp(4f), ctx.dp(4f), ctx.dp(4f), 0)
            uploadBox.addView(uploadLabel)
            uploadRetry.text = "다시 시도"; uploadCancel.text = "취소"
            for (button in listOf(uploadRetry, uploadCancel)) {
                button.setTextColor(Color.WHITE); button.gravity = Gravity.CENTER; button.textSize = 13f
                uploadBox.addView(button, LinearLayout.LayoutParams(-1, ctx.dp(44f)))
            }
            uploadRetry.setOnClickListener { current?.id?.let { onUploadRetry?.invoke(it) } }
            uploadCancel.setOnClickListener { current?.id?.let { onUploadCancel?.invoke(it) } }
            mediaBox.addView(uploadBox, FrameLayout.LayoutParams(-1, -1))
            content.addView(mediaBox)
            videoMark.text = "▶ 동영상"; videoMark.setTextColor(ChatSkin.on); videoMark.textSize = 13f
            videoMark.gravity = Gravity.CENTER
            content.addView(videoMark)
            bubble.orientation = LinearLayout.VERTICAL
            val ph = ctx.dp(ChatSkin.padH); val pv = ctx.dp(ChatSkin.padV)
            bubble.setPadding(ph, pv, ph, pv)
            /* 인용은 아이폰(`ChatList.layoutQuote`) 값 그대로 — 한 줄 18 · 머리말 semibold 66% ·
               원문 55% · 선 1 · 선 아래 6. 글꼴 여백을 빼야 두 줄이 18씩 붙는다. */
            quoteWho.textSize = ChatSkin.quoteSize; quoteWho.typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            quoteWho.setTextColor((ChatSkin.text and 0xFFFFFF) or (168 shl 24))
            quoteText.textSize = ChatSkin.quoteSize; quoteText.setTextColor((ChatSkin.text and 0xFFFFFF) or (140 shl 24))
            for (q in listOf(quoteWho, quoteText)) {
                q.maxLines = 1; q.ellipsize = android.text.TextUtils.TruncateAt.END
                q.includeFontPadding = false; q.gravity = Gravity.CENTER_VERTICAL
            }
            quoteRule.setBackgroundColor(ChatSkin.quoteRule)
            body.textSize = ChatSkin.fontSize; body.setTextColor(ChatSkin.text)
            body.setLineSpacing(0f, 1.2f)
            bubble.addView(quoteWho, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, ctx.dp(18f)))
            bubble.addView(quoteText, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, ctx.dp(18f)))
            bubble.addView(quoteRule, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, ctx.dp(1f)).apply { bottomMargin = ctx.dp(6f) })
            bubble.addView(body)
            bubble.setOnClickListener { current?.quoteTo?.let { onQuote?.invoke(it) } }
            bubble.setOnLongClickListener {
                current?.let { r -> onHold?.invoke(r, bubble) }
                true
            }
            picture.setOnLongClickListener {
                current?.let { r -> onHold?.invoke(r, picture) }
                true
            }
            noticeChip.setOnLongClickListener {
                current?.takeIf { it.kind == "hidden" }?.let { r -> onHold?.invoke(r, noticeChip) }
                true
            }
            content.addView(bubble)
            reacts.textSize = 12f; reacts.setTextColor(ChatSkin.text)
            reacts.setPadding(ctx.dp(8f), ctx.dp(4f), ctx.dp(8f), ctx.dp(4f))
            reacts.background = GradientDrawable().apply { cornerRadius = ctx.dp(15f).toFloat(); setColor(Color.WHITE) }
            content.addView(reacts, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = ctx.dp(4f) })

            stamp.orientation = LinearLayout.VERTICAL
            unread.setTextColor(ChatSkin.unread); unread.textSize = ChatSkin.stampSize
            time.setTextColor(ChatSkin.faint); time.textSize = ChatSkin.stampSize
            stamp.addView(unread); stamp.addView(time)
            val sp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            sp.leftMargin = ctx.dp(4f); sp.rightMargin = ctx.dp(4f)
            shareBtn.setImageResource(com.kkakkung.app.R.drawable.ic_chat_share)
            shareBtn.scaleType = ImageView.ScaleType.CENTER_INSIDE
            val sharePad = ctx.dp(7f)
            shareBtn.setPadding(sharePad, sharePad, sharePad, sharePad)
            shareBtn.background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; setColor(Color.argb(102, 255, 255, 255))
            }
            shareBtn.contentDescription = "공유"
            shareBtn.visibility = View.GONE
            shareBtn.setOnClickListener {
                val r = current ?: return@setOnClickListener
                if (r.kind == "photo" && !r.id.startsWith("tmp:")) r.image?.let { onShare?.invoke(it) }
            }
            side.addView(stamp, FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.START))
            side.addView(shareBtn, FrameLayout.LayoutParams(ctx.dp(30f), ctx.dp(30f), Gravity.TOP or Gravity.START))
            contentRow.addView(content)
            contentRow.addView(side, sp)
            column.addView(contentRow)
            msgRow.addView(column, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            root.addView(msgRow, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }

        private fun chip(ctx: Context): TextView = TextView(ctx).apply {
            setTextColor(ChatSkin.on); textSize = ChatSkin.dateSize
            gravity = Gravity.CENTER
            setPadding(ctx.dp(10f), 0, ctx.dp(10f), 0)
            minHeight = ctx.dp(ChatSkin.dateH)
            background = GradientDrawable().apply { cornerRadius = ctx.dp(11f).toFloat(); setColor(ChatSkin.chip) }
        }

        private fun centerChip(ctx: Context) = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.CENTER_HORIZONTAL; topMargin = ctx.dp(8f); bottomMargin = ctx.dp(4f)
        }

        fun bindUpload() {
            val state = uploads[current?.id]
            uploadBox.visibility = if (state != null) View.VISIBLE else View.GONE
            if (state == null) return
            uploadRing.visibility = if (state.failed) View.GONE else View.VISIBLE
            uploadLabel.text = if (!state.failed && state.total > 0) state.label + "\n" +
                String.format(java.util.Locale.KOREA, "%.2f / %.2fMB", state.sent / 1048576.0, state.total / 1048576.0)
                else state.label
            uploadRetry.visibility = if (state.failed) View.VISIBLE else View.GONE
            uploadCancel.visibility = if (state.cancellable) View.VISIBLE else View.GONE
        }

        fun releaseMedia() {
            picture.dispose(); picture.setImageDrawable(null)
            avatar.dispose(); avatar.setImageDrawable(null)
        }

        fun bind(r: ChatRow, listWidth: Int) {
            current = r
            mediaBox.visibility = if (r.kind == "photo" || r.kind == "sticker") View.VISIBLE else View.GONE
            bindUpload()
            val ctx = itemView.context
            root.setPadding(root.paddingLeft, ctx.dp(r.top.toFloat()), root.paddingRight, 0)
            dateChip.visibility = if (r.date != null) View.VISIBLE else View.GONE
            dateChip.text = r.date ?: ""
            markChip.visibility = if (r.mark) View.VISIBLE else View.GONE
            markChip.text = "여기까지 읽으셨습니다"

            val notice = r.kind == "system" || r.kind == "hidden"
            noticeChip.visibility = if (notice) View.VISIBLE else View.GONE
            noticeChip.text = r.body
            noticeChip.maxWidth = listWidth - ctx.dp(40f)

            val isCard = r.kind == "card"
            card.visibility = if (isCard) View.VISIBLE else View.GONE
            if (isCard) {
                card.bind(r.body, r.icon, r.go ?: "보러 가기 ›")
                (card.layoutParams as LinearLayout.LayoutParams).width = minOf(ctx.dp(ChatSkin.cardW), listWidth - ctx.dp(ChatSkin.pad * 4))
            }

            val isMsg = !notice && !isCard
            msgRow.visibility = if (isMsg) View.VISIBLE else View.GONE
            if (!isMsg) { releaseMedia(); return }

            /* 얼굴·이름 — 묶음의 첫 줄에만, 남의 글에만. */
            val showFace = !r.mine
            avatarBox.visibility = if (showFace) View.VISIBLE else View.GONE
            (avatarBox.layoutParams as LinearLayout.LayoutParams).rightMargin = if (showFace) ctx.dp(ChatSkin.avatarGap) else 0
            if (showFace) {
                if (r.name != null) {
                    avatarBox.alpha = 1f
                    val edge = r.edge
                    avatarBox.background = if (edge != null) GradientDrawable().apply {
                        cornerRadius = ctx.dp(12f).toFloat(); setColor(Color.TRANSPARENT); setStroke(ctx.dp(2f), edge)
                    } else null
                    val nm = r.name.substringAfter('/').substringBefore('/')
                    initials.text = if (nm.length >= 2) nm.takeLast(2) else nm
                    val url = httpsUrl(r.avatar)
                    if (url != null) {
                        initials.visibility = View.VISIBLE
                        avatar.visibility = View.VISIBLE
                        avatar.load(url) {
                            crossfade(false)
                            transformations(RoundedCornersTransformation(ctx.dp(10f).toFloat()))
                            listener(onSuccess = { _, _ -> initials.visibility = View.GONE },
                                     onError = { _, _ -> avatar.visibility = View.GONE })
                        }
                    } else {
                        avatar.visibility = View.GONE; initials.visibility = View.VISIBLE
                    }
                } else {
                    /* 묶음의 둘째 줄부터 — 자리만 비워 둔다. */
                    avatarBox.alpha = 0f; avatarBox.background = null
                }
            }
            name.visibility = if (r.name != null) View.VISIBLE else View.GONE
            name.text = r.name ?: ""

            /* 내 글은 오른쪽, 도장은 말풍선 안쪽(가운데 쪽)에 선다. */
            msgRow.gravity = if (r.mine) Gravity.END else Gravity.START
            column.gravity = if (r.mine) Gravity.END else Gravity.START
            /* contentRow는 줄 폭을 다 쓰므로(세로 LinearLayout의 기본 MATCH_PARENT)
               **여기서 오른쪽으로 밀어야** 내 글이 오른쪽에 선다. column의 gravity만
               주면 내 글까지 왼쪽에 붙었다(사용자 제보 — `전부 좌측이야`). */
            contentRow.gravity = Gravity.BOTTOM or (if (r.mine) Gravity.END else Gravity.START)
            contentRow.removeAllViews()
            val sp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.MATCH_PARENT)
            sp.leftMargin = ctx.dp(4f); sp.rightMargin = ctx.dp(4f)
            if (r.mine) { contentRow.addView(side, sp); contentRow.addView(content) }
            else { contentRow.addView(content); contentRow.addView(side, sp) }
            stamp.gravity = if (r.mine) Gravity.END else Gravity.START
            val edge = if (r.mine) Gravity.END else Gravity.START
            (stamp.layoutParams as FrameLayout.LayoutParams).gravity = Gravity.BOTTOM or edge
            /* 사진에서 16 — `side`가 이미 4를 띄우므로 단추는 12만 더 띄운다. */
            (shareBtn.layoutParams as FrameLayout.LayoutParams).apply {
                gravity = Gravity.TOP or edge
                marginStart = if (r.mine) 0 else ctx.dp(12f)
                marginEnd = if (r.mine) ctx.dp(12f) else 0
            }
            shareBtn.visibility = if (r.kind == "photo" && !r.id.startsWith("tmp:") &&
                !uploads.containsKey(r.id) && !r.image.isNullOrBlank()) View.VISIBLE else View.GONE
            shareBtn.translationY = 0f
            side.requestLayout()
            unread.text = if (r.unread > 0) r.unread.toString() else ""
            unread.visibility = if (r.unread > 0) View.VISIBLE else View.GONE
            time.text = r.time ?: ""
            time.visibility = if (r.time != null) View.VISIBLE else View.GONE

            val maxW = (listWidth * ChatSkin.maxRatio).toInt()
            /* 그림 — 사진은 240×300 안, 이모티콘은 118 정사각. */
            when (r.kind) {
                "photo" -> {
                    picture.visibility = View.VISIBLE
                    picture.maxWidth = ctx.dp(ChatSkin.photoW); picture.maxHeight = ctx.dp(ChatSkin.photoH)
                    picture.minimumWidth = ctx.dp(120f); picture.minimumHeight = ctx.dp(if (uploads.containsKey(r.id)) 220f else 120f)
                    picture.setBackgroundColor(0x33000000)
                    videoMark.visibility = if (r.video) View.VISIBLE else View.GONE
                    picture.load(httpsUrl(r.image)) {
                        chatVideoFrame(r.video)
                        size(ctx.dp(ChatSkin.photoW), ctx.dp(ChatSkin.photoH))
                        crossfade(false)
                        transformations(RoundedCornersTransformation(ctx.dp(ChatSkin.photoRadius).toFloat()))
                    }
                }
                "sticker" -> {
                    picture.visibility = View.VISIBLE
                    val s = ctx.dp(ChatSkin.sticker)
                    picture.maxWidth = s; picture.maxHeight = s
                    picture.minimumWidth = s; picture.minimumHeight = s
                    picture.setBackgroundColor(Color.TRANSPARENT)
                    videoMark.visibility = View.GONE
                    picture.load(r.image) { crossfade(false) }
                }
                else -> { picture.dispose(); picture.setImageDrawable(null); picture.visibility = View.GONE; videoMark.visibility = View.GONE }
            }

            /* 말풍선 — 글, 또는 그림 밑에 붙는 한 줄(`cap`). 이모지만 보낸 글은 벗긴다. */
            val text = if (r.kind == "text") r.body else (r.cap ?: "")
            val showBubble = text.isNotEmpty() || r.quoteTo != null
            bubble.visibility = if (showBubble) View.VISIBLE else View.GONE
            if (showBubble) {
                val big = r.big && r.kind == "text"
                if (r.mentions.isEmpty()) {
                    body.text = text
                } else {
                    val painted = SpannableString(text)
                    r.mentions.forEach { hit ->
                        if (hit.start >= 0 && hit.end <= painted.length && hit.start < hit.end) {
                            painted.setSpan(
                                ForegroundColorSpan(if (hit.mine) 0xFFD92B8E.toInt() else 0xFF2C7BD4.toInt()),
                                hit.start, hit.end, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
                            )
                        }
                    }
                    body.text = painted
                }
                if (findQuery.length >= 2 && text.isNotEmpty()) {
                    val base = if (body.text is android.text.Spanned)
                        android.text.SpannableString(body.text) else SpannableString(text)
                    var from = 0
                    while (from < text.length) {
                        val at = text.indexOf(findQuery, from, ignoreCase = true)
                        if (at < 0) break
                        base.setSpan(ForegroundColorSpan(0xFF2C7BD4.toInt()), at, at + findQuery.length,
                            Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                        from = at + findQuery.length
                    }
                    body.text = base
                }
                body.textSize = if (big) ChatSkin.bigSize else ChatSkin.fontSize
                body.maxWidth = maxW
                body.setTextColor(ChatSkin.text)
                (bubble.layoutParams as? LinearLayout.LayoutParams)?.topMargin = if (r.kind == "text") 0 else ctx.dp(4f)
                val ph = ctx.dp(ChatSkin.padH); val pv = ctx.dp(ChatSkin.padV)
                if (big) { bubble.background = null; bubble.setPadding(0, 0, 0, 0) }
                else {
                    bubble.setPadding(ph, pv, ph, pv)
                    bubble.background = GradientDrawable().apply {
                        cornerRadius = ctx.dp(ChatSkin.radius).toFloat()
                        setColor(if (r.mine) ChatSkin.mineBubble else ChatSkin.bubble)
                        if (r.mine) setStroke(ctx.dp(1f), ChatSkin.mineEdge)
                    }
                }
                val hasQuote = r.quoteTo != null
                quoteWho.visibility = if (hasQuote) View.VISIBLE else View.GONE
                quoteText.visibility = if (hasQuote) View.VISIBLE else View.GONE
                quoteRule.visibility = if (hasQuote) View.VISIBLE else View.GONE
                quoteWho.text = r.quoteWho ?: ""; quoteText.text = r.quoteText ?: ""
                quoteText.maxWidth = maxW; quoteWho.maxWidth = maxW
            }

            /* 반응 — `😄 2` 알약 한 줄(먼저 달린 차례 그대로). */
            if (r.reacts.isNotEmpty()) {
                reacts.visibility = View.VISIBLE
                reacts.text = r.reacts.joinToString("  ") { "${it.emoji} ${it.n}" }
            } else reacts.visibility = View.GONE
            content.gravity = if (r.mine) Gravity.END else Gravity.START
        }
    }
}
