/* ---------- Common helpers ---------- */
const $ = (s) => document.querySelector(s);
const nowIso = () => new Date().toISOString();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)) } catch { return d } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};

/* ---------- Simulated scenarios & analyzer ---------- */
const BASE_LAT = 28.6139, BASE_LNG = 77.2090;
const SCENARIOS = {
  perimeter_intrusion: [
    {id:'evt-001239', source:'drone', sensor_id:'drone-alpha-2',
      location:{lat:BASE_LAT+0.001, lng:BASE_LNG-0.001}, payload_type:'detection',
      payload:{detections:[{class:'person', conf:0.91},{class:'pickup_truck', conf:0.76}], notes:'north perimeter pass'}},
    {id:'evt-001244', source:'ground', sensor_id:'ms-22', location:{lat:BASE_LAT+0.0012,lng:BASE_LNG-0.0014},
      payload_type:'telemetry', payload:{motion_index:8.9, baseline:0.2}},
    {id:'evt-001255', source:'access', sensor_id:'gate-north-03', location:{lat:BASE_LAT+0.0011,lng:BASE_LNG-0.0011},
      payload_type:'log', payload:{message:'Access denied at north gate for unknown badge', level:'warn'}},
    {id:'evt-001263', source:'drone', sensor_id:'drone-alpha-2', location:{lat:BASE_LAT+0.0013,lng:BASE_LNG-0.0012},
      payload_type:'detection', payload:{detections:[{class:'person', conf:0.89}], notes:'subject remains near gate'}},
  ],
  false_alarm_wildlife: [
    {id:'evt-002001', source:'ground', sensor_id:'ac-07', location:{lat:BASE_LAT-0.0013,lng:BASE_LNG+0.0012},
      payload_type:'telemetry', payload:{acoustic_db:63, vibration:0.6}},
    {id:'evt-002006', source:'drone', sensor_id:'drone-bravo-1', location:{lat:BASE_LAT-0.0012,lng:BASE_LNG+0.0014},
      payload_type:'detection', payload:{detections:[{class:'animal', conf:0.85}], notes:'wildlife near fence'}},
  ],
  convoy_route_risk: [
    {id:'evt-003100', source:'sat', sensor_id:'sat-geo-5', location:{lat:BASE_LAT+0.01,lng:BASE_LNG+0.02},
      payload_type:'status', payload:{change_detected:true, area:'bridge-segment-12'}},
    {id:'evt-003111', source:'radio', sensor_id:'convoy-alpha', location:{lat:BASE_LAT+0.008,lng:BASE_LNG+0.021},
      payload_type:'log', payload:{message:'Debris reported near bridge segment 12', level:'info'}},
  ],
};

function analyze(events){
  const hasDet = (cls) => events.some(e => (e.payload?.detections||[]).some(d => d.class === cls));
  const maxMotion = () => events.reduce((m,e)=> Math.max(m, e.payload?.motion_index||0), 0);
  const hasDenied = () => events.some(e => e.payload_type==='log' && JSON.stringify(e.payload).toLowerCase().includes('denied'));
  let risk = 'LOW';
  const person = hasDet('person');
  const vehicle = hasDet('pickup_truck') || hasDet('vehicle');
  const motion = maxMotion();
  const denied = hasDenied();
  if ((person || vehicle) && motion > 5) risk = 'MEDIUM';
  if (denied && risk !== 'LOW') risk = 'HIGH';
  const parts = [];
  if (person) parts.push('person detected');
  if (vehicle) parts.push('vehicle detected');
  if (motion>0) parts.push(`motion ${motion}`);
  if (denied) parts.push('recent access denial');
  if (!parts.length) parts.push('no significant signals');
  const summary = parts.slice(0,3).join(', ') + '.';
  const actions = risk==='LOW'
    ? ['Monitor area and keep logging.','Tune sensor thresholds if recurrent.']
    : ['Alert on-site team and share live feed.','Issue pre-recorded audio warning.','Temporarily lock secondary gates (10m).','Archive & tag footage.'];
  const evidence = events.slice(0,5).map(e=>{
    const loc = e.location || {};
    const locTxt = (typeof loc.lat==='number') ? `@(${loc.lat.toFixed(5)},${loc.lng.toFixed(5)})` : '';
    return `${e.source}:${e.sensor_id} ${e.payload_type} ${locTxt}`;
  });
  return { summary, risk, actions, evidence };
}

