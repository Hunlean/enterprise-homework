// Telegram bot: lets customers order by chatting, without a mobile app.
// It uses "long polling" (the server keeps asking Telegram "any new messages?"),
// so it works on your laptop without a public URL or HTTPS.
const shop = require('./shop');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SHOP = process.env.SHOP_NAME || 'XCYZ Phone Shop';
const SITE = process.env.SITE_URL || 'http://localhost:3000';

let botUsername = null;
let running = false;

// Per-chat state: cart + checkout step. Kept in memory (resets when server restarts).
const sessions = new Map();
function session(chatId) {
  if (!sessions.has(chatId)) sessions.set(chatId, { cart: [], step: null, draft: {} });
  return sessions.get(chatId);
}

const MAIN_KEYBOARD = {
  keyboard: [[{ text: '🛍 Products' }, { text: '🛒 Cart' }], [{ text: '📦 My orders' }, { text: '🌐 Website' }]],
  resize_keyboard: true
};

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result;
}

function send(chatId, text, extra = {}) {
  return call('sendMessage', { chat_id: chatId, text, ...extra });
}

// ---------- Screens ----------
function menuMessage() {
  const products = shop.listProducts();
  const text = `${SHOP} products\nTap an item to add it to your cart.\n\n` +
    products.map(p => `${p.emoji} ${p.name} - ${shop.money(p.price)}\n   ${p.description}`).join('\n');
  const rows = products.map(p => [{ text: `➕ ${p.name} ${shop.money(p.price)}`, callback_data: `add:${p.id}` }]);
  rows.push([{ text: '🛒 View cart', callback_data: 'cart' }]);
  return { text, reply_markup: { inline_keyboard: rows } };
}

function cartMessage(chatId) {
  const s = session(chatId);
  if (s.cart.length === 0) {
    return { text: 'Your cart is empty. Tap 🛍 Products to add items.', reply_markup: { inline_keyboard: [[{ text: '🛍 Products', callback_data: 'menu' }]] } };
  }
  const priced = shop.priceItems(s.cart);
  const text = '🛒 Your cart\n\n' +
    priced.lines.map(l => `${l.emoji} ${l.qty} x ${l.name} = ${shop.money(l.lineTotal)}`).join('\n') +
    `\n\nSubtotal: ${shop.money(priced.subtotal)}\nDelivery: ${priced.deliveryFee ? shop.money(priced.deliveryFee) : 'FREE'}\nTotal: ${shop.money(priced.total)}`;
  const rows = priced.lines.map(l => [
    { text: `➖ ${l.name}`, callback_data: `dec:${l.productId}` },
    { text: `➕`, callback_data: `inc:${l.productId}` }
  ]);
  rows.push([{ text: '🗑 Clear', callback_data: 'clear' }, { text: '✅ Checkout', callback_data: 'checkout' }]);
  return { text, reply_markup: { inline_keyboard: rows } };
}

function addToCart(chatId, productId, delta) {
  const s = session(chatId);
  const line = s.cart.find(i => i.productId === productId);
  if (line) line.qty += delta;
  else if (delta > 0) s.cart.push({ productId, qty: delta });
  s.cart = s.cart.filter(i => i.qty > 0);
  const now = s.cart.find(i => i.productId === productId);
  return now ? now.qty : 0;
}

function myOrders(chatId) {
  const orders = shop.listOrders().filter(o => o.telegramChatId === chatId).slice(0, 5);
  if (orders.length === 0) return 'You have no orders yet. Tap 🛍 Products to start.';
  return 'Your latest orders:\n\n' + orders.map(o => shop.orderSummary(o)).join('\n\n');
}

// ---------- Checkout conversation ----------
async function startCheckout(chatId) {
  const s = session(chatId);
  if (s.cart.length === 0) return send(chatId, 'Your cart is empty.', { reply_markup: MAIN_KEYBOARD });
  s.step = 'name';
  s.draft = {};
  return send(chatId, 'Checkout (type "cancel" any time to stop)\n\n1/3 What is your name?', { reply_markup: { remove_keyboard: true } });
}

