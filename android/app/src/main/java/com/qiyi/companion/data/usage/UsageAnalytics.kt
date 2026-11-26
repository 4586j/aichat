package com.qiyi.companion.data.usage

import com.qiyi.companion.data.db.UsageRecordEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil

enum class UsageTimeRange(val label: String, val days: Int) {
    DAY_1("24小时", 1),
    DAY_7("7天", 7),
    DAY_30("30天", 30),
    DAY_90("90天", 90)
}

enum class UsageMetricMode(val label: String) {
    TOKENS("Token"),
    COST("费用")
}

data class ModelUsageSlice(
    val model: String,
    val totalTokens: Long,
    val promptTokens: Long,
    val cachedPromptTokens: Long,
    val completionTokens: Long,
    val requestCount: Int,
    val sessionCount: Int,
    val sharePercent: Double,
    val cacheHitPercent: Double,
    val estimatedCostUsd: Double
)

data class DailyUsagePoint(
    val dateLabel: String,
    val totalTokens: Long,
    val promptTokens: Long,
    val completionTokens: Long,
    val estimatedCostUsd: Double
)

data class UsageDashboardSnapshot(
    val totalTokens: Long,
    val promptTokens: Long,
    val cachedPromptTokens: Long,
    val completionTokens: Long,
    val reasoningTokens: Long,
    val requestCount: Int,
    val sessionCount: Int,
    val providerCount: Int,
    val estimatedCount: Int,
    val avgDurationSec: Double,
    val cacheHitPercent: Double,
    val outputSharePercent: Double,
    val estimatedCostUsd: Double,
    val estimatedCacheSavingsUsd: Double,
    val modelSlices: List<ModelUsageSlice>,
    val dailySeries: List<DailyUsagePoint>
)

/**
 * Pure-Kotlin deterministic token estimator, cost calculator, and multi-dimensional analytics engine
 * aligned with PC `lib/usage.mjs`.
 */
object UsageAnalytics {

    fun estimateTextTokens(text: String): Int {
        if (text.isEmpty()) return 0
        var cjk = 0
        var other = 0
        for (ch in text) {
            val code = ch.code
            if (code in 0x4E00..0x9FFF || code in 0x3400..0x4DBF || code in 0x3000..0x303F || code in 0xFF00..0xFFEF) {
                cjk++
            } else {
                other++
            }
        }
        return ceil(cjk * 1.45 + other * 0.28).toInt().coerceAtLeast(1)
    }

    /**
     * Returns default (input$/1M, output$/1M) USD pricing by model name when user hasn't set custom pricing.
     */
    fun resolvePricingPer1M(
        model: String,
        customInputPer1M: Double = 0.0,
        customOutputPer1M: Double = 0.0
    ): Pair<Double, Double> {
        if (customInputPer1M > 0.0 || customOutputPer1M > 0.0) {
            return customInputPer1M.coerceAtLeast(0.0) to customOutputPer1M.coerceAtLeast(0.0)
        }
        val m = model.lowercase(Locale.US)
        return when {
            m.contains("deepseek-reasoner") || m.contains("r1") -> 0.55 to 2.19
            m.contains("deepseek") -> 0.27 to 1.10
            m.contains("gemini-2.5-flash") || m.contains("flash") -> 0.15 to 0.60
            m.contains("gemini-2.5-pro") || m.contains("gemini-pro") -> 1.25 to 10.0
            m.contains("gpt-4o-mini") -> 0.15 to 0.60
            m.contains("gpt-4o") -> 2.50 to 10.0
            m.contains("claude") && m.contains("haiku") -> 0.80 to 4.00
            m.contains("claude") -> 3.00 to 15.0
            m.contains("qwen") -> 0.30 to 0.90
            m.contains("kimi") || m.contains("moonshot") -> 0.60 to 2.40
            else -> 0.50 to 1.50
        }
    }

    fun computeCostAndSavings(
        model: String,
        promptTokens: Long,
        cachedPromptTokens: Long,
        completionTokens: Long,
        customInputPer1M: Double = 0.0,
        customOutputPer1M: Double = 0.0
    ): Pair<Double, Double> {
        val (inPrice, outPrice) = resolvePricingPer1M(model, customInputPer1M, customOutputPer1M)
        val cached = cachedPromptTokens.coerceIn(0L, promptTokens.coerceAtLeast(0L))
        val uncached = (promptTokens - cached).coerceAtLeast(0L)
        // Cached prompt tokens typically cost ~10% of normal input tokens
        val cost = (uncached * inPrice + cached * inPrice * 0.1 + completionTokens * outPrice) / 1_000_000.0
        val savings = (cached * inPrice * 0.9) / 1_000_000.0
        return cost to savings
    }

