package kz.taxi.driver.domain;

import kz.taxi.common.core.error.DomainException;

import java.time.Instant;
import java.util.List;

/**
 * The rule that decides whether a driver may go on duty.
 *
 * <p>Extracted from {@link Driver} because it is a policy, not a property of the
 * person: the list of required papers changes with regulation, and dispatch,
 * support and the driver app all need the same answer. Keeping it in one place
 * means an expired medical check cannot be accepted by one caller and refused by
 * another.
 */
public final class DriverDuty {

    /**
     * Ordered on purpose: the error message must name the same missing document
     * every time, or support tickets become unreproducible.
     */
    public static final List<DocumentKind> REQUIRED_DOCUMENTS = List.of(
            DocumentKind.DRIVING_LICENCE,
            DocumentKind.VEHICLE_INSPECTION,
            DocumentKind.MEDICAL_CHECK);

    private DriverDuty() {
    }

    /**
     * Refuses duty unless every required document is on file and still valid.
     *
     * @throws DomainException {@code DRIVER_DOCUMENTS_INCOMPLETE} when one is missing,
     *                         {@code DRIVER_DOCUMENT_EXPIRED} when one has run out
     */
    public static void requireDutyReady(List<DriverDocument> documents, Instant now) {
        for (DocumentKind kind : REQUIRED_DOCUMENTS) {
            DriverDocument document = documents == null ? null : documents.stream()
                    .filter(candidate -> candidate.getKind() == kind)
                    .findFirst()
                    .orElse(null);
            if (document == null) {
                throw DomainException.of(DriverErrorCode.DRIVER_DOCUMENTS_INCOMPLETE,
                                "required document {} is missing", kind)
                        .withDetail("missing", kind.name());
            }
            if (!document.isValidAt(now)) {
                throw DomainException.of(DriverErrorCode.DRIVER_DOCUMENT_EXPIRED,
                                "document {} expired at {}", kind, document.getExpiresAt())
                        .withDetail("kind", kind.name())
                        .withDetail("expiresAt", document.getExpiresAt().toString());
            }
        }
    }
}
