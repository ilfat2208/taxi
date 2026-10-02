import type { QtimeSlot } from '../../api/types';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { cx } from '../../lib/cx';
import { CITY_TIME_LABEL, cityTime, type BookingDay } from '../../lib/cityTime';

/**
 * Date strip and slot grid.
 *
 * The grid is the QTime answer rendered as it comes: a window the service marked
 * `available: false` stays visible (a rider needs to see that the day is filling
 * up) but is not selectable, and it says «занято». Its `reason`, when the service
 * sends one, is exposed as a tooltip rather than translated — the codes are not
 * part of a frozen contract yet.
 */

export interface DateStripProps {
  days: BookingDay[];
  selected: string;
  onSelect: (dayKey: string) => void;
}

export function DateStrip({ days, selected, onSelect }: DateStripProps) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-ink-700">
        Дата визита · {CITY_TIME_LABEL} · 14 дней вперёд
      </p>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Дата визита">
        {days.map((day) => (
          <button
            key={day.key}
            type="button"
            aria-pressed={selected === day.key}
            onClick={() => onSelect(day.key)}
            className={cx(
              'shrink-0 rounded-xl px-3 py-2 text-center text-xs font-medium ring-1 ring-inset transition-colors',
              selected === day.key
                ? 'bg-brand-500 text-white ring-brand-500'
                : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-100',
            )}
          >
            <span className="block">{day.isToday ? 'сегодня' : day.weekday}</span>
            <span className="tnum block">{day.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface SlotGridProps {
  slots: QtimeSlot[];
  selectedStartsAt: string | null;
  onSelect: (slot: QtimeSlot) => void;
  isPending: boolean;
  isError: boolean;
  /** True when a specialist and a service are both chosen. */
  ready: boolean;
}

export function SlotGrid({
  slots,
  selectedStartsAt,
  onSelect,
  isPending,
  isError,
  ready,
}: SlotGridProps) {
  if (!ready) {
    return (
      <EmptyState
        title="Выберите специалиста и услугу"
        description="Свободное окно принадлежит паре «специалист + услуга»: длительность услуги решает, сколько окон влезает в день."
      />
    );
  }

  if (isPending) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="status" aria-label="Загружаем окна">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return null;
  }

  if (slots.length === 0) {
    return (
      <EmptyState
        title="Нет свободных окон на эту дату"
        description="Попробуйте другую дату или другого специалиста — расписание приходит из QTime."
      />
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="slot-grid">
      {slots.map((slot) => {
        const time = cityTime(slot.startsAt);
        const selected = selectedStartsAt === slot.startsAt;
        // The service writes the reason for a person («занято», «перерыв»), so the
        // cell shows its wording; «занято» is the fallback when it sent none.
        const reason = slot.reason?.trim() ? slot.reason : 'занято';
        return (
          <button
            key={slot.startsAt}
            type="button"
            disabled={!slot.available}
            aria-pressed={slot.available ? selected : undefined}
            title={slot.available ? undefined : reason}
            onClick={() => onSelect(slot)}
            className={cx(
              'rounded-xl px-2 py-2 text-center text-sm ring-1 ring-inset transition-colors',
              slot.available
                ? selected
                  ? 'bg-brand-500 text-white ring-brand-500'
                  : 'bg-white text-ink-900 ring-ink-200 hover:bg-ink-100'
                : 'cursor-not-allowed bg-ink-100 text-ink-400 ring-ink-200',
            )}
          >
            <span className="tnum block">{time}</span>
            {!slot.available ? <span className="block text-[11px]">{reason}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
