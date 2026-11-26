package com.qiyi.companion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.qiyi.companion.data.media.MusicPlaybackState
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.screens.ChatScreen
import com.qiyi.companion.ui.screens.LibraryScreen
import com.qiyi.companion.ui.screens.MailDraftSheet
import com.qiyi.companion.ui.screens.MusicAndStickerSheet
import com.qiyi.companion.ui.screens.PersonasScreen
import com.qiyi.companion.ui.screens.SettingsScreen
import com.qiyi.companion.ui.screens.TasksScreen
import com.qiyi.companion.ui.screens.UsageSheet
import com.qiyi.companion.ui.theme.LocalGardenColors
import com.qiyi.companion.ui.theme.QiYiGardenTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as QiYiApplication
        setContent {
            val viewModel: QiYiViewModel = viewModel(
                factory = QiYiViewModel.factory(app.repository, app.musicPlayer)
            )
            QiYiAppRoot(viewModel = viewModel)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QiYiAppRoot(viewModel: QiYiViewModel) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val musicState by viewModel.musicState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var showMusicSheet by remember { mutableStateOf(false) }
    var showUsageSheet by remember { mutableStateOf(false) }
    var showMailSheet by remember { mutableStateOf(false) }
    var mailInitialBody by remember { mutableStateOf("") }
    var mailInitialSubject by remember { mutableStateOf("") }

    val tabs = remember { listOf("对话", "人设", "书阁", "任务", "设置") }

    LaunchedEffect(Unit) {
        viewModel.notices.collect { msg ->
            snackbarHostState.showSnackbar(msg)
        }
    }

    QiYiGardenTheme(themeMode = settings.themeMode) {
        val garden = LocalGardenColors.current
        Scaffold(
            modifier = Modifier
                .fillMaxSize()
                .navigationBarsPadding(),
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(snackbarHostState) },
            topBar = {
                GardenTopNavBar(
                    tabs = tabs,
                    selectedTab = selectedTab,
                    onSelectTab = { selectedTab = it },
                    musicState = musicState,
                    onToggleMusic = { viewModel.togglePlayPause() },
                    onOpenMusicSheet = { showMusicSheet = true },
                    onOpenUsage = { showUsageSheet = true },
                    onOpenMail = {
                        mailInitialSubject = ""
                        mailInitialBody = ""
                        showMailSheet = true
                    }
                )
            }
        ) { innerPadding ->
            when (selectedTab) {
                0 -> ChatScreen(
                    viewModel = viewModel,
                    onWriteAsMail = { subject, body ->
                        mailInitialSubject = subject
                        mailInitialBody = body
                        showMailSheet = true
                    },
                    modifier = Modifier.padding(innerPadding)
                )
                1 -> PersonasScreen(
                    viewModel = viewModel,
                    onOpenChat = { selectedTab = 0 },
                    modifier = Modifier.padding(innerPadding)
                )
                2 -> LibraryScreen(
                    viewModel = viewModel,
                    modifier = Modifier.padding(innerPadding)
                )
                3 -> TasksScreen(
                    viewModel = viewModel,
                    modifier = Modifier.padding(innerPadding)
                )
                else -> SettingsScreen(
                    viewModel = viewModel,
                    modifier = Modifier.padding(innerPadding)
                )
            }
        }

        if (showMusicSheet) {
            ModalBottomSheet(
                onDismissRequest = { showMusicSheet = false },
                containerColor = garden.paperCard
            ) {
                MusicAndStickerSheet(viewModel = viewModel)
            }
        }

        if (showUsageSheet) {
            ModalBottomSheet(
                onDismissRequest = { showUsageSheet = false },
                containerColor = garden.paperCard
            ) {
                UsageSheet(viewModel = viewModel)
            }
        }

        if (showMailSheet) {
            ModalBottomSheet(
                onDismissRequest = { showMailSheet = false },
                containerColor = garden.paperCard
            ) {
                MailDraftSheet(
                    viewModel = viewModel,
                    initialBody = mailInitialBody,
                    initialSubject = mailInitialSubject
                )
            }
        }
    }
}

/**
 * Top classical garden brand plaque + window tab bar + cinnabar lacquer divider
 * + mobile-web-aligned utility strip (status/music ticker + Usage / Mail / Music icons, no pet).
 */
