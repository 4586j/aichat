package com.qiyi.companion.ui.screens

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.db.KnowledgeDocumentEntity
import com.qiyi.companion.data.db.MemoryEntity
import com.qiyi.companion.data.db.MemoryTripleEntity
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.GardenTagPill
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.LocalGardenColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val MemoryCategories = listOf(
    "fact" to "事实",
    "preference" to "偏好",
    "event" to "经历",
    "relationship" to "关系"
)

@Composable
fun LibraryScreen(
    viewModel: QiYiViewModel,
    modifier: Modifier = Modifier
) {
    var subTab by rememberSaveable { mutableIntStateOf(0) }
    val garden = LocalGardenColors.current

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 6.dp),
            shape = RoundedCornerShape(10.dp),
            color = garden.paperCard,
            border = BorderStroke(1.dp, garden.line)
        ) {
            Column {
                Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                    Text("书阁 · 知识、记忆与图谱", style = MaterialTheme.typography.titleMedium, color = garden.ink)
                    Text(
                        text = "支持文档导入、网页剪藏、RRF 向量混合检索、固定记忆与关系图谱",
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.muted
                    )
                }
                TabRow(
                    selectedTabIndex = subTab,
                    containerColor = garden.paperCard
                ) {
                    Tab(selected = subTab == 0, onClick = { subTab = 0 }, text = { Text("知识库") })
                    Tab(selected = subTab == 1, onClick = { subTab = 1 }, text = { Text("记忆库") })
                    Tab(selected = subTab == 2, onClick = { subTab = 2 }, text = { Text("关系图谱") })
                }
            }
        }

        when (subTab) {
            0 -> KnowledgeTabContent(viewModel = viewModel)
            1 -> MemoryTabContent(viewModel = viewModel)
            else -> MemoryGraphTabContent(viewModel = viewModel)
        }
    }
}

