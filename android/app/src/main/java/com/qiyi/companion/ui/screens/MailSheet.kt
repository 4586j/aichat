package com.qiyi.companion.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.qiyi.companion.data.db.MailDraftEntity
import com.qiyi.companion.ui.QiYiViewModel
import com.qiyi.companion.ui.theme.CinnabarPillButton
import com.qiyi.companion.ui.theme.GardenTagPill
import com.qiyi.companion.ui.theme.GardenWindowButton
import com.qiyi.companion.ui.theme.LocalGardenColors

@Composable
fun MailDraftSheet(
    viewModel: QiYiViewModel,
    initialBody: String = "",
    initialSubject: String = ""
) {
    val context = LocalContext.current
    val drafts by viewModel.mailDrafts.collectAsStateWithLifecycle()
    val garden = LocalGardenColors.current

    var editingId by remember { mutableStateOf<String?>(null) }
    var recipient by remember { mutableStateOf("") }
    var subject by remember(initialSubject) { mutableStateOf(initialSubject) }
    var body by remember(initialBody) { mutableStateOf(initialBody) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
    ) {
        Text("锦书邮驿 · 邮件草稿", style = MaterialTheme.typography.titleMedium, color = garden.ink)
        Spacer(Modifier.height(8.dp))

        OutlinedTextField(
            value = recipient,
            onValueChange = { recipient = it },
            label = { Text("收件人邮箱") },
            placeholder = { Text("name@example.com") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = subject,
            onValueChange = { subject = it },
            label = { Text("邮件主题") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = body,
            onValueChange = { body = it },
            label = { Text("正文内容") },
            minLines = 3,
            maxLines = 5,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(8.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            GardenWindowButton(
                text = "存草稿",
                onClick = {
                    viewModel.saveMailDraft(editingId, recipient, subject, body, "draft")
                    editingId = null
                },
                enabled = body.isNotBlank(),
                modifier = Modifier.weight(1f)
            )
            CinnabarPillButton(
                text = "调起邮件发送",
                enabled = body.isNotBlank(),
                onClick = {
                    viewModel.saveMailDraft(editingId, recipient, subject, body, "sent")
                    val intent = Intent(Intent.ACTION_SENDTO).apply {
                        data = Uri.parse("mailto:${Uri.encode(recipient.trim())}")
                        putExtra(Intent.EXTRA_SUBJECT, subject.ifBlank { "来自栖忆的邮件" })
                        putExtra(Intent.EXTRA_TEXT, body)
                    }
                    runCatching { context.startActivity(Intent.createChooser(intent, "选择邮件客户端")) }
                        .onFailure { viewModel.notify("未检测到可用邮件客户端，内容已保存到本地草稿箱。") }
                },
                icon = {
                    Icon(Icons.Default.Send, contentDescription = null, tint = garden.paperCard, modifier = Modifier.size(14.dp))
                }
            )
        }

        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = garden.lineSoft)
        Spacer(Modifier.height(6.dp))
        Text("本地草稿箱（${drafts.size} 封）", style = MaterialTheme.typography.labelSmall, color = garden.muted)
        Spacer(Modifier.height(6.dp))

        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            items(drafts, key = { it.id }) { item: MailDraftEntity ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp),
                    color = garden.paper,
                    border = BorderStroke(0.7.dp, garden.lineSoft)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = item.subject,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = garden.ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f, fill = false)
                                )
                                GardenTagPill(
                                    text = if (item.status == "sent") "已唤起发送" else "草稿",
                                    accent = if (item.status == "sent") garden.bamboo else garden.gold,
                                    background = if (item.status == "sent") garden.bambooSoft else garden.goldSoft
                                )
                            }
                            Text(
                                text = item.body,
                                style = MaterialTheme.typography.bodySmall,
                                color = garden.muted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                        GardenWindowButton(
                            text = "载入",
                            onClick = {
                                editingId = item.id
                                recipient = item.recipient
                                subject = item.subject
                                body = item.body
                            }
                        )
                        IconButton(onClick = { viewModel.deleteMailDraft(item) }, modifier = Modifier.size(30.dp)) {
                            Icon(Icons.Default.DeleteOutline, contentDescription = "删除", tint = garden.cinnabar, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