/* ---------- Dashboard page (OpenLayers) ---------- */
function dashInit(){
  let events = LS.get('events', []);
  let running = null;
  const feed = $('#feed'), alertBox = $('#alert'), alertLevel = $('#alertLevel'), alertMsg = $('#alertMsg');
  const scenarioSel = $('#scenario'), hzInput = $('#hz'), applyBtn = $('#apply');

  // Map
  const centerLonLat = [77.2090, 28.6139];
  const map = new ol.Map({
    target: 'olMap',
    layers: [ new ol.layer.Tile({ source: new ol.source.OSM() }) ],
    view: new ol.View({ center: ol.proj.fromLonLat(centerLonLat), zoom: 14 }),
    controls: ol.control.defaults().extend([ new ol.control.ScaleLine() ])
  });
  const vectorSource = new ol.source.Vector();
  const vectorLayer = new ol.layer.Vector({
    source: vectorSource,
    style: (feature)=>{
      const type = feature.get('type');
      const color = type==='hotspot' ? 'rgba(239,68,68,0.6)' : 'rgba(52,211,153,0.9)';
      const radius = type==='hotspot' ? 10 : 6;
      return new ol.style.Style({
        image: new ol.style.Circle({ radius, fill: new ol.style.Fill({ color }), stroke: new ol.style.Stroke({ color:'#0b1220', width:1 }) })
      });
    }
  });
  map.addLayer(vectorLayer);

  function pushMarker(lat, lng, type='point'){
    const f = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([lng, lat])), type });
    vectorSource.addFeature(f);
    const feats = vectorSource.getFeatures();
    const points = feats.filter(x=>x.get('type')==='point');
    if (points.length > 50){
      for (let i=0;i<points.length-50;i++){ vectorSource.removeFeature(points[i]); }
    }
  }
  function setHotspot(lat, lng){
    vectorSource.getFeatures().filter(f=>f.get('type')==='hotspot').forEach(f=>vectorSource.removeFeature(f));
    pushMarker(lat,lng,'hotspot');
  }

  function pushFeed(ev){
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = 'badge low'; badge.textContent = 'LOW';
    li.textContent = `${ev.ts.slice(11,19)} • ${ev.source}:${ev.sensor_id} • ${ev.payload_type} `;
    li.appendChild(badge);
    feed.appendChild(li);
    feed.scrollTop = feed.scrollHeight;
  }
  function refreshAlerts(){
    const last10 = events.slice(-10);
    if (!last10.length){ alertBox.hidden = true; return; }
    const a = analyze(last10);
    alertBox.hidden = false;
    alertMsg.textContent = a.summary;
    alertLevel.textContent = `RISK: ${a.risk}`;
    alertBox.style.background = a.risk === 'HIGH' ? 'rgba(239,68,68,0.15)'
      : a.risk === 'MEDIUM' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)';
  }

  function start(){
    const name = scenarioSel.value;
    const hz = clamp(Number(hzInput.value)||1, 0.1, 10);
    if (running) clearInterval(running);
    running = setInterval(() => {
      const base = SCENARIOS[name][Math.floor(Math.random()*SCENARIOS[name].length)];
      const ev = JSON.parse(JSON.stringify(base));
      ev.ts = nowIso();
      events.push(ev);
      events = events.slice(-500);
      LS.set('events', events);
      pushFeed(ev);
      if (ev.location && typeof ev.location.lat==='number' && typeof ev.location.lng==='number'){
        pushMarker(ev.location.lat, ev.location.lng, 'point');
        setHotspot(ev.location.lat, ev.location.lng);
      }
      refreshAlerts();
    }, 1000/hz);
  }

  $('#analyzeBtn').onclick = () => {
    const a = analyze(LS.get('events', []).slice(-10));
    $('#analysisOut').textContent =
      `Summary: ${a.summary}\nRisk: ${a.risk}\n\nRecommended:\n- ${a.actions.join('\n- ')}\n\nEvidence:\n- ${a.evidence.join('\n- ')}`;
  };
  $('#apply').onclick = start;

  refreshAlerts(); start();
}

