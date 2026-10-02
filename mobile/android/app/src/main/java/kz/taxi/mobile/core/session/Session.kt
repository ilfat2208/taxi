package kz.taxi.mobile.core.session

/** An authenticated session, as returned by `POST /api/v1/auth/token` and `GET /api/v1/auth/me`. */
data class Session(
    val accessToken: String,
    val userId: String,
    val phone: String,
    val displayName: String,
    val roles: List<String>,
) {
    val isAdmin: Boolean get() = roles.any { it.equals("ADMIN", ignoreCase = true) }

    val initials: String
        get() = displayName.trim()
            .split(' ')
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.first().uppercase() }
            .ifEmpty { phone.takeLast(2) }
}
