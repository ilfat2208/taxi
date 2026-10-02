package kz.taxi.driver.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.driver.domain.DocumentKind;
import kz.taxi.driver.domain.Driver;
import kz.taxi.driver.domain.DriverDocument;
import kz.taxi.driver.domain.DriverErrorCode;
import kz.taxi.driver.domain.DriverStatus;
import kz.taxi.driver.infrastructure.DriverDocumentRepository;
import kz.taxi.driver.infrastructure.DriverRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * Use cases around a driver profile and his duty state.
 *
 * <p>Two callers with very different needs share this class: the driver app
 * (register, upload papers, toggle duty) and, later, the trip saga (claim a
 * driver for a trip, release him when it ends). Both go through the same
 * aggregate methods, so a rule like "no duty with an expired medical check"
 * cannot be bypassed by whoever calls second.
 */
@Service
@Slf4j
public class DriverApplicationService {

    private final DriverRepository driverRepository;
    private final DriverDocumentRepository documentRepository;
    private final OutboxWriter outboxWriter;

    public DriverApplicationService(DriverRepository driverRepository,
                                    DriverDocumentRepository documentRepository,
                                    OutboxWriter outboxWriter) {
        this.driverRepository = driverRepository;
        this.documentRepository = documentRepository;
        this.outboxWriter = outboxWriter;
    }

    // ------------------------------------------------------------------ profile

    @Transactional
    public Driver register(String userId, String phone, String displayName) {
        if (driverRepository.existsByUserId(userId)) {
            throw DomainException.of(DriverErrorCode.DRIVER_ALREADY_EXISTS,
                            "user {} already has a driver profile", userId)
                    .withDetail("userId", userId);
        }
        Driver driver = driverRepository.save(Driver.register(userId, phone, displayName, Instant.now()));
        log.info("registered driver {} for user {} ({})", driver.getId(), userId, phone);
        return driver;
    }

    @Transactional(readOnly = true)
    public Driver requireByUserId(String userId) {
        return driverRepository.findByUserId(userId)
                .orElseThrow(() -> DomainException.of(DriverErrorCode.DRIVER_NOT_FOUND,
                                "no driver profile for user {}", userId)
                        .withDetail("userId", userId));
    }

    @Transactional(readOnly = true)
    public Driver requireById(String driverId) {
        return driverRepository.findById(driverId)
                .orElseThrow(() -> DomainException.of(DriverErrorCode.DRIVER_NOT_FOUND,
                                "driver {} not found", driverId)
                        .withDetail("driverId", driverId));
    }

    // ------------------------------------------------------------------ documents

    @Transactional(readOnly = true)
    public List<DriverDocument> documents(String driverId) {
        return documentRepository.findByDriverIdOrderByKindAsc(driverId);
    }

    /**
     * Records a document, or renews it if one of the same kind is already on file.
     *
     * <p>In this demo the driver submits his own papers. A real deployment inserts
     * a verification step (an operator or an external registry) between "paper
     * uploaded" and "paper counts" — which is why the method is a single point of
     * change rather than logic spread over the controller.
     */
    @Transactional
    public DriverDocument issueDocument(String userId, DocumentKind kind, Instant expiresAt) {
        Driver driver = requireByUserId(userId);
        Instant now = Instant.now();
        DriverDocument document = documentRepository.findByDriverIdAndKind(driver.getId(), kind)
                .map(existing -> {
                    existing.renew(expiresAt, now);
                    return existing;
                })
                .orElseGet(() -> documentRepository.save(
                        DriverDocument.issue(driver.getId(), kind, expiresAt, now)));
        log.info("driver {} document {} valid until {}", driver.getId(), kind, expiresAt);
        return document;
    }

    // ------------------------------------------------------------------ duty

    /**
     * Toggles duty. {@link DriverStatus#BUSY} is refused on purpose: it is set by
     * dispatch when a trip is assigned, and a client that could declare itself
     * busy would be able to hide from offers.
     */
    @Transactional
    public Driver changeStatus(String userId, DriverStatus target) {
        Driver driver = requireByUserId(userId);
        Instant now = Instant.now();
        DriverStatus before = driver.getStatus();

        switch (target) {
            case ONLINE -> driver.goOnDuty(documents(driver.getId()), now);
            case OFFLINE -> driver.goOffDuty(now);
            case BUSY -> throw DomainException.of(DriverErrorCode.INVALID_DRIVER,
                            "BUSY is set by dispatch when a trip is assigned, not by the client")
                    .withDetail("status", DriverStatus.BUSY.name());
        }

        // A repeated "go offline" is a no-op for the client, but it must not spam
        // the topic: dispatch would uselessly re-evaluate its candidate set.
        if (driver.getStatus() != before) {
            publishDuty(driver, now);
        }
        return driver;
    }

    // ------------------------------------------------------------------ trips

    /**
     * Claims the driver for a trip.
     *
     * <p>Called by the trip saga (Ф2) rather than by a client: it is the moment the
     * driver stops being available to everybody else, so it must not be reachable
     * from the app.
     */
    @Transactional
    public Driver assignTrip(String driverId, String tripId) {
        Driver driver = requireById(driverId);
        driver.assignTrip(tripId, Instant.now());
        log.info("driver {} assigned to trip {}", driverId, tripId);
        return driver;
    }

    /** Releases the driver after the trip; he stays on duty. */
    @Transactional
    public Driver finishTrip(String driverId) {
        Driver driver = requireById(driverId);
        driver.finishTrip(Instant.now());
        log.info("driver {} finished trip, completed={}", driverId, driver.getCompletedTrips());
        return driver;
    }

    // ------------------------------------------------------------------ events

    private void publishDuty(Driver driver, Instant now) {
        String eventType = driver.getStatus() == DriverStatus.ONLINE
                ? KafkaTopics.Events.DRIVER_ONLINE
                : KafkaTopics.Events.DRIVER_OFFLINE;
        outboxWriter.append(KafkaTopics.DRIVER_EVENTS, eventType, "Driver", driver.getId(), driver.getVersion(),
                new DriverEvents.DutyChanged(driver.getId(), driver.getUserId(), driver.getStatus().name(), now));
    }
}
