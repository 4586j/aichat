package com.qiyi.companion.data.prefs

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class GardenThemeMode(val key: String, val label: String, val subtitle: String) {
    SPRING("spring", "春园", "暖宣青绿 · 日间"),
    AUTUMN("autumn", "秋庭", "霜枫暖金 · 傍晚"),
    NIGHT("night", "夜雨", "黑漆螺钿 · 护眼暗色");

    companion object {
        fun fromKey(key: String?): GardenThemeMode =
            entries.firstOrNull { it.key == key } ?: SPRING
    }
}

data class AppSettings(
    val baseUrl: String = "https://api.openai.com/v1",
    val defaultModel: String = "",
    val hasApiKey: Boolean = false,
    val themeMode: GardenThemeMode = GardenThemeMode.SPRING,
    val userAvatar: String = ""
)

/**
 * Persists non-secret UI/model settings in standard SharedPreferences,
 * and stores the API key exclusively inside Android Keystore-backed EncryptedSharedPreferences.
 * API keys are NEVER written into Room SQLite.
 */
class SecurePreferences(context: Context) {
    private val appContext = context.applicationContext
    private val plainPrefs: SharedPreferences =
        appContext.getSharedPreferences("qiyi_settings", Context.MODE_PRIVATE)

    private val secretPrefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            "qiyi_secure_keys",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private val _settings = MutableStateFlow(readSnapshot())
    val settings: StateFlow<AppSettings> = _settings.asStateFlow()

    private fun readSnapshot(): AppSettings = AppSettings(
        baseUrl = plainPrefs.getString(KEY_BASE_URL, "https://api.openai.com/v1") ?: "https://api.openai.com/v1",
        defaultModel = plainPrefs.getString(KEY_DEFAULT_MODEL, "") ?: "",
        hasApiKey = !getApiKey().isNullOrBlank(),
        themeMode = GardenThemeMode.fromKey(plainPrefs.getString(KEY_THEME, GardenThemeMode.SPRING.key)),
        userAvatar = plainPrefs.getString(KEY_USER_AVATAR, "") ?: ""
    )

    fun getApiKey(): String = secretPrefs.getString(KEY_API_KEY, "") ?: ""

    fun saveModelSettings(
        baseUrl: String,
        defaultModel: String,
        newApiKey: String?,
        clearApiKey: Boolean
    ) {
        plainPrefs.edit()
            .putString(KEY_BASE_URL, baseUrl.trim().trimEnd('/'))
            .putString(KEY_DEFAULT_MODEL, defaultModel.trim())
            .apply()
        if (clearApiKey) {
            secretPrefs.edit().remove(KEY_API_KEY).apply()
        } else if (!newApiKey.isNullOrBlank()) {
            secretPrefs.edit().putString(KEY_API_KEY, newApiKey.trim()).apply()
        }
        _settings.value = readSnapshot()
    }

    fun setThemeMode(mode: GardenThemeMode) {
        plainPrefs.edit().putString(KEY_THEME, mode.key).apply()
        _settings.value = readSnapshot()
    }

    fun setUserAvatar(avatar: String) {
        plainPrefs.edit().putString(KEY_USER_AVATAR, avatar.trim().take(8)).apply()
        _settings.value = readSnapshot()
    }

    companion object {
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_DEFAULT_MODEL = "default_model"
        private const val KEY_THEME = "garden_theme"
        private const val KEY_USER_AVATAR = "user_avatar"
        private const val KEY_API_KEY = "model_api_key"
    }
}
