/**
 * platform-02 · ORTA ID — устройства, сессии, смена телефона (телефон, план).
 *
 * Макет: ни хранения устройств, ни отзыва токена, ни смены номера в коде нет. Ключевое решение
 * на экране — смена номера подтверждается кодами с обоих номеров и отзывает все выданные токены:
 * номер в ORTA одновременно логин и адрес перевода по телефону, поэтому «угон SIM» здесь означает
 * «угон денег». Это решение зафиксировано в тексте, а не спрятано в настройке.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

const SESSIONS: Array<{ device: string; place: string; current?: boolean }> = [
  { device: 'Pixel 7 · Android', place: 'сейчас', current: true },
  { device: 'Chrome · Windows', place: 'Шымкент · 21:14' },
  { device: 'iPhone 12', place: 'Алматы · 7 октября' },
];

export default function Platform02Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Вход и безопасность"
        subtitle="Устройства, сессии, смена телефона"
        right={<Badge tone="neutral">план</Badge>}
      />
      <PhoneBody>
        <Notice tone="info">
          <b>Этого раздела в коде ещё нет.</b> Токен живёт до истечения срока и не отзывается:
          ни списка сессий, ни смены номера в API нет.
        </Notice>

        <PhoneCard title="Активные сессии" right={<Badge tone="neutral">демо</Badge>}>
          <div className="divide-y divide-ink-50">
            {SESSIONS.map((session) => (
              <div key={session.device} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{session.device}</span>
                  <span className="block truncate text-[11px] text-ink-500">{session.place}</span>
                </span>
                {session.current ? (
                  <Badge tone="success">текущая</Badge>
                ) : (
                  <span className="text-[12px] font-medium text-brand-600">Завершить</span>
                )}
              </div>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard title="Смена номера телефона" right={<Badge tone="warning">с двух номеров</Badge>}>
          <Row label="Текущий номер" value="+7 700 123 45 67" />
          <Row label="Новый номер" value={<span className="text-ink-900">+7 701 000 00 00 →</span>} strong />
          <p className="mt-1 text-[11px] text-ink-500">
            Старый номер подтверждает отказ от аккаунта, новый — владение им.
          </p>
          <div className="mt-2">
            <Notice tone="neutral">
              <b>Почему одной SMS недостаточно.</b> Номер — это и логин, и адрес перевода: подтверждение
              только с нового номера превращает угон SIM в угон денег, поэтому меняются и все токены.
            </Notice>
          </div>
          <div className="mt-2 rounded-xl bg-ink-100 py-2.5 text-center text-[13px] font-medium text-ink-500">
            Подтвердить смену номера
          </div>
        </PhoneCard>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Профиль" />
    </>
  );
}