/* ---------- Threat page ---------- */
function threatInit(){
  const up = $('#cvUpload'), canvas = $('#cvCanvas'), ctx = canvas.getContext('2d');
  const list = $('#cvDetections'), patternOut = $('#patternOut'), forecastOut = $('#forecastOut');
  const drawImg = (img) => {
    const scale = Math.min(canvas.width/img.width, canvas.height/img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img, (canvas.width-w)/2, (canvas.height-h)/2, w, h);
  };
  function randBoxes(){
    const classes = ['person','pickup_truck','animal','unknown'];
    const n = 1 + Math.floor(Math.random()*3);
    const out = [];
    for (let i=0;i<n;i++){
      out.push({
        class: classes[Math.floor(Math.random()*classes.length)],
        conf: +(0.6 + Math.random()*0.39).toFixed(2),
        box: [Math.random()*520+40, Math.random()*260+40, Math.random()*100+60, Math.random()*100+40]
      });
    }
    return out;
  }
  function renderDetections(dets){
    ctx.lineWidth = 2;
    list.innerHTML = '';
    for (const d of dets){
      const [x,y,w,h] = d.box;
      ctx.strokeStyle = d.class==='person' ? '#22c55e' : d.class==='pickup_truck'? '#eab308' : '#38bdf8';
      ctx.strokeRect(x,y,w,h);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x,y-18,120,18);
      ctx.fillStyle = '#fff'; ctx.font = '12px monospace';
      ctx.fillText(`${d.class} ${Math.round(d.conf*100)}%`, x+4, y-5);

      const li = document.createElement('li');
      li.textContent = `${d.class} — confidence ${(d.conf*100).toFixed(0)}%`;
      list.appendChild(li);
    }
  }
  function patterns(dets){
    const hasPerson = dets.some(d=>d.class==='person');
    const hasVehicle = dets.some(d=>d.class==='pickup_truck');
    const dwell = hasPerson ? (30 + Math.floor(Math.random()*90)) : 0;
    const msg = [
      hasPerson ? `Person present (dwell ~${dwell}s)` : 'No human subject detected',
      hasVehicle ? 'Vehicle nearby (possible pickup)' : 'No vehicle in current frame',
      'Region: north gate sector'
    ].join('\\n');
    patternOut.textContent = msg;
    const riskScore = clamp((hasPerson?0.5:0)+(hasVehicle?0.3:0)+Math.random()*0.2, 0, 1);
    forecastOut.textContent = `Projected incident probability (15m): ${(riskScore*100).toFixed(0)}%`;
  }

  up.onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      drawImg(img);
      const dets = randBoxes();
      renderDetections(dets);
      patterns(dets);
    };
    img.src = URL.createObjectURL(f);
  };

  $('#generateAlert').onclick = () => {
    const last10 = LS.get('events', []).slice(-10);
    if (!last10.length) { $('#alertPreview').textContent='No recent events.'; return; }
    const a = analyze(last10);
    const conf = a.risk==='HIGH'? 0.86 : a.risk==='MEDIUM'? 0.72 : 0.41;
    $('#alertPreview').textContent =
      `AUTO-ALERT\\nRisk: ${a.risk}  (confidence ${(conf*100).toFixed(0)}%)\\nSummary: ${a.summary}\\nActions:\\n- ${a.actions.join('\\n- ')}`;
  };
}

