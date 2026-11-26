package com.qiyi.companion.data.media

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qiyi.companion.ui.theme.LocalGardenColors

data class BuiltinSticker(
    val id: String,
    val caption: String,
    val description: String,
    val keywords: List<String>,
    val fillHex: Long,
    val mood: String
)

/**
 * Exact 6 original 栖忆 "小叶" vector stickers ported from `lib/builtin-stickers.mjs`.
 */
object StickerCatalog {
    val all: List<BuiltinSticker> = listOf(
        BuiltinSticker("leaf-cheer", "好耶", "小叶开心地举起双手，庆祝成功和好消息", listOf("开心", "庆祝", "好耶", "成功", "加油", "太棒", "搞定", "完成"), 0xFFE5EDC8, "happy"),
        BuiltinSticker("leaf-hug", "抱抱", "小叶张开双臂，温和地安慰、陪伴和鼓励", listOf("抱抱", "安慰", "陪伴", "难过", "辛苦", "累", "疲惫", "别担心"), 0xFFF2E2D6, "hug"),
        BuiltinSticker("leaf-think", "让我想想", "小叶托着脸思考，适合讨论和琢磨问题", listOf("思考", "想想", "分析", "思路", "方案", "琢磨", "原理"), 0xFFE3E9EF, "think"),
        BuiltinSticker("leaf-thanks", "谢谢你", "小叶捧着一朵花，表达感谢和认可", listOf("谢谢", "感谢", "认可", "感动", "不客气", "荣幸"), 0xFFF4E7C8, "thanks"),
        BuiltinSticker("leaf-wave", "我在呢", "小叶挥手打招呼，回应问候和重逢", listOf("你好", "问候", "早安", "午安", "我在", "欢迎", "嗨"), 0xFFDFECE2, "wave"),
        BuiltinSticker("leaf-rest", "歇一会儿", "小叶靠着软垫休息，提醒喝茶和放松", listOf("休息", "放松", "晚安", "睡觉", "喝茶", "早点睡", "保重"), 0xFFE8E4F0, "rest")
    )

    fun findById(id: String?): BuiltinSticker? = all.firstOrNull { it.id == id }

    /**
     * Picks a matching sticker based on user query + assistant reply text.
     */
    fun matchSticker(userQuery: String, replyText: String): BuiltinSticker? {
        val combined = "$userQuery\n$replyText"
        var best: BuiltinSticker? = null
        var bestScore = 0
        for (sticker in all) {
            val score = sticker.keywords.count { combined.contains(it) }
            if (score > bestScore) {
                bestScore = score
                best = sticker
            }
        }
        return if (bestScore > 0) best else null
    }
}

