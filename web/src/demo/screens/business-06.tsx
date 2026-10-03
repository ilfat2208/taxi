/**
 * ORTA Business · Товар — цена, остаток, склад.
 *
 * Статус на борде «Работает»: GET /api/v1/catalog/products/{id} отдаёт товар с
 * остатком, правка цены и остатка — PATCH с дельтой stockDelta и причиной
 * stockReason, поэтому две одновременные правки складываются, а не затирают друг
 * друга.
 *
 * Две плашки внизу честно разделяют сделанное и запланированное: резерв стока в
 * коде есть, но он внутренний, а склада как модуля (приёмка, списание,
 * перемещения, инвентаризация) нет — движения остатка показывают будущий экран.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { ConsolePanel, ConsoleTable, Money, Notice, Row } from '../kit';

/**
 * Движения остатка: три колонки, а не четыре — «основание» и автор идут одной
 * строкой, иначе причина обрезалась в узкой колонке.
 */
const MOVES = [
  { date: '28.09, 11:02', delta: '+10 шт', positive: true, reason: 'Поставка, накладная 4471 · Ержан С.' },
  { date: '03.10, 18:12', delta: '−1 шт', positive: false, reason: 'Продажа ORD-241003-8F3K · система' },
  { date: '02.10, 20:15', delta: '−2 шт', positive: false, reason: 'Продажа ORD-241002-4A9P · система' },
  { date: '02.10, 09:40', delta: '+2 шт', positive: true, reason: 'Возврат, товар на месте · Ержан С.' },
  { date: '01.10, 15:18', delta: '−1 шт', positive: false, reason: 'Продажа ORD-241001-1X4U · система' },
];

export default function Business06() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[16px] font-bold text-ink-900">Смартфон Samsung Galaxy A55 128GB</span>
            <Badge tone="success">ACTIVE</Badge>
          </div>
          <div className="truncate text-[12px] text-ink-500">
            SM-A556-128-BLK · Электроника · создан 12.09.2026 · обновлён 03.10, 16:20
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">
            Снять с публикации
          </span>
          <span className="rounded-full bg-brand-500 px-3.5 py-1.5 text-[12px] font-medium text-white">Сохранить</span>
        </div>
      </div>

      <div className="flex flex-none gap-3">
        <ConsolePanel title="Цена и остаток" className="flex-1">
          <Row label="Цена, KZT" value={<Money minor={18999000} />} strong />
          <Row label="Остаток на точке" value="12 шт" />
          <Row label="Резерв по заказам" value="3 шт" />
          <Row label="Доступно к продаже" value="9 шт" />
          <p className="mt-2 text-[11px] text-ink-500">
            Цена — в минорных единицах, валюта приходит с товаром. Остаток меняется дельтой (<code>stockDelta</code> +
            причина <code>stockReason</code>): две одновременные правки складываются, а не перезаписывают друг друга.
          </p>
        </ConsolePanel>

        <ConsolePanel title="Склад" className="w-[340px] flex-none">
          <Row label="Остаток на начало периода" value="4 шт" />
          <Row label="Остаток сейчас" value="12 шт" strong />
          <Row label="Резерв по заказам" value="3 шт" />
          <Row label="Доступно к продаже" value="9 шт" />
          <Row label="Минимальный остаток" value="5 шт" />
          <Row label="Ячейка хранения" value={<span className="text-ink-400">не задана</span>} />
          <Row label="Последняя инвентаризация" value="12.09.2026" />
        </ConsolePanel>
      </div>

      <ConsolePanel
        title="Движения остатка"
        right={<span className="text-[11px] text-ink-400">история склада — предложение, в коде её нет</span>}
      >
        <ConsoleTable
          columns={['Дата', 'Движение', 'Основание и автор']}
          rows={MOVES.map((move) => [
            <span key="d" className="text-ink-500">{move.date}</span>,
            <span key="v" className={cx('font-semibold tabular-nums', move.positive ? 'text-success-700' : 'text-brand-700')}>
              {move.delta}
            </span>,
            move.reason,
          ])}
        />
      </ConsolePanel>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex-1">
          <Notice tone="info">
            Резерв стока в коде есть: reserve → commit при оплате, release при отмене. Но наружу, в кабинет, он не
            выведен.
          </Notice>
        </div>

        <div className="flex-1">
          <Notice tone="warning">
            Склада как модуля ещё нет: приёмка, списание, перемещения и инвентаризация — план.
          </Notice>
        </div>
      </div>
    </div>
  );
}
