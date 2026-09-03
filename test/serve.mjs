import http from 'http'; import fs from 'fs'; import path from 'path';
const root = process.argv[2]; const port = Number(process.argv[3] || 4300);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
http.createServer((req,res)=>{
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, {'Content-Type': types[path.extname(f)] || 'application/octet-stream'});
  res.end(fs.readFileSync(f));
}).listen(port, () => console.log('up on ' + port));