@Composable
fun StickerCard(
    sticker: BuiltinSticker,
    size: Dp = 88.dp,
    modifier: Modifier = Modifier
) {
    val garden = LocalGardenColors.current
    val strokeColor = Color(0xFF315C47)
    val bodyColor = Color(sticker.fillHex)
    val leafColor = Color(0xFFC7D9AF)
    val blushColor = Color(0x66DCA48C)

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        color = garden.paperCard,
        border = BorderStroke(0.9.dp, garden.line)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Canvas(modifier = Modifier.size(size)) {
                val sx = this.size.width / 220f
                val sy = this.size.height / 220f
                val stroke = Stroke(width = 3.2f * sx, cap = StrokeCap.Round)

                // Soft shadow
                drawOval(
                    color = Color(0x18315C47),
                    topLeft = Offset(52f * sx, 155f * sy),
                    size = Size(116f * sx, 16f * sy)
                )

                // Little legs
                drawLine(strokeColor, Offset(77f * sx, 148f * sy), Offset(77f * sx, 162f * sy), strokeWidth = 3f * sx, cap = StrokeCap.Round)
                drawLine(strokeColor, Offset(142f * sx, 148f * sy), Offset(142f * sx, 162f * sy), strokeWidth = 3f * sx, cap = StrokeCap.Round)

                // Arms by mood
                when (sticker.mood) {
                    "happy" -> {
                        drawLine(strokeColor, Offset(64f * sx, 119f * sy), Offset(43f * sx, 88f * sy), strokeWidth = 3f * sx, cap = StrokeCap.Round)
                        drawLine(strokeColor, Offset(150f * sx, 119f * sy), Offset(172f * sx, 88f * sy), strokeWidth = 3f * sx, cap = StrokeCap.Round)
                    }
                    "hug" -> {
                        drawLine(strokeColor, Offset(65f * sx, 119f * sy), Offset(37f * sx, 129f * sy), strokeWidth = 3f * sx, cap = StrokeCap.Round)
                        drawLine(strokeColor, Offset(150f * sx, 119f * sy), Offset(180f * sx, 129f * sy), strokeWidth = 3f * sx, cap = StrokeCap.Round)
                    }
                    else -> {
                        drawLine(strokeColor, Offset(65f * sx, 121f * sy), Offset(48f * sx, 138f * sy), strokeWidth = 3f * sx, cap = StrokeCap.Round)
                        drawLine(strokeColor, Offset(150f * sx, 121f * sy), Offset(168f * sx, 138f * sy), strokeWidth = 3f * sx, cap = StrokeCap.Round)
                    }
                }

                // Round body
                drawOval(
                    color = bodyColor,
                    topLeft = Offset(62f * sx, 76f * sy),
                    size = Size(92f * sx, 80f * sy)
                )
                drawOval(
                    color = strokeColor,
                    topLeft = Offset(62f * sx, 76f * sy),
                    size = Size(92f * sx, 80f * sy),
                    style = stroke
                )

                // Top sprout stem + two leaves
                drawLine(strokeColor, Offset(108f * sx, 76f * sy), Offset(108f * sx, 46f * sy), strokeWidth = 3f * sx, cap = StrokeCap.Round)
                drawOval(color = leafColor, topLeft = Offset(78f * sx, 42f * sy), size = Size(28f * sx, 18f * sy))
                drawOval(color = strokeColor, topLeft = Offset(78f * sx, 42f * sy), size = Size(28f * sx, 18f * sy), style = stroke)
                drawOval(color = leafColor, topLeft = Offset(110f * sx, 38f * sy), size = Size(28f * sx, 18f * sy))
                drawOval(color = strokeColor, topLeft = Offset(110f * sx, 38f * sy), size = Size(28f * sx, 18f * sy), style = stroke)

                // Eyes
                when (sticker.mood) {
                    "rest" -> {
                        val p1 = Path().apply { moveTo(83f * sx, 108f * sy); quadraticTo(90f * sx, 115f * sy, 97f * sx, 108f * sy) }
                        val p2 = Path().apply { moveTo(115f * sx, 108f * sy); quadraticTo(122f * sx, 115f * sy, 129f * sx, 108f * sy) }
                        drawPath(p1, strokeColor, style = stroke)
                        drawPath(p2, strokeColor, style = stroke)
                    }
                    "happy" -> {
                        val p1 = Path().apply { moveTo(83f * sx, 112f * sy); quadraticTo(90f * sx, 100f * sy, 97f * sx, 112f * sy) }
                        val p2 = Path().apply { moveTo(115f * sx, 112f * sy); quadraticTo(122f * sx, 100f * sy, 129f * sx, 112f * sy) }
                        drawPath(p1, strokeColor, style = stroke)
                        drawPath(p2, strokeColor, style = stroke)
                    }
                    else -> {
                        drawCircle(strokeColor, radius = 3.5f * sx, center = Offset(91f * sx, 110f * sy))
                        drawCircle(strokeColor, radius = 3.5f * sx, center = Offset(123f * sx, 110f * sy))
                    }
                }

                // Mouth
                val mouth = Path().apply {
                    moveTo(101f * sx, 125f * sy)
                    quadraticTo(107f * sx, (if (sticker.mood == "think") 122f else 133f) * sy, 113f * sx, 125f * sy)
                }
                drawPath(mouth, strokeColor, style = stroke)

                // Rosy cheeks
                drawOval(color = blushColor, topLeft = Offset(72f * sx, 118f * sy), size = Size(16f * sx, 8f * sy))
                drawOval(color = blushColor, topLeft = Offset(128f * sx, 118f * sy), size = Size(16f * sx, 8f * sy))
            }
            Spacer(Modifier.height(2.dp))
            Text(
                text = sticker.caption,
                fontFamily = FontFamily.Serif,
                fontWeight = FontWeight.SemiBold,
                fontSize = 12.sp,
                color = garden.ink
            )
        }
    }
}
