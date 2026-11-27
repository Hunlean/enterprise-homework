// Website front end: product list, cart (saved in the browser), checkout.
const $ = s => document.querySelector(s);
const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// When this page is opened as a Telegram Mini App, Telegram gives us window.Telegram.WebApp
const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null;

let products = [];
let filter = 'All';
let cart = loadCart(); // [{ productId, qty }]

function loadCart() { try { return JSON.parse(localStorage.getItem('cart')) || []; } catch { return []; } }
function saveCart() { try { localStorage.setItem('cart', JSON.stringify(cart)); } catch {} renderCount(); }
function renderCount() {
  const n = cart.reduce((s, i) => s + i.qty, 0);
  $('#cartCount').textContent = n;
  // Inside Telegram: show Telegram's own big bottom button for the cart
  if (tg) {
    if (n > 0 && !$('#drawer').classList.contains('open')) { tg.MainButton.setText(`View cart (${n})`); tg.MainButton.show(); }
    else tg.MainButton.hide();
  }
}

function setupTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  document.body.classList.add('in-telegram');
  try { tg.setHeaderColor('#0b0b0f'); } catch {}
  tg.MainButton.color = '#0f62fe';
  tg.MainButton.onClick(openDrawer);
  tg.BackButton.onClick(closeDrawer);
}

async function init() {
  const [config, list] = await Promise.all([fetch('/api/config').then(r => r.json()), fetch('/api/products').then(r => r.json())]);
  document.querySelectorAll('.shop-name').forEach(e => e.textContent = config.shopName);
  document.title = config.shopName;
  if (config.telegramBot && !tg) { const a = $('#tgHero'); a.href = `https://t.me/${config.telegramBot}`; a.style.display = 'inline-flex'; }
  products = list;
  renderFilters(); renderGrid(); renderCount();
}

function renderFilters() {
  const cats = ['All', ...new Set(products.map(p => p.category)), ...new Set(products.map(p => p.brand).filter(b => b !== 'Generic'))];
  $('#filters').innerHTML = cats.map(c => `<button class="chip ${c === filter ? 'active' : ''}" data-f="${esc(c)}">${esc(c)}</button>`).join('');
}
$('#filters').onclick = e => { if (e.target.dataset.f) { filter = e.target.dataset.f; renderFilters(); renderGrid(); } };

function renderGrid() {
  const shown = products.filter(p => filter === 'All' || p.category === filter || p.brand === filter);
  $('#grid').innerHTML = shown.map(p => `
    <div class="card">
      <div class="pic" style="--tint:${productColor(p)}">${icon(productIcon(p), 64)}</div>
      <span class="brand">${esc(p.brand)}</span>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.description)}</p>
      <div class="row"><span class="price">${money(p.price)}</span>
      <button class="btn btn-primary" data-add="${p.id}">${icon('plus', 16)}Add</button></div>
    </div>`).join('');
}
$('#grid').onclick = e => {
  const btn = e.target.closest('[data-add]'); if (!btn) return;
  const id = Number(btn.dataset.add);
  const line = cart.find(i => i.productId === id);
  line ? line.qty++ : cart.push({ productId: id, qty: 1 });
  saveCart(); btn.innerHTML = icon('check', 16) + 'Added'; setTimeout(() => btn.innerHTML = icon('plus', 16) + 'Add', 900);
};

// ---------- Cart drawer ----------
function openDrawer() {
  $('#drawer').classList.add('open'); $('#overlay').classList.add('open'); showCart();
  if (tg) { tg.MainButton.hide(); tg.BackButton.show(); }
}
function closeDrawer() {
  $('#drawer').classList.remove('open'); $('#overlay').classList.remove('open');
  if (tg) { tg.BackButton.hide(); renderCount(); }
}
$('#cartBtn').onclick = openDrawer; $('#closeDrawer').onclick = closeDrawer; $('#overlay').onclick = closeDrawer;

async function quote() {
  const r = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: cart }) });
  return r.json();
}