@Composable
private fun GardenTopNavBar(
    tabs: List<String>,
    selectedTab: Int,
    onSelectTab: (Int) -> Unit,
    musicState: MusicPlaybackState,
    onToggleMusic: () -> Unit,
    onOpenMusicSheet: () -> Unit,
    onOpenUsage: () -> Unit,
    onOpenMail: () -> Unit
) {
    val garden = LocalGardenColors.current
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(garden.paper)
            .statusBarsPadding()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp)
        ) {
            // 栖忆 Brand Plaque
            Surface(
                shape = RoundedCornerShape(6.dp),
                color = garden.paperCard,
                border = BorderStroke(1.2.dp, garden.gold)
            ) {
                Box(
                    modifier = Modifier
                        .padding(2.dp)
                        .border(0.6.dp, garden.line, RoundedCornerShape(4.dp))
                        .padding(horizontal = 9.dp, vertical = 6.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "栖忆",
                        fontFamily = FontFamily.Serif,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        letterSpacing = 1.sp,
                        color = garden.ink
                    )
                }
            }

            // Classical Window Tabs
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                tabs.forEachIndexed { index, label ->
                    val selected = selectedTab == index
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .height(38.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { onSelectTab(index) },
                        shape = RoundedCornerShape(6.dp),
                        color = if (selected) garden.bamboo else garden.paperCard,
                        border = BorderStroke(
                            width = 1.dp,
                            color = if (selected) garden.gold.copy(alpha = 0.85f) else garden.line
                        )
                    ) {
                        Box(
                            modifier = Modifier
                                .padding(2.dp)
                                .border(
                                    width = 0.6.dp,
                                    color = if (selected) garden.gold.copy(alpha = 0.45f) else garden.lineSoft,
                                    shape = RoundedCornerShape(4.dp)
                                ),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = label,
                                fontFamily = FontFamily.Serif,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                                fontSize = 13.sp,
                                color = if (selected) garden.paperCard else garden.ink
                            )
                        }
                    }
                }
            }
        }

        // Signature Cinnabar Lacquer Accent Bar (朱漆横梁)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(2.5.dp)
                .background(garden.cinnabar)
        )

        // Mobile-Web-Aligned Utility Strip (工作台 / 当前页 + 音乐条 + 用量 / 邮件 / 音乐)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(garden.paperCard)
                .padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = "工作台 / ${tabs.getOrElse(selectedTab) { "对话" }}",
                    style = MaterialTheme.typography.labelSmall,
                    color = garden.muted
                )
                if (musicState.currentTrack != null) {
                    Surface(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .clickable(onClick = onOpenMusicSheet),
                        shape = RoundedCornerShape(999.dp),
                        color = garden.bambooSoft,
                        border = BorderStroke(0.7.dp, garden.lineStrong)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = if (musicState.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                                contentDescription = "播放暂停",
                                tint = garden.cinnabar,
                                modifier = Modifier
                                    .size(14.dp)
                                    .clickable(onClick = onToggleMusic)
                            )
                            Spacer(Modifier.width(3.dp))
                            Text(
                                text = musicState.currentTrack.title,
                                style = MaterialTheme.typography.labelSmall,
                                color = garden.ink,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(garden.bamboo)
                    )
                    Text(
                        text = "本地离线就绪",
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.muted
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                UtilityIconButton(Icons.Default.BarChart, "用量", onOpenUsage)
                UtilityIconButton(Icons.Default.MailOutline, "邮件", onOpenMail)
                UtilityIconButton(
                    icon = Icons.Default.MusicNote,
                    contentDescription = "音乐",
                    active = musicState.isPlaying,
                    onClick = onOpenMusicSheet
                )
            }
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(0.8.dp)
                .background(garden.lineSoft)
        )
    }
}

@Composable
private fun UtilityIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    active: Boolean = false
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = Modifier
            .size(30.dp)
            .clip(RoundedCornerShape(6.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(6.dp),
        color = if (active) garden.cinnabarSoft else garden.paper,
        border = BorderStroke(0.8.dp, if (active) garden.cinnabar else garden.line)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = if (active) garden.cinnabar else garden.ink,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}
