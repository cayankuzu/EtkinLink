import { format, isToday, isTomorrow } from 'date-fns';
import { tr } from 'date-fns/locale';

export function formatEventDate(value: string): string {
  const date = new Date(value);
  if (isToday(date)) return `Bugün · ${format(date, 'HH:mm')}`;
  if (isTomorrow(date)) return `Yarın · ${format(date, 'HH:mm')}`;
  return format(date, 'd MMM yyyy · HH:mm', { locale: tr });
}

export function formatMessageDateTime(value: string): string {
  return format(new Date(value), 'd MMM yyyy · HH:mm', { locale: tr });
}

export function formatMessagePreviewDateTime(value: string): string {
  return format(new Date(value), 'dd.MM.yy · HH:mm', { locale: tr });
}