@Composable
private fun KnowledgeTabContent(viewModel: QiYiViewModel) {
    val context = LocalContext.current
    val documents by viewModel.knowledgeDocuments.collectAsStateWithLifecycle()
    val searchResults by viewModel.knowledgeSearchResults.collectAsStateWithLifecycle()
    val isClippingWeb by viewModel.isClippingWeb.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current
    val formatter = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }

    var searchQuery by rememberSaveable { mutableStateOf("") }
    var showPasteDialog by remember { mutableStateOf(false) }
    var showClipDialog by remember { mutableStateOf(false) }

    val fileLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            var displayName = "导入文档.txt"
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) displayName = cursor.getString(idx) ?: displayName
                }
            }
            val text = context.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: throw IllegalStateException("无法读取所选文档。")
            val title = displayName.substringBeforeLast('.').ifBlank { displayName }
            Triple(title, text, displayName)
        }.onSuccess { (title, text, sourceName) ->
            viewModel.importKnowledgeDocument(title = title, rawContent = text, sourceName = sourceName)
        }.onFailure {
            viewModel.notify(it.message ?: "导入知识库文件失败。")
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item(key = "actions") {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                GardenWindowButton(
                    text = "导入文件",
                    primary = true,
                    onClick = { fileLauncher.launch(arrayOf("text/markdown", "text/plain", "*/*")) },
                    modifier = Modifier.weight(1f)
                )
                GardenWindowButton(
                    text = "网页剪藏",
                    onClick = { showClipDialog = true },
                    modifier = Modifier.weight(1f)
                )
                GardenWindowButton(
                    text = "手动笔记",
                    onClick = { showPasteDialog = true },
                    modifier = Modifier.weight(1f)
                )
            }
        }

        item(key = "search_box") {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = {
                        searchQuery = it
                        if (it.isBlank()) viewModel.searchKnowledge("")
                    },
                    placeholder = { Text("测试本地/混合检索关键词…") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                Button(onClick = { viewModel.searchKnowledge(searchQuery) }) {
                    Icon(Icons.Default.Search, contentDescription = "检索", modifier = Modifier.size(18.dp))
                }
            }
        }

        if (searchResults.isNotEmpty()) {
            item(key = "search_header") {
                Text(
                    text = "命中片段（${searchResults.size} 条）",
                    style = MaterialTheme.typography.labelMedium,
                    color = garden.bamboo,
                    fontWeight = FontWeight.SemiBold
                )
            }
            items(searchResults, key = { "hit_${it.chunk.id}" }) { hit ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    color = garden.bambooSoft,
                    border = BorderStroke(0.8.dp, garden.lineStrong)
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "《${hit.chunk.documentTitle}》 · 片段 #${hit.chunk.chunkIndex + 1}",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = garden.bamboo
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = hit.chunk.content,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 4,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }

        item(key = "docs_header") {
            Text(
                text = "已藏文档（${documents.size} 篇）",
                style = MaterialTheme.typography.labelMedium,
                color = garden.muted
            )
        }

        if (documents.isEmpty()) {
            item(key = "empty_docs") {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = garden.paperCard,
                    border = BorderStroke(0.8.dp, garden.line)
                ) {
                    Text(
                        text = "书阁尚空。导入本地文档或剪藏网页后，对话提问时会自动检索最相关片段并在回复下方生成可点击 [1] 引用溯源角标。",
                        style = MaterialTheme.typography.bodySmall,
                        color = garden.muted,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }
        } else {
            items(documents, key = { it.id }) { doc: KnowledgeDocumentEntity ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = garden.paperCard,
                    border = BorderStroke(0.8.dp, garden.line)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = if (doc.sourceName.startsWith("http")) Icons.Default.Language else Icons.Default.Description,
                            contentDescription = null,
                            tint = garden.bamboo
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = doc.title,
                                style = MaterialTheme.typography.titleSmall,
                                color = garden.ink,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = "${doc.chunkCount} 个片段 · ${doc.charCount} 字 · ${formatter.format(Date(doc.createdAt))}",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.muted
                            )
                        }
                        IconButton(onClick = { viewModel.deleteKnowledgeDocument(doc) }) {
                            Icon(Icons.Default.DeleteOutline, contentDescription = "删除文档", tint = garden.cinnabar)
                        }
                    }
                }
            }
        }
    }

    if (showPasteDialog) {
        var title by remember { mutableStateOf("") }
        var body by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showPasteDialog = false },
            title = { Text("手动录入知识笔记") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        label = { Text("文档标题") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = body,
                        onValueChange = { body = it },
                        label = { Text("正文内容（支持 Markdown）") },
                        minLines = 5,
                        maxLines = 10,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.importKnowledgeDocument(title = title.ifBlank { "随手笔记" }, rawContent = body) {
                            showPasteDialog = false
                        }
                    },
                    enabled = body.isNotBlank()
                ) { Text("保存并分块") }
            },
            dismissButton = {
                TextButton(onClick = { showPasteDialog = false }) { Text("取消") }
            }
        )
    }

    if (showClipDialog) {
        var url by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showClipDialog = false },
            title = { Text("网页剪藏入库") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("粘贴文章链接，自动清洗 HTML 正文并分块存入书阁知识库。", style = MaterialTheme.typography.bodySmall, color = garden.muted)
                    OutlinedTextField(
                        value = url,
                        onValueChange = { url = it },
                        label = { Text("网页 URL") },
                        placeholder = { Text("https://example.com/article") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.clipWebPage(url) { showClipDialog = false } },
                    enabled = url.isNotBlank() && !isClippingWeb
                ) { Text(if (isClippingWeb) "抓取中…" else "开始剪藏") }
            },
            dismissButton = {
                TextButton(onClick = { showClipDialog = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun MemoryTabContent(viewModel: QiYiViewModel) {
    val memories by viewModel.memories.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current

    val pinnedMemories = remember(memories) { memories.filter { it.isPinned } }
    val activeMemories = remember(memories) { memories.filter { !it.isPinned } }

    var editingMemory by remember { mutableStateOf<MemoryEntity?>(null) }
    var showMemoryDialog by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item(key = "add_memory_btn") {
            GardenWindowButton(
                text = "+ 新增长期记忆",
                primary = true,
                onClick = {
                    editingMemory = null
                    showMemoryDialog = true
                },
                modifier = Modifier.fillMaxWidth()
            )
        }

        if (pinnedMemories.isNotEmpty()) {
            item(key = "pinned_hdr") {
                Text("固定记忆（${pinnedMemories.size} 条 · 每轮对话优先常驻）", style = MaterialTheme.typography.labelMedium, color = garden.gold)
            }
            items(pinnedMemories, key = { it.id }) { mem ->
                MemoryCard(
                    mem = mem,
                    onTogglePin = { viewModel.toggleMemoryPinned(mem) },
                    onEdit = { editingMemory = mem; showMemoryDialog = true },
                    onDelete = { viewModel.deleteMemory(mem) }
                )
            }
        }

        item(key = "active_hdr") {
            Text("活跃记忆（${activeMemories.size} 条 · 按关键词与重要度动态召回）", style = MaterialTheme.typography.labelMedium, color = garden.muted)
        }

        if (activeMemories.isEmpty() && pinnedMemories.isEmpty()) {
            item(key = "empty_memories") {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = garden.paperCard,
                    border = BorderStroke(0.8.dp, garden.line)
                ) {
                    Text(
                        text = "尚未记录长期记忆。可手动添加偏好与背景，或在对话回复下方点击「记住」一键收录。",
                        style = MaterialTheme.typography.bodySmall,
                        color = garden.muted,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }
        } else {
            items(activeMemories, key = { it.id }) { mem ->
                MemoryCard(
                    mem = mem,
                    onTogglePin = { viewModel.toggleMemoryPinned(mem) },
                    onEdit = { editingMemory = mem; showMemoryDialog = true },
                    onDelete = { viewModel.deleteMemory(mem) }
                )
            }
        }
    }

    if (showMemoryDialog) {
        MemoryEditorDialog(
            initial = editingMemory,
            onDismiss = { showMemoryDialog = false },
            onSave = { category, content, importance ->
                viewModel.saveMemory(
                    existingId = editingMemory?.id,
                    personaId = editingMemory?.personaId,
                    category = category,
                    content = content,
                    importance = importance,
                    isPinned = editingMemory?.isPinned ?: false
                ) { showMemoryDialog = false }
            }
        )
    }
}

@Composable
private fun MemoryCard(
    mem: MemoryEntity,
    onTogglePin: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    val garden = LocalGardenColors.current
    val catLabel = MemoryCategories.firstOrNull { it.first == mem.category }?.second ?: mem.category
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = garden.paperCard,
        border = BorderStroke(if (mem.isPinned) 1.2.dp else 0.8.dp, if (mem.isPinned) garden.gold else garden.line)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    GardenTagPill(text = catLabel, accent = garden.ink, background = garden.goldSoft)
                    if (mem.isPinned) {
                        GardenTagPill(text = "固定", accent = garden.paperCard, background = garden.gold)
                    }
                    Text(
                        text = "★".repeat(mem.importance.coerceIn(1, 5)),
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.gold
                    )
                }
                Row {
                    IconButton(onClick = onTogglePin, modifier = Modifier.size(30.dp)) {
                        Icon(
                            Icons.Default.PushPin,
                            contentDescription = "置顶/取消固定",
                            modifier = Modifier.size(16.dp),
                            tint = if (mem.isPinned) garden.gold else garden.muted
                        )
                    }
                    IconButton(onClick = onEdit, modifier = Modifier.size(30.dp)) {
                        Icon(Icons.Default.Edit, contentDescription = "编辑", modifier = Modifier.size(16.dp), tint = garden.muted)
                    }
                    IconButton(onClick = onDelete, modifier = Modifier.size(30.dp)) {
                        Icon(Icons.Default.DeleteOutline, contentDescription = "删除", modifier = Modifier.size(16.dp), tint = garden.cinnabar)
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            HorizontalDivider(color = garden.lineSoft)
            Spacer(Modifier.height(6.dp))
            Text(text = mem.content, style = MaterialTheme.typography.bodyMedium, color = garden.text)
        }
    }
}

@Composable
private fun MemoryGraphTabContent(viewModel: QiYiViewModel) {
    val triples by viewModel.memoryTriples.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current
    var showAddDialog by remember { mutableStateOf(false) }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item(key = "add_triple_btn") {
            GardenWindowButton(
                text = "+ 新增关系三元组（主体 — 关系 → 客体）",
                primary = true,
                onClick = { showAddDialog = true },
                modifier = Modifier.fillMaxWidth()
            )
        }

        if (triples.isEmpty()) {
            item(key = "empty_triples") {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp),
                    color = garden.paperCard,
                    border = BorderStroke(0.8.dp, garden.line)
                ) {
                    Text(
                        text = "关系图谱用于记录结构化事实（如「我 — 职业 → 软件工程师」「我 — 偏爱 → 清茶与夜雨」），对话时自动随长期记忆注入。",
                        style = MaterialTheme.typography.bodySmall,
                        color = garden.muted,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }
        } else {
            items(triples, key = { it.id }) { triple: MemoryTripleEntity ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    color = garden.paperCard,
                    border = BorderStroke(0.8.dp, garden.line)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            modifier = Modifier.weight(1f),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            GardenTagPill(text = triple.subject, accent = garden.paperCard, background = garden.bamboo)
                            Text("— ${triple.predicate} →", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                            GardenTagPill(text = triple.objectValue, accent = garden.ink, background = garden.goldSoft)
                        }
                        IconButton(onClick = { viewModel.deleteMemoryTriple(triple) }, modifier = Modifier.size(30.dp)) {
                            Icon(Icons.Default.DeleteOutline, contentDescription = "删除", tint = garden.cinnabar, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
    }

    if (showAddDialog) {
        var subject by remember { mutableStateOf("我") }
        var predicate by remember { mutableStateOf("") }
        var obj by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showAddDialog = false },
            title = { Text("新增关系图谱三元组") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = subject, onValueChange = { subject = it }, label = { Text("主体（如：我）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = predicate, onValueChange = { predicate = it }, label = { Text("关系（如：擅长 / 居住在 / 喜欢）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = obj, onValueChange = { obj = it }, label = { Text("客体（如：Kotlin / 杭州 / 龙井）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.addMemoryTriple(subject, predicate, obj) { showAddDialog = false } },
                    enabled = subject.isNotBlank() && predicate.isNotBlank() && obj.isNotBlank()
                ) { Text("保存") }
            },
            dismissButton = {
                TextButton(onClick = { showAddDialog = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun MemoryEditorDialog(
    initial: MemoryEntity?,
    onDismiss: () -> Unit,
    onSave: (category: String, content: String, importance: Int) -> Unit
) {
    var category by remember(initial) { mutableStateOf(initial?.category ?: "fact") }
    var content by remember(initial) { mutableStateOf(initial?.content.orEmpty()) }
    var importance by remember(initial) { mutableStateOf((initial?.importance ?: 3).toFloat()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "新增长期记忆" else "编辑长期记忆") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    MemoryCategories.forEach { (key, label) ->
                        FilterChip(
                            selected = category == key,
                            onClick = { category = key },
                            label = { Text(label) }
                        )
                    }
                }
                OutlinedTextField(
                    value = content,
                    onValueChange = { content = it },
                    label = { Text("记忆内容 *") },
                    placeholder = { Text("例如：我习惯晚上 11 点后专注写代码，偏爱简洁直接的回答。") },
                    minLines = 3,
                    maxLines = 6,
                    modifier = Modifier.fillMaxWidth()
                )
                Column {
                    Text(text = "重要度：${importance.toInt()} / 5", style = MaterialTheme.typography.labelMedium)
                    Slider(value = importance, onValueChange = { importance = it }, valueRange = 1f..5f, steps = 3)
                }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(category, content, importance.toInt()) }, enabled = content.isNotBlank()) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )
}
