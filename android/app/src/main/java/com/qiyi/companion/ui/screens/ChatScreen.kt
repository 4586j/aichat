package com.qiyi.companion.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CallSplit
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.BookmarkAdd
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.db.ConversationEntity
import com.qiyi.companion.data.db.MessageEntity
import com.qiyi.companion.data.db.PersonaEntity
import com.qiyi.companion.data.knowledge.CitationItem
import com.qiyi.companion.data.knowledge.KnowledgeEngine
import com.qiyi.companion.data.media.StickerCard
import com.qiyi.companion.data.media.StickerCatalog
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.QuotaCheckpointState
import com.qiyi.companion.ui.StreamingState
import com.qiyi.companion.ui.theme.BegoniaPlaqueShape
import com.qiyi.companion.ui.theme.CinnabarPillButton
import com.qiyi.companion.ui.theme.GardenMarkdownText
import com.qiyi.companion.ui.theme.GardenSealAvatar
import com.qiyi.companion.ui.theme.GardenTagPill
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.LocalGardenColors
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    viewModel: QiYiViewModel,
    onWriteAsMail: (subject: String, body: String) -> Unit = { _, _ -> },
    modifier: Modifier = Modifier
) {
    val personas by viewModel.personas.collectAsStateWithLifecycle()
    val activePersonaId by viewModel.activePersonaId.collectAsStateWithLifecycle()
    val activeConversationId by viewModel.activeConversationId.collectAsStateWithLifecycle()
    val activeConversation by viewModel.activeConversation.collectAsStateWithLifecycle()
    val allConversations by viewModel.allConversations.collectAsStateWithLifecycle()
    val messages by viewModel.messages.collectAsStateWithLifecycle()
    val streaming by viewModel.streaming.collectAsStateWithLifecycle()
    val quotaCheckpoint by viewModel.quotaCheckpoint.collectAsStateWithLifecycle()
    val draftAttachments by viewModel.draftAttachments.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()

    val personaMap = remember(personas) { personas.associateBy { it.id } }
    val activePersona = personas.firstOrNull { it.id == activePersonaId } ?: personas.firstOrNull()
    val effectiveModel = viewModel.effectiveModelFor(activePersona)
    val isGroup = activeConversation?.isGroup == true

    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var draft by rememberSaveable { mutableStateOf("") }
    var composerCollapsed by rememberSaveable { mutableStateOf(false) }
    var showChatStateDrawer by rememberSaveable { mutableStateOf(false) }
    var showChatStateDialog by remember { mutableStateOf(false) }
    var showLinkageDialog by remember { mutableStateOf(false) }
    var personaMenuExpanded by remember { mutableStateOf(false) }
    var showHistorySheet by remember { mutableStateOf(false) }
    var showGroupDialog by remember { mutableStateOf(false) }
    var pendingExportMd by remember { mutableStateOf<String?>(null) }
    var lightboxImagePath by remember { mutableStateOf<String?>(null) }

    val attachFileLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            var displayName = "附件.txt"
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) displayName = cursor.getString(idx) ?: displayName
                }
            }
            val text = context.contentResolver.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
                ?: throw IllegalStateException("无法读取附件文件。")
            displayName to text
        }.onSuccess { (name, text) ->
            viewModel.addDraftAttachment(name, text)
        }.onFailure {
            viewModel.notify(it.message ?: "读取附件失败。")
        }
    }

    val attachImageLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            var displayName = "图片.jpg"
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) displayName = cursor.getString(idx) ?: displayName
                }
            }
            val rawBitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
                ?: throw IllegalStateException("无法解码所选图片。")
            val maxDim = 1280
            val scale = minOf(1f, maxDim.toFloat() / maxOf(rawBitmap.width, rawBitmap.height).coerceAtLeast(1))
            val scaled = if (scale < 1f) {
                Bitmap.createScaledBitmap(
                    rawBitmap,
                    (rawBitmap.width * scale).toInt().coerceAtLeast(1),
                    (rawBitmap.height * scale).toInt().coerceAtLeast(1),
                    true
                )
            } else {
                rawBitmap
            }
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 82, out)
            val jpegBytes = out.toByteArray()
            val imgDir = File(context.filesDir, "chat_images").apply { mkdirs() }
            val destFile = File(imgDir, "img_${UUID.randomUUID()}.jpg")
            destFile.writeBytes(jpegBytes)
            val b64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP)
            Triple(displayName, "data:image/jpeg;base64,$b64", destFile.absolutePath)
        }.onSuccess { (name, dataUri, localPath) ->
            viewModel.addDraftImage(name, dataUri, localPath)
        }.onFailure {
            viewModel.notify(it.message ?: "读取图片失败。")
        }
    }

    val exportMdLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("text/markdown")
    ) { uri ->
        val md = pendingExportMd
        pendingExportMd = null
        if (uri == null || md == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use { it.write(md) }
                ?: throw IllegalStateException("无法写入 Markdown 文件。")
        }.onSuccess {
            viewModel.notify("对话已导出为 Markdown 文件。")
        }.onFailure {
            viewModel.notify(it.message ?: "导出对话失败。")
        }
    }

    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()

    val showScrollToBottom by remember {
        derivedStateOf {
            val total = listState.layoutInfo.totalItemsCount
            val lastVisible = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            total > 3 && lastVisible < total - 2
        }
    }

    LaunchedEffect(messages.size, streaming.content.length, streaming.reasoning.length) {
        val targetIndex = messages.size + if (streaming.isStreaming) 1 else 0
        if (targetIndex > 0) {
            listState.animateScrollToItem(targetIndex - 1)
        }
    }

    val garden = LocalGardenColors.current

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(garden.paper)
            .imePadding()
    ) {
        // 1. Mobile-Web-Aligned Header Strip: 「今天，聊点什么？」 + 历史对话 / 新建对话
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 6.dp),
            shape = RoundedCornerShape(10.dp),
            color = garden.paperCard,
            border = BorderStroke(1.dp, garden.line)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = if (isGroup) activeConversation?.title ?: "雅集群聊" else "今天，聊点什么？",
                    style = MaterialTheme.typography.titleMedium,
                    color = garden.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Spacer(Modifier.width(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    GardenWindowButton(
                        text = "导出",
                        onClick = {
                            viewModel.exportActiveConversationMarkdown { fileName, md ->
                                pendingExportMd = md
                                exportMdLauncher.launch(fileName)
                            }
                        }
                    )
                    GardenWindowButton(
                        text = "历史",
                        onClick = { showHistorySheet = true }
                    )
                    GardenWindowButton(
                        text = "新建",
                        primary = true,
                        onClick = { viewModel.startNewConversation() }
                    )
                }
            }
        }

        // 2. Persona Picker + Group Chat + Status Badge Strip
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp),
            shape = RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp),
            color = garden.paperCard,
            border = BorderStroke(0.9.dp, garden.line)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    Surface(
                        modifier = Modifier
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { personaMenuExpanded = true },
                        shape = RoundedCornerShape(10.dp),
                        color = if (personaMenuExpanded) garden.paperCard else garden.paper,
                        border = BorderStroke(
                            width = if (personaMenuExpanded) 1.3.dp else 0.9.dp,
                            color = if (personaMenuExpanded) garden.gold else garden.line
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            GardenSealAvatar(
                                label = if (isGroup) "群" else activePersona?.avatar.orEmpty().ifBlank { activePersona?.name?.take(1) ?: "望" },
                                size = 30.dp
                            )
                            Spacer(Modifier.width(8.dp))
                            Column(modifier = Modifier.weight(1f, fill = false)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = if (isGroup) "群聊（${activeConversation?.participantIds?.split(",")?.size ?: 0}人）" else activePersona?.name ?: "望舒",
                                        style = MaterialTheme.typography.titleSmall,
                                        color = garden.ink,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Spacer(Modifier.width(2.dp))
                                    Icon(
                                        imageVector = if (personaMenuExpanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                                        contentDescription = "切换角色",
                                        tint = if (personaMenuExpanded) garden.bamboo else garden.muted,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                                Text(
                                    text = if (isGroup) "支持 @角色名 点名发言" else if (effectiveModel.isNotBlank()) effectiveModel else "未配置模型",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (isGroup || effectiveModel.isNotBlank()) garden.muted else garden.cinnabar,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }

                    DropdownMenu(
                        expanded = personaMenuExpanded,
                        onDismissRequest = { personaMenuExpanded = false },
                        shape = RoundedCornerShape(10.dp),
                        containerColor = garden.paperCard,
                        tonalElevation = 0.dp,
                        shadowElevation = 6.dp,
                        border = BorderStroke(1.2.dp, garden.gold.copy(alpha = 0.78f)),
                        modifier = Modifier.widthIn(min = 216.dp, max = 276.dp)
                    ) {
                        Text(
                            text = "切换对话角色",
                            style = MaterialTheme.typography.labelSmall,
                            color = garden.muted,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                        )
                        HorizontalDivider(color = garden.lineSoft, modifier = Modifier.padding(bottom = 4.dp))
                        personas.forEach { role ->
                            val isSelected = !isGroup && role.id == activePersona?.id
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isSelected) garden.bambooSoft else Color.Transparent)
                                    .clickable {
                                        personaMenuExpanded = false
                                        viewModel.selectPersona(role.id)
                                    }
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(IntrinsicSize.Min),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    if (isSelected) {
                                        Box(
                                            modifier = Modifier
                                                .width(3.dp)
                                                .fillMaxHeight()
                                                .background(garden.bamboo)
                                        )
                                    }
                                    Row(
                                        modifier = Modifier
                                            .weight(1f)
                                            .padding(horizontal = 10.dp, vertical = 8.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        GardenSealAvatar(
                                            label = role.avatar.ifBlank { role.name.take(1).ifBlank { "🌿" } },
                                            size = 28.dp
                                        )
                                        Spacer(Modifier.width(9.dp))
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                text = role.name,
                                                fontFamily = FontFamily.Serif,
                                                fontSize = 14.sp,
                                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                                color = if (isSelected) garden.bamboo else garden.ink,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            Text(
                                                text = role.model.ifBlank { role.tone.ifBlank { "跟随全局默认模型" } },
                                                style = MaterialTheme.typography.labelSmall,
                                                color = garden.muted,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }
                                        if (isSelected) {
                                            Icon(
                                                imageVector = Icons.Default.Check,
                                                contentDescription = "当前角色",
                                                tint = garden.bamboo,
                                                modifier = Modifier.size(16.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(Modifier.width(8.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    GardenWindowButton(
                        text = "当前状态",
                        onClick = { showChatStateDrawer = !showChatStateDrawer }
                    )
                    GardenWindowButton(
                        text = "群聊",
                        onClick = { showGroupDialog = true }
                    )
                }
            }
        }

        // 2.5 Collapsible 「当前状态」 Strip (aligned with mobile web live-v4-6-mobile-390.png)
        AnimatedVisibility(visible = showChatStateDrawer) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp),
                color = garden.paperCard,
                border = BorderStroke(0.8.dp, garden.lineSoft)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showChatStateDialog = true }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            GardenTagPill(text = "你", accent = garden.paperCard, background = garden.bamboo)
                            Text(
                                text = activeConversation?.userMood?.ifBlank { null } ?: "暂不判断 · 点击设置当前状态",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.text,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            GardenTagPill(text = "角色", accent = garden.paperCard, background = garden.gold)
                            Text(
                                text = activeConversation?.assistantStyle?.ifBlank { null } ?: "跟随人设 · 正常",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.text,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                    GardenTagPill(
                        text = activeConversation?.relationshipStage?.ifBlank { null } ?: "初识",
                        accent = garden.gold,
                        background = garden.goldSoft
                    )
                }
            }
        }

        // 2.6 Mobile-Web-Aligned Reply Linkage Bar (回复联动：音乐 · 表情 · 工具)
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp),
            color = garden.paperCard,
            border = BorderStroke(0.7.dp, garden.lineSoft)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                val activeFeatures = buildList {
                    if (settings.musicEnabled) add("音乐")
                    if (settings.stickerEnabled) add("表情")
                    if (settings.toolsEnabled) add("工具")
                }.ifEmpty { listOf("纯对话") }
                Text(
                    text = "回复联动：${activeFeatures.joinToString(" · ")}",
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.muted
                )
                TextButton(
                    onClick = { showLinkageDialog = true },
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                    modifier = Modifier.height(26.dp)
                ) {
                    Text("回复设置", style = MaterialTheme.typography.labelSmall, color = garden.bamboo)
                }
            }
        }

        // 3. HTTP 429 Quota Checkpoint & Auto-Resume Banner
        quotaCheckpoint?.let { cp ->
            QuotaCheckpointBanner(
                checkpoint = cp,
                onRetryNow = { viewModel.retryQuotaCheckpointNow() },
                onCancel = { viewModel.cancelQuotaCheckpoint() }
            )
        }

        // 4. Message List inside Xuan-paper Garden Canvas + Floating "↓ 回到最新回复" Pill
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 10.dp)
                .background(garden.paperCard.copy(alpha = 0.65f))
                .border(0.8.dp, garden.lineSoft)
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                if (messages.isEmpty() && !streaming.isStreaming) {
                    item(key = "welcome") {
                        WelcomeCard(persona = activePersona, effectiveModel = effectiveModel, isGroup = isGroup)
                    }
                }

                items(messages, key = { it.id }) { msg ->
                    val senderRole = msg.senderPersonaId?.let { personaMap[it] } ?: activePersona
                    MessageBubble(
                        message = msg,
                        speakerName = msg.senderName?.ifBlank { null } ?: senderRole?.name ?: "望舒",
                        speakerAvatar = senderRole?.avatar.orEmpty().ifBlank { senderRole?.name?.take(1) ?: "望" },
                        userAvatar = settings.userAvatar.ifBlank { "我" },
                        onBranch = { viewModel.branchFromMessage(msg.id) },
                        onRemember = { viewModel.rememberFromChat(msg.content) },
                        onCopy = {
                            clipboard.setText(AnnotatedString(msg.content))
                            viewModel.notify("已复制到剪贴板")
                        },
                        onRegenerate = { viewModel.regenerateAssistantMessage(msg) },
                        onWriteMail = {
                            val title = activeConversation?.title?.ifBlank { "栖忆对谈摘录" } ?: "栖忆对谈摘录"
                            onWriteAsMail(title, msg.content)
                        },
                        onPreviewImage = { path -> lightboxImagePath = path }
                    )
                }

                if (streaming.isStreaming) {
                    item(key = "streaming") {
                        StreamingBubble(
                            streaming = streaming,
                            onStop = { viewModel.stopGeneration() }
                        )
                    }
                }
            }

            // Floating "↓ 回到最新回复" Pill (aligned with composer-6-mobile-pinned.png)
            androidx.compose.animation.AnimatedVisibility(
                visible = showScrollToBottom,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 10.dp)
            ) {
                Surface(
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .clickable {
                            coroutineScope.launch {
                                val last = (messages.size + if (streaming.isStreaming) 1 else 0 - 1).coerceAtLeast(0)
                                listState.animateScrollToItem(last)
                            }
                        },
                    shape = RoundedCornerShape(999.dp),
                    color = garden.paperCard,
                    shadowElevation = 4.dp,
                    border = BorderStroke(1.dp, garden.line)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.ArrowDownward,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = garden.ink
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = "回到最新回复",
                            style = MaterialTheme.typography.labelMedium,
                            color = garden.ink
                        )
                    }
                }
            }
        }

        // 5. Mobile-Web-Aligned Collapsible Bottom Composer
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(garden.paper)
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(1.5.dp)
                    .background(garden.ink.copy(alpha = 0.7f))
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "发送消息",
                        style = MaterialTheme.typography.labelMedium,
                        color = garden.ink,
                        fontWeight = FontWeight.SemiBold
                    )
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { attachFileLauncher.launch(arrayOf("text/*", "application/json", "*/*")) }
                            .padding(horizontal = 4.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.AttachFile,
                            contentDescription = "添加文件",
                            modifier = Modifier.size(14.dp),
                            tint = garden.bamboo
                        )
                        Text(
                            text = "+ 文件",
                            style = MaterialTheme.typography.labelSmall,
                            color = garden.bamboo,
                            fontWeight = FontWeight.Medium
                        )
                    }
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { attachImageLauncher.launch("image/*") }
                            .padding(horizontal = 4.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Image,
                            contentDescription = "添加图片",
                            modifier = Modifier.size(14.dp),
                            tint = garden.gold
                        )
                        Text(
                            text = "+ 图片",
                            style = MaterialTheme.typography.labelSmall,
                            color = garden.gold,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "换行继续写，轻触发送",
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.muted
                    )
                    Surface(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .clickable { composerCollapsed = !composerCollapsed },
                        shape = RoundedCornerShape(999.dp),
                        color = garden.paperCard,
                        border = BorderStroke(0.8.dp, garden.line)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = if (composerCollapsed) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp),
                                tint = garden.muted
                            )
                            Text(
                                text = if (composerCollapsed) "展开" else "隐藏",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.muted
                            )
                        }
                    }
                }
            }

            AnimatedVisibility(visible = !composerCollapsed) {
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 10.dp, end = 10.dp, bottom = 8.dp),
                    shape = RoundedCornerShape(10.dp),
                    color = garden.paperCard,
                    border = BorderStroke(1.dp, garden.line)
                ) {
                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                        if (draftAttachments.isNotEmpty()) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState())
                                    .padding(bottom = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                draftAttachments.forEachIndexed { idx, att ->
                                    if (att.isImage && att.localPath.isNotBlank()) {
                                        val thumbBitmap = remember(att.localPath) {
                                            runCatching { BitmapFactory.decodeFile(att.localPath)?.asImageBitmap() }.getOrNull()
                                        }
                                        Box(
                                            modifier = Modifier
                                                .size(68.dp)
                                                .clip(RoundedCornerShape(8.dp))
                                                .border(1.dp, garden.gold.copy(alpha = 0.7f), RoundedCornerShape(8.dp))
                                                .clickable { lightboxImagePath = att.localPath }
                                        ) {
                                            if (thumbBitmap != null) {
                                                Image(
                                                    bitmap = thumbBitmap,
                                                    contentDescription = att.name,
                                                    contentScale = ContentScale.Crop,
                                                    modifier = Modifier.fillMaxSize()
                                                )
                                            } else {
                                                Box(
                                                    modifier = Modifier
                                                        .fillMaxSize()
                                                        .background(garden.paperDeep),
                                                    contentAlignment = Alignment.Center
                                                ) {
                                                    Icon(Icons.Default.Image, contentDescription = null, tint = garden.muted)
                                                }
                                            }
                                            Box(
                                                modifier = Modifier
                                                    .align(Alignment.TopEnd)
                                                    .padding(3.dp)
                                                    .size(18.dp)
                                                    .clip(CircleShape)
                                                    .background(Color.Black.copy(alpha = 0.65f))
                                                    .clickable { viewModel.removeDraftAttachment(idx) },
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Default.Close,
                                                    contentDescription = "移除图片",
                                                    modifier = Modifier.size(12.dp),
                                                    tint = Color.White
                                                )
                                            }
                                        }
                                    } else {
                                        Surface(
                                            shape = RoundedCornerShape(6.dp),
                                            color = garden.bambooSoft,
                                            border = BorderStroke(0.8.dp, garden.lineStrong)
                                        ) {
                                            Row(
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                                verticalAlignment = Alignment.CenterVertically
                                            ) {
                                                Text(
                                                    text = att.name,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = garden.ink,
                                                    maxLines = 1,
                                                    overflow = TextOverflow.Ellipsis
                                                )
                                                Spacer(Modifier.width(4.dp))
                                                Icon(
                                                    imageVector = Icons.Default.Close,
                                                    contentDescription = "移除附件",
                                                    modifier = Modifier
                                                        .size(14.dp)
                                                        .clickable { viewModel.removeDraftAttachment(idx) },
                                                    tint = garden.muted
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 8.dp)
                        ) {
                            if (draft.isEmpty()) {
                                Text(
                                    text = if (isGroup) "在群聊中发言，或用 @角色名 指定回复..." else "和${activePersona?.name ?: "望舒"}聊聊今天的想法...",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = garden.muted
                                )
                            }
                            BasicTextField(
                                value = draft,
                                onValueChange = { draft = it },
                                textStyle = MaterialTheme.typography.bodyMedium.copy(color = garden.text),
                                cursorBrush = SolidColor(garden.bamboo),
                                maxLines = 4,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        HorizontalDivider(color = garden.lineSoft)
                        Spacer(Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = "对话保存在本地，发送时调用所选模型",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.muted,
                                modifier = Modifier.weight(1f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(Modifier.width(8.dp))
                            if (streaming.isStreaming) {
                                CinnabarPillButton(
                                    text = "停止",
                                    onClick = { viewModel.stopGeneration() },
                                    icon = {
                                        Icon(
                                            imageVector = Icons.Default.StopCircle,
                                            contentDescription = null,
                                            tint = garden.paperCard,
                                            modifier = Modifier.size(16.dp)
                                        )
                                    }
                                )
                            } else {
                                CinnabarPillButton(
                                    text = "发送",
                                    enabled = draft.isNotBlank() || draftAttachments.isNotEmpty(),
                                    onClick = {
                                        val toSend = draft.trim()
                                        if (toSend.isNotEmpty() || draftAttachments.isNotEmpty()) {
                                            draft = ""
                                            viewModel.sendMessage(toSend)
                                        }
                                    },
                                    icon = {
                                        Icon(
                                            imageVector = Icons.AutoMirrored.Filled.Send,
                                            contentDescription = null,
                                            tint = garden.paperCard,
                                            modifier = Modifier.size(15.dp)
                                        )
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showHistorySheet) {
        ModalBottomSheet(
            onDismissRequest = { showHistorySheet = false },
            containerColor = garden.paperCard
        ) {
            ConversationHistorySheet(
                conversations = allConversations,
                activeConversationId = activeConversationId,
                onSelect = { id ->
                    showHistorySheet = false
                    viewModel.selectConversation(id)
                },
                onNewChat = {
                    showHistorySheet = false
                    viewModel.startNewConversation()
                },
                onDelete = { id -> viewModel.deleteConversation(id) }
            )
        }
    }

    if (showChatStateDialog) {
        ChatStateEditorDialog(
            initialMood = activeConversation?.userMood.orEmpty(),
            initialStyle = activeConversation?.assistantStyle.orEmpty(),
            initialStage = activeConversation?.relationshipStage.orEmpty().ifBlank { "初识" },
            onDismiss = { showChatStateDialog = false },
            onSave = { mood, style, stage ->
                showChatStateDialog = false
                viewModel.updateChatState(mood, style, stage)
            }
        )
    }

    if (showLinkageDialog) {
        AlertDialog(
            onDismissRequest = { showLinkageDialog = false },
            title = { Text("回复联动设置") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { viewModel.setLinkageFlags(musicEnabled = !settings.musicEnabled) },
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Checkbox(
                            checked = settings.musicEnabled,
                            onCheckedChange = { viewModel.setLinkageFlags(musicEnabled = it) }
                        )
                        Column {
                            Text("音乐点播联动", style = MaterialTheme.typography.bodyMedium)
                            Text("说「放一首…」自动搜索本地/在线曲库播放", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                        }
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { viewModel.setLinkageFlags(stickerEnabled = !settings.stickerEnabled) },
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Checkbox(
                            checked = settings.stickerEnabled,
                            onCheckedChange = { viewModel.setLinkageFlags(stickerEnabled = it) }
                        )
                        Column {
                            Text("表情包联动", style = MaterialTheme.typography.bodyMedium)
                            Text("根据回复语气自动附带「小叶」原创表情包", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                        }
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { viewModel.setLinkageFlags(toolsEnabled = !settings.toolsEnabled) },
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Checkbox(
                            checked = settings.toolsEnabled,
                            onCheckedChange = { viewModel.setLinkageFlags(toolsEnabled = it) }
                        )
                        Column {
                            Text("智能工具调用 (ReAct)", style = MaterialTheme.typography.bodyMedium)
                            Text("允许自动调用计算器、日期、统计与知识深搜", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                        }
                    }
                }
            },
            confirmButton = {
                Button(onClick = { showLinkageDialog = false }) { Text("完成") }
            }
        )
    }

    if (showGroupDialog) {
        CreateGroupChatDialog(
            personas = personas,
            onDismiss = { showGroupDialog = false },
            onCreate = { selectedIds, title ->
                showGroupDialog = false
                viewModel.createGroupConversation(selectedIds, title)
            }
        )
    }
    lightboxImagePath?.let { path ->
        ImageLightboxDialog(
            imagePath = path,
            onDismiss = { lightboxImagePath = null }
        )
    }
}

@Composable
private fun QuotaCheckpointBanner(
    checkpoint: QuotaCheckpointState,
    onRetryNow: () -> Unit,
    onCancel: () -> Unit
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 4.dp),
        shape = RoundedCornerShape(8.dp),
        color = garden.goldSoft,
        border = BorderStroke(1.dp, garden.gold)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "额度受限 · 断点已存档",
                    style = MaterialTheme.typography.labelMedium,
                    color = garden.cinnabarDark,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "将在 ${checkpoint.remainingSeconds} 秒后自动续跑（剩余 ${checkpoint.pendingPersonaIds.size} 位角色）",
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.text
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onRetryNow, contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)) {
                    Text("立即重试", style = MaterialTheme.typography.labelSmall, color = garden.bamboo)
                }
                TextButton(onClick = onCancel, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp)) {
                    Text("取消", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                }
            }
        }
    }
}

@Composable
private fun WelcomeCard(persona: PersonaEntity?, effectiveModel: String, isGroup: Boolean) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = garden.paperCard,
        border = BorderStroke(1.dp, garden.line)
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            GardenSealAvatar(
                label = if (isGroup) "群" else persona?.avatar.orEmpty().ifBlank { persona?.name?.take(1) ?: "望" },
                size = 50.dp
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = if (isGroup) "多角色雅集群聊" else persona?.name ?: "望舒",
                style = MaterialTheme.typography.titleLarge,
                color = garden.ink
            )
            if (!isGroup && !persona?.description.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = persona!!.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = garden.muted
                )
            }
            Spacer(Modifier.height(10.dp))
            HorizontalDivider(color = garden.lineSoft)
            Spacer(Modifier.height(10.dp))
            Text(
                text = if (isGroup) {
                    "每位角色都将使用各自的人设与专属模型依次回应；发送消息时可用 @角色名 点名某位角色发言。"
                } else {
                    persona?.greeting.orEmpty().ifBlank { "你好呀，今天想聊点什么？" }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = garden.text
            )
            if (!isGroup && effectiveModel.isBlank()) {
                Spacer(Modifier.height(10.dp))
                Text(
                    text = "提示：请先前往顶部「设置」填写模型服务 Base URL、API Key 与默认模型 ID。",
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.cinnabar
                )
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: MessageEntity,
    speakerName: String,
    speakerAvatar: String,
    userAvatar: String,
    onBranch: () -> Unit,
    onRemember: () -> Unit,
    onCopy: () -> Unit,
    onRegenerate: () -> Unit,
    onWriteMail: () -> Unit,
    onPreviewImage: (String) -> Unit
) {
    val isUser = message.role == "user"
    val garden = LocalGardenColors.current
    val timeFormatter = remember { SimpleDateFormat("MM/dd HH:mm", Locale.getDefault()) }
    var reasoningExpanded by remember(message.id) { mutableStateOf(false) }

    if (isUser) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.End
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.padding(bottom = 5.dp)
            ) {
                Text(
                    text = timeFormatter.format(Date(message.createdAt)),
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.muted
                )
                Text(
                    text = "你",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = garden.ink
                )
                GardenSealAvatar(label = userAvatar, size = 26.dp, isUser = true)
            }

            // Signature Begonia-Notched Bamboo Plaque User Bubble
            val plaqueShape = remember { BegoniaPlaqueShape(8.dp) }
            val attachedImagePaths = remember(message.imagePathsJson) {
                if (message.imagePathsJson.isBlank()) emptyList()
                else runCatching {
                    Json.decodeFromString(ListSerializer(String.serializer()), message.imagePathsJson)
                }.getOrDefault(emptyList())
            }
            Box(
                modifier = Modifier
                    .widthIn(max = 310.dp)
                    .clip(plaqueShape)
                    .background(garden.userBubble)
                    .border(1.dp, garden.gold.copy(alpha = 0.5f), plaqueShape)
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (attachedImagePaths.isNotEmpty()) {
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            attachedImagePaths.forEach { imgPath ->
                                val bmp = remember(imgPath) {
                                    runCatching { BitmapFactory.decodeFile(imgPath)?.asImageBitmap() }.getOrNull()
                                }
                                if (bmp != null) {
                                    Image(
                                        bitmap = bmp,
                                        contentDescription = "已发送图片预览",
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier
                                            .size(if (attachedImagePaths.size == 1) 168.dp else 104.dp)
                                            .clip(RoundedCornerShape(8.dp))
                                            .border(0.8.dp, garden.gold.copy(alpha = 0.6f), RoundedCornerShape(8.dp))
                                            .clickable { onPreviewImage(imgPath) }
                                    )
                                }
                            }
                        }
                    }
                    SelectionContainer {
                        GardenMarkdownText(
                            markdown = message.content,
                            textColor = garden.onUserBubble,
                            isOnDarkBubble = true
                        )
                    }
                }
            }
        }
    } else {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.Start
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(bottom = 6.dp)
            ) {
                GardenSealAvatar(label = speakerAvatar, size = 26.dp)
                Text(
                    text = speakerName,
                    fontFamily = FontFamily.Serif,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    color = garden.ink
                )
                Text(
                    text = timeFormatter.format(Date(message.createdAt)),
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.muted
                )
            }

            if (message.toolTrace.isNotBlank()) {
                var toolExpanded by remember(message.id) { mutableStateOf(false) }
                ReasoningBlock(
                    reasoning = message.toolTrace,
                    expanded = toolExpanded,
                    onToggle = { toolExpanded = !toolExpanded },
                    title = "工具调用过程"
                )
                Spacer(Modifier.height(6.dp))
            }

            if (message.reasoning.isNotBlank()) {
                ReasoningBlock(
                    reasoning = message.reasoning,
                    expanded = reasoningExpanded,
                    onToggle = { reasoningExpanded = !reasoningExpanded }
                )
                Spacer(Modifier.height(6.dp))
            }

            // Signature Xuan-paper Assistant Card with 3dp Cinnabar Left Vertical Accent Stripe
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(6.dp),
                color = garden.assistantBubble,
                border = BorderStroke(0.9.dp, garden.line)
            ) {
                Row(modifier = Modifier.height(IntrinsicSize.Min)) {
                    Box(
                        modifier = Modifier
                            .width(3.dp)
                            .fillMaxHeight()
                            .background(garden.cinnabar)
                    )
                    SelectionContainer(
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 13.dp, vertical = 11.dp)
                    ) {
                        val clipboard = LocalClipboardManager.current
                        GardenMarkdownText(
                            markdown = message.content,
                            textColor = garden.onAssistantBubble,
                            isOnDarkBubble = false,
                            onCopyCode = { code ->
                                clipboard.setText(AnnotatedString(code))
                            }
                        )
                    }
                }
            }

            if (message.stickerId.isNotBlank()) {
                val sticker = StickerCatalog.findById(message.stickerId)
                if (sticker != null) {
                    Spacer(Modifier.height(6.dp))
                    StickerCard(sticker = sticker, size = 76.dp)
                }
            }

            val citations = remember(message.citationsJson) { KnowledgeEngine.decodeCitations(message.citationsJson) }
            if (citations.isNotEmpty()) {
                var selectedCitation by remember { mutableStateOf<CitationItem?>(null) }
                Spacer(Modifier.height(6.dp))
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    citations.forEach { cite ->
                        Surface(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .clickable { selectedCitation = cite },
                            shape = RoundedCornerShape(6.dp),
                            color = garden.goldSoft,
                            border = BorderStroke(0.7.dp, garden.gold.copy(alpha = 0.6f))
                        ) {
                            Text(
                                text = "[${cite.index}] 《${cite.documentTitle.take(14)}》",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.ink,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 3.dp)
                            )
                        }
                    }
                }
                selectedCitation?.let { cite ->
                    AlertDialog(
                        onDismissRequest = { selectedCitation = null },
                        title = { Text("引用溯源 [${cite.index}] · 《${cite.documentTitle}》") },
                        text = { Text(cite.snippet, style = MaterialTheme.typography.bodySmall) },
                        confirmButton = {
                            TextButton(onClick = { selectedCitation = null }) { Text("关闭") }
                        }
                    )
                }
            }

            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                TextButton(
                    onClick = onCopy,
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    Icon(Icons.Default.ContentCopy, contentDescription = "复制", modifier = Modifier.size(13.dp), tint = garden.muted)
                    Spacer(Modifier.width(3.dp))
                    Text("复制", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                }
                TextButton(
                    onClick = onRegenerate,
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = "重新生成", modifier = Modifier.size(14.dp), tint = garden.muted)
                    Spacer(Modifier.width(3.dp))
                    Text("重生成", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                }
                TextButton(
                    onClick = onBranch,
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    Icon(Icons.AutoMirrored.Filled.CallSplit, contentDescription = "从此分支", modifier = Modifier.size(14.dp), tint = garden.muted)
                    Spacer(Modifier.width(3.dp))
                    Text("分支", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                }
                TextButton(
                    onClick = onRemember,
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    Icon(Icons.Default.BookmarkAdd, contentDescription = "记入长期记忆", modifier = Modifier.size(14.dp), tint = garden.muted)
                    Spacer(Modifier.width(3.dp))
                    Text("记住", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                }
                TextButton(
                    onClick = onWriteMail,
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    Icon(Icons.Default.MailOutline, contentDescription = "写成邮件", modifier = Modifier.size(14.dp), tint = garden.muted)
                    Spacer(Modifier.width(3.dp))
                    Text("写成邮件", style = MaterialTheme.typography.labelSmall, color = garden.muted)
                }
            }
        }
    }
}

