import { createEmailProofMailer, type EmailProofCopy, type EmailProofLanguage } from '@/lib/notifications/email-proof';

export const DELETION_PROOF_COPY_VERSION = 1;
export const deletionProofCopy: Readonly<Record<EmailProofLanguage, EmailProofCopy>> = {
  en: { subject: 'Confirm your Orthodox Routes account deletion', body: 'You requested deletion of your Orthodox Routes account. Open the link to review and confirm the request.', action: 'Review deletion request', ignore: 'If you did not request this, ignore this email.' },
  ru: { subject: 'Подтвердите удаление аккаунта Orthodox Routes', body: 'Вы запросили удаление аккаунта Orthodox Routes. Откройте ссылку, чтобы проверить и подтвердить запрос.', action: 'Проверить запрос на удаление', ignore: 'Если вы этого не запрашивали, проигнорируйте письмо.' },
  uk: { subject: 'Підтвердьте видалення облікового запису Orthodox Routes', body: 'Ви надіслали запит на видалення облікового запису Orthodox Routes. Відкрийте посилання, щоб перевірити та підтвердити запит.', action: 'Перевірити запит на видалення', ignore: 'Якщо ви цього не запитували, проігноруйте лист.' },
  de: { subject: 'Löschung Ihres Orthodox Routes-Kontos bestätigen', body: 'Sie haben die Löschung Ihres Orthodox Routes-Kontos angefordert. Öffnen Sie den Link, um die Anfrage zu prüfen und zu bestätigen.', action: 'Löschanfrage prüfen', ignore: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.' },
  it: { subject: 'Conferma la cancellazione del tuo account Orthodox Routes', body: 'Hai richiesto la cancellazione del tuo account Orthodox Routes. Apri il link per verificare e confermare la richiesta.', action: 'Verifica la richiesta di cancellazione', ignore: 'Se non hai fatto questa richiesta, ignora questa email.' },
  ro: { subject: 'Confirmați ștergerea contului Orthodox Routes', body: 'Ați solicitat ștergerea contului Orthodox Routes. Deschideți linkul pentru a verifica și confirma solicitarea.', action: 'Verificați solicitarea de ștergere', ignore: 'Dacă nu ați solicitat acest lucru, ignorați acest email.' },
};

// Prepared server contract only. No route or scheduler calls this sender until
// the explicit confirmation and destructive lifecycle are ready for activation.
const mailer = createEmailProofMailer({
  idField: 'request_id', claimRpc: 'account_deletion_confirmation_mail_claim',
  completeRpc: 'account_deletion_confirmation_mail_complete', eventType: 'account.deletion.email.proof',
  copy: deletionProofCopy, path: (job) => `/${job.language}/profile`, fragmentIdKey: 'deletion-request',
});
export const parseDeletionProofJob = mailer.parse;
export const renderDeletionProofMail = mailer.render;
export const processDeletionProofMail = mailer.process;
