package com.kkakkung.app.nativev2

data class NativeSession(
    val userId: String,
    var accessToken: String,
    val supabaseUrl: String,
    val anonKey: String,
    val displayName: String = ""
) {
    val valid: Boolean
        get() = userId.isNotBlank() && accessToken.isNotBlank() &&
            supabaseUrl.startsWith("https://") && anonKey.isNotBlank()
}

object NativeSessionStore {
    @Volatile var current: NativeSession? = null
}
