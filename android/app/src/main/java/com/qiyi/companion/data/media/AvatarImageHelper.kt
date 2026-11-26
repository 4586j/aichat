package com.qiyi.companion.data.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID

/**
 * Center-crops uploaded avatar images to a crisp 256x256 square JPEG in `filesDir/avatars/`
 * and decodes either local file paths or PC-exported `data:image/...` Base64 URIs.
 */
object AvatarImageHelper {

    fun isImageAvatar(value: String?): Boolean {
        val v = value?.trim().orEmpty()
        return v.startsWith("data:image/") || v.startsWith("/") || v.startsWith("file://")
    }

    fun saveSquareAvatar(context: Context, sourceUri: Uri, prefix: String = "avatar"): String {
        val raw = context.contentResolver.openInputStream(sourceUri)?.use { BitmapFactory.decodeStream(it) }
            ?: throw IllegalStateException("无法读取所选头像图片。")

        val side = minOf(raw.width, raw.height).coerceAtLeast(1)
        val x = (raw.width - side) / 2
        val y = (raw.height - side) / 2
        val square = Bitmap.createBitmap(raw, x, y, side, side)
        val scaled = if (side > 256) Bitmap.createScaledBitmap(square, 256, 256, true) else square

        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 86, out)

        val dir = File(context.filesDir, "avatars").apply { mkdirs() }
        val file = File(dir, "${prefix}_${UUID.randomUUID()}.jpg")
        file.writeBytes(out.toByteArray())
        return file.absolutePath
    }

    fun decodeAvatarBitmap(avatarValue: String?): ImageBitmap? {
        val v = avatarValue?.trim().orEmpty()
        if (v.isEmpty()) return null
        return runCatching {
            when {
                v.startsWith("data:image/") -> {
                    val comma = v.indexOf(',')
                    if (comma <= 0) return null
                    val bytes = Base64.decode(v.substring(comma + 1), Base64.DEFAULT)
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                }
                v.startsWith("file://") -> {
                    val path = v.removePrefix("file://")
                    if (File(path).exists()) BitmapFactory.decodeFile(path)?.asImageBitmap() else null
                }
                v.startsWith("/") -> {
                    if (File(v).exists()) BitmapFactory.decodeFile(v)?.asImageBitmap() else null
                }
                else -> null
            }
        }.getOrNull()
    }
}
