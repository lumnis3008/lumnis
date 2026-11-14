import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { handleApi } from './api.mjs';
import { openDatabase } from './sqlite.mjs';
import { validateConfig } from './config.mjs';
const root=resolve(new URL('..',import.meta.url).pathname),dataDir=resolve(process.env.LUMNIS_DATA_DIR||root+'/.local');
await mkdir(dataDir,{recursive:true,mode:0o700});
const db=openDatabase(dataDir+'/lumnis.sqlite');
const config=validateConfig(JSON.parse(await readFile(root+'/booking-config.json','utf8')));
let adminPassword=process.env.LUMNIS_ADMIN_PASSWORD;
if(!adminPassword){
  const passwordFile=dataDir+'/admin-password';
  try{adminPassword=(await readFile(passwordFile,'utf8')).trim();}catch(error){if(error.code!=='ENOENT')throw error;adminPassword=randomBytes(24).toString('base64url');await writeFile(passwordFile,adminPassword+'\n',{mode:0o600,flag:'wx'});}
  console.log('A senha do painel está no arquivo local privado: '+passwordFile);
}
const assets={'/':'index.html','/index.html':'index.html','/lumnis':'index.html','/agenda':'agenda.html','/agenda.html':'agenda.html','/painel':'painel.html','/painel.html':'painel.html','/styles.css':'styles.css','/app.js':'app.js','/agenda.css':'agenda.css','/agenda.js':'agenda.js','/favicon.svg':'favicon.svg','/api/openapi.json':'openapi.json'};
const mime={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml',json:'application/json; charset=utf-8'};
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4788);
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://formspree.io; form-action 'self' https://formspree.io; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"};
const server=http.createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path.startsWith('/api/')&&path!=='/api/openapi.json'){
      const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8192){res.writeHead(413,security);res.end('Solicitação muito grande.');return;}chunks.push(chunk);}
      const request=new Request(`http://${req.headers.host||'localhost:'+port}${req.url}`,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      const response=await handleApi(request,{db,config,adminPassword,ip:req.socket.remoteAddress||'local'});
      res.writeHead(response.status,{...security,...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,security);res.end();return;}
    const file=assets[path];if(!file){res.writeHead(404,security);res.end('Página não encontrada.');return;}
    res.writeHead(200,{...security,'Content-Type':mime[file.split('.').pop()],'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:await readFile(root+'/'+file));
  }catch(error){console.error('Request failure:',error.name);if(!res.headersSent)res.writeHead(500,security);res.end('Não foi possível abrir esta página.');}
});
server.listen(port,host,()=>console.log(`Lumnis: http://${host}:${port}\nReservas: http://${host}:${port}/agenda\nPainel: http://${host}:${port}/painel`));
server.on('error',error=>{console.error(`Não foi possível iniciar o servidor: ${error.code}`);db.close();process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
