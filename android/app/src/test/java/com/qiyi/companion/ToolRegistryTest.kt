package com.qiyi.companion

import com.qiyi.companion.data.tools.DeterministicToolRegistry
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ToolRegistryTest {

    @Test
    fun safeCalculatorEvaluatesComplexMathWithPrecision() {
        assertEquals(160.0, DeterministicToolRegistry.safeEvaluateMath("128 * 1.25"), 1e-9)
        assertEquals(172.0, DeterministicToolRegistry.safeEvaluateMath("(128 * 1.25) + sqrt(144)"), 1e-9)
        assertEquals("0.3", DeterministicToolRegistry.formatNumber(DeterministicToolRegistry.safeEvaluateMath("0.1 + 0.2")))
    }

    @Test(expected = IllegalArgumentException::class)
    fun safeCalculatorRejectsCodeInjection() {
        DeterministicToolRegistry.safeEvaluateMath("Runtime.getRuntime().exec('ls')")
    }

    @Test
    fun statsAndDateCalculatorsReturnDeterministicChineseOutput() = runTest {
        val stats = DeterministicToolRegistry.execute(
            name = "data_stats",
            args = buildJsonObject {
                put("numbers", buildJsonArray {
                    add(JsonPrimitive(10))
                    add(JsonPrimitive(20))
                    add(JsonPrimitive(30))
                })
            },
            knowledgeSearcher = { "" }
        )
        assertTrue(stats.contains("均值=20"))
        assertTrue(stats.contains("中位数=20"))

        val diff = DeterministicToolRegistry.calculateDate("diff", "2026-01-01", "2026-01-11")
        assertTrue(diff.contains("相差 10 天"))

        val offset = DeterministicToolRegistry.calculateDate("offset", "2026-11-26", daysOffset = 4)
        assertTrue(offset.contains("2026-11-30"))
    }
}
