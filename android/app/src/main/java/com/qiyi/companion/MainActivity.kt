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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.screens.ChatScreen
import com.qiyi.companion.ui.screens.LibraryScreen
import com.qiyi.companion.ui.screens.PersonasScreen
import com.qiyi.companion.ui.screens.SettingsScreen
import com.qiyi.companion.ui.theme.LocalGardenColors
import com.qiyi.companion.ui.theme.QiYiGardenTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as QiYiApplication
        setContent {
            val viewModel: QiYiViewModel = viewModel(factory = QiYiViewModel.factory(app.repository))
            QiYiAppRoot(viewModel = viewModel)
        }
    }
}

@Composable
private fun QiYiAppRoot(viewModel: QiYiViewModel) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }

    val tabs = remember { listOf("对话", "人设", "书阁", "设置") }

    LaunchedEffect(Unit) {
        viewModel.notices.collect { msg ->
            snackbarHostState.showSnackbar(msg)
        }
    }

    QiYiGardenTheme(themeMode = settings.themeMode) {
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
                    onSelectTab = { selectedTab = it }
                )
            }
        ) { innerPadding ->
            when (selectedTab) {
                0 -> ChatScreen(
                    viewModel = viewModel,
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
                else -> SettingsScreen(
                    viewModel = viewModel,
                    modifier = Modifier.padding(innerPadding)
                )
            }
        }
    }
}

/**
 * Top classical garden brand plaque + window tab bar + cinnabar lacquer divider,
 * visually aligned with 栖忆 mobile web V4.
 */
@Composable
private fun GardenTopNavBar(
    tabs: List<String>,
    selectedTab: Int,
    onSelectTab: (Int) -> Unit
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
    }
}
