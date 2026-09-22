const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const cfg=require('../api/_config');
function load(file,fetch,deps={}) {
 const env={SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',WAYFORPAY_MERCHANT:'test',WAYFORPAY_SECRET:'secret'};
 const sandbox={module:{exports:{}},require:n=>deps[n]|| (n==='./_config'?cfg:n==='./_tg'?{fireAndForget(){},notifyAdminNewOrder(){}}:require(n)),process:{env},fetch,console:{log(){},warn(){},error(){}},URLSearchParams,AbortSignal,setTimeout};
 vm.runInNewContext(fs.readFileSync(path.join(root,'api',file),'utf8'),sandbox);
 return sandbox.module.exports;
}
const response=(data,ok=true)=>({ok,status:ok?200:503,text:async()=>JSON.stringify(data)});
async function call(handler,body){const res={code:200,setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this},end(){return this}};await handler({method:'POST',body,headers:{'user-agent':'buyer','x-forwarded-for':'192.0.2.1'}},res);return res;}
const body={fio:'Test',phone:'test',payment:'card',items:[{uid:'suit|black',qty:2,price:1}],bundle_discount_pct:50};
function orderDB({saveFails=false,priceFails=false}={}) {const saved=[];return {saved,fetch:async(url,opts)=>{if(url.includes('rate_limit'))return response({allowed:true});if(url.includes('compute_order_total'))return response(priceFails?null:{ok:true,total:12000,breakdown:[{uid:'suit',qty:2,unit_price:6000}]});if(url.endsWith('/bg_orders')){if(saveFails)return response({},false);const o={id:'test-id',...JSON.parse(opts.body)};saved.push(o);return response([o]);}if(url.endsWith('/bg_order_tracking'))return response([JSON.parse(opts.body)]);throw Error('Unexpected request '+url)}}}
test('server ignores forged 50% discount and stores authoritative unit price',async()=>{const db=orderDB();const r=await call(load('order.js',db.fetch),body);assert.equal(r.code,200);assert.equal(r.data.authoritative_total,11400);assert.equal(db.saved[0].items[0].price,6000);});
test('failed database save cannot return success',async()=>{const db=orderDB({saveFails:true});const r=await call(load('order.js',db.fetch),body);assert.equal(r.code,503);assert.equal(r.data.ok,false)});
test('price lookup failure cannot trust browser for COD',async()=>{const db=orderDB({priceFails:true});const r=await call(load('order.js',db.fetch),{...body,payment:'cod'});assert.equal(r.code,503);assert.equal(db.saved.length,0)});
test('payment intent ignores forged amount and COD override',async()=>{const fetch=async url=>response(url.includes('rate_limit')?{allowed:true}:[{order_data:{total:11400,items:body.items,payment_method:'card',status:'new'}}]);const r=await call(load('wayforpay.js',fetch),{orderReference:'BG-test',amount:1,payment_method:'cod'});assert.equal(r.code,200);assert.equal(r.data.formData.amount,'11400.00')});
test('payment requires private saved order',async()=>{const r=await call(load('wayforpay.js',async url=>response(url.includes('rate_limit')?{allowed:true}:[])),{orderReference:'BG-test'});assert.equal(r.code,409)});
function signed(amount=200){const b={merchantAccount:'test',orderReference:'BG-test',amount,currency:'UAH',authCode:'',cardPan:'',transactionStatus:'Approved',reasonCode:0};b.merchantSignature=crypto.createHmac('md5','secret').update([b.merchantAccount,b.orderReference,b.amount,b.currency,b.authCode,b.cardPan,b.transactionStatus,b.reasonCode].join(';')).digest('hex');return b;}
function callbackDB(){let tracking={order_ref:'BG-test',order_data:{total:6000,payment_method:'cod',items:[{uid:'suit-baby-girl|black',qty:1}],customer_phone:'test'},client_ip:'192.0.2.10',client_ua:'real-buyer'};return async(url,o={})=>{if(url.includes('bg_wayforpay_events'))return response([]);if(url.includes('bg_order_tracking')){if(o.method==='PATCH'||o.method==='POST')tracking={...tracking,...JSON.parse(o.body)};return response([tracking])}if(url.includes('bg_orders'))return response([{id:'order'}]);throw Error(url)}}
test('COD Purchase uses full value, catalog ID and buyer IP; repeat is skipped',async()=>{let events=[];const h=load('wayforpay-callback.js',callbackDB(),{'./_fb_capi':{sendPurchase:async e=>{events.push(e);return {ok:true}}}});assert.equal((await call(h,signed())).code,200);assert.equal((await call(h,signed())).code,200);assert.equal(events.length,1);assert.equal(events[0].value,6000);assert.equal(events[0].content_ids[0],'suit-baby-girl-black');assert.equal(events[0].client_ip,'192.0.2.10')});
test('failed Meta send is retried on duplicate callback',async()=>{let n=0;const h=load('wayforpay-callback.js',callbackDB(),{'./_fb_capi':{sendPurchase:async()=>({ok:++n>1})}});assert.equal((await call(h,signed())).code,503);assert.equal((await call(h,signed())).code,200);assert.equal(n,2)});
test('invalid payment signature and wrong amount are rejected',async()=>{const h=load('wayforpay-callback.js',callbackDB(),{'./_fb_capi':{sendPurchase:async()=>{throw Error('must not send')}}});assert.equal((await call(h,{...signed(),merchantSignature:'fake'})).code,400);assert.equal((await call(h,signed(1))).code,400)});
test('thank-you URLs cannot trigger a browser Purchase',()=>{for(const file of ['thanks.html','api/thanks.js'])assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/fbq\(['"]track['"],\s*['"]Purchase/)});
