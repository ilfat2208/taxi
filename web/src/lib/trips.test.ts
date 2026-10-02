import { describe, expect, it } from 'vitest';
import {
  TARIFF_OPTIONS,
  TRIP_ACTIVE_STATUSES,
  TRIP_CANCELLABLE_STATUSES,
  actorLabel,
  commissionBpLabel,
  commissionShare,
  surgeLabel,
  tariffLabel,
  tripStageHint,
  tripStatusLabel,
  tripStatusTone,
} from './trips';

/** Taxi vocabulary: labels, tones and the "no ETA, explain the stage" copy. */
describe('trip vocabulary', () => {
  it('labels every status of the contract in Russian', () => {
    expect(tripStatusLabel('SEARCHING')).toBe('Ищем водителя');
    expect(tripStatusLabel('ASSIGNED')).toBe('Водитель назначен');
    expect(tripStatusLabel('ARRIVED')).toBe('Водитель на месте');
    expect(tripStatusLabel('IN_PROGRESS')).toBe('В поездке');
    expect(tripStatusLabel('COMPLETED')).toBe('Поездка завершена');
    expect(tripStatusLabel('CANCELLED_BY_RIDER')).toBe('Отменена вами');
    expect(tripStatusLabel('CANCELLED_BY_DRIVER')).toBe('Отменена водителем');
    expect(tripStatusLabel('NO_DRIVERS_FOUND')).toBe('Свободных машин рядом нет');
    // An unknown status is shown as it came, never silently mapped to something else.
    expect(tripStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(tripStatusLabel(null)).toBe('—');
  });

  it('tones the states so a finished ride never looks like a failure', () => {
    expect(tripStatusTone('COMPLETED')).toBe('success');
    expect(tripStatusTone('NO_DRIVERS_FOUND')).toBe('danger');
    expect(tripStatusTone('SEARCHING')).toBe('warning');
    expect(tripStatusTone('CANCELLED_BY_RIDER')).toBe('neutral');
  });

  it('never promises minutes it does not have', () => {
    for (const status of ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'] as const) {
      const hint = tripStageHint(status);
      expect(hint).not.toBeNull();
      // No "через 3 мин"-style countdown, no invented ETA.
      expect(hint ?? '').not.toMatch(/\d+\s*(мин|минут)/i);
    }
    expect(tripStageHint('SEARCHING')).toMatch(/точное время подачи/i);
    expect(tripStageHint('ASSIGNED')).toMatch(/не показываем/i);
    expect(tripStageHint('NO_DRIVERS_FOUND')).toMatch(/не списаны/i);
    expect(tripStageHint('COMPLETED')).toBeNull();
  });

  it('keeps the status sets the UI acts on', () => {
    expect(TRIP_ACTIVE_STATUSES).toContain('SEARCHING');
    expect(TRIP_ACTIVE_STATUSES).not.toContain('COMPLETED');
    expect(TRIP_CANCELLABLE_STATUSES).toEqual(['SEARCHING', 'ASSIGNED', 'ARRIVED']);
    expect(TARIFF_OPTIONS.map((option) => option.value)).toEqual(['ECONOMY', 'COMFORT']);
    expect(tariffLabel('ECONOMY')).toBe('Эконом');
    expect(tariffLabel('COMFORT')).toBe('Комфорт');
  });

  it('names the actor of a timeline step and survives an unknown one', () => {
    expect(actorLabel('RIDER')).toBe('пассажир');
    expect(actorLabel('DRIVER')).toBe('водитель');
    expect(actorLabel('SYSTEM')).toBe('сервис');
    expect(actorLabel('OPERATOR')).toBe('OPERATOR');
    expect(actorLabel(null)).toBeNull();
    expect(actorLabel('')).toBeNull();
  });

  it('shows a surge multiplier only when there is a surge', () => {
    expect(surgeLabel(1500)).toBe('×1,15');
    expect(surgeLabel(0)).toBeNull();
    expect(surgeLabel(null)).toBeNull();
    expect(surgeLabel(undefined)).toBeNull();
  });

  it('computes the commission share only from both numbers', () => {
    expect(commissionShare({ commissionMinor: 22_176, priceMinor: 184_800 })).toBe('12%');
    expect(commissionShare({ commissionMinor: null, priceMinor: 184_800 })).toBeNull();
    expect(commissionShare({ commissionMinor: 22_176, priceMinor: 0 })).toBeNull();
  });

  it('reads the commission percentage from basis points', () => {
    expect(commissionBpLabel(1200)).toBe('12%');
    expect(commissionBpLabel(1250)).toBe('12,5%');
    expect(commissionBpLabel(0)).toBe('0%');
    expect(commissionBpLabel(null)).toBeNull();
    expect(commissionBpLabel(undefined)).toBeNull();
  });
});
