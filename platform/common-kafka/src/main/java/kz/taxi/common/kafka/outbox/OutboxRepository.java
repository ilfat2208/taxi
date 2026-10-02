package kz.taxi.common.kafka.outbox;

import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import kz.taxi.common.core.outbox.OutboxStatus;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

/**
 * Access to the outbox table.
 *
 * <p>{@link #claimBatch} takes a pessimistic write lock with {@code SKIP LOCKED}
 * (Hibernate maps lock timeout {@code -2} to it on PostgreSQL). That single
 * detail is what makes the relay horizontally scalable: two replicas polling at
 * the same moment each get a disjoint batch instead of both publishing the same
 * rows.
 */
public interface OutboxRepository extends JpaRepository<OutboxMessage, String> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2"))
    @Query("""
            select m from OutboxMessage m
            where m.status <> kz.taxi.common.core.outbox.OutboxStatus.PUBLISHED
              and m.attempts < :maxAttempts
            order by m.createdAt asc
            """)
    List<OutboxMessage> claimBatch(@Param("maxAttempts") int maxAttempts, Pageable pageable);

    @Modifying
    @Query("""
            delete from OutboxMessage m
            where m.status = kz.taxi.common.core.outbox.OutboxStatus.PUBLISHED
              and m.publishedAt < :threshold
            """)
    int deletePublishedBefore(@Param("threshold") Instant threshold);

    long countByStatus(OutboxStatus status);

    List<OutboxMessage> findByAggregateIdOrderByCreatedAtAsc(String aggregateId);
}
