package com.qiyi.companion.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CallSplit
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AddComment
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.StopCircle
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.db.ConversationEntity
import com.qiyi.companion.data.db.MessageEntity
import com.qiyi.companion.data.db.PersonaEntity
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.StreamingState
import com.qiyi.companion.ui.theme.LocalGardenColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    viewModel: QiYiViewModel,
    modifier: Modifier = Modifier
) {
    val personas by viewModel.personas.collectAsStateWithLifecycle()
    val activePersonaId by viewModel.activePersonaId.collectAsStateWithLifecycle()
    val activeConversationId by viewModel.activeConversationId.collectAsStateWithLifecycle()
    val conversations by viewModel.conversations.collectAsStateWithLifecycle()
    val messages by viewModel.messages.collectAsStateWithLifecycle()
    val streaming by viewModel.streaming.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()

    val activePersona = personas.firstOrNull { it.id == activePersonaId } ?: personas.firstOrNull()
    val effectiveModel = viewModel.effectiveModelFor(activePersona)

    var draft by rememberSaveable { mutableStateOf("") }
    var personaMenuExpanded by remember { mutableStateOf(false) }
    var showHistorySheet by remember { mutableStateOf(false) }

    val listState = rememberLazyListState()
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
            .background(MaterialTheme.colorScheme.background)
            .imePadding()
    ) {
        // Top Garden Header
        Surface(
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 1.dp,
            border = BorderStroke(0.5.dp, garden.subtleBorder)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    Row(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { personaMenuExpanded = true }
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        AvatarBadge(
                            avatar = activePersona?.avatar.orEmpty().ifBlank { "🌿" },
                            size = 36
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f, fill = false)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = activePersona?.name ?: "栖忆",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Icon(
                                    imageVector = Icons.Default.ArrowDropDown,
                                    contentDescription = "切换角色",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            Text(
                                text = if (effectiveModel.isNotBlank()) "模型：$effectiveModel" else "未配置模型（前往设置）",
                                style = MaterialTheme.typography.labelSmall,
                                color = if (effectiveModel.isNotBlank()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }

                    DropdownMenu(
                        expanded = personaMenuExpanded,
                        onDismissRequest = { personaMenuExpanded = false }
                    ) {
                        personas.forEach { role ->
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(
                                            text = "${role.avatar.ifBlank { "🌿" }}  ${role.name}",
                                            fontWeight = if (role.id == activePersona?.id) FontWeight.Bold else FontWeight.Normal
                                        )
                                        if (role.model.isNotBlank()) {
                                            Text(
                                                text = "专属模型：${role.model}",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.primary
                                            )
                                        }
                                    }
                                },
                                onClick = {
                                    personaMenuExpanded = false
                                    viewModel.selectPersona(role.id)
                                }
                            )
                        }
                    }
                }

                IconButton(onClick = { showHistorySheet = true }) {
                    Icon(
                        imageVector = Icons.Default.History,
                        contentDescription = "历史对话",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                IconButton(onClick = { viewModel.startNewConversation() }) {
                    Icon(
                        imageVector = Icons.Default.AddComment,
                        contentDescription = "新建对话",
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }

        // Message List
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (messages.isEmpty() && !streaming.isStreaming) {
                item(key = "welcome") {
                    WelcomeCard(persona = activePersona, effectiveModel = effectiveModel)
                }
            }

            items(messages, key = { it.id }) { msg ->
                MessageBubble(
                    message = msg,
                    personaAvatar = activePersona?.avatar.orEmpty().ifBlank { "🌿" },
                    userAvatar = settings.userAvatar.ifBlank { "我" },
                    onBranch = { viewModel.branchFromMessage(msg.id) }
                )
            }

            if (streaming.isStreaming) {
                item(key = "streaming") {
                    StreamingBubble(
                        streaming = streaming,
                        personaAvatar = activePersona?.avatar.orEmpty().ifBlank { "🌿" },
                        onStop = { viewModel.stopGeneration() }
                    )
                }
            }
        }

        // Bottom Composer
        Surface(
            color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(0.5.dp, garden.subtleBorder)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.weight(1f),
                    placeholder = {
                        Text(
                            text = "和${activePersona?.name ?: "栖忆"}说点什么…",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    },
                    maxLines = 4,
                    shape = RoundedCornerShape(18.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.background,
                        unfocusedContainerColor = MaterialTheme.colorScheme.background,
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = garden.subtleBorder
                    )
                )
                Spacer(Modifier.width(8.dp))
                if (streaming.isStreaming) {
                    FilledIconButton(
                        onClick = { viewModel.stopGeneration() },
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                            contentColor = MaterialTheme.colorScheme.onError
                        )
                    ) {
                        Icon(Icons.Default.StopCircle, contentDescription = "停止生成")
                    }
                } else {
                    FilledIconButton(
                        onClick = {
                            val toSend = draft.trim()
                            if (toSend.isNotEmpty()) {
                                draft = ""
                                viewModel.sendMessage(toSend)
                            }
                        },
                        enabled = draft.isNotBlank(),
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary
                        )
                    ) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "发送")
                    }
                }
            }
        }
    }

    if (showHistorySheet) {
        ModalBottomSheet(
            onDismissRequest = { showHistorySheet = false },
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            ConversationHistorySheet(
                conversations = conversations,
                activeConversationId = activeConversationId,
                onSelect = { id ->
                    showHistorySheet = false
                    viewModel.selectConversation(id)
                },
                onNewChat = {
                    showHistorySheet = false
                    viewModel.startNewConversation()
                }
            )
        }
    }
}

