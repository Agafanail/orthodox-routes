export function formatDate(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    return date;
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function formatDateTime(date: string, time: string) {
  return `${formatDate(date)} в ${time}`;
}
