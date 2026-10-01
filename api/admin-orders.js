// Orders use the same server-verified password as the product admin.
const crypto = require('crypto');
module.exports = async function(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const expected = process.env.BG_ADMIN_PASSWORD;
  const supplied = req.headers['x-admin-password'];
  if (!expected) return res.status(503).json({error:'Admin unavailable'});
  if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
      !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) {
    return res.status(401).json({error:'Unauthorized'});
  }
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{return res.status(400).json({error:'Invalid JSON'})}}
  body=body||{};
  const method=body.method||'GET';
  if(typeof body.path!=='string'||!/^bg_orders(?:\?|$)/.test(body.path)||body.path.includes('#')||
     !['GET','PATCH','DELETE'].includes(method)) return res.status(400).json({error:'Invalid order operation'});
  const parsed=new URL('https://orders.invalid/'+body.path);
  if(method!=='GET' && !/^eq\.\d+$/.test(parsed.searchParams.get('id')||'')) return res.status(400).json({error:'Single order id required'});
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return res.status(503).json({error:'Database unavailable'});
  try {
    const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+body.path,{
      method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},
      body:method==='PATCH'?JSON.stringify(body.payload||{}):undefined
    });
    if(!r.ok)return res.status(502).json({error:'Order operation failed'});
    const text=await r.text();
    return res.status(200).json(text?JSON.parse(text):null);
  }catch(e){return res.status(503).json({error:'Order operation unavailable'})}
};
