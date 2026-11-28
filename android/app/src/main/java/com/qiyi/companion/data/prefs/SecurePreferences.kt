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
    val embeddingModel: String = "",
    val hasApiKey: Boolean = false,
    val themeMode: GardenThemeMode = GardenThemeMode.SPRING,
    val userAvatar: String = "",
    val musicEnabled: Boolean = true,
    val stickerEnabled: Boolean = true,
    val toolsEnabled: Boolean = true,
    val musicBaseUrl: String = "",
    val musicSource: String = "local", // "local" | "qq" | "netease"
    val hasMusicApiKey: Boolean = false,
    val customInputPricePer1M: Double = 0.0,
    val customOutputPricePer1M: Double = 0.0,
    val contextWindowOverride: Int = 0,
    val deviceAgentEnabled: Boolean = false,
    val deviceSecurityMode: String = "standard", // "standard" | "strict"
    val allowDirectAppLaunch: Boolean = true,
    val floatingOrbEnabled: Boolean = false
)

/**
 * Persists non-secret UI/model settings in standard SharedPreferences,
 * and stores all API keys exclusively inside Android Keystore-backed EncryptedSharedPreferences.
 * API keys are NEVER written into Room SQLite or backups.
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
        embeddingModel = plainPrefs.getString(KEY_EMBEDDING_MODEL, "") ?: "",
        hasApiKey = getApiKey().isNotBlank(),
        themeMode = GardenThemeMode.fromKey(plainPrefs.getString(KEY_THEME, GardenThemeMode.SPRING.key)),
        userAvatar = plainPrefs.getString(KEY_USER_AVATAR, "") ?: "",
        musicEnabled = plainPrefs.getBoolean(KEY_MUSIC_ENABLED, true),
        stickerEnabled = plainPrefs.getBoolean(KEY_STICKER_ENABLED, true),
        toolsEnabled = plainPrefs.getBoolean(KEY_TOOLS_ENABLED, true),
        musicBaseUrl = plainPrefs.getString(KEY_MUSIC_BASE_URL, "") ?: "",
        musicSource = plainPrefs.getString(KEY_MUSIC_SOURCE, "local") ?: "local",
        hasMusicApiKey = getMusicApiKey().isNotBlank(),
        customInputPricePer1M = plainPrefs.getFloat(KEY_INPUT_PRICE, 0f).toDouble(),
        customOutputPricePer1M = plainPrefs.getFloat(KEY_OUTPUT_PRICE, 0f).toDouble(),
        contextWindowOverride = plainPrefs.getInt(KEY_CONTEXT_WINDOW_OVERRIDE, 0),
        deviceAgentEnabled = plainPrefs.getBoolean(KEY_DEVICE_AGENT_ENABLED, false),
        deviceSecurityMode = plainPrefs.getString(KEY_DEVICE_SECURITY_MODE, "standard") ?: "standard",
        allowDirectAppLaunch = plainPrefs.getBoolean(KEY_ALLOW_DIRECT_APP_LAUNCH, true),
        floatingOrbEnabled = plainPrefs.getBoolean(KEY_FLOATING_ORB_ENABLED, false)
    )

    fun getApiKey(): String = secretPrefs.getString(KEY_API_KEY, "") ?: ""

    fun getMusicApiKey(): String = secretPrefs.getString(KEY_MUSIC_API_KEY, "") ?: ""

    fun saveModelSettings(
        baseUrl: String,
        defaultModel: String,
        newApiKey: String?,
        clearApiKey: Boolean,
        embeddingModel: String? = null
    ) {
        val editor = plainPrefs.edit()
            .putString(KEY_BASE_URL, baseUrl.trim().trimEnd('/'))
            .putString(KEY_DEFAULT_MODEL, defaultModel.trim())
        if (embeddingModel != null) {
            editor.putString(KEY_EMBEDDING_MODEL, embeddingModel.trim())
        }
        editor.apply()

        if (clearApiKey) {
            secretPrefs.edit().remove(KEY_API_KEY).apply()
        } else if (!newApiKey.isNullOrBlank()) {
            secretPrefs.edit().putString(KEY_API_KEY, newApiKey.trim()).apply()
        }
        _settings.value = readSnapshot()
    }

    fun saveMusicServiceSettings(
        baseUrl: String,
        source: String,
        newApiKey: String?,
        clearApiKey: Boolean
    ) {
        plainPrefs.edit()
            .putString(KEY_MUSIC_BASE_URL, baseUrl.trim().trimEnd('/'))
            .putString(KEY_MUSIC_SOURCE, source.trim().ifEmpty { "local" })
            .apply()
        if (clearApiKey) {
            secretPrefs.edit().remove(KEY_MUSIC_API_KEY).apply()
        } else if (!newApiKey.isNullOrBlank()) {
            secretPrefs.edit().putString(KEY_MUSIC_API_KEY, newApiKey.trim()).apply()
        }
        _settings.value = readSnapshot()
    }

    fun setLinkageFlags(
        musicEnabled: Boolean? = null,
        stickerEnabled: Boolean? = null,
        toolsEnabled: Boolean? = null
    ) {
        val editor = plainPrefs.edit()
        if (musicEnabled != null) editor.putBoolean(KEY_MUSIC_ENABLED, musicEnabled)
        if (stickerEnabled != null) editor.putBoolean(KEY_STICKER_ENABLED, stickerEnabled)
        if (toolsEnabled != null) editor.putBoolean(KEY_TOOLS_ENABLED, toolsEnabled)
        editor.apply()
        _settings.value = readSnapshot()
    }

    fun setThemeMode(mode: GardenThemeMode) {
        plainPrefs.edit().putString(KEY_THEME, mode.key).apply()
        _settings.value = readSnapshot()
    }

    fun setUserAvatar(avatar: String) {
        plainPrefs.edit().putString(KEY_USER_AVATAR, avatar.trim().take(512)).apply()
        _settings.value = readSnapshot()
    }

    fun setCustomPricing(inputPer1M: Double, outputPer1M: Double) {
        plainPrefs.edit()
            .putFloat(KEY_INPUT_PRICE, inputPer1M.coerceAtLeast(0.0).toFloat())
            .putFloat(KEY_OUTPUT_PRICE, outputPer1M.coerceAtLeast(0.0).toFloat())
            .apply()
        _settings.value = readSnapshot()
    }

    fun setContextWindowOverride(tokens: Int) {
        plainPrefs.edit()
            .putInt(KEY_CONTEXT_WINDOW_OVERRIDE, tokens.coerceAtLeast(0))
            .apply()
        _settings.value = readSnapshot()
    }

    fun setDeviceAgentSettings(
        enabled: Boolean? = null,
        securityMode: String? = null,
        allowDirectAppLaunch: Boolean? = null,
        floatingOrbEnabled: Boolean? = null
    ) {
        val editor = plainPrefs.edit()
        if (enabled != null) editor.putBoolean(KEY_DEVICE_AGENT_ENABLED, enabled)
        if (securityMode != null) {
            val clean = if (securityMode == "strict") "strict" else "standard"
            editor.putString(KEY_DEVICE_SECURITY_MODE, clean)
        }
        if (allowDirectAppLaunch != null) editor.putBoolean(KEY_ALLOW_DIRECT_APP_LAUNCH, allowDirectAppLaunch)
        if (floatingOrbEnabled != null) editor.putBoolean(KEY_FLOATING_ORB_ENABLED, floatingOrbEnabled)
        editor.apply()
        _settings.value = readSnapshot()
    }

    companion object {
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_DEFAULT_MODEL = "default_model"
        private const val KEY_EMBEDDING_MODEL = "embedding_model"
        private const val KEY_THEME = "garden_theme"
        private const val KEY_USER_AVATAR = "user_avatar"
        private const val KEY_API_KEY = "model_api_key"
        private const val KEY_MUSIC_ENABLED = "music_enabled"
        private const val KEY_STICKER_ENABLED = "sticker_enabled"
        private const val KEY_TOOLS_ENABLED = "tools_enabled"
        private const val KEY_MUSIC_BASE_URL = "music_base_url"
        private const val KEY_MUSIC_SOURCE = "music_source"
        private const val KEY_MUSIC_API_KEY = "music_api_key"
        private const val KEY_INPUT_PRICE = "usage_input_price_1m"
        private const val KEY_OUTPUT_PRICE = "usage_output_price_1m"
        private const val KEY_CONTEXT_WINDOW_OVERRIDE = "context_window_override"
        private const val KEY_DEVICE_AGENT_ENABLED = "device_agent_enabled"
        private const val KEY_DEVICE_SECURITY_MODE = "device_security_mode"
        private const val KEY_ALLOW_DIRECT_APP_LAUNCH = "allow_direct_app_launch"
        private const val KEY_FLOATING_ORB_ENABLED = "floating_orb_enabled"
    }
}
