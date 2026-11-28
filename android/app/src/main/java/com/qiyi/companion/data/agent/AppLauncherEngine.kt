package com.qiyi.companion.data.agent

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

data class InstalledAppInfo(
    val appName: String,
    val packageName: String
)

/**
 * Queries launcher-visible installed apps (via compliant <queries> declaration)
 * with Chinese colloquial alias matching, and launches target apps cleanly.
 */
class AppLauncherEngine(private val appContext: Context) {

    fun listLaunchableApps(query: String = "", limit: Int = 15): List<InstalledAppInfo> {
        val pm = appContext.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0L))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, 0)
        }

        val allApps = resolved.mapNotNull { info ->
            val pkg = info.activityInfo?.packageName ?: return@mapNotNull null
            if (pkg == appContext.packageName) return@mapNotNull null
            val label = info.loadLabel(pm)?.toString()?.trim().orEmpty().ifEmpty { pkg }
            InstalledAppInfo(appName = label, packageName = pkg)
        }.distinctBy { it.packageName }

        return rankMatchingApps(query, allApps, limit)
    }

    fun openApp(queryOrPackage: String): String {
        val clean = queryOrPackage.trim()
        require(clean.isNotEmpty()) { "请提供要打开的应用名称或包名。" }

        val pm = appContext.packageManager
        // 1. Direct package name hit
        val directIntent = pm.getLaunchIntentForPackage(clean)
        if (directIntent != null) {
            directIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            appContext.startActivity(directIntent)
            val label = runCatching {
                val appInfo = pm.getApplicationInfo(clean, 0)
                pm.getApplicationLabel(appInfo).toString()
            }.getOrDefault(clean)
            return "已为你打开应用「$label」（$clean）。"
        }

        // 2. Fuzzy & alias match
        val matches = listLaunchableApps(clean, limit = 5)
        if (matches.isEmpty()) {
            throw IllegalArgumentException("未在本机找到匹配「$clean」的可启动应用，可先调用 device_list_apps 查看已安装列表。")
        }

        val best = matches.first()
        val launchIntent = pm.getLaunchIntentForPackage(best.packageName)
            ?: throw IllegalStateException("应用「${best.appName}」没有可启动入口。")
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        appContext.startActivity(launchIntent)
        return "已为你打开应用「${best.appName}」（${best.packageName}）。"
    }

    companion object {
        private val CHINESE_ALIASES: Map<String, List<String>> = mapOf(
            "微信" to listOf("com.tencent.mm", "wechat"),
            "wechat" to listOf("com.tencent.mm"),
            "qq" to listOf("com.tencent.mobileqq"),
            "b站" to listOf("tv.danmaku.bili", "bilibili", "哔哩哔哩"),
            "哔哩哔哩" to listOf("tv.danmaku.bili", "bilibili"),
            "高德" to listOf("com.autonavi.minimap", "高德地图"),
            "高德地图" to listOf("com.autonavi.minimap"),
            "百度地图" to listOf("com.baidu.BaiduMap"),
            "网易云" to listOf("com.netease.cloudmusic", "网易云音乐"),
            "网易云音乐" to listOf("com.netease.cloudmusic"),
            "qq音乐" to listOf("com.tencent.qqmusic"),
            "抖音" to listOf("com.ss.android.ugc.aweme", "douyin"),
            "小红书" to listOf("com.xingin.xhs"),
            "知乎" to listOf("com.zhihu.android"),
            "淘宝" to listOf("com.taobao.taobao"),
            "京东" to listOf("com.jingdong.app.mall"),
            "美团" to listOf("com.sankuai.meituan"),
            "飞书" to listOf("com.ss.android.lark"),
            "钉钉" to listOf("com.alibaba.android.rimet"),
            "微博" to listOf("com.sina.weibo"),
            "支付宝" to listOf("com.eg.android.AlipayGphone"),
            "设置" to listOf("com.android.settings", "settings"),
            "日历" to listOf("calendar", "日历"),
            "时钟" to listOf("deskclock", "clock", "时钟"),
            "闹钟" to listOf("deskclock", "clock", "时钟"),
            "相机" to listOf("camera", "相机"),
            "浏览器" to listOf("chrome", "browser", "edge", "firefox", "浏览器")
        )

        fun rankMatchingApps(
            query: String,
            installed: List<InstalledAppInfo>,
            limit: Int = 15
        ): List<InstalledAppInfo> {
            val needle = query.trim().lowercase()
            if (needle.isEmpty()) {
                return installed.sortedBy { it.appName.lowercase() }.take(limit)
            }
            val aliasTargets = CHINESE_ALIASES[needle].orEmpty().map { it.lowercase() }

            val scored = installed.mapNotNull { app ->
                val nameLow = app.appName.lowercase()
                val pkgLow = app.packageName.lowercase()
                val score = when {
                    pkgLow == needle || nameLow == needle -> 100
                    aliasTargets.any { it == pkgLow || it == nameLow } -> 95
                    nameLow.startsWith(needle) -> 85
                    aliasTargets.any { pkgLow.contains(it) || nameLow.contains(it) } -> 75
                    nameLow.contains(needle) -> 65
                    pkgLow.contains(needle) -> 50
                    else -> 0
                }
                if (score > 0) app to score else null
            }

            return scored
                .sortedWith(compareByDescending<Pair<InstalledAppInfo, Int>> { it.second }.thenBy { it.first.appName.length })
                .map { it.first }
                .take(limit)
        }
    }
}
