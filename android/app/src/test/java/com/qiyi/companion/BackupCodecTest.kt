package com.qiyi.companion

import com.qiyi.companion.data.backup.BackupCodec
import com.qiyi.companion.data.backup.BackupPayload
import com.qiyi.companion.data.db.ConversationEntity
import com.qiyi.companion.data.db.KnowledgeChunkEntity
import com.qiyi.companion.data.db.KnowledgeDocumentEntity
import com.qiyi.companion.data.db.MemoryEntity
import com.qiyi.companion.data.db.MessageEntity
import com.qiyi.companion.data.db.PersonaEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackupCodecTest {

    @Test
    fun fullBackupRoundTripPreservesAllEntitiesAndExcludesSecrets() {
        val payload = BackupPayload(
            personas = listOf(PersonaEntity(id = "p1", name = "望舒", systemPrompt = "你是望舒", model = "deepseek-chat")),
            conversations = listOf(ConversationEntity(id = "c1", personaId = "p1", title = "雅集群聊", isGroup = true, participantIds = "p1,p2")),
            messages = listOf(MessageEntity(id = 1, conversationId = "c1", role = "assistant", content = "你好", reasoning = "先想一下", senderPersonaId = "p1", senderName = "望舒")),
            knowledgeDocuments = listOf(KnowledgeDocumentEntity(id = "d1", title = "茶谱", sourceName = "tea.md", chunkCount = 1, charCount = 20)),
            knowledgeChunks = listOf(KnowledgeChunkEntity(id = 1, documentId = "d1", documentTitle = "茶谱", chunkIndex = 0, content = "龙井茶香气清雅")),
            memories = listOf(MemoryEntity(id = "m1", category = "preference", content = "偏好夜雨主题", importance = 5))
        )

        val encoded = BackupCodec.encodeBackup(payload)
        assertTrue(encoded.contains("qiyi-android-backup"))
        assertFalse(encoded.contains("apiKey"))

        val decoded = BackupCodec.decodeBackup(encoded)
        assertEquals(1, decoded.personas.size)
        assertEquals("deepseek-chat", decoded.personas.first().model)
        assertEquals(true, decoded.conversations.first().isGroup)
        assertEquals("望舒", decoded.messages.first().senderName)
        assertEquals("茶谱", decoded.knowledgeDocuments.first().title)
        assertEquals("偏好夜雨主题", decoded.memories.first().content)
    }

    @Test
    fun formatConversationMarkdownIncludesReasoningAndSpeakerNames() {
        val conv = ConversationEntity(id = "c1", personaId = "p1", title = "园林对谈", isGroup = true, participantIds = "p1,p2")
        val msgs = listOf(
            MessageEntity(id = 1, conversationId = "c1", role = "user", content = "今天怎么看？"),
            MessageEntity(id = 2, conversationId = "c1", role = "assistant", content = "循序渐进最好。", reasoning = "梳理节奏", senderName = "青岚")
        )

        val md = BackupCodec.formatConversationMarkdown(conv, msgs, "望舒")
        assertTrue(md.contains("# 园林对谈"))
        assertTrue(md.contains("多角色群聊"))
        assertTrue(md.contains("### 青岚"))
        assertTrue(md.contains("<summary>思考过程</summary>"))
        assertTrue(md.contains("循序渐进最好。"))
    }
}
