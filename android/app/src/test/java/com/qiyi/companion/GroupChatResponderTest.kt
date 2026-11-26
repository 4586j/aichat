package com.qiyi.companion

import com.qiyi.companion.data.db.PersonaEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class GroupChatResponderTest {

    private val roles = listOf(
        PersonaEntity(id = "p1", name = "望舒", systemPrompt = "s1"),
        PersonaEntity(id = "p2", name = "青岚", systemPrompt = "s2"),
        PersonaEntity(id = "p3", name = "墨竹", systemPrompt = "s3")
    )

    private fun resolveResponders(userText: String, participants: List<PersonaEntity>): List<PersonaEntity> {
        val mentioned = participants.filter { role ->
            role.name.isNotBlank() && userText.contains("@${role.name}")
        }
        return mentioned.ifEmpty { participants }
    }

    @Test
    fun mentionsFilterSpecificRespondersInOrder() {
        val picked = resolveResponders("请问 @青岚 和 @墨竹 怎么看这个方案？", roles)
        assertEquals(listOf("p2", "p3"), picked.map { it.id })
    }

    @Test
    fun noMentionsReturnsAllParticipants() {
        val picked = resolveResponders("大家今天聊点什么？", roles)
        assertEquals(listOf("p1", "p2", "p3"), picked.map { it.id })
    }
}
