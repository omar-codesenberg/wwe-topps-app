export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatMoney(n: number): string {
  return `$${n.toLocaleString()}`;
}

/**
 * Convert a JS Date to the value format expected by <input type="datetime-local">.
 * Uses local time (not UTC) so the picker shows the same time the user typed.
 */
export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
