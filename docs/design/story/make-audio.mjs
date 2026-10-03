/**
 * Синтез фоновой музыкальной подложки для истории ORTA.
 *
 * Мелодия не скачивается: ноты считаются прямо здесь, поэтому у файла нет ни
 * лицензионных ограничений, ни внешних зависимостей. Схема — ля-минор,
 * аккорды Am - F - C - G по 4.75 с на круг (8 кругов = 38 с, ровно под видео),
 * мягкая атака и спад у каждого тона, поэтому на стыках нет щелчков.
 *
 * Запуск: node make-audio.mjs   (из каталога docs/design/story)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DURATION_S } from './timing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const SR = 44100;
// Длина берётся из таймингов ролика: подложка не должна обрывать последний кадр.
const DURATION = Number(DURATION_S.toFixed(3));
const TOTAL = Math.round(SR * DURATION);

const A4 = 440;
/** Частота ноты по названию: C4, A#3 и т. п. */
function freq(name) {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  if (!m) throw new Error(`не нота: ${name}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + base;
  return A4 * Math.pow(2, (midi - 69) / 12);
}

// Круг: [бас, терция/квинта, мелодические ноты]
const PROGRESSION = [
  { bass: 'A2', pad: ['A3', 'E4', 'C5'], lead: ['A4', 'C5', 'E5', 'C5'] },
  { bass: 'F2', pad: ['F3', 'C4', 'A4'], lead: ['A4', 'C5', 'F5', 'C5'] },
  { bass: 'C3', pad: ['C4', 'G4', 'E5'], lead: ['G4', 'E5', 'G5', 'E5'] },
  { bass: 'G2', pad: ['G3', 'D4', 'B4'], lead: ['B4', 'D5', 'G5', 'D5'] },
];

const CYCLE = 4.75; // секунд на аккорд
const out = new Float32Array(TOTAL);
const fadeIn = 0.9;
const fadeOut = 3.2;

/** Накладывает тон с мягкой атакой и спадом. */
function voice(startS, durS, f, gain, harmonics = [[1, 1], [2, 0.32], [3, 0.12]]) {
  const start = Math.floor(startS * SR);
  const len = Math.floor(durS * SR);
  const attack = Math.min(0.12 * SR, len * 0.25);
  const release = len * 0.55;
  for (let i = 0; i < len; i += 1) {
    const idx = start + i;
    if (idx < 0 || idx >= TOTAL) continue;
    const env =
      (i < attack ? i / attack : 1) *
      (i > len - release ? Math.max(0, (len - i) / release) : 1);
    const t = i / SR;
    let s = 0;
    for (const [mult, amp] of harmonics) s += amp * Math.sin(2 * Math.PI * f * mult * t);
    out[idx] += s * env * gain;
  }
}

const cycles = Math.ceil(DURATION / (CYCLE * PROGRESSION.length));
for (let c = 0; c < cycles; c += 1) {
  for (let a = 0; a < PROGRESSION.length; a += 1) {
    const t0 = (c * PROGRESSION.length + a) * CYCLE;
    if (t0 >= DURATION) break;
    const chord = PROGRESSION[a];

    voice(t0, CYCLE * 1.05, freq(chord.bass), 0.16, [[1, 1], [2, 0.18]]);
    for (const n of chord.pad) voice(t0, CYCLE * 1.05, freq(n), 0.055);

    // Мелодия: четыре ноты на аккорд, каждая со своим мягким толчком.
    const step = CYCLE / chord.lead.length;
    chord.lead.forEach((n, i) => voice(t0 + i * step, step * 1.6, freq(n), 0.075, [[1, 1], [2, 0.22], [4, 0.05]]));
  }
}

// Общая огибающая и ограничение уровня.
let peak = 0;
for (let i = 0; i < TOTAL; i += 1) {
  const t = i / SR;
  let g = 1;
  if (t < fadeIn) g *= t / fadeIn;
  if (t > DURATION - fadeOut) g *= Math.max(0, (DURATION - t) / fadeOut);
  out[i] *= g;
  const abs = Math.abs(out[i]);
  if (abs > peak) peak = abs;
}
const norm = peak > 0 ? 0.72 / peak : 1;

// WAV, 16 бит, моно — дальше ffmpeg сам разложит в AAC/Opus.
const data = Buffer.alloc(TOTAL * 2);
for (let i = 0; i < TOTAL; i += 1) {
  const v = Math.max(-1, Math.min(1, out[i] * norm));
  data.writeInt16LE(Math.round(v * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const target = resolve(HERE, 'audio', 'orta-story.wav');
mkdirSync(resolve(HERE, 'audio'), { recursive: true });
writeFileSync(target, Buffer.concat([header, data]));
console.log(`[audio] ${target}: ${DURATION} с, ${(data.length / 1048576).toFixed(1)} МБ, пик ${peak.toFixed(3)}`);
