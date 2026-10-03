import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { adminSectionById, type AdminSection } from '../sections';
import FleetSection from './fleet';
import { createTestQueryClient, jsonResponse, problemResponse, stubFetch, type MockResponse } from '../../test/utils';

/**
 * Раздел «Парк и диспетчерская».
 *
 * Проверяется то, что требует ревью: цифры берутся из ответа сервиса (а не из
 * констант), свежесть позиции показывается честно, ошибка сервиса превращается в
 * `ErrorAlert`, пустой список — в `EmptyState`, а запрос ближайших уходит только по
 * кнопке и только с валидными координатами.
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

describe('раздел «Парк и диспетчерская»', () => {
  it('считает KPI по ответу сервиса и показывает возраст самого старого отчёта', async () => {
    renderFleet(() => jsonResponse(fleetPayload([FRESH, STALE_BUSY, NO_FIX])));

    expect(await screen.findByText('На линии', { selector: 'p' })).toBeInTheDocument();

    // Ярлыки KPI ищем именно как абзацы: слово «На линии» есть ещё и в бейдже
    // статуса водителя (`ONLINE` → «На линии»).
    const kpi = (label: string) => screen.getByText(label, { selector: 'p' }).closest('section');
    expect(kpi('На линии')).toHaveTextContent('3');

    // Занят один (BUSY), свободны двое — цифры считаются по статусам из ответа.
    expect(kpi('Заняты')).toHaveTextContent('1');
    expect(kpi('Свободны')).toHaveTextContent('2');

    // Самый старый отчёт позиции — 240 с у второго водителя, ровно как в ответе.
    expect(kpi('Самый старый отчёт позиции')).toHaveTextContent('4 мин');

    // Свежесть позиции и её отсутствие показаны разными словами.
    expect(screen.getByText('4 мин назад')).toBeInTheDocument();
    expect(screen.getByText('3 с назад')).toBeInTheDocument();
    expect(screen.getByText('позиция ещё не приходила')).toBeInTheDocument();
    expect(screen.getByText('устарела')).toBeInTheDocument();
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

  it('показывает EmptyState, когда на линии никого нет', async () => {
    renderFleet(() => jsonResponse(fleetPayload([])));

    expect(await screen.findByText('На линии никого нет')).toBeInTheDocument();
    expect(screen.getByText('На линии', { selector: 'p' }).closest('section')).toHaveTextContent('0');
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

    expect(await screen.findByText(/машин нет/)).toBeInTheDocument();
  });

  it('подписывает раздел как «ничего не меняет» и не рисует кнопок изменения', async () => {
    renderFleet(() => jsonResponse(fleetPayload([FRESH])));

    expect(await screen.findByText('Раздел ничего не меняет')).toBeInTheDocument();
    // Кнопки в разделе есть только у поиска и обновления: мутаций у API нет,
    // элементов с data-admin-write быть не должно.
    expect(screen.queryByRole('button', { name: /отменить|назначить|сохранить/i })).not.toBeInTheDocument();
    expect(document.querySelector('[data-admin-write]')).toBeNull();
  });
});
