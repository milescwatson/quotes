import { domainToASCII } from 'node:url';
import { parse } from 'tldts';
import { fail } from './shared.mjs';
// Exact personal-provider domains. Keep regional/legacy aliases here, not company domains hosted by these providers.
export const personalDomains = new Set(`gmail.com googlemail.com yahoo.com yahoo.co.uk yahoo.ca yahoo.com.au yahoo.co.in yahoo.in yahoo.fr yahoo.de yahoo.it yahoo.es yahoo.co.jp ymail.com rocketmail.com outlook.com outlook.co.uk outlook.fr outlook.de hotmail.com hotmail.co.uk hotmail.fr hotmail.de hotmail.it hotmail.es live.com live.co.uk live.ca live.fr msn.com aol.com aim.com icloud.com me.com mac.com proton.me protonmail.com pm.me gmx.com gmx.net gmx.de mail.com fastmail.com hey.com zoho.com yandex.com yandex.ru tutanota.com tuta.com tutamail.com hushmail.com btinternet.com comcast.net verizon.net att.net sbcglobal.net bellsouth.net orange.fr wanadoo.fr laposte.net web.de freenet.de qq.com 163.com 126.com mail.ru inbox.ru bk.ru list.ru`.split(' '));
export function normalizeDomain(value) {
  if (typeof value !== 'string' || value.length > 253 || /[\s/@\\:]/u.test(value)) fail(422,'INVALID_INPUT','Enter a valid email domain.');
  const domain = domainToASCII(value.toLowerCase());
  const parsed = parse(domain);
  if (!domain || domain.endsWith('.') || !parsed.isIcann || !parsed.domain || parsed.isIp || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) fail(422,'INVALID_INPUT','Enter a valid public email domain.');
  return domain;
}
export function workDomain(email) {
  const domain = normalizeDomain(email.slice(email.lastIndexOf('@') + 1));
  return personalDomains.has(domain) ? null : domain;
}
