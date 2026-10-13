import emails from '../shared/super-administrators.json' with { type: 'json' };
const allowedEmails = new Set(emails);
export function isSuperAdministratorEmail(email) {
  return typeof email === 'string' && allowedEmails.has(email.trim().toLowerCase());
}
