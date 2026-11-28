package com.qiyi.companion.data.agent.a11y

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Toast
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Lightweight, on-demand AccessibilityService for Phase 2:
 * - Zero continuous event scraping (battery-friendly; only tracks foreground package transitions).
 * - Strictly blocks password fields & financial/payment apps via ScreenPrivacyGuard.
 * - Supports reading current/last external screen and filling draft text into an editable field
 *   WITHOUT EVER clicking any Send / Pay / Confirm button.
 */
class QiYiAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        _serviceRunning.value = true
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val pkg = event.packageName?.toString().orEmpty()
            val cls = event.className?.toString().orEmpty()
            if (pkg.isNotBlank() && pkg != packageName) {
                lastExternalPackage = pkg
                lastExternalClass = cls
                // Capture lightweight passive snapshot for when user switches back to QiYi
                if (!ScreenPrivacyGuard.isBlockedPackageOrActivity(pkg, cls)) {
                    runCatching {
                        val snap = ScreenTreeExtractor.extract(rootInActiveWindow, pkg, cls, maxLines = 90)
                        if (snap != null && snap.textLines.isNotEmpty()) {
                            lastExternalSnapshot = snap
                        }
                    }
                } else {
                    // Immediately clear snapshot when entering a sensitive payment/bank screen
                    lastExternalSnapshot = null
                }
            }
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (instance === this) instance = null
        _serviceRunning.value = false
        super.onDestroy()
    }

    fun captureCurrentOrLastExternalSnapshot(): Result<ExtractedScreenSnapshot> {
        val activeRoot = rootInActiveWindow
        val activePkg = activeRoot?.packageName?.toString().orEmpty()
        val activeCls = if (activePkg == lastExternalPackage) lastExternalClass else ""

        if (activePkg.isNotBlank() && activePkg != packageName) {
            if (ScreenPrivacyGuard.isBlockedPackageOrActivity(activePkg, activeCls)) {
                return Result.failure(
                    SecurityException("当前位于金融/支付/隐私敏感页面（$activePkg），已按安全红线自动屏蔽读屏。")
                )
            }
            val snap = ScreenTreeExtractor.extract(activeRoot, activePkg, activeCls)
            if (snap != null) {
                lastExternalSnapshot = snap
                return Result.success(snap)
            }
        }

        val cached = lastExternalSnapshot
            ?: return Result.failure(IllegalStateException("暂未捕获到其他应用的屏幕内容，请先切换到目标应用再通过悬浮球或返回栖忆读屏。"))
        if (ScreenPrivacyGuard.isBlockedPackageOrActivity(cached.packageName, cached.activityClass)) {
            return Result.failure(SecurityException("目标页面属于隐私受保护页面，已禁止读取。"))
        }
        return Result.success(cached)
    }

    /**
     * Fills draft text into the focused or matching editable non-password input box.
     * NEVER clicks Send or any confirmation button. Falls back gracefully to clipboard + Toast.
     */
    fun fillDraftIntoActiveInput(draftText: String, targetHint: String = ""): String {
        val cleanText = draftText.trim()
        require(cleanText.isNotEmpty()) { "草稿内容不能为空。" }

        val activeRoot = rootInActiveWindow
        val activePkg = activeRoot?.packageName?.toString().orEmpty()
        if (ScreenPrivacyGuard.isBlockedPackageOrActivity(activePkg, lastExternalClass)) {
            throw SecurityException("当前页面属于金融/隐私受保护应用（$activePkg），禁止自动填入内容。")
        }

        val targetNode = if (activeRoot != null && activePkg != packageName) {
            findBestEditableNode(activeRoot, targetHint.trim())
        } else {
            null
        }

        if (targetNode != null) {
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, cleanText)
            }
            val focused = targetNode.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
            val setOk = targetNode.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            @Suppress("DEPRECATION")
            runCatching { targetNode.recycle() }
            if (setOk || focused) {
                showMainToast("草稿已填入输入框，请核对后手动点击发送")
                return "已将草稿安全填入当前应用（$activePkg）的输入框中（未自动发送，请亲自核对后点击发送）。"
            }
        }

        // Graceful fallback: copy to clipboard so user can paste with 1 tap
        copyToClipboard(this, cleanText)
        showMainToast("草稿已复制到剪贴板，请直接粘贴后手动发送")
        return "当前页面未检测到处于前台的可编辑输入框，已为你将草稿复制到剪贴板，切回目标聊天粘贴即可发送。"
    }

    private fun findBestEditableNode(root: AccessibilityNodeInfo, hintNeedle: String): AccessibilityNodeInfo? {
        val candidates = mutableListOf<AccessibilityNodeInfo>()

        fun collect(node: AccessibilityNodeInfo?, depth: Int) {
            if (node == null || depth > 24) return
            if (!node.isVisibleToUser) return
            if (node.isPassword) return // Never fill password fields!
            val label = node.text?.toString().orEmpty().ifEmpty { node.contentDescription?.toString().orEmpty() }
            if (node.isEditable && !ScreenPrivacyGuard.isForbiddenButtonLabel(label)) {
                candidates.add(AccessibilityNodeInfo.obtain(node))
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i)
                collect(child, depth + 1)
                @Suppress("DEPRECATION")
                runCatching { child?.recycle() }
            }
        }

        collect(root, 0)
        if (candidates.isEmpty()) return null

        val chosen = when {
            hintNeedle.isNotEmpty() -> candidates.firstOrNull { n ->
                val h = n.hintText?.toString().orEmpty()
                val d = n.contentDescription?.toString().orEmpty()
                h.contains(hintNeedle, ignoreCase = true) || d.contains(hintNeedle, ignoreCase = true)
            }
            else -> null
        } ?: candidates.firstOrNull { it.isFocused } ?: candidates.last()

        candidates.forEach { if (it !== chosen) @Suppress("DEPRECATION") runCatching { it.recycle() } }
        return chosen
    }

    private fun copyToClipboard(context: Context, text: String) {
        Handler(Looper.getMainLooper()).post {
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            cm?.setPrimaryClip(ClipData.newPlainText("QiYi Draft", text))
        }
    }

    private fun showMainToast(msg: String) {
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
        }
    }

    companion object {
        @Volatile
        var instance: QiYiAccessibilityService? = null
            private set

        @Volatile
        var lastExternalPackage: String = ""
            private set

        @Volatile
        var lastExternalClass: String = ""
            private set

        @Volatile
        var lastExternalSnapshot: ExtractedScreenSnapshot? = null
            private set

        private val _serviceRunning = MutableStateFlow(false)
        val serviceRunning: StateFlow<Boolean> = _serviceRunning.asStateFlow()

        fun isEnabledInSettings(context: Context): Boolean {
            if (instance != null) return true
            val enabledServices = runCatching {
                Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            }.getOrNull().orEmpty()
            return enabledServices.contains("${context.packageName}/${QiYiAccessibilityService::class.java.name}") ||
                enabledServices.contains("${context.packageName}/.data.agent.a11y.QiYiAccessibilityService")
        }
    }
}
