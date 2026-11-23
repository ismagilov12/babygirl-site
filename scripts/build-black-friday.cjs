'use strict';

// Derive the campaign from the current Ukrainian storefront after its normal build.
// Never write back to index.html, en.html, the catalog database or ad feeds.
const fs = require('node:fs');
const vm = require('node:vm');
const { BLACK_FRIDAY_PRICES, campaignIncludes, campaignPrice } = require('../api/_black-friday');
const offer = Object.fromEntries(Object.entries(BLACK_FRIDAY_PRICES).map(([family, price]) =>
  [family, price.toLocaleString('uk-UA', { useGrouping: true })]));
let html = fs.readFileSync('index.html', 'utf8');
function replace(from, to) {
  const count = typeof from === 'string' ? html.split(from).length - 1 : [...html.matchAll(new RegExp(from.source, 'g'))].length;
  if (count !== 1) throw new Error('Black Friday source anchor changed: ' + String(from).slice(0, 110) + ' (' + count + ')');
  html = html.replace(from, () => to);
}
function between(start, end, replacement) {
  const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('Black Friday section missing: ' + start);
  html = html.slice(0, a) + replacement + '\n' + html.slice(b);
}

const offerSummary = `Футболки за ${offer.tee} ₴, худі за ${offer.hoodie} ₴ та кроп-топи за ${offer.crop} ₴.`;
replace(/<title>[\s\S]*?<\/title>/, '<title>Black Friday у BabyGirl · Футболки, худі та кроп-топи</title>');
replace(/<meta name="description"[^>]*>/, `<meta name="description" content="Black Friday у BabyGirl. ${offerSummary}">
<meta name="robots" content="noindex,follow">
<meta property="og:title" content="Black Friday у BabyGirl">
<meta property="og:description" content="${offerSummary}">
<meta property="og:image" content="https://www.babygirl.com.ua/assets/suit-baby-girl-model-seated.webp">
<meta property="og:url" content="https://www.babygirl.com.ua/black-friday">`);
replace('<meta name="theme-color" content="#FF4FA1">', '<meta name="theme-color" content="#111014">');
replace('</head>', '<link rel="preload" href="/assets/bf-barlow-condensed-black-italic.woff2" as="font" type="font/woff2" crossorigin>\n<link rel="stylesheet" href="/assets/black-friday.css?v=20261122-prices">\n</head>');
replace('<body>', '<body class="bf-page">');
const hero = fs.readFileSync('campaign/black-friday-hero.html', 'utf8').replace(/\{\{(tee|hoodie|crop)\}\}/g, (_, family) => offer[family]);
between('<!-- ===== HERO ===== -->', '<style id="bgBestsellersStyle">', hero);
between('<!-- ===== SLOT MACHINE ===== -->', '<!-- ===== ABOUT ===== -->', `<section class="bf-terms"><h2>Умови Black Friday</h2><p>${offerSummary} Чокери й пояси продаються за звичайною ціною.</p><p>Акційні ціни вже вказані в картках товарів. Додаткові промокоди та знижка на другу річ не діють.</p></section>`);
if (html.includes('<style id="bgPlateLaunchStyle">')) {
  between('<style id="bgPlateLaunchStyle">', '<!-- ===== SUITS · PREORDER BLOCK ===== -->', '');
}
html = html.replace(/ *<a class="drawer-link lime" href="#shop" data-family="plate">[\s\S]*?<\/a>\n/, '')
  .replace(/ *<a href="#shop" data-family="plate">Посуд<\/a>\n/, '');
const plateGroup = "        } else if (grp === 'plate' && lastFam){";
if (html.includes(plateGroup)) between(plateGroup, "        } else if (grp === 'hoodie' && lastFam){", '');

const dataTag = /(<script id="DATA" type="application\/json">)([\s\S]*?)(<\/script>)/;
const [, dataStart, embeddedJSON, dataEnd] = html.match(dataTag);
const data = JSON.parse(embeddedJSON);
data.all = data.all.filter(campaignIncludes);
const available = new Set(data.all.map(product => product.uid));
for (const key of ['grid', 'featured']) {
  data[key] = data[key].filter(item => available.has(typeof item === 'string' ? item : item.uid));
}
// These two legacy embedded rows predate the shop's current regular prices.
// The live catalog replaces them on load, even if the regular price changes again.
for (const product of data.all) {
  if (product.uid === 'belt' && product.price === 1500) product.price = 1130;
  if (product.uid === 'choker' && product.price === 490) product.price = 370;
}
replace(dataTag, dataStart + JSON.stringify(data).replace(/</g, '\\u003c') + dataEnd);
between('/* ========== SLOT MACHINE + AUTO-APPLY PROMO ========== */', '/* ========== STOREFRONT (catalog + cart + checkout) ========== */', '');
between('  // ===== Applied promo =====', '  // Supabase bootstrap', '');
replace('<script src="/assets/babygirl-upsell.js"></script>', '');

