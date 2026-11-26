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
        MemoryEntity::class
    ],
    version = 4,
    exportSchema = false
)
abstract class QiYiDatabase : RoomDatabase() {
    abstract fun personaDao(): PersonaDao
    abstract fun conversationDao(): ConversationDao
    abstract fun messageDao(): MessageDao
    abstract fun knowledgeDao(): KnowledgeDao
    abstract fun memoryDao(): MemoryDao

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

        fun getInstance(context: Context): QiYiDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    QiYiDatabase::class.java,
                    "qiyi_companion.db"
                )
                    .addMigrations(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
                    .build()
                    .also { instance = it }
            }
        }
    }
}
