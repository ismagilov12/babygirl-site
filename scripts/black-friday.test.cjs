'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const campaign = require('../api/_black-friday');
const source = fs.readFileSync('black-friday.html', 'utf8');
const catalog = Object.fromEntries(Object.entries({
  'tee-test':['tee',1500], 'hoodie-test':['hoodie',2425], 'crop-test':['crop',1235], 'long-test':['long',1525],
  'choker':['belt',370], 'belt':['belt',1130], 'small-belt':['belt',180], 'set-test':['sexy-set',1200],
  'baby-girl-sexy-set-gothic-white':['crop',1200],
  'plate-test':['plate',499], 'mug-test':['plate',399], 'ceramics':['plate',499],
  'suit-baby-girl':['suit',4500], 'sg-test':['sg-set',2000], 'threshold':['suit',8000], 'over-threshold':['suit',8001]
}).map(([uid,[family,price]]) => [uid,{uid,family,price,active:true}]));
const cfg = {
  T:{PRODUCTS:'bg_products',ORDERS:'bg_orders',PROMOS:'bg_promos'},
  ALLOWED_ORIGINS_EXACT:['https://www.babygirl.com.ua'],ALLOWED_ORIGIN_SUFFIX:[],
  RL:{order:10,wayforpay:10},KEYCRM:{enabled:false},COD_PREPAYMENT_AMOUNT_UAH:200,
  PROJECT_NAME:'BabyGirl',SITE_DOMAIN:'www.babygirl.com.ua'
};

