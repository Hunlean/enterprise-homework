// Website front end: product list, cart (saved in the browser), checkout.
const $ = s => document.querySelector(s);
const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let products = [];
let filter = 'All';
let cart = loadCart(); // [{ productId, qty }]

function loadCart() { try { return JSON.parse(localStorage.getItem('cart')) || []; } catch { return []; } }
function saveCart() { try { localStorage.setItem('cart', JSON.stringify(cart)); } catch {} renderCount(); }
function renderCount() { $('#cartCount').textContent = cart.reduce((s, i) => s + i.qty, 0); }

async function init() {
  const [config, list] = await Promise.all([fetch('/api/config').then(r => r.json()), fetch('/api/products').then(r => r.json())]);
  document.querySelectorAll('.shop-name').forEach(e => e.textContent = config.shopName);
  document.title = config.shopName;
  if (config.telegramBot) { const a = $('#tgHero'); a.href = `https://t.me/${config.telegramBot}`; a.style.display = 'inline-flex'; }
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
      <div class="pic">${p.emoji}</div>
      <span class="brand">${esc(p.brand)}</span>
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.description)}</p>
      <div class="row"><span class="price">${money(p.price)}</span>
      <button class="btn btn-primary" data-add="${p.id}">Add</button></div>
    </div>`).join('');
}
$('#grid').onclick = e => {
  const id = Number(e.target.dataset.add); if (!id) return;
  const line = cart.find(i => i.productId === id);
  line ? line.qty++ : cart.push({ productId: id, qty: 1 });
  saveCart(); e.target.textContent = 'Added ✓'; setTimeout(() => e.target.textContent = 'Add', 800);
};

// ---------- Cart drawer ----------
function openDrawer() { $('#drawer').classList.add('open'); $('#overlay').classList.add('open'); showCart(); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#overlay').classList.remove('open'); }
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
  if (cart.length === 0) { $('#drawerBody').innerHTML = '<p>Your cart is empty.</p>'; $('#drawerFoot').innerHTML = ''; return; }
  const q = await quote();
  $('#drawerBody').innerHTML = q.lines.map(l => `
    <div class="line"><span>${l.emoji}</span><div class="name">${esc(l.name)}<br><small>${money(l.price)}</small></div>
      <div class="qty"><button data-d="-1" data-id="${l.productId}">−</button><b>${l.qty}</b><button data-d="1" data-id="${l.productId}">+</button></div>
    </div>`).join('') + '<br>' + totalsHtml(q);
  $('#drawerFoot').innerHTML = '<button class="btn btn-primary" style="width:100%" id="toCheckout">Checkout</button>';
  $('#toCheckout').onclick = showCheckout;
}
$('#drawerBody').addEventListener('click', e => {
  const id = Number(e.target.dataset.id); if (!id) return;
  const line = cart.find(i => i.productId === id); line.qty += Number(e.target.dataset.d);
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
      <label>Payment</label>
      <select name="payment"><option value="cash">Cash on delivery</option><option value="khqr">ABA KHQR</option></select>
      <br><br>${totalsHtml(q)}
      <div class="error" id="err"></div>
    </form>`;
  $('#drawerFoot').innerHTML = `<button class="btn btn-ghost" id="back">Back</button> <button class="btn btn-primary" id="place">Place order</button>`;
  $('#back').onclick = showCart;
  $('#place').onclick = placeOrder;
}

async function placeOrder() {
  const form = $('#checkoutForm');
  if (!form.reportValidity()) return;
  const f = Object.fromEntries(new FormData(form));
  $('#place').disabled = true;
  const r = await fetch('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: cart, payment: f.payment, customer: { name: f.name, phone: f.phone, address: f.address, note: f.note } })
  });
  const data = await r.json();
  if (!r.ok) { $('#err').textContent = data.error; $('#place').disabled = false; return; }
  cart = []; saveCart();
  location.href = `order.html?id=${encodeURIComponent(data.id)}&new=1`;
}

init();
