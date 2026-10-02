package kz.taxi.mobile.data.dto

import kotlinx.serialization.Serializable

/** `POST /api/v1/auth/token` */
@Serializable
data class TokenRequest(
    val phone: String,
    val code: String,
    val displayName: String? = null,
    val roles: List<String>? = null,
)

@Serializable
data class TokenResponse(
    val accessToken: String,
    val tokenType: String = "Bearer",
    val expiresIn: Long = 0,
    val userId: String,
    val roles: List<String> = emptyList(),
)

/** `GET /api/v1/auth/me` */
@Serializable
data class MeResponse(
    val userId: String,
    val phone: String = "",
    val displayName: String? = null,
    val roles: List<String> = emptyList(),
)

/** Role names understood by the development identity provider. */
object Roles {
    const val CUSTOMER = "CUSTOMER"
    const val ADMIN = "ADMIN"
    const val MERCHANT = "MERCHANT"
}
