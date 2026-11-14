const $=selector=>document.querySelector(selector);
const page=document.body.dataset.page;
const statusNames={confirmed:'Confirmada',cancelled:'Cancelada',completed:'Concluída'};
let catalog;
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function message(text,type='info'){const box=$('#app-message');box.replaceChildren(element('span',text));box.dataset.type=type;box.hidden=false;return box;}
function clearMessage(){$('#app-message').hidden=true;}
function time(value){return new Intl.DateTimeFormat('pt-BR',{timeZone:catalog.timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
function longDate(value){return new Intl.DateTimeFormat('pt-BR',{timeZone:catalog.timezone,weekday:'long',day:'2-digit',month:'long'}).format(new Date(value));}
function dayValue(value=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:catalog.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);const get=k=>parts.find(p=>p.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;}
function shiftDay(day,delta){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+delta);return date.toISOString().slice(0,10);}
function setDateBounds(input){input.min=dayValue();input.max=shiftDay(input.min,catalog.horizonDays);input.value=input.min;}
function randomToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function api(path,options={}){
  if(location.protocol==='file:')throw new Error('Para usar o agendamento, execute npm start na pasta do projeto e abra http://localhost:4788/agenda. A API precisa estar em execução.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal:controller.signal});
    let data;try{data=await response.json();}catch{throw new Error('A resposta do sistema não pôde ser lida. Tente novamente.');}
    if(!response.ok){const error=new Error(data.error?.message||'Não foi possível concluir a solicitação.');error.status=response.status;error.code=data.error?.code;throw error;}return data;
  }catch(error){if(error.name==='AbortError')throw new Error('A confirmação não chegou a tempo. Verifique sua conexão e tente novamente.');if(error instanceof TypeError)throw new Error('Não foi possível conectar à agenda. Verifique sua conexão e tente novamente.');throw error;}
  finally{clearTimeout(timer);}
}
function setBusy(button,busy,label){button.disabled=busy;button.setAttribute('aria-busy',String(busy));if(label)button.textContent=label;}
function badge(status){const node=element('span',statusNames[status]||status,'booking-status');node.dataset.status=status;return node;}
function renderSlots(container,slots,onSelect){
  container.replaceChildren();
  if(!slots.length){container.append(element('p','Não há horários disponíveis nesta data. Experimente outro dia.'));return;}
  for(const slot of slots){const button=element('button',time(slot.startsAt),'slot-button');button.type='button';button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{container.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));onSelect(slot);});container.append(button);}
}
function summaryLine(label,value,detail){const node=element('div',undefined,'detail-item');node.append(element('span',label),element('strong',value));if(detail)node.append(element('small',detail));return node;}
async function loadCatalog(){
  catalog=await api('/api/catalog');
  $('#environment').textContent=catalog.mode==='demo'?'Ambiente de teste':'Agendamento online';
  if($('#mode-description')&&catalog.mode==='demo')$('#mode-description').textContent='Experimente o sistema de agendamento da Lumnis. Serviços e agendas são exemplos: use dados fictícios. Nenhum atendimento real será realizado.';
  $('#timezone-note').textContent='Fuso dos horários: '+catalog.timezone.replaceAll('_',' ')+'.';
}
let selectedService,selectedResource,selectedSlot,booking,manageToken,availabilitySequence=0,rescheduleSequence=0;
function setSummary(){
  const summary=$('#selection-summary');summary.replaceChildren(element('span','Seu atendimento'));
  if(!selectedService){summary.append(element('strong','Escolha um serviço e um horário.'));return;}
  summary.append(element('strong',selectedService.name));
  if(selectedResource)summary.append(element('p',selectedResource.name+' · '+selectedService.duration+' minutos'));
  summary.append(element('p',selectedSlot?longDate(selectedSlot.startsAt)+' às '+time(selectedSlot.startsAt):'Escolha um horário disponível.'));
  $('#reserve-button').disabled=!selectedSlot;
}
async function loadAvailability(){
  const seq=++availabilitySequence;selectedSlot=null;setSummary();const container=$('#slots');container.replaceChildren(element('p','Consultando disponibilidade…'));$('#slots-label').textContent='Buscando horários para a data selecionada.';
  try{
    const data=await api('/api/availability?'+new URLSearchParams({serviceId:selectedService.id,resourceId:selectedResource.id,date:$('#booking-date').value}));if(seq!==availabilitySequence)return;
    renderSlots(container,data.slots,slot=>{selectedSlot=slot;setSummary();});$('#slots-label').textContent=data.slots.length?`${data.slots.length} horários disponíveis · ${selectedService.duration} minutos cada`:'Escolha outra data para continuar.';
  }catch(error){if(seq!==availabilitySequence)return;container.replaceChildren(element('p',error.message));$('#slots-label').textContent='A consulta de horários não foi concluída.';}
  $('#previous-day').disabled=$('#booking-date').value<=$('#booking-date').min;$('#next-day').disabled=$('#booking-date').value>=$('#booking-date').max;
}
function selectService(service){
  selectedService=service;const select=$('#resource');select.replaceChildren();
  for(const resource of catalog.resources.filter(r=>service.resourceIds.includes(r.id))){const option=element('option',resource.name);option.value=resource.id;select.append(option);}
  select.disabled=false;selectedResource=catalog.resources.find(r=>r.id===select.value);loadAvailability();
}
function storePending(value){try{if(value)sessionStorage.setItem('lumnis-pending',JSON.stringify(value));else sessionStorage.removeItem('lumnis-pending');}catch{/* A confirmação continua funcionando sem armazenamento de sessão. */}}
function readPending(){try{return JSON.parse(sessionStorage.getItem('lumnis-pending')||'null');}catch{return null;}}
async function sendReservation(pending){
  const button=$('#reserve-button');setBusy(button,true,'Confirmando…');clearMessage();
  try{
    const data=await api('/api/bookings',{method:'POST',headers:{'Idempotency-Key':pending.key,Authorization:'Bearer '+pending.token},body:JSON.stringify(pending.payload)});
    storePending(null);manageToken=pending.token;booking=data.booking;history.replaceState(null,'','#'+new URLSearchParams({reserva:booking.id,chave:manageToken}));renderManagement();message(catalog.mode==='demo'?'Reserva de teste criada. Guarde o link privado abaixo.':'Reserva criada. Guarde o link privado abaixo.','success');$('#management').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){
    const box=message(error.message,'error');
    if(error.code==='slot_conflict'){storePending(null);loadAvailability();}
    else if(!error.status||error.status>=500){const retry=element('button','Tentar confirmar a mesma reserva','subtle-button');retry.type='button';retry.addEventListener('click',()=>sendReservation(pending));box.append(element('p','O envio pode ter sido processado. Repetir a mesma solicitação não cria outra reserva.'),retry);}
    else storePending(null);
  }finally{setBusy(button,false,catalog.mode==='demo'?'Confirmar reserva de teste':'Confirmar reserva');if(!booking)button.disabled=!selectedSlot;}
}
function renderManagement(){
  $('#booking-workspace').hidden=true;$('#management').hidden=false;$('#management-heading').textContent=booking.status==='cancelled'?'Reserva cancelada.':booking.status==='completed'?'Atendimento concluído.':'Tudo combinado.';
  $('#management-status').replaceWith(Object.assign(badge(booking.status),{id:'management-status'}));
  $('#management-details').replaceChildren(summaryLine('Atendimento',booking.service,booking.resource),summaryLine('Quando',longDate(booking.startsAt),time(booking.startsAt)+' — '+time(booking.endsAt)),summaryLine('Reservado por',booking.customerName),summaryLine('E-mail informado',booking.customerEmail));
  $('#management-link').value=location.href;$('#show-reschedule').hidden=booking.status!=='confirmed';$('#cancel-booking').hidden=booking.status!=='confirmed';$('#download-calendar').hidden=booking.status==='cancelled';$('#reschedule-form').hidden=true;
}
async function refreshBooking(){const data=await api('/api/bookings/'+booking.id,{headers:{Authorization:'Bearer '+manageToken}});booking=data.booking;renderManagement();}
async function loadRescheduleSlots(){
  const seq=++rescheduleSequence;const container=$('#reschedule-slots');container.replaceChildren(element('p','Consultando novos horários…'));$('#reschedule-submit').disabled=true;$('#reschedule-submit').dataset.start='';
  try{const data=await api('/api/availability?'+new URLSearchParams({serviceId:booking.serviceId,resourceId:booking.resourceId,date:$('#reschedule-date').value}));if(seq!==rescheduleSequence)return;renderSlots(container,data.slots,slot=>{$('#reschedule-submit').dataset.start=slot.startsAt;$('#reschedule-submit').disabled=false;});}
  catch(error){if(seq===rescheduleSequence)container.replaceChildren(element('p',error.message));}
}
async function setupBooking(){
  setDateBounds($('#booking-date'));setDateBounds($('#reschedule-date'));
  for(const service of catalog.services){
    const label=element('label',undefined,'service-choice'),radio=element('input');radio.type='radio';radio.name='service';radio.value=service.id;
    const text=element('span');text.append(element('strong',service.name),element('small',service.description));label.append(radio,text,element('span',service.duration+' min','service-duration'));radio.addEventListener('change',()=>selectService(service));$('#service-choices').append(label);
  }
  $('#resource').addEventListener('change',()=>{selectedResource=catalog.resources.find(r=>r.id===$('#resource').value);loadAvailability();});
  $('#booking-date').addEventListener('change',loadAvailability);
  for(const [id,delta] of [['#previous-day',-1],['#next-day',1]])$(id).addEventListener('click',()=>{const value=shiftDay($('#booking-date').value,delta);if(value>=$('#booking-date').min&&value<=$('#booking-date').max){$('#booking-date').value=value;loadAvailability();}});
  $('#reserve-button').textContent=catalog.mode==='demo'?'Confirmar reserva de teste':'Confirmar reserva';
  $('#booking-form').addEventListener('submit',event=>{
    event.preventDefault();if(!selectedSlot||!$('#booking-form').reportValidity())return;
    const payload={serviceId:selectedService.id,resourceId:selectedResource.id,startsAt:selectedSlot.startsAt,name:$('#booking-name').value,email:$('#booking-email').value,consent:$('#booking-consent').checked};
    const previous=readPending();const pending=previous&&JSON.stringify(previous.payload)===JSON.stringify(payload)?previous:{key:crypto.randomUUID(),token:randomToken(),payload};storePending(pending);sendReservation(pending);
  });
  $('#copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#management-link').value);message('Link privado copiado. Guarde-o em um local seguro.','success');}catch{$('#management-link').select();message('Selecione o link acima e use Copiar no seu dispositivo.');}});
  $('#show-reschedule').addEventListener('click',()=>{$('#reschedule-form').hidden=!$('#reschedule-form').hidden;if(!$('#reschedule-form').hidden)loadRescheduleSlots();});
  $('#reschedule-date').addEventListener('change',loadRescheduleSlots);
  $('#reschedule-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('#reschedule-submit');if(!button.dataset.start)return;setBusy(button,true,'Reagendando…');
    try{const data=await api('/api/bookings/'+booking.id,{method:'PATCH',headers:{Authorization:'Bearer '+manageToken},body:JSON.stringify({action:'reschedule',startsAt:button.dataset.start})});booking=data.booking;renderManagement();message('Reserva reagendada. O link privado continua o mesmo.','success');}
    catch(error){message(error.message,'error');if(error.code==='slot_conflict')loadRescheduleSlots();}
    finally{setBusy(button,false,'Confirmar novo horário');}
  });
  const dialog=$('#confirm-dialog');$('#cancel-booking').addEventListener('click',()=>dialog.showModal());$('#keep-booking').addEventListener('click',()=>dialog.close());
  $('#confirm-cancel').addEventListener('click',async()=>{
    const button=$('#confirm-cancel');setBusy(button,true,'Cancelando…');
    try{const data=await api('/api/bookings/'+booking.id,{method:'PATCH',headers:{Authorization:'Bearer '+manageToken},body:JSON.stringify({action:'cancel'})});booking=data.booking;renderManagement();dialog.close();message('Reserva cancelada. O horário foi liberado.','success');}
    catch(error){dialog.close();message(error.message,'error');}finally{setBusy(button,false,'Sim, cancelar');}
  });
  $('#download-calendar').addEventListener('click',()=>{
    const stamp=date=>new Date(date).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const escape=value=>value.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Lumnis//Agenda//PT-BR','BEGIN:VEVENT','UID:'+booking.id+'@lumnis','DTSTAMP:'+stamp(new Date()),'DTSTART:'+stamp(booking.startsAt),'DTEND:'+stamp(booking.endsAt),'SUMMARY:'+escape((catalog.mode==='demo'?'[TESTE] ':'')+booking.service),'DESCRIPTION:'+escape(catalog.mode==='demo'?'Reserva de teste, sem atendimento real.':'Agendamento criado pela Lumnis.'),'END:VEVENT','END:VCALENDAR',''].join('\r\n');
    const url=URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'})),link=element('a');link.href=url;link.download='lumnis-reserva.ics';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  const hash=new URLSearchParams(location.hash.slice(1)),id=hash.get('reserva'),key=hash.get('chave');
  if(id&&key){booking={id};manageToken=key;$('#booking-workspace').hidden=true;try{await refreshBooking();}catch(error){message(error.message,'error');const link=element('a','Iniciar outra reserva','text-link');link.href='/agenda';$('#app-message').append(element('p'),link);}return;}
  const first=$('#service-choices input');if(first){first.checked=true;selectService(catalog.services[0]);}
  const pending=readPending();if(pending?.key&&pending?.token&&pending?.payload){const box=message('Há uma solicitação desta sessão sem confirmação. Você pode consultar o resultado repetindo o mesmo envio.');const retry=element('button','Retomar confirmação','subtle-button');retry.type='button';retry.addEventListener('click',()=>sendReservation(pending));box.append(element('p'),retry);}
}
let adminRows=[],adminLoadSequence=0,pendingAdminAction;
function renderAdminRows(){
  const resource=$('#admin-resource').value,status=$('#admin-status').value,rows=adminRows.filter(row=>(!resource||row.resourceId===resource)&&(!status||row.status===status));
  $('#admin-metrics').replaceChildren(...[['Total',adminRows.length],['Confirmadas',adminRows.filter(r=>r.status==='confirmed').length],['Concluídas',adminRows.filter(r=>r.status==='completed').length],['Canceladas',adminRows.filter(r=>r.status==='cancelled').length]].map(([label,count])=>{const item=element('div',undefined,'metric');item.append(element('span',label),element('strong',String(count).padStart(2,'0')));return item;}));
  $('#admin-list-description').textContent=rows.length+' registros nesta visualização. Indicadores: total do dia.';const list=$('#admin-bookings');list.replaceChildren();
  if(!rows.length){list.append(element('p','Nenhum atendimento nesta visualização. Altere a data ou os filtros para consultar outros registros.','empty-state'));return;}
  for(const row of rows){
    const article=element('article',undefined,'admin-booking'),when=element('time',time(row.startsAt));when.dateTime=row.startsAt;
    const info=element('div');info.append(element('h3',row.service),element('p',row.resource),element('p',time(row.startsAt)+' — '+time(row.endsAt)));
    const customer=element('div');customer.append(badge(row.status),element('h3',row.customerName),element('p',row.customerEmail));const actions=element('div',undefined,'admin-booking-actions');
    if(row.status==='confirmed')for(const [status,label] of [['completed','Concluir'],['cancelled','Cancelar']]){
      const button=element('button',label,'subtle-button'+(status==='cancelled'?' danger':''));button.type='button';button.disabled=status==='completed'&&Date.parse(row.startsAt)>Date.now();button.addEventListener('click',()=>{pendingAdminAction={id:row.id,status};$('#admin-confirm-title').textContent=status==='completed'?'Concluir atendimento?':'Cancelar atendimento?';$('#admin-confirm-description').textContent=status==='completed'?`Marcar o atendimento de ${row.customerName} como concluído?`:`O horário de ${row.customerName} será liberado. Essa alteração encerra a reserva.`;$('#admin-confirm-dialog').showModal();});actions.append(button);
    }
    article.append(when,info,customer,actions);list.append(article);
  }
}
function showAdmin(authenticated){$('#login-section').hidden=authenticated;$('#admin-workspace').hidden=!authenticated;$('#logout').hidden=!authenticated;if(!authenticated){adminLoadSequence++;adminRows=[];$('#admin-bookings').replaceChildren();$('#admin-metrics').replaceChildren();}}
async function loadAdmin(){
  const seq=++adminLoadSequence;$('#admin-bookings').replaceChildren(element('p','Consultando atendimentos…','empty-state'));
  try{const data=await api('/api/admin/bookings?'+new URLSearchParams({date:$('#admin-date').value}));if(seq!==adminLoadSequence)return;adminRows=data.bookings;renderAdminRows();}
  catch(error){if(seq!==adminLoadSequence)return;adminRows=[];$('#admin-bookings').replaceChildren();$('#admin-metrics').replaceChildren();message(error.message,'error');if(error.status===401)showAdmin(false);}
}
async function setupAdmin(){
  $('#admin-date').value=dayValue();for(const resource of catalog.resources){const option=element('option',resource.name);option.value=resource.id;$('#admin-resource').append(option);}
  $('#login-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('#login-form button');setBusy(button,true,'Entrando…');clearMessage();
    try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#admin-password').value})});$('#admin-password').value='';showAdmin(true);await loadAdmin();}
    catch(error){message(error.message,'error');}finally{setBusy(button,false,'Entrar →');}
  });
  $('#logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST',body:'{}'});showAdmin(false);message('Você saiu do painel.');}catch(error){message(error.message,'error');}});
  $('#admin-date').addEventListener('change',loadAdmin);$('#refresh-bookings').addEventListener('click',loadAdmin);$('#admin-resource').addEventListener('change',renderAdminRows);$('#admin-status').addEventListener('change',renderAdminRows);
  $('#admin-keep').addEventListener('click',()=>$('#admin-confirm-dialog').close());
  $('#admin-confirm').addEventListener('click',async()=>{
    if(!pendingAdminAction)return;const button=$('#admin-confirm');setBusy(button,true,'Atualizando…');
    try{await api('/api/admin/bookings/'+pendingAdminAction.id,{method:'PATCH',body:JSON.stringify({status:pendingAdminAction.status})});$('#admin-confirm-dialog').close();message('Atendimento atualizado.','success');await loadAdmin();}
    catch(error){$('#admin-confirm-dialog').close();message(error.message,'error');if(error.status===401)showAdmin(false);else loadAdmin();}finally{setBusy(button,false,'Confirmar');pendingAdminAction=null;}
  });
  try{await api('/api/admin/session');showAdmin(true);await loadAdmin();}catch(error){if(error.status!==401)message(error.message,'error');showAdmin(false);}
}
(async()=>{try{await loadCatalog();if(page==='booking')await setupBooking();else await setupAdmin();}catch(error){message(error.message,'error');$('#environment').textContent='Sistema indisponível';}})();
