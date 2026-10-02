package kz.taxi.mobile.data.repo

import kz.taxi.mobile.core.net.apiCall
import kz.taxi.mobile.data.dto.PageDto
import kz.taxi.mobile.data.dto.PaymentDetailDto
import kz.taxi.mobile.data.dto.PaymentDto
import kz.taxi.mobile.data.dto.TransferRequest
import kz.taxi.mobile.data.remote.PaymentsApi

class PaymentsRepository(private val paymentsApi: PaymentsApi) {

    /**
     * @param idempotencyKey a fresh UUID for a new submit; pass the *same* value again when
     *   retrying that submit, and a new one for a deliberate repeat.
     */
    suspend fun transfer(
        idempotencyKey: String,
        sourceAccountId: String,
        targetPhone: String,
        amountMinor: Long,
        currency: String = "KZT",
        description: String? = null,
    ): Result<PaymentDto> = apiCall {
        paymentsApi.transfer(
            idempotencyKey = idempotencyKey,
            body = TransferRequest(
                sourceAccountId = sourceAccountId,
                targetPhone = targetPhone.trim(),
                amountMinor = amountMinor,
                currency = currency,
                description = description?.trim()?.takeIf { it.isNotEmpty() },
            ),
        )
    }

    suspend fun payments(
        page: Int = 0,
        size: Int = DEFAULT_PAGE_SIZE,
        status: String? = null,
    ): Result<PageDto<PaymentDto>> = apiCall {
        paymentsApi.listPayments(page = page, size = size, status = status)
    }

    suspend fun payment(paymentId: String): Result<PaymentDetailDto> = apiCall {
        paymentsApi.payment(paymentId)
    }

    /** The single payment document the gateway keeps for an order. */
    suspend fun paymentsOfOrder(orderId: String): Result<PaymentDto> = apiCall {
        paymentsApi.paymentsByOrder(orderId)
    }

    companion object {
        const val DEFAULT_PAGE_SIZE = 20
    }
}
