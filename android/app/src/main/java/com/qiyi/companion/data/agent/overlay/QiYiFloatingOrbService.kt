package com.qiyi.companion.data.agent.overlay

import android.app.Service
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.qiyi.companion.MainActivity
import com.qiyi.companion.QiYiApplication
import com.qiyi.companion.data.agent.a11y.QiYiAccessibilityService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.abs

/**
 * Classical Garden jade-seal floating orb overlay for Phase 2.
 * - Starts ONLY when user explicitly enables the floating orb & grants SYSTEM_ALERT_WINDOW.
 * - Collapses into a subtle 48dp draggable jade seal orb at screen edge.
 * - Expands into a compact Xuan-paper panel for:
 *   1) Summarize current screen
 *   2) Draft replies (fill into input box without auto-sending, or copy)
 *   3) Save screen content to local Knowledge Library
 *   4) Quick ask / Return to QiYi
 */
class QiYiFloatingOrbService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var windowManager: WindowManager
    private var orbView: View? = null
    private var orbParams: WindowManager.LayoutParams? = null
    private var panelView: View? = null
    private var panelParams: WindowManager.LayoutParams? = null
    private var lastAiOutput: String = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "请先在系统设置中授予栖忆「悬浮窗」权限。", Toast.LENGTH_SHORT).show()
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        showOrbIfNeeded()
        return START_STICKY
    }

    override fun onDestroy() {
        removePanel()
        removeOrb()
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP,
        value.toFloat(),
        resources.displayMetrics
    ).toInt()

    private fun showOrbIfNeeded() {
        if (orbView != null) return
        val sizePx = dp(48)
        val badge = TextView(this).apply {
            text = "栖"
            setTextColor(Color.parseColor("#F3F8F5"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            typeface = Typeface.SERIF
            gravity = Gravity.CENTER
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#3D6E59"), Color.parseColor("#244939"))
            ).apply {
                shape = GradientDrawable.OVAL
                setStroke(dp(1), Color.parseColor("#E8DFCF"))
            }
            elevation = dp(6).toFloat()
            alpha = 0.88f
        }

        val params = WindowManager.LayoutParams(
            sizePx,
            sizePx,
            overlayWindowType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = resources.displayMetrics.widthPixels - sizePx - dp(10)
            y = resources.displayMetrics.heightPixels / 3
        }

        var downRawX = 0f
        var downRawY = 0f
        var startX = 0
        var startY = 0
        var moved = false

        badge.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = params.x
                    startY = params.y
                    moved = false
                    badge.alpha = 1f
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - downRawX).toInt()
                    val dy = (event.rawY - downRawY).toInt()
                    if (abs(dx) > dp(4) || abs(dy) > dp(4)) moved = true
                    params.x = (startX + dx).coerceIn(0, resources.displayMetrics.widthPixels - sizePx)
                    params.y = (startY + dy).coerceIn(dp(40), resources.displayMetrics.heightPixels - sizePx - dp(60))
                    runCatching { windowManager.updateViewLayout(badge, params) }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    badge.alpha = 0.88f
                    if (!moved) {
                        togglePanel()
                    } else {
                        // Snap smoothly to nearest edge
                        val screenW = resources.displayMetrics.widthPixels
                        params.x = if (params.x + sizePx / 2 < screenW / 2) dp(8) else screenW - sizePx - dp(8)
                        runCatching { windowManager.updateViewLayout(badge, params) }
                    }
                    true
                }
                else -> false
            }
        }

        orbView = badge
        orbParams = params
        runCatching { windowManager.addView(badge, params) }
    }

    private fun removeOrb() {
        orbView?.let { v -> runCatching { windowManager.removeView(v) } }
        orbView = null
        orbParams = null
    }

    private fun togglePanel() {
        if (panelView != null) {
            removePanel()
            return
        }
        showQuickPanel()
    }

    private fun removePanel() {
        panelView?.let { v -> runCatching { windowManager.removeView(v) } }
        panelView = null
        panelParams = null
    }

    private fun showQuickPanel() {
        val app = application as QiYiApplication
        val repo = app.repository

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#FAF6EE"))
                cornerRadius = dp(24).toFloat()
                setStroke(dp(1), Color.parseColor("#DCD4C4"))
            }
            elevation = dp(10).toFloat()
        }

        // Header Row
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val titleView = TextView(this).apply {
            text = "🌿 栖忆随行助手"
            setTextColor(Color.parseColor("#1F2A24"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val openAppBtn = pillButton("回栖忆", "#E5EFE9", "#295844") {
            removePanel()
            val launch = Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(launch)
        }
        val closeBtn = pillButton("收起", "#EFE9DC", "#5C6660") {
            removePanel()
        }
        header.addView(titleView)
        header.addView(openAppBtn)
        header.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(6), 1) })
        header.addView(closeBtn)
        container.addView(header)

        // Status / Result Area
        val resultText = TextView(this).apply {
            text = if (QiYiAccessibilityService.instance != null) {
                "已连接无障碍读屏（自动屏蔽支付/密码页）。点下方按钮即可总结当前屏幕或拟回复草稿。"
            } else {
                "提示：尚未开启无障碍读屏服务。仍可直接快速提问，或在「设置 → 04 手机助理」中开启读屏。"
            }
            setTextColor(Color.parseColor("#3B453F"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setLineSpacing(dp(3).toFloat(), 1f)
            setPadding(dp(10), dp(8), dp(10), dp(8))
        }
        val resultScroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(130)
            ).apply {
                topMargin = dp(10)
                bottomMargin = dp(10)
            }
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#F3EEE3"))
                cornerRadius = dp(14).toFloat()
            }
            addView(resultText)
        }
        container.addView(resultScroll)

        // Action Buttons Row 1
        val actionsRow1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val summarizeBtn = pillButton("读屏总结", "#2D5E4A", "#F3F8F5") {
            runScreenAction(resultText, "请用简洁清晰的中文要点总结以下当前手机屏幕内容：")
        }
        val draftReplyBtn = pillButton("帮拟回复", "#2D5E4A", "#F3F8F5") {
            runScreenAction(
                resultText,
                "请结合当前聊天屏幕上下文，帮我拟一条自然得体、可直接发送的简短中文回复（只输出回复正文，不要多余解释）："
            )
        }
        val saveKnowledgeBtn = pillButton("记入书阁", "#E5EFE9", "#295844") {
            val svc = QiYiAccessibilityService.instance
            if (svc == null) {
                resultText.text = "请先在「设置 → 04 手机助理」中开启无障碍服务再摘录屏幕。"
                return@pillButton
            }
            val snapRes = svc.captureCurrentOrLastExternalSnapshot()
            snapRes.onFailure {
                resultText.text = it.message ?: "未能读取屏幕。"
            }.onSuccess { snap ->
                resultText.text = "正在保存到本地书阁…"
                serviceScope.launch {
                    runCatching {
                        withContext(Dispatchers.IO) {
                            repo.importKnowledgeDocument(
                                title = "屏幕摘录 · ${snap.packageName.substringAfterLast('.')}",
                                rawContent = snap.formatForModel(4000),
                                sourceName = "floating_orb:${snap.packageName}"
                            )
                        }
                    }.onSuccess { doc ->
                        resultText.text = "已将屏幕内容保存至本地书阁《${doc.title}》（${doc.chunkCount} 个分段）。"
                    }.onFailure { err ->
                        resultText.text = "保存失败：${err.message}"
                    }
                }
            }
        }
        actionsRow1.addView(summarizeBtn)
        actionsRow1.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(6), 1) })
        actionsRow1.addView(draftReplyBtn)
        actionsRow1.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(6), 1) })
        actionsRow1.addView(saveKnowledgeBtn)
        container.addView(actionsRow1)

        // Action Buttons Row 2 (Fill Draft / Copy / Stop Orb)
        val actionsRow2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }
        val fillBtn = pillButton("填入输入框(不代发)", "#EFE4D1", "#6D4C1D") {
            if (lastAiOutput.isBlank()) {
                Toast.makeText(this, "请先生成回复草稿。", Toast.LENGTH_SHORT).show()
                return@pillButton
            }
            val svc = QiYiAccessibilityService.instance
            if (svc != null) {
                removePanel()
                runCatching { svc.fillDraftIntoActiveInput(lastAiOutput) }
                    .onFailure { Toast.makeText(this, it.message ?: "填入失败", Toast.LENGTH_SHORT).show() }
            } else {
                copyText(lastAiOutput)
                Toast.makeText(this, "已复制到剪贴板，请手动粘贴发送。", Toast.LENGTH_SHORT).show()
            }
        }
        val copyBtn = pillButton("复制结果", "#EFE9DC", "#49544E") {
            val content = lastAiOutput.ifBlank { resultText.text.toString() }
            copyText(content)
            Toast.makeText(this, "已复制到剪贴板。", Toast.LENGTH_SHORT).show()
        }
        val stopOrbBtn = pillButton("关悬浮球", "#F5E2DF", "#9E3B33") {
            repo.setDeviceAgentSettings(floatingOrbEnabled = false)
            stopSelf()
        }
        actionsRow2.addView(fillBtn)
        actionsRow2.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(6), 1) })
        actionsRow2.addView(copyBtn)
        actionsRow2.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(6), 1) })
        actionsRow2.addView(stopOrbBtn)
        container.addView(actionsRow2)

        // Quick Prompt Input Row
        val inputRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(10) }
        }
        val promptInput = EditText(this).apply {
            hint = "问望舒一句，或针对当前屏幕提问…"
            setHintTextColor(Color.parseColor("#8A8578"))
            setTextColor(Color.parseColor("#1F2A24"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            setPadding(dp(12), dp(8), dp(12), dp(8))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#FFFFFF"))
                cornerRadius = dp(16).toFloat()
                setStroke(dp(1), Color.parseColor("#D5CEBF"))
            }
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val askBtn = pillButton("问", "#2D5E4A", "#F3F8F5") {
            val q = promptInput.text.toString().trim()
            if (q.isEmpty()) return@pillButton
            promptInput.setText("")
            val screenText = QiYiAccessibilityService.instance
                ?.captureCurrentOrLastExternalSnapshot()
                ?.getOrNull()
                ?.formatForModel(2400)
                .orEmpty()
            resultText.text = "望舒正在思考…"
            serviceScope.launch {
                runCatching {
                    val persona = withContext(Dispatchers.IO) { repo.ensureDefaultPersona() }
                    withContext(Dispatchers.IO) { repo.quickScreenAssist(persona, q, screenText) }
                }.onSuccess { answer ->
                    lastAiOutput = answer
                    resultText.text = answer
                }.onFailure { err ->
                    resultText.text = "请求失败：${err.message ?: "请检查模型配置"}"
                }
            }
        }
        inputRow.addView(promptInput)
        inputRow.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(6), 1) })
        inputRow.addView(askBtn)
        container.addView(inputRow)

        val panelWidth = (resources.displayMetrics.widthPixels * 0.9f).toInt()
        val params = WindowManager.LayoutParams(
            panelWidth,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayWindowType(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }

        panelView = container
        panelParams = params
        runCatching { windowManager.addView(container, params) }
    }

    private fun runScreenAction(resultText: TextView, instruction: String) {
        val svc = QiYiAccessibilityService.instance
        if (svc == null) {
            resultText.text = "请先前往栖忆「设置 → 04 手机助理」开启无障碍读屏服务。"
            return
        }
        val snapRes = svc.captureCurrentOrLastExternalSnapshot()
        snapRes.onFailure { err ->
            resultText.text = err.message ?: "读取当前屏幕失败。"
        }.onSuccess { snap ->
            resultText.text = "已读取「${snap.packageName.substringAfterLast('.')}」，正在生成…"
            val app = application as QiYiApplication
            val repo = app.repository
            serviceScope.launch {
                runCatching {
                    val persona = withContext(Dispatchers.IO) { repo.ensureDefaultPersona() }
                    withContext(Dispatchers.IO) {
                        repo.quickScreenAssist(persona, instruction, snap.formatForModel(2800))
                    }
                }.onSuccess { answer ->
                    lastAiOutput = answer
                    resultText.text = answer
                }.onFailure { err ->
                    resultText.text = "生成失败：${err.message ?: "请检查网络或模型配置"}"
                }
            }
        }
    }

    private fun pillButton(label: String, bgHex: String, textHex: String, onClick: () -> Unit): TextView {
        return TextView(this).apply {
            text = label
            setTextColor(Color.parseColor(textHex))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(11), dp(7), dp(11), dp(7))
            background = GradientDrawable().apply {
                setColor(Color.parseColor(bgHex))
                cornerRadius = dp(999).toFloat()
            }
            setOnClickListener { onClick() }
        }
    }

    private fun copyText(text: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        cm?.setPrimaryClip(ClipData.newPlainText("QiYi Orb", text))
    }

    private fun overlayWindowType(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
    }

    companion object {
        const val ACTION_START = "com.qiyi.companion.action.START_FLOATING_ORB"
        const val ACTION_STOP = "com.qiyi.companion.action.STOP_FLOATING_ORB"

        fun start(context: Context) {
            val intent = Intent(context, QiYiFloatingOrbService::class.java).apply { action = ACTION_START }
            context.startService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, QiYiFloatingOrbService::class.java).apply { action = ACTION_STOP }
            context.startService(intent)
        }
    }
}
