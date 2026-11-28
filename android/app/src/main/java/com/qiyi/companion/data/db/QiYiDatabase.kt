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
        ResumableRunEntity::class,
        AuthorizedDirectoryEntity::class,
        FileSnapshotEntity::class,
        AgentAuditLogEntity::class
    ],
    version = 10,
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
    abstract fun authorizedDirectoryDao(): AuthorizedDirectoryDao
    abstract fun fileSnapshotDao(): FileSnapshotDao
    abstract fun agentAuditLogDao(): AgentAuditLogDao

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

        val MIGRATION_5_6: Migration = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `usage_records` ADD COLUMN `cachedPromptTokens` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `usage_records` ADD COLUMN `reasoningTokens` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `usage_records` ADD COLUMN `durationMs` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `usage_records` ADD COLUMN `source` TEXT NOT NULL DEFAULT 'estimated'")
            }
        }

        val MIGRATION_6_7: Migration = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `messages` ADD COLUMN `imagePathsJson` TEXT NOT NULL DEFAULT ''")
            }
        }

        val MIGRATION_7_8: Migration = object : Migration(7, 8) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `conversations` ADD COLUMN `contextSummary` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `conversations` ADD COLUMN `compactedUpToMessageId` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `conversations` ADD COLUMN `compactedAt` INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_8_9: Migration = object : Migration(8, 9) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE `music_tracks` ADD COLUMN `album` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `music_tracks` ADD COLUMN `coverUrl` TEXT NOT NULL DEFAULT ''")
                db.execSQL("ALTER TABLE `music_tracks` ADD COLUMN `isFavorite` INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE `music_tracks` ADD COLUMN `lastPlayedAt` INTEGER NOT NULL DEFAULT 0")
            }
        }

        val MIGRATION_9_10: Migration = object : Migration(9, 10) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `authorized_directories` (
                        `id` TEXT NOT NULL,
                        `alias` TEXT NOT NULL,
                        `treeUri` TEXT NOT NULL,
                        `displayName` TEXT NOT NULL,
                        `readOnly` INTEGER NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_authorized_directories_alias` ON `authorized_directories` (`alias`)")
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `file_snapshots` (
                        `id` TEXT NOT NULL,
                        `auditLogId` TEXT NOT NULL,
                        `directoryId` TEXT NOT NULL,
                        `relativePath` TEXT NOT NULL,
                        `documentUri` TEXT NOT NULL,
                        `operation` TEXT NOT NULL,
                        `backupFilePath` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        `restoredAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_file_snapshots_createdAt` ON `file_snapshots` (`createdAt`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_file_snapshots_auditLogId` ON `file_snapshots` (`auditLogId`)")
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS `agent_audit_logs` (
                        `id` TEXT NOT NULL,
                        `conversationId` TEXT NOT NULL,
                        `toolName` TEXT NOT NULL,
                        `riskLevel` TEXT NOT NULL,
                        `argsSummary` TEXT NOT NULL,
                        `decision` TEXT NOT NULL,
                        `resultSummary` TEXT NOT NULL,
                        `snapshotId` TEXT NOT NULL,
                        `createdAt` INTEGER NOT NULL,
                        PRIMARY KEY(`id`)
                    )
                    """.trimIndent()
                )
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_agent_audit_logs_createdAt` ON `agent_audit_logs` (`createdAt`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_agent_audit_logs_conversationId` ON `agent_audit_logs` (`conversationId`)")
            }
        }

        fun getInstance(context: Context): QiYiDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    QiYiDatabase::class.java,
                    "qiyi_companion.db"
                )
                    .addMigrations(
                        MIGRATION_1_2,
                        MIGRATION_2_3,
                        MIGRATION_3_4,
                        MIGRATION_4_5,
                        MIGRATION_5_6,
                        MIGRATION_6_7,
                        MIGRATION_7_8,
                        MIGRATION_8_9,
                        MIGRATION_9_10
                    )
                    .build()
                    .also { instance = it }
            }
        }
    }
}
