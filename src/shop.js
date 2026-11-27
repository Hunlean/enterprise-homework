// Business logic shared by the WEBSITE and the TELEGRAM BOT.
// Both channels call createOrder(), so every order ends up in the same place.
const db = require('./db');

const STATUSES = ['pending', 'confirmed', 'packing', 'delivering', 'completed', 'cancelled'];
// Free delivery in Phnom Penh for orders of $100 or more, otherwise $2
const FREE_DELIVERY_FROM = 100;
const DELIVERY_FEE = 2;

function listProducts() {
  return db.load().products;
}

function getProduct(id) {
  return listProducts().find(p => p.id === Number(id));
}

function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// items: [{ productId, qty }]  -> validated lines with prices taken from the database
function priceItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('Cart is empty');
  const lines = items.map(it => {
    const product = getProduct(it.productId);
    const qty = Math.floor(Number(it.qty));
    if (!product) throw new Error('Unknown product: ' + it.productId);
    if (!(qty >= 1 && qty <= 20)) throw new Error('Invalid quantity for ' + product.name);
    return { productId: product.id, name: product.name, emoji: product.emoji, price: product.price, qty, lineTotal: +(product.price * qty).toFixed(2) };
  });
  const subtotal = +lines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2);
  const deliveryFee = subtotal >= FREE_DELIVERY_FROM ? 0 : DELIVERY_FEE;
  return { lines, subtotal, deliveryFee, total: +(subtotal + deliveryFee).toFixed(2) };
}

function clean(s, max = 200) {
  return String(s || '').trim().slice(0, max);
}

// customer: { name, phone, address, note }
// channel: 'website' | 'telegram' (chat bot) | 'mini-app' (website opened inside Telegram)
function createOrder({ items, customer, channel, payment, telegramChatId }) {
  const c = { name: clean(customer?.name, 80), phone: clean(customer?.phone, 30), address: clean(customer?.address, 300), note: clean(customer?.note, 300) };
  if (!c.name) throw new Error('Name is required');
  if (!/^[0-9+\-\s]{6,20}$/.test(c.phone)) throw new Error('Please enter a valid phone number');
  if (!c.address) throw new Error('Address is required');

  const priced = priceItems(items);
  const data = db.load();
  data.lastOrderNumber += 1;
  const order = {
    id: 'ORD-' + data.lastOrderNumber,
    channel,
    status: 'pending',
    customer: c,
    payment: payment === 'khqr' ? 'khqr' : 'cash',
    ...priced,
    telegramChatId: telegramChatId || null,
    createdAt: new Date().toISOString(),
    history: [{ status: 'pending', at: new Date().toISOString() }]
  };
  data.orders.push(order);
  db.save();
  return order;
}

function getOrder(id) {
  return db.load().orders.find(o => o.id.toUpperCase() === String(id).trim().toUpperCase());
}

function listOrders() {
  return [...db.load().orders].reverse();
}

function updateStatus(id, status) {
  if (!STATUSES.includes(status)) throw new Error('Invalid status');
  const order = getOrder(id);
  if (!order) throw new Error('Order not found');
  order.status = status;
  order.history.push({ status, at: new Date().toISOString() });
  db.save();
  return order;
}

// Link a Telegram chat to a website order (so the bot can send status updates)
function linkTelegram(id, chatId) {
  const order = getOrder(id);
  if (!order) return null;
  order.telegramChatId = chatId;
  db.save();
  return order;
}

function orderSummary(order) {
  const lines = order.lines.map(l => `${l.emoji} ${l.qty} x ${l.name} = ${money(l.lineTotal)}`).join('\n');
  return `Order ${order.id}  (${order.status.toUpperCase()})\n${lines}\nDelivery: ${order.deliveryFee ? money(order.deliveryFee) : 'FREE'}\nTotal: ${money(order.total)}`;
}

module.exports = { STATUSES, listProducts, getProduct, priceItems, createOrder, getOrder, listOrders, updateStatus, linkTelegram, orderSummary, money };
