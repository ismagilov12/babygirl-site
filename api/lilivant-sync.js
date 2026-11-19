// BabyGirl -> LILIVANT. Preview is read-only; publishing requires two server-side secrets.
// Never expose LILIVANT_API_KEY or LILIVANT_SYNC_TOKEN in a browser or repository.
const SOURCE = 'https://www.babygirl.com.ua';
const DEST = 'https://webhooks.garnetmarketplace.com/sellers/api';
const BLOCKED = new Set(['doggy-style','pet-friendly','michael-jackson']);
const absolute = value => new URL(String(value || ''), SOURCE + '/').href;
const unique = values => [...new Set(values.filter(Boolean))];
function dataFromHtml(html) {
  const match = html.match(/<script\s+id="DATA"\s+type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Embedded BabyGirl catalog not found');
  const hidden = html.match(/var STOREFRONT_HIDDEN\s*=\s*\{([\s\S]*?)\};/);
  if (!hidden) throw new Error('Visibility rules not found; refusing to sync');
  const excluded = new Set([...hidden[1].matchAll(/['"]([^'"]+)['"]\s*:\s*1/g)].map(x => x[1]));
  const brand = html.match(/window\.SUPABASE_URL\s*=\s*'([^']+)'/);
  const anon = html.match(/window\.SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
  return { data: JSON.parse(match[1]), excluded, sb: brand?.[1], anon: anon?.[1] };
}
async function loadCatalog() {
  const response = await fetch(SOURCE, {headers:{Accept:'text/html'}});
  if (!response.ok) throw new Error('BabyGirl website returned '+response.status);
  const {data,excluded,sb,anon} = dataFromHtml(await response.text());
  // The storefront merges live Supabase rows over embedded DATA. Match that behavior.
  if (!sb || !anon) throw new Error('Live catalog connection missing; refusing stale import');
  const db = await fetch(sb + '/rest/v1/bg_products?select=*&order=sort_order.asc', {
    headers: {apikey:anon, Authorization:'Bearer '+anon}
  });
  if (!db.ok) throw new Error('Live catalog unavailable: '+db.status);
  const rows = await db.json();
  if (!Array.isArray(rows)) throw new Error('Invalid live catalog');
  const byId = new Map((data.all || []).map(p=>[p.uid,p]));
  const order = new Set((data.grid || []).filter(uid=>!excluded.has(uid)));
  for (const row of rows) {
    if (!row || !row.uid || String(row.family||'').startsWith('sg-') || excluded.has(row.uid)) continue;
    if (row.active === false) {byId.delete(row.uid);order.delete(row.uid);continue;}
    byId.set(row.uid, {...(byId.get(row.uid)||{}),...row});
    order.delete(row.uid);
    if (row.in_grid !== false) order.add(row.uid);
  }
  return [...order].map(id=>byId.get(id)).filter(p=>
    p && p.active !== false && p.in_grid !== false &&
    !excluded.has(p.uid) && !BLOCKED.has(p.uid) &&
    (p.family === 'tee' || p.family === 'hoodie'));
}
function toProduct(p) {
  const images = unique([p.photo_main,...(Array.isArray(p.photos)?p.photos:[]),
    ...(Array.isArray(p.colors)?p.colors.flatMap(c=>[c.photo,...(c.photos||[])]):[])])
    .filter(x=>typeof x==='string' && !x.startsWith('data:'))
    .map(src=>({src:absolute(src),alt:p.title}));
  const sizes = Array.isArray(p.sizes)&&p.sizes.length?p.sizes:['ONE SIZE'];
  const colors = Array.isArray(p.colors)&&p.colors.length?p.colors.map(c=>c.name||c.code).filter(Boolean):['Default'];
  const base = p.family === 'tee' ? 1300 : Number(p.price);
  if (!Number.isFinite(base)||base<=0||!images.length) throw new Error('Incomplete product '+p.uid);
  const price = Math.round(base*1.3);
  const variants = [];
  for (const size of sizes) for (const color of colors) variants.push({
    sku: ('BG-'+p.uid+'-'+size+'-'+color).replace(/[^a-zA-Z0-9-]/g,'-').slice(0,95),
    price, inventoryQuantity:0, tracked:false,
    optionValues:[{name:'Size',value:String(size)},{name:'Color',value:String(color)}]
  });
  return {
    externalId:'babygirl-'+p.uid, title:p.title,
    descriptionHtml:'<p>'+String(p.title).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))+'</p><p>BabyGirl original design. Made to order.</p>',
    productType:p.family==='tee'?'T-Shirt':'Hoodie',
    tags:['BabyGirl',p.family],
    images, variants, productOptions:[{name:'Size',values:sizes.map(String)},{name:'Color',values:colors.map(String)}]
  };
}
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  try {
    const products=(await loadCatalog()).map(toProduct);
    if(req.method==='GET') return res.status(200).json({
      mode:'preview',count:products.length,
      items:products.map(p=>({id:p.externalId,title:p.title,price:p.variants[0].price,
        images:p.images.length,variants:p.variants.length}))
    });
    const token=process.env.LILIVANT_SYNC_TOKEN;
    const apiKey=process.env.LILIVANT_API_KEY;
    if(!token||!apiKey||req.headers.authorization !== 'Bearer '+token)
      return res.status(403).json({error:'Publishing is locked until credentials are configured'});
    const results=[];
    for(const product of products){
      const response=await fetch(DEST,{method:'POST',headers:{
        Authorization:'Bearer '+apiKey,'X-Garnet-Topic':'products/update',
        'Content-Type':'application/json'
      },body:JSON.stringify(product)});
      if(!response.ok) throw new Error('LILIVANT rejected '+product.externalId+' ('+response.status+')');
      results.push(product.externalId);
    }
    return res.status(200).json({published:results.length,ids:results});
  }catch(err){return res.status(500).json({error:err.message});}
};
