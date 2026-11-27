// Very small "database": everything is stored in one JSON file (data/db.json).
// Good enough for a homework demo. In a real company you would use MySQL/PostgreSQL,
// but the rest of the code would stay the same because it only calls these functions.
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

const SEED_PRODUCTS = [
  { id: 1, name: 'iPhone 16 Pro 256GB', brand: 'Apple', category: 'Phones', icon: 'phone', price: 1099, emoji: '📱', description: '6.3" display, A18 Pro chip, 48MP camera.' },
  { id: 2, name: 'iPhone 15 128GB', brand: 'Apple', category: 'Phones', icon: 'phone', price: 699, emoji: '📱', description: '6.1" display, Dynamic Island, USB-C.' },
  { id: 3, name: 'Galaxy S25 Ultra 256GB', brand: 'Samsung', category: 'Phones', icon: 'phone', price: 1199, emoji: '📱', description: '6.9" display, S Pen, 200MP camera.' },
  { id: 4, name: 'Galaxy A56 128GB', brand: 'Samsung', category: 'Phones', icon: 'phone', price: 449, emoji: '📱', description: '6.7" AMOLED, 5000mAh battery.' },
  { id: 5, name: 'Xiaomi 15 256GB', brand: 'Xiaomi', category: 'Phones', icon: 'phone', price: 799, emoji: '📱', description: 'Leica camera, Snapdragon 8 Elite.' },
  { id: 6, name: 'Redmi Note 14 Pro', brand: 'Xiaomi', category: 'Phones', icon: 'phone', price: 299, emoji: '📱', description: '200MP camera, 120Hz AMOLED.' },
  { id: 7, name: 'OPPO Reno 13 5G', brand: 'OPPO', category: 'Phones', icon: 'phone', price: 499, emoji: '📱', description: 'AI portrait camera, 80W fast charge.' },
  { id: 8, name: 'Google Pixel 9 128GB', brand: 'Google', category: 'Phones', icon: 'phone', price: 699, emoji: '📱', description: 'Tensor G4, best-in-class photos.' },
  { id: 9, name: 'AirPods Pro 2', icon: 'headphones', brand: 'Apple', category: 'Accessories', price: 229, emoji: '🎧', description: 'Noise cancelling, USB-C case.' },
  { id: 10, name: '20W USB-C Charger', icon: 'plug', brand: 'Generic', category: 'Accessories', price: 19, emoji: '🔌', description: 'Fast charger for iPhone and Android.' },
  { id: 11, name: 'Clear Phone Case', icon: 'case', brand: 'Generic', category: 'Accessories', price: 9, emoji: '🛡️', description: 'Shockproof case, most models.' },
  { id: 12, name: 'Tempered Glass Protector', icon: 'shield', brand: 'Generic', category: 'Accessories', price: 5, emoji: '🪟', description: '9H hardness screen protector.' }
];

function emptyDb() {
  return { products: SEED_PRODUCTS, orders: [], lastOrderNumber: 1000 };
}

let data;

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    data = emptyDb();
    save();
  }
  return data;
}

function save() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

module.exports = { load, save };
