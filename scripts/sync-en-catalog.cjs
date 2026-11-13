// UA is the source of truth for products and catalog presentation.
// Only the market adapter (English copy, EUR prices and checkout) stays in EN.
// Run after catalog seed/maintenance steps on EVERY build. Missing anchors fail
// the build instead of silently publishing an out-of-sync European storefront.
const fs = require('node:fs');
const vm = require('node:vm');

function one(text, regex, label) {
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.replace('g', '') + 'g'))];
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}`);
  return matches[0][0];
}
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Missing catalog anchor: ${start}`);
  return text.slice(a, b);
}
function fn(text, name) {
  return one(text, new RegExp('^  function ' + name + '\\([^\\n]*\\{[\\s\\S]*?^  }', 'm'), name);
}
function sync(ua, en) {
  const replace = (old, value) => { if (!en.includes(old)) throw new Error('Missing EN catalog target'); en = en.replace(old, () => value); };
  const dataRE = /<script id="DATA" type="application\/json">[\s\S]*?<\/script>/;
  replace(one(en, dataRE, 'EN DATA'), one(ua, dataRE, 'UA DATA'));

  // Keep page sections in the same order, including curated bestsellers.
  const sections = between(ua, '<style id="bgBestsellersStyle">', '<!-- ===== BABY GIRL OVERSIZED SUIT');
  const start = '<!-- BEGIN SYNCED CATALOG SECTIONS -->', end = '<!-- END SYNCED CATALOG SECTIONS -->';
  const translated = sections.replaceAll('~ обери своє худі ~', '~ choose your hoodie ~').replaceAll('~ обери свій принт ~', '~ choose your print ~').replaceAll('Футболки', 'T-shirts');
  const block = start + '\n' + translated + end + '\n\n';
  if (en.includes(start)) replace(between(en, start, end) + end, block.trimEnd());
  else replace('<!-- ===== BABY GIRL OVERSIZED SUIT', block + '<!-- ===== BABY GIRL OVERSIZED SUIT');

  const promoStart = '<!-- BEGIN SYNCED CATALOG PROMOS -->', promoEnd = '<!-- END SYNCED CATALOG PROMOS -->';
  let promos = between(ua, '<style id="bgPlateLaunchStyle">', '<section id="shop"');
  const copy = {
    'НОВИНКА · BABY GIRL HOME':'NEW · BABY GIRL HOME', 'BABY GIRL ПОСУД 🎀':'BABY GIRL TABLEWARE 🎀',
    'BABY GIRL ТЕПЕР НЕ ТІЛЬКИ У ТВОЄМУ ГАРДЕРОБІ… 💋':'BABY GIRL IS NOW MORE THAN YOUR WARDROBE… 💋',
    'Зустрічай нашу новинку-BABY GIRL ПОСУД 🎀':'Meet the new BABY GIRL TABLEWARE 🎀',
    'Тарілки з характером, чашки з настроєм і принти, які точно не схвалить твоя бабуся😈':'Plates with attitude, cups with a mood, and prints your grandma would never approve of 😈',
    'Бо навіть ранкова кава має бути sexy, а посуд -відображати твою особистість.':'Because even your morning coffee should be sexy, and your tableware should reflect your personality.',
    'ДИВИТИСЯ ПОСУД ♥':'SHOP TABLEWARE ♥',
    'новинка · передзамовлення':'new · preorder',
    'оверсайз-худі · тринитка-петля · готичний принт на всю спину · 5 кольорів':'oversized hoodie · French terry · gothic back print · 5 colors',
    'зіпка на блискавці · тринитка-петля · вишивка «baby girl» · 4 кольори':'zip hoodie · French terry · baby girl embroidery · 4 colors',
    'half-zip з капюшоном-маскою · щільний фліс · 2 кольори':'half-zip mask hoodie · heavyweight fleece · 2 colors',
    'обрати худі ♥':'choose hoodie ♥', 'обрати зіпку ♥':'choose zip hoodie ♥', 'обрати худі з маскою ♥':'choose mask hoodie ♥',
    '<b>Оверсайз-фасон</b> з обʼємним капюшоном і приспущеним плечем. Тринитка-петля — тепло, але не парко.':'<b>Oversized fit</b> with a roomy hood and dropped shoulders. Warm, breathable French terry.',
    '<b class="hl">Великий готичний принт на всю спину</b> і мінімалістичне лого на грудях.':'<b class="hl">Large gothic back print</b> with a minimal chest logo.',
    '<b>5 кольорів · one size (oversized).</b> Друга річ у замовленні — ще −10%.':'<b>5 colors · one size (oversized).</b> Extra 10% off from the second item.',
    '<b>Відправка за 3–5 днів</b> з моменту замовлення, Новою поштою.':'<b>Worldwide shipping.</b> Choose your destination at checkout.',
    '<b>Повна блискавка</b> і обʼємний капюшон. Тринитка-петля всередині — мʼяко й тепло.':'<b>Full zip</b> and a roomy hood. Soft, warm French terry inside.',
    '<b class="hl">Вишивка «baby girl»</b> на грудях + кишені-кенгуру.':'<b class="hl">Baby girl embroidery</b> on the chest and kangaroo pockets.',
    '<b>4 кольори · one size (oversized).</b> Друга річ у замовленні — ще −10%.':'<b>4 colors · one size (oversized).</b> Extra 10% off from the second item.',
    '<b class="hl">Капюшон-маска.</b> Коротка блискавка з високим коміром: піднімаєш — і закриває пів обличчя.':'<b class="hl">Mask hood.</b> Half zip with a high collar that covers the lower face.',
    '<b>Щільний фліс</b> + кишеня-кенгуру. Вишивка «baby girl» біля блискавки.':'<b>Heavyweight fleece</b> and a kangaroo pocket. Baby girl embroidery beside the zip.',
    '<b>2 кольори · one size (oversized).</b> Друга річ у замовленні — ще −10%.':'<b>2 colors · one size (oversized).</b> Extra 10% off from the second item.',
    'one size · oversized фасон · відправка 3–5 днів':'one size · oversized fit · worldwide shipping',
    'передзамовлення':'preorder', 'відправка 3–5 днів':'worldwide shipping'
  };
  const localize = s => Object.entries(copy).sort((a,b)=>b[0].length-a[0].length).reduce((s,[a,b]) => s.replaceAll(a,b), s);
  promos = promoStart + '\n' + localize(promos) + promoEnd + '\n';
  if (en.includes(promoStart)) replace(between(en,promoStart,promoEnd) + promoEnd + '\n', promos);
  else replace('<section id="shop"', promos + '\n<section id="shop"');

  // Match the complete product menu (crop tops and tableware included).
  const labels = {'Усі товари':'All products','Подовжені футболки':'Long T-shirts','Футболки':'T-shirts','Топи':'Crop tops','Худі':'Hoodies','Пояси':'Belts','Посуд':'Tableware'};
  const translate = s => Object.entries(labels).reduce((s, [a,b]) => s.replaceAll(a,b), s);
  for (const marker of ['<a class="drawer-link pink" href="#shop">', '<a href="#shop">']) {
    const a = ua.indexOf(marker), ae = ua.indexOf('</div>', a);
    const b = en.indexOf(marker), be = en.indexOf('</div>', b);
    if (a < 0 || b < 0) throw new Error('Missing catalog navigation');
    replace(en.slice(b,be), translate(ua.slice(a,ae)));
  }

  const configStart = '  // BEGIN SYNCED CATALOG RULES';
  const configEnd = '  // END SYNCED CATALOG RULES';
  const hidden = between(ua, '  var STOREFRONT_HIDDEN =', '  var $grid =');
  const config = configStart + '\n' + fn(ua,'normalizeStorefrontCategories') + '\n' + fn(ua,'applyHoodieSeasonSale') + '\n' + hidden +
    '\n  var EN_HIDDEN = STOREFRONT_HIDDEN; window.EN_HIDDEN = EN_HIDDEN;\n' +
    '  normalizeStorefrontCategories();\n  applyHoodieSeasonSale(D.all);\n' + configEnd + '\n';
  if (en.includes(configStart)) replace(between(en, configStart, configEnd) + configEnd + '\n', config);
  else replace(between(en, '  // EN-only:', '  var EUR_RATE'), config);
  replace(between(en, '  var $grid =', '  var $overlay ='), between(ua, '  var $grid =', '  var $overlay ='));

  // Use the same thumbnails and curated selection, adapted to EUR.
  const helperStart = '  // BEGIN SYNCED CATALOG HELPERS';
  const helperEnd = '  // END SYNCED CATALOG HELPERS';
  const helpers = helperStart + '\n' + fn(ua,'catalogPhoto') + '\n' + fn(ua,'renderBestsellers').replace("escapeHtml(p.price)", "escapeHtml(euro(p.price))").replaceAll("₴", "") + '\n' + helperEnd + '\n';
  if (en.includes(helperStart)) replace(between(en,helperStart,helperEnd) + helperEnd + '\n', helpers);
  else replace('  // Six real product records', helpers + '\n  // Six real product records');

  let grid = fn(ua,'renderGrid');
  // Price policy stays in the European market adapter, not copied from UA.
  const enPrice = between(fn(en,'renderGrid'), '      var priceHtml;', '      // Group:');
  grid = grid.replace(between(grid, '      var priceHtml;', '      // Group:'), () => enPrice)
    .replace('  function renderGrid(){', `  function renderGrid(){
    (D.all || []).forEach(function(p){
      if ((window.EN_TITLE || {})[p.uid]) p.title = window.EN_TITLE[p.uid];
      else if (/^Чашка /.test(p.title || '')) p.title = p.title.replace(/^Чашка /, '') + ' Mug';
      if (p.uid === 'bad-baby-long') p.title = 'Bad Baby — long T-shirt dress';
    });`)
    .replace('~ нічого тут немає ~', '~ nothing here ~').replace('>ТОПИ<', '>CROP TOPS<')
    .replace("'<span class=\"marquee-item\">3490₴</span>'", "'<span class=\"marquee-item\">' + euro(3490) + '</span>'");
  replace(fn(en,'renderGrid'), grid);
  replace(fn(en,'scrollToFamily'), fn(ua,'scrollToFamily'));
  // The same live data, visibility, order and category normalization in both markets.
  replace(fn(en,'bootstrapFromSupabase'), fn(ua,'bootstrapFromSupabase').replace('      renderHoodie();\n',''));
  const dropsStart = '  // BEGIN SYNCED DROPS', dropsEnd = '  // END SYNCED DROPS';
  const drops = dropsStart + '\n' + localize(between(ua, '  var BG_DROPS =', '  window.__bgRenderDrops')).replace("p.price + '₴'", 'euro(p.price)') + dropsEnd + '\n';
  if (en.includes(dropsStart)) replace(between(en,dropsStart,dropsEnd) + dropsEnd + '\n',drops);
  else replace('  function renderSuits(){', drops + '\n  function renderSuits(){');
  // The suit hero must use the same live product price as its modal and cart.
  const suitPriceLine = "    sec.querySelectorAll('.suit-launch__price, .suit-launch__price-sticker').forEach(function(el){ el.textContent = euro(p.price); });";
  let suit = fn(en,'renderSuits');
  if (!suit.includes(suitPriceLine)) replace(suit, suit.replace("    sec.style.display = '';", "    sec.style.display = '';\n" + suitPriceLine));
  en = en.replace(/(<span class="suit-launch__price(?:-sticker)?">)[^<]*(<\/span>)/g, '$1$2');
  const clickStart = '  // ======== GRID CLICK ROUTER ========';
  replace(between(en,clickStart,"  document.getElementById('cartClose')"), between(ua,clickStart,"  document.getElementById('cartClose')"));
  en = en.replace(/  renderGrid\(\);\n(?:  renderBestsellers\(\);\n)?  renderSuits\(\);\n(?:  renderDrops\(\);\n)?(?:  handleDeepLink\(\);\n)?  bootstrapFromSupabase\(\);/, '  renderGrid();\n  renderBestsellers();\n  renderSuits();\n  renderDrops();\n  bootstrapFromSupabase();');
  // Preserve European hoodie copy while respecting product-specific descriptions.
  en = en.replace('      p.description = HOODIE_DESCRIPTION;', '      if (!p.attrs?.catalog_release) p.description = HOODIE_DESCRIPTION;');
  // Category-specific image layout must also match.
  const plateStyle = '<style id="syncedPlateCards">.card[data-family="plate"] .card-img{aspect-ratio:1/1}.card[data-family="plate"] .card-img img{object-fit:contain;background:#fff}</style>';
  if (!en.includes('id="syncedPlateCards"')) en = en.replace('</head>', plateStyle + '\n</head>');
  for (const match of en.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
    if (/application\/(?:ld\+)?json/.test(match[1])) JSON.parse(match[2]);
    else if (!/type\s*=\s*["']module["']/.test(match[1])) new vm.Script(match[2]);
  }
  return en;
}
if (require.main === module) {
  const ua = fs.readFileSync('index.html','utf8');
  const en = sync(ua, fs.readFileSync('en.html','utf8'));
  fs.writeFileSync('en.html',en);
  console.log('European catalog synchronized from the Ukrainian storefront.');
}
module.exports = {sync};
