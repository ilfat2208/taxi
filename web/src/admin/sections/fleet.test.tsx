import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { adminSectionById, type AdminSection } from '../sections';
import FleetSection from './fleet';
import { createTestQueryClient, jsonResponse, problemResponse, stubFetch, type MockResponse } from '../../test/utils';

/**
 * Раздел «Парк и диспетчерская».
 *
 * Проверяется то, что требует ревью: цифры берутся из ответа сервиса (а не из
 * констант), свежесть позиции показывается честно, рейл статусов считает по
 * загруженному списку и подписан именно так, ошибка сервиса превращается в
 * `ErrorAlert`, пустой список — в `EmptyState`, а запрос ближайших уходит только по
 * кнопке и только с валидными координатами. Отдельно проверяется плотность разметки:
 * плитки помечены `data-admin-kpi`, крупные блоки — `data-admin-panel`, а элементов
 * `data-admin-write` в разделе нет вовсе, потому что менять тут нечего.
 */

const GENERATED_AT = '2026-10-02T10:00:00Z';

const FRESH = {
  driverId: 'DRV-1',
  displayName: 'Айбек Сериков',
  phone: '+77011112233',
  status: 'ONLINE',
  lat: 42.3155,
  lon: 69.5867,
  headingDeg: 45,
  speedKph: 32,
  ageSeconds: 3,
  stale: false,
};

const STALE_BUSY = {
  driverId: 'DRV-2',
  displayName: 'Данияр Оспанов',
  phone: '+77055556677',
  status: 'BUSY',
  lat: 42.3211,
  lon: 69.5901,
  headingDeg: 180,
  speedKph: 0,
  ageSeconds: 240,
  stale: true,
};

const NO_FIX = {
  driverId: 'DRV-3',
  displayName: 'Ерлан Ахметов',
  phone: '+77077778899',
  status: 'ONLINE',
  lat: null,
  lon: null,
  headingDeg: 0,
  speedKph: 0,
  ageSeconds: 0,
  stale: false,
};

function fleetPayload(drivers: unknown[]) {
  return {
    generatedAt: GENERATED_AT,
    staleAfterSeconds: 30,
    onDuty: drivers.length,
    withPosition: drivers.filter((driver) => (driver as { lat?: number | null }).lat !== null).length,
    drivers,
  };
}

const section = adminSectionById('fleet') as AdminSection;

