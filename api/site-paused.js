module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(404).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>404: NOT_FOUND</title>
  <style>
    *{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif}.error{display:flex;align-items:center;gap:22px;padding:24px}.code{font-size:24px;font-weight:500;line-height:1;border-right:1px solid #ddd;padding:5px 22px 5px 0}.message{font-size:14px;line-height:1.6}.message b{display:block;font-weight:500}.message span{color:#666}@media(max-width:480px){.error{gap:16px}.code{padding-right:16px}}
  </style>
</head>
<body>
  <main class="error" aria-label="Page not found">
    <div class="code">404</div>
    <div class="message"><b>This page could not be found.</b><span>NOT_FOUND</span></div>
  </main>
</body>
</html>`);
};