@Composable
private fun StreamingBubble(
    streaming: StreamingState,
    onStop: () -> Unit
) {
    val garden = LocalGardenColors.current
    var reasoningExpanded by remember { mutableStateOf(true) }

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.Start
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(bottom = 6.dp)
        ) {
            GardenSealAvatar(label = streaming.speakerAvatar.ifBlank { "望" }, size = 26.dp)
            Text(
                text = streaming.speakerName.ifBlank { "正在回应" },
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                color = garden.ink
            )
            Text("回应中…", style = MaterialTheme.typography.labelSmall, color = garden.bamboo)
        }

        if (streaming.reasoning.isNotBlank()) {
            ReasoningBlock(
                reasoning = streaming.reasoning,
                expanded = reasoningExpanded,
                onToggle = { reasoningExpanded = !reasoningExpanded },
                title = "思考过程 · 推理中"
            )
            Spacer(Modifier.height(6.dp))
        }

        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(6.dp),
            color = garden.assistantBubble,
            border = BorderStroke(1.dp, garden.bamboo.copy(alpha = 0.6f))
        ) {
            Row(modifier = Modifier.height(IntrinsicSize.Min)) {
                Box(
                    modifier = Modifier
                        .width(3.dp)
                        .fillMaxHeight()
                        .background(garden.bamboo)
                )
                Text(
                    text = streaming.content.ifBlank { "正在组织回复…" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = garden.onAssistantBubble,
                    modifier = Modifier.padding(horizontal = 13.dp, vertical = 11.dp)
                )
            }
        }
        TextButton(
            onClick = onStop,
            contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
            modifier = Modifier.height(28.dp)
        ) {
            Text("停止生成", style = MaterialTheme.typography.labelSmall, color = garden.cinnabar)
        }
    }
}

