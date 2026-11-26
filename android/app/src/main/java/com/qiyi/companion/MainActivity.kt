package com.qiyi.companion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.screens.ChatScreen
import com.qiyi.companion.ui.screens.PersonasScreen
import com.qiyi.companion.ui.screens.SettingsScreen
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

private data class NavTab(val label: String, val icon: ImageVector)

@Composable
private fun QiYiAppRoot(viewModel: QiYiViewModel) {
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }

    val tabs = remember {
        listOf(
            NavTab("对话", Icons.Default.ChatBubble),
            NavTab("人设", Icons.Default.Face),
            NavTab("设置", Icons.Default.Settings)
        )
    }

    LaunchedEffect(Unit) {
        viewModel.notices.collect { msg ->
            snackbarHostState.showSnackbar(msg)
        }
    }

    QiYiGardenTheme(themeMode = settings.themeMode) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.background,
            snackbarHost = { SnackbarHost(snackbarHostState) },
            bottomBar = {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    tabs.forEachIndexed { index, tab ->
                        NavigationBarItem(
                            selected = selectedTab == index,
                            onClick = { selectedTab = index },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label) }
                        )
                    }
                }
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
                else -> SettingsScreen(
                    viewModel = viewModel,
                    modifier = Modifier.padding(innerPadding)
                )
            }
        }
    }
}
