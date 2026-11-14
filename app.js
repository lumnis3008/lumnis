const schedules = [
  { count:'03', confirmed:'02', free:'02', events:[['09:00','Avaliação inicial','Marina Costa · 45 min','Confirmado'],['10:00','Atendimento personalizado','Rafael Lima · 60 min','Confirmado'],['11:30','Conversa de acompanhamento','Camila Alves · 30 min','A confirmar']] },
  { count:'03', confirmed:'02', free:'03', events:[['09:30','Conversa inicial','Lucas Martins · 30 min','Confirmado'],['11:00','Atendimento personalizado','Ana Souza · 60 min','Confirmado'],['14:00','Retorno de atendimento','Bruno Melo · 30 min','A confirmar']] },
  { count:'03', confirmed:'03', free:'03', events:[['08:30','Avaliação inicial','Julia Ribeiro · 45 min','Confirmado'],['10:30','Conversa de acompanhamento','Pedro Santos · 30 min','Confirmado'],['15:00','Atendimento personalizado','Luiza Rocha · 60 min','Confirmado']] },
  { count:'03', confirmed:'02', free:'02', events:[['09:00','Atendimento personalizado','Sofia Dias · 60 min','Confirmado'],['13:00','Avaliação inicial','Gabriel Cruz · 45 min','A confirmar'],['16:00','Retorno de atendimento','Lara Nunes · 30 min','Confirmado']] },
  { count:'02', confirmed:'02', free:'03', events:[['09:30','Conversa inicial','Helena Ramos · 30 min','Confirmado'],['14:30','Atendimento personalizado','Tiago Castro · 60 min','Confirmado']] }
];

function renderSchedule(index) {
  const schedule = schedules[index];
  document.querySelector('#demo-count').replaceChildren(document.createTextNode(schedule.count + ' '), Object.assign(document.createElement('small'), {textContent:'no dia'}));
  document.querySelector('#demo-confirmed').replaceChildren(document.createTextNode(schedule.confirmed + ' '), Object.assign(document.createElement('small'), {textContent:'✓',className:'green'}));
  document.querySelector('#demo-free').replaceChildren(document.createTextNode(schedule.free + ' '), Object.assign(document.createElement('small'), {textContent:'horários'}));
  const fragment = document.createDocumentFragment();
  for (const [time, title, detail, status] of schedule.events) {
    const row = document.createElement('div'); row.className = 'event-row';
    const timeElement = document.createElement('span'); timeElement.className='event-time';timeElement.textContent=time;
    const block = document.createElement('div'); block.className='event-block';
    const info = document.createElement('div');
    info.append(Object.assign(document.createElement('strong'),{textContent:title}),Object.assign(document.createElement('small'),{textContent:detail}));
    block.append(info,Object.assign(document.createElement('span'),{textContent:status}));row.append(timeElement,block);fragment.append(row);
  }
  document.querySelector('#demo-events').replaceChildren(fragment);
  document.querySelectorAll('[data-day]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.day)===index)));
}
document.querySelectorAll('[data-day]').forEach(button=>button.addEventListener('click',()=>renderSchedule(Number(button.dataset.day))));
renderSchedule(0);

const sectors = {
  beleza:{tag:'BELEZA & BEM-ESTAR',title:'Do primeiro horário\nao último atendimento.',description:'Da duração de cada serviço à disponibilidade dos profissionais, a agenda deve refletir a forma como seu espaço trabalha.',items:['Organização por serviço e profissional','Horários alinhados à duração do atendimento','Uma jornada de reserva mais clara'],previewTitle:'Escolha seu atendimento.',previewSubtitle:'Qual cuidado você está procurando?',options:[['Corte e finalização','60 minutos'],['Cuidado com a pele','45 minutos'],['Sessão de bem-estar','50 minutos']]},
  saude:{tag:'CLÍNICAS & CONSULTÓRIOS',title:'Consultas e retornos.\nCada um no seu horário.',description:'Consultas, retornos e diferentes profissionais pedem uma organização que respeite os horários e o fluxo do consultório.',items:['Visualização dos horários de consulta','Organização de consultas e retornos','Disponibilidade por profissional'],previewTitle:'Encontre o melhor horário.',previewSubtitle:'Qual atendimento você procura?',options:[['Primeira consulta','45 minutos'],['Consulta de retorno','30 minutos'],['Avaliação','60 minutos']]},
  consultoria:{tag:'CONSULTORIAS & SERVIÇOS',title:'Seu conhecimento,\ncom hora marcada.',description:'Do encontro inicial ao acompanhamento, o agendamento pode tornar a organização dos seus serviços mais simples e previsível.',items:['Horários dedicados a cada serviço','Organização de encontros e sessões','Uma experiência clara para o cliente'],previewTitle:'Escolha seu encontro.',previewSubtitle:'Escolha o tipo de encontro.',options:[['Conversa inicial','30 minutos'],['Sessão de consultoria','60 minutos'],['Acompanhamento','45 minutos']]}
};
const sectorTabs = [...document.querySelectorAll('[data-sector]')];
function selectSector(button) {
  const data=sectors[button.dataset.sector];
  sectorTabs.forEach(tab=>{const active=tab===button;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
  document.querySelector('#sector-panel').setAttribute('aria-labelledby',button.id);
  document.querySelector('#sector-tag').textContent=data.tag;
  const title=document.querySelector('#sector-title');title.replaceChildren();
  data.title.split('\n').forEach((line,index)=>{if(index)title.append(document.createElement('br'));title.append(document.createTextNode(line));});
  document.querySelector('#sector-description').textContent=data.description;
  document.querySelector('#sector-list').replaceChildren(...data.items.map(text=>Object.assign(document.createElement('li'),{textContent:text})));
  document.querySelector('#preview-title').textContent=data.previewTitle;
  document.querySelector('#preview-subtitle').textContent=data.previewSubtitle;
  document.querySelector('#preview-options').replaceChildren(...data.options.map(([name,duration])=>{
    const option=document.createElement('div');option.className='preview-option';const text=document.createElement('div');
    text.append(Object.assign(document.createElement('strong'),{textContent:name}),Object.assign(document.createElement('small'),{textContent:duration}));
    const radio=document.createElement('span');radio.setAttribute('aria-hidden','true');option.append(text,radio);return option;
  }));
}
sectorTabs.forEach((button,index)=>{
  button.addEventListener('click',()=>selectSector(button));
  button.addEventListener('keydown',event=>{
    let next;
    if(event.key==='ArrowRight')next=(index+1)%sectorTabs.length;
    if(event.key==='ArrowLeft')next=(index-1+sectorTabs.length)%sectorTabs.length;
    if(event.key==='Home')next=0;
    if(event.key==='End')next=sectorTabs.length-1;
    if(next!==undefined){event.preventDefault();selectSector(sectorTabs[next]);sectorTabs[next].focus();}
  });
});
selectSector(sectorTabs[0]);

const menuToggle=document.querySelector('.menu-toggle');
const mobileMenu=document.querySelector('#mobile-menu');
function closeMenu(){mobileMenu.hidden=true;menuToggle.setAttribute('aria-expanded','false');menuToggle.setAttribute('aria-label','Abrir menu');}
menuToggle.addEventListener('click',()=>{const expanded=menuToggle.getAttribute('aria-expanded')==='true';mobileMenu.hidden=expanded;menuToggle.setAttribute('aria-expanded',String(!expanded));menuToggle.setAttribute('aria-label',expanded?'Abrir menu':'Fechar menu');});
mobileMenu.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!mobileMenu.hidden){closeMenu();menuToggle.focus();}});
window.matchMedia('(min-width: 601px)').addEventListener('change',event=>{if(event.matches)closeMenu();});

