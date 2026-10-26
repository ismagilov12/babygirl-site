(function () {
  'use strict';
  if (document.documentElement.lang !== 'uk') return;

  var PAYMENTS = 4;
  var PRICE_SELECTOR = '.card-meta, .suit-launch__price, .suits-price, #pmPrice';
  var scheduled = false;
  var money = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 });
  var moneyWithCents = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function amount(text) {
    var value = Number(String(text || '').replace(/\s|\u00a0|\u202f/g, '').replace(/[^\d.,]/g, '').replace(',', '.'));
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  // Old prices are separate elements; never concatenate them with the sale price.
  function currentPrice(element) {
    if (!element) return 0;
    var copy = element.cloneNode(true);
    copy.querySelectorAll('.old, .pm-old, [data-bg-parts]').forEach(function (old) { old.remove(); });
    return amount(copy.textContent);
  }

  function show(price, anchor, variant) {
    if (!anchor) return;
    var badge = anchor.nextElementSibling;
    if (!badge || !badge.hasAttribute('data-bg-parts')) badge = null;
    if (!price) {
      if (badge) badge.remove();
      return;
    }
    var value = Math.round(price * 100 / PAYMENTS) / 100;
    var payment = (Number.isInteger(value) ? money : moneyWithCents).format(value);
    var signature = price + ':' + variant;
    if (badge && badge.dataset.bgParts === signature) return;
    if (!badge) {
      badge = document.createElement('div');
      anchor.insertAdjacentElement('afterend', badge);
    }
    badge.dataset.bgParts = signature;
    badge.className = 'bg-parts bg-parts--' + variant;
    badge.setAttribute('aria-label', 'Оплата частинами: ' + PAYMENTS + ' платежі по ' + payment + ' гривень');
    if (variant === 'modal') {
      badge.innerHTML = '<div class="bg-parts__heading"><span class="bg-parts__heart" aria-hidden="true">♥</span>Оплата частинами<span class="bg-parts__tag">PAY IN 4</span></div>'
        + '<div class="bg-parts__amount"><b>' + payment + ' ₴</b><span>× ' + PAYMENTS + ' платежі</span></div>'
        + '<div class="bg-parts__banks">mono · ПриватБанк</div>'
        + '<p class="bg-parts__note">Обери оплату частинами на сторінці оплати.</p>';
    } else {
      badge.innerHTML = '<span class="bg-parts__heart" aria-hidden="true">♥</span><span>частинами <span class="bg-parts__plan"><b>' + payment + ' ₴</b> × ' + PAYMENTS + '</span></span>';
    }
  }

  function decorate() {
    scheduled = false;
    document.querySelectorAll('.card').forEach(function (card) {
      var price = card.querySelector('.card-price:not(.old)');
      show(currentPrice(price), card.querySelector('.card-meta'), 'card');
    });
    document.querySelectorAll('.suit-launch__price, .suits-price').forEach(function (price) {
      show(currentPrice(price.querySelector('.now') || price), price, 'featured');
    });
    var modalPrice = document.getElementById('pmPrice');
    if (modalPrice) show(currentPrice(modalPrice), modalPrice.closest('.pm-price'), 'modal');
  }

  function relevant(record) {
    var target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    if (target && target.closest('[data-bg-parts]')) return false;
    if (target && target.closest(PRICE_SELECTOR)) return true;
    return Array.prototype.some.call(record.addedNodes, function (node) {
      return node.nodeType === 1 && !node.hasAttribute('data-bg-parts') &&
        (node.matches(PRICE_SELECTOR) || !!node.querySelector(PRICE_SELECTOR));
    });
  }

  function boot() {
    decorate();
    new MutationObserver(function (records) {
      if (!scheduled && records.some(relevant)) {
        scheduled = true;
        requestAnimationFrame(decorate);
      }
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
