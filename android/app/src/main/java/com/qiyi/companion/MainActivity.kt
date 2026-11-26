package com.qiyi.companion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.filled.AddComment
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.MailOutline
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
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
import com.qiyi.companion.ui.screens.CreateGroupChatDialog
import com.qiyi.companion.ui.screens.HistoryDrawerContent
import com.qiyi.companion.ui.screens.LibraryScreen
import com.qiyi.companion.ui.screens.MailDraftSheet
import com.qiyi.companion.ui.screens.MusicAndStickerSheet
import com.qiyi.companion.ui.screens.PersonasScreen
import com.qiyi.companion.ui.screens.SettingsScreen
import com.qiyi.companion.ui.screens.TasksScreen
import com.qiyi.companion.ui.screens.UsageSheet
import com.qiyi.companion.ui.theme.LocalGardenColors
import com.qiyi.companion.ui.theme.QiYiGardenTheme
import kotlinx.coroutines.launch

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
    val context = LocalContext.current
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val personas by viewModel.personas.collectAsStateWithLifecycle()
    val musicState by viewModel.musicState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val coroutineScope = rememberCoroutineScope()

    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var showMusicSheet by remember { mutableStateOf(false) }
    var showUsageSheet by remember { mutableStateOf(false) }
    var showMailSheet by remember { mutableStateOf(false) }
    var showGroupDialog by remember { mutableStateOf(false) }
    var mailInitialBody by remember { mutableStateOf("") }
    var mailInitialSubject by remember { mutableStateOf("") }
    var pendingExportMd by remember { mutableStateOf<String?>(null) }

    val exportMdLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("text/markdown")
    ) { uri ->
        val md = pendingExportMd
        pendingExportMd = null
        if (uri == null || md == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.bufferedWriter(Charsets.UTF_8)?.use { it.write(md) }
                ?: throw IllegalStateException("无法写入 Markdown 文件。")
        }.onSuccess {
            viewModel.notify("对话已导出为 Markdown 文件。")
        }.onFailure {
            viewModel.notify(it.message ?: "导出对话失败。")
        }
    }

    val tabs = remember { listOf("对话", "人设", "书阁", "任务", "设置") }

    LaunchedEffect(Unit) {
        viewModel.notices.collect { msg ->
            snackbarHostState.showSnackbar(msg)
        }
    }

    QiYiGardenTheme(themeMode = settings.themeMode) {
        val garden = LocalGardenColors.current

        ModalNavigationDrawer(
            drawerState = drawerState,
            drawerContent = {
                ModalDrawerSheet(
                    drawerContainerColor = garden.paperCard,
                    drawerContentColor = garden.text,
                    modifier = Modifier.width(304.dp)
                ) {
                    HistoryDrawerContent(
                        viewModel = viewModel,
                        onSelectConversationDone = {
                            selectedTab = 0
                            coroutineScope.launch { drawerState.close() }
                        },
                        onCreateGroupChat = {
                            selectedTab = 0
                            showGroupDialog = true
                        },
                        onCloseDrawer = {
                            coroutineScope.launch { drawerState.close() }
                        }
                    )
                }
            }
        ) {
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
                        onOpenHistoryDrawer = { coroutineScope.launch { drawerState.open() } },
                        musicState = musicState,
                        onToggleMusic = { viewModel.togglePlayPause() },
                        onOpenMusicSheet = { showMusicSheet = true },
                        onOpenUsage = { showUsageSheet = true },
                        onOpenMail = {
                            mailInitialSubject = ""
                            mailInitialBody = ""
                            showMailSheet = true
                        },
                        onExportChat = {
                            viewModel.exportActiveConversationMarkdown { fileName, md ->
                                pendingExportMd = md
                                exportMdLauncher.launch(fileName)
                            }
                        },
                        onNewChat = {
                            selectedTab = 0
                            viewModel.startNewConversation()
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
                        onOpenGroupDialog = { showGroupDialog = true },
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

        if (showGroupDialog) {
            CreateGroupChatDialog(
                personas = personas,
                onDismiss = { showGroupDialog = false },
                onCreate = { selectedIds, title ->
                    showGroupDialog = false
                    selectedTab = 0
                    viewModel.createGroupConversation(selectedIds, title)
                }
            )
        }
    }
}

/**
 * Top classical garden header:
 * - Left: clickable 「历史」/「栖忆」 plaque that opens the left slide-out folder history drawer
 * - Right: 5 classical window tabs (对话 / 人设 / 书阁 / 任务 / 设置)
 * - Row 2 (Utility Strip): compact status/music ticker + 导出 / 新建 (on Chat tab) + 用量 / 邮件 / 音乐
 */
@Composable
private fun GardenTopNavBar(
    tabs: List<String>,
    selectedTab: Int,
    onSelectTab: (Int) -> Unit,
    onOpenHistoryDrawer: () -> Unit,
    musicState: MusicPlaybackState,
    onToggleMusic: () -> Unit,
    onOpenMusicSheet: () -> Unit,
    onOpenUsage: () -> Unit,
    onOpenMail: () -> Unit,
    onExportChat: () -> Unit,
    onNewChat: () -> Unit
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
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            // Left History Drawer Trigger Plaque (replacing static 栖忆 plaque)
            Surface(
                modifier = Modifier
                    .height(38.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .clickable(onClick = onOpenHistoryDrawer),
                shape = RoundedCornerShape(6.dp),
                color = garden.paperCard,
                border = BorderStroke(1.2.dp, garden.gold)
            ) {
                Row(
                    modifier = Modifier
                        .padding(2.dp)
                        .border(0.6.dp, garden.line, RoundedCornerShape(4.dp))
                        .padding(horizontal = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(3.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Menu,
                        contentDescription = "打开历史会话目录",
                        tint = garden.bamboo,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = "历史",
                        fontFamily = FontFamily.Serif,
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        letterSpacing = 0.5.sp,
                        color = garden.ink
                    )
                }
            }

            // Classical Window Tabs
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(5.dp)
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
                                fontSize = 12.5.sp,
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

        // Compact Utility Strip (状态/音乐 + 导出/新建 + 用量/邮件/音乐)
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
                horizontalArrangement = Arrangement.spacedBy(5.dp)
            ) {
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
                        text = "栖忆 · ${tabs.getOrElse(selectedTab) { "对话" }}",
                        style = MaterialTheme.typography.labelSmall,
                        color = garden.muted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (selectedTab == 0) {
                    CompactUtilityTextButton(
                        text = "导出",
                        icon = Icons.Default.FileDownload,
                        primary = false,
                        onClick = onExportChat
                    )
                    CompactUtilityTextButton(
                        text = "新建",
                        icon = Icons.Default.AddComment,
                        primary = true,
                        onClick = onNewChat
                    )
                }
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
private fun CompactUtilityTextButton(
    text: String,
    icon: ImageVector,
    primary: Boolean,
    onClick: () -> Unit
) {
    val garden = LocalGardenColors.current
    Surface(
        modifier = Modifier
            .height(30.dp)
            .clip(RoundedCornerShape(6.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(6.dp),
        color = if (primary) garden.bamboo else garden.paper,
        border = BorderStroke(0.9.dp, if (primary) garden.gold.copy(alpha = 0.85f) else garden.line)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = text,
                tint = if (primary) garden.paperCard else garden.bamboo,
                modifier = Modifier.size(14.dp)
            )
            Text(
                text = text,
                fontFamily = FontFamily.Serif,
                fontSize = 11.5.sp,
                fontWeight = FontWeight.SemiBold,
                color = if (primary) garden.paperCard else garden.ink
            )
        }
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
