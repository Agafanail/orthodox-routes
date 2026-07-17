import type { Trip } from './types';

type TripVisibilityFields = Pick<Trip, 'date' | 'departureTime' | 'seatsAvailable' | 'status'>;

function getLocalDeparture(trip: TripVisibilityFields) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trip.date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(trip.departureTime);

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const [, yearText, monthText, dayText] = dateMatch;
  const [, hourText, minuteText] = timeMatch;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const departure = new Date(year, month, day, hour, minute);

  if (
    departure.getFullYear() !== year ||
    departure.getMonth() !== month ||
    departure.getDate() !== day ||
    departure.getHours() !== hour ||
    departure.getMinutes() !== minute
  ) {
    return null;
  }

  return departure;
}

export function isOneTimeTripAvailable(trip: TripVisibilityFields, now: Date) {
  if (trip.status !== 'open' || trip.seatsAvailable <= 0) {
    return false;
  }

  const departure = getLocalDeparture(trip);
  return departure !== null && departure.getTime() >= now.getTime();
}
