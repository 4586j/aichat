package com.qiyi.companion.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.LocalGardenColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun UsageSheet(viewModel: QiYiViewModel) {
    val records by viewModel.usageRecords.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current
    val formatter = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }

    val totalTokens = records.sumOf { it.totalTokens }
    val promptTokens = records.sumOf { it.promptTokens }
    val completionTokens = records.sumOf { it.completionTokens }

    val byModel = remember(records) {
        records.groupBy { it.model.ifBlank { "未知模型" } }
            .mapValues { (_, list) -> list.sumOf { it.totalTokens } to list.size }
            .entries
            .sortedByDescending { it.value.first }
    }
    val maxModelTokens = byModel.firstOrNull()?.value?.first?.coerceAtLeast(1) ?: 1

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Token 用量统计", style = MaterialTheme.typography.titleMedium, color = garden.ink)
            if (records.isNotEmpty()) {
                GardenWindowButton(text = "清空记录", onClick = { viewModel.clearUsageRecords() })
            }
        }
        Spacer(Modifier.height(10.dp))

        // Summary KPI Row
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            UsageKpiCard("总消耗", formatTokenCount(totalTokens), Modifier.weight(1f))
            UsageKpiCard("输入", formatTokenCount(promptTokens), Modifier.weight(1f))
            UsageKpiCard("输出", formatTokenCount(completionTokens), Modifier.weight(1f))
            UsageKpiCard("调用次", "${records.size}", Modifier.weight(1f))
        }

        Spacer(Modifier.height(12.dp))

        if (byModel.isNotEmpty()) {
            Text("按模型分布", style = MaterialTheme.typography.labelMedium, color = garden.ink)
            Spacer(Modifier.height(6.dp))
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                byModel.take(6).forEach { (model, stats) ->
                    val (tokens, count) = stats
                    val ratio = (tokens.toFloat() / maxModelTokens.toFloat()).coerceIn(0.05f, 1f)
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = model,
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.text,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                            Text(
                                text = "${formatTokenCount(tokens)} (${count}次)",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.muted
                            )
                        }
                        Spacer(Modifier.height(3.dp))
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(6.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(garden.paperDeep)
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth(ratio)
                                    .height(6.dp)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(garden.bamboo)
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        HorizontalDivider(color = garden.lineSoft)
        Spacer(Modifier.height(8.dp))
        Text("近期调用记录", style = MaterialTheme.typography.labelSmall, color = garden.muted)
        Spacer(Modifier.height(6.dp))

        if (records.isEmpty()) {
            Text(
                text = "暂无调用统计。发送对话后将自动记录每次请求的 Token 消耗。",
                style = MaterialTheme.typography.bodySmall,
                color = garden.muted,
                modifier = Modifier.padding(vertical = 16.dp)
            )
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(records, key = { it.id }) { rec ->
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(8.dp),
                        color = garden.paper,
                        border = BorderStroke(0.7.dp, garden.lineSoft)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = rec.model.ifBlank { "默认模型" },
                                    style = MaterialTheme.typography.labelMedium,
                                    color = garden.ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = formatter.format(Date(rec.createdAt)),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = garden.muted
                                )
                            }
                            Text(
                                text = "入 ${rec.promptTokens} / 出 ${rec.completionTokens}",
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.bamboo,
                                fontWeight = FontWeight.Medium
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
private fun UsageKpiCard(label: String, value: String, modifier: Modifier = Modifier) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = garden.paper,
        border = BorderStroke(0.8.dp, garden.line)
    ) {
        Column(
            modifier = Modifier.padding(vertical = 8.dp, horizontal = 6.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(value, style = MaterialTheme.typography.titleSmall, color = garden.bamboo, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = garden.muted)
        }
    }
}

private fun formatTokenCount(n: Int): String = when {
    n >= 1_000_000 -> String.format(Locale.US, "%.2fM", n / 1_000_000.0)
    n >= 1_000 -> String.format(Locale.US, "%.1fK", n / 1_000.0)
    else -> "$n"
}