function totalsHtml(q) {
  return `<div class="row"><span>Subtotal</span><span>${money(q.subtotal)}</span></div>
    <div class="row"><span>Delivery</span><span>${q.deliveryFee ? money(q.deliveryFee) : 'FREE'}</span></div>
    <div class="row total"><span>Total</span><span>${money(q.total)}</span></div>`;
}

async function showCart() {
  $('#drawerTitle').textContent = 'Your cart';
  if (cart.length === 0) { $('#drawerBody').innerHTML = `<div class="empty">${icon('cart', 48)}<p>Your cart is empty.</p></div>`; $('#drawerFoot').innerHTML = ''; return; }
  const q = await quote();
  $('#drawerBody').innerHTML = q.lines.map(l => `
    <div class="line"><span class="thumb" style="--tint:${productColor(products.find(p => p.id === l.productId) || {})}">${icon(productIcon(products.find(p => p.id === l.productId) || l), 22)}</span><div class="name">${esc(l.name)}<br><small>${money(l.price)}</small></div>
      <div class="qty"><button data-d="-1" data-id="${l.productId}" aria-label="Less">${icon('minus', 14)}</button><b>${l.qty}</b><button data-d="1" data-id="${l.productId}" aria-label="More">${icon('plus', 14)}</button></div>
    </div>`).join('') + '<br>' + totalsHtml(q);
  $('#drawerFoot').innerHTML = '<button class="btn btn-primary" style="width:100%" id="toCheckout">Checkout</button>';
  $('#toCheckout').onclick = showCheckout;
}
$('#drawerBody').addEventListener('click', e => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  const id = Number(b.dataset.id);
  const line = cart.find(i => i.productId === id); line.qty += Number(b.dataset.d);
  cart = cart.filter(i => i.qty > 0); saveCart(); showCart();
});

// ---------- Checkout ----------
async function showCheckout() {
  const q = await quote();
  $('#drawerTitle').textContent = 'Checkout';
  $('#drawerBody').innerHTML = `
    <form id="checkoutForm">
      <label>Full name</label><input name="name" required maxlength="80">
      <label>Phone number</label><input name="phone" required placeholder="012 345 678" pattern="[0-9+\\-\\s]{6,20}">
      <label>Delivery address</label><textarea name="address" required rows="2"></textarea>
      <label>Note (optional)</label><input name="note" placeholder="e.g. color: black">
      ${tg ? `<p class="tgnote">${icon('send', 14)} Ordering as <b>${esc(tg.initDataUnsafe.user?.first_name || 'Telegram user')}</b>. We will send updates to your Telegram.</p>` : ''}
      <label>Payment</label>
      <select name="payment"><option value="cash">Cash on delivery</option><option value="khqr">ABA KHQR</option></select>
      <br><br>${totalsHtml(q)}
      <div class="error" id="err"></div>
    </form>`;
  $('#drawerFoot').innerHTML = `<button class="btn btn-ghost" id="back">${icon('arrowLeft', 16)}Back</button> <button class="btn btn-primary" id="place">${icon('check', 16)}Place order</button>`;
  $('#back').onclick = showCart;
  // Prefill the name from the Telegram profile
  if (tg && tg.initDataUnsafe.user) {
    const u = tg.initDataUnsafe.user;
    $('[name=name]').value = [u.first_name, u.last_name].filter(Boolean).join(' ');
  }
  $('#place').onclick = placeOrder;
}

async function placeOrder() {
  const form = $('#checkoutForm');
  if (!form.reportValidity()) return;
  const f = Object.fromEntries(new FormData(form));
  $('#place').disabled = true;
  const r = await fetch('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: cart, payment: f.payment,
      customer: { name: f.name, phone: f.phone, address: f.address, note: f.note },
      tgInitData: tg ? tg.initData : undefined // signed by Telegram, checked on the server
    })
  });
  const data = await r.json();
  if (!r.ok) { $('#err').textContent = data.error; $('#place').disabled = false; return; }
  cart = []; saveCart();
  if (tg) tg.HapticFeedback.notificationOccurred('success');
  location.href = `order.html?id=${encodeURIComponent(data.id)}&new=1`;
}

hydrateIcons();
setupTelegram();
init();
