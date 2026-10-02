package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.CreateMerchantRequest;
import kz.taxi.catalog.api.dto.MerchantResponse;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.MerchantStatus;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Onboarding rules: one profile per user, enforced by the database, reported as 409. */
class MerchantServiceTest {

    private static final String OWNER = "user-merchant-1";
    private static final CreateMerchantRequest REQUEST = new CreateMerchantRequest(
            "TechnoMart", null, "+77000000000", "shop@example.com", "Алматы");

    private MerchantRepository merchants;
    private MerchantService service;

    @BeforeEach
    void setUp() {
        merchants = mock(MerchantRepository.class);
        service = new MerchantService(merchants);
    }

    @Test
    void registersAnActiveProfileAndFallsBackToTheLegalName() {
        when(merchants.existsByOwnerUserId(OWNER)).thenReturn(false);
        when(merchants.saveAndFlush(any(Merchant.class))).thenAnswer(call -> call.getArgument(0));

        MerchantResponse response = service.createProfile(OWNER, REQUEST);

        assertThat(response.id()).hasSize(26);
        assertThat(response.ownerUserId()).isEqualTo(OWNER);
        assertThat(response.displayName()).isEqualTo("TechnoMart");
        assertThat(response.status()).isEqualTo(MerchantStatus.ACTIVE);
        assertThat(response.ratingBasisPoints()).isZero();
        assertThat(response.city()).isEqualTo("Алматы");
    }

    @Test
    void aSecondProfileForTheSameUserIsAConflict() {
        when(merchants.existsByOwnerUserId(OWNER)).thenReturn(true);

        assertThatThrownBy(() -> service.createProfile(OWNER, REQUEST))
                .isInstanceOfSatisfying(DomainException.class, failure -> {
                    assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.MERCHANT_ALREADY_EXISTS);
                    assertThat(failure.errorCode().httpStatus()).isEqualTo(409);
                });
        verify(merchants, never()).saveAndFlush(any(Merchant.class));
    }

    @Test
    void theUniqueIndexIsTheFinalArbiterOfTheRace() {
        when(merchants.existsByOwnerUserId(OWNER)).thenReturn(false);
        when(merchants.saveAndFlush(any(Merchant.class)))
                .thenThrow(new DataIntegrityViolationException("uq_merchant_owner"));

        assertThatThrownBy(() -> service.createProfile(OWNER, REQUEST))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CatalogErrorCode.MERCHANT_ALREADY_EXISTS));
    }

    @Test
    void aCallerWithoutAProfileGetsNotFound() {
        when(merchants.findByOwnerUserId(OWNER)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getOwnProfile(OWNER))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CatalogErrorCode.MERCHANT_NOT_FOUND));
    }

    @Test
    void ownProfileIsReturnedWithContactDetails() {
        Merchant merchant = Merchant.register(OWNER, "TechnoMart", "TechnoMart Store",
                "+77000000000", "shop@example.com", "Алматы");
        when(merchants.findByOwnerUserId(OWNER)).thenReturn(Optional.of(merchant));

        MerchantResponse response = service.getOwnProfile(OWNER);

        assertThat(response.phone()).isEqualTo("+77000000000");
        assertThat(response.email()).isEqualTo("shop@example.com");
        assertThat(response.displayName()).isEqualTo("TechnoMart Store");
    }
}
