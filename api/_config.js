// api/_config.js — brand-specific values для BabyGirl v2.
//
// Этот файл коммитится; секреты — только в Vercel env (.env.example).

module.exports = {
  BRAND: 'bg',
  SITE_DOMAIN: 'babygirl.com.ua',
  PROJECT_NAME: 'BabyGirl',

  ALLOWED_ORIGINS_EXACT: [
    'https://babygirl.com.ua',
    'https://www.babygirl.com.ua',
    'https://showgirl.world',
    'https://www.showgirl.world',
    'https://babygirl-site-six.vercel.app',
    'https://babygirl-site-ismagilov12s-projects.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  ALLOWED_ORIGIN_SUFFIX: ['.vercel.app'],

  T: {
    PRODUCTS: 'bg_products',
    ORDERS: 'bg_orders',
    PROMOS: 'bg_promos',
    WAYFORPAY_EVENTS: 'bg_wayforpay_events',
    ANALYTICS_EVENTS: 'bg_analytics_events',
    SETTINGS: 'bg_settings',
  },

  RL: {
    order: 10,
    wayforpay: 30,
    promo: 20,
  },

  KEYCRM: {
    enabled: false,
  },

  COD_PREPAYMENT_AMOUNT_UAH: 200,
};