// Only a genuine saving gets a compare-at price or a sale ribbon.
replace('\n  applyRegularTeeSale(D.all);', `
  applyRegularTeeSale(D.all);
  const BLACK_FRIDAY_PRICES = ${JSON.stringify(BLACK_FRIDAY_PRICES)};
  ${campaignIncludes.toString()}
  ${campaignPrice.toString()}
  function applyBlackFridayPrices(products){
    (Array.isArray(products) ? products : []).forEach(function(p){
      if (!campaignIncludes(p) || p._bfApplied || !(Number(p.price) > 0)) return;
      var regular = Number(p.price);
      p.price = campaignPrice(p);
      p.price_old = regular > p.price ? regular : null;
      p._bfApplied = true;
      p.ribbon = p.price_old ? 'BLACK FRIDAY' : null;
      if (p.attrs && Array.isArray(p.attrs.specs)) p.attrs.specs = p.attrs.specs.map(function(spec){
        return /^(ціна|price)$/i.test(String(spec.l || '').trim()) ? Object.assign({}, spec, {v:bfMoney(p.price) + ' грн'}) : spec;
      });
    });
  }
  function bfMoney(value){ return Number(value).toLocaleString('uk-UA', {useGrouping:true, maximumFractionDigits:2}); }
  function bfPrice(p){
    var old = p.price_old > p.price ? '<span class="card-price old">' + bfMoney(p.price_old) + ' ₴</span>' : '';
    return old + '<span class="card-price">' + bfMoney(p.price) + ' ₴</span>';
  }
  function bfPercent(p){ return p.price_old > p.price ? '−' + Math.round(100 * (1 - p.price / p.price_old)) + '%' : ''; }
  applyBlackFridayPrices(D.all);
`);
replace('if (row.active === false) inactiveUids[row.uid] = true;', 'if (!campaignIncludes(row)) inactiveUids[row.uid] = true;');
replace('} else { Object.assign(byUid[row.uid], row); }', '} else { delete byUid[row.uid]._bfApplied; Object.assign(byUid[row.uid], row); }');
replace("    try { pct = parseInt(sessionStorage.getItem('bg_promo_pct') || '0', 10) || 0; } catch(e){}", '');
replace('var BUNDLE_DISCOUNT_PCT = 10;', 'var BUNDLE_DISCOUNT_PCT = 0;');
replace(/  function getSlotPct\(\)\{[\s\S]*?\n  \}/, '  function getSlotPct(){ return 0; }');
replace(/  function bundleBanner\(totalUnits\)\{[\s\S]*?\n  \}/, '');
replace('$body.innerHTML = bundleBanner(b.totalUnits) + lines;', '$body.innerHTML = lines;');
replace('if (was < 2 && now >= 2){', 'if (BUNDLE_DISCOUNT_PCT > 0 && was < 2 && now >= 2){');
replace("    try { promo = sessionStorage.getItem('bg_promo_code'); } catch(e){}", '    // Campaign pricing cannot be combined with regular-store promo codes.');
replace("      stage: 'final', fio: fio, phone: phone,", "      stage: 'final', fio: fio, phone: phone,\n      campaign: 'babygirl-black-friday-2026', expected_total: calcTotal(),");
replace('            orderReference: data.order_num,', "            orderReference: data.order_num,\n            campaign: 'babygirl-black-friday-2026',");

// Every price surface, including curated cards and six-option sets.
replace("+ '<div class=\"card-img\"><span class=\"heart-tag\">♥</span><div class=\"card-photos\">'", "+ '<div class=\"card-img\">' + (bfPercent(p) ? '<span class=\"sale-badge\">' + bfPercent(p) + '</span>' : '') + '<span class=\"heart-tag\">♥</span><div class=\"card-photos\">'");
replace("'<div class=\"card-meta\"><span class=\"card-price\">' + escapeHtml(p.price) + '₴</span><span class=\"card-tag\">ONE SIZE</span></div>'", "'<div class=\"card-meta\"><span class=\"card-price-row\">' + bfPrice(p) + '</span><span class=\"card-tag\">ONE SIZE</span></div>'");
replace("  function setPrice(p){ return setIsEnglish ? euro(p.price) : p.price+' ₴'; }", '  function setPrice(p){ return bfPrice(p); }');
replace("<span class=\"card-price\">'+setPrice(p)+'</span>", "<span class=\"card-price-row\">'+setPrice(p)+'</span>");
replace("    pmPrice.textContent=setIsEnglish ? setPrice(p) : p.price;", "    pmPrice.innerHTML='<span class=\"pm-old\">'+bfMoney(p.price_old)+' ₴</span>'+bfMoney(p.price);");
replace("    pmRibbon.textContent=setText('Обери свій комплект','Choose your set'); pmRibbon.hidden=false;", "    pmRibbon.textContent='BLACK FRIDAY ' + bfPercent(p); pmRibbon.hidden=!p.price_old;");
replace("+ oldPrice + '₴</span>'", "+ bfMoney(oldPrice) + '₴</span>'");
html = html.replaceAll("+ newPrice + '₴</span>'", "+ bfMoney(newPrice) + '₴</span>'");
replace("priceStr = '<span class=\"old\">' + cartOld + '₴</span> ' + unitP + '₴ × ' + i.qty;", "priceStr = '<span class=\"old\">' + bfMoney(cartOld) + '₴</span> ' + bfMoney(unitP) + '₴ × ' + i.qty;");
replace("priceStr = unitP + '₴ × ' + i.qty;", "priceStr = bfMoney(unitP) + '₴ × ' + i.qty;");
between('      // Разбивка в total', '      $total.innerHTML = html;', `      var originalTotal = cart.reduce(function(sum, item){ return sum + (item.price_old || item.price) * item.qty; }, 0);
      var dueNow = b.total;
      if (b.total > LARGE_ORDER_THRESHOLD_UAH) dueNow = LARGE_ORDER_PREPAYMENT_UAH;
      else if ($payment.value === 'cod') dueNow = Math.min(200, b.total);
      var html = '';
      if (originalTotal > b.total) {
        html = '<div class="total-row sub"><span>Без знижки</span><span>' + bfMoney(originalTotal) + ' ₴</span></div>'
          + '<div class="total-row disc"><span>Знижка Black Friday</span><span>−' + bfMoney(originalTotal - b.total) + ' ₴</span></div>';
      }
      html += '<div class="total-row main"><span>Сума замовлення</span><span class="num">' + bfMoney(b.total) + ' ₴</span></div>';
      if (dueNow < b.total) {
        html += '<div class="total-row sub"><span>Передоплата зараз</span><span>' + bfMoney(dueNow) + ' ₴</span></div>'
          + '<div class="total-row sub"><span>Залишок</span><span>' + bfMoney(b.total - dueNow) + ' ₴</span></div>';
      }`);
