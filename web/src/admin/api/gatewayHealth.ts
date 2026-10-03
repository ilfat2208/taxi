/**
 * Состояние API-шлюза для раздела «Обзор».
 *
 * `/actuator/health` живёт ВНЕ префикса `/api`: `vite.config.ts` проксирует
 * `/actuator` отдельным правилом, поэтому общий `apiRequest` здесь не подходит —
 * он подставил бы `/api` и запрос ушёл бы в несуществующий путь. Правка общего
 * клиента ради одного вызова была бы хуже маленького локального хелпера, который
 * к тому же честно разбирает нестандартный случай.
 *
 * Этот нестандартный случай — второй и главный: Spring Boot отвечает `503`, когда
 * здоровье `DOWN`. Это по-прежнему осмысленный ответ о состоянии шлюза, а не сбой
 * запроса, поэтому не-2xx с телом вида `{"status":"DOWN"}` разбирается как данные
 * о здоровье. Иначе раздел показывал бы «шлюз недоступен» ровно тогда, когда шлюз
 * работает и честно сообщает, что его база лежит.
 */
import { API_BASE_URL, CORRELATION_HEADER } from '../../api/client';
import { ApiError, toApiError } from '../../api/errors';
import { getAccessToken } from '../../auth/session';

/** Путь здоровья шлюза: префикс `/actuator` проксируется отдельно от `/api`. */
export const GATEWAY_HEALTH_PATH = '/actuator/health';

export interface GatewayHealthComponent {
  /** Имя проверки как его назвал шлюз: `db`, `redis`, `diskSpace`, `ping`. */
  name: string;
  status: string;
}

export interface GatewayHealth {
  /** `UP` / `DOWN` / `OUT_OF_SERVICE` / `UNKNOWN` — как пришло от шлюза, без перевода. */
  status: string;
  /** Детализация проверок; пусто, когда шлюз отдаёт только `{"status":"UP"}`. */
  components: GatewayHealthComponent[];
  /** false, когда детали закрыты настройкой — об этом честнее сказать, чем гадать. */
  detailsExposed: boolean;
  /** HTTP-код ответа: `DOWN` приходит как 503, и его стоит показать рядом со статусом. */
  httpStatus: number;
}

/**
 * Адрес здоровья.
 *
 * В обычном режиме API относительный (`/api`), и прокси отдаёт `/actuator/health`
 * с того же origin. Если же сборка задала абсолютный `VITE_API_BASE_URL`, здоровье
 * берётся с того же хоста — иначе запрос ушёл бы на фронтенд-хостинг, где никакого
 * актуатора нет.
 */
export function gatewayHealthUrl(): string {
  const base = API_BASE_URL.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(base)) {
    return `${base.replace(/\/api$/i, '')}${GATEWAY_HEALTH_PATH}`;
  }
  return GATEWAY_HEALTH_PATH;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Разбирает ответ актуатора.
 *
 * Статус проверки, пришедший не строкой (или отсутствующий), становится
 * `UNKNOWN`: выдать его за `UP` значило бы соврать о состоянии шлюза.
 */
export function normalizeGatewayHealth(raw: unknown, httpStatus = 200): GatewayHealth {
  const record = asRecord(raw);
  const components = Object.entries(asRecord(record.components))
    .map(([name, value]) => {
      const status = asRecord(value).status;
      return { name, status: typeof status === 'string' && status !== '' ? status : 'UNKNOWN' };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const status = record.status;
  return {
    status: typeof status === 'string' && status !== '' ? status : 'UNKNOWN',
    components,
    detailsExposed: components.length > 0,
    httpStatus,
  };
}

/** Тело ответа — отчёт о здоровье, а не HTML прокси и не пустая страница ошибки. */
function looksLikeHealth(raw: unknown): boolean {
  const status = asRecord(raw).status;
  return typeof status === 'string' && status !== '';
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Один запрос к `/actuator/health`.
 *
 * Бросает `ApiError` только тогда, когда ответ не является отчётом о здоровье
 * (шлюз не поднят, прокси вернул HTML, тело пустое) — такой случай раздел «Обзор»
 * показывает как «шлюз недоступен».
 */
export async function fetchGatewayHealth(signal?: AbortSignal): Promise<GatewayHealth> {
  const url = gatewayHealthUrl();
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers, signal, credentials: 'same-origin' });
  const text = await safeText(response);
  const correlationId = response.headers.get(CORRELATION_HEADER);

  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }

  if (!looksLikeHealth(parsed)) {
    if (!response.ok) {
      throw toApiError(response.status, text, correlationId);
    }
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      title: 'Некорректный ответ сервера',
      detail: `${url} ответил не отчётом о здоровье — проверьте адрес шлюза и прокси`,
      correlationId,
    });
  }

  return normalizeGatewayHealth(parsed, response.status);
}
