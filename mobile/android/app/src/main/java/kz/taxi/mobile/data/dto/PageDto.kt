package kz.taxi.mobile.data.dto

import kotlinx.serialization.Serializable

/** Every paged endpoint of the gateway returns this envelope. */
@Serializable
data class PageDto<T>(
    val items: List<T> = emptyList(),
    val page: Int = 0,
    val size: Int = 0,
    val totalElements: Long = 0,
    val totalPages: Int = 0,
    val hasNext: Boolean = false,
)