/* ---------- Comms page ---------- */
function commsInit(){
  const msgInput = $('#msgInput'), list = $('#msgList'), send = $('#sendMsg'), enc = $('#encToggle');
  const fileInput = $('#fileInput'), shareBtn = $('#shareFile'), fileList = $('#fileList');
  const audioInput = $('#audioInput'), transBtn = $('#transcribeBtn'), out = $('#transcriptOut');

  function render(){
    list.innerHTML = '';
    for (const m of LS.get('comms', [])){
      const li = document.createElement('li');
      li.textContent = `${m.ts.slice(11,19)} • ${m.sender}: ${m.text}`;
      list.appendChild(li);
    }
    fileList.innerHTML = '';
    for (const f of LS.get('files', [])){
      const li = document.createElement('li');
      li.textContent = `${f.ts.slice(11,19)} • ${f.name} (${(f.size/1024).toFixed(1)} KB) [encrypted:${f.encrypted?'yes':'no'}]`;
      fileList.appendChild(li);
    }
  }
  send.onclick = () => {
    const txt = msgInput.value.trim(); if (!txt) return;
    const payload = enc.checked ? btoa(unescape(encodeURIComponent(txt))) : txt;
    const msgs = LS.get('comms', []);
    msgs.push({ id:`msg-${Date.now()}`, sender:'Ops', text: payload, ts: nowIso(), encrypted: enc.checked });
    LS.set('comms', msgs); msgInput.value=''; render();
  };
  shareBtn.onclick = () => {
    const f = fileInput.files[0]; if (!f) return;
    const files = LS.get('files', []);
    files.push({ id:`file-${Date.now()}`, name:f.name, size:f.size, ts:nowIso(), encrypted:true });
    LS.set('files', files); fileInput.value=''; render();
  };
  transBtn.onclick = () => {
    const f = audioInput.files[0];
    if (!f){ out.textContent = 'Choose an audio file first.'; return; }
    out.textContent = `Transcribed "${f.name}": Patrol-3 en route to north gate; ETA five minutes.`;
  };
  render();
}

/* ---------- Missions page ---------- */
function missionsInit(){
  const list = $('#missionsList');
  const title = $('#mTitle'), desc = $('#mDesc'), due = $('#mDue'),
        prio = $('#mPriority'), pers = $('#mPersonnel'), eqp = $('#mEquipment');
  const addBtn = $('#addMissionBtn'), optBtn = $('#optimizeBtn');
  const tl = $('#timeline'), ctx = tl.getContext('2d');

  function getM(){ return LS.get('missions', []); }
  function setM(x){ LS.set('missions', x); }
  function renderList(){
    list.innerHTML = '';
    for (const m of getM()){
      const li = document.createElement('li');
      li.textContent = `${m.title} — ${m.priority} — due ${new Date(m.due).toLocaleString()} — team: ${m.personnel.join(', ')}`;
      list.appendChild(li);
    }
  }
  function renderTimeline(){
    const ms = getM(); ctx.fillStyle = '#0b1220'; ctx.fillRect(0,0,tl.width,tl.height);
    ctx.strokeStyle = '#1f2937'; ctx.beginPath(); ctx.moveTo(60,30); ctx.lineTo(60,180); ctx.stroke();
    ctx.font = '12px monospace'; ctx.fillStyle = '#cbd5e1'; ctx.fillText('Today', 10, 25);
    const now = Date.now();
    for (let i=0;i<5;i++){
      const x = 60 + i*180; ctx.strokeStyle='#1f2937'; ctx.beginPath(); ctx.moveTo(x,40); ctx.lineTo(x,200); ctx.stroke();
      ctx.fillStyle='#94a3b8'; ctx.fillText(`+${i*6}h`, x-12, 210);
    }
    let y = 60;
    ms.forEach(m => {
      const hours = (new Date(m.due).getTime() - now) / 3600000;
      const x = 60 + clamp(hours, 0, 24) * (180/6);
      ctx.fillStyle = m.priority==='High' ? '#ef4444' : (m.priority==='Medium' ? '#eab308' : '#34d399');
      ctx.fillRect(x, y, 120, 12);
      ctx.fillStyle = '#e6edf7';
      ctx.fillText(m.title.slice(0,22), x+4, y+10);
      y += 28;
    });
  }
  function optimize(){
    const people = {};
    const ms = getM();
    ms.forEach(m => m.personnel.forEach(p => { people[p] = (people[p]||0)+1; }));
    const allP = new Set(ms.flatMap(m => m.personnel));
    if (allP.size===0){
      const seed = ['Alpha','Bravo','Charlie','Delta'];
      ms.forEach((m,i)=> m.personnel = [ seed[i%seed.length] ]);
    } else {
      ms.forEach(m => {
        m.personnel = [...(new Set(m.personnel.filter(Boolean)))];
        if (m.personnel.length===0){
          const pick = [...allP].sort((a,b)=>(people[a]||0)-(people[b]||0))[0];
          m.personnel = [pick || 'Alpha'];
        }
      });
    }
    setM(ms); renderList(); renderTimeline();
  }

  addBtn.onclick = () => {
    const m = {
      id: `mis-${Date.now()}`,
      title: title.value.trim() || 'Untitled Mission',
      description: desc.value.trim(),
      due: due.value ? new Date(due.value).toISOString() : new Date(Date.now()+4*3600000).toISOString(),
      priority: prio.value,
      personnel: (pers.value||'Alpha').split(',').map(s=>s.trim()).filter(Boolean),
      equipment: (eqp.value||'Radio').split(',').map(s=>s.trim()).filter(Boolean)
    };
    const ms = getM(); ms.push(m); setM(ms);
    title.value=''; desc.value=''; pers.value=''; eqp.value='';
    renderList(); renderTimeline();
  };
  optBtn.onclick = optimize;

  if (getM().length===0){
    setM([
      {id:'mis-01', title:'North Perimeter Watch', description:'Gate patrol', due:new Date(Date.now()+3*3600000).toISOString(), priority:'High', personnel:['Alpha'], equipment:['UAV','Radio']},
      {id:'mis-02', title:'Bridge Recon', description:'Route scan', due:new Date(Date.now()+9*3600000).toISOString(), priority:'Medium', personnel:['Bravo'], equipment:['Truck','FirstAid']}
    ]);
  }
  renderList(); renderTimeline();
}

