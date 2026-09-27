package com.kkakkung.app.chat

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/** 점검표 E-19 / Swift CheerBar 1.236의 유한 애니메이션만 옮긴 폭죽 단추. */
class ChatCheerBar(context: Context) : FrameLayout(context) {
    var onTap: (() -> Unit)? = null
    private val pill = LinearLayout(context)
    private val mark = TextView(context)
    private val label = TextView(context)
    private val shine = View(context)
    private val sparks = ArrayList<TextView>()
    private val running = ArrayList<android.animation.Animator>()

    init {
        setBackgroundColor(ChatSkin.bg)
        clipChildren = false; clipToPadding = false
        pill.orientation = LinearLayout.HORIZONTAL; pill.gravity = Gravity.CENTER
        pill.background = GradientDrawable().apply {
            cornerRadius = context.dp(22f).toFloat(); setColor(ChatSkin.chip)
        }
        pill.clipToOutline = true
        mark.text = "✨"; mark.textSize = 15f; mark.gravity = Gravity.CENTER
        label.text = "축하 폭죽 터뜨리기"; label.textSize = 13f
        label.setTextColor(ChatSkin.on); label.setTypeface(label.typeface, android.graphics.Typeface.BOLD)
        pill.addView(mark, LinearLayout.LayoutParams(context.dp(17f), context.dp(44f)))
        pill.addView(label, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT, context.dp(44f)
        ).apply { marginStart = context.dp(7f) })
        pill.setPadding(context.dp(18f),0,context.dp(18f),0)
        pill.setOnClickListener { onTap?.invoke() }
        addView(pill, LayoutParams(LayoutParams.WRAP_CONTENT, context.dp(44f), Gravity.CENTER))

        shine.background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.TRANSPARENT, 0x61FFFFFF, Color.TRANSPARENT))
        shine.alpha = 0f
        addView(shine, LayoutParams(context.dp(56f), context.dp(44f), Gravity.CENTER))
        repeat(4) { i ->
            val v=TextView(context).apply {
                text="✦"; textSize=if(i%2==0)11f else 8f; gravity=Gravity.CENTER
                setTextColor(intArrayOf(0xFFFFDF47.toInt(),0xFFFF7A59.toInt(),0xFF75D7FF.toInt(),0xFFFF9AD5.toInt())[i])
                alpha=0f
            }
            sparks.add(v); addView(v, LayoutParams(context.dp(16f),context.dp(16f)))
        }
    }

    fun play() {
        stopMotion()
        alpha=0f
        val fade=ObjectAnimator.ofFloat(this, View.ALPHA,0f,1f).setDuration(250)
        running.add(fade); fade.start()
        val reduce = Build.VERSION.SDK_INT >= 26 && !ValueAnimator.areAnimatorsEnabled()
        if (reduce) return

        // 0.55 → 1, 스프링 느낌의 overshoot. 유한 1회.
        pill.scaleX=.55f; pill.scaleY=.55f
        val sx=ObjectAnimator.ofFloat(pill,View.SCALE_X,.55f,1.08f,.97f,1f).setDuration(650)
        val sy=ObjectAnimator.ofFloat(pill,View.SCALE_Y,.55f,1.08f,.97f,1f).setDuration(650)
        running.add(sx);running.add(sy);sx.start();sy.start()

        // ✨ 1.6초 × 5.
        val wig=ObjectAnimator.ofFloat(mark,View.ROTATION,0f,-22f,20f,-12f,6f,0f)
        val growX=ObjectAnimator.ofFloat(mark,View.SCALE_X,1f,1.4f,.95f,1.08f,1f)
        val growY=ObjectAnimator.ofFloat(mark,View.SCALE_Y,1f,1.4f,.95f,1.08f,1f)
        for(a in listOf(wig,growX,growY)){a.duration=1600;a.repeatCount=4;a.startDelay=350;running.add(a);a.start()}

        // 빛 줄기 2.4초 × 3.
        post {
            shine.alpha=1f
            val sweep=ObjectAnimator.ofFloat(shine,View.TRANSLATION_X,
                -pill.width/2f-context.dp(56f), pill.width/2f+context.dp(56f))
            sweep.duration=2400;sweep.repeatCount=2;sweep.startDelay=600
            sweep.interpolator=AccelerateDecelerateInterpolator();running.add(sweep);sweep.start()
        }

        // 별 넷 1.8초 × 4, 0.22초씩.
        sparks.forEachIndexed { i,v ->
            post {
                val p=pill
                val spots=arrayOf(
                    p.left+context.dp(6f) to p.top+context.dp(2f),
                    p.right-context.dp(8f) to p.top+context.dp(4f),
                    p.left+context.dp(14f) to p.bottom-context.dp(3f),
                    p.right-context.dp(2f) to p.bottom-context.dp(10f))
                v.x=spots[i].first.toFloat();v.y=spots[i].second.toFloat()
                val a=ObjectAnimator.ofFloat(v,View.ALPHA,0f,1f,0f)
                val x=ObjectAnimator.ofFloat(v,View.SCALE_X,.2f,1.25f,.4f)
                val y=ObjectAnimator.ofFloat(v,View.SCALE_Y,.2f,1.25f,.4f)
                for(z in listOf(a,x,y)){z.duration=1800;z.repeatCount=3;z.startDelay=300L+i*220L;running.add(z);z.start()}
            }
        }
    }

    fun stopMotion() {
        running.forEach { it.cancel() }; running.clear()
        shine.alpha=0f; sparks.forEach { it.alpha=0f }
        pill.scaleX=1f;pill.scaleY=1f;mark.rotation=0f;mark.scaleX=1f;mark.scaleY=1f
    }

    override fun onDetachedFromWindow(){ stopMotion(); super.onDetachedFromWindow() }
}
