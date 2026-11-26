package com.qiyi.companion.ui.screens

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.db.ScheduledTaskEntity
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.GardenTagPill
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.LocalGardenColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun TasksScreen(
    viewModel: QiYiViewModel,
    modifier: Modifier = Modifier
) {
    val tasks by viewModel.scheduledTasks.collectAsStateWithLifecycle()
    val personas by viewModel.personas.collectAsStateWithLifecycle()
    val runningTaskId by viewModel.runningTaskId.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current
    val formatter = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }
    val personaMap = remember(personas) { personas.associateBy { it.id } }

    var showCreateDialog by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(garden.paper)
    ) {
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
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("定时任务", style = MaterialTheme.typography.titleMedium, color = garden.ink)
                    Text(
                        text = "自动静默执行角色总结、每日提醒与定期简报",
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.muted
                    )
                }
                GardenWindowButton(
                    text = "新建任务",
                    primary = true,
                    onClick = { showCreateDialog = true }
                )
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (tasks.isEmpty()) {
                item(key = "empty_tasks") {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = garden.paperCard,
                        border = BorderStroke(0.8.dp, garden.line)
                    ) {
                        Text(
                            text = "尚未创建定时任务。点击右上角「新建任务」设置周期性提示词（如每日复盘、晨间问候），支持随时点击「立即运行」。",
                            style = MaterialTheme.typography.bodySmall,
                            color = garden.muted,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            } else {
                items(tasks, key = { it.id }) { task: ScheduledTaskEntity ->
                    val roleName = personaMap[task.personaId]?.name ?: "默认角色"
                    val isRunning = runningTaskId == task.id
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = garden.paperCard,
                        border = BorderStroke(0.9.dp, garden.line)
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Row(
                                    modifier = Modifier.weight(1f),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(Icons.Default.Schedule, contentDescription = null, tint = garden.bamboo, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(
                                        text = task.title,
                                        style = MaterialTheme.typography.titleSmall,
                                        color = garden.ink,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                Switch(
                                    checked = task.enabled,
                                    onCheckedChange = { enabled ->
                                        viewModel.saveScheduledTask(
                                            existingId = task.id,
                                            personaId = task.personaId,
                                            title = task.title,
                                            prompt = task.prompt,
                                            intervalMinutes = task.intervalMinutes,
                                            enabled = enabled
                                        )
                                    }
                                )
                            }

                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                GardenTagPill(text = roleName, accent = garden.ink, background = garden.bambooSoft)
                                GardenTagPill(text = "每 ${task.intervalMinutes} 分钟", accent = garden.ink, background = garden.goldSoft)
                            }

                            Spacer(Modifier.height(8.dp))
                            Text(text = task.prompt, style = MaterialTheme.typography.bodySmall, color = garden.text)

                            if (task.lastResult.isNotBlank()) {
                                Spacer(Modifier.height(8.dp))
                                HorizontalDivider(color = garden.lineSoft)
                                Spacer(Modifier.height(6.dp))
                                Text(
                                    text = "最近执行（${if (task.lastRunAt > 0) formatter.format(Date(task.lastRunAt)) else "刚刚"}）：",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = garden.bamboo,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    text = task.lastResult,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = garden.muted,
                                    maxLines = 5,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }

                            Spacer(Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                GardenWindowButton(
                                    text = if (isRunning) "执行中…" else "立即运行",
                                    primary = true,
                                    enabled = !isRunning,
                                    onClick = { viewModel.runScheduledTaskNow(task) }
                                )
                                IconButton(onClick = { viewModel.deleteScheduledTask(task) }) {
                                    Icon(Icons.Default.DeleteOutline, contentDescription = "删除任务", tint = garden.cinnabar)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreateDialog) {
        var title by remember { mutableStateOf("") }
        var prompt by remember { mutableStateOf("") }
        var interval by remember { mutableIntStateOf(60) }
        var selectedPersonaId by remember(personas) { mutableStateOf(personas.firstOrNull()?.id.orEmpty()) }

        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            title = { Text("新建定时任务") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        label = { Text("任务名称 *") },
                        placeholder = { Text("例如：晚间简短复盘") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = prompt,
                        onValueChange = { prompt = it },
                        label = { Text("执行提示词 *") },
                        placeholder = { Text("例如：请用三句话给我写一段温暖的晚安寄语。") },
                        minLines = 3,
                        maxLines = 5,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text("执行角色", style = MaterialTheme.typography.labelMedium)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        personas.forEach { role ->
                            FilterChip(
                                selected = selectedPersonaId == role.id,
                                onClick = { selectedPersonaId = role.id },
                                label = { Text(role.name) }
                            )
                        }
                    }
                    Text("执行间隔", style = MaterialTheme.typography.labelMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(15 to "15分钟", 60 to "1小时", 360 to "6小时", 1440 to "每天").forEach { (mins, label) ->
                            FilterChip(
                                selected = interval == mins,
                                onClick = { interval = mins },
                                label = { Text(label) }
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.saveScheduledTask(
                            existingId = null,
                            personaId = selectedPersonaId,
                            title = title,
                            prompt = prompt,
                            intervalMinutes = interval,
                            enabled = true
                        ) { showCreateDialog = false }
                    },
                    enabled = title.isNotBlank() && prompt.isNotBlank()
                ) { Text("保存任务") }
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) { Text("取消") }
            }
        )
    }
}
