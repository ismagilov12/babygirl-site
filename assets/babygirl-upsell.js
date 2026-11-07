(function () {
  'use strict';
  if (window.__bgUpsellPopupInstalled) return;
  window.__bgUpsellPopupInstalled = true;

  var overlay;
  var context;
  var catalog = [];
  var selectedColors = {};
  var activeCategory = 'accessories';
  var previousFocus;
  var pendingTimer;

  var style = document.createElement('style');
  style.textContent = `
    .bgu-overlay{position:fixed;inset:0;background:rgba(10,10,10,.62);display:none;align-items:center;justify-content:center;z-index:99999;padding:12px}
    .bgu-overlay.on{display:flex}
    .bgu-modal{display:flex;flex-direction:column;width:100%;max-width:640px;max-height:90vh;max-height:90dvh;background:#fff8fc;border:2px solid #171717;border-radius:20px;box-shadow:0 18px 50px #0005;overflow:hidden;color:#171717;font-family:inherit}
    .bgu-header{flex-shrink:0;position:relative;padding:22px 42px 14px;text-align:center}
    .bgu-head{font-size:23px;font-weight:900;margin:0}
    .bgu-sub{font-size:13px;margin:6px 0 0}
    .bgu-x{position:absolute;right:10px;top:8px;border:0;background:transparent;font-size:30px;cursor:pointer}
    .bgu-tabs{flex-shrink:0;display:flex;gap:7px;padding:0 12px 12px}
    .bgu-tab{flex:1;padding:10px 4px;border:1px solid #171717;border-radius:24px;background:#fff;font:inherit;font-size:13px;font-weight:700;cursor:pointer}
    .bgu-tab[aria-selected=true]{background:#ff4fa1;color:#fff}
    .bgu-cards{display:grid;grid-auto-rows:max-content;min-height:0;flex:1;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:2px 12px 16px;overflow:auto;overscroll-behavior:contain}
    .bgu-card{align-self:start;display:flex;flex-direction:column;background:#fff;border:1px solid #e8dce3;border-radius:14px;overflow:hidden}
    .bgu-img{height:180px;flex-shrink:0;display:block;width:100%;object-fit:contain;background:#fff}
    .bgu-info{display:flex;flex:1;flex-direction:column;padding:10px;gap:8px}
    .bgu-name{font-size:14px;font-weight:800;line-height:1.3;margin:0}
    .bgu-detail{font-size:12px;color:#665561;min-height:15px}
    .bgu-price{font-size:17px;font-weight:900}
    .bgu-old{font-size:12px;font-weight:400;color:#888;text-decoration:line-through;margin-right:6px}
    .bgu-sws{display:flex;gap:7px;flex-wrap:wrap}
    .bgu-sw{width:25px;height:25px;border-radius:50%;border:2px solid #ccc;cursor:pointer}
    .bgu-sw[aria-pressed=true]{border-color:#171717;box-shadow:inset 0 0 0 2px #fff}
    .bgu-add{margin-top:auto;width:100%;border:0;border-radius:9px;background:#ff4fa1;color:#fff;padding:11px 4px;font:inherit;font-size:13px;font-weight:800;cursor:pointer}
    .bgu-add:disabled{background:#218b64}
    .bgu-footer{flex-shrink:0;padding:12px;background:#fff;border-top:1px solid #e8dce3}
    .bgu-status{min-height:18px;font-size:12px;text-align:center;margin-bottom:8px}
    .bgu-continue{width:100%;padding:13px;border:0;border-radius:10px;background:#171717;color:#fff;font:inherit;font-weight:800;cursor:pointer}
    .bgu-modal button:focus-visible{outline:3px solid #6533d6;outline-offset:2px}
    body.bgu-lock{overflow:hidden}
    @media(max-width:380px){.bgu-tabs{gap:4px}.bgu-tab{font-size:12px}.bgu-head{font-size:20px}.bgu-info{padding:8px}}
  `;
  document.head.appendChild(style);

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
    });
  }

  function category(product) {
    if (/^mug-/.test(product.uid)) return 'cups';
    if (/^plate-/.test(product.uid)) return 'plates';
    return 'accessories';
  }

  function offer(product) {
    // Preserve the existing belt and choker offers and their checkout identifiers.
    if (product.uid === 'belt') return {uid:'belt-addon', price:790};
    if (product.uid === 'choker') return {uid:'choker-addon', price:260};
    return {uid:product.uid, price:Number(product.price)};
  }

  function selectedColor(product) {
    var colors = Array.isArray(product.colors) ? product.colors : [];
    return colors.find(function (color) {
      return color.code === selectedColors[product.uid];
    }) || colors[0];
  }

  function cartUid(product) {
    var color = selectedColor(product);
    return offer(product).uid + (color && color.code ? '|' + color.code : '');
  }

  function alreadyAdded(product) {
    var uid = cartUid(product);
    var color = selectedColor(product);
    var originalUid = product.uid + (color && color.code ? '|' + color.code : '');
    return context.cart.some(function (item) {
      return item.uid === uid || item.uid === originalUid;
    });
  }

  function renderCards() {
    overlay.querySelector('#bguCards').innerHTML = catalog.filter(function (product) {
      return category(product) === activeCategory;
    }).map(function (product) {
      var color = selectedColor(product);
      var deal = offer(product);
      var photo = (color && color.photo) || product.photo_main || (product.photos || [])[0] || '';
      var added = alreadyAdded(product);
      var details = [product.color_name, (product.sizes || []).join(' / ')].filter(Boolean).join(' · ');
      var colors = (product.colors || []).map(function (item) {
        return '<button type="button" class="bgu-sw" data-color="' + escapeHtml(item.code) +
          '" aria-label="' + escapeHtml(item.name) + '" aria-pressed="' +
          (color && item.code === color.code ? 'true' : 'false') +
          '" style="background:' + escapeHtml(item.hex || '#fff') + '"></button>';
      }).join('');
      return '<article class="bgu-card" data-product="' + escapeHtml(product.uid) + '">' +
        '<img class="bgu-img" loading="lazy" src="' + escapeHtml(photo) + '" alt="' + escapeHtml(product.title) + '">' +
        '<div class="bgu-info"><h3 class="bgu-name">' + escapeHtml(product.title) + '</h3>' +
        '<div class="bgu-detail">' + escapeHtml(details) + '</div>' +
        '<div class="bgu-price">' +
        (deal.price < Number(product.price) ? '<span class="bgu-old">' + escapeHtml(product.price) + ' ₴</span>' : '') +
        escapeHtml(deal.price) + ' ₴</div>' +
        (colors ? '<div class="bgu-sws">' + colors + '</div>' : '') +
        '<button type="button" class="bgu-add"' + (added ? ' disabled' : '') + '>' +
        (added ? 'У кошику ✓' : 'Додати до замовлення') + '</button></div></article>';
    }).join('');
    overlay.querySelectorAll('.bgu-tab').forEach(function (button) {
      button.setAttribute('aria-selected', String(button.dataset.category === activeCategory));
    });
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('on');
    document.body.classList.remove('bgu-lock');
    try { sessionStorage.setItem('bg_upsell_off', '1'); } catch (error) {}
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    context.open();
  }

  function addProduct(product, button) {
    if (alreadyAdded(product)) return;
    var color = selectedColor(product);
    var deal = offer(product);
    context.cart.push({
      uid:cartUid(product), title:product.title,
      color_name:color ? color.name : (product.color_name || ''),
      size:null, price:deal.price, price_old:null, qty:1,
      photo:(color && color.photo) || product.photo_main || (product.photos || [])[0] || ''
    });
    context.render();
    button.textContent = 'У кошику ✓';
    button.disabled = true;
    overlay.querySelector('#bguStatus').textContent = 'Додано ♥ Можна обрати ще або перейти до оформлення.';
    try {
      if (typeof fbq === 'function') fbq('track', 'AddToCart', {
        content_ids:[deal.uid], value:deal.price, currency:'UAH'
      });
    } catch (error) {}
  }

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'bgu-overlay';
    overlay.innerHTML = '<section class="bgu-modal" role="dialog" aria-modal="true" aria-labelledby="bguTitle">' +
      '<div class="bgu-header"><button type="button" class="bgu-x" aria-label="Закрити">×</button>' +
      '<h2 class="bgu-head" id="bguTitle">Ще трішки Baby Girl? 💋</h2>' +
      '<p class="bgu-sub">Обери щось для себе або на подарунок</p></div>' +
      '<div class="bgu-tabs" role="tablist" aria-label="Категорії доповнень">' +
      '<button type="button" role="tab" class="bgu-tab" data-category="accessories">Аксесуари 🎀</button>' +
      '<button type="button" role="tab" class="bgu-tab" data-category="cups">Чашки ☕</button>' +
      '<button type="button" role="tab" class="bgu-tab" data-category="plates">Тарілки 🍒</button></div>' +
      '<div class="bgu-cards" id="bguCards"></div>' +
      '<div class="bgu-footer"><div class="bgu-status" id="bguStatus" role="status">Додавай все, що сподобається ♥</div>' +
      '<button type="button" class="bgu-continue">Продовжити оформлення →</button></div></section>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay || event.target.closest('.bgu-x, .bgu-continue')) return close();
      var tab = event.target.closest('[data-category]');
      if (tab) {
        activeCategory = tab.dataset.category;
        renderCards();
        overlay.querySelector('#bguCards').scrollTop = 0;
        return;
      }
      var card = event.target.closest('[data-product]');
      if (!card) return;
      var product = catalog.find(function (item) { return item.uid === card.dataset.product; });
      var swatch = event.target.closest('[data-color]');
      if (swatch) {
        selectedColors[product.uid] = swatch.dataset.color;
        renderCards();
      } else if (event.target.closest('.bgu-add')) {
        addProduct(product, event.target.closest('.bgu-add'));
      }
    });
    overlay.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      var buttons = Array.from(overlay.querySelectorAll('button:not(:disabled)'));
      var first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }

  window.__bgUpsell = function (product, ctx) {
    if (!product || !ctx || !ctx.cart || pendingTimer || (overlay && overlay.classList.contains('on'))) return;
    try { if (sessionStorage.getItem('bg_upsell_off')) return; } catch (error) {}
    catalog = (ctx.all || []).filter(function (item) {
      return item.active !== false && Number(item.price) > 0 &&
        (['belt','choker','puff-bag'].indexOf(item.uid) >= 0 || /^(mug|plate)-/.test(item.uid));
    });
    if (!catalog.length) return;
    context = ctx;
    activeCategory = 'accessories';
    if (!catalog.some(function (item) { return category(item) === activeCategory; })) activeCategory = category(catalog[0]);
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      if (!context.cart.length) return;
      if (!overlay) build();
      previousFocus = document.activeElement;
      renderCards();
      document.body.classList.add('bgu-lock');
      overlay.classList.add('on');
      overlay.querySelector('.bgu-x').focus();
    }, 450);
  };
})();
