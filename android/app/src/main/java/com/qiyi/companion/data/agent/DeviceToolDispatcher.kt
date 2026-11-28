package com.qiyi.companion.data.agent

import android.content.Context
import com.qiyi.companion.data.agent.a11y.QiYiAccessibilityService
import com.qiyi.companion.data.db.AgentAuditLogEntity
import com.qiyi.companion.data.db.QiYiDatabase
import com.qiyi.companion.data.prefs.SecurePreferences
import com.qiyi.companion.data.tools.DeterministicToolRegistry
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.UUID

/**
 * Unified tool dispatcher combining:
 * - Built-in deterministic tools (math, stats, date, time, knowledge search)
 * - Phase 1 native device tools (SAF files, app launcher, alarms, calendar, message drafts, status)
 * - Phase 2 optional accessibility tools (screen_read_current, screen_fill_draft)
 *
 * Every device tool passes through MobileInstructionInspector, ApprovalBroker (for SENSITIVE),
 * and Room agent_audit_logs.
 */
class DeviceToolDispatcher(
    private val appContext: Context,
    private val db: QiYiDatabase,
    private val prefs: SecurePreferences,
    val fileWorkspace: SafFileWorkspaceEngine,
    val appLauncher: AppLauncherEngine,
    val systemActions: SystemActionEngine
) {
    fun deviceToolDefinitions(includeScreenTools: Boolean): JsonArray = buildJsonArray {
        add(toolDef(
            name = "device_list_files",
            description = "列举用户已授权的手机文件夹中的文件与子目录（只读）。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("dir_alias", buildJsonObject { put("type", "string"); put("description", "授权目录别名，省略则默认第一个已授权目录") })
                    put("subpath", buildJsonObject { put("type", "string"); put("description", "子目录相对路径，默认为空") })
                    put("max_depth", buildJsonObject { put("type", "integer"); put("description", "遍历深度 1~3，默认 2") })
                })
            }
        ))
        add(toolDef(
            name = "device_read_file",
            description = "读取用户已授权手机目录中的文本/Markdown/JSON/代码文件（带行号，安全只读）。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("dir_alias", buildJsonObject { put("type", "string"); put("description", "授权目录别名，省略则默认第一个目录") })
                    put("path", buildJsonObject { put("type", "string"); put("description", "文件相对路径，例如 todo.md 或 notes/plan.md") })
                    put("start_line", buildJsonObject { put("type", "integer"); put("description", "起始行号，默认 1") })
                    put("max_lines", buildJsonObject { put("type", "integer"); put("description", "最多读取行数，默认 200") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("path")) })
            }
        ))
        add(toolDef(
            name = "device_search_files",
            description = "在用户已授权手机文件夹内按文件名或正文关键词搜索文件。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("query", buildJsonObject { put("type", "string"); put("description", "搜索关键词") })
                    put("dir_alias", buildJsonObject { put("type", "string"); put("description", "可选，限定某个授权目录") })
                    put("search_content", buildJsonObject { put("type", "boolean"); put("description", "是否同时搜索正文，默认 true") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("query")) })
            }
        ))
        add(toolDef(
            name = "device_write_file",
            description = "新建或修改用户授权目录内的文本文件（需用户审批 Diff，执行前自动留快照支持一键撤销）。修改现有文件请优先使用 patch 模式。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("dir_alias", buildJsonObject { put("type", "string"); put("description", "授权目录别名，省略则默认第一个目录") })
                    put("path", buildJsonObject { put("type", "string"); put("description", "文件相对路径") })
                    put("mode", buildJsonObject {
                        put("type", "string")
                        put("enum", buildJsonArray {
                            add(JsonPrimitive("patch"))
                            add(JsonPrimitive("append"))
                            add(JsonPrimitive("overwrite"))
                            add(JsonPrimitive("create"))
                        })
                        put("description", "写入方式：patch(精准替换) / append(末尾追加) / overwrite(覆写) / create(新建)")
                    })
                    put("target_text", buildJsonObject { put("type", "string"); put("description", "patch 模式必填：要被替换的原文本片段") })
                    put("content", buildJsonObject { put("type", "string"); put("description", "新写入或替换后的文本内容") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("path")); add(JsonPrimitive("mode")); add(JsonPrimitive("content")) })
            }
        ))
        add(toolDef(
            name = "device_delete_file",
            description = "删除用户授权目录内的单个文件（强制用户审批，删除前自动备份快照可还原）。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("dir_alias", buildJsonObject { put("type", "string"); put("description", "授权目录别名") })
                    put("path", buildJsonObject { put("type", "string"); put("description", "要删除的文件相对路径") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("path")) })
            }
        ))
        add(toolDef(
            name = "device_list_apps",
            description = "搜索本机桌面已安装的可启动应用列表（支持中文名或简称，如微信、B站、高德、网易云）。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("query", buildJsonObject { put("type", "string"); put("description", "应用关键词，留空则返回前 15 个应用") })
                })
            }
        ))
        add(toolDef(
            name = "device_open_app",
            description = "打开手机上已安装的指定应用（支持中文应用名、简称或完整包名）。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("app", buildJsonObject { put("type", "string"); put("description", "应用名称或包名，例如 微信、高德地图、com.tencent.mm") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("app")) })
            }
        ))
        add(toolDef(
            name = "device_get_status",
            description = "获取当前手机电量、充电状态、网络连接和铃声模式。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {})
            }
        ))
        add(toolDef(
            name = "device_set_alarm",
            description = "拉起系统闹钟或倒计时确认页（需用户确认）。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("mode", buildJsonObject {
                        put("type", "string")
                        put("enum", buildJsonArray { add(JsonPrimitive("alarm")); add(JsonPrimitive("timer")) })
                    })
                    put("hour", buildJsonObject { put("type", "integer"); put("description", "闹钟小时 0~23") })
                    put("minute", buildJsonObject { put("type", "integer"); put("description", "闹钟分钟 0~59") })
                    put("seconds", buildJsonObject { put("type", "integer"); put("description", "倒计时秒数（timer 模式）") })
                    put("label", buildJsonObject { put("type", "string"); put("description", "闹钟或计时器备注标签") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("mode")) })
            }
        ))
        add(toolDef(
            name = "device_create_calendar_event",
            description = "拉起系统日历并预填日程信息，由用户一键确认保存。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("title", buildJsonObject { put("type", "string"); put("description", "日程标题") })
                    put("start_iso", buildJsonObject { put("type", "string"); put("description", "开始时间 ISO 格式，例如 2026-11-29T09:00") })
                    put("end_iso", buildJsonObject { put("type", "string"); put("description", "结束时间 ISO 格式，可留空默认 1 小时") })
                    put("location", buildJsonObject { put("type", "string"); put("description", "地点，可选") })
                    put("description", buildJsonObject { put("type", "string"); put("description", "备注说明，可选") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("title")); add(JsonPrimitive("start_iso")) })
            }
        ))
        add(toolDef(
            name = "device_prepare_message",
            description = "起草短信或系统分享消息草稿（预填收件人与文案，永远由用户亲自点击发送）。",
            params = buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {
                    put("channel", buildJsonObject {
                        put("type", "string")
                        put("enum", buildJsonArray { add(JsonPrimitive("sms")); add(JsonPrimitive("share")) })
                        put("description", "sms(系统短信草稿) 或 share(拉起系统分享给微信/QQ等)")
                    })
                    put("recipient", buildJsonObject { put("type", "string"); put("description", "短信收件手机号，share 模式可留空") })
                    put("text", buildJsonObject { put("type", "string"); put("description", "消息草稿正文") })
                })
                put("required", buildJsonArray { add(JsonPrimitive("channel")); add(JsonPrimitive("text")) })
            }
        ))

        if (includeScreenTools) {
            add(toolDef(
                name = "screen_read_current",
                description = "读取当前（或最近离开的）第三方应用屏幕可见文本（已自动过滤密码框与支付/银行隐私页面）。",
                params = buildJsonObject {
                    put("type", "object")
                    put("properties", buildJsonObject {
                        put("max_chars", buildJsonObject { put("type", "integer"); put("description", "最多返回字符数，默认 3000") })
                    })
                }
            ))
            add(toolDef(
                name = "screen_fill_draft",
                description = "将回复草稿填入当前前台应用的输入框（强制用户审批，严禁自动点击发送按钮，若输入框不在前台则自动复制到剪贴板）。",
                params = buildJsonObject {
                    put("type", "object")
                    put("properties", buildJsonObject {
                        put("text", buildJsonObject { put("type", "string"); put("description", "要填入输入框的草稿正文") })
                        put("target_hint", buildJsonObject { put("type", "string"); put("description", "可选，目标输入框提示语关键词") })
                    })
                    put("required", buildJsonArray { add(JsonPrimitive("text")) })
                }
            ))
        }
    }

    suspend fun execute(
        conversationId: String,
        toolName: String,
        args: JsonObject,
        knowledgeSearcher: suspend (String) -> String,
        approvalBroker: ApprovalBroker,
        onWaitingApproval: (ApprovalTicket?) -> Unit = {}
    ): String {
        val cleanName = toolName.trim()
        // Built-in deterministic tools stay fast & direct
        if (cleanName in setOf("calculator", "data_stats", "date_calculator", "get_system_time", "knowledge_deep_search")) {
            return DeterministicToolRegistry.execute(cleanName, args, knowledgeSearcher)
        }

        val cfg = prefs.settings.value
        val policy = SecurityPolicyMode.fromKey(cfg.deviceSecurityMode)
        val risk = MobileInstructionInspector.classifyRisk(
            toolName = cleanName,
            policyMode = policy,
            allowDirectAppLaunch = cfg.allowDirectAppLaunch
        )
        val auditId = UUID.randomUUID().toString()
        val maskedArgs = MobileInstructionInspector.maskSensitiveArgs(args.toString())

        if (!cfg.deviceAgentEnabled) {
            recordAudit(auditId, conversationId, cleanName, risk, maskedArgs, "blocked", "手机助理开关未开启")
            return "手机助理功能尚未开启。请引导用户前往「设置 → 04 手机助理与权限沙箱」开启开关后再试。"
        }

        if (risk == ToolRiskLevel.FORBIDDEN) {
            recordAudit(auditId, conversationId, cleanName, risk, maskedArgs, "blocked", "命中安全红线禁区")
            return "安全拦截：出于隐私与防误操作红线，系统永久禁止执行「$cleanName」。"
        }

        // Prepare preview / diff before asking for approval on sensitive actions
        var preparedWrite: PreparedFileWrite? = null
        var preparedDelete: PreparedFileDelete? = null
        val (title, summary, diffPreview) = when (cleanName) {
            "device_write_file" -> {
                val pw = fileWorkspace.prepareWrite(
                    dirAlias = args["dir_alias"]?.jsonPrimitive?.contentOrNull,
                    relativePath = args["path"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    mode = args["mode"]?.jsonPrimitive?.contentOrNull ?: "patch",
                    targetText = args["target_text"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    content = args["content"]?.jsonPrimitive?.contentOrNull.orEmpty()
                )
                preparedWrite = pw
                val verb = if (pw.existingDocUri == null) "新建文件" else "修改文件（${pw.mode}）"
                Triple(
                    "$verb：${pw.directory.alias}/${pw.relativePath}",
                    "将改动授权目录内的文件，执行前会自动留存快照以便一键撤销。",
                    pw.diffPreview
                )
            }
            "device_delete_file" -> {
                val pd = fileWorkspace.prepareDelete(
                    dirAlias = args["dir_alias"]?.jsonPrimitive?.contentOrNull,
                    relativePath = args["path"]?.jsonPrimitive?.contentOrNull.orEmpty()
                )
                preparedDelete = pd
                Triple(
                    "删除文件：${pd.directory.alias}/${pd.relativePath}",
                    "将删除该授权目录内的文件（原内容会先备份至本地快照支持恢复）。",
                    pd.originalContent.take(600).ifBlank { "（非文本或空文件）" }
                )
            }
            "device_open_app" -> {
                val app = args["app"]?.jsonPrimitive?.contentOrNull.orEmpty()
                Triple("打开手机应用：$app", "将拉起本机已安装应用「$app」。", "")
            }
            "device_set_alarm" -> {
                val mode = args["mode"]?.jsonPrimitive?.contentOrNull ?: "alarm"
                val label = args["label"]?.jsonPrimitive?.contentOrNull.orEmpty().ifBlank { "栖忆提醒" }
                val detail = if (mode == "timer") {
                    "倒计时 ${args["seconds"]?.jsonPrimitive?.intOrNull ?: 60} 秒"
                } else {
                    String.format("%02d:%02d", args["hour"]?.jsonPrimitive?.intOrNull ?: 0, args["minute"]?.jsonPrimitive?.intOrNull ?: 0)
                }
                Triple("设置系统${if (mode == "timer") "计时器" else "闹钟"}", "$detail · 标签：$label", "")
            }
            "device_create_calendar_event" -> {
                val evTitle = args["title"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val startIso = args["start_iso"]?.jsonPrimitive?.contentOrNull.orEmpty()
                Triple("创建系统日历日程", "「$evTitle」 · 开始时间：$startIso", "")
            }
            "device_prepare_message" -> {
                val ch = args["channel"]?.jsonPrimitive?.contentOrNull ?: "share"
                val rec = args["recipient"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val txt = args["text"]?.jsonPrimitive?.contentOrNull.orEmpty()
                Triple(
                    if (ch == "sms") "预填系统短信草稿" else "拉起系统分享消息草稿",
                    "收件人：${rec.ifBlank { "手动选择" }}（不会自动发送，仅预填草稿）",
                    txt.take(500)
                )
            }
            "screen_read_current" -> {
                Triple("读取当前屏幕内容", "通过无障碍服务提取当前前台页面的脱敏可见文本（自动屏蔽支付与密码框）。", "")
            }
            "screen_fill_draft" -> {
                val txt = args["text"]?.jsonPrimitive?.contentOrNull.orEmpty()
                Triple("填入消息草稿（不自动发送）", "将以下草稿填入当前应用输入框（或复制到剪贴板），最后发送需由你手动点击：", txt.take(500))
            }
            else -> Triple("执行设备指令：$cleanName", maskedArgs, "")
        }

        val decision: String
        if (risk == ToolRiskLevel.SENSITIVE) {
            val ticket = ApprovalTicket(
                ticketId = MobileInstructionInspector.generateTicketId(),
                conversationId = conversationId,
                toolName = cleanName,
                title = title,
                summary = summary,
                diffPreview = diffPreview,
                argsSummary = maskedArgs
            )
            onWaitingApproval(ticket)
            val outcome = try {
                approvalBroker.requestApproval(ticket)
            } finally {
                onWaitingApproval(null)
            }
            when (outcome) {
                ApprovalOutcome.APPROVED -> decision = "approved"
                ApprovalOutcome.REJECTED -> {
                    recordAudit(auditId, conversationId, cleanName, risk, maskedArgs, "rejected", "用户拒绝执行")
                    return "用户已拒绝执行「$title」。请尊重用户决定，不要重复发起该调用。"
                }
                ApprovalOutcome.TIMEOUT -> {
                    recordAudit(auditId, conversationId, cleanName, risk, maskedArgs, "timeout", "审批超时自动取消")
                    return "审批请求「$title」超过 10 分钟未确认，已自动取消。"
                }
                ApprovalOutcome.CANCELLED -> {
                    recordAudit(auditId, conversationId, cleanName, risk, maskedArgs, "rejected", "会话中断取消审批")
                    return "审批已取消。"
                }
            }
        } else {
            decision = "auto"
        }

        var snapshotId = ""
        val output = when (cleanName) {
            "device_list_files" -> fileWorkspace.listFiles(
                dirAlias = args["dir_alias"]?.jsonPrimitive?.contentOrNull,
                subpath = args["subpath"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                maxDepth = args["max_depth"]?.jsonPrimitive?.intOrNull ?: 2
            )
            "device_read_file" -> fileWorkspace.readFile(
                dirAlias = args["dir_alias"]?.jsonPrimitive?.contentOrNull,
                relativePath = args["path"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                startLine = args["start_line"]?.jsonPrimitive?.intOrNull ?: 1,
                maxLines = args["max_lines"]?.jsonPrimitive?.intOrNull ?: 200
            )
            "device_search_files" -> fileWorkspace.searchFiles(
                query = args["query"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                dirAlias = args["dir_alias"]?.jsonPrimitive?.contentOrNull,
                searchContent = args["search_content"]?.jsonPrimitive?.booleanOrNull ?: true
            )
            "device_write_file" -> {
                val (msg, snapId) = fileWorkspace.commitWrite(preparedWrite!!, auditId)
                snapshotId = snapId
                msg
            }
            "device_delete_file" -> {
                val (msg, snapId) = fileWorkspace.commitDelete(preparedDelete!!, auditId)
                snapshotId = snapId
                msg
            }
            "device_list_apps" -> {
                val query = args["query"]?.jsonPrimitive?.contentOrNull.orEmpty()
                val apps = appLauncher.listLaunchableApps(query, limit = 15)
                if (apps.isEmpty()) {
                    "未找到匹配「$query」的已安装应用。"
                } else {
                    "找到 ${apps.size} 个应用：\n" + apps.joinToString("\n") { "- ${it.appName} (${it.packageName})" }
                }
            }
            "device_open_app" -> appLauncher.openApp(args["app"]?.jsonPrimitive?.contentOrNull.orEmpty())
            "device_get_status" -> systemActions.getDeviceStatus()
            "device_set_alarm" -> systemActions.setAlarmOrTimer(
                mode = args["mode"]?.jsonPrimitive?.contentOrNull ?: "alarm",
                hour = args["hour"]?.jsonPrimitive?.intOrNull,
                minute = args["minute"]?.jsonPrimitive?.intOrNull,
                seconds = args["seconds"]?.jsonPrimitive?.intOrNull,
                label = args["label"]?.jsonPrimitive?.contentOrNull.orEmpty()
            )
            "device_create_calendar_event" -> systemActions.createCalendarEvent(
                title = args["title"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                startIso = args["start_iso"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                endIso = args["end_iso"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                location = args["location"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                description = args["description"]?.jsonPrimitive?.contentOrNull.orEmpty()
            )
            "device_prepare_message" -> systemActions.prepareMessageDraft(
                channel = args["channel"]?.jsonPrimitive?.contentOrNull ?: "share",
                recipient = args["recipient"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                text = args["text"]?.jsonPrimitive?.contentOrNull.orEmpty()
            )
            "screen_read_current" -> {
                val svc = QiYiAccessibilityService.instance
                    ?: throw IllegalStateException("无障碍读屏服务尚未开启，请引导用户前往「设置 → 04 手机助理 → 开启无障碍辅助」。")
                val snap = svc.captureCurrentOrLastExternalSnapshot().getOrThrow()
                val maxChars = (args["max_chars"]?.jsonPrimitive?.intOrNull ?: 3000).coerceIn(400, 6000)
                MobileInstructionInspector.wrapUntrustedDeviceData(
                    source = "screen:${snap.packageName}",
                    rawContent = snap.formatForModel(maxChars),
                    maxChars = maxChars
                )
            }
            "screen_fill_draft" -> {
                val svc = QiYiAccessibilityService.instance
                    ?: throw IllegalStateException("无障碍辅助尚未开启，无法自动填入输入框。")
                svc.fillDraftIntoActiveInput(
                    draftText = args["text"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                    targetHint = args["target_hint"]?.jsonPrimitive?.contentOrNull.orEmpty()
                )
            }
            else -> "不支持的设备工具：$cleanName"
        }

        recordAudit(
            id = auditId,
            conversationId = conversationId,
            toolName = cleanName,
            risk = risk,
            argsSummary = maskedArgs,
            decision = decision,
            resultSummary = output.take(220),
            snapshotId = snapshotId
        )
        return output
    }

    private suspend fun recordAudit(
        id: String,
        conversationId: String,
        toolName: String,
        risk: ToolRiskLevel,
        argsSummary: String,
        decision: String,
        resultSummary: String,
        snapshotId: String = ""
    ) {
        db.agentAuditLogDao().insert(
            AgentAuditLogEntity(
                id = id,
                conversationId = conversationId,
                toolName = toolName,
                riskLevel = risk.name,
                argsSummary = argsSummary,
                decision = decision,
                resultSummary = resultSummary,
                snapshotId = snapshotId
            )
        )
    }

    private fun toolDef(name: String, description: String, params: JsonObject): JsonObject = buildJsonObject {
        put("type", "function")
        put("function", buildJsonObject {
            put("name", name)
            put("description", description)
            put("parameters", params)
        })
    }
}
