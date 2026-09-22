import { timingSafeEqual } from 'node:crypto';

export function hasValidBearerSecret(request: Request, expectedSecret: string) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice(7), 'utf8');
  const expected = Buffer.from(expectedSecret, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
