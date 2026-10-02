export type ClassValue = string | false | null | undefined;

/** Minimal class-name joiner: keeps conditional Tailwind classes readable. */
export function cx(...values: ClassValue[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ');
}
