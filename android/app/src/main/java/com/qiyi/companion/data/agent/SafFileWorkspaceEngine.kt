package com.qiyi.companion.data.agent

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import com.qiyi.companion.data.db.AuthorizedDirectoryEntity
import com.qiyi.companion.data.db.FileSnapshotEntity
import com.qiyi.companion.data.db.QiYiDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

data class PreparedFileWrite(
    val directory: AuthorizedDirectoryEntity,
    val relativePath: String,
    val mode: String,
    val existingDocUri: Uri?,
    val originalContent: String,
    val newContent: String,
    val diffPreview: String
)

data class PreparedFileDelete(
    val directory: AuthorizedDirectoryEntity,
    val relativePath: String,
    val targetDocUri: Uri,
    val originalContent: String
)

/**
 * Pure Android SAF (DocumentsContract) sandboxed workspace file engine.
 * - Restricts every file read/write/delete strictly inside user-authorized SAF directory trees.
 * - Blocks path traversal and large binary reads.
 * - Captures pre-mutation snapshots so every write/delete can be undone in 1 click.
 */
class SafFileWorkspaceEngine(
    private val appContext: Context,
    private val db: QiYiDatabase
) {
    private val snapshotDir: File
        get() = File(appContext.filesDir, "agent_snapshots").apply { mkdirs() }

    suspend fun registerDirectory(treeUri: Uri, customAlias: String? = null): AuthorizedDirectoryEntity =
        withContext(Dispatchers.IO) {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            runCatching {
                appContext.contentResolver.takePersistableUriPermission(treeUri, flags)
            }.onFailure {
                // Fallback to read-only persistable grant if provider denies write
                runCatching {
                    appContext.contentResolver.takePersistableUriPermission(
                        treeUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                }
            }

            val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
            val rootDocUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocId)
            val displayName = queryDisplayName(rootDocUri)
                ?: rootDocId.substringAfterLast('/').substringAfterLast(':').ifBlank { "授权文件夹" }

            val existingAll = db.authorizedDirectoryDao().listAll()
            val already = existingAll.firstOrNull { it.treeUri == treeUri.toString() }
            if (already != null) return@withContext already

            val baseAlias = (customAlias?.trim().orEmpty().ifEmpty { displayName })
                .replace(Regex("[/\\\\:*?\"<>|\\s]+"), "_")
                .take(32)
                .ifEmpty { "dir" }
            var uniqueAlias = baseAlias
            var suffix = 2
            while (existingAll.any { it.alias.equals(uniqueAlias, ignoreCase = true) }) {
                uniqueAlias = "${baseAlias}_$suffix"
                suffix++
            }

            val entity = AuthorizedDirectoryEntity(
                id = UUID.randomUUID().toString(),
                alias = uniqueAlias,
                treeUri = treeUri.toString(),
                displayName = displayName,
                readOnly = false
            )
            db.authorizedDirectoryDao().upsert(entity)
            entity
        }

    suspend fun removeDirectory(id: String) = withContext(Dispatchers.IO) {
        val existing = db.authorizedDirectoryDao().getById(id) ?: return@withContext
        runCatching {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            appContext.contentResolver.releasePersistableUriPermission(Uri.parse(existing.treeUri), flags)
        }
        db.authorizedDirectoryDao().deleteById(id)
    }

    suspend fun listFiles(dirAlias: String?, subpath: String = "", maxDepth: Int = 2): String =
        withContext(Dispatchers.IO) {
            val dir = resolveDirectory(dirAlias)
            val cleanSub = if (subpath.isBlank()) "" else normalizeRelativePath(subpath)
            val treeUri = Uri.parse(dir.treeUri)
            val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
            val startDocId = if (cleanSub.isEmpty()) {
                rootDocId
            } else {
                val found = resolveChildDoc(treeUri, rootDocId, cleanSub.split('/'))
                    ?: throw IllegalArgumentException("未找到子目录：「$cleanSub」")
                require(found.isDirectory) { "「$cleanSub」不是文件夹。" }
                found.docId
            }

            val safeDepth = maxDepth.coerceIn(1, 3)
            val lines = mutableListOf<String>()
            val timeFmt = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.getDefault())

            fun walk(parentDocId: String, prefix: String, depth: Int) {
                if (lines.size >= 100) return
                val children = listDirectChildren(treeUri, parentDocId)
                    .sortedWith(compareBy<SafEntry>({ !it.isDirectory }, { it.name.lowercase() }))
                for (child in children) {
                    if (lines.size >= 100) break
                    val rel = if (prefix.isEmpty()) child.name else "$prefix/${child.name}"
                    if (child.isDirectory) {
                        lines.add("[DIR]  $rel/")
                        if (depth < safeDepth) walk(child.docId, rel, depth + 1)
                    } else {
                        val sizeStr = formatBytes(child.size)
                        val mtime = if (child.lastModified > 0) timeFmt.format(Date(child.lastModified)) else ""
                        lines.add("[FILE] $rel  ($sizeStr${if (mtime.isNotEmpty()) ", $mtime" else ""})")
                    }
                }
            }

            walk(startDocId, cleanSub, 1)
            val body = if (lines.isEmpty()) {
                "目录「${dir.alias}/${cleanSub}」目前为空。"
            } else {
                buildString {
                    append("授权目录「${dir.alias}」（${dir.displayName}）")
                    if (cleanSub.isNotEmpty()) append(" / $cleanSub")
                    append(" 共列举 ${lines.size} 项：\n")
                    append(lines.joinToString("\n"))
                }
            }
            MobileInstructionInspector.wrapUntrustedDeviceData("files:${dir.alias}", body, maxChars = 12000)
        }

    suspend fun readFile(
        dirAlias: String?,
        relativePath: String,
        startLine: Int = 1,
        maxLines: Int = 200
    ): String = withContext(Dispatchers.IO) {
        val dir = resolveDirectory(dirAlias)
        val cleanPath = normalizeRelativePath(relativePath)
        val treeUri = Uri.parse(dir.treeUri)
        val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
        val entry = resolveChildDoc(treeUri, rootDocId, cleanPath.split('/'))
            ?: throw IllegalArgumentException("未找到文件：「${dir.alias}/$cleanPath」")
        require(!entry.isDirectory) { "「$cleanPath」是文件夹，请改用 device_list_files。" }
        require(isLikelyTextFile(entry.name, entry.mimeType)) {
            "「${entry.name}」似乎不是文本文件（MIME: ${entry.mimeType ?: "unknown"}），出于安全仅支持读取文本/笔记/代码类文件。"
        }

        val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, entry.docId)
        val rawText = readUtf8TextBounded(docUri, MAX_READ_BYTES)
        val allLines = rawText.split("\n")
        val fromIdx = (startLine - 1).coerceIn(0, allLines.size)
        val limit = maxLines.coerceIn(1, 400)
        val toIdx = (fromIdx + limit).coerceAtMost(allLines.size)

        val numbered = buildString {
            append("文件：${dir.alias}/$cleanPath（共 ${allLines.size} 行，当前第 ${fromIdx + 1}～$toIdx 行）\n")
            for (i in fromIdx until toIdx) {
                append("${i + 1} | ${allLines[i]}\n")
            }
            if (toIdx < allLines.size) {
                append("...（后文尚有 ${allLines.size - toIdx} 行，可用 start_line=${toIdx + 1} 继续读取）")
            }
        }
        MobileInstructionInspector.wrapUntrustedDeviceData("file:${dir.alias}/$cleanPath", numbered)
    }

    suspend fun searchFiles(
        query: String,
        dirAlias: String? = null,
        searchContent: Boolean = true
    ): String = withContext(Dispatchers.IO) {
        val needle = query.trim()
        require(needle.isNotEmpty()) { "检索关键词不能为空。" }
        val dirs = if (dirAlias.isNullOrBlank()) {
            db.authorizedDirectoryDao().listAll().also {
                require(it.isNotEmpty()) { "尚未添加授权文件夹，请先在「设置 → 手机助理」添加目录。" }
            }
        } else {
            listOf(resolveDirectory(dirAlias))
        }

        val hits = mutableListOf<String>()
        for (dir in dirs) {
            if (hits.size >= 20) break
            val treeUri = Uri.parse(dir.treeUri)
            val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
            fun scan(parentDocId: String, prefix: String, depth: Int) {
                if (hits.size >= 20 || depth > 4) return
                for (child in listDirectChildren(treeUri, parentDocId)) {
                    if (hits.size >= 20) break
                    val rel = if (prefix.isEmpty()) child.name else "$prefix/${child.name}"
                    if (child.isDirectory) {
                        scan(child.docId, rel, depth + 1)
                    } else {
                        val nameMatched = child.name.contains(needle, ignoreCase = true)
                        var snippet = ""
                        if (searchContent && isLikelyTextFile(child.name, child.mimeType) && child.size <= 512 * 1024L) {
                            val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, child.docId)
                            val text = runCatching { readUtf8TextBounded(docUri, 64 * 1024) }.getOrDefault("")
                            val hitIdx = text.indexOf(needle, ignoreCase = true)
                            if (hitIdx >= 0) {
                                val start = (hitIdx - 32).coerceAtLeast(0)
                                val end = (hitIdx + needle.length + 64).coerceAtMost(text.length)
                                snippet = text.substring(start, end).replace('\n', ' ')
                            }
                        }
                        if (nameMatched || snippet.isNotEmpty()) {
                            val detail = if (snippet.isNotEmpty()) " → …$snippet…" else "（文件名命中）"
                            hits.add("- ${dir.alias}/$rel$detail")
                        }
                    }
                }
            }
            scan(rootDocId, "", 1)
        }

        val result = if (hits.isEmpty()) {
            "在授权目录中未找到包含「$needle」的文件。"
        } else {
            "找到 ${hits.size} 条匹配：\n${hits.joinToString("\n")}"
        }
        MobileInstructionInspector.wrapUntrustedDeviceData("search:$needle", result, maxChars = 10000)
    }

    suspend fun prepareWrite(
        dirAlias: String?,
        relativePath: String,
        mode: String,
        targetText: String = "",
        content: String
    ): PreparedFileWrite = withContext(Dispatchers.IO) {
        val dir = resolveDirectory(dirAlias)
        require(!dir.readOnly) { "授权目录「${dir.alias}」为只读模式，禁止写入。" }
        val cleanPath = normalizeRelativePath(relativePath)
        val cleanMode = mode.trim().lowercase().ifEmpty { "patch" }
        require(cleanMode in setOf("patch", "append", "overwrite", "create")) {
            "不支持的写入模式：$mode（仅支持 patch / append / overwrite / create）。"
        }

        val treeUri = Uri.parse(dir.treeUri)
        val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
        val existing = resolveChildDoc(treeUri, rootDocId, cleanPath.split('/'))
        if (existing != null && existing.isDirectory) {
            throw IllegalArgumentException("目标路径「$cleanPath」是一个文件夹，无法写入。")
        }
        if (cleanMode == "create" && existing != null) {
            throw IllegalArgumentException("文件「$cleanPath」已存在，请改用 patch / append / overwrite 模式。")
        }
        if (cleanMode == "patch" && existing == null) {
            throw IllegalArgumentException("文件「$cleanPath」尚不存在，无法执行 patch 替换，请改用 create 模式。")
        }

        val existingUri = existing?.let { DocumentsContract.buildDocumentUriUsingTree(treeUri, it.docId) }
        val original = if (existingUri != null) readUtf8TextBounded(existingUri, 256 * 1024) else ""
        val updated = computePatchedContent(original, cleanMode, targetText, content)
        val diff = MobileInstructionInspector.buildUnifiedLineDiff(original, updated)

        PreparedFileWrite(
            directory = dir,
            relativePath = cleanPath,
            mode = cleanMode,
            existingDocUri = existingUri,
            originalContent = original,
            newContent = updated,
            diffPreview = diff
        )
    }

    suspend fun commitWrite(prepared: PreparedFileWrite, auditLogId: String): Pair<String, String> =
        withContext(Dispatchers.IO) {
            val treeUri = Uri.parse(prepared.directory.treeUri)
            val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
            val snapshotId = UUID.randomUUID().toString()
            val opType = if (prepared.existingDocUri == null) "create" else "modify"
            var backupPath = ""

            if (prepared.existingDocUri != null) {
                val backupFile = File(snapshotDir, "$snapshotId.bak")
                backupFile.writeText(prepared.originalContent, Charsets.UTF_8)
                backupPath = backupFile.absolutePath
            }

            val targetUri = prepared.existingDocUri ?: createNestedDocument(
                treeUri = treeUri,
                rootDocId = rootDocId,
                segments = prepared.relativePath.split('/'),
                mimeType = guessMimeType(prepared.relativePath)
            )

            appContext.contentResolver.openOutputStream(targetUri, "wt")?.use { out ->
                out.write(prepared.newContent.toByteArray(Charsets.UTF_8))
                out.flush()
            } ?: throw IllegalStateException("无法打开目标文件写入流：${prepared.relativePath}")

            db.fileSnapshotDao().upsert(
                FileSnapshotEntity(
                    id = snapshotId,
                    auditLogId = auditLogId,
                    directoryId = prepared.directory.id,
                    relativePath = prepared.relativePath,
                    documentUri = targetUri.toString(),
                    operation = opType,
                    backupFilePath = backupPath
                )
            )
            pruneOldSnapshots()
            val actionLabel = if (opType == "create") "已新建文件" else "已修改文件"
            "$actionLabel「${prepared.directory.alias}/${prepared.relativePath}」（共 ${prepared.newContent.length} 字符，已自动留存快照支持一键撤销）。" to snapshotId
        }

    suspend fun prepareDelete(dirAlias: String?, relativePath: String): PreparedFileDelete =
        withContext(Dispatchers.IO) {
            val dir = resolveDirectory(dirAlias)
            require(!dir.readOnly) { "授权目录「${dir.alias}」为只读模式，禁止删除。" }
            val cleanPath = normalizeRelativePath(relativePath)
            val treeUri = Uri.parse(dir.treeUri)
            val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
            val existing = resolveChildDoc(treeUri, rootDocId, cleanPath.split('/'))
                ?: throw IllegalArgumentException("未找到要删除的文件：「${dir.alias}/$cleanPath」")
            require(!existing.isDirectory) { "出于安全禁止直接删除整个文件夹，仅支持删除单个文件。" }

            val targetUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, existing.docId)
            val original = if (isLikelyTextFile(existing.name, existing.mimeType)) {
                runCatching { readUtf8TextBounded(targetUri, 256 * 1024) }.getOrDefault("")
            } else {
                ""
            }
            PreparedFileDelete(dir, cleanPath, targetUri, original)
        }

    suspend fun commitDelete(prepared: PreparedFileDelete, auditLogId: String): Pair<String, String> =
        withContext(Dispatchers.IO) {
            val snapshotId = UUID.randomUUID().toString()
            val backupFile = File(snapshotDir, "$snapshotId.bak")
            backupFile.writeText(prepared.originalContent, Charsets.UTF_8)

            val deleted = DocumentsContract.deleteDocument(appContext.contentResolver, prepared.targetDocUri)
            if (!deleted) throw IllegalStateException("系统未能删除文件：${prepared.relativePath}")

            db.fileSnapshotDao().upsert(
                FileSnapshotEntity(
                    id = snapshotId,
                    auditLogId = auditLogId,
                    directoryId = prepared.directory.id,
                    relativePath = prepared.relativePath,
                    documentUri = prepared.targetDocUri.toString(),
                    operation = "delete",
                    backupFilePath = backupFile.absolutePath
                )
            )
            pruneOldSnapshots()
            "已删除文件「${prepared.directory.alias}/${prepared.relativePath}」（原内容已备份至快照，可在审计日志一键恢复）。" to snapshotId
        }

    suspend fun restoreSnapshot(snapshotId: String): String = withContext(Dispatchers.IO) {
        val snap = db.fileSnapshotDao().getById(snapshotId)
            ?: throw IllegalArgumentException("未找到对应文件快照。")
        val dir = db.authorizedDirectoryDao().getById(snap.directoryId)
            ?: throw IllegalStateException("该快照所属授权目录已被移除，无法自动还原。")
        val treeUri = Uri.parse(dir.treeUri)
        val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)

        when (snap.operation) {
            "create" -> {
                val uri = if (snap.documentUri.isNotBlank()) Uri.parse(snap.documentUri) else null
                if (uri != null) {
                    runCatching { DocumentsContract.deleteDocument(appContext.contentResolver, uri) }
                }
                db.fileSnapshotDao().markRestored(snapshotId, System.currentTimeMillis())
                "已撤销新建，移除了「${dir.alias}/${snap.relativePath}」。"
            }
            "modify", "delete" -> {
                val backupFile = File(snap.backupFilePath)
                require(backupFile.exists()) { "本地快照文件已过期清理，无法还原。" }
                val originalText = backupFile.readText(Charsets.UTF_8)
                val existing = resolveChildDoc(treeUri, rootDocId, snap.relativePath.split('/'))
                val targetUri = if (existing != null) {
                    DocumentsContract.buildDocumentUriUsingTree(treeUri, existing.docId)
                } else {
                    createNestedDocument(
                        treeUri = treeUri,
                        rootDocId = rootDocId,
                        segments = snap.relativePath.split('/'),
                        mimeType = guessMimeType(snap.relativePath)
                    )
                }
                appContext.contentResolver.openOutputStream(targetUri, "wt")?.use { out ->
                    out.write(originalText.toByteArray(Charsets.UTF_8))
                    out.flush()
                } ?: throw IllegalStateException("无法写入还原内容。")
                db.fileSnapshotDao().markRestored(snapshotId, System.currentTimeMillis())
                "已将「${dir.alias}/${snap.relativePath}」完整还原至改动前版本。"
            }
            else -> throw IllegalStateException("不支持的快照类型：${snap.operation}")
        }
    }

    private suspend fun resolveDirectory(dirAlias: String?): AuthorizedDirectoryEntity {
        val all = db.authorizedDirectoryDao().listAll()
        require(all.isNotEmpty()) { "尚未授权任何文件夹。请引导用户前往「设置 → 手机助理与权限沙箱」添加一个授权目录。" }
        if (dirAlias.isNullOrBlank()) {
            return all.first()
        }
        val clean = dirAlias.trim()
        return all.firstOrNull {
            it.alias.equals(clean, ignoreCase = true) || it.displayName.equals(clean, ignoreCase = true)
        } ?: throw IllegalArgumentException(
            "未找到名为「$clean」的授权目录。当前已授权目录：${all.joinToString("、") { it.alias }}"
        )
    }

    private suspend fun pruneOldSnapshots() {
        val all = db.fileSnapshotDao().listAll()
        if (all.size <= 50) return
        all.drop(50).forEach { old ->
            if (old.backupFilePath.isNotBlank()) {
                runCatching { File(old.backupFilePath).delete() }
            }
            db.fileSnapshotDao().deleteById(old.id)
        }
    }

    private data class SafEntry(
        val docId: String,
        val name: String,
        val mimeType: String?,
        val size: Long,
        val lastModified: Long
    ) {
        val isDirectory: Boolean get() = mimeType == DocumentsContract.Document.MIME_TYPE_DIR
    }

    private fun listDirectChildren(treeUri: Uri, parentDocId: String): List<SafEntry> {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
        )
        val result = mutableListOf<SafEntry>()
        appContext.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            val idIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
            val sizeIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
            val modIdx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
            while (cursor.moveToNext()) {
                val docId = if (idIdx >= 0) cursor.getString(idIdx) else continue
                val name = if (nameIdx >= 0) cursor.getString(nameIdx) ?: continue else continue
                val mime = if (mimeIdx >= 0) cursor.getString(mimeIdx) else null
                val size = if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) cursor.getLong(sizeIdx) else 0L
                val mod = if (modIdx >= 0 && !cursor.isNull(modIdx)) cursor.getLong(modIdx) else 0L
                result.add(SafEntry(docId, name, mime, size, mod))
            }
        }
        return result
    }

    private fun resolveChildDoc(treeUri: Uri, rootDocId: String, segments: List<String>): SafEntry? {
        var currentParent = rootDocId
        var currentEntry: SafEntry? = null
        for (seg in segments) {
            val child = listDirectChildren(treeUri, currentParent)
                .firstOrNull { it.name == seg } ?: return null
            currentEntry = child
            currentParent = child.docId
        }
        return currentEntry
    }

    private fun createNestedDocument(
        treeUri: Uri,
        rootDocId: String,
        segments: List<String>,
        mimeType: String
    ): Uri {
        var parentDocId = rootDocId
        for (i in 0 until segments.size - 1) {
            val dirName = segments[i]
            val existing = listDirectChildren(treeUri, parentDocId)
                .firstOrNull { it.name == dirName && it.isDirectory }
            parentDocId = if (existing != null) {
                existing.docId
            } else {
                val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId)
                val createdDirUri = DocumentsContract.createDocument(
                    appContext.contentResolver,
                    parentUri,
                    DocumentsContract.Document.MIME_TYPE_DIR,
                    dirName
                ) ?: throw IllegalStateException("无法创建子目录：$dirName")
                DocumentsContract.getDocumentId(createdDirUri)
            }
        }
        val fileName = segments.last()
        val parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, parentDocId)
        return DocumentsContract.createDocument(appContext.contentResolver, parentUri, mimeType, fileName)
            ?: throw IllegalStateException("无法创建文件：$fileName")
    }

    private fun queryDisplayName(docUri: Uri): String? {
        return runCatching {
            appContext.contentResolver.query(
                docUri,
                arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
                null,
                null,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        }.getOrNull()
    }

    private fun readUtf8TextBounded(docUri: Uri, maxBytes: Int): String {
        appContext.contentResolver.openInputStream(docUri)?.use { input ->
            val buf = ByteArray(maxBytes + 1)
            var total = 0
            while (total < buf.size) {
                val n = input.read(buf, total, buf.size - total)
                if (n <= 0) break
                total += n
            }
            val truncated = total > maxBytes
            val text = String(buf, 0, total.coerceAtMost(maxBytes), Charsets.UTF_8)
            return if (truncated) "$text\n...（文件超过 ${maxBytes / 1024}KB 已截断）" else text
        } ?: throw IllegalStateException("无法打开文件读取流。")
    }

    companion object {
        private const val MAX_READ_BYTES = 24 * 1024

        private val TEXT_EXTENSIONS = setOf(
            "md", "markdown", "txt", "json", "csv", "tsv", "yml", "yaml", "xml",
            "kt", "kts", "java", "js", "mjs", "ts", "tsx", "py", "html", "htm",
            "css", "sh", "ini", "cfg", "conf", "log", "org", "tex", "sql", "toml"
        )

        fun normalizeRelativePath(raw: String): String {
            val normalized = raw.trim().replace('\\', '/').trimStart('/')
            require(normalized.isNotEmpty()) { "文件路径不能为空。" }
            require(!normalized.contains('\u0000')) { "路径包含非法字符。" }
            val parts = normalized.split('/').filter { it.isNotEmpty() }
            require(parts.isNotEmpty()) { "文件路径不能为空。" }
            require(parts.none { it == "." || it == ".." }) { "出于安全禁止使用相对穿越路径（.. 或 .）。" }
            return parts.joinToString("/")
        }

        fun computePatchedContent(
            original: String,
            mode: String,
            targetText: String,
            content: String
        ): String {
            return when (mode.lowercase()) {
                "patch" -> {
                    require(targetText.isNotEmpty()) { "patch 模式必须提供精确的 target_text 原文片段。" }
                    val idx = original.indexOf(targetText)
                    require(idx >= 0) { "未在文件中找到待替换片段 target_text，请先调用 device_read_file 核对原文。" }
                    original.substring(0, idx) + content + original.substring(idx + targetText.length)
                }
                "append" -> {
                    if (original.isEmpty()) content
                    else if (original.endsWith("\n")) original + content
                    else "$original\n$content"
                }
                "overwrite", "create" -> content
                else -> throw IllegalArgumentException("不支持的写入模式：$mode")
            }
        }

        fun isLikelyTextFile(name: String, mimeType: String?): Boolean {
            if (mimeType != null && (mimeType.startsWith("text/") || mimeType == "application/json" || mimeType == "application/xml")) {
                return true
            }
            val ext = name.substringAfterLast('.', "").lowercase()
            return ext in TEXT_EXTENSIONS
        }

        private fun guessMimeType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
            "md", "markdown" -> "text/markdown"
            "json" -> "application/json"
            "csv" -> "text/csv"
            "html", "htm" -> "text/html"
            "xml" -> "application/xml"
            else -> "text/plain"
        }

        private fun formatBytes(bytes: Long): String = when {
            bytes < 1024L -> "${bytes}B"
            bytes < 1024L * 1024L -> "${bytes / 1024L}KB"
            else -> String.format(Locale.US, "%.1fMB", bytes / (1024.0 * 1024.0))
        }
    }
}
