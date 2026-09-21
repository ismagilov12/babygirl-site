// Shared BabyGirl storefront -> BOSSGIRL CRM product catalog synchronisation.
// Both applications use the same Supabase project, but different tables:
//   storefront: bg_products
//   CRM:        products

const CRM_TABLE = 'products';
const DEFAULT_SITE_ORIGIN = 'https://www.babygirl.com.ua';

const DEFAULT_HOODIE_DESCRIPTION = [
  'BABY GIRL HOODIE 💗',
  '',
  'Той самий oversize, у якому хочеться жити.',
  'Вільний, обʼємний силует створений для максимального комфорту — худі не сковує рухів і красиво сідає по фігурі.',
  '',
  'ONE SIZE — один універсальний oversize розмір.',
  'Виконаний із якісної щільної тринитки на флісі: мʼякий, теплий та дуже приємний до тіла.',
  '',
  'Для холодних ранків, довгих прогулянок і днів, коли хочеться просто загорнутися у щось тепле й залишатися sexy. 💞',
  '',
  'Oversize fit • One size • Тринитка на флісі • Made for Baby Girls'
].join('\n');

function text(value) {
  return String(value == null ? '' : value).trim();
}

function absoluteUrl(value, siteOrigin) {
  const src = text(value);
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) return src;
  const origin = text(siteOrigin || DEFAULT_SITE_ORIGIN).replace(/\/$/, '');
  return origin + '/' + src.replace(/^\//, '');
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const clean = text(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function ensureHoodieDescription(product) {
  if (!product || product.family !== 'hoodie' || text(product.description)) return product;
  return Object.assign({}, product, { description: DEFAULT_HOODIE_DESCRIPTION });
}

function productPhotos(product, siteOrigin) {
  const colors = Array.isArray(product.colors) ? product.colors : [];
  return uniqueStrings([
    product.photo_main,
    ...(Array.isArray(product.photos) ? product.photos : []),
    ...colors.map(color => color && color.photo)
  ].map(value => absoluteUrl(value, siteOrigin)));
}

function colorPhotos(product, color, allPhotos, siteOrigin) {
  const code = text(color && color.code).toLowerCase();
  const primary = absoluteUrl(color && color.photo, siteOrigin);
  const matching = (allPhotos || []).filter(photo => {
    const lower = photo.toLowerCase();
    return (code && lower.includes(code)) || lower.includes('size-guide');
  });
  return uniqueStrings([primary, ...matching, ...(allPhotos || [])]);
}

function variantName(title, colorName) {
  const base = text(title);
  const color = text(colorName);
  if (!color) return base;
  const normalizedTitle = base.toLowerCase();
  if (normalizedTitle.endsWith('/ ' + color.toLowerCase()) ||
      normalizedTitle.endsWith('— ' + color.toLowerCase())) return base;
  return base + ' — ' + color;
}

function expectedCrmRows(rawProduct, siteOrigin) {
  const product = ensureHoodieDescription(rawProduct || {});
  const uid = text(product.uid);
  if (!uid) return [];

  const allPhotos = productPhotos(product, siteOrigin);
  const mainPhoto = absoluteUrl(product.photo_main, siteOrigin) || allPhotos[0] || '';
  const colors = Array.isArray(product.colors)
    ? product.colors.filter(color => color && text(color.code))
    : [];
  const sizes = uniqueStrings(Array.isArray(product.sizes) ? product.sizes : []);
  const description = text(product.description);
  const common = {
    category: text(product.family) || 'babygirl',
    price: Number(product.price) || 0,
    type: 'product',
    sizes,
    gender: 'f',
    description,
    is_active: !!product.active,
    bg_uid: uid
  };

  const rows = [Object.assign({}, common, {
    name: text(product.title) || uid,
    sku: 'BG-' + uid,
    photo: mainPhoto,
    image_url: mainPhoto,
    images: allPhotos
  })];

  for (const color of colors) {
    const photos = colorPhotos(product, color, allPhotos, siteOrigin);
    const photo = absoluteUrl(color.photo, siteOrigin) || photos[0] || mainPhoto;
    rows.push(Object.assign({}, common, {
      name: variantName(product.title, color.name || color.code),
      sku: 'BG-' + uid + '-' + text(color.code),
      photo,
      image_url: photo,
      images: photos
    }));
  }

  return rows;
}

function numericId(row) {
  const id = Number(row && row.id);
  return Number.isSafeInteger(id) ? id : 0;
}

function chooseCanonical(candidates) {
  return (candidates || []).slice().sort((a, b) => {
    if (!!a.is_active !== !!b.is_active) return a.is_active ? -1 : 1;
    return numericId(b) - numericId(a);
  })[0] || null;
}

function mergeRow(existing, expected, id, productCost, now) {
  return {
    id,
    name: expected.name,
    sku: expected.sku,
    category: expected.category,
    cost: Number(productCost) > 0
      ? Number(productCost)
      : (existing && Number.isFinite(Number(existing.cost)) ? Number(existing.cost) : 0),
    price: expected.price,
    stock: existing && Number.isFinite(Number(existing.stock)) ? Number(existing.stock) : 0,
    type: expected.type,
    photo: expected.photo,
    created_at: text(existing && existing.created_at) || now,
    sizes: expected.sizes,
    gender: expected.gender,
    description: expected.description || text(existing && existing.description),
    image_url: expected.image_url,
    images: expected.images,
    is_active: expected.is_active,
    updated_at: now,
    season: text(existing && existing.season) || (expected.category === 'hoodie' ? 'осінь' : 'літо'),
    weight: existing && Number.isFinite(Number(existing.weight)) ? Number(existing.weight) : 0,
    length: existing && Number.isFinite(Number(existing.length)) ? Number(existing.length) : 0,
    width: existing && Number.isFinite(Number(existing.width)) ? Number(existing.width) : 0,
    height: existing && Number.isFinite(Number(existing.height)) ? Number(existing.height) : 0,
    properties: Array.isArray(existing && existing.properties) ? existing.properties : [],
    stock_by_size: existing && existing.stock_by_size && typeof existing.stock_by_size === 'object'
      ? existing.stock_by_size
      : {},
    bg_uid: expected.bg_uid
  };
}

async function loadCrmRows(sb) {
  const [managed, maxRows] = await Promise.all([
    sb(CRM_TABLE + '?select=*&bg_uid=not.is.null&limit=1000'),
    sb(CRM_TABLE + '?select=id&order=id.desc&limit=1')
  ]);
  return {
    managed: Array.isArray(managed) ? managed : [],
    maxId: Math.max(1900000000000, numericId(maxRows && maxRows[0]))
  };
}

async function persistSync(sb, upserts, deactivateIds) {
  let saved = [];
  if (upserts.length) {
    saved = await sb(CRM_TABLE + '?on_conflict=id', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(upserts)
    }) || [];
  }

  const ids = uniqueStrings((deactivateIds || []).map(String));
  if (ids.length) {
    await sb(CRM_TABLE + '?id=in.(' + ids.join(',') + ')', {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() })
    });
  }
  return { saved: saved.length, deactivated: ids.length };
}