const privacyDialog=document.querySelector('#privacy-dialog');
document.querySelectorAll('[data-open-privacy]').forEach(button=>button.addEventListener('click',()=>privacyDialog.showModal()));
privacyDialog.querySelector('.dialog-close').addEventListener('click',()=>privacyDialog.close());
privacyDialog.addEventListener('click',event=>{if(event.target===privacyDialog){const rect=privacyDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)privacyDialog.close();}});
document.querySelector('#year').textContent=String(new Date().getFullYear());

const form=document.querySelector('#contact-form');
const formStatus=document.querySelector('#form-status');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!form.reportValidity())return;
  if(!form.elements.nome.value.trim()||!form.elements.mensagem.value.trim()){
    formStatus.hidden=false;formStatus.dataset.state='error';formStatus.textContent='Preencha seu nome e sua mensagem para continuar.';return;
  }
  const button=form.querySelector('[type=submit]');
  button.disabled=true;button.setAttribute('aria-busy','true');button.firstChild.textContent='Enviando mensagem… ';
  formStatus.hidden=true;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'},signal:controller.signal});
    if(!response.ok)throw new Error('send-failed');
    formStatus.dataset.state='success';formStatus.textContent='Mensagem enviada. Obrigado por apresentar seu projeto! A Lumnis poderá responder pelo e-mail informado.';form.reset();
  }catch(error){
    formStatus.dataset.state='error';formStatus.textContent=error.name==='AbortError'?'O envio demorou mais que o esperado e não foi confirmado. Seus dados continuam no formulário. Verifique sua conexão antes de tentar novamente.':'Não foi possível confirmar o envio. Seus dados continuam no formulário. Tente novamente ou fale com a Lumnis pelo Instagram no rodapé.';
  }finally{
    clearTimeout(timeout);button.disabled=false;button.removeAttribute('aria-busy');button.firstChild.textContent='Enviar mensagem ';formStatus.hidden=false;
  }
});
