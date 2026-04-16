import { differenceInSeconds, format } from 'date-fns';
export function formatCountdown(targetDate: Date): string {
  const now = new Date();
  const totalSeconds = Math.max(0, differenceInSeconds(targetDate, now));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0'),
  ].join(':');
}
export function isExpired(date: Date): boolean {
  return date < new Date();
}
export function formatPurchaseDate(date: Date): string {
  return format(date, 'MMM d, yyyy • h:mm a');
}
