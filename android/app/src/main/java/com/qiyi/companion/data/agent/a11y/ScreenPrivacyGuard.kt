package com.qiyi.companion.data.agent.a11y

/**
 * Hardcoded privacy & anti-fraud guard for Phase 2 Accessibility features.
 * - Blocks reading or interacting with banking, payment, password managers, and system permission dialogs.
 * - Strictly forbids clicking any Send / Pay / Transfer / Confirm-Delete button.
 */
object ScreenPrivacyGuard {

    private val BLOCKED_PACKAGES = setOf(
        "com.eg.android.AlipayGphone",          // 支付宝
        "com.unionpay",                         // 云闪付
        "com.icbc",                             // 工商银行
        "com.chinamworld.main",                 // 建设银行
        "com.android.bankabc",                  // 农业银行
        "com.chinamworld.bocmbci",              // 中国银行
        "cmb.pb",                               // 招商银行
        "com.bankcomm.Bankcomm",                // 交通银行
        "com.yitong.mbank.psbc",                // 邮储银行
        "com.pingan.paces.ccms",                // 平安口袋银行
        "com.onepassword.android",              // 1Password
        "com.x8bit.bitwarden",                  // Bitwarden
        "keepass2android.keepass2android",      // KeePass
        "com.google.android.apps.authenticator2",
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.android.systemui"
    )

    private val BLOCKED_CLASS_KEYWORDS = listOf(
        "wallet",
        "payui",
        "payactivity",
        "cashier",
        "remittance",
        "transfer",
        "biometric",
        "keyguard",
        "lockscreen",
        "password",
        "grantpermissions"
    )

    private val FORBIDDEN_ACTION_BUTTON_LABELS = listOf(
        "发送",
        "send",
        "支付",
        "付款",
        "立即支付",
        "确认支付",
        "转账",
        "确认转账",
        "确认付款",
        "pay now",
        "confirm pay",
        "卸载",
        "uninstall",
        "确认删除",
        "永久删除"
    )

    fun isBlockedPackageOrActivity(packageName: String?, className: String? = null): Boolean {
        val pkg = packageName?.trim().orEmpty()
        if (pkg.isEmpty()) return false
        if (pkg in BLOCKED_PACKAGES) return true
        val pkgLow = pkg.lowercase()
        if (pkgLow.contains("bank") && (pkgLow.contains("mobile") || pkgLow.contains("mbank") || pkgLow.contains("ebank"))) {
            return true
        }
        val clsLow = className?.trim().orEmpty().lowercase()
        if (clsLow.isNotEmpty() && BLOCKED_CLASS_KEYWORDS.any { clsLow.contains(it) }) {
            return true
        }
        return false
    }

    /**
     * Secondary defense: ensures code can NEVER treat a Send / Pay / Delete button as clickable.
     */
    fun isForbiddenButtonLabel(label: String?): Boolean {
        val clean = label?.trim()?.lowercase().orEmpty()
        if (clean.isEmpty()) return false
        return FORBIDDEN_ACTION_BUTTON_LABELS.any { clean == it || clean.contains(it) }
    }
}
