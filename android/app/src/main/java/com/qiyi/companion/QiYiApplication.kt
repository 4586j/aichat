package com.qiyi.companion

import android.app.Application
import com.qiyi.companion.data.QiYiRepository
import com.qiyi.companion.data.db.QiYiDatabase
import com.qiyi.companion.data.media.MusicPlayerController
import com.qiyi.companion.data.prefs.SecurePreferences

class QiYiApplication : Application() {
    val database: QiYiDatabase by lazy { QiYiDatabase.getInstance(this) }
    val securePreferences: SecurePreferences by lazy { SecurePreferences(this) }
    val musicPlayer: MusicPlayerController by lazy { MusicPlayerController(this) }
    val repository: QiYiRepository by lazy { QiYiRepository(database, securePreferences) }
}
