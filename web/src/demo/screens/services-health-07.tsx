/**
 * ORTA Services — мои записи (Ф2: раздел работает).
 *
 * `/services/bookings` читает `GET /api/v1/qtime/bookings?status=&page=&size=`;
 * доступ у владельца, `SUPPORT` и `ADMIN`. В строке видны дата, длительность,
 * компания, специалист, услуга, код, адрес и цена.
 *
 * Статусы записи из базы: `CONFIRMED`, `CANCELLED_BY_CLIENT`, `CANCELLED_BY_COMPANY`,
 * `COMPLETED`, `NO_SHOW`. Список статусов в фильтре веб собирает из уже полученных
 * записей — справочника статусов у сервиса нет, и это подписано.
 *
 * Чего ещё нет: отдельного эндпоинта переноса (кнопка «Перенести» — это отмена плюс
 * новая запись, см. экран 08); «Повторить» — композиция на клиенте, серверной
 * операции «записаться снова» нет.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard } from '../kit';

const BOOKINGS: Array<{
  when: string;
  company: string;
  code: string | null;
  status: string;
  statusTone: 'success' | 'neutral' | 'danger';
  priceMinor: number;
  actions?: string[];
}> = [
  {
    when: 'пт, 3 октября, 15:30 · 1 ч 30 мин',
    company: 'Салон «Лотос» · Айгуль · маникюр с покрытием',
    code: 'QT-4F8A2C31',
    status: 'CONFIRMED',
    statusTone: 'success',
    priceMinor: 450_000,
    actions: ['Перенести', 'Показать код', 'Отменить'],
  },
  {
    when: 'пт, 10 октября, 11:30 · 45 мин',
    company: '«Король Бороды» · Ерлан · мужская стрижка · «машинка 2 мм»',
    code: 'QT-9C1E77B4',
    status: 'CONFIRMED',
    statusTone: 'success',
    priceMinor: 450_000,
  },
  {
    when: 'вт, 23 сентября, 14:00 · 60 мин',
    company: '«Дентал Плюс» · Айнур Бекова · лечение кариеса',
    code: null,
    status: 'COMPLETED',
    statusTone: 'neutral',
    priceMinor: 1_800_000,
  },
  {
    when: 'ср, 17 сентября, 18:00 · 45 мин',
    company: '«Мотор-Сервис» · Серик · замена масла · причина отмены: «не смогу прийти»',
    code: null,
    status: 'CANCELLED',
    statusTone: 'danger',
    priceMinor: 1_200_000,
  },
];

export default function ServicesHealth07() {
  return (
    <>
      <PhoneAppBar title="Моих записей: 4" subtitle="QTime · свои записи и история визитов" back />
      <PhoneBody>
        <div className="flex gap-1 rounded-xl bg-ink-100 p-1">
          {['Все', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].map((filter) => (
            <span
              key={filter}
              className={
                filter === 'Все'
                  ? 'flex-1 rounded-lg bg-white py-1.5 text-center text-[11px] font-semibold text-ink-900 shadow-sm'
                  : 'flex-1 truncate py-1.5 text-center text-[11px] text-ink-500'
              }
            >
              {filter}
            </span>
          ))}
        </div>

        {BOOKINGS.map((booking) => (
          <PhoneCard key={booking.when}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold tabular-nums text-ink-900">{booking.when}</div>
                <div className="text-[11.5px] text-ink-500">{booking.company}</div>
                {booking.code ? (
                  <div className="text-[11.5px] text-ink-500">
                    Код <span className="font-mono">{booking.code}</span>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-none flex-col items-end gap-1">
                <Badge tone={booking.statusTone}>{booking.status}</Badge>
                <Money minor={booking.priceMinor} />
              </div>
            </div>
            {booking.actions ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {booking.actions.map((action) => (
                  <span
                    key={action}
                    className={
                      action === 'Перенести'
                        ? 'rounded-full bg-brand-500 px-3 py-1.5 text-[11.5px] text-white'
                        : 'rounded-full bg-ink-100 px-3 py-1.5 text-[11.5px] text-ink-600'
                    }
                  >
                    {action}
                  </span>
                ))}
              </div>
            ) : null}
          </PhoneCard>
        ))}

        <Notice tone="info">
          <b>Фильтр статусов собран на клиенте.</b> Справочника статусов у сервиса нет — веб строит список из
          уже полученных записей. Перенос отдельным эндпоинтом не поддержан, «Показать код» QR не рисует.
        </Notice>

        <div className="mt-auto rounded-xl bg-white py-2.5 text-center text-[13px] font-medium text-ink-700 ring-1 ring-inset ring-ink-200">
          Показать ещё
        </div>
      </PhoneBody>
    </>
  );
}
