package com.qiyi.companion

import com.qiyi.companion.data.db.MusicTrackEntity
import com.qiyi.companion.data.media.MusicIntentDetector
import com.qiyi.companion.data.media.StickerCatalog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class MediaFeaturesTest {

    @Test
    fun extractsChineseAndEnglishMusicRequests() {
        assertEquals("稻香", MusicIntentDetector.extractSongQuery("帮我放一首《稻香》吧"))
        assertEquals("夜曲", MusicIntentDetector.extractSongQuery("来一首夜曲"))
        assertEquals("River Flows In You", MusicIntentDetector.extractSongQuery("play song River Flows In You"))
        assertNull(MusicIntentDetector.extractSongQuery("帮我解释一下 Kotlin 协程原理"))
    }

    @Test
    fun matchesLocalTracksByTitleOrArtist() {
        val tracks = listOf(
            MusicTrackEntity(id = "1", title = "青花瓷", artist = "周杰伦"),
            MusicTrackEntity(id = "2", title = "高山流水", artist = "古琴")
        )
        val matched = MusicIntentDetector.matchLocalTracks("青花瓷", tracks)
        assertEquals(1, matched.size)
        assertEquals("1", matched.first().id)
    }

    @Test
    fun matchesAppropriateBuiltinStickerFromMoodKeywords() {
        val hug = StickerCatalog.matchSticker("今天好累好辛苦", "抱抱你，先别担心")
        assertNotNull(hug)
        assertEquals("leaf-hug", hug?.id)

        val cheer = StickerCatalog.matchSticker("终于搞定了！", "太棒了，好耶！")
        assertNotNull(cheer)
        assertEquals("leaf-cheer", cheer?.id)
    }
}
