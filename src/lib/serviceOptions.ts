import { formatDate } from './dateFormat';
import type { ChurchService } from './types';

export type ServiceOption = {
  value: string;
  label: string;
};

export type ServiceSelection = {
  selectedServiceId: string;
  date: string;
};

export type ServiceSelectionErrors = Partial<Record<keyof ServiceSelection, string>>;

function isLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
}

function isLocalTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function getServiceStart(service: ChurchService) {
  if (!isLocalDate(service.date) || !isLocalTime(service.startTime)) {
    return null;
  }

  const [year, month, day] = service.date.split('-').map(Number);
  const [hour, minute] = service.startTime.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

export function getFutureChurchServices(services: ChurchService[] = [], now: Date, limit = 5) {
  return services
    .map((service) => ({ service, start: getServiceStart(service) }))
    .filter(
      (entry): entry is { service: ChurchService; start: Date } =>
        entry.start !== null && entry.start.getTime() >= now.getTime(),
    )
    .sort((left, right) => left.start.getTime() - right.start.getTime())
    .slice(0, limit)
    .map(({ service }) => service);
}

export function getChurchServiceOptions(services: ChurchService[]): ServiceOption[] {
  return services.map((service) => ({
    value: service.id,
    label: `${service.name} — ${formatDate(service.date)}, ${service.startTime}`,
  }));
}

export function selectChurchService<T extends ServiceSelection>(selection: T, selectedServiceId: string): T {
  return { ...selection, selectedServiceId, date: '' };
}

export function selectAlternativeDate<T extends ServiceSelection>(selection: T, date: string): T {
  return { ...selection, selectedServiceId: '', date };
}

function isDateBeforeToday(value: string, now: Date) {
  if (!isLocalDate(value)) {
    return true;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return date.getTime() < today.getTime();
}

export function validateServiceSelection(
  selection: ServiceSelection,
  services: ChurchService[],
  now: Date,
): ServiceSelectionErrors {
  const errors: ServiceSelectionErrors = {};
  const selectedService = getFutureChurchServices(services, now).find(
    (service) => service.id === selection.selectedServiceId,
  );

  if (selection.selectedServiceId && selection.date) {
    errors.selectedServiceId = 'Выберите службу или другую дату.';
  } else if (!selection.selectedServiceId && !selection.date) {
    errors.selectedServiceId = 'Выберите службу или другую дату.';
  } else if (selection.selectedServiceId && !selectedService) {
    errors.selectedServiceId = 'Выбранная служба уже прошла. Выберите другую.';
  } else if (selection.date && isDateBeforeToday(selection.date, now)) {
    errors.date = 'Выберите сегодняшнюю или будущую дату.';
  }

  return errors;
}

export function resolveServiceSelection(
  selection: ServiceSelection,
  services: ChurchService[],
) {
  const service = selection.selectedServiceId
    ? services.find((item) => item.id === selection.selectedServiceId)
    : undefined;

  return {
    date: service?.date ?? selection.date,
    service,
  };
}

export function formatServiceSelection(selection: ServiceSelection, services: ChurchService[]) {
  const { date, service } = resolveServiceSelection(selection, services);

  return service ? `${service.name}, ${formatDate(service.date)}` : `Дата поездки: ${formatDate(date)}`;
}
