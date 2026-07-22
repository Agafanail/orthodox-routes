export function formatSeatCount(count: number) {
  const absoluteCount = Math.abs(count);
  const lastTwoDigits = absoluteCount % 100;
  const lastDigit = absoluteCount % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${count} мест`;
  }

  if (lastDigit === 1) {
    return `${count} место`;
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${count} места`;
  }

  return `${count} мест`;
}

export function formatPassengerCount(count: number) {
  const absoluteCount = Math.abs(count);
  const lastTwoDigits = absoluteCount % 100;
  const lastDigit = absoluteCount % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${count} пассажиров`;
  }

  if (lastDigit === 1) {
    return `${count} пассажир`;
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${count} пассажира`;
  }

  return `${count} пассажиров`;
}

export function formatAgreementCount(confirmedCount: number, originalCount: number) {
  const personNoun = originalCount % 10 === 1 && originalCount % 100 !== 11 ? 'человека' : 'человек';
  const agreementVerb = confirmedCount === 1 ? 'договорился' : 'договорились';
  return `${confirmedCount} из ${originalCount} ${personNoun} ${agreementVerb} о поездке`;
}

export function formatAvailableOfTotal(availableCount: number, totalCount: number) {
  const totalNoun = totalCount % 10 === 1 && totalCount % 100 !== 11 ? 'места' : 'мест';
  return `Свободно ${availableCount} из ${totalCount} ${totalNoun}`;
}

export function formatOccupiedOfTotal(occupiedCount: number, totalCount: number) {
  const totalNoun = totalCount % 10 === 1 && totalCount % 100 !== 11 ? 'места' : 'мест';
  return `Занято ${occupiedCount} из ${totalCount} ${totalNoun}`;
}
