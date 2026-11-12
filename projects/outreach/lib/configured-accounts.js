import store from './store.js';

/** @param {string} mid @param {{mail?:object,whatsapp?:object}} config */
export function syncServiceAccounts(mid, config) {
  const suffix = store.sha256(mid).slice(0, 16);
  const mailbox = config.mail || {};
  if (mailbox.host && mailbox.from_address && mailbox.password) {
    const id = 'platform-mail-' + suffix;
    let account = store.findIn('mailAccounts', mid, id);
    if (!account) account = store.add('mailAccounts', mid, { id, sentToday: 0, sentTotal: 0 }, 'm');
    Object.assign(account, {
      label: '平台配置邮箱', source: 'platform', email: mailbox.from_address,
      fromName: mailbox.from_name || '', pass: mailbox.password, status: 'ready',
      imap: { host: mailbox.imap_host || '', port: mailbox.imap_port || 993, secure: mailbox.imap_secure !== false, user: mailbox.username || mailbox.from_address, pass: mailbox.password },
      smtp: { host: mailbox.host, port: mailbox.port || 465, secure: mailbox.secure !== false, user: mailbox.username || mailbox.from_address, pass: mailbox.password },
    });
  } else {
    const account = store.findIn('mailAccounts', mid, 'platform-mail-' + suffix);
    if (account) { account.status = 'unconfigured'; account.pass = ''; account.smtp.pass = ''; account.imap.pass = ''; }
  }
  const whatsapp = config.whatsapp || {};
  if (['http', 'meta'].includes(whatsapp.provider) && whatsapp.base_url && whatsapp.api_key && whatsapp.phone_number_id) {
    const id = 'platform-wa-' + suffix;
    let account = store.findIn('waAccounts', mid, id);
    if (!account) account = store.add('waAccounts', mid, { id, sentToday: 0, sentTotal: 0 }, 'wa');
    Object.assign(account, { label: '平台WhatsApp', source: 'platform', provider: whatsapp.provider });
  }
  store.saveNow();
}
