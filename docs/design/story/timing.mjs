/**
 * Тайминги истории ORTA — единственный источник правды и для показа, и для рендера
 * кадров. Сцена длится ровно 1.2 секунды, переход между сценами — 26 кадров
 * (0.867 с), поэтому сцены перекрываются и переход выглядит непрерывным.
 */
export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

/** Длительность CSS-перехода, при котором кадр «доезжает» до нужной точки. */
export const TRANSITION_MS = 360;

/** Кадры начала и конца каждой сцены (включительно по началу). */
export const SCENE_SPANS = {
  brand: [0, 96],
  home: [96, 300],
  verticals: [300, 500],
  taxi: [500, 704],
  qtime: [704, 824],
  business: [824, 936],
  platform: [936, 1048],
  final: [1048, 1140],
};

/** Сколько кадров занимает кросс-переход сцен. */
export const CROSS = 26;

export const TOTAL_FRAMES = 1140;
export const DURATION_S = TOTAL_FRAMES / FPS;
