package com.qiyi.companion.data.knowledge

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URI
import java.util.concurrent.TimeUnit

data class ClippedWebPage(
    val url: String,
    val title: String,
    val content: String
)

/**
 * Pure-Kotlin offline-friendly Web Clipper matching PC `lib/web-clipper.mjs`.
 * Fetches a web page URL and extracts clean readable Markdown/text paragraphs.
 */
class WebClipper(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()
) {
    suspend fun clipUrl(rawUrl: String): ClippedWebPage = withContext(Dispatchers.IO) {
        val cleanUrl = rawUrl.trim()
        val uri = runCatching { URI(cleanUrl) }.getOrNull()
            ?: throw IllegalArgumentException("网址格式无效，请以 http:// 或 https:// 开头。")
        val scheme = uri.scheme?.lowercase()
        require(scheme == "http" || scheme == "https") { "仅支持 http:// 或 https:// 网页剪藏。" }
        require(!uri.host.isNullOrBlank()) { "网址缺少有效主机名。" }

        val req = Request.Builder()
            .url(cleanUrl)
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 QiYiWebClipper/1.0")
            .header("Accept", "text/html, text/plain, application/xhtml+xml")
            .get()
            .build()

        httpClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw IllegalStateException("抓取网页失败（HTTP ${resp.code}）。")
            }
            val rawBody = resp.body?.string().orEmpty().take(500_000)
            extractReadableContent(cleanUrl, rawBody)
        }
    }

    companion object {
        private val TITLE_REGEX = Regex("""<title[^>]*>([\s\S]*?)</title>""", RegexOption.IGNORE_CASE)
        private val STRIP_BLOCKS_REGEX = Regex(
            """<(script|style|noscript|svg|nav|footer|header|aside|iframe)[^>]*>[\s\S]*?</\1>""",
            RegexOption.IGNORE_CASE
        )
        private val BLOCK_BREAK_REGEX = Regex(
            """</?(p|div|br|li|h[1-6]|tr|section|article|blockquote|pre)[^>]*>""",
            RegexOption.IGNORE_CASE
        )
        private val TAG_REGEX = Regex("""<[^>]+>""")

        fun extractReadableContent(url: String, html: String): ClippedWebPage {
            val rawTitle = TITLE_REGEX.find(html)?.groupValues?.getOrNull(1)?.let { decodeEntities(it).trim() }.orEmpty()
            val title = rawTitle.ifBlank {
                runCatching { URI(url).host.orEmpty() }.getOrDefault("网页剪藏")
            }.take(120)

            val withoutNoise = STRIP_BLOCKS_REGEX.replace(html, "\n")
            val withBreaks = BLOCK_BREAK_REGEX.replace(withoutNoise, "\n")
            val stripped = TAG_REGEX.replace(withBreaks, " ")
            val decoded = decodeEntities(stripped)

            val paragraphs = decoded
                .replace("\r\n", "\n")
                .split("\n")
                .map { it.replace(Regex("[ \\t\\x0B\\f]+"), " ").trim() }
                .filter { it.length >= 2 }
                .distinct()

            val body = buildString {
                append("来源链接：").append(url).append("\n\n")
                append(paragraphs.joinToString("\n\n"))
            }.take(60_000)

            require(paragraphs.isNotEmpty()) { "未能从该网页提取到有效正文。" }
            return ClippedWebPage(url = url, title = title, content = body)
        }

        private fun decodeEntities(text: String): String = text
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'")
    }
}
