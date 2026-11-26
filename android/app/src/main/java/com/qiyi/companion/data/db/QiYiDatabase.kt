package com.qiyi.companion.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [PersonaEntity::class, ConversationEntity::class, MessageEntity::class],
    version = 1,
    exportSchema = false
)
abstract class QiYiDatabase : RoomDatabase() {
    abstract fun personaDao(): PersonaDao
    abstract fun conversationDao(): ConversationDao
    abstract fun messageDao(): MessageDao

    companion object {
        @Volatile
        private var instance: QiYiDatabase? = null

        fun getInstance(context: Context): QiYiDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    QiYiDatabase::class.java,
                    "qiyi_companion.db"
                ).build().also { instance = it }
            }
        }
    }
}
