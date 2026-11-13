# Ukrainian and European catalog

`index.html` is the source of truth for embedded products, category rules,
visibility, bestsellers, thumbnails, card ordering and product sections.
Both storefronts load the same live `bg_products` rows using the same merge logic.

Vercel runs `scripts/build-storefront.cjs`. After the existing catalog build,
`scripts/sync-en-catalog.cjs` generates the corresponding parts of `en.html`
from `index.html`, then runs the synchronization checks. It preserves the
European pricing adapter, English copy and international checkout.

Change shared catalog behavior in the Ukrainian page, then run:

```
node scripts/build-storefront.cjs
```

Commit the regenerated `en.html` as well. Every deployment regenerates it again,
so later changes to the source catalog do not require a separate manual EN edit.
Missing source anchors stop the build; update the generator when refactoring the
source page's structure. Translations for new copy belong in the market adapter.

This synchronizes website catalogs. Advertising-feed eligibility remains governed
by each feed's existing settings and is not broadened by this change.