async function handleCheckoutStep(chatId, msg) {
  const s = session(chatId);
  const text = (msg.text || '').trim();
  if (/^cancel$/i.test(text)) {
    s.step = null;
    return send(chatId, 'Checkout cancelled. Your cart is kept.', { reply_markup: MAIN_KEYBOARD });
  }
  if (s.step === 'name') {
    if (!text) return send(chatId, 'Please type your name.');
    s.draft.name = text;
    s.step = 'phone';
    return send(chatId, '2/3 Your phone number? Tap the button to share it, or type it.', {
      reply_markup: { keyboard: [[{ text: '📱 Share my phone number', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
    });
  }
  if (s.step === 'phone') {
    const phone = msg.contact ? msg.contact.phone_number : text;
    if (!/^[0-9+\-\s]{6,20}$/.test(phone || '')) return send(chatId, 'That does not look like a phone number. Please try again.');
    s.draft.phone = phone;
    s.step = 'address';
    return send(chatId, '3/3 Delivery address?', { reply_markup: { remove_keyboard: true } });
  }
  if (s.step === 'address') {
    if (!text) return send(chatId, 'Please type your delivery address.');
    s.draft.address = text;
    s.step = 'payment';
    return send(chatId, 'How would you like to pay?', {
      reply_markup: { inline_keyboard: [[{ text: '💵 Cash on delivery', callback_data: 'pay:cash' }, { text: '📲 ABA KHQR', callback_data: 'pay:khqr' }]] }
    });
  }
  return send(chatId, 'Please choose one of the buttons above, or type "cancel".');
}

async function showConfirm(chatId) {
  const s = session(chatId);
  const priced = shop.priceItems(s.cart);
  const d = s.draft;
  const text = 'Please confirm your order:\n\n' +
    priced.lines.map(l => `${l.emoji} ${l.qty} x ${l.name} = ${shop.money(l.lineTotal)}`).join('\n') +
    `\nDelivery: ${priced.deliveryFee ? shop.money(priced.deliveryFee) : 'FREE'}\nTotal: ${shop.money(priced.total)}\n\n` +
    `Name: ${d.name}\nPhone: ${d.phone}\nAddress: ${d.address}\nPayment: ${d.payment === 'khqr' ? 'ABA KHQR' : 'Cash on delivery'}`;
  s.step = 'confirm';
  return send(chatId, text, { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel' }, { text: '✅ Place order', callback_data: 'confirm' }]] } });
}

async function placeOrder(chatId) {
  const s = session(chatId);
  const order = shop.createOrder({ items: s.cart, customer: s.draft, channel: 'telegram', payment: s.draft.payment, telegramChatId: chatId });
  s.cart = [];
  s.step = null;
  s.draft = {};
  return send(chatId,
    `🎉 Thank you! Your order has been placed.\n\n${shop.orderSummary(order)}\n\nWe will message you here when the status changes.\nTrack online: ${SITE}/order.html?id=${order.id}`,
    { reply_markup: MAIN_KEYBOARD });
}

// ---------- Update router ----------
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const s = session(chatId);

  // /start ORD-1001  -> customer came from the website "Track on Telegram" button
  const start = text.match(/^\/start(?:\s+(\S+))?/);
  if (start) {
    s.step = null;
    if (start[1]) {
      const order = shop.linkTelegram(start[1], chatId);
      if (order) return send(chatId, `✅ Telegram linked to your order. You will get updates here.\n\n${shop.orderSummary(order)}`, { reply_markup: MAIN_KEYBOARD });
    }
    return send(chatId, `Welcome to ${SHOP}, ${msg.from.first_name || 'friend'}! 📱\nOrder here in Telegram, no app needed.\n\nTap 🛍 Products to begin.`, { reply_markup: MAIN_KEYBOARD });
  }

  if (s.step && s.step !== 'payment' && s.step !== 'confirm') return handleCheckoutStep(chatId, msg);
  if (s.step && /^cancel$/i.test(text)) return handleCheckoutStep(chatId, msg);

  if (/menu|product/i.test(text)) { const m = menuMessage(); return send(chatId, m.text, { reply_markup: m.reply_markup }); }
  if (/cart/i.test(text)) { const m = cartMessage(chatId); return send(chatId, m.text, { reply_markup: m.reply_markup }); }
  if (/order/i.test(text) && !/^\/track/i.test(text)) return send(chatId, myOrders(chatId));
  if (/website/i.test(text)) return send(chatId, `Visit our website: ${SITE}`);
  const track = text.match(/^\/track\s+(\S+)/i);
  if (track) {
    const o = shop.getOrder(track[1]);
    return send(chatId, o ? shop.orderSummary(o) : 'Order not found.');
  }
  return send(chatId, 'Sorry, I did not understand. Use the buttons below 👇', { reply_markup: MAIN_KEYBOARD });
}

async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const [action, arg] = cb.data.split(':');
  const s = session(chatId);
  let toast = '';

  const editCart = () => {
    const m = cartMessage(chatId);
    return call('editMessageText', { chat_id: chatId, message_id: messageId, text: m.text, reply_markup: m.reply_markup }).catch(() => {});
  };

  if (action === 'add') {
    const p = shop.getProduct(arg);
    const qty = addToCart(chatId, p.id, 1);
    toast = `Added ${p.name} (${qty} in cart)`;
  } else if (action === 'inc' || action === 'dec') {
    addToCart(chatId, Number(arg), action === 'inc' ? 1 : -1);
    await editCart();
  } else if (action === 'clear') {
    s.cart = [];
    await editCart();
  } else if (action === 'menu') {
    const m = menuMessage();
    await send(chatId, m.text, { reply_markup: m.reply_markup });
  } else if (action === 'cart') {
    const m = cartMessage(chatId);
    await send(chatId, m.text, { reply_markup: m.reply_markup });
  } else if (action === 'checkout') {
    await startCheckout(chatId);
  } else if (action === 'pay' && s.step === 'payment') {
    s.draft.payment = arg;
    await showConfirm(chatId);
  } else if (action === 'confirm' && s.step === 'confirm') {
    await placeOrder(chatId);
  } else if (action === 'cancel') {
    s.step = null;
    await send(chatId, 'Order cancelled. Your cart is kept.', { reply_markup: MAIN_KEYBOARD });
  }
  await call('answerCallbackQuery', { callback_query_id: cb.id, text: toast }).catch(() => {});
}

async function handleUpdate(update) {
  try {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query);
  } catch (err) {
    console.error('[telegram] error handling update:', err.message);
    const chatId = update.message?.chat.id || update.callback_query?.message.chat.id;
    if (chatId) send(chatId, '⚠️ ' + err.message).catch(() => {});
  }
}

// ---------- Long polling loop ----------
async function poll() {
  let offset = 0;
  while (running) {
    try {
      const updates = await call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u);
      }
    } catch (err) {
      console.error('[telegram] polling error:', err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function start() {
  if (!TOKEN) {
    console.log('[telegram] TELEGRAM_BOT_TOKEN not set, bot is disabled (website still works).');
    return;
  }
  try {
    const me = await call('getMe');
    botUsername = me.username;
    await call('deleteWebhook'); // make sure polling is allowed
    await call('setMyCommands', { commands: [
      { command: 'start', description: 'Start / main menu' },
      { command: 'track', description: 'Track an order, e.g. /track ORD-1001' }
    ] });
    running = true;
    console.log(`[telegram] Bot @${botUsername} is running. Open https://t.me/${botUsername}`);
    poll();
  } catch (err) {
    console.error('[telegram] could not start bot:', err.message);
  }
}

// Called by the admin page when an order status changes
async function notifyStatus(order) {
  if (!running || !order.telegramChatId) return;
  const labels = { confirmed: '✅ Confirmed', packing: '📦 Being packed', delivering: '🛵 Out for delivery', completed: '🎉 Delivered. Enjoy your new device!', cancelled: '❌ Cancelled' };
  await send(order.telegramChatId, `Update for ${order.id}: ${labels[order.status] || order.status}`).catch(e => console.error('[telegram] notify failed:', e.message));
}

module.exports = { start, notifyStatus, handleUpdate, getUsername: () => botUsername };
