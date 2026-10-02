package kz.taxi.payment.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.payment.api.dto.SettlementDtos;
import kz.taxi.payment.application.SettlementService;
import kz.taxi.payment.application.SettlementStateService;
import kz.taxi.payment.domain.MerchantSettlement;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.infrastructure.SettlementPaymentRepository;
import kz.taxi.payment.infrastructure.SettlementRepository;
import kz.taxi.common.core.error.DomainException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Merchant payouts: what the platform owes, what it has paid, and on what.
 *
 * <p>A merchant sees its own settlements and nothing else; an operator sees
 * everything and can force a run. The run endpoint exists because "when will I be
 * paid" and "the payout failed, retry it" are real operational needs, and a
 * scheduler you cannot trigger is a scheduler you cannot support.
 */
@RestController
@RequestMapping("/api/v1/settlements")
@Tag(name = "Settlements", description = "What the platform owes merchants, and what it has paid")
public class SettlementController {

    private static final int MAX_PAGE_SIZE = 100;

    private final SettlementRepository settlements;
    private final SettlementPaymentRepository settlementPayments;
    private final SettlementStateService state;
    private final SettlementService settlementService;
    private final CurrentUser currentUser;

    public SettlementController(SettlementRepository settlements,
                               SettlementPaymentRepository settlementPayments,
                               SettlementStateService state,
                               SettlementService settlementService,
                               CurrentUser currentUser) {
        this.settlements = settlements;
        this.settlementPayments = settlementPayments;
        this.state = state;
        this.settlementService = settlementService;
        this.currentUser = currentUser;
    }

    @GetMapping
    @Operation(summary = "List settlements",
            description = "A merchant sees its own payouts. An operator (SUPPORT/ADMIN) may filter by merchantId "
                    + "or list everything.")
    public PageResponse<SettlementDtos.SettlementResponse> list(
            @Parameter(description = "Operator only: restrict to one merchant")
            @RequestParam(required = false) String merchantId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        AuthenticatedUser user = currentUser.require();
        Pageable pageable = PageRequest.of(Math.max(page, 0), clamp(size));

        Page<MerchantSettlement> result;
        if (user.isAdmin() || user.hasRole(kz.taxi.common.security.Roles.SUPPORT)) {
            result = merchantId == null
                    ? settlements.findAllByOrderByCreatedAtDesc(pageable)
                    : settlements.findByMerchantIdOrderByCreatedAtDesc(merchantId, pageable);
        } else {
            result = settlements.findByOwnerUserIdOrderByCreatedAtDesc(user.userId(), pageable);
        }
        return PageResponse.of(result.getContent(), result.getNumber(), result.getSize(),
                result.getTotalElements(), SettlementController::toResponse);
    }

    @GetMapping("/{settlementId}")
    @Operation(summary = "One settlement, with the payments it covers",
            description = "This is the answer to \"what am I being paid for\": a merchant never has to ask support.")
    public SettlementDtos.SettlementDetailResponse get(@PathVariable String settlementId) {
        MerchantSettlement settlement = state.require(settlementId);
        AuthenticatedUser user = currentUser.require();
        if (!user.canAccess(settlement.getOwnerUserId())) {
            throw DomainException.of(PaymentErrorCode.SETTLEMENT_NOT_FOUND,
                    "settlement {} not found", settlementId);
        }
        List<String> paymentIds = settlementPayments.findBySettlementId(settlementId).stream()
                .map(kz.taxi.payment.domain.SettlementPayment::getPaymentId)
                .toList();
        return new SettlementDtos.SettlementDetailResponse(toResponse(settlement), paymentIds);
    }

    @PostMapping("/run")
    @PreAuthorize("hasRole('ADMIN')")
    @Operation(summary = "Run settlement now (operator only)",
            description = "Computes what is owed and pays it, exactly as the scheduled job does. "
                    + "Idempotent: a second run for the same period finds the settlements already computed.")
    public SettlementDtos.SettlementRunResponse run() {
        SettlementService.RunSummary computed = settlementService.runOnce();
        SettlementService.RunSummary retried = settlementService.retryPayable();
        return new SettlementDtos.SettlementRunResponse(
                computed.computed(),
                computed.paid() + retried.paid(),
                computed.failed() + retried.failed(),
                computed.awaitingPayoutAccount() + retried.awaitingPayoutAccount(),
                computed.nothingToSettle());
    }

    private static SettlementDtos.SettlementResponse toResponse(MerchantSettlement settlement) {
        return new SettlementDtos.SettlementResponse(
                settlement.getId(),
                settlement.getSettlementNumber(),
                settlement.getMerchantId(),
                settlement.getOwnerUserId(),
                settlement.getStatus().name(),
                settlement.getCurrency().name(),
                settlement.getGrossMinor(),
                settlement.getCommissionMinor(),
                settlement.getCustomerPaidMinor(),
                settlement.getNetMinor(),
                settlement.getPaymentCount(),
                settlement.getPayoutAccountId(),
                settlement.getPeriodStart(),
                settlement.getPeriodEnd(),
                settlement.getCreatedAt(),
                settlement.getPaidAt(),
                settlement.getFailureReason());
    }

    private static int clamp(int size) {
        return Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    }
}
