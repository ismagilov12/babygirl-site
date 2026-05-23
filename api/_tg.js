// api/_tg.js — Telegram admin notification helper
// Fire-and-forget. Не блокує основну логіку, не валить запит якщо ТГ недоступний.
//
// Env vars (Vercel):
//   TG_BOT_TOKEN       — токен бота від BotFather (той самий loveyourhaire_bot)
//   TG_ADMIN_CHAT_ID   — chat_id адміна (отримати: /start у боті → /api/tg-getchatid)
//
// Якщо env vars не задані — функція тихо повертає {skipped:true}.

const TG_API = 'https://api.telegram.org/bot';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMoney(n) {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return v.toLocaleString('uk-UA', { maximumFractionDigits: 0 }) + ' ₴';
}

function formatPayment(p) {
  if (p === 'card') return '💳 картка';
  if (p === 'cod')  return '📦 наложка (передплата)';
  if (p === 'np')   return '📦 наложка';
  return p || '—';
}

// Низькорівневий wrapper з timeout, щоб не зависнути на cold-start.
async function tgFetch(method, payload, timeoutMs) {
  const token = process.env.TG_BOT_TOKEN;
  if (!token) return { ok: false, skipped: true, reason: 'no-token' };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 3500);
  try {
    const r = await fetch(TG_API + token + '/' + method, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      console.warn('[tg]', method, 'failed', r.status, data.description || data);
      return { ok: false, error: data.description || ('http ' + r.status) };
    }
    return { ok: true, result: data.result };
  } catch (e) {
    console.warn('[tg]', method, 'exception', e.message);
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function sendAdminMessage(html) {
  const chatId = process.env.TG_ADMIN_CHAT_ID;
  if (!chatId) return { ok: false, skipped: true, reason: 'no-chat-id' };
  return await tgFetch('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  });
}

// Повідомлення про нове замовлення (вызывается из api/order.js).
async function notifyAdminNewOrder(order) {
  if (!order) return { ok: false, skipped: true };
  if (order.stage === 'lead') return { ok: false, skipped: true, reason: 'lead-stage' };

  const items = Array.isArray(order.items) ? order.items : [];
  const totalQty = items.reduce((s, it) => s + (parseInt(it.qty || 1, 10)), 0);

  const lines = [];
  lines.push('💖 <b>НОВЕ ЗАМОВЛЕННЯ</b> · <code>' + escapeHtml(order.order_num) + '</code>');
  lines.push('');
  lines.push('👤 ' + escapeHtml(order.fio));
  lines.push('📞 <a href="tel:' + escapeHtml(order.phone) + '">' + escapeHtml(order.phone) + '</a>');
  if (order.city || order.wh) {
    lines.push('🚚 ' + escapeHtml(order.city || '—') + ' · НП №' + escapeHtml(order.wh || '—'));
  }
  lines.push(formatPayment(order.payment));
  lines.push('💰 <b>' + formatMoney(order.total) + '</b> · ' + totalQty + ' шт.');
  lines.push('');

  for (const it of items.slice(0, 15)) {
    const title = (it.title || it.uid || '?') +
      (it.color_name ? ' / ' + it.color_name : '') +
      (it.size ? ' / р.' + it.size : '');
    const unit = parseFloat(it.price) || 0;
    const qty  = parseInt(it.qty || 1, 10);
    lines.push('• ' + escapeHtml(title) + ' × ' + qty + ' = ' + formatMoney(unit * qty));
  }
  if (items.length > 15) lines.push('… і ще ' + (items.length - 15));

  if (order.comment) {
    lines.push('');
    lines.push('💬 ' + escapeHtml(order.comment));
  }
  if (order.referrer) {
    lines.push('');
    lines.push('🔗 <i>' + escapeHtml(String(order.referrer).slice(0, 120)) + '</i>');
  }

  return await sendAdminMessage(lines.join('\n'));
}

// Повідомлення про оплату (вызывается из wayforpay-callback.js).
async function notifyAdminPaymentApproved(info) {
  if (!info || !info.orderReference) return { ok: false, skipped: true };
  const lines = [];
  lines.push('✅ <b>ОПЛАТА ОТРИМАНА</b> · <code>' + escapeHtml(info.orderReference) + '</code>');
  if (info.amount != null) lines.push('💰 ' + formatMoney(info.amount));
  if (info.cardPan)        lines.push('💳 ' + escapeHtml(info.cardPan));
  if (info.authCode)       lines.push('🔢 auth ' + escapeHtml(info.authCode));
  return await sendAdminMessage(lines.join('\n'));
}

// Fire-and-forget обгортка — НЕ кидає, не await блокує.
function fireAndForget(p) {
  Promise.resolve(p).catch(e => console.warn('[tg/fire]', e && e.message || e));
}

module.exports = {
  sendAdminMessage,
  notifyAdminNewOrder,
  notifyAdminPaymentApproved,
  fireAndForget
};
