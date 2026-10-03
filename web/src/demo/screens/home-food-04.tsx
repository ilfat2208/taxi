/**
 * home-food-04 · ORTA Home — проверка собственности и обременений.
 *
 * Что на экране: что удалось сверить по объекту, список запрошенных документов,
 * быстрые запросы и кнопка запроса выписки.
 *
 * Честно: интеграции с государственным реестром нет и в проекте она не описана.
 * Показанное — то, что заявило агентство, и это заявка на документы, а не юридическая
 * гарантия; поэтому на экране стоит красная плашка, а не зелёная галочка «проверено».
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const FINDINGS: Array<{ label: string; value: string }> = [
  { label: 'Обременения', value: 'не найдены' },
  { label: 'Аресты и запреты', value: 'нет сведений' },
  { label: 'Залог в пользу банка', value: 'не найден' },
  { label: 'Зарегистрированные лица', value: '2 · собственник и супруг' },
];

const DOCUMENTS = [
  { title: 'Выписка о правах на объект', sub: 'запрошена 2 октября · ждём ответа', state: 'в работе' },
  { title: 'Справка об отсутствии долга', sub: 'не запрошена', state: 'нет' },
];

export default function HomeFood04() {
  return (
    <>
      <PhoneAppBar title="Проверка объекта" subtitle="ID 01M7HM4K2Q · ул. Тауке хана, 83" back />
      <PhoneBody>
        <PhoneCard>
          <div className="flex items-center gap-2.5 pb-1">
            <Placeholder
              label="штамп — плейсхолдер"
              className="wrap-anywhere h-[44px] w-[64px] flex-none text-center text-[10px]! leading-tight"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink-900">Собственник совпадает</div>
              <div className="text-[11.5px] text-ink-500">Данные предоставило агентство, не реестр</div>
            </div>
            <Badge tone="success">совпадает</Badge>
          </div>
          {FINDINGS.map((item) => (
            <Row key={item.label} label={item.label} value={item.value} />
          ))}
        </PhoneCard>

        <Notice tone="danger">
          Это не выписка из реестра: интеграции с государственным реестром нет и в проекте она не описана.
          Показываем то, что заявило агентство, и называем это заявкой на документы, а не юридической гарантией.
        </Notice>

        <PhoneCard title="Документы">
          <div className="space-y-2">
            {DOCUMENTS.map((doc) => (
              <div key={doc.title} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] text-ink-800">{doc.title}</div>
                  <div className="truncate text-[11.5px] text-ink-500">{doc.sub}</div>
                </div>
                <Badge tone={doc.state === 'в работе' ? 'warning' : 'neutral'}>{doc.state}</Badge>
              </div>
            ))}
          </div>
        </PhoneCard>

        <div className="flex flex-wrap gap-2">
          {['История переходов прав', 'Залог и ипотека', 'Перепланировки'].map((query) => (
            <Badge key={query} tone="neutral">
              {query}
            </Badge>
          ))}
        </div>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          Запросить выписку
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-center text-[13px] font-semibold text-ink-700">
          Пожаловаться на объявление
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Home" />
    </>
  );
}
