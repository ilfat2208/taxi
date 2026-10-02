package kz.taxi.qtime.domain;

/**
 * What a company sells, in the vocabulary of the ORTA verticals.
 *
 * <p>Coarse on purpose: this is a search filter, not a taxonomy. "Маникюр" versus
 * "педикюр" is a {@link ServiceItem}, and pushing every vertical's own catalogue
 * into this enum would end with one category tree per vertical inside a shared
 * service — which is exactly the duplication QTime exists to prevent.
 */
public enum CompanyCategory {

    /** Салоны красоты: маникюр, косметология, массаж. */
    BEAUTY,
    /** Барбершопы: стрижка, борода, бритьё. */
    BARBERSHOP,
    /** СТО, автомойки, шиномонтаж, детейлинг. */
    AUTO,
    /** Клиники, стоматологии, лаборатории, диагностика. */
    HEALTH,
    /** Универсальные специалисты: сантехник, электрик, клининг, репетитор. */
    SERVICES
}