@Composable
private fun WelcomeCard(persona: PersonaEntity?, effectiveModel: String) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, garden.subtleBorder)
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            AvatarBadge(avatar = persona?.avatar.orEmpty().ifBlank { "🌿" }, size = 56)
            Spacer(Modifier.height(10.dp))
            Text(
                text = persona?.name ?: "望舒",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            if (!persona?.description.isNullOrBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = persona!!.description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (!persona?.greeting.isNullOrBlank()) {
                Spacer(Modifier.height(12.dp))
                HorizontalDivider(color = garden.subtleBorder)
                Spacer(Modifier.height(12.dp))
                Text(
                    text = persona!!.greeting,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            if (effectiveModel.isBlank()) {
                Spacer(Modifier.height(12.dp))
                Text(
                    text = "提示：请先前往底部「设置」填写模型服务 Base URL、API Key 与模型 ID。",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.secondary
                )
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: MessageEntity,
    personaAvatar: String,
    userAvatar: String,
    onBranch: () -> Unit
) {
    val isUser = message.role == "user"
    val garden = LocalGardenColors.current
    var reasoningExpanded by remember(message.id) { mutableStateOf(false) }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Top
    ) {
        if (!isUser) {
            AvatarBadge(avatar = personaAvatar, size = 32)
            Spacer(Modifier.width(8.dp))
        }

        Column(
            modifier = Modifier.widthIn(max = 310.dp),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start
        ) {
            Surface(
                shape = RoundedCornerShape(
                    topStart = 16.dp,
                    topEnd = 16.dp,
                    bottomStart = if (isUser) 16.dp else 4.dp,
                    bottomEnd = if (isUser) 4.dp else 16.dp
                ),
                color = if (isUser) garden.userBubble else garden.assistantBubble,
                border = if (isUser) null else BorderStroke(0.8.dp, garden.subtleBorder)
            ) {
                Column(modifier = Modifier.padding(horizontal = 13.dp, vertical = 10.dp)) {
                    if (!isUser && message.reasoning.isNotBlank()) {
                        ReasoningBlock(
                            reasoning = message.reasoning,
                            expanded = reasoningExpanded,
                            onToggle = { reasoningExpanded = !reasoningExpanded }
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    SelectionContainer {
                        Text(
                            text = message.content,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (isUser) garden.onUserBubble else garden.onAssistantBubble
                        )
                    }
                }
            }

            if (!isUser) {
                TextButton(
                    onClick = onBranch,
                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                    modifier = Modifier.height(28.dp)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.CallSplit,
                        contentDescription = "从此分支",
                        modifier = Modifier.size(14.dp)
                    )
                    Spacer(Modifier.width(4.dp))
                    Text("从此分支", style = MaterialTheme.typography.labelSmall)
                }
            }
        }

        if (isUser) {
            Spacer(Modifier.width(8.dp))
            AvatarBadge(avatar = userAvatar, size = 32)
        }
    }
}

@Composable
private fun StreamingBubble(
    streaming: StreamingState,
    personaAvatar: String,
    onStop: () -> Unit
) {
    val garden = LocalGardenColors.current
    var reasoningExpanded by remember { mutableStateOf(true) }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start,
        verticalAlignment = Alignment.Top
    ) {
        AvatarBadge(avatar = personaAvatar, size = 32)
        Spacer(Modifier.width(8.dp))
        Column(modifier = Modifier.widthIn(max = 310.dp)) {
            Surface(
                shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 4.dp),
                color = garden.assistantBubble,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.5f))
            ) {
                Column(modifier = Modifier.padding(horizontal = 13.dp, vertical = 10.dp)) {
                    if (streaming.reasoning.isNotBlank()) {
                        ReasoningBlock(
                            reasoning = streaming.reasoning,
                            expanded = reasoningExpanded,
                            onToggle = { reasoningExpanded = !reasoningExpanded },
                            title = "思考中…"
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    Text(
                        text = streaming.content.ifBlank { "正在回应…" },
                        style = MaterialTheme.typography.bodyMedium,
                        color = garden.onAssistantBubble
                    )
                }
            }
            TextButton(
                onClick = onStop,
                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                modifier = Modifier.height(28.dp)
            ) {
                Text("停止生成", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
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
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(garden.reasoningBg)
            .border(0.6.dp, garden.reasoningBorder, RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onToggle),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = FontWeight.Medium
            )
            Icon(
                imageVector = if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        AnimatedVisibility(visible = expanded) {
            Text(
                text = reasoning,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

@Composable
private fun ConversationHistorySheet(
    conversations: List<ConversationEntity>,
    activeConversationId: String?,
    onSelect: (String) -> Unit,
    onNewChat: () -> Unit
) {
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
            Text("历史对话", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            TextButton(onClick = onNewChat) {
                Text("新建对话")
            }
        }
        Spacer(Modifier.height(8.dp))
        if (conversations.isEmpty()) {
            Text(
                text = "当前角色还没有历史对话。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
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
                        shape = RoundedCornerShape(12.dp),
                        color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.background,
                        border = BorderStroke(
                            0.8.dp,
                            if (selected) MaterialTheme.colorScheme.primary else LocalGardenColors.current.subtleBorder
                        )
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                text = conv.title,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = buildString {
                                    append(formatter.format(Date(conv.updatedAt)))
                                    if (conv.parentConversationId != null) append(" · 分支")
                                },
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
fun AvatarBadge(avatar: String, size: Int) {
    val label = avatar.trim().ifEmpty { "🌿" }.take(2)
    Box(
        modifier = Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.primaryContainer)
            .border(0.8.dp, LocalGardenColors.current.goldAccent.copy(alpha = 0.6f), CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            style = if (size >= 48) MaterialTheme.typography.titleLarge else MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer
        )
    }
}
