package com.qiyi.companion

import com.qiyi.companion.data.db.UsageRecordEntity
import com.qiyi.companion.data.usage.UsageAnalytics
import com.qiyi.companion.data.usage.UsageTimeRange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UsageAnalyticsTest {

    @Test
    fun estimatesChineseAndEnglishTokensDeterministically() {
        val cjkTok = UsageAnalytics.estimateTextTokens("栖忆古典园林")
        val engTok = UsageAnalytics.estimateTextTokens("hello world kotlin")
        assertTrue(cjkTok >= 8)
        assertTrue(engTok >= 5)
    }

    @Test
    fun aggregatesRangeModelsCacheRateAndDailySeries() {
        val now = 1_764_160_000_000L
        val records = listOf(
            UsageRecordEntity(
                id = 1,
                conversationId = "c1",
                personaId = "p1",
                model = "deepseek-chat",
                promptTokens = 1000,
                cachedPromptTokens = 800,
                completionTokens = 200,
                totalTokens = 1200,
                durationMs = 1500L,
                source = "provider",
                createdAt = now - 3600_000L
            ),
            UsageRecordEntity(
                id = 2,
                conversationId = "c2",
                personaId = "p1",
                model = "gpt-4o-mini",
                promptTokens = 500,
                cachedPromptTokens = 0,
                completionTokens = 300,
                totalTokens = 800,
                durationMs = 900L,
                source = "estimated",
                createdAt = now - 86_400_000L
            ),
            // Older than 7 days -> excluded from DAY_7
            UsageRecordEntity(
                id = 3,
                conversationId = "c3",
                personaId = "p1",
                model = "old-model",
                promptTokens = 9999,
                completionTokens = 1,
                totalTokens = 10000,
                createdAt = now - 20L * 86_400_000L
            )
        )

        val snap = UsageAnalytics.aggregate(records, UsageTimeRange.DAY_7, nowMs = now)
        assertEquals(2000L, snap.totalTokens)
        assertEquals(2, snap.requestCount)
        assertEquals(2, snap.sessionCount)
        assertEquals(1, snap.providerCount)
        assertEquals(1, snap.estimatedCount)
        assertEquals(7, snap.dailySeries.size)
        assertEquals(2, snap.modelSlices.size)
        assertEquals("deepseek-chat", snap.modelSlices.first().model)
        assertEquals(60.0, snap.modelSlices.first().sharePercent, 0.2)
        assertTrue(snap.cacheHitPercent > 50.0)
        assertTrue(snap.estimatedCacheSavingsUsd > 0.0)
    }
}
