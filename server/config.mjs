export function validateConfig(config){
  const bad=message=>{throw new Error('Configuração da agenda inválida: '+message);};
  if(!['demo','live'].includes(config.mode))bad('mode deve ser demo ou live');
  new Intl.DateTimeFormat('pt-BR',{timeZone:config.timezone}).format();
  if(!Number.isInteger(config.slotMinutes)||config.slotMinutes<5||config.slotMinutes>60)bad('slotMinutes deve estar entre 5 e 60');
  if(!Number.isInteger(config.leadMinutes)||config.leadMinutes<0||config.leadMinutes>43200)bad('leadMinutes inválido');
  if(!Number.isInteger(config.horizonDays)||config.horizonDays<1||config.horizonDays>365)bad('horizonDays deve estar entre 1 e 365');
  if(!Array.isArray(config.weekdays)||!config.weekdays.length||config.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))bad('dias de funcionamento inválidos');
  let previous=-1;
  if(!Array.isArray(config.hours)||!config.hours.length)bad('informe os períodos de atendimento');
  const minute=value=>{if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))bad('horário inválido');return Number(value.slice(0,2))*60+Number(value.slice(3));};
  for(const period of config.hours){if(!Array.isArray(period)||period.length!==2)bad('período inválido');const start=minute(period[0]),end=minute(period[1]);if(start>=end||start<previous)bad('períodos sobrepostos ou fora de ordem');previous=end;}
  for(const list of [config.services,config.resources]){
    if(!Array.isArray(list)||!list.length||list.length>100)bad('catálogo vazio ou muito grande');
    const ids=new Set();for(const item of list){if(!/^[a-z0-9-]{1,50}$/.test(item.id)||ids.has(item.id))bad('identificadores inválidos ou repetidos');ids.add(item.id);if(typeof item.name!=='string'||!item.name.trim()||item.name.length>100)bad('nome de serviço ou agenda inválido');}
  }
  for(const service of config.services){if(!Number.isInteger(service.duration)||service.duration<5||service.duration>480)bad('duração inválida');if(!Array.isArray(service.resourceIds)||!service.resourceIds.length||service.resourceIds.some(id=>!config.resources.some(r=>r.id===id)))bad('serviço sem agenda compatível');}
  return config;
}