    fun aggregate(
        allRecords: List<UsageRecordEntity>,
        range: UsageTimeRange,
        conversationFilter: String? = null,
        customInputPer1M: Double = 0.0,
        customOutputPer1M: Double = 0.0,
        nowMs: Long = System.currentTimeMillis(),
        zoneId: ZoneId = ZoneId.systemDefault()
    ): UsageDashboardSnapshot {
        val cutoffMs = nowMs - range.days * 86_400_000L
        val filtered = allRecords.filter { rec ->
            rec.createdAt >= cutoffMs &&
                (conversationFilter.isNullOrBlank() || rec.conversationId == conversationFilter)
        }

        val totalTok = filtered.sumOf { it.totalTokens.toLong() }
        val promptTok = filtered.sumOf { it.promptTokens.toLong() }
        val cachedTok = filtered.sumOf { it.cachedPromptTokens.toLong() }
        val completionTok = filtered.sumOf { it.completionTokens.toLong() }
        val reasoningTok = filtered.sumOf { it.reasoningTokens.toLong() }
        val reqCount = filtered.size
        val sessCount = filtered.map { it.conversationId }.filter { it.isNotBlank() }.distinct().size
        val providerCnt = filtered.count { it.source == "provider" }
        val estCnt = reqCount - providerCnt
        val timed = filtered.filter { it.durationMs > 0L }
        val avgSec = if (timed.isEmpty()) 0.0 else timed.map { it.durationMs }.average() / 1000.0

        val cacheHitPct = if (promptTok > 0L) (cachedTok.toDouble() / promptTok.toDouble() * 100.0).coerceIn(0.0, 100.0) else 0.0
        val outputSharePct = if (totalTok > 0L) (completionTok.toDouble() / totalTok.toDouble() * 100.0).coerceIn(0.0, 100.0) else 0.0

        var totalCost = 0.0
        var totalSavings = 0.0

        val slices = filtered
            .groupBy { it.model.ifBlank { "默认模型" } }
            .map { (model, rows) ->
                val mTotal = rows.sumOf { it.totalTokens.toLong() }
                val mPrompt = rows.sumOf { it.promptTokens.toLong() }
                val mCached = rows.sumOf { it.cachedPromptTokens.toLong() }
                val mComp = rows.sumOf { it.completionTokens.toLong() }
                val (c, s) = computeCostAndSavings(model, mPrompt, mCached, mComp, customInputPer1M, customOutputPer1M)
                totalCost += c
                totalSavings += s
                ModelUsageSlice(
                    model = model,
                    totalTokens = mTotal,
                    promptTokens = mPrompt,
                    cachedPromptTokens = mCached,
                    completionTokens = mComp,
                    requestCount = rows.size,
                    sessionCount = rows.map { it.conversationId }.filter { it.isNotBlank() }.distinct().size,
                    sharePercent = if (totalTok > 0L) mTotal.toDouble() / totalTok.toDouble() * 100.0 else 0.0,
                    cacheHitPercent = if (mPrompt > 0L) (mCached.toDouble() / mPrompt.toDouble() * 100.0).coerceIn(0.0, 100.0) else 0.0,
                    estimatedCostUsd = c
                )
            }
            .sortedByDescending { it.totalTokens }

        // Build daily trend buckets across the selected window (7 points for 24h/7d, up to 14 points for 30d/90d)
        val today = Instant.ofEpochMilli(nowMs).atZone(zoneId).toLocalDate()
        val bucketDays = when (range) {
            UsageTimeRange.DAY_1 -> 7
            UsageTimeRange.DAY_7 -> 7
            UsageTimeRange.DAY_30 -> 14
            UsageTimeRange.DAY_90 -> 14
        }
        val dayStep = when (range) {
            UsageTimeRange.DAY_1, UsageTimeRange.DAY_7 -> 1
            UsageTimeRange.DAY_30 -> 2
            UsageTimeRange.DAY_90 -> 6
        }
        val dateFmt = DateTimeFormatter.ofPattern("MM/dd", Locale.US)

        val byLocalDate = filtered.groupBy { rec ->
            Instant.ofEpochMilli(rec.createdAt).atZone(zoneId).toLocalDate()
        }

        val dailySeries = (0 until bucketDays).map { i ->
            val endDay = today.minusDays(((bucketDays - 1 - i) * dayStep).toLong())
            val startDay = endDay.minusDays((dayStep - 1).toLong())
            var dTotal = 0L
            var dPrompt = 0L
            var dComp = 0L
            var dCost = 0.0
            var cursor: LocalDate = startDay
            while (!cursor.isAfter(endDay)) {
                val rows = byLocalDate[cursor].orEmpty()
                for (r in rows) {
                    dTotal += r.totalTokens.toLong()
                    dPrompt += r.promptTokens.toLong()
                    dComp += r.completionTokens.toLong()
                    val (c, _) = computeCostAndSavings(
                        r.model,
                        r.promptTokens.toLong(),
                        r.cachedPromptTokens.toLong(),
                        r.completionTokens.toLong(),
                        customInputPer1M,
                        customOutputPer1M
                    )
                    dCost += c
                }
                cursor = cursor.plusDays(1)
            }
            DailyUsagePoint(
                dateLabel = endDay.format(dateFmt),
                totalTokens = dTotal,
                promptTokens = dPrompt,
                completionTokens = dComp,
                estimatedCostUsd = dCost
            )
        }

        return UsageDashboardSnapshot(
            totalTokens = totalTok,
            promptTokens = promptTok,
            cachedPromptTokens = cachedTok,
            completionTokens = completionTok,
            reasoningTokens = reasoningTok,
            requestCount = reqCount,
            sessionCount = sessCount,
            providerCount = providerCnt,
            estimatedCount = estCnt,
            avgDurationSec = avgSec,
            cacheHitPercent = cacheHitPct,
            outputSharePercent = outputSharePct,
            estimatedCostUsd = totalCost,
            estimatedCacheSavingsUsd = totalSavings,
            modelSlices = slices,
            dailySeries = dailySeries
        )
    }

    fun formatCompactTokens(n: Long): String = when {
        n >= 1_000_000L -> String.format(Locale.US, "%.2fM", n / 1_000_000.0)
        n >= 1_000L -> String.format(Locale.US, "%.1fK", n / 1_000.0)
        else -> "$n"
    }

    fun formatUsd(usd: Double): String = when {
        usd <= 0.0 -> "$0.00"
        usd < 0.01 -> String.format(Locale.US, "$%.4f", usd)
        else -> String.format(Locale.US, "$%.2f", usd)
    }
}
