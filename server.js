// Entry point: starts the website (Express) and the Telegram bot in ONE process.
require('dotenv').config();
const express = require('express');
const path = require('path');
const shop = require('./src/shop');
const telegram = require('./src/telegram');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Public API (used by the website) ----------
app.get('/api/config', (req, res) => {
  res.json({ shopName: process.env.SHOP_NAME || 'XCYZ Phone Shop', telegramBot: telegram.getUsername() });
});

app.get('/api/products', (req, res) => res.json(shop.listProducts()));

// Price a cart without saving (for the checkout summary)
app.post('/api/quote', (req, res) => {
  try { res.json(shop.priceItems(req.body.items)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/orders', (req, res) => {
  try {
    const order = shop.createOrder({ items: req.body.items, customer: req.body.customer, payment: req.body.payment, channel: 'website' });
    res.status(201).json(order);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/orders/:id', (req, res) => {
  const order = shop.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  // Customers see the order but not internal fields
  const { telegramChatId, ...publicOrder } = order;
  res.json({ ...publicOrder, telegramLinked: Boolean(telegramChatId) });
});

// ---------- Admin API (password in the "x-admin-password" header) ----------
function requireAdmin(req, res, next) {
  if (req.get('x-admin-password') !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Wrong admin password' });
  next();
}

app.get('/api/admin/orders', requireAdmin, (req, res) => res.json(shop.listOrders()));

app.patch('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  try {
    const order = shop.updateStatus(req.params.id, req.body.status);
    telegram.notifyStatus(order); // push the update to the customer's Telegram
    res.json(order);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`Website running at http://localhost:${PORT}`);
  console.log(`Admin page:        http://localhost:${PORT}/admin.html`);
  telegram.start();
});