@Composable
private fun ReasoningBlock(
    reasoning: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    title: String = "思考过程"
) {
    val garden = LocalGardenColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .clickable(onClick = onToggle)
            .padding(vertical = 2.dp)
    ) {
        Box(
            modifier = Modifier
                .width(2.dp)
                .fillMaxHeight()
                .background(garden.line)
        )
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(start = 10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = if (expanded) "▾ $title" else "▸ $title",
                    style = MaterialTheme.typography.labelMedium,
                    color = garden.muted
                )
            }
            AnimatedVisibility(visible = expanded) {
                Text(
                    text = reasoning,
                    style = MaterialTheme.typography.bodySmall,
                    color = garden.muted,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }
    }
}

@Composable
private fun ConversationHistorySheet(
    conversations: List<ConversationEntity>,
    activeConversationId: String?,
    onSelect: (String) -> Unit,
    onNewChat: () -> Unit,
    onDelete: (String) -> Unit
) {
    val garden = LocalGardenColors.current
    val formatter = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("历史对话", style = MaterialTheme.typography.titleMedium, color = garden.ink)
            GardenWindowButton(text = "新建对话", primary = true, onClick = onNewChat)
        }
        Spacer(Modifier.height(10.dp))
        if (conversations.isEmpty()) {
            Text(
                text = "还没有历史对话记录。",
                style = MaterialTheme.typography.bodyMedium,
                color = garden.muted,
                modifier = Modifier.padding(vertical = 20.dp)
            )
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(320.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(conversations, key = { it.id }) { conv ->
                    val selected = conv.id == activeConversationId
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelect(conv.id) },
                        shape = RoundedCornerShape(8.dp),
                        color = if (selected) garden.bambooSoft else garden.paper,
                        border = BorderStroke(
                            0.9.dp,
                            if (selected) garden.bamboo else garden.line
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = conv.title,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                    color = garden.ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = buildString {
                                        append(formatter.format(Date(conv.updatedAt)))
                                        if (conv.isGroup) append(" · 群聊")
                                        if (conv.parentConversationId != null) append(" · 分支")
                                    },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = garden.muted
                                )
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (conv.isGroup) {
                                    Icon(Icons.Default.Groups, contentDescription = null, tint = garden.bamboo, modifier = Modifier.size(18.dp))
                                }
                                IconButton(
                                    onClick = { onDelete(conv.id) },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.DeleteOutline,
                                        contentDescription = "删除对话",
                                        tint = garden.cinnabar,
                                        modifier = Modifier.size(17.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun CreateGroupChatDialog(
    personas: List<PersonaEntity>,
    onDismiss: () -> Unit,
    onCreate: (participantIds: List<String>, title: String) -> Unit
) {
    val selectedIds = remember { mutableStateListOf<String>() }
    var title by remember { mutableStateOf("雅集群聊") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("发起多角色群聊") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("群聊名称") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Text(
                    text = "选择至少 2 位角色（各角色独立使用其专属模型）：",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (personas.size < 2) {
                    Text(
                        text = "当前只有 ${personas.size} 位角色，请先前往「人设」再新建一位角色。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                } else {
                    personas.forEach { role ->
                        val checked = role.id in selectedIds
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    if (checked) selectedIds.remove(role.id) else selectedIds.add(role.id)
                                },
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Checkbox(
                                checked = checked,
                                onCheckedChange = {
                                    if (it) selectedIds.add(role.id) else selectedIds.remove(role.id)
                                }
                            )
                            GardenSealAvatar(
                                label = role.avatar.ifBlank { role.name.take(1).ifBlank { "🌿" } },
                                size = 24.dp
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                text = role.name,
                                style = MaterialTheme.typography.bodyMedium
                            )
                            if (role.model.isNotBlank()) {
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    text = "(${role.model})",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onCreate(selectedIds.toList(), title) },
                enabled = selectedIds.size >= 2
            ) {
                Text("创建群聊")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

@Composable
private fun ChatStateEditorDialog(
    initialMood: String,
    initialStyle: String,
    initialStage: String,
    onDismiss: () -> Unit,
    onSave: (mood: String, style: String, stage: String) -> Unit
) {
    var mood by remember { mutableStateOf(initialMood) }
    var style by remember { mutableStateOf(initialStyle) }
    var stage by remember { mutableStateOf(initialStage) }

    val moodPresets = listOf("放松", "专注工作", "有些疲惫", "心情不错")
    val stylePresets = listOf("跟随人设", "更温柔陪伴", "简洁直接", "深入拆解")
    val stagePresets = listOf("初识", "熟稔", "知己")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("当前对话状态") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("你的当前状态", style = MaterialTheme.typography.labelMedium)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    moodPresets.forEach { preset ->
                        FilterChip(selected = mood == preset, onClick = { mood = preset }, label = { Text(preset) })
                    }
                }
                OutlinedTextField(
                    value = mood,
                    onValueChange = { mood = it },
                    placeholder = { Text("或手动输入当前心情 / 精力") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Text("角色回复风格", style = MaterialTheme.typography.labelMedium)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    stylePresets.forEach { preset ->
                        FilterChip(selected = style == preset, onClick = { style = preset }, label = { Text(preset) })
                    }
                }
                Text("默契关系阶段", style = MaterialTheme.typography.labelMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    stagePresets.forEach { preset ->
                        FilterChip(selected = stage == preset, onClick = { stage = preset }, label = { Text(preset) })
                    }
                }
            }
        },
        confirmButton = {
            Button(onClick = { onSave(mood, style, stage) }) {
                Text("应用状态")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}

@Composable
private fun ImageLightboxDialog(
    imagePath: String,
    onDismiss: () -> Unit
) {
    val fullBitmap = remember(imagePath) {
        runCatching { BitmapFactory.decodeFile(imagePath)?.asImageBitmap() }.getOrNull()
    }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.88f))
                .clickable(onClick = onDismiss),
            contentAlignment = Alignment.Center
        ) {
            if (fullBitmap != null) {
                Image(
                    bitmap = fullBitmap,
                    contentDescription = "图片大图预览",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                )
            } else {
                Text("图片文件不存在或已移除", color = Color.White)
            }
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(24.dp)
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(Color.Black.copy(alpha = 0.6f))
                    .clickable(onClick = onDismiss),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Close, contentDescription = "关闭预览", tint = Color.White)
            }
        }
    }
}

/**
 * Preserved helper alias used by PersonasScreen.
 */
@Composable
fun AvatarBadge(avatar: String, size: Int) {
    GardenSealAvatar(label = avatar, size = size.dp)
}
