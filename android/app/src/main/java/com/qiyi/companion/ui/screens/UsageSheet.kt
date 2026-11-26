package com.qiyi.companion.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.usage.DailyUsagePoint
import com.qiyi.companion.data.usage.UsageAnalytics
import com.qiyi.companion.data.usage.UsageMetricMode
import com.qiyi.companion.data.usage.UsageTimeRange
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.GardenTagPill
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.LocalGardenColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val ModelChartPalette = listOf(
    Color(0xFF284D3B), // Bamboo Jade
    Color(0xFF3D5B78), // Indigo Slate
    Color(0xFFB5832C), // Antique Gold
    Color(0xFFA33227), // Cinnabar
    Color(0xFF6C8A7C)  // Celadon
)

@Composable
fun UsageSheet(viewModel: QiYiViewModel) {
    val records by viewModel.usageRecords.collectAsStateWithLifecycle()
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val activeConvId by viewModel.activeConversationId.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current
    val formatter = remember { SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()) }

    var selectedRange by remember { mutableStateOf(UsageTimeRange.DAY_7) }
    var metricMode by remember { mutableStateOf(UsageMetricMode.TOKENS) }
    var onlyCurrentConversation by remember { mutableStateOf(false) }
    var showPricingDialog by remember { mutableStateOf(false) }
    var showRecentLog by remember { mutableStateOf(false) }

    val snapshot = remember(
        records,
        selectedRange,
        onlyCurrentConversation,
        activeConvId,
        settings.customInputPricePer1M,
        settings.customOutputPricePer1M
    ) {
        UsageAnalytics.aggregate(
            allRecords = records,
            range = selectedRange,
            conversationFilter = if (onlyCurrentConversation) activeConvId else null,
            customInputPer1M = settings.customInputPricePer1M,
            customOutputPer1M = settings.customOutputPricePer1M
        )
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Header + Scope + Metric Toggle (aligned with web live-v4-2-spring-usage.png)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("用量可视化分析", style = MaterialTheme.typography.titleMedium, color = garden.ink)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CompactPillToggle(
                    text = if (onlyCurrentConversation) "当前会话" else "全部用量",
                    selected = onlyCurrentConversation,
                    onClick = { onlyCurrentConversation = !onlyCurrentConversation }
                )
                CompactPillToggle(
                    text = metricMode.label,
                    selected = metricMode == UsageMetricMode.COST,
                    onClick = {
                        metricMode = if (metricMode == UsageMetricMode.TOKENS) UsageMetricMode.COST else UsageMetricMode.TOKENS
                    }
                )
            }
        }

        // Time Range Selector Pills (24小时 / 7天 / 30天 / 90天)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            UsageTimeRange.entries.forEach { range ->
                CompactPillToggle(
                    text = range.label,
                    selected = selectedRange == range,
                    onClick = { selectedRange = range }
                )
            }
        }

        // 1. Hero Analytics Card: Donut Ring + Big Serif KPI + Telemetry Source Badge
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            color = garden.paper,
            border = BorderStroke(1.dp, garden.line)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                val hasCache = snapshot.cachedPromptTokens > 0L
                val ringPercent = if (hasCache) snapshot.cacheHitPercent else snapshot.outputSharePercent
                val ringLabel = if (hasCache) "缓存命中" else "输出占比"

                DonutMetricRing(
                    percent = ringPercent.toFloat(),
                    centerLabel = ringLabel,
                    primaryColor = if (hasCache) garden.bamboo else garden.gold,
                    trackColor = garden.paperDeep
                )
                Spacer(Modifier.width(14.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = if (metricMode == UsageMetricMode.TOKENS) {
                                UsageAnalytics.formatCompactTokens(snapshot.totalTokens)
                            } else {
                                UsageAnalytics.formatUsd(snapshot.estimatedCostUsd)
                            },
                            fontFamily = FontFamily.Serif,
                            fontWeight = FontWeight.Bold,
                            fontSize = 26.sp,
                            color = garden.ink
                        )
                        GardenTagPill(
                            text = "实测 ${snapshot.providerCount} / 估算 ${snapshot.estimatedCount}",
                            accent = garden.muted,
                            background = garden.paperCard
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = buildString {
                            append("${snapshot.sessionCount} 个会话 · ${snapshot.requestCount} 次请求")
                            if (snapshot.avgDurationSec > 0.05) {
                                append(String.format(Locale.US, " · 均耗 %.1fs", snapshot.avgDurationSec))
                            }
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.muted
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = if (snapshot.estimatedCacheSavingsUsd > 0.0001) {
                            "估算总费用 ${UsageAnalytics.formatUsd(snapshot.estimatedCostUsd)} · 缓存节省 ${UsageAnalytics.formatUsd(snapshot.estimatedCacheSavingsUsd)}"
                        } else {
                            "估算总费用 ${UsageAnalytics.formatUsd(snapshot.estimatedCostUsd)}（输入 ${UsageAnalytics.formatCompactTokens(snapshot.promptTokens)} / 输出 ${UsageAnalytics.formatCompactTokens(snapshot.completionTokens)}）"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.cinnabar,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        // 2. Smooth Area Line Chart (每日处理 Token / 每日估算费用)
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            color = garden.paper,
            border = BorderStroke(0.9.dp, garden.line)
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = if (metricMode == UsageMetricMode.TOKENS) "每日处理 Token 趋势" else "每日估算费用趋势",
                        style = MaterialTheme.typography.titleSmall,
                        color = garden.ink
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        LegendDot("总计", garden.bamboo)
                        if (metricMode == UsageMetricMode.TOKENS) {
                            LegendDot("输出", garden.gold)
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                DailyAreaLineChart(
                    points = snapshot.dailySeries,
                    metricMode = metricMode,
                    primaryColor = garden.bamboo,
                    secondaryColor = garden.gold,
                    gridColor = garden.lineSoft,
                    labelColor = garden.muted
                )
            }
        }

        // 3. Model Breakdown Card (color dot + share % + cache % + cost + bar)
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            color = garden.paper,
            border = BorderStroke(0.9.dp, garden.line)
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("按模型占比分布", style = MaterialTheme.typography.titleSmall, color = garden.ink)
                if (snapshot.modelSlices.isEmpty()) {
                    Text(
                        text = "当前时间范围内暂无调用数据，发送对话后将自动生成多模型对比分析。",
                        style = MaterialTheme.typography.bodySmall,
                        color = garden.muted
                    )
                } else {
                    snapshot.modelSlices.take(6).forEachIndexed { idx, slice ->
                        val dotColor = ModelChartPalette[idx % ModelChartPalette.size]
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Row(
                                    modifier = Modifier.weight(1f),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(8.dp)
                                            .clip(CircleShape)
                                            .background(dotColor)
                                    )
                                    Spacer(Modifier.width(7.dp))
                                    Text(
                                        text = slice.model,
                                        style = MaterialTheme.typography.labelMedium,
                                        fontWeight = FontWeight.SemiBold,
                                        color = garden.ink,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                                Text(
                                    text = if (metricMode == UsageMetricMode.TOKENS) {
                                        UsageAnalytics.formatCompactTokens(slice.totalTokens)
                                    } else {
                                        UsageAnalytics.formatUsd(slice.estimatedCostUsd)
                                    },
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = garden.ink
                                )
                            }
                            Text(
                                text = String.format(
                                    Locale.US,
                                    "%d 个会话 · %d 次 · 占比 %.1f%% · 缓存 %.1f%% · %s",
                                    slice.sessionCount,
                                    slice.requestCount,
                                    slice.sharePercent,
                                    slice.cacheHitPercent,
                                    UsageAnalytics.formatUsd(slice.estimatedCostUsd)
                                ),
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.muted
                            )
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(5.dp)
                                    .clip(RoundedCornerShape(999.dp))
                                    .background(garden.paperDeep)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth((slice.sharePercent / 100.0).toFloat().coerceIn(0.03f, 1f))
                                        .height(5.dp)
                                        .clip(RoundedCornerShape(999.dp))
                                        .background(dotColor)
                                )
                            }
                        }
                    }
                }
            }
        }

        // 4. Summary KPI 2x2 Grid + Custom Pricing ("汇总指标" + "设置单价")
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp),
            color = garden.paper,
            border = BorderStroke(0.9.dp, garden.line)
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("汇总指标", style = MaterialTheme.typography.titleSmall, color = garden.ink)
                    TextButton(onClick = { showPricingDialog = true }) {
                        Text("设置单价", style = MaterialTheme.typography.labelSmall, color = garden.bamboo)
                    }
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    UsageKpiCard("输入 Token", UsageAnalytics.formatCompactTokens(snapshot.promptTokens), Modifier.weight(1f))
                    UsageKpiCard("输出 Token", UsageAnalytics.formatCompactTokens(snapshot.completionTokens), Modifier.weight(1f))
                }
                Spacer(Modifier.height(8.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    UsageKpiCard("缓存命中", UsageAnalytics.formatCompactTokens(snapshot.cachedPromptTokens), Modifier.weight(1f))
                    val avgTok = if (snapshot.requestCount > 0) snapshot.totalTokens / snapshot.requestCount else 0L
                    UsageKpiCard("均次消耗", UsageAnalytics.formatCompactTokens(avgTok), Modifier.weight(1f))
                }
            }
        }

        // 5. Collapsible Recent Calls Log + Clear Button
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = { showRecentLog = !showRecentLog }) {
                Text(
                    text = if (showRecentLog) "▾ 收起近期调用明细（${records.size}）" else "▸ 查看近期调用明细（${records.size}）",
                    style = MaterialTheme.typography.labelMedium,
                    color = garden.muted
                )
            }
            if (records.isNotEmpty()) {
                GardenWindowButton(text = "清空记录", onClick = { viewModel.clearUsageRecords() })
            }
        }

        if (showRecentLog && records.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                records.take(15).forEach { rec ->
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
                                    text = "${formatter.format(Date(rec.createdAt))} · ${if (rec.source == "provider") "实测" else "估算"}",
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

    if (showPricingDialog) {
        var inputText by remember {
            mutableStateOf(if (settings.customInputPricePer1M > 0.0) settings.customInputPricePer1M.toString() else "")
        }
        var outputText by remember {
            mutableStateOf(if (settings.customOutputPricePer1M > 0.0) settings.customOutputPricePer1M.toString() else "")
        }
        AlertDialog(
            onDismissRequest = { showPricingDialog = false },
            title = { Text("自定义估算单价（$/百万 Token）") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "留空或填 0 将按模型名称自动匹配官方参考单价。",
                        style = MaterialTheme.typography.bodySmall,
                        color = garden.muted
                    )
                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        label = { Text("输入单价（$/1M Tokens）") },
                        placeholder = { Text("例如 0.27") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = outputText,
                        onValueChange = { outputText = it },
                        label = { Text("输出单价（$/1M Tokens）") },
                        placeholder = { Text("例如 1.10") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.setCustomPricing(
                            inputPer1M = inputText.trim().toDoubleOrNull() ?: 0.0,
                            outputPer1M = outputText.trim().toDoubleOrNull() ?: 0.0
                        )
                        showPricingDialog = false
                    }
                ) { Text("保存单价") }
            },
            dismissButton = {
                TextButton(onClick = { showPricingDialog = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun DonutMetricRing(
    percent: Float,
    centerLabel: String,
    primaryColor: Color,
    trackColor: Color
) {
    val garden = LocalGardenColors.current
    val clamped = percent.coerceIn(0f, 100f)
    Box(
        modifier = Modifier.size(84.dp),
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.size(84.dp)) {
            val strokePx = 9.dp.toPx()
            val inset = strokePx / 2f
            val arcSize = Size(size.width - strokePx, size.height - strokePx)
            drawArc(
                color = trackColor,
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = arcSize,
                style = Stroke(width = strokePx, cap = StrokeCap.Round)
            )
            if (clamped > 0f) {
                drawArc(
                    color = primaryColor,
                    startAngle = -90f,
                    sweepAngle = 360f * (clamped / 100f),
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(width = strokePx, cap = StrokeCap.Round)
                )
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = String.format(Locale.US, "%.1f%%", clamped),
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.Bold,
                fontSize = 15.sp,
                color = garden.ink
            )
            Text(
                text = centerLabel,
                fontSize = 9.5.sp,
                color = garden.muted
            )
        }
    }
}

@Composable
private fun DailyAreaLineChart(
    points: List<DailyUsagePoint>,
    metricMode: UsageMetricMode,
    primaryColor: Color,
    secondaryColor: Color,
    gridColor: Color,
    labelColor: Color
) {
    val values = points.map {
        if (metricMode == UsageMetricMode.TOKENS) it.totalTokens.toDouble() else it.estimatedCostUsd
    }
    val secondaryValues = points.map { it.completionTokens.toDouble() }
    val maxVal = (values.maxOrNull() ?: 0.0).coerceAtLeast(if (metricMode == UsageMetricMode.TOKENS) 100.0 else 0.01)

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                modifier = Modifier
                    .width(42.dp)
                    .height(128.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = if (metricMode == UsageMetricMode.TOKENS) UsageAnalytics.formatCompactTokens(maxVal.toLong()) else UsageAnalytics.formatUsd(maxVal),
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 10.sp,
                    color = labelColor
                )
                Text(
                    text = if (metricMode == UsageMetricMode.TOKENS) UsageAnalytics.formatCompactTokens((maxVal / 2.0).toLong()) else UsageAnalytics.formatUsd(maxVal / 2.0),
                    style = MaterialTheme.typography.labelSmall,
                    fontSize = 10.sp,
                    color = labelColor
                )
                Text("0", style = MaterialTheme.typography.labelSmall, fontSize = 10.sp, color = labelColor)
            }

            Canvas(
                modifier = Modifier
                    .weight(1f)
                    .height(128.dp)
            ) {
                val w = size.width
                val h = size.height
                val topPad = 8.dp.toPx()
                val bottomPad = 8.dp.toPx()
                val plotH = (h - topPad - bottomPad).coerceAtLeast(1f)

                // Horizontal grid lines
                for (g in 0..2) {
                    val y = topPad + plotH * (g / 2f)
                    drawLine(gridColor, Offset(0f, y), Offset(w, y), strokeWidth = 1.dp.toPx())
                }

                if (values.size >= 2) {
                    val stepX = w / (values.size - 1).coerceAtLeast(1)
                    val coords = values.mapIndexed { i, v ->
                        val ratio = (v / maxVal).toFloat().coerceIn(0f, 1f)
                        Offset(i * stepX, topPad + plotH * (1f - ratio))
                    }

                    // Smooth cubic curve path
                    val linePath = Path().apply {
                        moveTo(coords.first().x, coords.first().y)
                        for (i in 1 until coords.size) {
                            val prev = coords[i - 1]
                            val cur = coords[i]
                            val midX = (prev.x + cur.x) / 2f
                            cubicTo(midX, prev.y, midX, cur.y, cur.x, cur.y)
                        }
                    }

                    val fillPath = Path().apply {
                        addPath(linePath)
                        lineTo(coords.last().x, topPad + plotH)
                        lineTo(coords.first().x, topPad + plotH)
                        close()
                    }

                    drawPath(
                        path = fillPath,
                        brush = Brush.verticalGradient(
                            colors = listOf(primaryColor.copy(alpha = 0.30f), primaryColor.copy(alpha = 0.03f)),
                            startY = topPad,
                            endY = topPad + plotH
                        )
                    )
                    drawPath(
                        path = linePath,
                        color = primaryColor,
                        style = Stroke(width = 2.2.dp.toPx(), cap = StrokeCap.Round)
                    )

                    // Optional secondary curve (Completion tokens)
                    if (metricMode == UsageMetricMode.TOKENS) {
                        val compCoords = secondaryValues.mapIndexed { i, v ->
                            val ratio = (v / maxVal).toFloat().coerceIn(0f, 1f)
                            Offset(i * stepX, topPad + plotH * (1f - ratio))
                        }
                        val compPath = Path().apply {
                            moveTo(compCoords.first().x, compCoords.first().y)
                            for (i in 1 until compCoords.size) {
                                val prev = compCoords[i - 1]
                                val cur = compCoords[i]
                                val midX = (prev.x + cur.x) / 2f
                                cubicTo(midX, prev.y, midX, cur.y, cur.x, cur.y)
                            }
                        }
                        drawPath(
                            path = compPath,
                            color = secondaryColor,
                            style = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round)
                        )
                    }

                    // Data points
                    coords.forEach { pt ->
                        drawCircle(color = primaryColor, radius = 3.2.dp.toPx(), center = pt)
                    }
                }
            }
        }

        // X-axis labels (first, middle, last)
        if (points.isNotEmpty()) {
            Spacer(Modifier.height(4.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 42.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(points.first().dateLabel, fontSize = 10.sp, color = labelColor)
                if (points.size >= 3) {
                    Text(points[points.size / 2].dateLabel, fontSize = 10.sp, color = labelColor)
                }
                Text(points.last().dateLabel, fontSize = 10.sp, color = labelColor)
            }
        }
    }
}

@Composable
private fun LegendDot(label: String, color: Color) {
    val garden = LocalGardenColors.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(7.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(4.dp))
        Text(label, fontSize = 10.5.sp, color = garden.muted)
    }
}

@Composable
private fun CompactPillToggle(
    text: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(6.dp),
        color = if (selected) garden.bamboo else garden.paper,
        border = BorderStroke(0.9.dp, if (selected) garden.gold else garden.line)
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = if (selected) garden.paperCard else garden.ink,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
        )
    }
}

@Composable
private fun UsageKpiCard(label: String, value: String, modifier: Modifier = Modifier) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        color = garden.paperCard,
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
