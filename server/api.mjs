const encoder = new TextEncoder();
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export const fail=(status,code,message)=>{throw new ApiError(status,code,message);};
export async function hash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
}
function token(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');}
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});}
function safeConfig(config){return {name:config.name,mode:config.mode,timezone:config.timezone,leadMinutes:config.leadMinutes,horizonDays:config.horizonDays,services:config.services,resources:config.resources};}
export function dateInZone(timestamp, timezone){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp));
  const get=k=>p.find(v=>v.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;
}
export function zonedInstant(date,time,timezone){
  const desired=Date.parse(`${date}T${time}:00Z`);let instant=desired;
  for(let i=0;i<3;i++){
    const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
    const n=k=>Number(p.find(v=>v.type===k).value);
    const wall=Date.UTC(n('year'),n('month')-1,n('day'),n('hour'),n('minute'),n('second'));
    instant+=desired-wall;
  }
  return instant;
}
function validDate(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;}
function serviceFor(config,serviceId,resourceId){
  const service=config.services.find(s=>s.id===serviceId);
  if(!service||!service.resourceIds.includes(resourceId)||!config.resources.some(r=>r.id===resourceId))fail(400,'invalid_selection','Escolha um serviço e uma agenda compatíveis.');return service;
}
function dateRange(config,date,now){
  if(!validDate(date))fail(400,'invalid_date','Informe uma data válida.');
  const today=dateInZone(now,config.timezone),last=dateInZone(now+config.horizonDays*86400000,config.timezone);
  if(date<today||date>last)fail(400,'date_out_of_range',`Escolha uma data entre hoje e os próximos ${config.horizonDays} dias.`);
}
export function candidates(config,date,service,now){
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();
  if(!config.weekdays.includes(weekday))return [];
  const result=[];
  for(const [opening,closing] of config.hours){
    const end=zonedInstant(date,closing,config.timezone);
    for(let start=zonedInstant(date,opening,config.timezone);start+service.duration*60000<=end;start+=config.slotMinutes*60000){
      if(start>=now+config.leadMinutes*60000)result.push({startsAt:new Date(start).toISOString(),endsAt:new Date(start+service.duration*60000).toISOString()});
    }
  }return result;
}
function bearer(request){return /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization')||'')?.[1]||'';}
function publicBooking(row,config){
  return {id:row.id,serviceId:row.service_id,resourceId:row.resource_id,service:config.services.find(s=>s.id===row.service_id)?.name||row.service_id,resource:config.resources.find(r=>r.id===row.resource_id)?.name||row.resource_id,startsAt:row.starts_at,endsAt:row.ends_at,status:row.status,customerName:row.customer_name,customerEmail:row.customer_email,createdAt:row.created_at,timezone:config.timezone,mode:config.mode};
}
async function body(request){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'json_required','Envie os dados em JSON.');
  const reader=request.body?.getReader();if(!reader)fail(400,'invalid_json','Informe os dados da solicitação.');
  let length=0,parts=[];
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();fail(413,'body_too_large','A solicitação excede o tamanho permitido.');}parts.push(value);}
  try{const all=new Uint8Array(length);let offset=0;for(const p of parts){all.set(p,offset);offset+=p.length;}const data=JSON.parse(new TextDecoder().decode(all));if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}
  catch{fail(400,'invalid_json','Não foi possível ler os dados enviados.');}
}
function cleanName(value){if(typeof value!=='string')fail(400,'invalid_name','Informe seu nome.');const name=value.normalize('NFC').trim().replace(/\s+/g,' ');if(name.length<2||name.length>100||/[\x00-\x1f\x7f]/.test(name))fail(400,'invalid_name','Informe um nome de 2 a 100 caracteres.');return name;}
function cleanEmail(value){if(typeof value!=='string')fail(400,'invalid_email','Informe um e-mail válido.');const email=value.trim().toLowerCase();if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'invalid_email','Informe um e-mail válido.');return email;}
async function limit(db,key,now,max,windowMs=600000){
  await db.run('DELETE FROM rate_limits WHERE expires_at < ?',now);
  const bucket=Math.floor(now/windowMs),id=await hash(key+':'+bucket);
  const row=await db.first('INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count',id,(bucket+1)*windowMs);
  if(row.count>max)fail(429,'rate_limited','Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}
async function admin(request,db,now){
  const cookie=request.headers.get('Cookie')||'';
  const value=/(?:^|;\s*)lumnis_session=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1];
  if(!value)fail(401,'unauthorized','Entre no painel para continuar.');
  const found=await db.first('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?',await hash(value),now);
  if(!found)fail(401,'unauthorized','Sua sessão expirou. Entre novamente.');
}
async function owned(request,db,id){
  const key=bearer(request);if(!key)fail(401,'unauthorized','Use o link privado recebido ao reservar.');
  const row=await db.first('SELECT * FROM bookings WHERE id=? AND token_hash=?',id,await hash(key));
  if(!row)fail(404,'not_found','Reserva não encontrada ou link inválido.');return row;
}
function cookieHeader(value,request,seconds){return `lumnis_session=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export async function handleApi(request,{db,config,adminPassword='',now=Date.now(),ip='local'}){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  try{
    if(!['GET','POST','PATCH','DELETE'].includes(method))fail(405,'method_not_allowed','Método não permitido.');
    if(!['GET'].includes(method)){
      const origin=request.headers.get('Origin');
      if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'origin_denied','Origem não autorizada.');
    }
    if(path==='/api/health'&&method==='GET')return json({status:'ok',database:!!(await db.first('SELECT 1 AS ok')),mode:config.mode});
    if(path==='/api/catalog'&&method==='GET')return json(safeConfig(config));
    if(path==='/api/availability'&&method==='GET'){
      const serviceId=url.searchParams.get('serviceId'),resourceId=url.searchParams.get('resourceId'),date=url.searchParams.get('date');
      const service=serviceFor(config,serviceId,resourceId);dateRange(config,date,now);
      const dayStart=new Date(zonedInstant(date,'00:00',config.timezone)).toISOString(),dayEnd=new Date(zonedInstant(date,'23:59',config.timezone)+60000).toISOString();
      const busy=await db.all("SELECT starts_at,ends_at FROM bookings WHERE resource_id=? AND status!='cancelled' AND starts_at<? AND ends_at>?",resourceId,dayEnd,dayStart);
      return json({date,timezone:config.timezone,slots:candidates(config,date,service,now).filter(slot=>!busy.some(b=>b.starts_at<slot.endsAt&&b.ends_at>slot.startsAt))});
    }
    if(path==='/api/bookings'&&method==='POST'){
      const data=await body(request),name=cleanName(data.name),email=cleanEmail(data.email),service=serviceFor(config,data.serviceId,data.resourceId);
      if(data.consent!==true)fail(400,'consent_required','Confirme o uso dos dados para gerenciar a reserva.');
      const requestKey=request.headers.get('Idempotency-Key')||'';
      if(!/^[a-f0-9-]{20,80}$/i.test(requestKey))fail(400,'idempotency_required','Reenvie a reserva com uma chave de solicitação válida.');
      const manageToken=bearer(request);if(!manageToken)fail(400,'management_key_required','Reabra a página para gerar uma chave privada de reserva.');
      if(typeof data.startsAt!=='string'||!Number.isFinite(Date.parse(data.startsAt)))fail(400,'invalid_slot','Escolha um horário válido.');
      const start=new Date(data.startsAt).toISOString(),date=dateInZone(start,config.timezone);
      const requestHash=await hash(JSON.stringify([data.serviceId,data.resourceId,start,name,email,await hash(manageToken)]));
      const previous=await db.first('SELECT * FROM bookings WHERE request_key=?',requestKey);
      if(previous){if(previous.request_hash!==requestHash)fail(409,'idempotency_conflict','A solicitação já foi usada para outra reserva.');return json({booking:publicBooking(previous,config),replayed:true});}
      dateRange(config,date,now);
      const slot=candidates(config,date,service,now).find(s=>s.startsAt===start);if(!slot)fail(400,'invalid_slot','Esse horário não está disponível para o serviço.');
      await limit(db,'book:'+ip,now,12);
      const id=crypto.randomUUID(),timestamp=new Date(now).toISOString();
      try{await db.run('INSERT INTO bookings (id,service_id,resource_id,starts_at,ends_at,customer_name,customer_email,token_hash,request_key,request_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',id,data.serviceId,data.resourceId,slot.startsAt,slot.endsAt,name,email,await hash(manageToken),requestKey,requestHash,timestamp,timestamp);}
      catch(error){
        const existing=await db.first('SELECT * FROM bookings WHERE request_key=?',requestKey);
        if(existing&&existing.request_hash===requestHash)return json({booking:publicBooking(existing,config),replayed:true});
        if(String(error.message).includes('slot_conflict'))fail(409,'slot_conflict','Esse horário acabou de ser reservado. Escolha outro.');throw error;
      }
      return json({booking:publicBooking(await db.first('SELECT * FROM bookings WHERE id=?',id),config)},201);
    }
    const bookingMatch=/^\/api\/bookings\/([a-f0-9-]{36})$/.exec(path);
    if(bookingMatch){
      const row=await owned(request,db,bookingMatch[1]);
      if(method==='GET')return json({booking:publicBooking(row,config)});
      if(method==='PATCH'){
        const data=await body(request);await limit(db,'manage:'+row.id,now,20);
        if(data.action==='cancel'){
          if(row.status==='completed')fail(409,'booking_completed','Um atendimento concluído não pode ser cancelado.');
          await db.run("UPDATE bookings SET status='cancelled',updated_at=? WHERE id=? AND status='confirmed'",new Date(now).toISOString(),row.id);
        }else if(data.action==='reschedule'){
          if(row.status!=='confirmed')fail(409,'booking_inactive','Somente reservas confirmadas podem ser reagendadas.');
          const service=serviceFor(config,row.service_id,row.resource_id);
          if(typeof data.startsAt!=='string'||!Number.isFinite(Date.parse(data.startsAt)))fail(400,'invalid_slot','Escolha um horário válido.');
          const start=new Date(data.startsAt).toISOString(),date=dateInZone(start,config.timezone);dateRange(config,date,now);
          const slot=candidates(config,date,service,now).find(s=>s.startsAt===start);if(!slot)fail(400,'invalid_slot','Escolha um horário dentro da disponibilidade.');
          try{const result=await db.run("UPDATE bookings SET starts_at=?,ends_at=?,updated_at=? WHERE id=? AND status='confirmed'",slot.startsAt,slot.endsAt,new Date(now).toISOString(),row.id);if(!result.changes)fail(409,'booking_inactive','Essa reserva foi alterada. Recarregue a página.');}
          catch(error){if(String(error.message).includes('slot_conflict'))fail(409,'slot_conflict','Esse horário acabou de ser reservado. Escolha outro.');throw error;}
        }else fail(400,'invalid_action','Escolha cancelar ou reagendar.');
        return json({booking:publicBooking(await db.first('SELECT * FROM bookings WHERE id=?',row.id),config)});
      }
    }
    if(path==='/api/admin/login'&&method==='POST'){
      if(request.headers.get('Origin')!==url.origin)fail(403,'origin_denied','Entre pelo formulário do painel.');
      await limit(db,'login:'+ip,now,8);const data=await body(request);
      if(!adminPassword)fail(503,'admin_unconfigured','O acesso administrativo ainda não foi configurado.');
      const expected=await hash(adminPassword),provided=await hash(typeof data.password==='string'?data.password:'');let mismatch=0;for(let i=0;i<expected.length;i++)mismatch|=expected.charCodeAt(i)^provided.charCodeAt(i);
      if(mismatch||typeof data.password!=='string')fail(401,'invalid_credentials','Senha incorreta.');
      const key=token();await db.run('DELETE FROM admin_sessions WHERE expires_at<?',now);await db.run('INSERT INTO admin_sessions (token_hash,expires_at) VALUES (?,?)',await hash(key),now+8*3600000);
      return json({authenticated:true},200,{'Set-Cookie':cookieHeader(key,request,28800)});
    }
    if(path.startsWith('/api/admin/')){
      await admin(request,db,now);
      if(method!=='GET'&&request.headers.get('Origin')!==url.origin)fail(403,'origin_denied','Atualize o painel para continuar.');
      if(path==='/api/admin/session'&&method==='GET')return json({authenticated:true});
      if(path==='/api/admin/logout'&&method==='POST'){
        const value=/(?:^|;\s*)lumnis_session=([a-f0-9]{64})/.exec(request.headers.get('Cookie')||'')?.[1];
        if(value)await db.run('DELETE FROM admin_sessions WHERE token_hash=?',await hash(value));return json({authenticated:false},200,{'Set-Cookie':cookieHeader('',request,0)});
      }
      if(path==='/api/admin/bookings'&&method==='GET'){
        const date=url.searchParams.get('date');if(!validDate(date))fail(400,'invalid_date','Selecione um dia.');
        const start=new Date(zonedInstant(date,'00:00',config.timezone)).toISOString(),end=new Date(zonedInstant(date,'23:59',config.timezone)+60000).toISOString();
        const rows=await db.all('SELECT * FROM bookings WHERE starts_at>=? AND starts_at<? ORDER BY starts_at,id',start,end);
        return json({date,bookings:rows.map(r=>publicBooking(r,config))});
      }
      const match=/^\/api\/admin\/bookings\/([a-f0-9-]{36})$/.exec(path);
      if(match&&method==='PATCH'){
        const data=await body(request);if(!['cancelled','completed'].includes(data.status))fail(400,'invalid_status','Escolha concluir ou cancelar.');
        const row=await db.first('SELECT * FROM bookings WHERE id=?',match[1]);if(!row)fail(404,'not_found','Reserva não encontrada.');
        if(row.status!=='confirmed')fail(409,'booking_inactive','Essa reserva já foi encerrada.');
        if(data.status==='completed'&&Date.parse(row.starts_at)>now)fail(409,'booking_future','O atendimento ainda não começou.');
        const result=await db.run("UPDATE bookings SET status=?,updated_at=? WHERE id=? AND status='confirmed'",data.status,new Date(now).toISOString(),row.id);
        if(!result.changes)fail(409,'booking_inactive','A reserva foi alterada por outra pessoa.');
        return json({booking:publicBooking(await db.first('SELECT * FROM bookings WHERE id=?',row.id),config)});
      }
    }
    fail(404,'not_found','Recurso não encontrado.');
  }catch(error){
    if(error instanceof ApiError)return json({error:{code:error.code,message:error.message}},error.status,error.status===429?{'Retry-After':'600'}:{});
    console.error('API failure:',error.name);return json({error:{code:'internal_error',message:'Não foi possível concluir agora. Tente novamente.'}},500);
  }
}
