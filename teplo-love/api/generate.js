import designs from './designs.json' with { type: 'json' };
import { timingSafeEqual } from 'node:crypto';

const MAX_BODY = 3_500_000;
const reply = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
function validImage(value) {
  return typeof value === 'string' && value.length <= 1_100_000 &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
function validCode(value, expected) {
  const a = Buffer.from(typeof value === 'string' ? value : '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// A request creates exactly one design. The browser queues up to ten choices.
// No client prompt, remote image URL, model, or batch size is forwarded to OpenAI.
export async function POST(request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return reply({error:'Недозволене джерело запиту.'}, 403);
  if (!process.env.OPENAI_API_KEY) return reply({error:'Генерацію ще не налаштовано. Додайте OPENAI_API_KEY у налаштуваннях сервера та повторно опублікуйте сайт.'}, 503);
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({error:'Очікується JSON.'}, 415);
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({error:'Додайте фото.'}, 400);
    const chunks = []; let size = 0;
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return reply({error:'Фото завеликі. Спробуйте інші файли.'}, 413); }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return reply({error:'Не вдалося прочитати фото.'}, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({error:'Некоректний запит.'}, 400);
  const code = process.env.GENERATION_ACCESS_CODE;
  if (code && !validCode(body.accessCode, code)) return reply({error:'Для тестування потрібен код доступу.',code:'ACCESS_CODE_REQUIRED'}, 403);
  const design = typeof body.designId === 'string' && Object.hasOwn(designs, body.designId) ? designs[body.designId] : null;
  if (!design || !Array.isArray(body.photos) || body.photos.length < 1 || body.photos.length > 2 ||
      !body.photos.every(validImage) || !validImage(body.template)) {
    return reply({error:'Оберіть дизайн і додайте одне або два фото.'}, 400);
  }
  const style = design.category === 'cartoon'
    ? 'Transform the couple into expressive, polished cartoon characters. Preserve their recognizable facial features, hairstyles, skin tones and distinctive appearance.'
    : 'Preserve the actual people and their recognizable faces faithfully, with natural photographic detail. Do not substitute stock models.';
  const prompt = `Create a flat printable illustration for a personalized romantic mug. The first ${body.photos.length} image(s) are customer photos. If there are two separate photos, bring both people together naturally. The LAST image is a mug design reference ONLY; replace every reference person with the customer couple. Match the reference composition, decorative motifs, colors and mood for the design titled "${design.title}". ${style} Return ONLY square flat print artwork, not a mug, handle, product photograph, mockup or split front/back view. Keep both faces completely visible. No lettering, names, dates, calendar numbers, watermarks or logos: text is added separately. Do not reproduce the reference people's identities. Avoid glitter over faces: the physical glitter finish is added separately.`;
  try {
    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method:'POST', signal:AbortSignal.timeout(270_000),
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:'gpt-image-1.5', images:[...body.photos, body.template].map(image_url=>({image_url})),
        prompt,n:1,size:'1024x1024',quality:'medium',input_fidelity:'high',output_format:'jpeg',output_compression:80})
    });
    if (!response.ok) {
      // Provider bodies can contain sensitive request details; never return/log them.
      if (response.status === 429) return reply({error:'OpenAI тимчасово обмежив генерацію або закінчився баланс. Перевірте баланс і спробуйте пізніше.'}, 429);
      if ([401,403].includes(response.status)) return reply({error:'OpenAI не надав доступ. Власнику сайту потрібно перевірити ключ, дозволи та доступ до генерації зображень.'}, 502);
      if (response.status === 400) return reply({error:'OpenAI не зміг обробити це фото. Спробуйте інше.'}, 422);
      return reply({error:'Сервіс генерації тимчасово недоступний. Готові макети збережено на сторінці.'}, 502);
    }
    const data = await response.json();
    const encoded = data.data?.[0]?.b64_json;
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > 4_000_000) return reply({error:'Не вдалося отримати зображення. Спробуйте пізніше.'}, 502);
    return reply({designId:body.designId,image:`data:image/jpeg;base64,${encoded}`});
  } catch (error) {
    return reply({error:error.name === 'TimeoutError' ? 'Генерація триває надто довго. Спробуйте пізніше.' : 'Не вдалося з’єднатися з генератором. Спробуйте пізніше.'}, 504);
  }
}
