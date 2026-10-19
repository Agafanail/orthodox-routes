import type { NotificationDeliveryJob } from './adapter';

type Language = NotificationDeliveryJob['language'];
type Translations = Readonly<Record<Language, string>>;

// Each stable key has its own revision. Copy corrections never rewrite notification rows.
function text(translations: Translations) {
  return { version: 1, translations } as const;
}

export const preparedNotificationCopy = {
  'notifications.subject': text({
    de: 'Aktualisierung bei Orthodox Routes', en: 'Orthodox Routes update',
    it: 'Aggiornamento Orthodox Routes', ro: 'Actualizare Orthodox Routes',
    ru: 'Обновление Orthodox Routes', uk: 'Оновлення Orthodox Routes',
  }),
  'notifications.open': text({
    de: 'Orthodox Routes öffnen', en: 'Open Orthodox Routes',
    it: 'Apri Orthodox Routes', ro: 'Deschide Orthodox Routes',
    ru: 'Открыть Orthodox Routes', uk: 'Відкрити Orthodox Routes',
  }),
  'notifications.update': text({
    de: 'In Orthodox Routes wartet eine Aktualisierung auf Sie.',
    en: 'An update is waiting for you in Orthodox Routes.',
    it: 'C’è un aggiornamento per te in Orthodox Routes.',
    ro: 'Ai o actualizare în Orthodox Routes.',
    ru: 'В Orthodox Routes вас ждёт обновление.',
    uk: 'В Orthodox Routes на вас чекає оновлення.',
  }),
  'notifications.ride_response_received': text({
    de: 'Sie haben eine neue Anfrage zu einer Fahrt erhalten. Öffnen Sie die App für den aktuellen Stand.',
    en: 'You received a new ride response. Open the app for its current status.',
    it: 'Hai ricevuto una nuova risposta per un viaggio. Apri l’app per verificarne lo stato attuale.',
    ro: 'Ai primit un răspuns nou pentru o călătorie. Deschide aplicația pentru a vedea starea actuală.',
    ru: 'Вы получили новый отклик на поездку. Откройте приложение, чтобы узнать его текущее состояние.',
    uk: 'Ви отримали новий відгук на поїздку. Відкрийте застосунок, щоб дізнатися його поточний стан.',
  }),
  'notifications.ride_counteroffer_received': text({
    de: 'Für eine Fahrt wurde eine andere Anzahl an Plätzen vorgeschlagen. Öffnen Sie die App für den aktuellen Stand.',
    en: 'A different number of seats was proposed for a ride. Open the app for its current status.',
    it: 'È stato proposto un numero diverso di posti per un viaggio. Apri l’app per verificarne lo stato attuale.',
    ro: 'A fost propus un alt număr de locuri pentru o călătorie. Deschide aplicația pentru a vedea starea actuală.',
    ru: 'Для поездки предложили другое число мест. Откройте приложение, чтобы узнать текущее состояние отклика.',
    uk: 'Для поїздки запропонували іншу кількість місць. Відкрийте застосунок, щоб дізнатися поточний стан відгуку.',
  }),
  'notifications.ride_response_declined': text({
    de: 'Eine Anfrage zu einer Fahrt wurde abgelehnt. Öffnen Sie die App für den aktuellen Stand.',
    en: 'A ride response was declined. Open the app for its current status.',
    it: 'Una risposta per un viaggio è stata rifiutata. Apri l’app per verificarne lo stato attuale.',
    ro: 'Un răspuns pentru o călătorie a fost refuzat. Deschide aplicația pentru a vedea starea actuală.',
    ru: 'Отклик на поездку отклонён. Откройте приложение, чтобы узнать его текущее состояние.',
    uk: 'Відгук на поїздку відхилено. Відкрийте застосунок, щоб дізнатися його поточний стан.',
  }),
  'notifications.ride_response_withdrawn': text({
    de: 'Eine Anfrage zu einer Fahrt wurde zurückgezogen. Öffnen Sie die App für den aktuellen Stand.',
    en: 'A ride response was withdrawn. Open the app for its current status.',
    it: 'Una risposta per un viaggio è stata ritirata. Apri l’app per verificarne lo stato attuale.',
    ro: 'Un răspuns pentru o călătorie a fost retras. Deschide aplicația pentru a vedea starea actuală.',
    ru: 'Отклик на поездку отозван. Откройте приложение, чтобы узнать его текущее состояние.',
    uk: 'Відгук на поїздку відкликано. Відкрийте застосунок, щоб дізнатися його поточний стан.',
  }),
  'notifications.ride_confirmed': text({
    de: 'Eine Fahrt wurde vereinbart. Prüfen Sie die aktuellen Einzelheiten in der App.',
    en: 'A ride agreement was confirmed. Check the current details in the app.',
    it: 'È stato confermato un accordo per un viaggio. Controlla i dettagli attuali nell’app.',
    ro: 'A fost confirmată o înțelegere pentru o călătorie. Verifică detaliile actuale în aplicație.',
    ru: 'Договорённость о поездке подтверждена. Проверьте актуальные сведения в приложении.',
    uk: 'Домовленість про поїздку підтверджено. Перевірте актуальні відомості в застосунку.',
  }),
  'notifications.ride_cancelled': text({
    de: 'Eine Fahrtvereinbarung wurde abgesagt. Prüfen Sie den aktuellen Stand in der App.',
    en: 'A ride agreement was cancelled. Check the current status in the app.',
    it: 'Un accordo per un viaggio è stato annullato. Controlla lo stato attuale nell’app.',
    ro: 'O înțelegere pentru o călătorie a fost anulată. Verifică starea actuală în aplicație.',
    ru: 'Договорённость о поездке отменена. Проверьте текущее состояние в приложении.',
    uk: 'Домовленість про поїздку скасовано. Перевірте поточний стан у застосунку.',
  }),
  'notifications.ride_change_proposed': text({
    de: 'Für eine vereinbarte Fahrt wurden Änderungen vorgeschlagen. Prüfen Sie den aktuellen Stand in der App.',
    en: 'Changes to a ride agreement were proposed. Check the current status in the app.',
    it: 'Sono state proposte modifiche a un accordo per un viaggio. Controlla lo stato attuale nell’app.',
    ro: 'Au fost propuse modificări ale unei înțelegeri pentru o călătorie. Verifică starea actuală în aplicație.',
    ru: 'Предложены изменения договорённости о поездке. Проверьте текущее состояние в приложении.',
    uk: 'Запропоновано зміни домовленості про поїздку. Перевірте поточний стан у застосунку.',
  }),
  'notifications.ride_change_accepted': text({
    de: 'Änderungen an einer Fahrtvereinbarung wurden angenommen. Prüfen Sie die aktuellen Einzelheiten in der App.',
    en: 'Changes to a ride agreement were accepted. Check the current details in the app.',
    it: 'Le modifiche a un accordo per un viaggio sono state accettate. Controlla i dettagli attuali nell’app.',
    ro: 'Modificările unei înțelegeri pentru o călătorie au fost acceptate. Verifică detaliile actuale în aplicație.',
    ru: 'Изменения договорённости о поездке приняты. Проверьте актуальные сведения в приложении.',
    uk: 'Зміни домовленості про поїздку прийнято. Перевірте актуальні відомості в застосунку.',
  }),
  'notifications.ride_change_declined': text({
    de: 'Änderungen an einer Fahrtvereinbarung wurden abgelehnt. Prüfen Sie den aktuellen Stand in der App.',
    en: 'Changes to a ride agreement were declined. Check the current status in the app.',
    it: 'Le modifiche a un accordo per un viaggio sono state rifiutate. Controlla lo stato attuale nell’app.',
    ro: 'Modificările unei înțelegeri pentru o călătorie au fost refuzate. Verifică starea actuală în aplicație.',
    ru: 'Изменения договорённости о поездке отклонены. Проверьте текущее состояние в приложении.',
    uk: 'Зміни домовленості про поїздку відхилено. Перевірте поточний стан у застосунку.',
  }),
  'notifications.ride_change_expired': text({
    de: 'Ein Änderungsvorschlag für eine Fahrt ist abgelaufen. Prüfen Sie den aktuellen Stand in der App.',
    en: 'A proposed ride change expired. Check the current status in the app.',
    it: 'Una proposta di modifica a un viaggio è scaduta. Controlla lo stato attuale nell’app.',
    ro: 'O propunere de modificare a unei călătorii a expirat. Verifică starea actuală în aplicație.',
    ru: 'Срок ответа на изменение поездки истёк. Проверьте текущее состояние в приложении.',
    uk: 'Строк відповіді на зміну поїздки минув. Перевірте поточний стан у застосунку.',
  }),
  'notifications.ride_change_cancelled': text({
    de: 'Ein Änderungsvorschlag für eine Fahrt wurde aufgehoben. Prüfen Sie den aktuellen Stand in der App.',
    en: 'A proposed ride change was cancelled. Check the current status in the app.',
    it: 'Una proposta di modifica a un viaggio è stata annullata. Controlla lo stato attuale nell’app.',
    ro: 'O propunere de modificare a unei călătorii a fost anulată. Verifică starea actuală în aplicație.',
    ru: 'Предложение изменить поездку отменено. Проверьте текущее состояние в приложении.',
    uk: 'Пропозицію змінити поїздку скасовано. Перевірте поточний стан у застосунку.',
  }),
  'notifications.ride_quality_match': text({
    de: 'Eine möglicherweise passende Fahrt wurde gefunden. Prüfen Sie die aktuellen Möglichkeiten in der App.',
    en: 'A potentially suitable ride was found. Check the current options in the app.',
    it: 'È stato trovato un possibile abbinamento per un viaggio. Controlla le opzioni attuali nell’app.',
    ro: 'A fost găsită o posibilă potrivire pentru o călătorie. Verifică opțiunile actuale în aplicație.',
    ru: 'Найден возможный вариант поездки. Проверьте актуальные варианты в приложении.',
    uk: 'Знайдено можливий варіант поїздки. Перевірте актуальні варіанти в застосунку.',
  }),
  'notifications.ride_reminder': text({
    de: 'Erinnerung an eine vereinbarte Fahrt. Prüfen Sie die aktuellen Einzelheiten in der App.',
    en: 'A reminder about a ride agreement. Check the current details in the app.',
    it: 'Un promemoria per un viaggio concordato. Controlla i dettagli attuali nell’app.',
    ro: 'Un memento pentru o călătorie convenită. Verifică detaliile actuale în aplicație.',
    ru: 'Напоминание о договорённости на поездку. Проверьте актуальные сведения в приложении.',
    uk: 'Нагадування про домовленість на поїздку. Перевірте актуальні відомості в застосунку.',
  }),
  'notifications.ride_outcome_requested': text({
    de: 'Hat Ihre Fahrt stattgefunden? Sie können dies in der App angeben.',
    en: 'Did your ride take place? You can let us know in the app.',
    it: 'Il viaggio si è svolto? Puoi comunicarlo nell’app.',
    ro: 'A avut loc călătoria? Poți răspunde în aplicație.',
    ru: 'Поездка состоялась? Вы можете ответить в приложении.',
    uk: 'Поїздка відбулася? Ви можете відповісти в застосунку.',
  }),
  'notifications.driver_series_ended': text({
    de: 'Eine Reihe Ihrer regelmäßigen Fahrten ist zu Ende. Prüfen Sie die Einzelheiten in der App.',
    en: 'One of your regular ride series ended. Check the details in the app.',
    it: 'Una delle tue serie di viaggi regolari è terminata. Controlla i dettagli nell’app.',
    ro: 'Una dintre seriile tale de călătorii regulate s-a încheiat. Verifică detaliile în aplicație.',
    ru: 'Одна из ваших серий регулярных поездок завершилась. Подробности — в приложении.',
    uk: 'Одна з ваших серій регулярних поїздок завершилася. Подробиці — у застосунку.',
  }),
  'notifications.account_phone_changed': text({
    de: 'Die Telefonnummer Ihres Kontos wurde geändert. Prüfen Sie Ihr Profil in der App.',
    en: 'Your account phone number was changed. Check your profile in the app.',
    it: 'Il numero di telefono del tuo account è stato modificato. Controlla il profilo nell’app.',
    ro: 'Numărul de telefon al contului tău a fost schimbat. Verifică profilul în aplicație.',
    ru: 'Номер телефона в вашем аккаунте изменён. Проверьте профиль в приложении.',
    uk: 'Номер телефону у вашому акаунті змінено. Перевірте профіль у застосунку.',
  }),
  'notifications.church_admin_joined': text({
    de: 'Jemand hat die Verwaltung einer Ihrer Kirchenseiten übernommen. Prüfen Sie die aktuelle Liste in der App.',
    en: 'An administrator joined one of your church pages. Check the current list in the app.',
    it: 'Un amministratore si è aggiunto a una delle tue pagine di chiesa. Controlla l’elenco attuale nell’app.',
    ro: 'Un administrator s-a alăturat uneia dintre paginile tale de biserică. Verifică lista actuală în aplicație.',
    ru: 'К управлению одной из ваших страниц храма присоединился администратор. Проверьте текущий список в приложении.',
    uk: 'До керування однією з ваших сторінок храму приєднався адміністратор. Перевірте поточний список у застосунку.',
  }),
  'notifications.church_admin_left': text({
    de: 'Jemand hat die Verwaltung einer Ihrer Kirchenseiten verlassen. Prüfen Sie die aktuelle Liste in der App.',
    en: 'An administrator left one of your church pages. Check the current list in the app.',
    it: 'Un amministratore ha lasciato una delle tue pagine di chiesa. Controlla l’elenco attuale nell’app.',
    ro: 'Un administrator a părăsit una dintre paginile tale de biserică. Verifică lista actuală în aplicație.',
    ru: 'Администратор вышел из управления одной из ваших страниц храма. Проверьте текущий список в приложении.',
    uk: 'Адміністратор вийшов з керування однією з ваших сторінок храму. Перевірте поточний список у застосунку.',
  }),
  'notifications.church_admin_removed': text({
    de: 'Die Verwaltung einer Kirchenseite wurde nach einer Prüfung durch die Plattform geändert. Prüfen Sie Ihren aktuellen Zugriff in der App.',
    en: 'Church page administration was changed after a platform review. Check your current access in the app.',
    it: 'La gestione di una pagina di chiesa è stata modificata dopo una verifica della piattaforma. Controlla il tuo accesso attuale nell’app.',
    ro: 'Administrarea unei pagini de biserică a fost modificată după o verificare a platformei. Verifică accesul tău actual în aplicație.',
    ru: 'Состав администраторов страницы храма изменён после проверки платформой. Проверьте свой текущий доступ в приложении.',
    uk: 'Склад адміністраторів сторінки храму змінено після перевірки платформою. Перевірте свій поточний доступ у застосунку.',
  }),
  'notifications.external_channel_unavailable': text({
    de: 'Ein Benachrichtigungskanal ist nicht mehr verfügbar. Prüfen Sie Ihre Einstellungen in der App.',
    en: 'A notification channel became unavailable. Check your settings in the app.',
    it: 'Un canale di notifica non è più disponibile. Controlla le impostazioni nell’app.',
    ro: 'Un canal de notificare nu mai este disponibil. Verifică setările în aplicație.',
    ru: 'Один из каналов уведомлений стал недоступен. Проверьте настройки в приложении.',
    uk: 'Один із каналів сповіщень став недоступним. Перевірте налаштування в застосунку.',
  }),
  'church.address.updated': text({
    de: 'Die Adresse einer mit Ihrer Fahrt verbundenen Kirche wurde geändert. Prüfen Sie die aktuellen Angaben in der App.',
    en: 'The address of a church linked to your ride was changed. Check the current details in the app.',
    it: 'L’indirizzo di una chiesa collegata al tuo viaggio è stato modificato. Controlla i dettagli attuali nell’app.',
    ro: 'Adresa unei biserici asociate călătoriei tale a fost modificată. Verifică detaliile actuale în aplicație.',
    ru: 'Адрес храма, связанного с вашей поездкой, изменён. Проверьте актуальные сведения в приложении.',
    uk: 'Адресу храму, пов’язаного з вашою поїздкою, змінено. Перевірте актуальні відомості в застосунку.',
  }),
  'church.service.updated': text({
    de: 'Die Angaben zu einem mit Ihrer Fahrt verbundenen Gottesdienst wurden geändert. Prüfen Sie die aktuellen Angaben in der App.',
    en: 'Details of a service linked to your ride were changed. Check the current details in the app.',
    it: 'I dettagli di una funzione collegata al tuo viaggio sono stati modificati. Controlla i dettagli attuali nell’app.',
    ro: 'Detaliile unei slujbe asociate călătoriei tale au fost modificate. Verifică detaliile actuale în aplicație.',
    ru: 'Сведения о службе, связанной с вашей поездкой, изменены. Проверьте актуальные сведения в приложении.',
    uk: 'Відомості про службу, пов’язану з вашою поїздкою, змінено. Перевірте актуальні відомості в застосунку.',
  }),
  'church.service.rescheduled': text({
    de: 'Der Termin eines mit Ihrer Fahrt verbundenen Gottesdienstes wurde geändert. Prüfen Sie die aktuellen Angaben in der App.',
    en: 'The date or time of a service linked to your ride was changed. Check the current details in the app.',
    it: 'La data o l’orario di una funzione collegata al tuo viaggio è stato modificato. Controlla i dettagli attuali nell’app.',
    ro: 'Data sau ora unei slujbe asociate călătoriei tale a fost modificată. Verifică detaliile actuale în aplicație.',
    ru: 'Дата или время службы, связанной с вашей поездкой, изменены. Проверьте актуальные сведения в приложении.',
    uk: 'Дату або час служби, пов’язаної з вашою поїздкою, змінено. Перевірте актуальні відомості в застосунку.',
  }),
  'church.service.cancelled': text({
    de: 'Ein mit Ihrer Fahrt verbundener Gottesdienst wurde abgesagt. Prüfen Sie die aktuellen Angaben in der App.',
    en: 'A service linked to your ride was cancelled. Check the current details in the app.',
    it: 'Una funzione collegata al tuo viaggio è stata annullata. Controlla i dettagli attuali nell’app.',
    ro: 'O slujbă asociată călătoriei tale a fost anulată. Verifică detaliile actuale în aplicație.',
    ru: 'Служба, связанная с вашей поездкой, отменена. Проверьте актуальные сведения в приложении.',
    uk: 'Службу, пов’язану з вашою поїздкою, скасовано. Перевірте актуальні відомості в застосунку.',
  }),
} as const;

type CopyKey = keyof typeof preparedNotificationCopy;

export function getPreparedNotificationText(key: string, language: string) {
  const resolvedKey: CopyKey = Object.hasOwn(preparedNotificationCopy, key) ? key as CopyKey : 'notifications.update';
  const entry = preparedNotificationCopy[resolvedKey];
  const resolvedLanguage: Language = Object.hasOwn(entry.translations, language) ? language as Language : 'en';
  return {
    key: resolvedKey,
    language: resolvedLanguage,
    text: entry.translations[resolvedLanguage],
    version: entry.version,
  };
}