replace('  // Checkout submit', "  $payment.addEventListener('change', renderCart);\n\n  // Checkout submit");
replace("pmPrice.innerHTML = '<span class=\"pm-old\">' + po + '\\u20b4</span>' + p.price;", "pmPrice.innerHTML = '<span class=\"pm-old\">' + bfMoney(po) + '\\u20b4</span>' + bfMoney(p.price);");
replace('pmPrice.textContent = p.price;', 'pmPrice.textContent = bfMoney(p.price);');
replace("'<span class=\"hd\">⚡ передзамовлення −' + (po.discount_pct || 20) + '%</span>'", "'<span class=\"hd\">Передзамовлення</span>'");
replace('4 500 ₴</span><button', '2 250 ₴</span><button');
replace('4 500 ₴ · −25%', '2 250 ₴ · −50%');
replace('★ new drop · pink & black', '★ BLACK FRIDAY · −50%');
replace('~ обери своє худі ~', 'Усі худі за ' + offer.hoodie + ' ₴');
replace('~ обери свій принт ~', 'Футболки за ' + offer.tee + ' ₴');
replace('<span class="marquee-item">3490₴</span>', '<span class="marquee-item">' + offer.hoodie + ' ₴</span>');
html = html.replaceAll(' Друга річ у замовленні — ще −10%.', '');
html = html.replaceAll('preorder −26%', 'Black Friday · ' + offer.hoodie + ' ₴');
replace('з передоплатою <b>200 грн</b>', 'з передоплатою <b>до 200 грн</b> (не більше вартості замовлення)');
replace('<option value="cod">наложений платіж (200₴ передоплата)</option>', '<option value="cod">післяплата (до 200₴ передоплата)</option>');
replace("? 'наложений платіж (1500₴ передоплата)'", "? 'післяплата (1 500₴ передоплата)'");
replace(": 'наложений платіж (200₴ передоплата)';", ": 'післяплата (' + bfMoney(Math.min(200, total)) + '₴ передоплата)';");
replace("      if (nowEl) nowEl.textContent = p.price + '₴';", "      if (nowEl) nowEl.innerHTML = (p.price_old ? '<del class=\"old\">' + bfMoney(p.price_old) + ' ₴</del> ' : '') + bfMoney(p.price) + ' ₴';");
replace('© 2026 BabyGirl™ · made with ♥ from Y2K · v2 · skeleton-powered', '© 2026 BabyGirl™ · Black Friday edition · made with ♥');

// Keep cart prices aligned if the live catalog arrives after the first click.
replace('      applyHoodieSeasonSale(D.all);\n      applyRegularTeeSale(D.all);\n      renderGrid();', `      var refreshed = activeRows.map(function(row){ return byUid[row.uid]; });
      applyHoodieSeasonSale(refreshed);
      applyRegularTeeSale(refreshed);
      applyBlackFridayPrices(refreshed);
      cart = cart.filter(function(item){
        var product = D.all.find(function(p){ return p.uid === item.uid.split('|')[0] && p.active !== false; });
        if (!product) return false;
        item.price = product.price; item.price_old = product.price_old;
        return true;
      });
      renderCart();
      renderGrid();`);

for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
  if (/application\/(?:ld\+)?json/.test(match[1])) JSON.parse(match[2]);
  else new vm.Script(match[2], { filename: 'black-friday.html' });
}
if (html.includes("sessionStorage.getItem('bg_promo") || html.includes('babygirl-upsell.js')) throw new Error('Regular-store discount leaked into Black Friday');
fs.writeFileSync('black-friday.html', html);
console.log('Generated /black-friday with campaign prices and an edited catalog.');