function sameName(a, b) {
  return text(a).toLocaleLowerCase('uk-UA') === text(b).toLocaleLowerCase('uk-UA');
}

async function syncCatalogToCrm(sb, rawProducts, options) {
  const products = (Array.isArray(rawProducts) ? rawProducts : []).map(ensureHoodieDescription);
  const activeProducts = products.filter(product => product && product.active && text(product.uid));
  const activeUids = new Set(activeProducts.map(product => text(product.uid)));
  const productByUid = new Map(activeProducts.map(product => [text(product.uid), product]));
  const expected = activeProducts.flatMap(product => expectedCrmRows(product, options && options.siteOrigin));
  const expectedSkus = new Set(expected.map(row => row.sku));
  const { managed, maxId } = await loadCrmRows(sb);
  let nextId = maxId + 1;
  const claimedIds = new Set();
  const upserts = [];
  const now = new Date().toISOString();

  for (const wanted of expected) {
    let candidates = managed.filter(row => !claimedIds.has(String(row.id)) && row.sku === wanted.sku);
    if (!candidates.length) {
      candidates = managed.filter(row =>
        !claimedIds.has(String(row.id)) &&
        text(row.sku).toLowerCase() === wanted.sku.toLowerCase()
      );
    }
    // Reuse a matching retired card when a product UID was replaced (for example,
    // the refreshed Pussy Power hoodie) so stock/history stay attached to the row.
    if (!candidates.length) {
      candidates = managed.filter(row =>
        !claimedIds.has(String(row.id)) &&
        !activeUids.has(text(row.bg_uid)) &&
        /^BG-/i.test(text(row.sku)) &&
        sameName(row.name, wanted.name)
      );
    }

    const existing = chooseCanonical(candidates);
    const id = existing ? numericId(existing) : nextId++;
    if (existing) claimedIds.add(String(existing.id));
    const product = productByUid.get(wanted.bg_uid) || {};
    upserts.push(mergeRow(existing, wanted, id, product.cost, now));
  }

  const deactivateIds = managed
    .filter(row => /^BG-/i.test(text(row.sku)))
    .filter(row => !claimedIds.has(String(row.id)))
    .filter(row => row.is_active || activeUids.has(text(row.bg_uid)) || expectedSkus.has(text(row.sku)))
    .map(row => row.id);

  const result = await persistSync(sb, upserts, deactivateIds);
  return Object.assign(result, {
    products: activeProducts.length,
    expected_rows: expected.length
  });
}

