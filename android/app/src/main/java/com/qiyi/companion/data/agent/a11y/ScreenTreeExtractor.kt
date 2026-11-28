package com.qiyi.companion.data.agent.a11y

import android.view.accessibility.AccessibilityNodeInfo

data class ExtractedEditableField(
    val index: Int,
    val hint: String,
    val currentText: String,
    val contentDesc: String
)

data class ExtractedScreenSnapshot(
    val packageName: String,
    val activityClass: String,
    val textLines: List<String>,
    val editableFields: List<ExtractedEditableField>,
    val capturedAt: Long = System.currentTimeMillis()
) {
    fun formatForModel(maxChars: Int = 3200): String {
        val sb = StringBuilder()
        sb.append("当前前台应用包名：").append(packageName.ifBlank { "未知" }).append('\n')
        if (editableFields.isNotEmpty()) {
            sb.append("可编辑输入框：\n")
            editableFields.forEach { f ->
                sb.append("- [input#").append(f.index).append("] ")
                if (f.hint.isNotBlank()) sb.append("提示=\"").append(f.hint).append("\" ")
                if (f.contentDesc.isNotBlank()) sb.append("描述=\"").append(f.contentDesc).append("\" ")
                if (f.currentText.isNotBlank()) sb.append("当前内容=\"").append(f.currentText.take(80)).append("\"")
                sb.append('\n')
            }
        }
        sb.append("屏幕可见文本：\n")
        for (line in textLines) {
            if (sb.length + line.length + 2 > maxChars) {
                sb.append("...（屏幕文本已按上限截断）\n")
                break
            }
            sb.append(line).append('\n')
        }
        return sb.toString().trim()
    }
}

/**
 * Extracts compact, deduplicated, password-filtered text & editable-input descriptors
 * from an AccessibilityNodeInfo tree. Pure filtering logic is unit-testable.
 */
object ScreenTreeExtractor {

    fun extract(
        root: AccessibilityNodeInfo?,
        packageName: String,
        activityClass: String = "",
        maxLines: Int = 120
    ): ExtractedScreenSnapshot? {
        if (root == null) return null
        if (ScreenPrivacyGuard.isBlockedPackageOrActivity(packageName, activityClass)) {
            return null
        }

        val lines = mutableListOf<String>()
        val editables = mutableListOf<ExtractedEditableField>()
        val seen = LinkedHashSet<String>()

        fun visit(node: AccessibilityNodeInfo?, depth: Int) {
            if (node == null || depth > 24 || lines.size >= maxLines) return
            if (!node.isVisibleToUser) return
            if (node.isPassword) return // Strictly skip password inputs!

            val text = node.text?.toString()?.trim().orEmpty()
            val desc = node.contentDescription?.toString()?.trim().orEmpty()
            val hint = node.hintText?.toString()?.trim().orEmpty()

            if (node.isEditable) {
                editables.add(
                    ExtractedEditableField(
                        index = editables.size,
                        hint = hint.take(60),
                        currentText = text.take(120),
                        contentDesc = desc.take(60)
                    )
                )
            }

            val candidate = text.ifEmpty { desc }
            val cleaned = cleanNodeLine(candidate)
            if (cleaned.isNotEmpty() && seen.add(cleaned)) {
                lines.add(cleaned)
            }

            val count = node.childCount
            for (i in 0 until count) {
                val child = node.getChild(i)
                visit(child, depth + 1)
                @Suppress("DEPRECATION")
                runCatching { child?.recycle() }
            }
        }

        visit(root, 0)
        return ExtractedScreenSnapshot(
            packageName = packageName,
            activityClass = activityClass,
            textLines = lines,
            editableFields = editables
        )
    }

    fun cleanNodeLine(raw: String): String {
        val compact = raw.replace(Regex("\\s+"), " ").trim()
        if (compact.isEmpty()) return ""
        if (compact.length == 1 && !compact[0].isLetterOrDigit() && compact[0].code < 0x4E00) return ""
        return compact.take(300)
    }
}
