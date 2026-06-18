// api/thanks.js — serves embedded thanks page on any method (GET/POST).
// WFP делает POST на approvedUrl/declinedUrl → Vercel static вернёт 405,
// поэтому отдаём через serverless handler. wayforpay.js шлёт клиента
// напрямую на /api/thanks (а не /thanks), чтобы обойти конфликт роутинга
// rewrite+cleanUrls, из-за которого /thanks висел (белый экран после оплаты).

const HTML = `<!DOCTYPE html>
<html lang="uk"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FF4FA1">
<meta name="robots" content="noindex">
<title>Дякуємо · BabyGirl</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2255%25%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%20font-size%3D%2286%22%3E%F0%9F%8E%80%3C/text%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com/">
<link rel="preconnect" href="https://fonts.gstatic.com/" crossorigin="">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&amp;family=Bowlby+One&amp;family=Lilita+One&amp;family=Press+Start+2P&amp;family=VT323&amp;family=DM+Sans:wght@400;500;700;900&amp;family=Caveat:wght@500;700&amp;display=swap">
<style>
:root{
  --pink:#FF4FA1; --pink-deep:#E63B8A; --pink-soft:#FFD7E8; --pink-bg:#FFEAF3;
  --bubblegum:#FFB8D9; --yellow:#FFD93D; --lime:#B6F500; --cream:#FFF5EC;
  --black:#0E0E12;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{
  font-family:'DM Sans',system-ui,-apple-system,sans-serif;
  background:
    radial-gradient(120% 80% at 50% -10%, var(--pink-soft) 0%, var(--pink-bg) 38%, var(--cream) 100%);
  color:var(--black);
  min-height:100dvh;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:28px 16px;
  overflow-x:hidden;
  position:relative;
}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer;border:none}

/* confetti canvas */
#confetti{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}

/* sparkles around */
.sparkle{position:fixed;font-size:28px;pointer-events:none;opacity:.85;animation:tw 2.4s ease-in-out infinite;z-index:0}
.sparkle.s1{top:8%;left:8%;animation-delay:0s;font-size:32px}
.sparkle.s2{top:14%;right:10%;animation-delay:.4s;font-size:24px}
.sparkle.s3{bottom:14%;left:12%;animation-delay:.8s;font-size:28px}
.sparkle.s4{bottom:10%;right:8%;animation-delay:1.2s;font-size:36px}
.sparkle.s5{top:46%;left:4%;animation-delay:1.6s;font-size:22px}
.sparkle.s6{top:38%;right:5%;animation-delay:2.0s;font-size:26px}
@keyframes tw{0%,100%{transform:scale(1) rotate(0deg);opacity:.5}50%{transform:scale(1.3) rotate(20deg);opacity:1}}

/* card */
.card{
  position:relative;z-index:10;
  width:100%;max-width:540px;
  background:#fff;
  border:3px solid var(--black);
  border-radius:26px;
  padding:40px 30px 30px;
  box-shadow:10px 10px 0 var(--pink), 10px 10px 0 4px var(--black);
  text-align:center;
  animation:cardIn .55s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes cardIn{0%{transform:translateY(26px) scale(.96);opacity:0}100%{transform:translateY(0) scale(1);opacity:1}}

/* success badge: bow + check ring */
.badge{position:relative;display:inline-flex;align-items:center;justify-content:center;width:118px;height:118px;margin-bottom:6px}
.ring{
  position:absolute;inset:0;border-radius:50%;
  background:radial-gradient(circle at 50% 35%, #fff 0 52%, var(--pink-soft) 53% 100%);
  border:3px solid var(--black);
  box-shadow:4px 4px 0 var(--black);
  animation:pop .5s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes pop{0%{transform:scale(0)}100%{transform:scale(1)}}
.check{position:absolute;width:60px;height:60px}
.check path{
  fill:none;stroke:var(--pink-deep);stroke-width:7;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:60;stroke-dashoffset:60;
  animation:draw .5s ease-out .35s forwards;
}
@keyframes draw{to{stroke-dashoffset:0}}
.bow{
  position:absolute;top:-26px;right:-16px;
  font-size:46px; line-height:1;
  animation:bounce .8s cubic-bezier(.34,1.56,.64,1) .15s both;
  filter:drop-shadow(2px 2px 0 var(--black));
}
@keyframes bounce{0%{transform:translateY(-30px) scale(.3) rotate(-20deg);opacity:0}60%{transform:translateY(4px) scale(1.1) rotate(8deg);opacity:1}100%{transform:translateY(0) scale(1) rotate(0)}}

h1{
  font-family:'Bagel Fat One',sans-serif;font-weight:400;
  font-size:clamp(42px,9vw,64px);
  line-height:.95;
  color:var(--pink);
  letter-spacing:.02em;
  margin:14px 0 8px;
  text-shadow:3px 3px 0 var(--black);
  text-transform:uppercase;
}
.subline{
  font-family:'Caveat',cursive;font-weight:700;
  font-size:25px;color:var(--pink-deep);
  margin-bottom:4px;
}
.sub{
  font-family:'Bowlby One',sans-serif;
  font-size:13px;letter-spacing:.14em;color:var(--black);
  margin:0 0 22px;
  text-transform:uppercase;
}

.ordbox{
  display:inline-flex;flex-direction:column;align-items:center;
  background:var(--yellow);
  border:2.5px solid var(--black);
  border-radius:12px;
  padding:11px 22px;
  margin:0 0 26px;
  box-shadow:3px 3px 0 var(--black);
}
.ordbox .label{font-family:'Press Start 2P',monospace;font-size:8px;letter-spacing:.18em;color:var(--pink-deep);margin-bottom:7px}
.ordbox .num{font-family:'Press Start 2P',monospace;font-size:14px;letter-spacing:.04em;color:var(--black);word-break:break-all}

.steps{
  display:grid;gap:12px;
  text-align:left;
  margin:6px auto 26px;
  max-width:400px;
}
.step{
  display:flex;align-items:center;gap:13px;
  background:var(--pink-bg);
  border:2px solid var(--black);
  border-radius:14px;
  padding:12px 14px;
  box-shadow:3px 3px 0 var(--pink-soft);
}
.step .ic{
  flex:0 0 auto;width:38px;height:38px;border-radius:10px;
  display:flex;align-items:center;justify-content:center;font-size:20px;
  background:#fff;border:2px solid var(--black);
}
.step .tx{font-family:'DM Sans',sans-serif;font-size:14.5px;font-weight:500;line-height:1.3;color:var(--black)}
.step .tx b{font-weight:900}

.tg-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:11px;
  background:#229ED9;color:#fff;
  border:3px solid var(--black);border-radius:16px;
  padding:17px 26px;
  font-family:'Bowlby One',sans-serif;font-size:16px;letter-spacing:.05em;
  text-transform:uppercase;
  box-shadow:5px 5px 0 var(--black);
  transition:transform .15s ease, box-shadow .15s ease;
  width:100%;max-width:360px;
  margin:4px auto 6px;
}
.tg-btn:hover{transform:translate(-2px,-2px);box-shadow:7px 7px 0 var(--black)}
.tg-btn:active{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--black)}
.tg-btn svg{width:22px;height:22px;flex-shrink:0}

.back{
  display:inline-block;margin-top:14px;
  font-family:'VT323',monospace;font-size:19px;
  color:var(--pink-deep);letter-spacing:.05em;
  border-bottom:2px dashed var(--pink-deep);
  padding-bottom:2px;
}
.back:hover{color:var(--black);border-color:var(--black)}

.tiny{
  font-family:'DM Sans',sans-serif;font-size:12px;color:#666;
  margin-top:18px;line-height:1.55;max-width:420px;margin-left:auto;margin-right:auto;
}

/* declined variant */
.declined h1{color:#d33;text-shadow:3px 3px 0 var(--black)}
.declined .sub{color:#999}
.declined .ring{background:radial-gradient(circle at 50% 35%, #fff 0 52%, #ffdede 53% 100%)}
.declined .check path{stroke:#d33}
.declined .ordbox{background:#fff;color:#888;box-shadow:3px 3px 0 #ccc}
.declined .step{background:#fbeaea;box-shadow:3px 3px 0 #f3d2d2}

@media (max-width:480px){
  .card{padding:30px 18px 24px;border-radius:22px;box-shadow:7px 7px 0 var(--pink),7px 7px 0 3px var(--black)}
  .badge{width:104px;height:104px}
  .check{width:54px;height:54px}
  .bow{font-size:40px;top:-22px;right:-10px}
  .ordbox .num{font-size:12px}
}
@media (prefers-reduced-motion:reduce){
  *{animation:none!important}
  .check path{stroke-dashoffset:0}
}
</style>
<!-- Meta Pixel — BabyGirl 1636827497584775 -->
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','1636827497584775');
fbq('track','PageView');
</script>
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1636827497584775&ev=PageView&noscript=1" alt=""/></noscript>
<!-- End Meta Pixel -->
</head>
<body>
<canvas id="confetti"></canvas>

<span class="sparkle s1">✨</span>
<span class="sparkle s2">💖</span>
<span class="sparkle s3">🌟</span>
<span class="sparkle s4">✨</span>
<span class="sparkle s5">💕</span>
<span class="sparkle s6">⭐</span>

<div class="card" id="card">
  <div class="badge" id="badge">
    <span class="ring"></span>
    <svg class="check" id="check" viewBox="0 0 60 60" aria-hidden="true"><path d="M16 31 L26 41 L45 19"/></svg>
    <span class="bow">🎀</span>
  </div>

  <p class="subline" id="subline">ти найкраща ♥</p>
  <h1 id="title">Дякуємо!</h1>
  <p class="sub" id="sub">Замовлення прийнято</p>

  <div class="ordbox" id="ordbox" style="display:none">
    <span class="label">order ref</span>
    <span class="num" id="ordnum">—</span>
  </div>

  <div class="steps" id="steps">
    <div class="step"><span class="ic">💬</span><span class="tx"><b>Менеджер напише</b> — підтвердимо замовлення та деталі</span></div>
    <div class="step"><span class="ic">💳</span><span class="tx">Оплата підтверджується <b>автоматично</b></span></div>
    <div class="step"><span class="ic">🚚</span><span class="tx">Відправка з Києва — <b>Нова Пошта</b>, 1–3 дні</span></div>
  </div>

  <a id="tgLink" class="tg-btn" href="#" target="_blank" rel="noopener">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.022c.243-.213-.054-.334-.373-.121l-6.871 4.326-2.96-.924c-.643-.204-.657-.643.136-.953l11.566-4.458c.535-.196 1.006.128.832.938z"/></svg>
    <span>Відстежити в Telegram</span>
  </a>

  <p class="tiny" id="tiny">У боті побачиш склад замовлення, статус оплати та зможеш зв'язатись з менеджером.</p>

  <a class="back" href="https://babygirl.com.ua/">← повернутись на сайт</a>
</div>

<script>
(function(){
  var params = new URLSearchParams(location.search);
  var paid = params.get('paid');
  var order = (params.get('order') || '').trim();
  var BOT = 'loveyourhaire_bot';
  var declined = (paid === '0' || paid === 'fail');

  if (order) {
    document.getElementById('ordbox').style.display = 'inline-flex';
    document.getElementById('ordnum').textContent = order;
  }

  if (declined) {
    document.body.classList.add('declined');
    document.getElementById('card').classList.add('declined');
    document.getElementById('subline').textContent = 'спробуй ще раз ♥';
    document.getElementById('title').textContent = 'Не оплачено';
    document.getElementById('sub').textContent = 'Платіж не пройшов';
    var ch = document.getElementById('check');
    if (ch) ch.innerHTML = '<path d="M20 20 L40 40 M40 20 L20 40"/>';
    document.getElementById('steps').innerHTML =
      '<div class="step"><span class="ic">🔁</span><span class="tx">Можливо ти натиснула «Назад» або картка не підтвердила платіж</span></div>'+
      '<div class="step"><span class="ic">🛒</span><span class="tx">Кошик <b>збережено</b> — можеш повторити замовлення</span></div>'+
      '<div class="step"><span class="ic">📦</span><span class="tx">Або обери <b>накладений платіж</b> на пошті</span></div>';
    document.getElementById('tiny').innerHTML = 'Потрібна допомога? Напиши нам — все вирішимо ♥';
    var tg = document.getElementById('tgLink');
    tg.href = 'https://t.me/' + BOT;
    tg.querySelector('span').textContent = 'Написати менеджеру';
  } else {
    var startPayload = order ? ('?start=order_' + encodeURIComponent(order)) : '';
    document.getElementById('tgLink').href = 'https://t.me/' + BOT + startPayload;
    fireConfetti();
  }

  // Meta Pixel Purchase (paid=1, есть order). eventID == order для дедупа
  // с серверным Purchase из api/wayforpay-callback.
  try {
    if (paid === '1' && order && typeof fbq === 'function') {
      var amt = parseFloat(params.get('amount') || '0') || 0;
      var n   = parseInt(params.get('n') || '1', 10) || 1;
      var payload = { currency: 'UAH', eventID: order };
      if (amt > 0) payload.value = amt;
      if (n   > 0) payload.num_items = n;
      fbq('track', 'Purchase', payload);
    }
  } catch(e){}

  // ---- lightweight canvas confetti (no deps) ----
  function fireConfetti(){
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cv = document.getElementById('confetti');
    var ctx = cv.getContext('2d');
    var W, H, parts = [];
    var colors = ['#FF4FA1','#E63B8A','#FFD93D','#B6F500','#FFB8D9','#ffffff'];
    function resize(){ W = cv.width = window.innerWidth; H = cv.height = window.innerHeight; }
    resize(); window.addEventListener('resize', resize);
    var N = Math.min(160, Math.floor(W/8));
    for (var i=0;i<N;i++){
      parts.push({
        x: Math.random()*W,
        y: -20 - Math.random()*H*0.5,
        r: 5 + Math.random()*7,
        c: colors[(Math.random()*colors.length)|0],
        vx: -1.4 + Math.random()*2.8,
        vy: 2.2 + Math.random()*3.2,
        rot: Math.random()*Math.PI,
        vr: -0.18 + Math.random()*0.36,
        shape: Math.random() < 0.5 ? 0 : 1
      });
    }
    var start = Date.now();
    (function frame(){
      var t = Date.now() - start;
      ctx.clearRect(0,0,W,H);
      for (var i=0;i<parts.length;i++){
        var p = parts[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        if (p.shape === 0){ ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r*0.6); }
        else { ctx.beginPath(); ctx.arc(0,0,p.r/2,0,Math.PI*2); ctx.fill(); }
        ctx.restore();
      }
      if (t < 4500) requestAnimationFrame(frame);
      else ctx.clearRect(0,0,W,H);
    })();
  }
})();
</script>
</body></html>
`;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Method Not Allowed');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
  return res.status(200).send(HTML);
};
