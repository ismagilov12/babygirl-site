// Shared product categories for Meta feeds. Keep custom_label_0 unchanged:
// existing catalog sets may depend on the original storefront family.
const GROUPS = {
  tee: ['Футболки', 'T-shirts', 'Apparel & Accessories > Clothing > Shirts & Tops'],
  hoodie: ['Худі', 'Hoodies', 'Apparel & Accessories > Clothing > Shirts & Tops'],
  crop: ['Топи', 'Crop tops', 'Apparel & Accessories > Clothing > Shirts & Tops'],
  long: ['Подовжені футболки', 'Longline T-shirts', 'Apparel & Accessories > Clothing > Shirts & Tops'],
  longsleeve: ['Лонгсліви', 'Long-sleeve tops', 'Apparel & Accessories > Clothing > Shirts & Tops'],
  suit: ['Костюми', 'Clothing sets', 'Apparel & Accessories > Clothing'],
  'sexy-set': ['Комплекти білизни', 'Lingerie sets', 'Apparel & Accessories > Clothing > Underwear & Socks > Lingerie'],
  jacket: ['Куртки', 'Jackets', 'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets'],
  accessories: ['Аксесуари', 'Accessories', 'Apparel & Accessories > Clothing Accessories']
};

function category(product, locale) {
  const family = String(product.family || '').toLowerCase();
  const aliases = { icons: 'tee', 'soft-rebel': 'tee', zip: 'hoodie', mask: 'hoodie', belt: 'accessories', accessory: 'accessories' };
  const key = aliases[family] || family;
  const group = GROUPS[key];
  if (!group) return { key: key || 'other', productType: 'BabyGirl > ' + (family || (locale === 'en' ? 'Other' : 'Інше')), googleCategory: 'Apparel & Accessories > Clothing' };
  return { key, productType: 'BabyGirl > ' + group[locale === 'en' ? 1 : 0], googleCategory: group[2] };
}

function variant(product, color) {
  if (color) return { groupId: product.uid, color: color.name || color.code, pattern: '', titleSuffix: color.name || color.code };
  // These six storefront cards are the black/white variants of three designs.
  // Group them without changing any item ID used by the catalog or pixel.
  const set = product.family === 'sexy-set' && /^baby-girl-sexy-set-(gothic|varsity|bubble)-(black|white)$/.exec(product.uid);
  if (!set) return { groupId: '', color: '', pattern: '', titleSuffix: '' };
  const design = set[1][0].toUpperCase() + set[1].slice(1);
  const colorName = set[2][0].toUpperCase() + set[2].slice(1);
  return { groupId: 'baby-girl-sexy-set-' + set[1], color: colorName, pattern: design, titleSuffix: design + ' · ' + colorName };
}

// Refetch originals restored from truncated uploads on 2026-10-25.
const RESTORED_IMAGES = new Set([
  'assets/hoodie-barb-wire-back.jpg', 'assets/hoodie-barb-wire-front.jpg',
  'assets/hoodie-big-heart-bigger-ass-black.jpg', 'assets/hoodie-big-heart-bigger-ass-model.jpg',
  'assets/hoodie-karma-baby-karma-black.jpg', 'assets/hoodie-karma-baby-karma-black-model.jpg',
  'assets/hoodie-karma-baby-karma-pink.jpg', 'assets/hoodie-karma-baby-karma-pink-model.jpg'
]);
function imageVersion(localPath) { return RESTORED_IMAGES.has(localPath) ? '20261025' : '1'; }

module.exports = { category, variant, imageVersion };