async function syncProductToCrm(sb, rawProduct, options) {
  const product = ensureHoodieDescription(rawProduct || {});
  if (!product.active) return deactivateCrmProduct(sb, product.uid);
  const uid = text(product.uid);
  if (!uid) return { saved: 0, deactivated: 0 };

  const { managed, maxId } = await loadCrmRows(sb);
  const relevant = managed.filter(row => text(row.bg_uid) === uid);
  const expected = expectedCrmRows(product, options && options.siteOrigin);
  let nextId = maxId + 1;
  const claimedIds = new Set();
  const upserts = [];
  const now = new Date().toISOString();

  for (const wanted of expected) {
    const existing = chooseCanonical(relevant.filter(row =>
      !claimedIds.has(String(row.id)) &&
      text(row.sku).toLowerCase() === wanted.sku.toLowerCase()
    ));
    const id = existing ? numericId(existing) : nextId++;
    if (existing) claimedIds.add(String(existing.id));
    upserts.push(mergeRow(existing, wanted, id, product.cost, now));
  }

  const deactivateIds = relevant
    .filter(row => /^BG-/i.test(text(row.sku)) && !claimedIds.has(String(row.id)) && row.is_active)
    .map(row => row.id);
  return persistSync(sb, upserts, deactivateIds);
}

async function deactivateCrmProduct(sb, uid) {
  const cleanUid = text(uid);
  if (!cleanUid) return { saved: 0, deactivated: 0 };
  const rows = await sb(CRM_TABLE + '?select=id,is_active&bg_uid=eq.' + encodeURIComponent(cleanUid) + '&limit=500');
  const ids = (Array.isArray(rows) ? rows : []).filter(row => row.is_active).map(row => row.id);
  return persistSync(sb, [], ids);
}

module.exports = {
  CRM_TABLE,
  DEFAULT_HOODIE_DESCRIPTION,
  ensureHoodieDescription,
  expectedCrmRows,
  syncCatalogToCrm,
  syncProductToCrm,
  deactivateCrmProduct
};
