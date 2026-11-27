# How it works

## The big idea: one backend, many channels

Instead of building a mobile app, the company reuses an app every customer already has: **Telegram**. The website is the main system. Telegram is just another "door" into the same system.

```
   Customer on browser             Customer on Telegram
          │                                 │
          ▼                                 ▼
   Website (HTML/JS)               Telegram servers
          │  REST API (JSON)                │  Bot API (getUpdates / sendMessage)
          ▼                                 ▼
   ┌─────────────────────────────────────────────────┐
   │              Node.js server (server.js)          │
   │   Express routes            Telegram bot module  │
   │            └──────────┬──────────┘               │
   │                 src/shop.js                      │
   │   (prices, validation, createOrder, status)      │
   │                       │                          │
   │                 data/db.json                     │
   └─────────────────────────────────────────────────┘
                          ▲
                          │
                 Admin page (staff)
```

Both the website and the bot call the **same function**, `createOrder()` in `src/shop.js`. That is why every order looks the same in the admin page, and each order just has a `channel` field: `website` or `telegram`.

## 1. Website

- `public/index.html` + `app.js` load products from `GET /api/products`.
- The cart is kept in the browser (`localStorage`), so it survives a page refresh.
- At checkout the browser sends `POST /api/orders` with the items and customer details.
- **Security point:** the browser only sends product IDs and quantities. The **server** looks up the real prices, so a customer cannot change a price in the browser and pay less.
- After ordering, the customer goes to `order.html?id=ORD-1001` to track the order.

## 2. Telegram bot

How Telegram bots work:
1. You create a bot with **@BotFather** and get a secret **token**.
2. Our server asks Telegram for new messages with `getUpdates` (this is called **long polling**: the request waits up to 30 seconds for a message). This is why it works on a laptop without a public website address.
3. For each message, the bot decides what to reply and calls `sendMessage`.

What the bot uses:
- **Reply keyboard** (the big buttons at the bottom): 🛍 Products, 🛒 Cart, 📦 My orders, 🌐 Website.
- **Inline buttons** (buttons under a message): "➕ iPhone 15", "➖", "✅ Checkout". Pressing one sends a `callback_query` to our server.
- **Conversation state**: during checkout, the bot remembers which step each chat is on (`name → phone → address → payment → confirm`) in a `sessions` map.
- **Share contact button**: the customer can send their phone number with one tap.

When the order is confirmed, the bot calls the same `createOrder()` with `channel: 'telegram'` and saves the customer's `telegramChatId`, so the shop can message them later.

## 3. Admin page and notifications

- `admin.html` calls `GET /api/admin/orders` with a password header.
- When staff change a status (`pending → confirmed → packing → delivering → completed`), the server calls `PATCH /api/admin/orders/:id`, saves it, and then `telegram.notifyStatus()` sends the customer a Telegram message.
- Website customers can also get these messages: the tracking page has a **Connect Telegram** button that opens `https://t.me/<bot>?start=ORD-1001`. When they press Start, the bot receives `/start ORD-1001` and links that chat to the order.

## API summary

| Method | Path | Used by | Purpose |
|---|---|---|---|
| GET | `/api/config` | website | shop name, bot username |
| GET | `/api/products` | website | product list |
| POST | `/api/quote` | website | price a cart (subtotal, delivery, total) |
| POST | `/api/orders` | website | create an order |
| GET | `/api/orders/:id` | website | track an order |
| GET | `/api/admin/orders` | admin | list all orders |
| PATCH | `/api/admin/orders/:id` | admin | change status (+ Telegram notification) |

## Why this is "enterprise"-style

- **Separation of concerns:** the channels (website, Telegram) are thin. All business rules live in one place (`shop.js`), so adding another channel later (e.g. WhatsApp, Facebook Messenger) only needs a new adapter file.
- **Single source of truth:** one database for all orders, one admin view.
- **Server-side validation and pricing.**
- **Configuration in `.env`**, not in code (token, password, port), so secrets are not committed to GitHub.

## Limitations / what to improve in production

- Replace the JSON file with a real database (MySQL / PostgreSQL).
- Use a **webhook** instead of long polling when deployed on a server with HTTPS.
- Proper admin login (accounts, hashed passwords, sessions) instead of one shared password.
- Real online payment (e.g. ABA PayWay KHQR) instead of just recording the choice.
- Bot cart/checkout state is in memory, so it resets if the server restarts.
