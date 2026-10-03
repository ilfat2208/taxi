/**
 * transport-10 — ORTA Auto, диагностика и смета работ.
 *
 * Единственное правило, которое здесь важно: отчёт мастера сам по себе ничего не
 * списывает — работы согласуются отдельным действием, и только после этого
 * ставится резерв на подтверждённую сумму. Коды ошибок и суммы — пример.
 */
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';
import { cx } from '../../lib/cx';

const CODES: Array<{ code: string; title: string; hint: string; severity: 'error' | 'warn' }> = [
  { code: 'P0171', title: 'Бедная топливная смесь, банк 1', hint: 'датчик кислорода до катализатора', severity: 'error' },
  { code: 'P0300', title: 'Пропуски зажигания', hint: 'свечи или катушка, 3-й цилиндр', severity: 'warn' },
];

const WORKS: Array<{ label: string; minor: number }> = [
  { label: 'Датчик кислорода, замена', minor: 1_450_000 },
  { label: 'Свечи, комплект 4 шт.', minor: 720_000 },
  { label: 'Чистка форсунок', minor: 900_000 },
];

const WORKS_TOTAL = WORKS.reduce((sum, work) => sum + work.minor, 0);

export default function Transport10() {
  return (
    <>
      <PhoneAppBar
        title="Диагностика"
        subtitle="Отчёт мастера · заказ-наряд D-4471"
        right={<span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600">2 окт, 12:50</span>}
      />
      <PhoneBody>
        <PhoneCard>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-gradient-to-br from-ink-700 to-ink-900 text-[13px] font-semibold text-white">
              T
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink-900">Toyota Camry 2.5 · 727 ABC 02</span>
              <span className="block truncate text-[11.5px] text-ink-500">пробег 84 200 км · демо-данные</span>
            </span>
          </div>
        </PhoneCard>

        <Notice tone="warning">
          <b>Найдено две ошибки.</b> Мастер проехал 4 км, коды считаны дважды — до и после сброса.
        </Notice>

        <PhoneCard title="Коды ошибок">
          {CODES.map((item) => (
            <div key={item.code} className="flex items-center gap-3 py-1">
              <span
                className={cx(
                  'flex-none rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold',
                  item.severity === 'error' ? 'bg-brand-50 text-brand-700' : 'bg-warning-50 text-warning-700',
                )}
              >
                {item.code}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-ink-900">{item.title}</span>
                <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
              </span>
            </div>
          ))}
        </PhoneCard>

        <PhoneCard title="Рекомендованные работы" right={<span className="text-[11px] text-ink-500">смета мастера</span>}>
          {WORKS.map((work) => (
            <Row key={work.label} label={work.label} value={<Money minor={work.minor} />} />
          ))}
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-ink-100 pt-2">
            <span className="text-[11.5px] text-ink-500">Итого по смете</span>
            <Money minor={WORKS_TOTAL} />
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>Без подтверждения работы не начинаются.</b> Смета согласуется в приложении: деньги резервируются
          на подтверждённую сумму, а не «как получится». Заказ-нарядов и справочника кодов ошибок в коде нет —
          P0171, P0300 и суммы демонстрационные.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Согласовать работы · 30 700 ₸
        </div>
      </PhoneBody>
    </>
  );
}
