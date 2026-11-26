package com.qiyi.companion

import com.qiyi.companion.data.card.PersonaCardCodec
import com.qiyi.companion.data.db.PersonaEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PersonaCardCodecTest {

    @Test
    fun encodeAndDecodeRoundTripPreservesAllFields() {
        val original = PersonaEntity(
            id = "orig-id-123",
            name = "青岚",
            description = "擅长梳理复杂方案的园林茶友",
            systemPrompt = "你是青岚，说话温和而有条理。",
            tone = "温润克制",
            greeting = "泡好茶了，说说今天的想法吧。",
            avatar = "🍵",
            model = "deepseek-reasoner"
        )

        val encoded = PersonaCardCodec.encode(original)
        assertTrue(encoded.contains("qiyi-persona-card"))
        assertTrue(encoded.contains("\"model\": \"deepseek-reasoner\""))

        val decoded = PersonaCardCodec.decodeToNewPersona(encoded)
        assertNotEquals(original.id, decoded.id)
        assertEquals(original.name, decoded.name)
        assertEquals(original.description, decoded.description)
        assertEquals(original.systemPrompt, decoded.systemPrompt)
        assertEquals(original.tone, decoded.tone)
        assertEquals(original.greeting, decoded.greeting)
        assertEquals(original.avatar, decoded.avatar)
        assertEquals(original.model, decoded.model)
    }

    @Test
    fun decodePcExportedCardWithExtraFieldsSucceeds() {
        val pcCardJson = """
            {
              "format": "qiyi-persona-card",
              "version": 1,
              "exportedAt": "2026-11-26T08:00:00.000Z",
              "persona": {
                "name": "望舒",
                "description": "认真倾听，也帮你把事情想清楚。",
                "systemPrompt": "你是望舒，自然真诚。",
                "tone": "温和、简洁",
                "greeting": "你好呀",
                "avatar": "🌿",
                "model": "gpt-4o-mini",
                "unknownExtraField": "ignored-safely"
              }
            }
        """.trimIndent()

        val imported = PersonaCardCodec.decodeToNewPersona(pcCardJson)
        assertEquals("望舒", imported.name)
        assertEquals("gpt-4o-mini", imported.model)
        assertEquals("🌿", imported.avatar)
    }

    @Test(expected = IllegalArgumentException::class)
    fun decodeRejectsMissingRequiredFields() {
        val invalid = """{"format":"qiyi-persona-card","version":1,"persona":{"name":"","systemPrompt":""}}"""
        PersonaCardCodec.decodeToNewPersona(invalid)
    }
}