/* ---------- Analytics page ---------- */
function analyticsInit(){
  const trend = $('#trendChart'), ctx = trend.getContext('2d');
  const uptime = $('#kUptime'), mtta = $('#kMTTA'), acc = $('#kAccuracy'), load = $('#kOpsLoad');
  const exportBtn = $('#exportAnalytics'), logi = $('#forecastLogi');

  function drawTrend(points){
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0,0,trend.width,trend.height);
    ctx.strokeStyle = '#1f2937';
    for (let y=30;y<trend.height;y+=30){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(trend.width,y); ctx.stroke(); }
    const max = Math.max(1, ...points);
    ctx.strokeStyle = '#34d399'; ctx.beginPath();
    points.forEach((p,i) => {
      const x = (i/(points.length-1)) * (trend.width-30) + 15;
      const y = trend.height - 20 - (p/max)*(trend.height-60);
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke();
  }

  const evs = LS.get('events', []);
  const buckets = Array(30).fill(0);
  const now = Date.now();
  evs.forEach(e => {
    const dt = now - new Date(e.ts).getTime();
    const min = Math.floor(dt/60000);
    if (min >= 0 && min < 30) buckets[29-min] += 1;
  });
  const points = buckets.map(v => v + Math.floor(Math.random()*2));
  drawTrend(points);

  uptime.textContent = '99.2%';
  mtta.textContent = (20 + Math.floor(Math.random()*40)) + ' s';
  acc.textContent = (92 + Math.floor(Math.random()*5)) + '%';
  load.textContent = (35 + Math.floor(Math.random()*20)) + '%';

  const missions = LS.get('missions', []);
  const pace = Math.max(1, missions.length);
  const burn = 3 + Math.floor(Math.random()*4);
  const days = Math.max(1, Math.round(100 / (pace*burn)));
  logi.textContent = `At current mission pace (${pace}/day) and burn (${burn} units/day), resupply is recommended in ~${days} days.`;

  exportBtn.onclick = () => {
    const payload = { generatedAt: nowIso(), kpis:{ uptime: uptime.textContent, mtta: mtta.textContent, accuracy: acc.textContent, opsLoad: load.textContent }, trend: points, missionsCount: missions.length };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'battlegrid_analytics.json'; a.click();
  };
}

/* ---------- Router ---------- */
const page = document.body.getAttribute('data-page');
if (page === 'dashboard') dashInit();
if (page === 'threat') threatInit();
if (page === 'comms') commsInit();
if (page === 'missions') missionsInit();
if (page === 'analytics') analyticsInit();
