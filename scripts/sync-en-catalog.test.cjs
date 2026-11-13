const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {sync} = require('./sync-en-catalog.cjs');
const ua = fs.readFileSync('index.html','utf8');
const en = fs.readFileSync('en.html','utf8');
const dataRE = /<script id="DATA" type="application\/json">([\s\S]*?)<\/script>/;
test('catalog generation is repeatable and preserves international checkout',()=>{
  const next = sync(ua,en);
  assert.equal(sync(ua,next),next);
  assert.deepEqual(JSON.parse(next.match(dataRE)[1]),JSON.parse(ua.match(dataRE)[1]));
  const checkout = s => s.slice(s.indexOf('// ======== EN CHECKOUT'),s.indexOf('  function renderSuits'));
  // Only catalog code follows checkout; compare through the deep-link handler boundary.
  const payment = s => checkout(s).split('  // BEGIN SYNCED DROPS')[0];
  assert.equal(payment(next),payment(en));
  for(const name of ['EUR_RATE','EN_SALE_PCT','EN_MARKUP_BASE']) assert.equal(next.match(new RegExp('var '+name+' = [^;]+'))[0],en.match(new RegExp('var '+name+' = [^;]+'))[0]);
  assert.ok(!next.includes('function enPrune'));
});
test('future UA product, ordering and visibility edits propagate automatically',()=>{
  const data = JSON.parse(ua.match(dataRE)[1]);
  data.all.unshift({uid:'sync-test-new-product',family:'tee',active:true,in_grid:true,price:100,photo_main:'future.webp'});
  data.grid.unshift('sync-test-new-product');
  const changed = ua.replace(dataRE,()=>'<script id="DATA" type="application/json">'+JSON.stringify(data)+'</script>')
    .replace('var STOREFRONT_HIDDEN = {',"var STOREFRONT_HIDDEN = { 'future-hidden':1,")
    .replace('var BESTSELLER_UIDS = [','var BESTSELLER_UIDS = ["sync-test-new-product",')
    .replace("'hoodie':0, 'sexy-set':1", "'hoodie':1, 'sexy-set':0");
  const next = sync(changed,en);
  assert.equal(JSON.parse(next.match(dataRE)[1]).grid[0],'sync-test-new-product');
  assert.ok(next.includes("'future-hidden':1"));
  assert.ok(next.includes('var BESTSELLER_UIDS = ["sync-test-new-product",'));
  assert.ok(next.includes("'hoodie':1, 'sexy-set':0"));
});
test('missing source anchors block a stale release',()=>{
  assert.throws(()=>sync(ua.replace('function renderGrid()', 'function renamedGrid()'),en),/renderGrid/);
});
