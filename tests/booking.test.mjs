import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleApi,zonedInstant,dateInZone} from '../server/api.mjs';
import {openDatabase} from '../server/sqlite.mjs';
const config=JSON.parse(readFileSync(new URL('../booking-config.json',import.meta.url)));
const NOW=Date.parse('2026-11-16T10:00:00Z'),origin='http://localhost:4788',secret='test-admin-password-only',token='a'.repeat(64);
function harness(db=openDatabase()){
 const request=async(path,{method='GET',body,headers={},now=NOW,ip='test'}={})=>{
  const req=new Request(origin+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  const response=await handleApi(req,{db,config,adminPassword:secret,now,ip});return {response,status:response.status,body:await response.json()};
 };
 const reserve=(overrides={},options={})=>request('/api/bookings',{method:'POST',body:{serviceId:'conversa',resourceId:'equipe-1',startsAt:'2026-11-16T12:00:00.000Z',name:'Cliente de Teste',email:'teste@example.com',consent:true,...overrides},headers:{Authorization:'Bearer '+token,'Idempotency-Key':crypto.randomUUID(),...options.headers},...Object.fromEntries(Object.entries(options).filter(([k])=>k!=='headers'))});
 return {db,request,reserve};
}
const management=(id)=>'/api/bookings/'+id;

test('catálogo e disponibilidade não expõem dados de clientes',async t=>{
 const h=harness();t.after(()=>h.db.close());
 const catalog=await h.request('/api/catalog');assert.equal(catalog.status,200);assert.equal(catalog.body.mode,'demo');
 const reserved=await h.reserve();assert.equal(reserved.status,201);
 const availability=await h.request('/api/availability?serviceId=conversa&resourceId=equipe-1&date=2026-11-16');assert.equal(availability.status,200);
 assert(!JSON.stringify(availability.body).includes('teste@example.com'));
 assert(!availability.body.slots.some(s=>s.startsAt==='2026-11-16T12:00:00.000Z'));
 assert(!availability.body.slots.some(s=>s.startsAt==='2026-11-16T12:15:00.000Z'));
 assert(availability.body.slots.some(s=>s.startsAt==='2026-11-16T12:30:00.000Z'));
});
test('transação impede reservas sobrepostas inclusive por serviços diferentes',async t=>{
 const h=harness();t.after(()=>h.db.close());
 const [a,b]=await Promise.all([h.reserve(),h.reserve({serviceId:'demonstracao',startsAt:'2026-11-16T12:15:00.000Z'})]);
 assert.deepEqual([a.status,b.status].sort(),[201,409]);
 assert.equal((await h.db.first('SELECT count(*) AS n FROM bookings')).n,1);
 const other=await h.reserve({resourceId:'equipe-2'});assert.equal(other.status,201);
});
test('reenvio idempotente não duplica reserva e não permite mudar os dados',async t=>{
 const h=harness();t.after(()=>h.db.close());const headers={'Idempotency-Key':crypto.randomUUID()};
 const a=await h.reserve({}, {headers}),b=await h.reserve({}, {headers});assert.equal(a.status,201);assert.equal(b.status,200);assert.equal(a.body.booking.id,b.body.booking.id);assert.equal(b.body.replayed,true);
 const late=await h.reserve({}, {headers,now:NOW+3*3600000});assert.equal(late.status,200);assert.equal(late.body.booking.id,a.body.booking.id);
 const changed=await h.reserve({name:'Outra Pessoa'},{headers});assert.equal(changed.status,409);assert.equal(changed.body.error.code,'idempotency_conflict');
});
test('valida entrada, agenda do serviço, datas, intervalo de almoço e antecedência',async t=>{
 const h=harness();t.after(()=>h.db.close());
 for(const body of [{email:'inválido'},{name:' '},{consent:false},{resourceId:'nao-existe'},{startsAt:'2026-11-16T15:00:00.000Z'},{startsAt:'2026-11-15T12:00:00.000Z'},{startsAt:'2026-11-16T10:30:00.000Z'},{startsAt:'2026-11-16T12:01:00.000Z'}])assert.equal((await h.reserve(body)).status,400);
 const invalid=await h.request('/api/availability?serviceId=conversa&resourceId=equipe-1&date=2026-02-30');assert.equal(invalid.status,400);
 const weekend=await h.request('/api/availability?serviceId=conversa&resourceId=equipe-1&date=2026-11-21');assert.deepEqual(weekend.body.slots,[]);
});
test('link privado é obrigatório e só acessa a própria reserva',async t=>{
 const h=harness();t.after(()=>h.db.close());const a=await h.reserve(),path=management(a.body.booking.id);
 assert.equal((await h.request(path)).status,401);
 assert.equal((await h.request(path,{headers:{Authorization:'Bearer '+'b'.repeat(64)}})).status,404);
 const owned=await h.request(path,{headers:{Authorization:'Bearer '+token}});assert.equal(owned.status,200);assert.equal(owned.body.booking.customerEmail,'teste@example.com');
 assert(!JSON.stringify(owned.body).includes('token_hash'));assert(!JSON.stringify(owned.body).includes('request_key'));
});
test('cancelar libera o horário e impede reagendamento de reserva encerrada',async t=>{
 const h=harness();t.after(()=>h.db.close());const a=await h.reserve(),path=management(a.body.booking.id),headers={Authorization:'Bearer '+token};
 const cancelled=await h.request(path,{method:'PATCH',body:{action:'cancel'},headers});assert.equal(cancelled.body.booking.status,'cancelled');
 assert.equal((await h.request(path,{method:'PATCH',body:{action:'cancel'},headers})).status,200);
 assert.equal((await h.request(path,{method:'PATCH',body:{action:'reschedule',startsAt:'2026-11-16T13:00:00.000Z'},headers})).status,409);
 assert.equal((await h.reserve()).status,201);
});
test('reagendamento mantém dados e link, e falha sem perder o horário original se houver conflito',async t=>{
 const h=harness();t.after(()=>h.db.close());const a=await h.reserve();await h.reserve({startsAt:'2026-11-16T13:00:00.000Z'});
 const path=management(a.body.booking.id),headers={Authorization:'Bearer '+token};
 assert.equal((await h.request(path,{method:'PATCH',body:{action:'reschedule',startsAt:'2026-11-16T13:00:00.000Z'},headers})).status,409);
 assert.equal((await h.request(path,{headers})).body.booking.startsAt,'2026-11-16T12:00:00.000Z');
 const moved=await h.request(path,{method:'PATCH',body:{action:'reschedule',startsAt:'2026-11-16T14:00:00.000Z'},headers});assert.equal(moved.status,200);assert.equal(moved.body.booking.id,a.body.booking.id);assert.equal(moved.body.booking.customerEmail,'teste@example.com');
});
test('painel exige autenticação, origem válida, cookie HttpOnly e sessão com expiração',async t=>{
 const h=harness();t.after(()=>h.db.close());
 assert.equal((await h.request('/api/admin/bookings?date=2026-11-16')).status,401);
 assert.equal((await h.request('/api/admin/login',{method:'POST',body:{password:secret}})).status,403);
 assert.equal((await h.request('/api/admin/login',{method:'POST',headers:{Origin:origin},body:{password:'errada'}})).status,401);
 const login=await h.request('/api/admin/login',{method:'POST',headers:{Origin:origin},body:{password:secret}});assert.equal(login.status,200);
 const setCookie=login.response.headers.get('Set-Cookie');assert(setCookie.includes('HttpOnly'));assert(setCookie.includes('SameSite=Strict'));const cookie=setCookie.split(';')[0];
 await h.reserve();const list=await h.request('/api/admin/bookings?date=2026-11-16',{headers:{Cookie:cookie}});assert.equal(list.status,200);assert.equal(list.body.bookings.length,1);
 assert.equal((await h.request('/api/admin/logout',{method:'POST',body:{},headers:{Cookie:cookie,Origin:'https://outro.example'}})).status,403);
 assert.equal((await h.request('/api/admin/session',{headers:{Cookie:cookie},now:NOW+9*3600000})).status,401);
 assert.equal((await h.request('/api/admin/logout',{method:'POST',body:{},headers:{Cookie:cookie,Origin:origin}})).status,200);
 assert.equal((await h.request('/api/admin/session',{headers:{Cookie:cookie}})).status,401);
});
test('painel não conclui atendimento futuro e pode encerrar atendimento iniciado',async t=>{
 const h=harness();t.after(()=>h.db.close());const a=await h.reserve();const login=await h.request('/api/admin/login',{method:'POST',body:{password:secret},headers:{Origin:origin}}),headers={Origin:origin,Cookie:login.response.headers.get('Set-Cookie').split(';')[0]};
 const path='/api/admin/bookings/'+a.body.booking.id;
 assert.equal((await h.request(path,{method:'PATCH',headers,body:{status:'completed'}})).status,409);
 assert.equal((await h.request(path,{method:'PATCH',headers,body:{status:'completed'},now:NOW+3*3600000})).body.booking.status,'completed');
 assert.equal((await h.request(management(a.body.booking.id),{method:'PATCH',headers:{Authorization:'Bearer '+token},body:{action:'cancel'}})).status,409);
});
test('limita tentativas de senha e rejeita origem externa',async t=>{
 const h=harness();t.after(()=>h.db.close());
 for(let n=0;n<8;n++)assert.equal((await h.request('/api/admin/login',{method:'POST',headers:{Origin:origin},body:{password:'x'}})).status,401);
 const limited=await h.request('/api/admin/login',{method:'POST',headers:{Origin:origin},body:{password:'x'}});assert.equal(limited.status,429);assert(limited.response.headers.has('Retry-After'));
 assert.equal((await h.reserve({}, {headers:{Origin:'https://malicioso.example'}})).status,403);
});
test('dados persistem depois de reabrir o banco e conflito funciona entre conexões',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'lumnis-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const file=join(directory,'booking.sqlite');
 let db=openDatabase(file),h=harness(db);const a=await h.reserve();db.close();db=openDatabase(file);const other=openDatabase(file);t.after(()=>{db.close();other.close();});
 h=harness(db);const persisted=await h.request(management(a.body.booking.id),{headers:{Authorization:'Bearer '+token}});assert.equal(persisted.status,200);
 assert.equal((await harness(other).reserve()).status,409);
});
test('fuso horário e conversão de data mantêm a agenda no horário de Brasília',()=>{
 assert.equal(zonedInstant('2026-11-16','09:00',config.timezone),Date.parse('2026-11-16T12:00:00Z'));
 assert.equal(dateInZone('2026-11-17T01:30:00Z',config.timezone),'2026-11-16');
});

test('limite de corpo, JSON inválido e tipos de conteúdo incorretos são rejeitados',async t=>{
 const h=harness();t.after(()=>h.db.close());
 const call=async(body,contentType='application/json')=>handleApi(new Request(origin+'/api/bookings',{method:'POST',headers:{'Content-Type':contentType},body}),{db:h.db,config,now:NOW});
 assert.equal((await call('x'.repeat(9000))).status,413);
 assert.equal((await call('{')).status,400);
 assert.equal((await call('[]')).status,400);
 assert.equal((await call('{}','text/plain')).status,415);
});
