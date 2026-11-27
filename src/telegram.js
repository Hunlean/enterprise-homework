// Telegram integration. Customers can order in TWO ways inside Telegram:
//  1. Chat bot: menus, buttons and a checkout conversation.
//  2. Mini App: the shop website opens INSIDE Telegram (needs an https SITE_URL).
// The bot uses "long polling" (the server keeps asking Telegram "any new messages?"),
// so the chat bot works on your laptop without a public URL.
const crypto = require('crypto');
const shop = require('./shop');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const SHOP = process.env.SHOP_NAME || 'XCYZ Phone Shop';
const SITE = process.env.SITE_URL || 'http://localhost:3000';

// Mini Apps must be served over HTTPS (e.g. an ngrok URL), so only enable them then
const MINI_APP = SITE.startsWith('https://');

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

// Some home/school networks have flaky IPv6 to api.telegram.org, which makes Node's
// fetch fail with "fetch failed". Prefer IPv4 and retry short network errors.
require('dns').setDefaultResultOrder('ipv4first');

async function call(method, body, attempt = 1) {
  let res;
  try {
    res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 15000)
    });
  } catch (err) {
    // Network problem (not a Telegram error): try again up to 3 times
    const reason = err.cause?.code || err.cause?.message || err.name;
    if (attempt < 3) {
      console.warn(`[telegram] ${method} network error (${reason}), retrying...`);
      await new Promise(r => setTimeout(r, 700 * attempt));
      return call(method, body, attempt + 1);
    }
    const e = new Error(`Network error talking to Telegram (${reason})`);
    e.network = true;
    throw e;
  }
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result;
}

function send(chatId, text, extra = {}) {
  return call('sendMessage', { chat_id: chatId, text, ...extra });
}

// Inline button that opens the website as a Mini App inside Telegram
function openShopButton(path = '/') {
  return { text: '🛍 Open shop', web_app: { url: SITE + path } };
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
    // Move to the next step only after the question was delivered,
    // so a network error never leaves the customer on a step they didn't see.
    await send(chatId, '2/3 Your phone number? Tap the button to share it, or type it.', {
      reply_markup: { keyboard: [[{ text: '📱 Share my phone number', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }
    });
    s.step = 'phone';
    return;
  }
  if (s.step === 'phone') {
    const phone = msg.contact ? msg.contact.phone_number : text;
    if (!/^[0-9+\-\s]{6,20}$/.test(phone || '')) return send(chatId, 'That does not look like a phone number. Please try again.');
    s.draft.phone = phone;
    await send(chatId, '3/3 Delivery address?', { reply_markup: { remove_keyboard: true } });
    s.step = 'address';
    return;
  }
  if (s.step === 'address') {
    if (!text) return send(chatId, 'Please type your delivery address.');
    s.draft.address = text;
    await send(chatId, 'How would you like to pay?', {
      reply_markup: { inline_keyboard: [[{ text: '💵 Cash on delivery', callback_data: 'pay:cash' }, { text: '📲 ABA KHQR', callback_data: 'pay:khqr' }]] }
    });
    s.step = 'payment';
    return;
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
    await send(chatId, `Welcome to ${SHOP}, ${msg.from.first_name || 'friend'}! 📱\nOrder here in Telegram, no app needed.\n\nTap 🛍 Products to order by chat.`, { reply_markup: MAIN_KEYBOARD });
    if (MINI_APP) return send(chatId, 'Or browse our full shop without leaving Telegram 👇', { reply_markup: { inline_keyboard: [[openShopButton()]] } });
    return;
  }

  if (s.step && s.step !== 'payment' && s.step !== 'confirm') return handleCheckoutStep(chatId, msg);
  if (s.step && /^cancel$/i.test(text)) return handleCheckoutStep(chatId, msg);

  if (/menu|product/i.test(text)) { const m = menuMessage(); return send(chatId, m.text, { reply_markup: m.reply_markup }); }
  if (/cart/i.test(text)) { const m = cartMessage(chatId); return send(chatId, m.text, { reply_markup: m.reply_markup }); }
  if (/order/i.test(text) && !/^\/track/i.test(text)) return send(chatId, myOrders(chatId));
  if (/website/i.test(text)) {
    if (MINI_APP) return send(chatId, 'Open our shop right here in Telegram:', { reply_markup: { inline_keyboard: [[openShopButton()]] } });
    return send(chatId, `Visit our website: ${SITE}`);
  }
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
    const text = err.network
      ? '⚠️ Connection problem, please send your last message again.'
      : '⚠️ ' + err.message;
    if (chatId) send(chatId, text).catch(() => {});
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
    // The "menu" button next to the message box opens the Mini App
    await call('setChatMenuButton', { menu_button: MINI_APP
      ? { type: 'web_app', text: 'Shop', web_app: { url: SITE } }
      : { type: 'commands' } });
    if (!MINI_APP) console.log('[telegram] Mini App is off: set SITE_URL to an https address (e.g. ngrok) to turn it on.');
    running = true;
    console.log(`[telegram] Bot @${botUsername} is running. Open https://t.me/${botUsername}`);
    poll();
  } catch (err) {
    console.error('[telegram] could not start bot:', err.message);
  }
}

// ---------- Mini App security ----------
// The Mini App sends Telegram's "initData" string with each order. Telegram signs it
// with our bot token, so we can prove which Telegram user placed the order.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData, maxAgeSeconds = 24 * 3600) {
  if (!TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (expected.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date')) > maxAgeSeconds) return null;
  try { return JSON.parse(params.get('user')); } catch { return null; }
}

// Confirmation message in the chat after ordering in the Mini App
async function notifyNewOrder(order) {
  if (!running || !order.telegramChatId) return;
  await send(order.telegramChatId, `🎉 Thank you! We received your order.\n\n${shop.orderSummary(order)}\n\nWe will message you here when the status changes.`)
    .catch(e => console.error('[telegram] notify failed:', e.message));
}

// Called by the admin page when an order status changes
async function notifyStatus(order) {
  if (!running || !order.telegramChatId) return;
  const labels = { confirmed: '✅ Confirmed', packing: '📦 Being packed', delivering: '🛵 Out for delivery', completed: '🎉 Delivered. Enjoy your new device!', cancelled: '❌ Cancelled' };
  await send(order.telegramChatId, `Update for ${order.id}: ${labels[order.status] || order.status}`).catch(e => console.error('[telegram] notify failed:', e.message));
}

module.exports = { start, notifyStatus, notifyNewOrder, verifyInitData, handleUpdate, getUsername: () => botUsername };
