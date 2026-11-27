package com.qiyi.companion.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.UnfoldLess
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.db.ConversationEntity
import com.qiyi.companion.data.db.PersonaEntity
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.GardenSealAvatar
import com.qiyi.companion.ui.theme.LocalGardenColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Left slide-out IDE-style collapsible folder history drawer:
 * - Groups single chats under each Persona folder (expandable/collapsible, + new chat, delete)
 * - Groups multi-persona group chats under a dedicated 「雅集群聊」 folder (+ new group, delete)
 */
@Composable
fun HistoryDrawerContent(
    viewModel: QiYiViewModel,
    onSelectConversationDone: () -> Unit,
    onCreateGroupChat: () -> Unit,
    onCloseDrawer: () -> Unit
) {
    val personas by viewModel.personas.collectAsStateWithLifecycle()
    val allConversations by viewModel.allConversations.collectAsStateWithLifecycle()
    val activeConversationId by viewModel.activeConversationId.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current

    // Folder expanded state map (key = personaId or "__group__"), defaults to expanded = true
    val expandedFolders = remember { mutableStateMapOf<String, Boolean>() }
    val formatter = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }

    val singleChatsByPersona = remember(allConversations) {
        allConversations.filter { !it.isGroup }.groupBy { it.personaId }
    }
    val groupChats = remember(allConversations) {
        allConversations.filter { it.isGroup }
    }

    val allFolderKeys = remember(personas) { personas.map { it.id } + GROUP_FOLDER_KEY }
    val anyExpanded = allFolderKeys.any { expandedFolders[it] ?: true }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(garden.paperCard)
            .statusBarsPadding()
    ) {
        // Drawer Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(garden.paper)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "栖忆 · 历史目录",
                    fontFamily = FontFamily.Serif,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = garden.ink
                )
                Text(
                    text = "共 ${allConversations.size} 段会话 · 点击目录折叠/展开",
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.muted
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(
                    onClick = {
                        val target = !anyExpanded
                        allFolderKeys.forEach { key -> expandedFolders[key] = target }
                    },
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(
                        imageVector = if (anyExpanded) Icons.Default.UnfoldLess else Icons.Default.UnfoldMore,
                        contentDescription = if (anyExpanded) "全部折叠" else "全部展开",
                        tint = garden.bamboo,
                        modifier = Modifier.size(18.dp)
                    )
                }
                IconButton(onClick = onCloseDrawer, modifier = Modifier.size(32.dp)) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = "关闭目录",
                        tint = garden.muted,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(garden.cinnabar)
        )

        // Collapsible Folder Tree
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 1. Persona Folders
            items(personas, key = { "folder_${it.id}" }) { role: PersonaEntity ->
                val convs = singleChatsByPersona[role.id].orEmpty()
                val expanded = expandedFolders[role.id] ?: true

                FolderSectionCard(
                    title = role.name,
                    subtitle = role.model.ifBlank { "默认模型" },
                    count = convs.size,
                    expanded = expanded,
                    leading = {
                        GardenSealAvatar(
                            label = role.avatar.ifBlank { role.name.take(1).ifBlank { "🌿" } },
                            size = 24.dp
                        )
                    },
                    onToggleExpand = { expandedFolders[role.id] = !expanded },
                    onCreateNew = {
                        viewModel.selectPersona(role.id)
                        onSelectConversationDone()
                    }
                ) {
                    if (convs.isEmpty()) {
                        Text(
                            text = "暂无对话，点击右侧 + 开启新会话",
                            style = MaterialTheme.typography.labelSmall,
                            color = garden.muted,
                            modifier = Modifier.padding(start = 26.dp, top = 4.dp, bottom = 6.dp)
                        )
                    } else {
                        convs.forEach { conv ->
                            ConversationTreeRow(
                                conv = conv,
                                selected = conv.id == activeConversationId,
                                formattedTime = formatter.format(Date(conv.updatedAt)),
                                onClick = {
                                    viewModel.selectConversation(conv.id)
                                    onSelectConversationDone()
                                },
                                onDelete = { viewModel.deleteConversation(conv.id) }
                            )
                        }
                    }
                }
            }

            // 2. Group Chats Folder (雅集群聊)
            item(key = "folder_group") {
                val expanded = expandedFolders[GROUP_FOLDER_KEY] ?: true
                FolderSectionCard(
                    title = "雅集群聊",
                    subtitle = "多角色协同对谈",
                    count = groupChats.size,
                    expanded = expanded,
                    leading = {
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(garden.bambooSoft),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Groups,
                                contentDescription = null,
                                tint = garden.bamboo,
                                modifier = Modifier.size(15.dp)
                            )
                        }
                    },
                    onToggleExpand = { expandedFolders[GROUP_FOLDER_KEY] = !expanded },
                    onCreateNew = {
                        onCloseDrawer()
                        onCreateGroupChat()
                    }
                ) {
                    if (groupChats.isEmpty()) {
                        Text(
                            text = "暂无群聊，点击右侧 + 发起雅集群聊",
                            style = MaterialTheme.typography.labelSmall,
                            color = garden.muted,
                            modifier = Modifier.padding(start = 26.dp, top = 4.dp, bottom = 6.dp)
                        )
                    } else {
                        groupChats.forEach { conv ->
                            ConversationTreeRow(
                                conv = conv,
                                selected = conv.id == activeConversationId,
                                formattedTime = formatter.format(Date(conv.updatedAt)),
                                onClick = {
                                    viewModel.selectConversation(conv.id)
                                    onSelectConversationDone()
                                },
                                onDelete = { viewModel.deleteConversation(conv.id) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FolderSectionCard(
    title: String,
    subtitle: String,
    count: Int,
    expanded: Boolean,
    leading: @Composable () -> Unit,
    onToggleExpand: () -> Unit,
    onCreateNew: () -> Unit,
    content: @Composable () -> Unit
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = garden.paper,
        border = BorderStroke(0.7.dp, garden.lineSoft)
    ) {
        Column(modifier = Modifier.padding(vertical = 4.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggleExpand)
                    .padding(horizontal = 10.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = if (expanded) Icons.Default.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = if (expanded) "折叠目录" else "展开目录",
                    tint = garden.muted,
                    modifier = Modifier.size(18.dp)
                )
                Icon(
                    imageVector = if (expanded) Icons.Default.FolderOpen else Icons.Default.Folder,
                    contentDescription = null,
                    tint = garden.gold,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(Modifier.width(6.dp))
                leading()
                Spacer(Modifier.width(7.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = title,
                            fontFamily = FontFamily.Serif,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 13.5.sp,
                            color = garden.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false)
                        )
                        Spacer(Modifier.width(5.dp))
                        Text(
                            text = "($count)",
                            style = MaterialTheme.typography.labelSmall,
                            color = garden.muted
                        )
                    }
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.labelSmall,
                        fontSize = 10.sp,
                        color = garden.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Surface(
                    modifier = Modifier
                        .size(28.dp)
                        .clip(CircleShape)
                        .clickable(onClick = onCreateNew),
                    shape = CircleShape,
                    color = garden.paperCard,
                    border = BorderStroke(0.7.dp, garden.line.copy(alpha = 0.8f))
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = "新建会话",
                            tint = garden.bamboo,
                            modifier = Modifier.size(15.dp)
                        )
                    }
                }
            }

            AnimatedVisibility(visible = expanded) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    HorizontalDivider(
                        color = garden.lineSoft,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                    content()
                }
            }
        }
    }
}

