/**
 * home-food-21 · ORTA Rent — выдача вещи и акт состояния.
 *
 * Что на экране: код выдачи, чек-лист комплекта, место и время выдачи, фото состояния
 * при выдаче, срок возврата и залог с просрочкой.
 *
 * Честно: QR и фотографии — плейсхолдеры. Генератора QR в приложении нет, поэтому на
 * экране код, который сотрудник пункта вводит вручную, а загрузки медиа в ORTA ID нет —
 * адресов и платёжных методов там тоже нет. Снимки состояния на экране не из хранилища.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const CHECKLIST = [
  'Перфоратор в кейсе, без внешних повреждений',
  'Три бура SDS-plus и ключ на месте',
  'Удостоверение и подпись акта — подтверждает сотрудник пункта',
];

const SHOTS = ['корпус · плейсхолдер', 'патрон · плейсхолдер', 'кейс · плейсхолдер'];

export default function HomeFood21() {
  return (
    <>
      <PhoneAppBar title="Выдача вещи" subtitle="RNT-261003-2M8K · Перфоратор Bosch GBH 2-26" />
      <PhoneBody>
        <PhoneCard title="Код выдачи" right={<Badge tone="success">Оплачено</Badge>}>
          <div className="flex gap-2.5">
            <Placeholder
              label="QR — плейсхолдер"
              className="wrap-anywhere h-[56px] w-[64px] flex-none text-center text-[10px]! leading-tight"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-ink-900">Покажите код на пункте выдачи</div>
              <div className="text-[11px] text-ink-500">Тауке хана, 83 · сегодня 10:00–20:00</div>
              <div className="mt-1 font-mono text-[11.5px] text-ink-900">RNT-261003-2M8K-0417</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-ink-500">
            QR — плейсхолдер: генератора QR в приложении нет, код вводится вручную
          </div>
        </PhoneCard>

        <PhoneCard title="Чек-лист при выдаче">
          <div className="space-y-1">
            {CHECKLIST.map((item) => (
              <div key={item} className="flex gap-2 text-[12px] text-ink-700">
                <span className="text-ink-400">•</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </PhoneCard>

        <div>
          <div className="text-[13px] font-semibold text-ink-800">Фото состояния при выдаче</div>
          <div className="mt-2 flex gap-2">
            {SHOTS.map((shot) => (
              <Placeholder
                key={shot}
                label={shot}
                className="wrap-anywhere h-[48px] flex-1 px-1 text-center leading-tight"
              />
            ))}
          </div>
        </div>

        <Notice tone="warning">
          Фото и акт — единственное доказательство состояния. Загрузка фотографий в ORTA ID не сделана
          (адресов и платёжных методов там тоже нет), поэтому снимки на экране — плейсхолдеры, а не снимки
          из хранилища.
        </Notice>

        <PhoneCard>
          <Row label="Вернуть до" value="6 октября, 10:00" />
          <Row label="Залог · просрочка 1 900 ₸/сутки" value={<Money minor={3_000_000} />} strong />
        </PhoneCard>

        <div className="rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-center text-[13px] font-semibold text-ink-700">
          Сообщить о повреждении при выдаче
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Rent" />
    </>
  );
}
