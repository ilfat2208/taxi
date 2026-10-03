import { describe, expect, it } from 'vitest';
import {
  normalizeQtimeCompanyDetail,
  normalizeQtimeSlots,
  normalizeTrip,
  normalizeTripQuote,
  normalizeTripReceipt,
} from './endpoints';

/**
 * Normalizers of the taxi and QTime payloads.
 *
 * The samples below are copied from the DTOs the services actually answer with
 * (`TripDtos`, `QtimeDtos`), and the assertions are mostly about what must stay
 * `null`: an absent field has to reach the screen as "не пришло", never as a zero
 * the UI would print as a real amount.
 */

describe('trip payloads', () => {
  it('reads a quote as trip-service writes it', () => {
    const quote = normalizeTripQuote({
      quoteId: '01M3Y1AYYJGHVVY7NCZQ690MJF',
      tariff: 'COMFORT',
      distanceM: 6400,
      durationS: 1080,
      priceMinor: 184_800,
      currency: 'KZT',
      commissionBp: 1200,
      commissionMinor: 22_176,
      driverNetMinor: 162_624,
      surgeBp: 1500,
      breakdown: { baseMinor: 40_000, distanceMinor: 96_000, timeMinor: 48_800 },
      expiresAt: '2026-10-02T10:12:00Z',
    });

    expect(quote.quoteId).toContain('01M3Y1');
    expect(quote.priceMinor).toBe(184_800);
    expect(quote.commissionBp).toBe(1200);
    expect(quote.surgeBp).toBe(1500);
    expect(quote.breakdown.baseMinor).toBe(40_000);
    expect(quote.expiresAt).toBe('2026-10-02T10:12:00Z');
  });

  it('keeps absent trip fields absent', () => {
    const trip = normalizeTrip({
      tripId: 'trip-1',
      tripNumber: 'T-101',
      status: 'SEARCHING',
      tariff: 'ECONOMY',
      currency: 'KZT',
      timeline: [],
    });

    expect(trip.driverName).toBeNull();
    expect(trip.vehiclePlate).toBeNull();
    expect(trip.priceMinor).toBeNull();
    expect(trip.commissionMinor).toBeNull();
    expect(trip.distanceM).toBeNull();
    expect(trip.ratingStars).toBeNull();
    expect(trip.receipt).toBeNull();
    expect(trip.pickup).toBeNull();
  });

  it('reads the receipt and its ledger reference', () => {
    const receipt = normalizeTripReceipt({
      tripId: 'trip-1',
      tripNumber: 'T-101',
      status: 'COMPLETED',
      completedAt: '2026-10-02T10:42:11Z',
      tariff: 'COMFORT',
      breakdown: { baseMinor: 40_000, distanceMinor: 96_000, timeMinor: 48_800 },
      surgeBp: 0,
      priceMinor: 184_800,
      commissionBp: 1200,
      commissionMinor: 22_176,
      driverNetMinor: 162_624,
      currency: 'KZT',
      driverDisplayName: 'Айдар Сериков',
      holdId: 'hold-1',
      paymentId: null,
      transactionId: '01M4TR7K9QW2',
    });

    expect(receipt?.priceMinor).toBe(184_800);
    expect(receipt?.completedAt).toBe('2026-10-02T10:42:11Z');
    expect(receipt?.commissionBp).toBe(1200);
    expect(receipt?.driverDisplayName).toBe('Айдар Сериков');
    // A wallet ride carries no payment order; the screen must not invent one.
    expect(receipt?.paymentId).toBeNull();
    expect(receipt?.transactionId).toBe('01M4TR7K9QW2');
  });

  it('refuses to call a receipt without a total a receipt', () => {
    expect(normalizeTripReceipt({ tripId: 'trip-1', currency: 'KZT' })).toBeNull();
    expect(normalizeTripReceipt(null)).toBeNull();
  });

  it('reads a receipt embedded in the trip view', () => {
    const trip = normalizeTrip({
      tripId: 'trip-1',
      tripNumber: 'T-101',
      status: 'COMPLETED',
      tariff: 'ECONOMY',
      currency: 'KZT',
      priceMinor: 132_600,
      timeline: [],
      receipt: { tripId: 'trip-1', priceMinor: 132_600, currency: 'KZT', transactionId: 'trx-1' },
    });

    expect(trip.receipt?.priceMinor).toBe(132_600);
    expect(trip.receipt?.transactionId).toBe('trx-1');
  });
});

describe('qtime payloads', () => {
  it('reads a company card, tolerating an absent price list and rating', () => {
    const detail = normalizeQtimeCompanyDetail({
      companyId: 'c-1',
      name: 'Салон «Лотос»',
      category: 'BEAUTY',
      city: 'Шымкент',
      address: 'ул. Байтурсынова, 12',
      lat: 42.315,
      lon: 69.59,
      ratingBp: 48000,
      reviewsCount: 312,
      timezone: 'Asia/Almaty',
      specialists: [
        { specialistId: 's-1', name: 'Айгуль', specialization: 'маникюр', ratingBp: 49000, experienceYears: 6 },
      ],
      services: [
        { serviceId: 'sv-1', name: 'Маникюр', durationMinutes: 90, priceMinor: 450_000, currency: 'KZT' },
      ],
    });

    expect(detail.name).toBe('Салон «Лотос»');
    expect(detail.ratingBp).toBe(48000);
    expect(detail.timezone).toBe('Asia/Almaty');
    expect(detail.specialists).toHaveLength(1);
    expect(detail.services[0]?.priceMinor).toBe(450_000);
    // The detail payload has no counters and no minimum price: not zeroes.
    expect(detail.specialistsCount).toBeNull();
    expect(detail.servicesCount).toBeNull();
    expect(detail.minPriceMinor).toBeNull();
  });

  it('keeps the reason of a taken window and flags a slot without a flag as taken', () => {
    const slots = normalizeQtimeSlots({
      date: '2026-10-02',
      specialistId: 's-1',
      serviceId: 'sv-1',
      durationMinutes: 90,
      timezone: 'Asia/Almaty',
      slots: [
        { startsAt: '2026-10-02T10:00:00Z', endsAt: '2026-10-02T11:30:00Z', available: false, reason: 'перерыв' },
        { startsAt: '2026-10-02T13:00:00Z', endsAt: '2026-10-02T14:30:00Z', available: true, reason: null },
        // No `available` at all: offering an unconfirmed window is worse than hiding it.
        { startsAt: '2026-10-02T15:30:00Z', endsAt: '2026-10-02T17:00:00Z' },
      ],
    });

    expect(slots.timezone).toBe('Asia/Almaty');
    expect(slots.durationMinutes).toBe(90);
    expect(slots.slots[0]).toMatchObject({ available: false, reason: 'перерыв' });
    expect(slots.slots[1]).toMatchObject({ available: true, reason: null });
    expect(slots.slots[2]?.available).toBe(false);
  });
});