@Composable
private fun ConversationTreeRow(
    conv: ConversationEntity,
    selected: Boolean,
    formattedTime: String,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    val garden = LocalGardenColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 6.dp, top = 2.dp, bottom = 2.dp)
            .height(IntrinsicSize.Min)
    ) {
        // Editor-style vertical tree guide line
        Box(
            modifier = Modifier
                .width(1.dp)
                .fillMaxHeight()
                .background(if (selected) garden.bamboo else garden.lineSoft)
        )
        Spacer(Modifier.width(8.dp))
        Row(
            modifier = Modifier
                .weight(1f)
                .clip(RoundedCornerShape(6.dp))
                .background(if (selected) garden.bambooSoft else Color.Transparent)
                .clickable(onClick = onClick)
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = conv.title,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (selected) garden.bamboo else garden.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = buildString {
                        append(formattedTime)
                        if (conv.parentConversationId != null) append(" · 分支")
                    },
                    fontSize = 10.sp,
                    color = garden.muted
                )
            }
            IconButton(
                onClick = onDelete,
                modifier = Modifier.size(26.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.DeleteOutline,
                    contentDescription = "删除会话",
                    tint = garden.cinnabar.copy(alpha = 0.85f),
                    modifier = Modifier.size(15.dp)
                )
            }
        }
    }
}

private const val GROUP_FOLDER_KEY = "__group_chats__"
