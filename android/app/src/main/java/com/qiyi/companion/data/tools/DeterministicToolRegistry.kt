package com.qiyi.companion.data.tools

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Pure-Kotlin deterministic built-in tools matching PC `lib/tool-registry.mjs`:
 * - calculator (safe recursive-descent math parser, zero eval)
 * - data_stats (count, sum, mean, median, min, max, range, variance, stddev)
 * - date_calculator (calendar diff & offset with Chinese weekday)
 * - get_system_time (current local date/time/timezone)
 * - knowledge_deep_search (local knowledge base deep search callback)
 */
object DeterministicToolRegistry {

    fun openAiToolDefinitions(): JsonArray = buildJsonArray {
        add(toolDef(
            name = "calculator",
            description = "确定性高精度数学计算器，支持四则运算、括号、幂运算(^)、sqrt/abs/round/sin/cos/PI/E。任何非平凡算术必须调用此工具。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("expression", buildJsonObject {
                        put("type", "string")
                        put("description", "待计算的数学表达式，例如 (128 * 1.25) + sqrt(144)")
                    })
                })
                put("required", buildJsonArray { add(JsonPrimitive("expression")) })
            }
        ))
        add(toolDef(
            name = "data_stats",
            description = "对一组数值执行确定性描述性统计（计数、求和、均值、中位数、最小值、最大值、极差、方差、标准差）。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("numbers", buildJsonObject {
                        put("type", "array")
                        put("items", buildJsonObject { put("type", "number") })
                        put("description", "待统计的数字列表")
                    })
                })
                put("required", buildJsonArray { add(JsonPrimitive("numbers")) })
            }
        ))
        add(toolDef(
            name = "date_calculator",
            description = "精确日历推算工具：支持 diff（计算两个 YYYY-MM-DD 日期相差天数）或 offset（从基准日期加减天数并给出星期）。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("mode", buildJsonObject {
                        put("type", "string")
                        put("enum", buildJsonArray { add(JsonPrimitive("diff")); add(JsonPrimitive("offset")) })
                    })
                    put("start_date", buildJsonObject { put("type", "string"); put("description", "起始日期 YYYY-MM-DD") })
                    put("end_date", buildJsonObject { put("type", "string"); put("description", "结束日期 YYYY-MM-DD（diff 模式）") })
                    put("days", buildJsonObject { put("type", "integer"); put("description", "偏移天数，可为负数（offset 模式）") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("mode")); add(JsonPrimitive("start_date")) })
            }
        ))
        add(toolDef(
            name = "get_system_time",
            description = "获取当前手机系统的精确日期、时间、星期和时区。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {})
            }
        ))
        add(toolDef(
            name = "knowledge_deep_search",
            description = "在用户本地离线书阁知识库中深度检索相关文档片段。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("query", buildJsonObject { put("type", "string"); put("description", "检索关键词或短语") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("query")) })
            }
        ))
    }

    private fun toolDef(name: String, description: String, params: JsonObject): JsonObject = buildJsonObject {
        put("type", "function")
        put("function", buildJsonObject {
            put("name", name)
            put("description", description)
            put("parameters", params)
        })
    }

    suspend fun execute(
        name: String,
        args: JsonObject,
        knowledgeSearcher: suspend (String) -> String
    ): String = when (name) {
        "calculator" -> {
            val expr = args["expression"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val result = safeEvaluateMath(expr)
            "计算结果：$expr = ${formatNumber(result)}"
        }
        "data_stats" -> {
            val nums = args["numbers"]?.jsonArray?.mapNotNull { it.jsonPrimitive.doubleOrNull }.orEmpty()
            computeStats(nums)
        }
        "date_calculator" -> {
            val mode = args["mode"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val start = args["start_date"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val end = args["end_date"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val days = args["days"]?.jsonPrimitive?.intOrNull ?: 0
            calculateDate(mode, start, end, days)
        }
        "get_system_time" -> {
            val now = ZonedDateTime.now()
            val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
            "当前系统时间：${now.format(fmt)}（${chineseWeekday(now.dayOfWeek)}，时区 ${now.zone}）"
        }
        "knowledge_deep_search" -> {
            val query = args["query"]?.jsonPrimitive?.contentOrNull.orEmpty().trim()
            if (query.isEmpty()) "检索词不能为空。" else knowledgeSearcher(query)
        }
        else -> "不支持的工具：$name"
    }

    /**
     * Strict recursive-descent math evaluator with token whitelist (no eval/script injection).
     */
    fun safeEvaluateMath(rawExpression: String): Double {
        val expr = rawExpression.trim()
        require(expr.isNotEmpty() && expr.length <= 200) { "表达式为空或过长。" }
        val parser = MathParser(expr)
        val value = parser.parseExpression()
        parser.expectEnd()
        require(value.isFinite()) { "计算结果溢出或无定义（NaN/Infinity）。" }
        return value
    }

    fun formatNumber(value: Double): String {
        val rounded = BigDecimal.valueOf(value).setScale(10, RoundingMode.HALF_UP).stripTrailingZeros()
        return rounded.toPlainString()
    }

    fun computeStats(numbers: List<Double>): String {
        require(numbers.isNotEmpty()) { "数字列表不能为空。" }
        val sorted = numbers.sorted()
        val n = numbers.size
        val sum = numbers.sum()
        val mean = sum / n
        val median = if (n % 2 == 1) sorted[n / 2] else (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
        val min = sorted.first()
        val max = sorted.last()
        val range = max - min
        val variance = numbers.sumOf { (it - mean).pow(2) } / n
        val stdDev = sqrt(variance)
        return buildString {
            append("统计结果（共 $n 项）：")
            append("总和=${formatNumber(sum)}，")
            append("均值=${formatNumber(mean)}，")
            append("中位数=${formatNumber(median)}，")
            append("最小值=${formatNumber(min)}，")
            append("最大值=${formatNumber(max)}，")
            append("极差=${formatNumber(range)}，")
            append("方差=${formatNumber(variance)}，")
            append("标准差=${formatNumber(stdDev)}")
        }
    }

    fun calculateDate(mode: String, startDateStr: String, endDateStr: String = "", daysOffset: Int = 0): String {
        val start = LocalDate.parse(startDateStr.trim())
        return when (mode.lowercase()) {
            "diff" -> {
                val end = LocalDate.parse(endDateStr.trim())
                val diff = ChronoUnit.DAYS.between(start, end)
                "从 $start（${chineseWeekday(start.dayOfWeek)}）到 $end（${chineseWeekday(end.dayOfWeek)}）相差 $diff 天（约 ${diff / 7} 周余 ${abs(diff % 7)} 天）。"
            }
            "offset" -> {
                val target = start.plusDays(daysOffset.toLong())
                "$start 偏移 $daysOffset 天后是 $target（${chineseWeekday(target.dayOfWeek)}）。"
            }
            else -> throw IllegalArgumentException("mode 仅支持 diff 或 offset。")
        }
    }

    private fun chineseWeekday(dow: DayOfWeek): String = when (dow) {
        DayOfWeek.MONDAY -> "星期一"
        DayOfWeek.TUESDAY -> "星期二"
        DayOfWeek.WEDNESDAY -> "星期三"
        DayOfWeek.THURSDAY -> "星期四"
        DayOfWeek.FRIDAY -> "星期五"
        DayOfWeek.SATURDAY -> "星期六"
        DayOfWeek.SUNDAY -> "星期日"
    }

    private class MathParser(private val input: String) {
        private var pos = 0

        private fun skipSpaces() {
            while (pos < input.length && input[pos].isWhitespace()) pos++
        }

        fun expectEnd() {
            skipSpaces()
            require(pos == input.length) { "表达式包含无效字符：'${input.substring(pos)}'" }
        }

        fun parseExpression(): Double {
            var left = parseTerm()
            while (true) {
                skipSpaces()
                when {
                    match('+') -> left += parseTerm()
                    match('-') -> left -= parseTerm()
                    else -> return left
                }
            }
        }

        private fun parseTerm(): Double {
            var left = parsePower()
            while (true) {
                skipSpaces()
                when {
                    match('*') -> left *= parsePower()
                    match('/') -> {
                        val right = parsePower()
                        require(right != 0.0) { "除数不能为 0。" }
                        left /= right
                    }
                    match('%') -> {
                        val right = parsePower()
                        require(right != 0.0) { "取余除数不能为 0。" }
                        left %= right
                    }
                    else -> return left
                }
            }
        }

        private fun parsePower(): Double {
            val base = parseUnary()
            skipSpaces()
            return if (match('^')) base.pow(parsePower()) else base
        }

        private fun parseUnary(): Double {
            skipSpaces()
            return when {
                match('+') -> parseUnary()
                match('-') -> -parseUnary()
                else -> parsePrimary()
            }
        }

        private fun parsePrimary(): Double {
            skipSpaces()
            if (match('(')) {
                val inner = parseExpression()
                skipSpaces()
                require(match(')')) { "缺少右括号 ')'。" }
                return inner
            }
            val start = pos
            if (pos < input.length && (input[pos].isDigit() || input[pos] == '.')) {
                while (pos < input.length && (input[pos].isDigit() || input[pos] == '.')) pos++
                return input.substring(start, pos).toDoubleOrNull()
                    ?: throw IllegalArgumentException("无效数字：${input.substring(start, pos)}")
            }
            if (pos < input.length && input[pos].isLetter()) {
                while (pos < input.length && input[pos].isLetter()) pos++
                val ident = input.substring(start, pos).lowercase()
                skipSpaces()
                if (ident == "pi") return Math.PI
                if (ident == "e") return Math.E
                require(match('(')) { "未知标识符或函数：$ident" }
                val arg1 = parseExpression()
                skipSpaces()
                val arg2 = if (match(',')) parseExpression() else null
                skipSpaces()
                require(match(')')) { "函数 $ident 缺少右括号。" }
                return when (ident) {
                    "sqrt" -> sqrt(arg1)
                    "abs" -> abs(arg1)
                    "round" -> round(arg1)
                    "sin" -> sin(arg1)
                    "cos" -> cos(arg1)
                    "pow" -> arg1.pow(arg2 ?: throw IllegalArgumentException("pow 需要两个参数"))
                    else -> throw IllegalArgumentException("不允许调用函数：$ident")
                }
            }
            throw IllegalArgumentException("位置 $pos 语法无效。")
        }

        private fun match(ch: Char): Boolean {
            if (pos < input.length && input[pos] == ch) {
                pos++
                return true
            }
            return false
        }
    }
}
