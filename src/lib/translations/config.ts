import { isAbsolute } from 'node:path';

export type GoogleTranslationConfig = {
  projectId: string;
  location: string;
  credentialsFile: string;
  monthlyCharacterLimit: number;
  batchLimit: number;
};

export function getGoogleTranslationConfig(): GoogleTranslationConfig | null {
  if (process.env.ORTHODOX_ROUTES_TRANSLATION_PROVIDER?.trim() !== 'google-cloud') return null;
  const projectId = process.env.GOOGLE_TRANSLATION_PROJECT_ID?.trim();
  const location = process.env.GOOGLE_TRANSLATION_LOCATION?.trim();
  const credentialsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const monthlyCharacterLimit = Number(process.env.TRANSLATION_MONTHLY_CHARACTER_LIMIT?.trim());
  const batchLimit = Number(process.env.TRANSLATION_BATCH_LIMIT?.trim());
  if (!projectId || !/^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{6,20})$/.test(projectId)
    || !location || !/^[a-z][a-z0-9-]{1,39}$/.test(location)
    || !credentialsFile || !isAbsolute(credentialsFile) || credentialsFile.length > 1024
    || /[\u0000-\u001f\u007f]/.test(credentialsFile)
    || !Number.isSafeInteger(monthlyCharacterLimit)
    || monthlyCharacterLimit < 1 || monthlyCharacterLimit > 100_000_000
    || !Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 10) return null;
  return { projectId, location, credentialsFile, monthlyCharacterLimit, batchLimit };
}
