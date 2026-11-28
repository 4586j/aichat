package com.qiyi.companion.data.agent

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.provider.AlarmClock
import android.provider.CalendarContract
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Pure Android Intent & system-service engine for safe everyday phone actions:
 * - Device status (battery, network, ringer)
 * - Alarm & countdown timer (AlarmClock Intent, user sees confirmation UI)
 * - Calendar event prefill (CalendarContract ACTION_INSERT, zero calendar read permission needed)
 * - Message draft prefill (SMS ACTION_SENDTO or Android Share sheet — never auto-sends!)
 */
class SystemActionEngine(private val appContext: Context) {

    fun getDeviceStatus(): String {
        val bm = appContext.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val batteryPct = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
        val isCharging = bm?.isCharging == true

        val cm = appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val netCaps = cm?.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        val networkDesc = when {
            netCaps == null -> "未连接网络"
            netCaps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi 已连接"
            netCaps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "移动蜂窝网络"
            netCaps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "有线网络"
            else -> "已联网"
        }

        val am = appContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val ringerDesc = when (am?.ringerMode) {
            AudioManager.RINGER_MODE_SILENT -> "静音"
            AudioManager.RINGER_MODE_VIBRATE -> "震动"
            else -> "响铃"
        }

        return buildString {
            append("当前手机状态：")
            if (batteryPct in 0..100) {
                append("电量 $batteryPct%（${if (isCharging) "充电中" else "未充电"}），")
            }
            append("网络：$networkDesc，")
            append("铃声模式：$ringerDesc。")
        }
    }

    fun setAlarmOrTimer(
        mode: String,
        hour: Int?,
        minute: Int?,
        seconds: Int?,
        label: String
    ): String {
        val cleanMode = mode.trim().lowercase().ifEmpty { "alarm" }
        val cleanLabel = label.trim().ifEmpty { "栖忆提醒" }

        return when (cleanMode) {
            "timer" -> {
                val secs = (seconds ?: 60).coerceIn(1, 24 * 3600)
                val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
                    putExtra(AlarmClock.EXTRA_LENGTH, secs)
                    putExtra(AlarmClock.EXTRA_MESSAGE, cleanLabel)
                    putExtra(AlarmClock.EXTRA_SKIP_UI, false)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                appContext.startActivity(intent)
                "已为你拉起系统计时器：${secs} 秒（标签：$cleanLabel）。"
            }
            "alarm" -> {
                val h = (hour ?: throw IllegalArgumentException("设置闹钟需要提供 hour（0～23）。")).coerceIn(0, 23)
                val m = (minute ?: 0).coerceIn(0, 59)
                val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
                    putExtra(AlarmClock.EXTRA_HOUR, h)
                    putExtra(AlarmClock.EXTRA_MINUTES, m)
                    putExtra(AlarmClock.EXTRA_MESSAGE, cleanLabel)
                    putExtra(AlarmClock.EXTRA_SKIP_UI, false)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                appContext.startActivity(intent)
                val timeStr = String.format("%02d:%02d", h, m)
                "已为你拉起系统闹钟确认页：$timeStr（标签：$cleanLabel）。"
            }
            else -> throw IllegalArgumentException("mode 仅支持 alarm 或 timer。")
        }
    }

    fun createCalendarEvent(
        title: String,
        startIso: String,
        endIso: String = "",
        location: String = "",
        description: String = ""
    ): String {
        val cleanTitle = title.trim().ifEmpty { throw IllegalArgumentException("日程标题不能为空。") }
        val startMs = parseIsoToEpochMs(startIso)
        val endMs = if (endIso.isNotBlank()) {
            parseIsoToEpochMs(endIso).coerceAtLeast(startMs + 15 * 60_000L)
        } else {
            startMs + 60 * 60_000L
        }

        val intent = Intent(Intent.ACTION_INSERT).apply {
            data = CalendarContract.Events.CONTENT_URI
            putExtra(CalendarContract.Events.TITLE, cleanTitle)
            putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, startMs)
            putExtra(CalendarContract.EXTRA_EVENT_END_TIME, endMs)
            if (location.isNotBlank()) putExtra(CalendarContract.Events.EVENT_LOCATION, location.trim())
            if (description.isNotBlank()) putExtra(CalendarContract.Events.DESCRIPTION, description.trim())
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        appContext.startActivity(intent)
        return "已为你预填系统日历日程「$cleanTitle」（$startIso），请在系统日历界面确认保存。"
    }

    fun prepareMessageDraft(
        channel: String,
        recipient: String,
        text: String
    ): String {
        val cleanText = text.trim()
        require(cleanText.isNotEmpty()) { "消息草稿内容不能为空。" }
        val cleanChannel = channel.trim().lowercase().ifEmpty { "share" }

        return when (cleanChannel) {
            "sms" -> {
                val uri = Uri.parse("smsto:${Uri.encode(recipient.trim())}")
                val intent = Intent(Intent.ACTION_SENDTO, uri).apply {
                    putExtra("sms_body", cleanText)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                appContext.startActivity(intent)
                "已为你打开短信草稿页并填入内容（收件人：${recipient.ifBlank { "待选" }}），请核对后手动点击发送。"
            }
            "share" -> {
                val sendIntent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, cleanText)
                }
                val chooser = Intent.createChooser(sendIntent, "选择应用发送消息草稿").apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                appContext.startActivity(chooser)
                "已为你拉起系统分享面板并填入草稿（可选择微信/QQ/短信好友），请亲自确认发送。"
            }
            else -> throw IllegalArgumentException("channel 仅支持 sms 或 share。")
        }
    }

    companion object {
        fun parseIsoToEpochMs(raw: String): Long {
            val clean = raw.trim().replace(' ', 'T')
            require(clean.isNotEmpty()) { "开始时间不能为空（格式如 2026-11-29T09:00）。" }
            runCatching { return Instant.parse(clean).toEpochMilli() }
            val normalized = when {
                clean.length == 10 -> "${clean}T09:00:00"
                clean.length == 16 -> "$clean:00"
                else -> clean
            }
            val ldt = LocalDateTime.parse(normalized, DateTimeFormatter.ISO_LOCAL_DATE_TIME)
            return ldt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        }
    }
}
