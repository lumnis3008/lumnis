import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {openDatabase} from '../server/sqlite.mjs';
import {validateConfig} from '../server/config.mjs';
import {dateInZone} from '../server/api.mjs';
const config=JSON.parse(readFileSync(new URL('../booking-config.json',import.meta.url)));
function d1Adapter(db){return {prepare(sql){return {bind(...args){return {first:()=>db.first(sql,...args),all:async()=>({results:await db.all(sql,...args)}),run:async()=>({meta:await db.run(sql,...args)})};}};}};}
test('artefato Worker entrega as três páginas e os recursos com tipos corretos',async()=>{
 for(const [path,type,content] of [['/','text/html','Uma agenda que'],['/agenda','text/html','booking-form'],['/painel','text/html','login-form'],['/agenda.js','text/javascript','sendReservation'],['/agenda.css','text/css','.booking-layout'],['/api/openapi.json','application/json','Lumnis Agenda API']]){
  const response=await worker.fetch(new Request('https://lumnis.example'+path),{});assert.equal(response.status,200);assert(response.headers.get('Content-Type').startsWith(type));assert((await response.text()).includes(content));assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert(response.headers.get('Content-Security-Policy').includes("script-src 'self'"));
 }
 assert.equal((await worker.fetch(new Request('https://lumnis.example/.env'),{})).status,404);
 assert.equal((await worker.fetch(new Request('https://lumnis.example/.local/admin-password'),{})).status,404);
 assert.equal((await worker.fetch(new Request('https://lumnis.example/api/catalog'),{})).status,503);
});
test('API compilada funciona com contrato D1 e bloqueia sobreposição',async t=>{
 const db=openDatabase();t.after(()=>db.close());const env={DB:d1Adapter(db),LUMNIS_ADMIN_PASSWORD:'test-only'};
 const request=(path,options={})=>worker.fetch(new Request('https://lumnis.example'+path,options),env);
 assert.equal((await request('/api/health')).status,200);
 let date=dateInZone(Date.now()+86400000,config.timezone);while(!config.weekdays.includes(new Date(date+'T12:00:00Z').getUTCDay()))date=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const slots=await (await request('/api/availability?'+new URLSearchParams({date,serviceId:'conversa',resourceId:'equipe-1'}))).json();assert(slots.slots.length>0);
 const key=crypto.randomUUID(),headers={'Content-Type':'application/json','Idempotency-Key':key,Authorization:'Bearer '+'c'.repeat(64),Origin:'https://lumnis.example'};
 const body=JSON.stringify({name:'Teste Worker',email:'worker@example.com',consent:true,serviceId:'conversa',resourceId:'equipe-1',startsAt:slots.slots[0].startsAt});
 const booked=await request('/api/bookings',{method:'POST',headers,body});assert.equal(booked.status,201);
 assert.equal((await request('/api/bookings',{method:'POST',headers,body})).status,200);
 assert.equal((await request('/api/bookings',{method:'POST',headers:{...headers,'Idempotency-Key':crypto.randomUUID()},body})).status,409);
 const login=await request('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://lumnis.example'},body:JSON.stringify({password:'test-only'})});assert.equal(login.status,200);assert(login.headers.get('Set-Cookie').includes('Secure'));
});
test('configuração rejeita intervalos sobrepostos, agendas desconhecidas e passo zero',()=>{
 assert.equal(validateConfig(config).mode,'demo');
 for(const change of [{slotMinutes:0},{hours:[['09:00','12:00'],['11:00','13:00']]},{hours:[['18:00','09:00']]},{services:[{id:'servico',name:'Teste',duration:30,resourceIds:['desconhecida']}]}])assert.throws(()=>validateConfig({...config,...change}));
});
