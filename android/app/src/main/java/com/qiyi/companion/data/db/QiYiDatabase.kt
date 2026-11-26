package com.qiyi.companion.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        PersonaEntity::class,
        ConversationEntity::class,
        MessageEntity::class,
        KnowledgeDocumentEntity::class,
        KnowledgeChunkEntity::class,
        MemoryEntity::class,
        MusicTrackEntity::class,
        UsageRecordEntity::class,
        MemoryTripleEntity::class,
        ScheduledTaskEntity::class,
        MailDraftEntity::class,
        ResumableRunEntity::class
    ],
    version = 5,
    exportSchema = false
)
abstract class QiYiDatabase : RoomDatabase() {
    abstract fun personaDao(): PersonaDao
    abstract fun conversationDao(): ConversationDao
    abstract fun messageDao(): MessageDao
    abstract fun knowledgeDao(): KnowledgeDao
    abstract fun memoryDao(): MemoryDao
    abstract fun musicTrackDao(): MusicTrackDao
    abstract fun usageDao(): UsageDao
    abstract fun memoryTripleDao(): MemoryTripleDao
    abstract fun scheduledTaskDao(): ScheduledTaskDao
    abstract fun mailDraftDao(): MailDraftDao
    abstract fun resumableRunDao(): ResumableRunDao

    companion object {
        @Volatile
        private var instance: QiYiDatabase? = null

        val MIGRATION_1_2: Migration = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `knowledge_documents` (
                        `id` TEXT NOT NULL,
                        `title` TEXT NOT NULL,
                        `sourceName` TEXT NOT NULL,
                        `chunkCount` INTEGER NOT NULL,
                        `charCount` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `knowledge_chunks` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `documentId` TEXT NOT NULL,
                        `documentTitle` TEXT NOT NULL,
                        `chunkIndex` INTEGER NOT NULL,
                        `content` TEXT NOT NULL,
                        FOREIGN KEY(`documentId`) REFERENCES `knowledge_documents`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_knowledge_chunks_documentId` ON `knowledge_chunks` (`documentId`)")
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `memories` (
                        `id` TEXT NOT NULL,
                        `personaId` TEXT,
                        `category` TEXT NOT NULL,
                        `content` TEXT NOT NULL,
                        `importance` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_memories_personaId` ON `memories` (`personaId`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_memories_updatedAt` ON `memories` (`updatedAt`)")
            }
        }

        val MIGRATION_2_3: Migration = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `conversations` ADD COLUMN `isGroup` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `conversations` ADD COLUMN `participantIds` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `messages` ADD COLUMN `senderPersonaId` TEXT")
                db.execSQL("ALTER TABLE `messages` ADD COLUMN `senderName` TEXT")
            }
        }

        val MIGRATION_3_4: Migration = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `conversations` ADD COLUMN `userMood` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `conversations` ADD COLUMN `assistantStyle` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `conversations` ADD COLUMN `relationshipStage` TEXT NOT NULL DEFAULT '初识'")
            }
        }

        val MIGRATION_4_5: Migration = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `messages` ADD COLUMN `stickerId` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `messages` ADD COLUMN `citationsJson` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `messages` ADD COLUMN `toolTrace` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `knowledge_chunks` ADD COLUMN `embeddingJson` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `memories` ADD COLUMN `isPinned` INTEGER NOT NULL DEFAULT 0")
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `music_tracks` (
                        `id` TEXT NOT NULL,
                        `title` TEXT NOT NULL,
                        `artist` TEXT NOT NULL,
                        `source` TEXT NOT NULL,
                        `localPath` TEXT NOT NULL,
                        `remoteUrl` TEXT NOT NULL,
                        `durationMs` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `usage_records` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `conversationId` TEXT NOT NULL,
                        `personaId` TEXT NOT NULL,
                        `model` TEXT NOT NULL,
                        `promptTokens` INTEGER NOT NULL,
                        `completionTokens` INTEGER NOT NULL,
                        `totalTokens` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_usage_records_createdAt` ON `usage_records` (`createdAt`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_usage_records_model` ON `usage_records` (`model`)")
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `memory_triples` (
                        `id` TEXT NOT NULL,
                        `subject` TEXT NOT NULL,
                        `predicate` TEXT NOT NULL,
                        `objectValue` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `scheduled_tasks` (
                        `id` TEXT NOT NULL,
                        `personaId` TEXT NOT NULL,
                        `title` TEXT NOT NULL,
                        `prompt` TEXT NOT NULL,
                        `intervalMinutes` INTEGER NOT NULL,
                        `enabled` INTEGER NOT NULL,
                        `lastRunAt` INTEGER NOT NULL,
                        `lastResult` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `mail_drafts` (
                        `id` TEXT NOT NULL,
                        `recipient` TEXT NOT NULL,
                        `subject` TEXT NOT NULL,
                        `body` TEXT NOT NULL,
                        `status` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `resumable_runs` (
                        `id` TEXT NOT NULL,
                        `conversationId` TEXT NOT NULL,
                        `pendingPersonaIds` TEXT NOT NULL,
                        `latestQuery` TEXT NOT NULL,
                        `isGroupChat` INTEGER NOT NULL,
                        `resumeAtEpochMs` INTEGER NOT NULL,
                        `reason` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
            }
        }

        fun getInstance(context: Context): QiYiDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    QiYiDatabase::class.java,
                    "qiyi_companion.db"
                )
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5)
                    .build()
                    .also { instance = it }
            }
        }
    }
}
