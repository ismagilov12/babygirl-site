// api/_config.example.js — пример. Скопируй в api/_config.js и поправь под бренд.
//
// Секреты сюда НЕ кладём — они в Vercel env vars (.env.example).

module.exports = {
  // === Identity ===
  BRAND: 'bg',                          // short slug, префикс таблиц Supabase
  SITE_DOMAIN: 'babygirl.example.com',   // публичный домен (return/service URL)
  PROJECT_NAME: 'BabyGirl',              // отображается юзеру / в Telegram

  // === CORS whitelist ===
  ALLOWED_ORIGINS_EXACT: [
    'https://babygirl.example.com',
    'https://www.babygirl.example.com',
    'https://babygirl.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  ALLOWED_ORIGIN_SUFFIX: ['.vercel.app'],

  // === Supabase tables (префикс bg_) ===
  T: {
    PRODUCTS: 'bg_products',
    ORDERS: 'bg_orders',
    PROMOS: 'bg_promos',
    WAYFORPAY_EVENTS: 'bg_wayforpay_events',
    ANALYTICS_EVENTS: 'bg_analytics_events',
    SETTINGS: 'bg_settings',
  },

  // === Rate limits per endpoint (per IP per minute) ===
  RL: {
    order: 10,
    wayforpay: 30,
    promo: 20,
  },

  // === KeyCRM (опционально) ===
  KEYCRM: {
    enabled: false,
  },

  // === COD prepayment (наложка) ===
  // Для COD WayForPay списывает фиксированную предоплату, не полный кошик.
  // 0 = выключено.
  COD_PREPAYMENT_AMOUNT_UAH: 200,
};
