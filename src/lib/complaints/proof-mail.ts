import type { NotificationMessage } from '@/lib/notifications/adapter';
import { createEmailProofMailer, type EmailProofCopy as Copy, type EmailProofLanguage as Language,
  type EmailProofDependencies, type EmailProofJob } from '@/lib/notifications/email-proof';

export const complaintProofCopy: Readonly<Record<Language, Copy>> = {
  en: { subject: 'Confirm your email for Orthodox Routes', body: 'Confirm this email address to continue your report. This message does not mean your report has been received.', action: 'Confirm email', ignore: 'If you did not request this, ignore this email.' },
  ru: { subject: 'Подтвердите email для Orthodox Routes', body: 'Подтвердите этот адрес, чтобы продолжить отправку жалобы. Это письмо не означает, что жалоба уже получена.', action: 'Подтвердить email', ignore: 'Если вы этого не запрашивали, проигнорируйте письмо.' },
  uk: { subject: 'Підтвердьте email для Orthodox Routes', body: 'Підтвердьте цю адресу, щоб продовжити надсилання скарги. Цей лист не означає, що скаргу вже отримано.', action: 'Підтвердити email', ignore: 'Якщо ви цього не запитували, проігноруйте лист.' },
  de: { subject: 'E-Mail für Orthodox Routes bestätigen', body: 'Bestätigen Sie diese E-Mail-Adresse, um Ihre Meldung fortzusetzen. Diese Nachricht bedeutet nicht, dass Ihre Meldung bereits eingegangen ist.', action: 'E-Mail bestätigen', ignore: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.' },
  it: { subject: 'Conferma la tua email per Orthodox Routes', body: 'Conferma questo indirizzo email per continuare la segnalazione. Questo messaggio non significa che la segnalazione sia già stata ricevuta.', action: 'Conferma email', ignore: 'Se non hai fatto questa richiesta, ignora questa email.' },
  ro: { subject: 'Confirmați adresa de email pentru Orthodox Routes', body: 'Confirmați această adresă de email pentru a continua sesizarea. Acest mesaj nu înseamnă că sesizarea a fost deja primită.', action: 'Confirmați emailul', ignore: 'Dacă nu ați solicitat acest lucru, ignorați acest email.' },
};
export const COMPLAINT_PROOF_COPY_VERSION = 1;

const mailer = createEmailProofMailer({
  idField: 'draft_id', claimRpc: 'complaint_proof_mail_claim', completeRpc: 'complaint_proof_mail_complete',
  eventType: 'complaint.email.proof', copy: complaintProofCopy,
  path: (job) => `/${job.language}/report/${job.id}`,
});
type Job = Omit<EmailProofJob, 'id'> & { draftId: string };
// Preserve the established module exports and parsed shape for existing callers.
export function parseComplaintProofJob(value: unknown, now = Date.now(), claimElapsedMs = 0): Job | null {
  const parsed = mailer.parse(value, now, claimElapsedMs);
  if (!parsed) return null;
  const { id, ...rest } = parsed;
  return { draftId: id, ...rest };
}
export function renderComplaintProofMail(job: Job, appOrigin: string): NotificationMessage {
  return mailer.render({ ...job, id: job.draftId }, appOrigin);
}
export function processComplaintProofMail(limit = 5, dependencies: EmailProofDependencies = {}) {
  return mailer.process(limit, dependencies);
}
