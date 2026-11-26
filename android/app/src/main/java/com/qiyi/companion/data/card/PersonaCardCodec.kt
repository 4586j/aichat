package com.qiyi.companion.data.card

import com.qiyi.companion.data.db.PersonaEntity
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import java.util.UUID

@Serializable
data class PersonaCardPayload(
    val format: String = "qiyi-persona-card",
    val version: Int = 1,
    val exportedAt: String = Instant.now().toString(),
    val persona: PersonaCardFields,
    val memories: List<PersonaCardMemory> = emptyList()
)

@Serializable
data class PersonaCardFields(
    val name: String,
    val description: String = "",
    val systemPrompt: String,
    val tone: String = "",
    val greeting: String = "",
    val avatar: String = "",
    val model: String = ""
)

@Serializable
data class PersonaCardMemory(
    val content: String,
    val category: String = "fact",
    val importance: Double = 0.7,
    val confidence: Double = 0.8,
    val pinned: Boolean = false
)

/**
 * 100% compatible with PC QiYi `lib/backup.mjs` persona card JSON format.
 */
object PersonaCardCodec {
    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = true
    }

    fun encode(persona: PersonaEntity): String {
        val card = PersonaCardPayload(
            persona = PersonaCardFields(
                name = persona.name,
                description = persona.description,
                systemPrompt = persona.systemPrompt,
                tone = persona.tone,
                greeting = persona.greeting,
                avatar = persona.avatar,
                model = persona.model
            )
        )
        return json.encodeToString(PersonaCardPayload.serializer(), card)
    }

    fun decodeToNewPersona(rawJson: String): PersonaEntity {
        val payload = json.decodeFromString(PersonaCardPayload.serializer(), rawJson)
        if (payload.format.isNotBlank() && payload.format != "qiyi-persona-card") {
            throw IllegalArgumentException("不支持的文件格式，请导入栖忆角色卡 JSON。")
        }
        val p = payload.persona
        val cleanName = p.name.trim().take(60)
        val cleanPrompt = p.systemPrompt.trim().take(8000)
        if (cleanName.isEmpty() || cleanPrompt.isEmpty()) {
            throw IllegalArgumentException("角色卡必须包含有效的角色名称和人设提示词。")
        }
        return PersonaEntity(
            id = UUID.randomUUID().toString(),
            name = cleanName,
            description = p.description.trim().take(300),
            systemPrompt = cleanPrompt,
            tone = p.tone.trim().take(200),
            greeting = p.greeting.trim().take(1000),
            avatar = p.avatar.trim().take(524288),
            model = p.model.trim().take(160),
            createdAt = System.currentTimeMillis()
        )
    }
}
