// Apply only the requested real price and product photo; receipts prevent future builds overwriting later edits.
const { syncProductToCrm, expectedCrmRows } = require('../api/_crm-catalog');
const RELEASE = 'bad-baby2900-barbphoto-20261103';
const IMAGE = 'assets/barb-wire-main-20261103.jpg';
function patchFor(p) {
  if (p.uid === 'hoodie-bad-baby') return {price:2900};
  const old = p.photo_main;
  const sameOld = value => value === old || String(value || '').replace('https://www.babygirl.com.ua/', '') === String(old || '').replace('https://www.babygirl.com.ua/', '');
  const gallery = list => [IMAGE, ...(Array.isArray(list) ? list : []).filter(x => !sameOld(x) && x !== IMAGE)];
  return {photo_main:IMAGE, photos:gallery(p.photos), colors:(p.colors || []).map(c => ({
    ...c, ...(sameOld(c.photo) ? {photo:IMAGE} : {}), ...(Array.isArray(c.photos) ? {photos:gallery(c.photos)} : {})
  }))};
}
async function runRelease(env = process.env, request = fetch) {
  if (env.VERCEL_ENV !== 'production') return;
  const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!origin||!key) throw new Error('Catalog service configuration missing');
  async function sb(path,options={}) {
    const r=await request(origin+'/rest/v1/'+path,{method:options.method||'GET',headers:{
      apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation',...options.headers
    },body:options.body});
    if(!r.ok) throw new Error('Catalog edit failed: HTTP '+r.status);
    const txt=await r.text();return txt.trim()?JSON.parse(txt):[];
  }
  for(const uid of ['hoodie-bad-baby','long-barbwire','pamela-90s']) {
    let p=(await sb('bg_products?uid=eq.'+uid+'&select=*'))[0];
    if(!p || !p.active) throw new Error('Missing active product: '+uid);
    if(!p.attrs?.[RELEASE]) {
      const patch={...patchFor(p),attrs:{...p.attrs,[RELEASE]:true}};
      const saved=await sb('bg_products?uid=eq.'+uid+'&updated_at=eq.'+encodeURIComponent(p.updated_at),{method:'PATCH',body:JSON.stringify(patch)});
      if(saved.length!==1) throw new Error('Concurrent catalog change: '+uid);
      p=saved[0];
      if(uid==='hoodie-bad-baby' && Number(p.price)!==2900) throw new Error('Hoodie price verification failed');
      if(uid==='long-barbwire' && p.photo_main!==IMAGE) throw new Error('Barb Wire photo verification failed');
    }
    await syncProductToCrm(sb,p,{siteOrigin:'https://www.babygirl.com.ua'});
    const crm=await sb('products?bg_uid=eq.'+uid+'&select=sku,price,image_url,is_active');
    if(expectedCrmRows(p).some(row=>!crm.some(x=>x.sku===row.sku&&Number(x.price)===Number(row.price)&&x.image_url===row.image_url&&x.is_active)))
      throw new Error('CRM verification failed: '+uid);
    console.log('Catalog edit verified: '+uid+'; price '+p.price+' UAH; main photo '+p.photo_main);
  }
}
module.exports={patchFor,runRelease};
if(require.main===module) runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
