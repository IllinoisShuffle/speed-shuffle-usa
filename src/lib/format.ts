export function formatSessionDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatHour(hhmm: string): { label: string; period: 'am' | 'pm' } {
  const [h, m] = hhmm.split(':').map(Number);
  const period: 'am' | 'pm' = h >= 12 ? 'pm' : 'am';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const label = m === 0 ? `${hour12}` : `${hour12}:${String(m).padStart(2, '0')}`;
  return { label, period };
}

export function formatSessionTime(start: string, end: string): string {
  const from = formatHour(start);
  const to = formatHour(end);
  const startLabel = from.period === to.period ? from.label : `${from.label}${from.period}`;
  return `${startLabel}–${to.label}${to.period}`;
}

export function isUpcoming(iso: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${iso}T00:00:00`).getTime() >= today.getTime();
}
