package com.qiyi.companion.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Compress
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qiyi.companion.data.context.ContextPressureLevel
import com.qiyi.companion.data.context.ContextUsageSnapshot
import com.qiyi.companion.data.usage.UsageAnalytics
import com.qiyi.companion.ui.theme.GardenTagPill
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.IosSquircleShape
import com.qiyi.companion.ui.theme.LocalGardenColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val WindowLimitPresets = listOf(
    0 to "自动识别",
    32_000 to "32K",
    64_000 to "64K",
    128_000 to "128K",
    200_000 to "200K",
    1_000_000 to "1M"
)

private val KeepRecentPresets = listOf(2, 4, 6, 8)

@Composable
fun ContextCompactionSheet(
    snapshot: ContextUsageSnapshot,
    windowOverride: Int,
    isCompacting: Boolean,
    onCompactWithAi: (keepRecent: Int) -> Unit,
    onCompactLocally: (keepRecent: Int) -> Unit,
    onClearCompaction: () -> Unit,
    onSelectWindowLimit: (Int) -> Unit
) {
    val garden = LocalGardenColors.current
    val dateFmt = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }
    var keepRecent by remember { mutableIntStateOf(4) }

    val statusColor = when (snapshot.pressureLevel) {
        ContextPressureLevel.NORMAL -> garden.bamboo
        ContextPressureLevel.ELEVATED -> garden.gold
        ContextPressureLevel.CRITICAL -> garden.cinnabar
    }
    val statusLabel = when (snapshot.pressureLevel) {
        ContextPressureLevel.NORMAL -> "充裕"
        ContextPressureLevel.ELEVATED -> "偏高 · 建议压缩"
        ContextPressureLevel.CRITICAL -> "临近上限 · 强烈建议压缩"
    }

    val usedCompact = UsageAnalytics.formatCompactTokens(snapshot.estimatedTotalTokens.toLong())
    val limitCompact = UsageAnalytics.formatCompactTokens(snapshot.windowLimitTokens.toLong())
    val pctText = String.format(Locale.US, "%.1f%%", snapshot.usagePercent)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "当前上下文与会话压缩",
                    fontFamily = FontFamily.Serif,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = garden.ink
                )
                Text(
                    text = if (snapshot.modelName.isNotBlank()) {
                        "当前模型：${snapshot.modelName}"
                    } else {
                        "尚未配置模型（按 64K 默认窗口估算）"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            GardenTagPill(
                text = statusLabel,
                accent = statusColor,
                background = statusColor.copy(alpha = 0.12f)
            )
        }

        // 1. Live Context Usage Breakdown Card
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = IosSquircleShape(22.dp),
            color = garden.paper,
            border = BorderStroke(0.7.dp, garden.lineSoft)
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            text = usedCompact,
                            fontFamily = FontFamily.Serif,
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Bold,
                            color = statusColor
                        )
                        Spacer(Modifier.width(5.dp))
                        Text(
                            text = "/ $limitCompact tokens",
                            style = MaterialTheme.typography.labelMedium,
                            color = garden.muted,
                            modifier = Modifier.padding(bottom = 3.dp)
                        )
                    }
                    Text(
                        text = pctText,
                        fontFamily = FontFamily.Serif,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = statusColor
                    )
                }

                // Segmented 3-part progress bar (System / Compacted Summary / Active History)
                val limit = snapshot.windowLimitTokens.coerceAtLeast(1).toFloat()
                val sysFrac = (snapshot.systemTokens / limit).coerceIn(0f, 1f)
                val sumFrac = (snapshot.summaryTokens / limit).coerceIn(0f, (1f - sysFrac).coerceAtLeast(0f))
                val histFrac = (snapshot.activeHistoryTokens / limit).coerceIn(0f, (1f - sysFrac - sumFrac).coerceAtLeast(0f))
                val remFrac = (1f - sysFrac - sumFrac - histFrac).coerceAtLeast(0f)

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(9.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(garden.paperDeep)
                ) {
                    if (sysFrac > 0.002f) {
                        Box(
                            modifier = Modifier
                                .weight(sysFrac)
                                .fillMaxHeight()
                                .background(garden.bamboo)
                        )
                    }
                    if (sumFrac > 0.002f) {
                        Box(
                            modifier = Modifier
                                .weight(sumFrac)
                                .fillMaxHeight()
                                .background(garden.gold)
                        )
                    }
                    if (histFrac > 0.002f) {
                        Box(
                            modifier = Modifier
                                .weight(histFrac)
                                .fillMaxHeight()
                                .background(if (snapshot.pressureLevel == ContextPressureLevel.CRITICAL) garden.cinnabar else garden.ink)
                        )
                    }
                    if (remFrac > 0.001f) {
                        Spacer(Modifier.weight(remFrac))
                    }
                }

                // Breakdown metrics row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    ContextSegmentLegend(
                        dotColor = garden.bamboo,
                        label = "系统人设",
                        value = UsageAnalytics.formatCompactTokens(snapshot.systemTokens.toLong())
                    )
                    ContextSegmentLegend(
                        dotColor = garden.gold,
                        label = "压缩摘要",
                        value = UsageAnalytics.formatCompactTokens(snapshot.summaryTokens.toLong())
                    )
                    ContextSegmentLegend(
                        dotColor = if (snapshot.pressureLevel == ContextPressureLevel.CRITICAL) garden.cinnabar else garden.ink,
                        label = "近期原文(${snapshot.activeMessageCount}条)",
                        value = UsageAnalytics.formatCompactTokens(snapshot.activeHistoryTokens.toLong())
                    )
                }

                if (snapshot.lastProviderPromptTokens > 0 || snapshot.compactedMessageCount > 0) {
                    HorizontalDivider(color = garden.lineSoft)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "本会话共 ${snapshot.totalMessageCount} 条（已折叠 ${snapshot.compactedMessageCount} 条）",
                            style = MaterialTheme.typography.labelSmall,
                            color = garden.muted
                        )
                        if (snapshot.lastProviderPromptTokens > 0) {
                            Text(
                                text = "上次实测 ${UsageAnalytics.formatCompactTokens(snapshot.lastProviderPromptTokens.toLong())}",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.bamboo,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }
            }
        }

        // 2. Context Window Limit Selector
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = "窗口上限校准",
                style = MaterialTheme.typography.labelMedium,
                color = garden.ink,
                fontWeight = FontWeight.SemiBold
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                WindowLimitPresets.forEach { (limitVal, label) ->
                    val selected = windowOverride == limitVal
                    Surface(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .clickable { onSelectWindowLimit(limitVal) },
                        shape = RoundedCornerShape(999.dp),
                        color = if (selected) garden.bamboo else garden.paper,
                        border = BorderStroke(0.8.dp, if (selected) garden.bamboo else garden.lineSoft)
                    ) {
                        Text(
                            text = label,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (selected) garden.paperCard else garden.ink,
                            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                        )
                    }
                }
            }
        }

        // 3. Conversation Compaction Actions Card
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = IosSquircleShape(22.dp),
            color = garden.paper,
            border = BorderStroke(0.7.dp, garden.lineSoft)
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Compress,
                        contentDescription = null,
                        tint = garden.bamboo,
                        modifier = Modifier.size(18.dp)
                    )
                    Text(
                        text = "会话上下文压缩",
                        fontFamily = FontFamily.Serif,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = garden.ink
                    )
                }

                Text(
                    text = "将早期多轮对话折叠为高密度摘要发送给模型，显著降低 Token 消耗并延长有效记忆；本地界面仍完整保留全部原聊天记录。",
                    style = MaterialTheme.typography.bodySmall,
                    color = garden.muted,
                    lineHeight = 18.sp
                )

                // Retention selector
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "保留最近原文",
                        style = MaterialTheme.typography.labelMedium,
                        color = garden.ink
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        KeepRecentPresets.forEach { count ->
                            val selected = keepRecent == count
                            Surface(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(999.dp))
                                    .clickable { keepRecent = count },
                                shape = RoundedCornerShape(999.dp),
                                color = if (selected) garden.goldSoft else garden.paperCard,
                                border = BorderStroke(0.8.dp, if (selected) garden.gold else garden.lineSoft)
                            ) {
                                Text(
                                    text = "${count}条",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (selected) garden.ink else garden.muted,
                                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                    modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp)
                                )
                            }
                        }
                    }
                }

                if (isCompacting) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(garden.bambooSoft)
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = garden.bamboo
                        )
                        Text(
                            text = "正在提炼并压缩早期会话上下文，请稍候…",
                            style = MaterialTheme.typography.labelMedium,
                            color = garden.bamboo
                        )
                    }
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        GardenWindowButton(
                            text = "AI 智能压缩",
                            primary = true,
                            enabled = snapshot.canCompact,
                            onClick = { onCompactWithAi(keepRecent) },
                            modifier = Modifier.weight(1f)
                        )
                        GardenWindowButton(
                            text = "本地快速压缩",
                            primary = false,
                            enabled = snapshot.canCompact,
                            onClick = { onCompactLocally(keepRecent) },
                            modifier = Modifier.weight(1f)
                        )
                    }
                    if (!snapshot.canCompact) {
                        Text(
                            text = "当前活跃对话不足 4 条（现有 ${snapshot.activeMessageCount} 条），继续聊几轮后即可一键压缩。",
                            style = MaterialTheme.typography.labelSmall,
                            color = garden.muted
                        )
                    }
                }
            }
        }

        // 4. Current Compacted Summary Card (when already compacted)
        if (snapshot.hasCompaction) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp),
                color = garden.goldSoft.copy(alpha = 0.45f),
                border = BorderStroke(0.9.dp, garden.gold.copy(alpha = 0.65f))
            ) {
                Column(
                    modifier = Modifier.padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "当前已生效的压缩摘要",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                            color = garden.ink
                        )
                        if (snapshot.compactedAt > 0L) {
                            Text(
                                text = "更新于 ${dateFmt.format(Date(snapshot.compactedAt))}",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.muted
                            )
                        }
                    }
                    Text(
                        text = snapshot.contextSummary,
                        style = MaterialTheme.typography.bodySmall,
                        color = garden.text,
                        lineHeight = 19.sp
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(onClick = onClearCompaction) {
                            Icon(
                                imageVector = Icons.Default.Restore,
                                contentDescription = null,
                                tint = garden.cinnabar,
                                modifier = Modifier.size(15.dp)
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = "恢复完整上下文（取消压缩）",
                                style = MaterialTheme.typography.labelMedium,
                                color = garden.cinnabar
                            )
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(14.dp))
    }
}

@Composable
private fun ContextSegmentLegend(
    dotColor: Color,
    label: String,
    value: String
) {
    val garden = LocalGardenColors.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(dotColor)
        )
        Text(
            text = "$label $value",
            style = MaterialTheme.typography.labelSmall,
            color = garden.muted,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}
