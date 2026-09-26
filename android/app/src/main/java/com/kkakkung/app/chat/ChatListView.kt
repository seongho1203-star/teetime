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
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
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
    var onQuote: ((String) -> Unit)? = null
    var onTop: (() -> Unit)? = null
    var onBottom: ((Boolean) -> Unit)? = null

    private val rows = ArrayList<ChatRow>()
    private val lm = LinearLayoutManager(context).apply { stackFromEnd = true }
    private val rowAdapter = RowAdapter()
    var atBottom = true
        private set

    init {
        setBackgroundColor(ChatSkin.bg)
        layoutManager = lm
        setAdapter(rowAdapter)
        itemAnimator = null
        clipToPadding = false
        overScrollMode = View.OVER_SCROLL_NEVER
        addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(rv: RecyclerView, dx: Int, dy: Int) {
                val bottom = !rv.canScrollVertically(1)
                if (bottom != atBottom) { atBottom = bottom; onBottom?.invoke(bottom) }
                if (dy < 0 && lm.findFirstVisibleItemPosition() <= 1) onTop?.invoke()
            }
        })
    }

    val rowCount: Int get() = rows.size

    /** 줄을 통째로 갈아 끼운다. 맨 아래를 보고 있었으면 그대로 붙인다. */
    fun submit(next: List<ChatRow>, keepBottom: Boolean) {
        val anchor = if (!keepBottom) anchorSpot() else null
        rows.clear(); rows.addAll(next)
        rowAdapter.notifyDataSetChanged()
        if (keepBottom) scrollToBottom(false)
        else if (anchor != null) restore(anchor)
    }

    private class Spot(val id: String, val offset: Int)

    /** 화면 맨 위에 걸린 줄과 그 줄이 위로 지나간 만큼 — 위에 줄을 더 붙여도 같은 자리다. */
    private fun anchorSpot(): Spot? {
        val i = lm.findFirstVisibleItemPosition()
        if (i < 0 || i >= rows.size) return null
        val v = lm.findViewByPosition(i) ?: return null
        return Spot(rows[i].id, v.top)
    }

    private fun restore(spot: Spot) {
        val i = rows.indexOfFirst { it.id == spot.id }
        if (i >= 0) lm.scrollToPositionWithOffset(i, spot.offset)
    }

    fun scrollToBottom(animated: Boolean) {
        if (rows.isEmpty()) return
        if (animated) smoothScrollToPosition(rows.size - 1) else lm.scrollToPositionWithOffset(rows.size - 1, 0)
        post { atBottom = !canScrollVertically(1); onBottom?.invoke(atBottom) }
    }

    fun scrollTo(id: String) {
        val i = rows.indexOfFirst { it.id == id }
        if (i >= 0) lm.scrollToPositionWithOffset(i, context.dp(40f))
    }

    private inner class RowAdapter : RecyclerView.Adapter<RowHolder>() {
        override fun getItemCount() = rows.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = RowHolder(parent.context)
        override fun onBindViewHolder(holder: RowHolder, position: Int) {
            val w = if (width > 0) width else context.resources.displayMetrics.widthPixels
            holder.bind(rows[position], w)
        }
    }

    private inner class RowHolder(ctx: Context) : RecyclerView.ViewHolder(LinearLayout(ctx)) {
        private val root = itemView as LinearLayout
        private val dateChip = chip(ctx)
        private val markChip = chip(ctx)
        private val noticeChip = chip(ctx)
        private val card = LinearLayout(ctx)
        private val cardHead = TextView(ctx)
        private val cardTitle = TextView(ctx)
        private val cardNote = TextView(ctx)
        private val cardRule = View(ctx)
        private val cardBy = TextView(ctx)
        private val cardGo = TextView(ctx)
        private val msgRow = LinearLayout(ctx)
        private val avatarBox = FrameLayout(ctx)
        private val avatar = ImageView(ctx)
        private val initials = TextView(ctx)
        private val column = LinearLayout(ctx)
        private val name = TextView(ctx)
        private val contentRow = LinearLayout(ctx)
        private val content = LinearLayout(ctx)
        private val picture = ImageView(ctx)
        private val videoMark = TextView(ctx)
        private val bubble = LinearLayout(ctx)
        private val quoteWho = TextView(ctx)
        private val quoteText = TextView(ctx)
        private val quoteRule = View(ctx)
        private val body = TextView(ctx)
        private val reacts = TextView(ctx)
        private val stamp = LinearLayout(ctx)
        private val unread = TextView(ctx)
        private val time = TextView(ctx)
        private var current: ChatRow? = null

        init {
            root.orientation = LinearLayout.VERTICAL
            root.layoutParams = RecyclerView.LayoutParams(RecyclerView.LayoutParams.MATCH_PARENT, RecyclerView.LayoutParams.WRAP_CONTENT)
            val pad = ctx.dp(ChatSkin.pad)
            root.setPadding(pad, 0, pad, 0)
            root.addView(dateChip, centerChip(ctx))
            root.addView(markChip, centerChip(ctx))
            root.addView(noticeChip, centerChip(ctx))

            /* 눌리는 카드(라운드·투표·공지) — 웹 `LinkCard`의 그것이다. */
            card.orientation = LinearLayout.VERTICAL
            val cpad = ctx.dp(ChatSkin.cardPad)
            card.setPadding(cpad, cpad, cpad, cpad)
            card.background = GradientDrawable().apply {
                cornerRadius = ctx.dp(ChatSkin.cardRadius).toFloat()
                colors = intArrayOf(ChatSkin.cardTint, ChatSkin.card)
                orientation = GradientDrawable.Orientation.TOP_BOTTOM
            }
            cardHead.setTextColor(ChatSkin.cardBadge); cardHead.textSize = 11.5f; cardHead.typeface = Typeface.DEFAULT_BOLD
            cardTitle.setTextColor(ChatSkin.text); cardTitle.textSize = 16f; cardTitle.typeface = Typeface.DEFAULT_BOLD
            cardNote.setTextColor(0xFF5B6455.toInt()); cardNote.textSize = 12.5f
            cardRule.setBackgroundColor(ChatSkin.cardRule)
            cardBy.setTextColor(0xFF5B6455.toInt()); cardBy.textSize = 12f
            cardGo.setTextColor(Color.WHITE); cardGo.textSize = 12f; cardGo.typeface = Typeface.DEFAULT_BOLD
            cardGo.gravity = Gravity.CENTER
            cardGo.setPadding(ctx.dp(12f), ctx.dp(6f), ctx.dp(12f), ctx.dp(6f))
            cardGo.background = GradientDrawable().apply { cornerRadius = ctx.dp(20f).toFloat(); setColor(ChatSkin.link) }
            card.addView(cardHead)
            card.addView(cardTitle, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = ctx.dp(3f) })
            card.addView(cardNote, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = ctx.dp(3f) })
            card.addView(cardRule, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, ctx.dp(1f)).apply { topMargin = ctx.dp(10f); bottomMargin = ctx.dp(8f) })
            card.addView(cardBy)
            card.addView(cardGo, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = ctx.dp(8f); gravity = Gravity.END })
            card.setOnClickListener { current?.to?.let { onCard?.invoke(it) } }
            root.addView(card, LinearLayout.LayoutParams(ctx.dp(ChatSkin.cardW), LinearLayout.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.CENTER_HORIZONTAL })

            /* 말풍선 줄 — [얼굴][이름 / 내용·도장] */
            msgRow.orientation = LinearLayout.HORIZONTAL
            val av = ctx.dp(ChatSkin.avatar)
            avatarBox.layoutParams = LinearLayout.LayoutParams(av, av)
            avatar.scaleType = ImageView.ScaleType.CENTER_CROP
            avatarBox.addView(avatar, FrameLayout.LayoutParams(av, av))
            initials.gravity = Gravity.CENTER; initials.textSize = 11f; initials.setTextColor(ChatSkin.text)
            initials.background = GradientDrawable().apply { cornerRadius = ctx.dp(10f).toFloat(); setColor(0xFFDDE3D1.toInt()) }
            avatarBox.addView(initials, FrameLayout.LayoutParams(av, av))
            msgRow.addView(avatarBox)

            column.orientation = LinearLayout.VERTICAL
            name.setTextColor(ChatSkin.soft); name.textSize = ChatSkin.nameSize
            column.addView(name, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = ctx.dp(2f) })
            contentRow.orientation = LinearLayout.HORIZONTAL
            contentRow.gravity = Gravity.BOTTOM
            content.orientation = LinearLayout.VERTICAL
            picture.scaleType = ImageView.ScaleType.FIT_CENTER
            picture.adjustViewBounds = true
            picture.setOnClickListener { current?.image?.let { if (current?.kind == "photo") onPhoto?.invoke(it) } }
            content.addView(picture)
            videoMark.text = "▶ 동영상"; videoMark.setTextColor(ChatSkin.on); videoMark.textSize = 13f
            videoMark.gravity = Gravity.CENTER
            content.addView(videoMark)
            bubble.orientation = LinearLayout.VERTICAL
            val ph = ctx.dp(ChatSkin.padH); val pv = ctx.dp(ChatSkin.padV)
            bubble.setPadding(ph, pv, ph, pv)
            quoteWho.textSize = ChatSkin.quoteSize; quoteWho.typeface = Typeface.DEFAULT_BOLD; quoteWho.setTextColor(ChatSkin.text)
            quoteText.textSize = ChatSkin.quoteSize; quoteText.setTextColor(0xFF5B6455.toInt()); quoteText.maxLines = 1
            quoteRule.setBackgroundColor(ChatSkin.quoteRule)
            body.textSize = ChatSkin.fontSize; body.setTextColor(ChatSkin.text)
            body.setLineSpacing(0f, 1.2f)
            bubble.addView(quoteWho)
            bubble.addView(quoteText)
            bubble.addView(quoteRule, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, ctx.dp(1f)).apply { topMargin = ctx.dp(5f); bottomMargin = ctx.dp(6f) })
            bubble.addView(body)
            bubble.setOnClickListener { current?.quoteTo?.let { onQuote?.invoke(it) } }
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
            contentRow.addView(content)
            contentRow.addView(stamp, sp)
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

        fun bind(r: ChatRow, listWidth: Int) {
            current = r
            val ctx = itemView.context
            root.setPadding(root.paddingLeft, ctx.dp(r.top.toFloat()), root.paddingRight, 0)
            dateChip.visibility = if (r.date != null) View.VISIBLE else View.GONE
            dateChip.text = r.date ?: ""
            markChip.visibility = if (r.mark) View.VISIBLE else View.GONE
            markChip.text = "여기까지 읽으셨습니다"

            val notice = r.kind == "system"
            noticeChip.visibility = if (notice) View.VISIBLE else View.GONE
            noticeChip.text = r.body
            noticeChip.maxWidth = listWidth - ctx.dp(40f)

            val isCard = r.kind == "card"
            card.visibility = if (isCard) View.VISIBLE else View.GONE
            if (isCard) {
                val lines = r.body.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
                cardHead.text = when (r.icon) { "round" -> "라운드"; "poll" -> "투표"; "post" -> "공지"; else -> "" }
                cardTitle.text = if (lines.size >= 2) lines[1] else (lines.firstOrNull() ?: "")
                val notes = if (lines.size > 2) lines.drop(2).joinToString("\n") else ""
                cardNote.text = notes; cardNote.visibility = if (notes.isEmpty()) View.GONE else View.VISIBLE
                cardBy.text = if (lines.size >= 2) lines[0] else ""
                cardBy.visibility = if (cardBy.text.isEmpty()) View.GONE else View.VISIBLE
                cardGo.text = r.go ?: "보러 가기 ›"
                (card.layoutParams as LinearLayout.LayoutParams).width = minOf(ctx.dp(ChatSkin.cardW), listWidth - ctx.dp(36f))
            }

            val isMsg = !notice && !isCard
            msgRow.visibility = if (isMsg) View.VISIBLE else View.GONE
            if (!isMsg) return

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
            contentRow.removeAllViews()
            val sp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            sp.leftMargin = ctx.dp(4f); sp.rightMargin = ctx.dp(4f)
            if (r.mine) { contentRow.addView(stamp, sp); contentRow.addView(content) }
            else { contentRow.addView(content); contentRow.addView(stamp, sp) }
            stamp.gravity = if (r.mine) Gravity.END else Gravity.START
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
                    picture.minimumWidth = ctx.dp(120f); picture.minimumHeight = ctx.dp(120f)
                    picture.setBackgroundColor(0x33000000)
                    videoMark.visibility = if (r.video) View.VISIBLE else View.GONE
                    if (r.video) picture.setImageDrawable(null)
                    else picture.load(httpsUrl(r.image)) {
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
                else -> { picture.visibility = View.GONE; videoMark.visibility = View.GONE }
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
