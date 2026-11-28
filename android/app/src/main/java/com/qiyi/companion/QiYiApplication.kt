package com.qiyi.companion

import android.app.Application
import com.qiyi.companion.data.QiYiRepository
import com.qiyi.companion.data.agent.AppLauncherEngine
import com.qiyi.companion.data.agent.DeviceToolDispatcher
import com.qiyi.companion.data.agent.SafFileWorkspaceEngine
import com.qiyi.companion.data.agent.SystemActionEngine
import com.qiyi.companion.data.chat.ChatGenerationManager
import com.qiyi.companion.data.db.QiYiDatabase
import com.qiyi.companion.data.media.MusicPlayerController
import com.qiyi.companion.data.prefs.SecurePreferences

class QiYiApplication : Application() {
    val database: QiYiDatabase by lazy { QiYiDatabase.getInstance(this) }
    val securePreferences: SecurePreferences by lazy { SecurePreferences(this) }
    val musicPlayer: MusicPlayerController by lazy { MusicPlayerController(this) }
    val fileWorkspace: SafFileWorkspaceEngine by lazy { SafFileWorkspaceEngine(this, database) }
    val appLauncher: AppLauncherEngine by lazy { AppLauncherEngine(this) }
    val systemActions: SystemActionEngine by lazy { SystemActionEngine(this) }
    val deviceToolDispatcher: DeviceToolDispatcher by lazy {
        DeviceToolDispatcher(
            appContext = this,
            db = database,
            prefs = securePreferences,
            fileWorkspace = fileWorkspace,
            appLauncher = appLauncher,
            systemActions = systemActions
        )
    }
    val repository: QiYiRepository by lazy {
        QiYiRepository(
            db = database,
            prefs = securePreferences,
            deviceToolDispatcher = deviceToolDispatcher
        )
    }
    val generationManager: ChatGenerationManager by lazy { ChatGenerationManager(this, repository) }
}
