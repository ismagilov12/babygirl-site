import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {POST} from '../api/generate.js';
import designs from '../api/designs.json' with {type:'json'};
const originalFetch=globalThis.fetch;
const image='data:image/jpeg;base64,YWJj';
const designId=Object.keys(designs)[0];
function request(body,origin='https://teplo.example') {
  return new Request('https://teplo.example/api/generate',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
}
afterEach(()=>{globalThis.fetch=originalFetch;delete process.env.OPENAI_API_KEY;delete process.env.GENERATION_ACCESS_CODE;});
test('missing server key fails explicitly',async()=>{delete process.env.OPENAI_API_KEY;assert.equal((await POST(request({}))).status,503);});
test('cross-origin requests are rejected before generation',async()=>{process.env.OPENAI_API_KEY='test';assert.equal((await POST(request({},'https://other.example'))).status,403);});
test('invalid input cannot call paid API',async()=>{
 process.env.OPENAI_API_KEY='test';globalThis.fetch=()=>assert.fail('Paid API must not be called');
 for(const body of [null,[],{designId:'toString',photos:[image],template:image},{designId,photos:[image,image,image],template:image},{designId,photos:['https://private.example'],template:image}])assert.equal((await POST(request(body))).status,400);
});
test('preview code protects paid generation when configured',async()=>{
 process.env.OPENAI_API_KEY='test';process.env.GENERATION_ACCESS_CODE='private-code';globalThis.fetch=()=>assert.fail('Paid API must not be called');
 assert.equal((await POST(request({designId,photos:[image],template:image,accessCode:'wrong'}))).status,403);
});
test('server fixes model, count and prompt; returns image and no key',async()=>{
 process.env.OPENAI_API_KEY='test-secret';let called=0;
 globalThis.fetch=async(url,init)=>{called++;assert.equal(url,'https://api.openai.com/v1/images/edits');const b=JSON.parse(init.body);assert.equal(b.n,1);assert.equal(b.model,'gpt-image-1.5');assert.equal(b.images.length,3);assert.equal(b.images[2].image_url,image);assert.ok(!b.prompt.includes('ATTACK'));assert.equal(init.headers.Authorization,'Bearer test-secret');return Response.json({data:[{b64_json:'YWJj'}]});};
 const response=await POST(request({designId,photos:[image,image],template:image,prompt:'ATTACK',n:10,model:'evil'}));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{designId,image});assert.equal(called,1);
});
test('provider errors do not leak response contents or trigger retries',async()=>{
 process.env.OPENAI_API_KEY='test';let called=0;globalThis.fetch=async()=>{called++;return Response.json({error:{message:'secret internals'}},{status:429});};
 const response=await POST(request({designId,photos:[image],template:image}));assert.equal(response.status,429);assert.ok(!(await response.text()).includes('secret internals'));assert.equal(called,1);
});
test('oversized stream is rejected',async()=>{process.env.OPENAI_API_KEY='test';assert.equal((await POST(request({padding:'x'.repeat(3_500_001)}))).status,413);});
