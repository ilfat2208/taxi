/**
 * apps-13 · Подтверждение вручения: фото и подпись (ORTA Delivery).
 *
 * Статус борда — «План»: ни хранилища файлов, ни ручки в API нет. Доставка в
 * order-service не смоделирована: там DRAFT → PAID → CONFIRMED, статуса
 * «доставлено» нет. Предлагаемая ручка —
 * POST /api/v1/couriers/me/tasks/{id}/proof (фото, подпись, координаты, время),
 * событие task.delivered.
 *
 * Честность экрана: фото и подпись нарисованы заглушками — внешних картинок и
 * загрузки файлов здесь нет, и в API их тоже нет. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, Placeholder } from '../kit';

export default function Apps13() {
  return (
    <>
      <PhoneAppBar
        title="Вручение D-4822"
        subtitle="ул. Байтурсынова, 42, кв. 15 · демо"
        back
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Фото вручения
        </div>
        <div className="flex shrink-0 gap-2.5">
          <Placeholder label="фото: дверь и пакеты · заглушка" className="h-[104px] flex-1 text-center" />
          <div className="grid h-[104px] w-[104px] flex-none place-items-center rounded-xl border-[1.5px] border-dashed border-ink-300 text-[22px] text-ink-400">
            +
          </div>
        </div>
        <div className="shrink-0 text-[11px] text-ink-400">
          Плашка — не снимок: внешних ресурсов в демо-разделе нет, а хранилища файлов нет и в API.
        </div>

        <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Подпись получателя
        </div>
        <PhoneCard className="shrink-0">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-ink-500">Айгуль С. · 15:22</span>
            <Badge tone="neutral">подпись демо</Badge>
          </div>
          <div className="mt-2 flex h-[52px] items-end gap-3 px-1">
            <span className="h-0 w-16 -rotate-6 border-t-2 border-ink-700" />
            <span className="h-0 w-10 rotate-3 border-t-2 border-ink-700" />
            <span className="h-4 w-12 -rotate-3 border-t-2 border-ink-700" />
            <span className="h-0 w-14 rotate-6 border-t-2 border-ink-700" />
          </div>
          <div className="mt-1 border-t border-dashed border-ink-300 pt-1 text-[10.5px] text-ink-400">
            линия подписи · получена на экране курьера
          </div>
        </PhoneCard>

        <Notice tone="danger">
          <b>Фото и подпись в API не поддержаны.</b> Хранилища файлов нет, доставка в order-service не
          смоделирована (DRAFT → PAID → CONFIRMED — статуса «доставлено» нет). Предлагаемая ручка —
          <span className="font-mono"> POST /api/v1/couriers/me/tasks/{'{id}'}/proof</span>.
        </Notice>

        <div className="flex shrink-0 flex-col gap-2">
          <div className="rounded-xl bg-[#0F6E8C] px-3 py-2.5 text-center text-[13px] font-semibold text-white">
            Подтвердить вручение
          </div>
          <div className="rounded-xl px-3 py-2 text-center text-[12.5px] text-ink-500">Получатель отказался</div>
        </div>
      </PhoneBody>
    </>
  );
}