function harness(file, state) {
  const sandbox = {
    module:{exports:{}}, console, URL, URLSearchParams, Buffer,
    process:{env:{SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',WAYFORPAY_MERCHANT:'test-only',WAYFORPAY_SECRET:'test-only'}},
    require(name){
      if(name==='./_config')return cfg;
      if(name==='./_black-friday')return campaign;
      if(name==='./_tg')return {fireAndForget(){},notifyAdminNewOrder(){}};
      if(name==='crypto')return require('node:crypto');
      throw new Error('Unexpected dependency '+name);
    },
    async fetch(url, options={}){
      const path=new URL(url).pathname.split('/rest/v1/')[1];
      const body=options.body ? JSON.parse(options.body) : null;
      let data;
      if(path==='rpc/check_and_increment_rate_limit')data={allowed:true};
      else if(path==='rpc/compute_order_total') {
        const breakdown=body.p_items.map(item=>({uid:item.uid,qty:Math.max(1,item.qty),unit_price:catalog[item.uid]?.price}));
        data=state.failPricing || breakdown.some(x=>!x.unit_price) ? {ok:false,error:'unknown items'}
          : {ok:true,breakdown,total:breakdown.reduce((s,x)=>s+x.qty*x.unit_price,0)};
      } else if(path==='bg_orders' && options.method==='POST') {
        if (state.failSave) return {ok:false,status:503,text:async()=>''};
        state.saved=body;data=[body];
      }
      else if(path==='bg_orders')data=state.saved ? [state.saved] : [];
      else if(path==='bg_products'){
        const query=new URL(url).searchParams;
        const uids=JSON.parse('['+query.get('uid').slice(4,-1)+']');
        data=uids.filter(uid=>catalog[uid] && uid!==state.missingUid).map(uid=>({...catalog[uid],title:uid,color_name:''}));
      }
      else if(path==='bg_promos') {state.promoReads++;data=[{percent:10,active:true}];}
      else throw new Error('Unexpected request '+url);
      return {ok:true,text:async()=>JSON.stringify(data),json:async()=>data};
    }
  };
  vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
  return async body=>{
    const response={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;},end(){return this;}};
    await sandbox.module.exports({method:'POST',headers:{origin:'https://www.babygirl.com.ua'},body},response);
    return response;
  };
}
function orderBody(items, extra={}){return {fio:'Local test',phone:'+380000000000',city:'Test',wh:'Test',payment:'card',stage:'final',items,campaign:campaign.ID,...extra};}
function paymentBody(order, extra={}){return {orderReference:order.number,items:order.items.map(({uid,qty})=>({uid,qty})),payment_method:order.payment_method,campaign:campaign.ID,...extra};}

test('discounted amounts are identical in saved orders and signed card payment fields',async()=>{
  const state={promoReads:0};
  const order=harness('api/order.js',state), pay=harness('api/wayforpay.js',state);
  const items=[{uid:'tee-test|pink',qty:1,price:1},{uid:'hoodie-test|black',qty:1,price:999},{uid:'choker',qty:1,family:'crop',price:1}];
  const result=await order(orderBody(items,{bundle_discount_pct:50,promo_code:'ANY'}));
  assert.equal(result.statusCode,200);assert.equal(result.data.authoritative_total,3850);
  assert.deepEqual(state.saved.items.map(x=>x.price),[1290,2190,370]);
  assert.deepEqual(state.saved.items.map(x=>x.price_old),[1500,2425,null]);
  assert.ok(state.saved.notes.includes(campaign.NOTE));assert.equal(state.promoReads,0);
  const payment=await pay(paymentBody(state.saved,{bundle_discount_pct:50,promo_code:'ANY'}));
  assert.equal(payment.statusCode,200);assert.equal(payment.data.authoritativeAmount,3850);
  assert.equal(Number(payment.data.formData.amount),state.saved.total);
  assert.equal(payment.data.formData.productPrice.reduce((s,p,i)=>s+Number(p)*Number(payment.data.formData.productCount[i]),0),state.saved.total);
});
test('accessories retain their ordinary unit prices and COD is capped at the order total',async()=>{
  for (const [uid,regular,deposit] of [['choker',370,200],['belt',1130,200],['small-belt',180,180]]) {
    const state={promoReads:0};
    await harness('api/order.js',state)(orderBody([{uid,qty:1}],{payment:'cod'}));
    assert.equal(state.saved.total,regular);assert.equal(state.saved.items[0].price_old,null);
    const result=await harness('api/wayforpay.js',state)(paymentBody(state.saved));
    assert.equal(result.data.authoritativeAmount,deposit);
  }
});
test('cropped tops and long tees retain the correct unit prices for every quantity',async()=>{
  const state={promoReads:0}, order=harness('api/order.js',state);
  const result=await order(orderBody([{uid:'crop-test',qty:2},{uid:'long-test',qty:1}]));
  assert.equal(result.data.authoritative_total,3270);
  assert.deepEqual(state.saved.items.map(x=>x.price),[990,1290]);
  assert.equal((await harness('api/wayforpay.js',state)(paymentBody(state.saved))).data.authoritativeAmount,3270);
});
test('both campaign entry points reject tableware, Sexy Sets and missing trusted category records',async()=>{
  for (const uid of ['mug-test','plate-test','ceramics','set-test','baby-girl-sexy-set-gothic-white','tee-test']) {
    const state={promoReads:0,missingUid:'tee-test'};
    const items=[{uid,qty:1,family:'tee',price:1290}];
    assert.equal((await harness('api/order.js',state)(orderBody(items))).statusCode,400);
    assert.equal(state.saved,undefined);
    assert.equal((await harness('api/wayforpay.js',state)({orderReference:'LOCAL',items,payment_method:'card',campaign:campaign.ID})).statusCode,400);
  }
});
test('ordinary orders retain ordinary pricing and existing promo/bundle behavior',async()=>{
  for(const extra of [{},{promo_code:'TEN',bundle_discount_pct:10}]) {
    const state={promoReads:0};
    const body=orderBody([{uid:'tee-test',qty:2,price:1500}],{campaign:undefined,...extra});
    const result=await harness('api/order.js',state)(body);
    assert.equal(result.data.authoritative_total,extra.promo_code ? 2565 : 3000);
    assert.ok(!state.saved.notes.includes(campaign.NOTE));
    const payment=await harness('api/wayforpay.js',state)(paymentBody(state.saved,{campaign:undefined,...extra}));
    assert.equal(payment.data.authoritativeAmount,state.saved.total);
  }
});
test('campaign rejects missing authoritative prices for both card and COD',async()=>{
  for(const payment of ['card','cod']) {
    const state={promoReads:0,failPricing:true};
    const result=await harness('api/order.js',state)(orderBody([{uid:'tee-test',qty:1,price:1}],{payment}));
    assert.equal(result.statusCode,400);assert.equal(state.saved,undefined);
  }
});
test('Showgirl and mismatched or ordinary order references cannot use campaign payment',async()=>{
  const state={promoReads:0};
  const order=harness('api/order.js',state),pay=harness('api/wayforpay.js',state);
  assert.equal((await order(orderBody([{uid:'sg-test',qty:1}]))).statusCode,400);
  await order(orderBody([{uid:'tee-test|black',qty:1}]));
  assert.equal((await pay(paymentBody(state.saved,{items:[{uid:'tee-test',qty:2}]}))).statusCode,400);
  state.saved.items[0].price=750;
  assert.equal((await pay(paymentBody(state.saved))).statusCode,400);
  state.saved.items[0].price=1290;
  state.saved.notes='САЙТ';
  assert.equal((await pay(paymentBody(state.saved))).statusCode,400);
});
test('browser discount survives repeated rendering and fresh catalog updates',()=>{
  const code=source.match(/  function applyHoodieSeasonSale\(products\)\{[\s\S]*?\n  applyBlackFridayPrices\(D.all\);/)[0];
  const p={uid:'test',family:'hoodie',price:2425,price_old:3490,attrs:{specs:[]}};
  const tee={uid:'tee-test',family:'tee',price:2100};
  const belt={...catalog.belt,price_old:1500};
  const suit={...catalog['suit-baby-girl'],price_old:6000};
  const ctx={D:{all:[p,tee,belt,suit]}};vm.createContext(ctx);vm.runInContext(code,ctx);
  assert.equal(tee.price_old,1500);assert.equal(tee.price,1290);
  assert.equal(p.price,2190);assert.equal(p.price_old,2425);
  assert.equal(belt.price_old,null);assert.equal(belt.price,1130);assert.equal(belt.ribbon,null);
  assert.equal(suit.price,2890);assert.equal(suit.price_old,4500);
  vm.runInContext('applyBlackFridayPrices(D.all)',ctx);assert.equal(p.price,2190);
  delete p._bfApplied;Object.assign(p,{price:2990,price_old:3490});
  vm.runInContext('applyBlackFridayPrices(D.all)',ctx);assert.equal(p.price,2190);assert.equal(p.price_old,2990);
});
test('the embedded catalog, navigation and offer copy reflect the edited campaign',()=>{
  const data=JSON.parse(source.match(/<script id="DATA" type="application\/json">([\s\S]+?)<\/script>/)[1]);
  assert.ok(data.all.every(product=>campaign.campaignIncludes(product)));
  const ids=new Set(data.all.map(p=>p.uid));
  assert.ok([...data.grid,...data.featured].every(item=>ids.has(typeof item==='string'?item:item.uid)));
  assert.ok(ids.has('suit-baby-girl'));
  assert.ok(!data.all.some(p=>p.family==='sexy-set' || p.uid.startsWith('baby-girl-sexy-set-')));
  assert.doesNotMatch(source,/<a\b[^>]*(?:data-family="sexy-set"|href="#sexy-set")/);
  const suitSection=source.match(/<section id="suits"[\s\S]*?<\/section>/)[0];
  assert.match(suitSection,/class="suit-launch__price">2\s?890 ₴</);
  assert.match(suitSection,/class="suit-launch__price-sticker">2\s?890 ₴</);
  assert.doesNotMatch(suitSection,/2\s?250|−50%/);
  assert.ok(!/data-family="plate"|bgPlateLaunchTitle|−50% на (?:весь|всі|все)|HALF THE PRICE/i.test(source));
  const poster=source.match(/<dl class="bf-hero-offer"[\s\S]*?<\/dl>/)[0].replace(/\s+/g,'');
  for (const [label,price] of [['Футболки',1290],['Худі',2190],['Кроп-топи',990]]) {
    assert.ok(poster.includes('<dt>'+label+'</dt><dd>'+price+'<small>₴</small>'));
  }
});
test('the large-order deposit uses the discounted total and the current store threshold',async()=>{
  for (const method of ['card','cod']) {
    for (const [uid,total] of [['suit-baby-girl|pink',2890],['suit-baby-girl|black',2890],['threshold',4000],['over-threshold',4000.5]]) {
      const state={promoReads:0};
      const order=await harness('api/order.js',state)(orderBody([{uid,qty:1}],{payment:method,expected_total:total}));
      assert.equal(order.data.authoritative_total,total);
      const payment=await harness('api/wayforpay.js',state)(paymentBody(state.saved));
      const dueNow=total>4000 ? 1500 : method==='cod' ? 200 : total;
      assert.equal(payment.data.authoritativeAmount,dueNow);
      assert.equal(payment.data.fullOrderAmount,total);
      assert.equal(payment.data.remainingAmount,total-dueNow);
      assert.equal(state.saved.notes.includes('ПЕРЕДОПЛАТА 1500'),total>4000);
    }
  }
});
test('a changed cart total or unsuccessful save stops checkout before payment',async()=>{
  const state={promoReads:0};
  const order=harness('api/order.js',state);
  const items=[{uid:'tee-test',qty:1}];
  assert.equal((await order(orderBody(items,{expected_total:1050}))).statusCode,409);
  assert.equal(state.saved,undefined);
  state.failSave=true;
  assert.equal((await order(orderBody(items,{expected_total:1290}))).statusCode,503);
  assert.equal(state.saved,undefined);
});
test('campaign is absent from the regular storefront and regular promo state is untouched',()=>{
  assert.ok(!fs.readFileSync('index.html','utf8').includes(campaign.ID));
  assert.ok(!fs.readFileSync('en.html','utf8').includes(campaign.ID));
  assert.ok(!source.includes("getItem('bg_promo"));
  assert.ok(!source.includes("setItem('bg_promo"));
  assert.ok(!source.includes('babygirl-upsell.js'));
  assert.equal((source.match(/campaign: 'babygirl-black-friday-2026'/g)||[]).length,2);
});