function renderFleet(handler: (url: string) => MockResponse) {
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <FleetSection section={section} role="SUPPORT" canWrite={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

/** Плитка по подписи: иконка плитки текста не даёт, поэтому текст начинается с подписи. */
function kpi(label: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>('[data-admin-kpi]')).find((node) =>
    (node.textContent ?? '').trim().startsWith(label),
  );
  if (!found) {
    throw new Error(`нет плитки «${label}»`);
  }
  return found;
}

/**
 * Значение плитки берём отдельным элементом: в общем тексте плитки цифра неотличима
 * от чисел в подписи-пояснении.
 */
function kpiValue(label: string): string {
  const value = kpi(label).querySelector('.text-2xl');
  if (!value) {
    throw new Error(`у плитки «${label}» нет значения`);
  }
  return (value.textContent ?? '').trim();
}

describe('раздел «Парк и диспетчерская»', () => {
  it('считает плитки по ответу сервиса и показывает возраст самого старого отчёта', async () => {
    renderFleet(() => jsonResponse(fleetPayload([FRESH, STALE_BUSY, NO_FIX])));

    // Ждём строку таблицы, а не заголовок панели: заголовок рисуется и до ответа сервиса.
    await screen.findByText('Айбек Сериков');

    // На линии и с позицией — поля ответа сервиса.
    expect(kpiValue('На линии')).toBe('3');
    expect(kpiValue('С позицией')).toBe('2');

    // Занят один (BUSY), свободны двое (ONLINE) — цифры считаются по статусам из ответа.
    expect(kpiValue('Заняты')).toBe('1');
    expect(kpiValue('Свободны')).toBe('2');
    expect(kpiValue('В поездке')).toBe('0');
    expect(kpiValue('Не активно')).toBe('0');

    // Самый старый отчёт позиции — 240 с у второго водителя, ровно как в ответе.
    expect(kpiValue('Самый старый отчёт позиции')).toBe('4 мин');
    expect(kpiValue('Устаревших позиций')).toBe('1');

    // Свежесть позиции и её отсутствие показаны разными словами.
    expect(screen.getByText('4 мин назад')).toBeInTheDocument();
    expect(screen.getByText('3 с назад')).toBeInTheDocument();
    expect(screen.getByText('позиция ещё не приходила')).toBeInTheDocument();
    expect(screen.getByText('устарела')).toBeInTheDocument();
  });

  it('держит плотность разметки: плитки помечены data-admin-kpi, блоки — data-admin-panel', async () => {
    renderFleet(() => jsonResponse(fleetPayload([FRESH, STALE_BUSY])));

    await screen.findByText('Водители на линии');

    // Реестр разделов обещает 4 плитки и 3 блока; проверка `e2e/check-admin.mjs` считает
    // ровно эти атрибуты, поэтому их число фиксируем и здесь.
    expect(document.querySelectorAll('[data-admin-kpi]').length).toBeGreaterThanOrEqual(4);
    expect(document.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(3);
  });

  it('фильтрует загруженный список и честно говорит, что серверного поиска нет', async () => {
    renderFleet(() => jsonResponse(fleetPayload([FRESH, STALE_BUSY])));

    const filter = await screen.findByLabelText('Поиск по водителю');
    expect(screen.getByText('Айбек Сериков')).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'Данияр' } });

    await waitFor(() => {
      expect(screen.queryByText('Айбек Сериков')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Данияр Оспанов')).toBeInTheDocument();
    expect(screen.getByText('показано 1 из 2')).toBeInTheDocument();
    expect(screen.getByText(/у \/dispatch\/drivers нет параметра поиска/)).toBeInTheDocument();
  });

  it('рейл статусов фильтрует таблицу и подписан как клиентский', async () => {
    renderFleet(() => jsonResponse(fleetPayload([FRESH, STALE_BUSY, NO_FIX])));

    await screen.findByText('Айбек Сериков');

    // Числа рейла — по загруженному списку, а не от сервера: параметра статуса у ручки нет.
    const rail = screen.getByLabelText('Фильтр по статусу');
    expect(within(rail).getByRole('button', { name: /Все водители/ })).toHaveTextContent('3');
    expect(within(rail).getByRole('button', { name: /На линии/ })).toHaveTextContent('2');
    expect(within(rail).getByRole('button', { name: /На заказе/ })).toHaveTextContent('1');
    expect(within(rail).getByRole('button', { name: /Без позиции/ })).toHaveTextContent('1');
    expect(screen.getByText(/Числа — по загруженному списку/)).toBeInTheDocument();

    fireEvent.click(within(rail).getByRole('button', { name: /На заказе/ }));

    await waitFor(() => {
      expect(screen.queryByText('Айбек Сериков')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Данияр Оспанов')).toBeInTheDocument();
    expect(screen.queryByText('Ерлан Ахметов')).not.toBeInTheDocument();

    // Пункт «Без позиции» — про машины, у которых координат нет вовсе.
    fireEvent.click(within(rail).getByRole('button', { name: /Без позиции/ }));
    await waitFor(() => {
      expect(screen.getByText('Ерлан Ахметов')).toBeInTheDocument();
    });
    expect(screen.queryByText('Айбек Сериков')).not.toBeInTheDocument();
  });

  it('показывает EmptyState, когда на линии никого нет', async () => {
    renderFleet(() => jsonResponse(fleetPayload([])));

    expect(await screen.findByText('На линии никого нет')).toBeInTheDocument();
    expect(kpiValue('На линии')).toBe('0');
  });

  it('ошибку сервиса отдаёт в ErrorAlert с текстом, а не пустой таблицей', async () => {
    renderFleet(() =>
      problemResponse(
        {
          status: 503,
          code: 'SERVICE_UNAVAILABLE',
          title: 'Service Unavailable',
          detail: 'dispatch-service не отвечает',
        },
        503,
      ),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Сервис временно недоступен, попробуйте позже');
    expect(screen.getByText('Не удалось получить список водителей на линии')).toBeInTheDocument();
  });

  it('не трогает /dispatch/nearest, пока не нажали кнопку и пока координаты невалидны', async () => {
    const fetchMock = renderFleet((url) =>
      url.includes('/v1/dispatch/nearest')
        ? jsonResponse({ generatedAt: GENERATED_AT, radiusM: 3000, candidates: [] })
        : jsonResponse(fleetPayload([FRESH])),
    );
    const nearestCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/dispatch/nearest'));

    await screen.findByLabelText('Широта');
    expect(nearestCalls()).toHaveLength(0);

    // Некорректная широта: запрос не уходит, поле объясняет, что не так.
    fireEvent.change(screen.getByLabelText('Широта'), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти ближайших' }));

    expect(await screen.findByText('Допустимо от -90 до 90')).toBeInTheDocument();
    expect(nearestCalls()).toHaveLength(0);
  });

  it('ищет ближайших с координатами из полей и объясняет пустой результат', async () => {
    const fetchMock = renderFleet((url) =>
      url.includes('/v1/dispatch/nearest')
        ? jsonResponse({ generatedAt: GENERATED_AT, radiusM: 3000, candidates: [] })
        : jsonResponse(fleetPayload([FRESH])),
    );

    await screen.findByLabelText('Широта');
    fireEvent.click(screen.getByRole('button', { name: 'Найти ближайших' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/dispatch/nearest'))).toBe(true);
    });

    const nearestUrl = String(
      fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/dispatch/nearest'))?.[0],
    );
    expect(nearestUrl).toContain('lat=42.3155');
    expect(nearestUrl).toContain('lon=69.5867');
    expect(nearestUrl).toContain('radiusM=3000');
    expect(nearestUrl).toContain('limit=10');

    expect(await screen.findByText('Машин рядом нет')).toBeInTheDocument();
  });

  it('показывает кандидатов с расстоянием, когда сервис их вернул', async () => {
    renderFleet((url) =>
      url.includes('/v1/dispatch/nearest')
        ? jsonResponse({
            generatedAt: GENERATED_AT,
            radiusM: 3000,
            candidates: [
              { driverId: 'DRV-1', displayName: 'Айбек Сериков', distanceM: 640, lat: 42.32, lon: 69.59, ageSeconds: 3 },
            ],
          })
        : jsonResponse(fleetPayload([FRESH])),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Найти ближайших' }));

    expect(await screen.findByText('кандидатов: 1')).toBeInTheDocument();
    // Расстояние — только через formatDistanceMeters.
    expect(screen.getByText('640 м')).toBeInTheDocument();
    expect(screen.getByText(/отчёт 3 с назад/)).toBeInTheDocument();
  });

  it('обновляет данные по кнопке и переключает автообновление на ручное', async () => {
    const fetchMock = renderFleet(() => jsonResponse(fleetPayload([FRESH])));

    await screen.findByText('Айбек Сериков');
    const callsBefore = fetchMock.mock.calls.length;

    // Имя кнопки ищем по подстроке: во время запроса внутри неё живёт спиннер с подписью.
    fireEvent.click(screen.getAllByRole('button', { name: /Обновить/ })[0] as HTMLElement);

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    // Период опроса — реальный выбор клиента, а не декорация: «вручную» выключает опрос.
    const refresh = screen.getByLabelText('Автообновление');
    fireEvent.change(refresh, { target: { value: '0' } });
    expect(screen.getByText(/автообновление выключено/i)).toBeInTheDocument();
    // Последнее время ответа показано явно, а не подразумевается.
    expect(screen.getByText(/последний ответ/)).toBeInTheDocument();
  });

  it('выгружает CSV загруженных строк и не выдаёт себя за изменение данных', async () => {
    renderFleet(() => jsonResponse(fleetPayload([FRESH])));

    // Ждём именно строку таблицы: до ответа сервиса выгружать нечего, и кнопка выключена.
    await screen.findByText('Айбек Сериков');
    expect(screen.getByRole('button', { name: /CSV/ })).toBeEnabled();

    // Буфера обмена в jsdom нет: кнопка обязана честно сказать, что не смогла.
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(await screen.findByText('CSV недоступен')).toBeInTheDocument();

    // CSV — действие браузера, а не мутация: помечать его data-admin-write нельзя.
    expect(document.querySelector('[data-admin-write]')).toBeNull();
  });

  it('ведёт на живую карту вместо второй карты внутри панели', async () => {
    renderFleet(() => jsonResponse(fleetPayload([FRESH])));

    const links = await screen.findAllByRole('link', { name: 'Открыть карту' });
    expect(links[0]).toHaveAttribute('href', '/dispatch');
    expect(screen.getByRole('link', { name: 'Открыть /dispatch' })).toHaveAttribute('href', '/dispatch');
  });

  it('подписывает раздел как «ничего не меняет» и не рисует кнопок изменения', async () => {
    renderFleet(() => jsonResponse(fleetPayload([FRESH])));

    expect(await screen.findByText('Раздел ничего не меняет')).toBeInTheDocument();
    // Кнопки в разделе есть только у поиска, обновления и выгрузки: мутаций у API нет,
    // элементов с data-admin-write быть не должно.
    expect(screen.queryByRole('button', { name: /отменить|назначить|сохранить/i })).not.toBeInTheDocument();
    expect(document.querySelector('[data-admin-write]')).toBeNull();

    // Честный перечень того, чего в API нет, остаётся на экране.
    expect(screen.getByText('Серверного поиска водителей нет.')).toBeInTheDocument();
    expect(screen.getByText('Машин и госномеров в ответе нет.')).toBeInTheDocument();
    expect(screen.getByText('Глубокой ссылки на водителя нет.')).toBeInTheDocument();
  });
});
