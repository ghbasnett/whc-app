const SUPABASE_URL='https://kxqgtuiybwtubavxbaxf.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4cWd0dWl5Ynd0dWJhdnhiYXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Mjk2NTAsImV4cCI6MjA5MDIwNTY1MH0.AxtJY6ujK4g9F4qgHshF7wpSCwdJXEhuvsbH6vi3rAU';
let PLAYERS=[];
const PREDICTIONS={'George':{g:3,a:12,app:16},'Dan MM':{g:8,a:5,app:17},'Colesy':{g:3,a:6,app:17},'Ryan':{g:7,a:6,app:20},'Stretch':{g:9,a:8,app:13},'Charge':{g:16,a:7,app:21},'Harvey':{g:15,a:6,app:18},'Hector':{g:1,a:1,app:17},'Ewan':{g:2,a:5,app:12},'Jack':{g:11,a:4,app:18},'Harry':{g:5,a:10,app:15},'Seb C':{g:0,a:2,app:15},'Seb S':{g:3,a:7,app:17},'TH':{g:0,a:0,app:1},'Ollie J':{g:0,a:8,app:15}};

const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

// ── SEASON LOGIC ─────────────────────────────────────────────
// A season runs Sept 1 → Aug 31. On Sept 1 each year, the default flips to the new season.
// Before Sept 1 2026 → '2025-26'. On/after Sept 1 2026 → '2026-27'. Etc.
function getDefaultSeason(date){
  const d=date||new Date();
  const year=d.getFullYear();
  const month=d.getMonth(); // 0-indexed; Sept = 8
  const startYear=month>=8?year:year-1;
  const endYY=String(startYear+1).slice(-2);
  return startYear+'-'+endYY;
}
function getSeasonOptions(){
  const defaultSeason=getDefaultSeason();
  const defaultStartYear=parseInt(defaultSeason.split('-')[0]);
  const startYear=2025; // earliest season
  const endYear=defaultStartYear+1; // include one future season ahead
  const seasons=[];
  for(let y=startYear;y<=endYear;y++){
    const endYY=String(y+1).slice(-2);
    seasons.push(y+'-'+endYY);
  }
  return seasons.reverse(); // newest first in dropdown
}
function populateSeasonDropdown(){
  const sel=document.getElementById('season-sel');
  if(!sel)return;
  const defaultSeason=getDefaultSeason();
  const seasons=getSeasonOptions();
  sel.innerHTML='';
  seasons.forEach(s=>{
    const o=document.createElement('option');
    o.value=s;o.textContent=s;
    if(s===defaultSeason)o.selected=true;
    sel.appendChild(o);
  });
  currentSeason=defaultSeason;
}

let currentSeason=getDefaultSeason(),statsData=[],currentSort='ppg';
let completedFixturesCount=0;
let minAppsThreshold=0;
let thresholdActive=false;
let wheelReady=false,spinning=false,wheelAngle=0,audioCtx=null,spinNodes=[];
let meetingPwHash=null,captainPwHash=null,captainAuthed=false;
let tsSquad=[];
let vsSquad=[];
let currentVoteSession=null;
let rvSession=null;
let rvVotes=[];
let rvRevealing=false;
let rvMomTally={};
let rvDodTally={};
let plEditingId=null;
let fxEditingId=null;

const SORT_COL_TO_IDX={
  appearances:2,
  total_points:3,
  goals:4,
  assists:5,
  goals_plus_assists:6,
  mom_wins:7,
  dod_wins:8,
  ppg:9
};
const SORT_LABELS={
  ppg:{label:'Points Per Game',unit:'PPG'},
  goals:{label:'Top Scorer',unit:'GOALS'},
  assists:{label:'Top Assists',unit:'ASSISTS'},
  appearances:{label:'Most Appearances',unit:'APPS'},
  total_points:{label:'Total Points',unit:'PTS'},
  goals_plus_assists:{label:'Goals + Assists',unit:'G+A'},
  mom_wins:{label:'MOM Wins',unit:'MOM'},
  dod_wins:{label:'DOD Wins',unit:'DOD'}
};

// Small HTML escape helper (used in multiple render fns)
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// ── PLAYER LOADER ────────────────────────────────────────────
async function loadPlayersFromDB(){
  const {data,error} = await sb
    .from('players')
    .select('name')
    .eq('active',true)
    .order('sort_order',{ascending:true});
  if(error){
    console.error('Failed to load players:',error);
    return false;
  }
  PLAYERS = (data||[]).map(p=>p.name);
  return PLAYERS.length>0;
}

// ── NAV ──────────────────────────────────────────────────────
function showSection(id,btn){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('sec-'+id).classList.add('active');
  btn.classList.add('active');
  if(id==='stats')loadStats();
  if(id==='fixtures')loadFixtures();
  if(id==='fine')loadFines();
  if(id==='vote')loadOpenVoteSession();
}
function onSeasonChange(){
  currentSeason=document.getElementById('season-sel').value;
  // Update the fixtures management tab season labels
  const fxSeason=document.getElementById('fx-new-season');if(fxSeason)fxSeason.textContent=currentSeason;
  const fxListSeason=document.getElementById('fx-list-season');if(fxListSeason)fxListSeason.textContent=currentSeason;
  const active=document.querySelector('.section.active');
  if(!active)return;
  const id=active.id.replace('sec-','');
  if(id==='stats')loadStats();
  if(id==='fixtures')loadFixtures();
  if(id==='vote')loadOpenVoteSession();
  if(id==='fine')loadFines();
  // If captain portal is open on a season-sensitive tab, refresh it
  const cpModal=document.getElementById('captain-modal');
  if(cpModal&&cpModal.classList.contains('open')&&captainAuthed){
    const fxTab=document.getElementById('cp-fixtures');
    const plTab=document.getElementById('cp-players');
    if(fxTab&&fxTab.classList.contains('active'))loadFixturesList();
    if(plTab&&plTab.classList.contains('active'))loadPlayersList();
  }
}
function showMtab(id,btn){
  document.querySelectorAll('.msection').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.mtab').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');btn.classList.add('active');
  if(id==='m-wheel')setTimeout(initWheel,50);
  if(id==='m-predictions')loadPredictions();
  if(id==='m-ind-fines')renderIndFines();
}

// ── CAPTAIN'S PORTAL ─────────────────────────────────────────
function openCaptainPortal(){
  document.getElementById('captain-modal').classList.add('open');
  if(captainAuthed){
    document.getElementById('cp-pw-wrap').style.display='none';
    document.getElementById('cp-content').style.display='block';
  }
}
function closeCaptainPortal(){
  document.getElementById('captain-modal').classList.remove('open');
}
document.getElementById('captain-modal').addEventListener('click',function(e){
  if(e.target===this)closeCaptainPortal();
});

async function checkCaptainPw(){
  const input=document.getElementById('cp-pw-in').value;
  if(!input)return;
  if(!captainPwHash){document.getElementById('cp-pw-err').textContent='Could not load — try again.';return;}
  const hashed=await hashString(input);
  if(hashed===captainPwHash){
    captainAuthed=true;
    document.getElementById('cp-pw-wrap').style.display='none';
    document.getElementById('cp-content').style.display='block';
    loadTsSquad();
    loadVsData();
    loadFixtureDropdown();
  } else {
    document.getElementById('cp-pw-err').textContent='Incorrect password.';
  }
}

function showCpTab(id,btn){
  document.querySelectorAll('.cp-tab-content').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.cp-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if(id==='cp-votesetup')loadVsData();
  if(id==='cp-quickstats')loadFixtureDropdown();
  if(id==='cp-players')loadPlayersList();
  if(id==='cp-fixtures')loadFixturesList();
}

// ── CAPTAIN VOTE SETUP ───────────────────────────────────────
async function loadVsData(){
  const{data:fixtures}=await sb.from('fixtures')
    .select('id,match_date,opponent,result,whc_goals,opp_goals')
    .eq('season',currentSeason)
    .order('match_date',{ascending:false});
  const sel=document.getElementById('vs-fixture');
  sel.innerHTML='<option value="">— Select fixture —</option>';
  (fixtures||[]).forEach(f=>{
    const d=new Date(f.match_date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    const o=document.createElement('option');
    o.value=f.id;
    o.textContent=`${d} — ${f.opponent}${f.result?' ('+f.result+')':''}`;
    sel.appendChild(o);
  });

  const{data:players}=await sb.from('players').select('name').eq('active',true).order('sort_order',{ascending:true});
  vsSquad=(players||[]).map(p=>({name:p.name,selected:false}));
  renderVsSquad();

  refreshVsExistingSessions();
}

function renderVsSquad(){
  const list=document.getElementById('vs-squadList');
  list.innerHTML='';
  vsSquad.forEach((p,idx)=>{
    const row=document.createElement('div');
    row.className='ts-squad-row'+(p.selected?' selected':'');
    row.style.cursor='pointer';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=p.selected;
    cb.addEventListener('change',()=>{vsSquad[idx].selected=cb.checked;row.classList.toggle('selected',cb.checked);updateVsCount();});
    row.addEventListener('click',(e)=>{if(e.target===cb)return;cb.checked=!cb.checked;cb.dispatchEvent(new Event('change'));});
    const nm=document.createElement('span');nm.className='ts-squad-name';nm.textContent=p.name;
    row.appendChild(cb);row.appendChild(nm);
    list.appendChild(row);
  });
  updateVsCount();
}
function updateVsCount(){
  const n=vsSquad.filter(p=>p.selected).length;
  document.getElementById('vs-selectedCount').textContent=n+' selected';
}

async function refreshVsExistingSessions(){
  const{data:sessions}=await sb.from('match_vote_sessions')
    .select('id,fixture_id,status,created_at,fixtures!inner(opponent,match_date,season)')
    .eq('status','open')
    .eq('fixtures.season',currentSeason)
    .order('created_at',{ascending:false});
  const wrap=document.getElementById('vs-existing-wrap');
  const card=document.getElementById('vs-existing-card');
  if(!sessions||!sessions.length){wrap.style.display='none';return;}
  const s=sessions[0];
  const{count}=await sb.from('match_votes').select('*',{count:'exact',head:true}).eq('session_id',s.id);
  const d=new Date(s.fixtures.match_date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  card.innerHTML=`
    <div class="vs-existing-info">
      <div class="ve-row"><span>Fixture</span><strong>${d} — ${s.fixtures.opponent}</strong></div>
      <div class="ve-row"><span>Votes cast</span><span class="vs-existing-count">${count||0}</span></div>
      <div class="vs-existing-actions">
        <button class="vs-btn-sm danger" onclick="cancelVoteSession(${s.id})">Cancel / Close</button>
      </div>
    </div>`;
  wrap.style.display='block';
}

function onVsFixtureChange(){
  const sel=document.getElementById('vs-fixture');
  if(!sel.value)return;
  sb.from('fixtures').select('whc_goals,opp_goals').eq('id',sel.value).single().then(({data})=>{
    if(data){
      if(data.whc_goals!=null)document.getElementById('vs-gf').value=data.whc_goals;
      if(data.opp_goals!=null)document.getElementById('vs-ga').value=data.opp_goals;
    }
  });
}

async function openVoteSession(){
  const fixId=document.getElementById('vs-fixture').value;
  const gf=parseInt(document.getElementById('vs-gf').value)||0;
  const ga=parseInt(document.getElementById('vs-ga').value)||0;
  const eligible=vsSquad.filter(p=>p.selected).map(p=>p.name);
  const al=document.getElementById('vs-alert');
  if(!fixId){showAlert(al,'error','Pick a fixture first.');return;}
  if(!eligible.length){showAlert(al,'error','Tick at least one player as having played.');return;}
  const btn=document.getElementById('vs-open-btn');btn.disabled=true;btn.textContent='Opening...';
  try{
    const{error}=await sb.from('match_vote_sessions').upsert({
      fixture_id:parseInt(fixId),
      status:'open',
      eligible_players:eligible,
      whc_goals:gf,
      opp_goals:ga
    },{onConflict:'fixture_id'});
    if(error)throw error;
    showAlert(al,'success',`Voting opened — ${eligible.length} players eligible. Share the Vote tab with the squad!`);
    vsSquad.forEach(p=>p.selected=false);renderVsSquad();
    document.getElementById('vs-fixture').value='';
    document.getElementById('vs-gf').value='0';
    document.getElementById('vs-ga').value='0';
    refreshVsExistingSessions();
  }catch(e){showAlert(al,'error','Failed: '+e.message);}
  btn.disabled=false;btn.textContent='🗳 Open Voting';
}

async function cancelVoteSession(sessionId){
  if(!confirm('Cancel this voting session? All submitted votes will be deleted. This cannot be undone.'))return;
  try{
    await sb.from('match_vote_sessions').delete().eq('id',sessionId);
    refreshVsExistingSessions();
    showAlert(document.getElementById('vs-alert'),'success','Voting session cancelled.');
  }catch(e){showAlert(document.getElementById('vs-alert'),'error','Failed: '+e.message);}
}

// ── PUBLIC VOTE PAGE ─────────────────────────────────────────
async function loadOpenVoteSession(){
  document.getElementById('vote-loading').style.display='block';
  document.getElementById('vote-none').style.display='none';
  document.getElementById('vote-form').style.display='none';
  document.getElementById('vote-done').style.display='none';
  document.getElementById('reveal-btn').style.display='none';

  const{data,error}=await sb.from('match_vote_sessions')
    .select('id,fixture_id,eligible_players,whc_goals,opp_goals,status,fixtures!inner(opponent,match_date,season)')
    .eq('status','open')
    .eq('fixtures.season',currentSeason)
    .order('created_at',{ascending:false})
    .limit(1);

  document.getElementById('vote-loading').style.display='none';

  if(error){
    console.error('Vote load error:',error);
    document.getElementById('vote-none').style.display='block';
    return;
  }
  if(!data||!data.length){
    document.getElementById('vote-none').style.display='block';
    currentVoteSession=null;
    return;
  }

  currentVoteSession=data[0];
  document.getElementById('reveal-btn').style.display='inline-block';
  renderVoteForm();
}

function renderVoteForm(){
  const s=currentVoteSession;
  const d=new Date(s.fixtures.match_date+'T00:00:00');
  const dateStr=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
  const result=s.whc_goals>s.opp_goals?'W':s.whc_goals<s.opp_goals?'L':'D';
  const resultLabel=result==='W'?'Victory':result==='L'?'Defeat':'Draw';

  document.getElementById('vote-fixture-card').innerHTML=`
    <div class="vote-fix">
      <div class="vf-date">${dateStr}</div>
      <div class="vf-opp">vs ${s.fixtures.opponent}</div>
      <div class="vf-score">${s.whc_goals} — ${s.opp_goals}</div>
      <div class="vf-sub">${resultLabel} · ${s.eligible_players.length} players eligible</div>
    </div>`;

  const eligible=new Set(s.eligible_players);
  const rest=PLAYERS.filter(p=>!eligible.has(p));

  ['vote-mom','vote-dod'].forEach(id=>{
    const sel=document.getElementById(id);
    const placeholder=id==='vote-mom'?'— Pick your MOM —':'— Pick your DOD —';
    sel.innerHTML=`<option value="">${placeholder}</option>`;
    if(s.eligible_players.length){
      const og=document.createElement('optgroup');og.label='Played this match';
      s.eligible_players.forEach(p=>{const o=document.createElement('option');o.value=o.textContent=p;og.appendChild(o);});
      sel.appendChild(og);
    }
    if(rest.length){
      const og2=document.createElement('optgroup');og2.label='Other squad members';
      rest.forEach(p=>{const o=document.createElement('option');o.value=o.textContent=p;og2.appendChild(o);});
      sel.appendChild(og2);
    }
  });

  document.getElementById('vote-mom').value='';
  document.getElementById('vote-dod').value='';
  document.getElementById('vote-mom-reason').value='';
  document.getElementById('vote-dod-reason').value='';

  document.getElementById('vote-form').style.display='block';
}

async function submitVote(){
  if(!currentVoteSession)return;
  const mom=document.getElementById('vote-mom').value;
  const momReason=document.getElementById('vote-mom-reason').value.trim();
  const dod=document.getElementById('vote-dod').value;
  const dodReason=document.getElementById('vote-dod-reason').value.trim();
  const al=document.getElementById('vote-alert');
  if(!mom||!momReason||!dod||!dodReason){
    showAlert(al,'error','All four fields are required.');return;
  }
  const btn=document.getElementById('vote-submit-btn');btn.disabled=true;btn.textContent='Submitting...';
  try{
    const{error}=await sb.from('match_votes').insert({
      session_id:currentVoteSession.id,
      mom_vote:mom,
      mom_reason:momReason,
      dod_vote:dod,
      dod_reason:dodReason
    });
    if(error)throw error;
    document.getElementById('vote-form').style.display='none';
    document.getElementById('vote-done').style.display='block';
  }catch(e){
    showAlert(al,'error','Failed: '+e.message);
    btn.disabled=false;btn.textContent='Submit Vote (Anonymous)';
  }
}

// ── TEAMSHEET ─────────────────────────────────────────────────
async function loadTsSquad(){
  document.getElementById('ts-squad-hint').textContent='Loading players...';
  const{data:players,error}=await sb.from('players').select('name,role').eq('active',true).order('sort_order',{ascending:true});
  if(error||!players){document.getElementById('ts-squad-hint').textContent='Failed to load players.';return;}
  tsSquad=players.map(p=>({name:p.name,role:p.role,selected:false}));
  document.getElementById('ts-squad-hint').textContent='Tick players playing this week. GK = #1, captain = ©, players from #3 up.';
  const{data:fixtures}=await sb.from('fixtures').select('id,match_date,opponent,venue,kick_off_time').is('result',null).eq('season',currentSeason).order('match_date',{ascending:true});
  const sel=document.getElementById('ts-fixture-sel');
  sel.innerHTML='<option value="">— Select fixture —</option>';
  (fixtures||[]).forEach(f=>{
    const d=new Date(f.match_date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    const o=document.createElement('option');
    o.value=JSON.stringify({date:f.match_date,opponent:f.opponent,venue:f.venue||'',time:f.kick_off_time||''});
    o.textContent=`${d} — ${f.opponent}`;
    sel.appendChild(o);
  });
  renderTsSquadList();
  tsRenderPreview();
  tsSetMode('present');
}

function renderTsSquadList(){
  const list=document.getElementById('ts-squadList');
  list.innerHTML='';
  tsSquad.forEach((p,idx)=>{
    const row=document.createElement('div');
    row.className='ts-squad-row'+(p.selected?' selected':'');
    row.style.cursor='pointer';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=p.selected;
    cb.addEventListener('change',()=>{tsSquad[idx].selected=cb.checked;row.classList.toggle('selected',cb.checked);tsupdateCount();tsRenderPreview();});
    row.addEventListener('click',(e)=>{
      if(e.target===cb||e.target.tagName==='SELECT')return;
      cb.checked=!cb.checked;cb.dispatchEvent(new Event('change'));
    });
    const nm=document.createElement('span');nm.className='ts-squad-name';nm.textContent=p.name;
    const rs=document.createElement('select');rs.className='ts-squad-role-select';
    ['player','gk','cap'].forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r==='gk'?'GK':r==='cap'?'Captain':'Player';if(p.role===r)o.selected=true;rs.appendChild(o);});
    rs.addEventListener('change',()=>{tsSquad[idx].role=rs.value;tsRenderPreview();});
    row.appendChild(cb);row.appendChild(nm);row.appendChild(rs);
    list.appendChild(row);
  });
  tsupdateCount();
}

function tsupdateCount(){
  const n=tsSquad.filter(p=>p.selected).length;
  document.getElementById('ts-selectedCount').textContent=n+' selected for this week';
}

function onTsFixtureSelect(){
  const sel=document.getElementById('ts-fixture-sel');
  if(!sel.value)return;
  const{date,opponent,venue,time}=JSON.parse(sel.value);
  document.getElementById('ts-e-opposition').value=opponent;
  document.getElementById('ts-e-venue').value=venue;
  sel.dataset.pushback=time||'';
  sel.dataset.date=date;
  tsRenderPreview();
}

function tsRenderPreview(){
  const sel=document.getElementById('ts-fixture-sel');
  const raw=sel&&sel.dataset.date?sel.dataset.date:'';
  const comp=document.getElementById('ts-e-comp').value;
  let dateStr='';
  if(raw){
    const d=new Date(raw+'T00:00:00');
    const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
    dateStr=days[d.getDay()]+' · '+d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
  }
  document.getElementById('ts-v-date').textContent=dateStr+(comp?' · '+comp:'');
  document.getElementById('ts-v-opposition').textContent=document.getElementById('ts-e-opposition').value||'Opposition';
  document.getElementById('ts-v-meet').textContent=document.getElementById('ts-e-meet').value||'TBC';
  const pushback=sel&&sel.dataset.pushback?sel.dataset.pushback:'';
  const pbWrap=document.getElementById('ts-v-pushback-wrap');
  if(pushback){pbWrap.style.display='inline-block';document.getElementById('ts-v-pushback').textContent=pushback;}
  else{pbWrap.style.display='none';}
  document.getElementById('ts-v-venue').textContent=document.getElementById('ts-e-venue').value||'TBC';
  document.getElementById('ts-v-ha').textContent=document.getElementById('ts-e-ha').value;
  document.getElementById('ts-v-fee').textContent=document.getElementById('ts-e-fee').value;
  document.getElementById('ts-v-sweets').textContent=document.getElementById('ts-e-sweets').value;
  document.getElementById('ts-v-fine').textContent=document.getElementById('ts-e-fine').value;
  document.getElementById('ts-v-ump').textContent=document.getElementById('ts-e-ump').value;
  document.getElementById('ts-v-umpLabel').textContent=document.getElementById('ts-e-umpLabel').value;
  const hl=document.getElementById('ts-e-homeLogo').value;
  document.getElementById('ts-v-homeLogo').src=hl;
  document.getElementById('ts-e-homeLogoPreview').src=hl;
  const al=document.getElementById('ts-e-awayLogo').value;
  document.getElementById('ts-v-awayLogo').src=al;
  document.getElementById('ts-e-awayLogoPreview').src=al;
  const kitParts=document.getElementById('ts-e-kit').value.split('|');
  document.getElementById('ts-v-kit').textContent=kitParts[0];
  const pips=document.getElementById('ts-v-kitpips');pips.innerHTML='';
  [kitParts[1],kitParts[2],kitParts[3]].forEach(c=>{const pip=document.createElement('div');pip.className='ts-kit-pip';pip.style.background=c;if(c==='#ffffff')pip.style.border='1px solid #ccc';pips.appendChild(pip);});
  const playing=tsSquad.filter(p=>p.selected&&p.name.trim());
  const ordered=[...playing.filter(p=>p.role==='gk'),...playing.filter(p=>p.role==='cap'),...playing.filter(p=>p.role==='player')];
  const grid=document.getElementById('ts-v-players');grid.innerHTML='';
  let num=3;
  ordered.forEach(p=>{
    const div=document.createElement('div');div.className='ts-player';
    let bc='ts-pnum',bt,tag='';
    if(p.role==='gk'){bc='ts-pnum gk';bt='1';tag='<span class="ts-ptag">goalkeeper</span>';}
    else if(p.role==='cap'){bc='ts-pnum cap';bt='©';tag='<span class="ts-ptag">captain</span>';}
    else{bt=num++;}
    div.innerHTML=`<div class="${bc}">${bt}</div><span class="ts-pname">${p.name}</span>${tag}`;
    grid.appendChild(div);
  });
  const cnt=ordered.length;
  document.getElementById('ts-v-count').textContent=cnt+' player'+(cnt!==1?'s':'');
}

function tsSetMode(mode){
  const sheet=document.getElementById('ts-sheet');
  const panel=document.getElementById('ts-editPanel');
  const btnE=document.getElementById('ts-btnEdit');
  const btnP=document.getElementById('ts-btnPresent');
  if(mode==='edit'){
    panel.classList.add('visible');sheet.style.display='none';
    btnE.classList.add('active');btnP.classList.remove('active');
  } else {
    tsRenderPreview();
    panel.classList.remove('visible');sheet.style.display='block';
    btnP.classList.add('active');btnE.classList.remove('active');
  }
}

document.getElementById('ts-editPanel').addEventListener('input',()=>tsRenderPreview());
document.getElementById('ts-editPanel').addEventListener('change',()=>tsRenderPreview());

// ── STEPPER ───────────────────────────────────────────────────
function makeStepper(cls,tint){
  const wrap=document.createElement('div');wrap.className='stepper'+(tint?' '+tint:'');
  const minus=document.createElement('button');minus.type='button';minus.className='stepper-btn';minus.textContent='−';
  const val=document.createElement('span');val.className='stepper-val';val.textContent='0';val.dataset.cls=cls;
  const plus=document.createElement('button');plus.type='button';plus.className='stepper-btn';plus.textContent='+';
  minus.addEventListener('click',()=>{const v=Math.max(0,parseInt(val.textContent)-1);val.textContent=v;val.classList.toggle('nonzero',v>0);if(cls==='p-goals')updateGoalsTally();});
  plus.addEventListener('click',()=>{const v=parseInt(val.textContent)+1;val.textContent=v;val.classList.toggle('nonzero',v>0);if(cls==='p-goals')updateGoalsTally();});
  wrap.appendChild(minus);wrap.appendChild(val);wrap.appendChild(plus);return wrap;
}
function getVal(row,cls){const el=row.querySelector(`[data-cls="${cls}"]`);return el?parseInt(el.textContent)||0:0;}
function updateGoalsTally(){let t=0;document.querySelectorAll('#prows tr').forEach(r=>{if(r.querySelector('.p-played').checked)t+=getVal(r,'p-goals');});document.getElementById('m-gf').value=t;}
function toggleHideNotPlaying(){const hide=document.getElementById('hide-not-playing').checked;document.querySelectorAll('#prows tr').forEach(tr=>{const playing=tr.querySelector('.p-played').checked;tr.classList.toggle('hidden-row',hide&&!playing);});}

// ── INIT ──────────────────────────────────────────────────────
async function init(){
  populateSeasonDropdown();
  await loadPlayersFromDB();
  if(!PLAYERS.length){
    console.error('No players loaded from database. App will have empty dropdowns.');
  }
  ['fine-player','m-mom','m-dod'].forEach(id=>{
    const sel=document.getElementById(id);
    sel.innerHTML='<option value="">— Select —</option>';
    PLAYERS.forEach(p=>{const o=document.createElement('option');o.value=o.textContent=p;sel.appendChild(o);});
  });
  const tbody=document.getElementById('prows');
  PLAYERS.forEach(p=>{
    const tr=document.createElement('tr');tr.dataset.player=p;
    const tdName=document.createElement('td');
    const cb=document.createElement('input');cb.type='checkbox';cb.className='p-played';
    cb.style.cssText='width:15px;height:15px;accent-color:var(--pink);cursor:pointer;vertical-align:middle;margin-right:7px;';
    cb.addEventListener('change',()=>{updateGoalsTally();if(document.getElementById('hide-not-playing').checked)toggleHideNotPlaying();});
    const ns=document.createElement('span');ns.style.cssText='font-size:12px;font-weight:600;color:#fff;vertical-align:middle;';ns.textContent=p;
    tdName.appendChild(cb);tdName.appendChild(ns);tr.appendChild(tdName);
    [['p-mom',''],['p-dod',''],['p-goals',''],['p-assists',''],['p-green','green-s'],['p-yellow','yellow-s'],['p-red','red-s']].forEach(([cls,tint])=>{const td=document.createElement('td');td.appendChild(makeStepper(cls,tint));tr.appendChild(td);});
    tbody.appendChild(tr);
  });
  loadPwHashes();
  loadStats();
}

// ── FIXTURE DROPDOWN (Quick Entry tab) ─────────────────────
async function loadFixtureDropdown(){
  const{data}=await sb.from('fixtures').select('id,match_date,opponent,result,season').eq('season',currentSeason).order('match_date',{ascending:true});
  if(!data)return;
  const sel=document.getElementById('m-fixture');sel.innerHTML='<option value="">— Select fixture —</option>';
  data.forEach(f=>{const d=new Date(f.match_date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});const opt=document.createElement('option');opt.value=f.id;opt.textContent=`${d} — ${f.opponent}${f.result?' ('+f.result+')':''}`;sel.appendChild(opt);});
}
function onFixtureSelect(){updateGoalsTally();}

// ══════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════

async function loadStats(){
  document.getElementById('stats-loading').style.display='block';
  document.getElementById('stats-wrap').style.display='none';
  removeStatsExtras();

  try{
    const [statsRes,fixtureRes]=await Promise.all([
      sb.from('player_stats_view').select('*').eq('season',currentSeason),
      sb.from('fixtures').select('id',{count:'exact',head:true}).eq('season',currentSeason).not('result','is',null)
    ]);
    if(statsRes.error)throw statsRes.error;

    statsData=statsRes.data||[];
    completedFixturesCount=fixtureRes.count||0;
    thresholdActive=completedFixturesCount>=10;
    minAppsThreshold=thresholdActive?Math.ceil(completedFixturesCount*0.2):0;

    renderStats(currentSort);
  }catch(e){
    console.error('Stats load failed:',e);
    document.getElementById('stats-loading').innerHTML=`<p style="color:#f44336">Failed.</p>`;
  }
}

function removeStatsExtras(){
  const hero=document.getElementById('stats-leader-hero');if(hero)hero.remove();
  const pill=document.getElementById('stats-threshold-pill');if(pill)pill.remove();
}

function sortStats(col,btn){
  currentSort=col;
  const tabMap={ppg:0,goals:1,assists:2,appearances:3};
  if(tabMap.hasOwnProperty(col)){
    const tabs=document.querySelectorAll('.sort-tab');
    tabs.forEach((b,i)=>b.classList.toggle('active',i===tabMap[col]));
  } else {
    document.querySelectorAll('.sort-tab').forEach(b=>b.classList.remove('active'));
  }
  renderStats(col);
}

function getSortValue(row,col){
  if(col==='goals_plus_assists')return (parseInt(row.goals)||0)+(parseInt(row.assists)||0);
  return parseFloat(row[col])||0;
}

function getInitials(name){
  const parts=name.trim().split(/\s+/);
  if(parts.length===1)return parts[0].substring(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
}

function renderLeaderHero(leader,col){
  const existing=document.getElementById('stats-leader-hero');if(existing)existing.remove();
  if(!leader)return;
  const info=SORT_LABELS[col]||{label:'Leader',unit:''};
  const val=getSortValue(leader,col);
  const displayVal=col==='ppg'?val.toFixed(2):Math.round(val);
  const hero=document.createElement('div');
  hero.className='leader-hero';
  hero.id='stats-leader-hero';
  hero.innerHTML=`
    <div class="lh-avatar">${getInitials(leader.player_name)}</div>
    <div class="lh-body">
      <div class="lh-label"><span class="lh-crown">👑</span> ${info.label}</div>
      <div class="lh-name">${leader.player_name}</div>
      <div class="lh-sub">${leader.appearances||0} app${(leader.appearances||0)!==1?'s':''} · ${leader.goals||0}G ${leader.assists||0}A</div>
    </div>
    <div class="lh-stat">
      <div class="lh-stat-val">${displayVal}</div>
      <div class="lh-stat-label">${info.unit}</div>
    </div>`;
  const tabsBar=document.querySelector('#sec-stats .sort-tabs');
  tabsBar.parentNode.insertBefore(hero,tabsBar);
}

function renderThresholdPill(){
  const existing=document.getElementById('stats-threshold-pill');if(existing)existing.remove();
  if(!thresholdActive)return;
  const pill=document.createElement('div');
  pill.className='threshold-pill';
  pill.id='stats-threshold-pill';
  pill.innerHTML=`ℹ Min apps threshold: <strong style="margin-left:3px">${minAppsThreshold}</strong><span style="margin-left:4px;color:#666">(20% of ${completedFixturesCount} played)</span>`;
  const wrap=document.getElementById('stats-wrap');
  wrap.parentNode.insertBefore(pill,wrap);
}

function renderStats(col){
  document.getElementById('stats-loading').style.display='none';
  document.getElementById('stats-wrap').style.display='block';

  const qualified=[];
  const unqualified=[];
  statsData.forEach(r=>{
    const apps=parseInt(r.appearances)||0;
    if(thresholdActive && apps<minAppsThreshold){
      unqualified.push(r);
    } else {
      qualified.push(r);
    }
  });

  const sortFn=(a,b)=>getSortValue(b,col)-getSortValue(a,col);
  qualified.sort(sortFn);
  unqualified.sort(sortFn);

  const topG=qualified.length?Math.max(...qualified.map(r=>parseInt(r.goals)||0)):0;
  const topA=qualified.length?Math.max(...qualified.map(r=>parseInt(r.assists)||0)):0;
  const topSortVal=qualified.length?Math.max(...qualified.map(r=>getSortValue(r,col)),0):0;

  renderThresholdPill();
  renderLeaderHero(qualified[0],col);

  document.querySelectorAll('.stats-table th').forEach((th,idx)=>{
    th.classList.toggle('sort-active',idx===SORT_COL_TO_IDX[col]);
  });

  const tbody=document.getElementById('stats-tbody');tbody.innerHTML='';

  if(!qualified.length && !unqualified.length){
    tbody.innerHTML='<tr><td colspan="10" class="empty">No stats yet.</td></tr>';
    return;
  }

  function renderRow(r,rank,isUnqualified){
    const g=parseInt(r.goals)||0,a=parseInt(r.assists)||0,ppg=parseFloat(r.ppg||0);
    const apps=parseInt(r.appearances)||0;
    const totalPts=parseInt(r.total_points)||0;
    const momWins=parseInt(r.mom_wins)||0;
    const dodWins=parseInt(r.dod_wins)||0;
    const gPlusA=g+a;
    const isTopG=!isUnqualified&&g>0&&g===topG;
    const isTopA=!isUnqualified&&a>0&&a===topA;

    let rNum;
    if(isUnqualified){
      rNum=`<span class="rank-n">—</span>`;
    } else if(rank===1){
      rNum=`<span class="rank rank-1">1</span>`;
    } else if(rank===2){
      rNum=`<span class="rank rank-2">2</span>`;
    } else if(rank===3){
      rNum=`<span class="rank rank-3">3</span>`;
    } else {
      rNum=`<span class="rank-n">${rank}</span>`;
    }

    const badges=(isTopG?`<span class="badge-stat badge-g">⚽TOP</span>`:'')+(isTopA?`<span class="badge-stat badge-a">🎯TOP</span>`:'');
    const unqTag=isUnqualified?`<span class="unq-tag">${apps}/${minAppsThreshold} apps</span>`:'';

    const tr=document.createElement('tr');
    if(isUnqualified){
      tr.classList.add('unqualified');
    } else {
      if(isTopG&&col==='goals')tr.classList.add('top-goals');
      if(isTopA&&col==='assists')tr.classList.add('top-assists');
    }

    const cells=[
      {html:rNum,idx:1},
      {html:`${r.player_name}${badges}${unqTag}`,idx:2},
      {html:apps,idx:3,sortCol:'appearances'},
      {html:totalPts,idx:4,sortCol:'total_points'},
      {html:g,idx:5,sortCol:'goals'},
      {html:a,idx:6,sortCol:'assists'},
      {html:gPlusA,idx:7,sortCol:'goals_plus_assists'},
      {html:momWins,idx:8,sortCol:'mom_wins'},
      {html:dodWins,idx:9,sortCol:'dod_wins'},
      {html:`<span class="ppg-val">${ppg.toFixed(2)}</span>`,idx:10,sortCol:'ppg'}
    ];

    cells.forEach(c=>{
      const td=document.createElement('td');
      td.innerHTML=c.html;
      if(c.sortCol===col){
        td.classList.add('sort-active');
        if(!isUnqualified && topSortVal>0){
          const thisVal=getSortValue(r,col);
          const pct=Math.max(0,Math.min(100,(thisVal/topSortVal)*100));
          const bar=document.createElement('span');
          bar.className='bar-wrap';
          bar.innerHTML=`<span class="bar-fill" style="width:${pct}%"></span>`;
          td.appendChild(bar);
        }
      }
      tr.appendChild(td);
    });

    return tr;
  }

  qualified.forEach((r,i)=>tbody.appendChild(renderRow(r,i+1,false)));

  if(qualified.length && unqualified.length){
    const divRow=document.createElement('tr');
    divRow.className='divider-row';
    divRow.innerHTML=`<td colspan="10"><span class="divider-text">Below minimum apps threshold (${minAppsThreshold} apps required)</span></td>`;
    tbody.appendChild(divRow);
  }

  unqualified.forEach(r=>tbody.appendChild(renderRow(r,null,true)));

  document.querySelectorAll('.stats-table th').forEach((th,idx)=>{
    th.onclick=()=>{
      const entry=Object.entries(SORT_COL_TO_IDX).find(([,i])=>i===idx);
      if(entry){
        sortStats(entry[0],null);
      }
    };
  });

  const wrap=document.querySelector('.stats-wrap');
  if(wrap && !wrap.dataset.scrollBound){
    wrap.addEventListener('scroll',()=>{
      wrap.classList.toggle('is-scrolled',wrap.scrollLeft>0);
    });
    wrap.dataset.scrollBound='1';
  }
}

// ══════════════════════════════════════════════════════════
// FIXTURES
// ══════════════════════════════════════════════════════════
async function loadFixtures(){
  document.getElementById('fix-loading').style.display='block';
  document.getElementById('fix-list').innerHTML='';
  try{
    const{data,error}=await sb.from('fixtures').select('*').eq('season',currentSeason).order('match_date',{ascending:false});
    if(error)throw error;
    renderFixtures(data||[]);
  }catch(e){document.getElementById('fix-loading').innerHTML=`<p style="color:#f44336">Failed.</p>`;}
}
function renderFixtures(rows){
  document.getElementById('fix-loading').style.display='none';
  const list=document.getElementById('fix-list');
  if(!rows.length){list.innerHTML='<p class="empty">No fixtures yet.</p>';return;}
  rows.forEach(r=>{
    const d=new Date(r.match_date);
    const day=d.toLocaleDateString('en-GB',{weekday:'short'});
    const num=d.getDate();
    const mon=d.toLocaleDateString('en-GB',{month:'short'});
    const isPast=!!r.result;
    const div=document.createElement('div');div.className='fixture-item';
    div.innerHTML=`
      <div class="fixture-date-col"><div class="fix-day">${day}</div><div class="fix-num">${num}</div><div class="fix-mon">${mon}</div></div>
      <div class="fixture-right">
        <div class="fixture-meta">${r.kick_off_time?`<span>🕐 ${r.kick_off_time}</span>`:''}${r.venue?`<span>📍 ${r.venue}</span>`:''}</div>
        <div class="fixture-opponent">${isPast?`<span class="fixture-score">${r.whc_goals}–${r.opp_goals}</span>`:''}${r.opponent}${isPast?`<span class="badge badge-${r.result}">${r.result}</span>`:'<span class="upcoming-tag">Upcoming</span>'}</div>
        ${r.mom?`<div class="fixture-awards">⭐ ${r.mom} &nbsp;·&nbsp; 💩 ${r.dod||'—'}</div>`:''}
      </div>`;
    div.addEventListener('click',()=>openFixtureDetail(r));
    list.appendChild(div);
  });
}

async function openFixtureDetail(r){
  const overlay=document.getElementById('fix-detail-overlay');
  const body=document.getElementById('fix-detail-body');
  body.innerHTML='<div class="loading" style="padding-top:60px"><div class="spinner"></div><br>Loading...</div>';
  overlay.classList.add('open');
  document.body.style.overflow='hidden';

  const d=new Date(r.match_date);
  const dateStr=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const isPast=!!r.result;

  const{data:players}=await sb.from('match_stats').select('*').eq('fixture_id',r.id).order('goals',{ascending:false});
  const pts=players||[];

  let scoreHtml='';
  if(isPast){
    const sc=r.result;
    scoreHtml=`
      <div class="fsh-score score-${sc}">${r.whc_goals} — ${r.opp_goals}</div>
      <div class="fsh-result score-${sc}">${sc==='W'?'Victory':sc==='L'?'Defeat':'Draw'}</div>`;
  } else {
    scoreHtml=`<div class="fsh-score score-upcoming">vs</div><div style="font-size:12px;color:#555;margin-top:4px">Upcoming</div>`;
  }

  let awardsHtml='';
  if(r.mom||r.dod){
    awardsHtml=`<div class="fix-awards-row">
      <div class="fix-award-card mom"><div class="fac-label">Man of the Match</div><div class="fac-name">${r.mom||'—'}</div></div>
      <div class="fix-award-card dod"><div class="fac-label">Dick of the Day</div><div class="fac-name">${r.dod||'—'}</div></div>
    </div>`;
  }

  let playersHtml='';
  if(pts.length){
    const rows=pts.map(p=>{
      const isMom=r.mom&&p.player_name===r.mom;
      const isDod=r.dod&&p.player_name===r.dod;
      const cards=[
        ...Array(p.green_cards||0).fill('<span class="fpr-card green"></span>'),
        ...Array(p.yellow_cards||0).fill('<span class="fpr-card yellow"></span>'),
        ...Array(p.red_cards||0).fill('<span class="fpr-card red"></span>'),
      ].join('');
      const g=p.goals||0,a=p.assists||0;
      return `<div class="fix-player-row${isMom?' is-mom':''}${isDod?' is-dod':''}">
        <span class="fpr-name">${p.player_name}${isMom?'<span class="fpr-badge mom">MOM</span>':''}${isDod?'<span class="fpr-badge dod">DOD</span>':''}</span>
        <div class="fpr-stats">
          <div class="fpr-stat${g>0?' has-val':''}"><span>${g}</span><span>Goals</span></div>
          <div class="fpr-stat${a>0?' has-val':''}"><span>${a}</span><span>Asts</span></div>
          <div class="fpr-stat" style="min-width:36px">${cards||'<span style="color:#333;font-size:11px">—</span>'}</div>
        </div>
      </div>`;
    }).join('');
    playersHtml=`<div class="fix-players-section"><h3>Squad</h3>${rows}</div>`;
  } else if(isPast){
    playersHtml=`<div class="fix-players-section"><p class="empty" style="padding:16px 0">No player stats recorded.</p></div>`;
  }

  body.innerHTML=`
    <div class="fix-score-hero">
      <div class="fsh-date">${dateStr}</div>
      <div class="fsh-opponent">${r.opponent}</div>
      ${scoreHtml}
      <div class="fsh-meta">
        ${r.venue?`<span>📍 ${r.venue}</span>`:''}
        ${r.kick_off_time?`<span>🕐 ${r.kick_off_time}</span>`:''}
      </div>
    </div>
    ${awardsHtml}
    ${playersHtml}`;
}

function closeFixtureDetail(){
  const overlay=document.getElementById('fix-detail-overlay');
  const panel=document.getElementById('fix-detail-panel');
  panel.style.transform='scale(0.92)';panel.style.opacity='0';
  setTimeout(()=>{overlay.classList.remove('open');panel.style.transform='';panel.style.opacity='';document.body.style.overflow='';},280);
}

// ── FINE ──────────────────────────────────────────────────────
async function loadFines(){
  document.getElementById('fines-loading').style.display='block';
  document.getElementById('fines-list').innerHTML='';
  try{
    const{data,error}=await sb.from('fines').select('*').eq('season',currentSeason).order('created_at',{ascending:false}).limit(40);
    if(error)throw error;
    document.getElementById('fines-loading').style.display='none';
    const list=document.getElementById('fines-list');
    if(!data.length){list.innerHTML='<p class="empty">No fines yet.</p>';return;}
    data.forEach(r=>{
      const d=new Date(r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      const div=document.createElement('div');div.className='fine-item';
      div.innerHTML=`<div class="fi-player">${r.player_name}</div><div class="fi-desc">${r.description}</div><div class="fi-date">${d}${r.submitted_by?' · '+r.submitted_by:''}</div>`;
      list.appendChild(div);
    });
  }catch(e){document.getElementById('fines-loading').innerHTML=`<p style="color:#f44336">Failed.</p>`;}
}
async function submitFine(){
  const player=document.getElementById('fine-player').value;
  const desc=document.getElementById('fine-desc').value.trim();
  const by=document.getElementById('fine-by').value.trim();
  const al=document.getElementById('fine-alert');
  if(!player||!desc){showAlert(al,'error','Select a player and enter a description.');return;}
  const btn=document.querySelector('#sec-fine .submit-btn');btn.disabled=true;
  try{
    const{error}=await sb.from('fines').insert({player_name:player,description:desc,submitted_by:by||'Anonymous',season:currentSeason});
    if(error)throw error;
    showAlert(al,'success',`Fine submitted against ${player}!`);
    document.getElementById('fine-desc').value='';document.getElementById('fine-by').value='';document.getElementById('fine-player').value='';
    loadFines();
  }catch(e){showAlert(al,'error','Failed: '+e.message);}
  btn.disabled=false;
}

// ── MATCH (Quick Entry) ──────────────────────────────────────
async function submitMatch(){
  const fixId=document.getElementById('m-fixture').value;
  const gf=parseInt(document.getElementById('m-gf').value)||0;
  const ga=parseInt(document.getElementById('m-ga').value)||0;
  const mom=document.getElementById('m-mom').value;
  const dod=document.getElementById('m-dod').value;
  const al=document.getElementById('match-alert');
  if(!fixId){showAlert(al,'error','Please select a fixture.');return;}
  const btn=document.querySelector('#cp-quickstats .submit-btn');btn.disabled=true;btn.textContent='Saving...';
  const result=gf>ga?'W':gf<ga?'L':'D';
  const pts=result==='W'?3:result==='D'?1:0;
  try{
    const{error:fe}=await sb.from('fixtures').update({whc_goals:gf,opp_goals:ga,result,match_points:pts,mom:mom||null,dod:dod||null}).eq('id',fixId);
    if(fe)throw fe;
    const rows=document.querySelectorAll('#prows tr');const inserts=[];
    rows.forEach(row=>{
      if(!row.querySelector('.p-played').checked)return;
      inserts.push({fixture_id:parseInt(fixId),player_name:row.dataset.player,season:currentSeason,goals:getVal(row,'p-goals'),assists:getVal(row,'p-assists'),mom_votes:getVal(row,'p-mom'),dod_votes:getVal(row,'p-dod'),green_cards:getVal(row,'p-green'),yellow_cards:getVal(row,'p-yellow'),red_cards:getVal(row,'p-red'),match_points:pts,is_mom:row.dataset.player===mom,is_dod:row.dataset.player===dod});
    });
    if(inserts.length){const{error:se}=await sb.from('match_stats').insert(inserts);if(se)throw se;}
    showAlert(al,'success',`Match saved! ${inserts.length} players recorded.`);
    document.getElementById('m-fixture').value='';document.getElementById('m-gf').value='0';document.getElementById('m-ga').value='0';document.getElementById('m-mom').value='';document.getElementById('m-dod').value='';
    document.querySelectorAll('#prows tr').forEach(r=>{r.querySelector('.p-played').checked=false;r.querySelectorAll('.stepper-val').forEach(v=>{v.textContent='0';v.classList.remove('nonzero');});r.classList.remove('hidden-row');});
    document.getElementById('hide-not-playing').checked=false;
  }catch(e){showAlert(al,'error','Failed: '+e.message);}
  btn.disabled=false;btn.textContent='Save Match';
}

// ── PASSWORD ──────────────────────────────────────────────────
async function loadPwHashes(){
  const{data}=await sb.from('app_settings').select('key,value').in('key',['meeting_password_hash','captain_password_hash']);
  if(data){
    data.forEach(r=>{
      if(r.key==='meeting_password_hash')meetingPwHash=r.value;
      if(r.key==='captain_password_hash')captainPwHash=r.value;
    });
  }
}
async function hashString(str){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function checkPw(){
  const input=document.getElementById('pw-in').value;
  if(!input)return;
  if(!meetingPwHash){document.getElementById('pw-err').textContent='Could not load — try again.';return;}
  const hashed=await hashString(input);
  if(hashed===meetingPwHash){document.getElementById('pw-wrap').style.display='none';document.getElementById('meeting-content').style.display='block';}
  else{document.getElementById('pw-err').textContent='Incorrect password.';}
}

// ── PREDICTIONS ───────────────────────────────────────────────
async function loadPredictions(){
  document.getElementById('pred-loading').style.display='block';
  try{
    const{data}=await sb.from('player_stats_view').select('*').eq('season',currentSeason);
    const actuals={};(data||[]).forEach(r=>actuals[r.player_name]=r);
    const tbody=document.getElementById('pred-tbody');tbody.innerHTML='';
    Object.entries(PREDICTIONS).forEach(([name,pred])=>{
      const act=actuals[name]||{goals:0,assists:0,appearances:0};
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${name}</td>${dc(pred.g,act.goals)}${dc(pred.a,act.assists)}${dc(pred.app,act.appearances)}`;
      tbody.appendChild(tr);
    });
    document.getElementById('pred-loading').style.display='none';
    document.getElementById('pred-wrap').style.display='block';
  }catch(e){document.getElementById('pred-loading').innerHTML=`<p style="color:#f44336">Failed.</p>`;}
}
function dc(pred,actual){
  const diff=actual-pred,cls=diff>0?'over':diff<0?'under':'exact',sign=diff>0?'+':'';
  return `<td>${pred}</td><td class="${cls}">${actual} <span style="font-size:10px">(${sign}${diff})</span></td>`;
}

// ── IND FINES ─────────────────────────────────────────────────
async function renderIndFines(){
  const grid=document.getElementById('ind-fines-grid');grid.innerHTML='';
  // All fines now live in the DB, season-scoped.
  const{data}=await sb.from('fines').select('player_name,description,submitted_by').eq('season',currentSeason).order('created_at',{ascending:true});
  const rows=data||[];
  if(!rows.length){
    grid.innerHTML='<p class="empty">No individual fines recorded for '+currentSeason+' yet.</p>';
    return;
  }
  // Group by player_name, preserving DB order within each group
  const byPlayer={};
  rows.forEach(r=>{
    if(!byPlayer[r.player_name])byPlayer[r.player_name]=[];
    byPlayer[r.player_name].push(r);
  });
  Object.keys(byPlayer).forEach(name=>{
    const fines=byPlayer[name];
    const card=document.createElement('div');card.className='player-card';
    const items=fines.map(f=>{
      // Distinguish live-submitted fines from pre-loaded ones (italic + pink)
      const isLive=f.submitted_by&&f.submitted_by!=='Pre-loaded';
      return isLive
        ?`<li style="color:var(--pink);font-style:italic">📱 ${escapeHtml(f.description)}</li>`
        :`<li>${escapeHtml(f.description)}</li>`;
    }).join('');
    card.innerHTML=`<div class="pcard-name">🏑 ${escapeHtml(name)}</div><ul>${items}</ul>`;
    grid.appendChild(card);
  });
}

// ── WHEEL ─────────────────────────────────────────────────────
const SEGS=[{text:'1 Shot',bg:'#1a2a4a',fg:'#fff'},{text:'Down Your Drink',bg:'#f0f4ff',fg:'#1a2a4a'},{text:'2 Fingers',bg:'#1a2a4a',fg:'#fff'},{text:'Buy a Jug of Snakebite',bg:'#f0f4ff',fg:'#1a2a4a'},{text:'Nominate 10 Fingers',bg:'#1a2a4a',fg:'#fff'},{text:'Silence for 10 Mins',bg:'#f0f4ff',fg:'#1a2a4a'},{text:'Spin Again',bg:'#1a2a4a',fg:'#fff'},{text:'Eat 3 Crackers',bg:'#f0f4ff',fg:'#1a2a4a'},{text:'Eat 5 Crackers',bg:'#1a2a4a',fg:'#fff'},{text:'You Host a Fine',bg:'#f0f4ff',fg:'#1a2a4a'},{text:'Pint in the Sauna',bg:'#1a2a4a',fg:'#fff'},{text:'Most Impressive (5m)',bg:'#f0f4ff',fg:'#1a2a4a'},{text:'Something Spicy',bg:'#1a2a4a',fg:'#fff'},{text:'Mystery Box',bg:'#f0f4ff',fg:'#1a2a4a'},{text:'Person Right — 2 Shots',bg:'#1a2a4a',fg:'#fff'},{text:'Neck a Buzz Ball',bg:'#f0f4ff',fg:'#1a2a4a'},{text:'YARD 🍺',bg:'#cc1a1a',fg:'#fff'}];
const NARC=SEGS.length,WARC=(2*Math.PI)/NARC;
function initWheel(){const c=document.getElementById('wheel-canvas');const s=c.parentElement.clientWidth||480;c.width=s;c.height=s;drawWheel(wheelAngle);wheelReady=true;}
function drawWheel(a){
  const c=document.getElementById('wheel-canvas');if(!c)return;
  const ctx=c.getContext('2d'),S=c.width,cx=S/2,cy=S/2,r=S/2-4;
  ctx.clearRect(0,0,S,S);
  for(let i=0;i<NARC;i++){
    const seg=SEGS[i],st=a+i*WARC,en=st+WARC;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,st,en);ctx.closePath();
    ctx.fillStyle=seg.bg;ctx.fill();ctx.strokeStyle='#000';ctx.lineWidth=1.5;ctx.stroke();
    ctx.save();ctx.translate(cx,cy);ctx.rotate(st+WARC/2);ctx.textAlign='right';
    ctx.fillStyle=seg.fg;const fs=Math.max(10,Math.floor(S/44));
    ctx.font=`700 ${fs}px 'Outfit',sans-serif`;ctx.shadowColor='rgba(0,0,0,0.5)';ctx.shadowBlur=2;
    ctx.fillText(seg.text,r-10,fs/3);ctx.restore();
  }
  ctx.beginPath();ctx.arc(cx,cy,S*0.038,0,2*Math.PI);ctx.fillStyle='#0a0a14';ctx.fill();ctx.strokeStyle='#E8547A';ctx.lineWidth=3;ctx.stroke();
  const pw=S*0.025,ph=S*0.06;
  ctx.beginPath();ctx.moveTo(cx,cy-r+ph);ctx.lineTo(cx-pw,cy-r-4);ctx.lineTo(cx+pw,cy-r-4);ctx.closePath();ctx.fillStyle='#E8547A';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();
}
function getACtx(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();return audioCtx;}
function stopSpin(){spinNodes.forEach(n=>{try{n.disconnect();}catch(e){}});spinNodes=[];}
function startSpinSound(){
  stopSpin();const ctx=getACtx();
  const buf=ctx.createBuffer(1,ctx.sampleRate*0.02,ctx.sampleRate);const d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.exp(-i/(ctx.sampleRate*0.005));
  const mg=ctx.createGain();mg.gain.setValueAtTime(0.3,ctx.currentTime);mg.connect(ctx.destination);spinNodes.push(mg);
  let t=ctx.currentTime+0.05,interval=0.04,ticks=0;
  while(t<ctx.currentTime+8){
    const src=ctx.createBufferSource();src.buffer=buf;const g=ctx.createGain();const prog=(t-ctx.currentTime)/8;
    g.gain.setValueAtTime(prog>0.85?(1-prog)*6:1,t);src.connect(g);g.connect(mg);src.start(t);spinNodes.push(src);
    interval=0.04+prog*prog*0.55;t+=interval;if(++ticks>400)break;
  }
}
function playResult(){
  const ctx=getACtx();[523,659,784,1047].forEach((f,i)=>{
    const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.value=f;
    g.gain.setValueAtTime(0,ctx.currentTime+i*0.12);g.gain.linearRampToValueAtTime(0.22,ctx.currentTime+i*0.12+0.02);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.12+0.3);
    o.connect(g);g.connect(ctx.destination);o.start(ctx.currentTime+i*0.12);o.stop(ctx.currentTime+i*0.12+0.35);
  });
}
function spinWheel(){
  if(spinning)return;if(!wheelReady)initWheel();spinning=true;
  document.getElementById('spinBtn').disabled=true;document.getElementById('wheel-result').textContent='';
  startSpinSound();
  const total=(8+Math.floor(Math.random()*4))*2*Math.PI+Math.random()*2*Math.PI;
  const dur=6000+Math.random()*2000,t0=performance.now(),startA=wheelAngle;
  function frame(now){
    const el=now-t0,prog=Math.min(el/dur,1),eased=1-Math.pow(1-prog,5);
    wheelAngle=startA+total*eased;drawWheel(wheelAngle);
    if(prog<1){requestAnimationFrame(frame);}
    else{spinning=false;document.getElementById('spinBtn').disabled=false;stopSpin();playResult();
      const norm=((-wheelAngle-Math.PI/2)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
      const idx=Math.floor(norm/WARC)%NARC;
      document.getElementById('wheel-result').textContent='🎯 '+SEGS[idx].text.toUpperCase();}
  }
  requestAnimationFrame(frame);
}

// ── DICE ──────────────────────────────────────────────────────
const DFACES=['⚀','⚁','⚂','⚃','⚄','⚅'];
const DRULES=[{n:1,t:'Get it done. Drink.'},{n:2,t:'YOU — nominate someone else to roll.'},{n:3,t:'THREE MAN. Every non-three roll = shot. New 3 = new Three Man. Shot on initial roll.'},{n:4,t:'You pour. For everyone.'},{n:5,t:'Everyone in the fives drinks.'},{n:6,t:'Fines Masters drink. Cheers lads.'}];
function rollDice(){
  const el=document.getElementById('dice-face');el.classList.remove('rolling');void el.offsetWidth;el.classList.add('rolling');
  let ticks=0;const iv=setInterval(()=>{
    el.textContent=DFACES[Math.floor(Math.random()*6)];
    if(++ticks>12){clearInterval(iv);const roll=Math.floor(Math.random()*6);el.textContent=DFACES[roll];const r=DRULES[roll];document.getElementById('dice-result').innerHTML=`<div class="result-num">${r.n}</div><div class="result-text">${r.t}</div>`;}
  },80);
}

// ══════════════════════════════════════════════════════════
// REVEAL
// ══════════════════════════════════════════════════════════

function openRevealFromVote(){
  const modal=document.getElementById('reveal-modal');
  modal.classList.add('open');
  modal.scrollTop=0;
  if(captainAuthed){
    document.getElementById('rv-pw-wrap').style.display='none';
    document.getElementById('rv-content').style.display='block';
    loadRevealFixtures();
  } else {
    document.getElementById('rv-pw-wrap').style.display='flex';
    document.getElementById('rv-content').style.display='none';
    setTimeout(()=>document.getElementById('rv-pw-in').focus(),100);
  }
}
function closeRevealModal(){
  document.getElementById('reveal-modal').classList.remove('open');
  const ov=document.getElementById('rv-overlay');
  if(ov.classList.contains('open'))ov.classList.remove('open');
  rvRevealing=false;
}
document.getElementById('reveal-modal').addEventListener('click',function(e){
  if(e.target===this)closeRevealModal();
});

async function checkRevealPw(){
  const input=document.getElementById('rv-pw-in').value;
  if(!input)return;
  if(!captainPwHash){document.getElementById('rv-pw-err').textContent='Could not load — try again.';return;}
  const hashed=await hashString(input);
  if(hashed===captainPwHash){
    captainAuthed=true;
    document.getElementById('rv-pw-wrap').style.display='none';
    document.getElementById('rv-content').style.display='block';
    loadRevealFixtures();
  } else {
    document.getElementById('rv-pw-err').textContent='Incorrect password.';
  }
}

function buildPaperBallSVG(size){
  const big=size>=200;
  const uid='pb'+Date.now()+Math.floor(Math.random()*100000)+Math.floor(Math.random()*100000);
  const cx=100,cy=100;
  const light={x:50,y:40};

  const outerN=big?14:11;
  const outerPts=[];
  for(let i=0;i<outerN;i++){
    const angle=(i/outerN)*Math.PI*2+(Math.random()-0.5)*0.25;
    const r=(big?86:82)+Math.random()*(big?10:8)-(Math.random()*(big?6:4));
    outerPts.push({x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r,a:angle});
  }
  const outlinePath='M '+outerPts.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' L ')+' Z';

  const interiorN=big?10:7;
  const interior=[];
  for(let i=0;i<interiorN;i++){
    const angle=Math.random()*Math.PI*2;
    const r=Math.random()*(big?60:55);
    interior.push({x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r});
  }
  for(let i=0;i<(big?6:5);i++){
    const angle=(i/(big?6:5))*Math.PI*2+Math.random()*0.4;
    const r=(big?50:45)+Math.random()*15;
    interior.push({x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r});
  }

  const panels=[];
  for(let i=0;i<outerPts.length;i++){
    const p1=outerPts[i];
    const p2=outerPts[(i+1)%outerPts.length];
    const mx=(p1.x+p2.x)/2,my=(p1.y+p2.y)/2;
    let best=interior[0],bestD=Infinity;
    for(const ip of interior){
      const d=(ip.x-mx)*(ip.x-mx)+(ip.y-my)*(ip.y-my);
      if(d<bestD){bestD=d;best=ip;}
    }
    panels.push([p1,p2,best]);
  }
  for(let i=0;i<interior.length;i++){
    for(let j=i+1;j<interior.length;j++){
      const a=interior[i],b=interior[j];
      const d=Math.hypot(a.x-b.x,a.y-b.y);
      if(d>(big?50:45))continue;
      let best=null,bestD=Infinity;
      for(let k=0;k<interior.length;k++){
        if(k===i||k===j)continue;
        const c=interior[k];
        const dd=Math.hypot(c.x-a.x,c.y-a.y)+Math.hypot(c.x-b.x,c.y-b.y);
        if(dd<bestD){bestD=dd;best=c;}
      }
      if(best&&bestD<(big?100:90))panels.push([a,b,best]);
    }
  }

  const paperBase=[245,235,210];
  const panelSvg=[];
  for(const pan of panels){
    const c={x:(pan[0].x+pan[1].x+pan[2].x)/3,y:(pan[0].y+pan[1].y+pan[2].y)/3};
    const distToLight=Math.hypot(c.x-light.x,c.y-light.y);
    const t=Math.min(1,distToLight/160);
    const brightness=1.05-t*0.75+(Math.random()-0.5)*0.2;
    const r=Math.max(45,Math.min(255,Math.round(paperBase[0]*brightness)));
    const g=Math.max(40,Math.min(250,Math.round(paperBase[1]*brightness)));
    const b=Math.max(30,Math.min(235,Math.round(paperBase[2]*brightness)));
    const pts=pan.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
    panelSvg.push(`<polygon points="${pts}" fill="rgb(${r},${g},${b})" stroke="rgba(70,45,15,0.5)" stroke-width="${big?0.55:0.4}" stroke-linejoin="bevel"/>`);
  }

  const creases=[];
  const creaseCount=big?9:7;
  for(let i=0;i<creaseCount;i++){
    const a=interior[Math.floor(Math.random()*interior.length)];
    const b=interior[Math.floor(Math.random()*interior.length)];
    if(a===b)continue;
    const opacity=0.25+Math.random()*0.3;
    creases.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="rgba(70,45,15,${opacity.toFixed(2)})" stroke-width="${big?0.9:0.7}" stroke-linecap="round"/>`);
  }
  const ridges=[];
  const ridgeCount=big?5:4;
  for(let i=0;i<ridgeCount;i++){
    const a=interior[Math.floor(Math.random()*interior.length)];
    const b=interior[Math.floor(Math.random()*interior.length)];
    if(a===b)continue;
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    if(Math.hypot(mx-light.x,my-light.y)>90)continue;
    ridges.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="rgba(255,253,240,0.55)" stroke-width="${big?0.7:0.5}" stroke-linecap="round"/>`);
  }

  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="${uid}-core" cx="30%" cy="28%" r="80%">
        <stop offset="0%" stop-color="rgba(255,252,235,0.4)"/>
        <stop offset="100%" stop-color="rgba(255,252,235,0)"/>
      </radialGradient>
      <radialGradient id="${uid}-shadow" cx="70%" cy="75%" r="70%">
        <stop offset="0%" stop-color="rgba(40,25,10,0)"/>
        <stop offset="100%" stop-color="rgba(40,25,10,0.35)"/>
      </radialGradient>
    </defs>
    <path d="${outlinePath}" fill="rgb(230,220,195)"/>
    ${panelSvg.join('')}
    ${creases.join('')}
    ${ridges.join('')}
    <path d="${outlinePath}" fill="url(#${uid}-core)"/>
    <path d="${outlinePath}" fill="url(#${uid}-shadow)"/>
    <path d="${outlinePath}" fill="none" stroke="rgba(70,45,20,0.5)" stroke-width="${big?1.0:0.8}" stroke-linejoin="round"/>
  </svg>`;
}

async function loadRevealFixtures(){
  const sel=document.getElementById('rv-fixture-sel');
  sel.innerHTML='<option value="">— Select match —</option>';
  document.getElementById('rv-stage').style.display='none';
  document.getElementById('rv-picker-hint').textContent='Loading...';

  const{data,error}=await sb.from('match_vote_sessions')
    .select('id,fixture_id,status,whc_goals,opp_goals,eligible_players,fixtures!inner(opponent,match_date,season)')
    .eq('fixtures.season',currentSeason)
    .order('created_at',{ascending:false});

  if(error){
    document.getElementById('rv-picker-hint').textContent='Failed to load sessions.';
    return;
  }
  if(!data||!data.length){
    document.getElementById('rv-picker-hint').textContent='No voting sessions found for this season. Captains need to open a vote first.';
    return;
  }

  data.forEach(s=>{
    const d=new Date(s.fixtures.match_date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    const tag=s.status==='complete'?' ✓':s.status==='open'?' 🗳':'';
    const opt=document.createElement('option');
    opt.value=s.id;
    opt.textContent=`${d} — ${s.fixtures.opponent}${tag}`;
    sel.appendChild(opt);
  });
  document.getElementById('rv-picker-hint').textContent='🗳 = open for voting · ✓ = already finalised';
}

async function onRvFixtureChange(){
  const sessionId=document.getElementById('rv-fixture-sel').value;
  if(!sessionId){document.getElementById('rv-stage').style.display='none';return;}

  const{data:session}=await sb.from('match_vote_sessions')
    .select('id,fixture_id,status,whc_goals,opp_goals,eligible_players,fixtures!inner(opponent,match_date)')
    .eq('id',sessionId).single();
  const{data:votes}=await sb.from('match_votes')
    .select('*').eq('session_id',sessionId).order('created_at',{ascending:true});

  rvSession=session;
  rvVotes=votes||[];

  rvMomTally={};rvDodTally={};
  rvVotes.filter(v=>v.revealed).forEach(v=>{
    rvMomTally[v.mom_vote]=(rvMomTally[v.mom_vote]||0)+1;
    rvDodTally[v.dod_vote]=(rvDodTally[v.dod_vote]||0)+1;
  });

  document.getElementById('rv-stage').style.display='block';
  renderRevealPile();
  renderTally('mom');
  renderTally('dod');

  const unrevealed=rvVotes.filter(v=>!v.revealed);
  if(rvVotes.length>0 && unrevealed.length===0){
    showConfirmWinners();
  } else {
    document.getElementById('rv-confirm').style.display='none';
  }
}

function renderRevealPile(){
  const pile=document.getElementById('rv-pile');
  const status=document.getElementById('rv-pile-status');
  const hint=document.getElementById('rv-pile-hint');
  pile.innerHTML='';
  const unrevealed=rvVotes.filter(v=>!v.revealed);

  if(rvVotes.length===0){
    status.textContent='No votes submitted';
    pile.innerHTML='<p class="rv-pile-empty">No paper balls in the pile — nobody voted for this match.</p>';
    hint.style.display='none';
    return;
  }

  status.textContent=unrevealed.length+' vote'+(unrevealed.length===1?'':'s')+' left';

  if(unrevealed.length===0){
    pile.innerHTML='<p class="rv-pile-empty">✓ All votes revealed — confirm winners below.</p>';
    hint.style.display='none';
    return;
  }

  hint.style.display='block';
  unrevealed.forEach(v=>{
    const ball=document.createElement('div');
    ball.className='rv-ball';
    ball.style.animationDelay=(Math.random()*0.3).toFixed(2)+'s';
    ball.innerHTML=buildPaperBallSVG(52);
    ball.addEventListener('click',()=>revealOneVote(v.id,ball));
    pile.appendChild(ball);
  });
}

function renderTally(kind){
  const tally=kind==='mom'?rvMomTally:rvDodTally;
  const body=document.getElementById('rv-'+kind+'-tally');
  const totalEl=document.getElementById('rv-'+kind+'-total');
  const entries=Object.entries(tally).sort((a,b)=>b[1]-a[1]);
  const total=entries.reduce((s,[,c])=>s+c,0);
  totalEl.textContent=total+' vote'+(total===1?'':'s');
  if(!entries.length){body.innerHTML='<div class="empty-tally">No votes yet</div>';return;}
  const topCount=entries[0][1];
  body.innerHTML=entries.map(([name,count],i)=>{
    const isLeader=count===topCount;
    return `<div class="rv-tally-row${isLeader?' leader':''}" data-name="${name.replace(/"/g,'&quot;')}">
      <span class="rt-rank">${i+1}</span>
      <span class="rt-name">${name}</span>
      <span class="rt-count">${count}</span>
    </div>`;
  }).join('');
}

async function revealOneVote(voteId,ballEl){
  if(rvRevealing)return;
  rvRevealing=true;

  const vote=rvVotes.find(v=>v.id===voteId);
  if(!vote){rvRevealing=false;return;}

  try{
    await sb.from('match_votes').update({revealed:true,revealed_at:new Date().toISOString()}).eq('id',voteId);
  }catch(e){
    console.error('Failed to mark revealed:',e);
    rvRevealing=false;
    return;
  }
  vote.revealed=true;

  rvMomTally[vote.mom_vote]=(rvMomTally[vote.mom_vote]||0)+1;
  rvDodTally[vote.dod_vote]=(rvDodTally[vote.dod_vote]||0)+1;

  ballEl.classList.add('discarded');

  const overlay=document.getElementById('rv-overlay');
  const bigBall=document.getElementById('rv-ball-big');
  const paper=document.getElementById('rv-paper');
  const doneBtn=document.getElementById('rv-done-btn');

  bigBall.innerHTML=buildPaperBallSVG(280);

  document.getElementById('rv-paper-mom-name').textContent=vote.mom_vote;
  document.getElementById('rv-paper-mom-reason').textContent='"'+vote.mom_reason+'"';
  document.getElementById('rv-paper-dod-name').textContent=vote.dod_vote;
  document.getElementById('rv-paper-dod-reason').textContent='"'+vote.dod_reason+'"';

  bigBall.className='rv-ball-big';
  paper.className='rv-paper';
  doneBtn.style.display='none';
  void bigBall.offsetWidth;

  overlay.classList.add('open');

  setTimeout(()=>bigBall.classList.add('animating'),50);
  setTimeout(()=>bigBall.classList.add('unfolding'),750);
  setTimeout(()=>paper.classList.add('reveal'),800);
  setTimeout(()=>{doneBtn.style.display='inline-block';},1700);
}

function dismissReveal(){
  const overlay=document.getElementById('rv-overlay');
  overlay.classList.remove('open');
  rvRevealing=false;

  setTimeout(()=>{
    renderRevealPile();
    renderTally('mom');
    renderTally('dod');

    const unrevealed=rvVotes.filter(v=>!v.revealed);
    if(unrevealed.length===0 && rvVotes.length>0){
      showConfirmWinners();
    }
  },250);
}

function showConfirmWinners(){
  const momEntries=Object.entries(rvMomTally).sort((a,b)=>b[1]-a[1]);
  const dodEntries=Object.entries(rvDodTally).sort((a,b)=>b[1]-a[1]);
  const momLeader=momEntries[0]?momEntries[0][0]:'';
  const dodLeader=dodEntries[0]?dodEntries[0][0]:'';

  const buildDropdown=(id,leader)=>{
    const sel=document.getElementById(id);
    sel.innerHTML='';
    const all=new Set([...PLAYERS,...Object.keys(rvMomTally),...Object.keys(rvDodTally)]);
    const ordered=[leader,...Array.from(all).filter(n=>n!==leader).sort()];
    ordered.filter(Boolean).forEach(n=>{
      const o=document.createElement('option');o.value=o.textContent=n;
      if(n===leader)o.selected=true;
      sel.appendChild(o);
    });
  };
  buildDropdown('rv-mom-winner',momLeader);
  buildDropdown('rv-dod-winner',dodLeader);

  const tbody=document.getElementById('rv-stats-rows');
  tbody.innerHTML='';
  const eligible=rvSession.eligible_players||[];
  const rowList=eligible.length?eligible:PLAYERS;
  rowList.forEach(p=>{
    const tr=document.createElement('tr');tr.dataset.player=p;
    tr.innerHTML=`<td style="padding-left:10px;text-align:left;font-size:12px;font-weight:600;color:#fff;">${p}</td>`;
    [['p-goals',''],['p-assists',''],['p-green','green-s'],['p-yellow','yellow-s'],['p-red','red-s']].forEach(([cls,tint])=>{
      const td=document.createElement('td');td.appendChild(makeStepper(cls,tint));tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  document.getElementById('rv-confirm').style.display='block';
}

async function finaliseReveal(){
  if(!rvSession)return;
  const mom=document.getElementById('rv-mom-winner').value;
  const dod=document.getElementById('rv-dod-winner').value;
  const al=document.getElementById('rv-alert');
  if(!mom||!dod){showAlert(al,'error','Both MOM and DOD must be selected.');return;}

  const btn=document.getElementById('rv-submit-btn');btn.disabled=true;btn.textContent='Saving...';

  const gf=rvSession.whc_goals||0,ga=rvSession.opp_goals||0;
  const result=gf>ga?'W':gf<ga?'L':'D';
  const pts=result==='W'?3:result==='D'?1:0;

  try{
    const{error:fe}=await sb.from('fixtures').update({
      whc_goals:gf,opp_goals:ga,result,match_points:pts,mom,dod
    }).eq('id',rvSession.fixture_id);
    if(fe)throw fe;

    const rows=document.querySelectorAll('#rv-stats-rows tr');
    const inserts=[];
    rows.forEach(row=>{
      const player=row.dataset.player;
      inserts.push({
        fixture_id:rvSession.fixture_id,
        player_name:player,
        season:currentSeason,
        goals:getVal(row,'p-goals'),
        assists:getVal(row,'p-assists'),
        mom_votes:rvMomTally[player]||0,
        dod_votes:rvDodTally[player]||0,
        green_cards:getVal(row,'p-green'),
        yellow_cards:getVal(row,'p-yellow'),
        red_cards:getVal(row,'p-red'),
        match_points:pts,
        is_mom:player===mom,
        is_dod:player===dod
      });
    });
    if(inserts.length){
      await sb.from('match_stats').delete().eq('fixture_id',rvSession.fixture_id);
      const{error:se}=await sb.from('match_stats').insert(inserts);
      if(se)throw se;
    }

    await sb.from('match_vote_sessions').update({
      status:'complete',
      completed_at:new Date().toISOString()
    }).eq('id',rvSession.id);

    showAlert(al,'success',`Match finalised! ${inserts.length} players recorded. MOM: ${mom} · DOD: ${dod}`);
    btn.textContent='✓ Saved';
    setTimeout(()=>{
      document.getElementById('rv-fixture-sel').value='';
      document.getElementById('rv-stage').style.display='none';
      loadRevealFixtures();
    },2000);
  }catch(e){
    showAlert(al,'error','Failed: '+e.message);
    btn.disabled=false;btn.textContent='🏁 Finalise Match';
  }
}

function showAlert(el,type,msg){el.className=`alert ${type} show`;el.textContent=msg;setTimeout(()=>el.classList.remove('show'),4000);}

// ══════════════════════════════════════════════════════════
// CAPTAIN PORTAL — PLAYERS TAB
// ══════════════════════════════════════════════════════════

async function loadPlayersList(){
  const list=document.getElementById('pl-list');
  list.className='loading';
  list.innerHTML='<div class="spinner"></div><br>Loading...';
  const{data,error}=await sb.from('players').select('*').order('sort_order',{ascending:true});
  if(error){list.className='';list.innerHTML='<p class="empty" style="color:#f44336">Failed to load: '+error.message+'</p>';return;}
  renderPlayersList(data||[]);
}

function renderPlayersList(players){
  const list=document.getElementById('pl-list');
  list.className='';
  if(!players.length){list.innerHTML='<p class="empty">No players yet. Add one above.</p>';return;}
  list.innerHTML='';
  players.forEach(p=>{
    const row=document.createElement('div');
    row.className='pl-row'+(p.active?'':' inactive')+(plEditingId===p.id?' editing':'');
    row.dataset.id=p.id;
    if(plEditingId===p.id){
      row.innerHTML=`<div class="pl-row-edit">
        <input type="text" data-field="name" value="${escapeHtml(p.name)}" placeholder="Name">
        <select data-field="role">
          <option value="player"${p.role==='player'?' selected':''}>Player</option>
          <option value="gk"${p.role==='gk'?' selected':''}>Goalkeeper</option>
          <option value="cap"${p.role==='cap'?' selected':''}>Captain</option>
        </select>
        <div class="pl-save-cancel">
          <button class="pl-save-btn" onclick="savePlayerEdit(${p.id})">Save</button>
          <button class="pl-cancel-btn" onclick="cancelPlayerEdit()">✕</button>
        </div>
      </div>`;
    } else {
      const roleLabel=p.role==='gk'?'GK':p.role==='cap'?'©':'P';
      const activeBtnCls=p.active?'active-toggle':'active-toggle off';
      const activeTitle=p.active?'Active — click to deactivate':'Inactive — click to activate';
      row.innerHTML=`
        <div class="pl-row-main">
          <span class="pl-row-name">${escapeHtml(p.name)}</span>
          <span class="pl-row-badge ${p.role||'player'}">${roleLabel}</span>
        </div>
        <div class="pl-row-actions">
          <button class="pl-icon-btn ${activeBtnCls}" title="${activeTitle}" onclick="togglePlayerActive(${p.id},${p.active?'false':'true'})">${p.active?'●':'○'}</button>
          <button class="pl-icon-btn" title="Edit" onclick="startPlayerEdit(${p.id})">✏️</button>
          <button class="pl-icon-btn danger" title="Delete permanently" onclick="deletePlayer(${p.id},'${escapeHtml(p.name).replace(/'/g,"&#39;")}')">🗑</button>
        </div>`;
    }
    list.appendChild(row);
  });
}

async function addPlayer(){
  const name=document.getElementById('pl-new-name').value.trim();
  const role=document.getElementById('pl-new-role').value;
  const active=document.getElementById('pl-new-active').checked;
  const al=document.getElementById('pl-alert');
  if(!name){showAlert(al,'error','Name is required.');return;}
  // Auto-assign sort_order: max existing + 10 (new players go to end)
  const{data:existing}=await sb.from('players').select('sort_order').order('sort_order',{ascending:false}).limit(1);
  const sort_order=((existing&&existing[0]?existing[0].sort_order:0)||0)+10;
  try{
    const{error}=await sb.from('players').insert({name,role,sort_order,active});
    if(error)throw error;
    showAlert(al,'success','Added '+name+'.');
    document.getElementById('pl-new-name').value='';
    document.getElementById('pl-new-role').value='player';
    document.getElementById('pl-new-active').checked=true;
    loadPlayersList();
    await loadPlayersFromDB();
    refreshPlayerDropdowns();
  }catch(e){
    showAlert(al,'error','Failed: '+e.message);
  }
}

function startPlayerEdit(id){
  plEditingId=id;
  loadPlayersList();
}
function cancelPlayerEdit(){
  plEditingId=null;
  loadPlayersList();
}

async function savePlayerEdit(id){
  const row=document.querySelector('.pl-row[data-id="'+id+'"]');
  if(!row)return;
  const name=row.querySelector('[data-field="name"]').value.trim();
  const role=row.querySelector('[data-field="role"]').value;
  const al=document.getElementById('pl-alert');
  if(!name){showAlert(al,'error','Name cannot be empty.');return;}
  try{
    const{error}=await sb.from('players').update({name,role}).eq('id',id);
    if(error)throw error;
    plEditingId=null;
    showAlert(al,'success','Updated.');
    loadPlayersList();
    await loadPlayersFromDB();
    refreshPlayerDropdowns();
  }catch(e){
    showAlert(al,'error','Failed: '+e.message);
  }
}

async function togglePlayerActive(id,newVal){
  try{
    const{error}=await sb.from('players').update({active:newVal}).eq('id',id);
    if(error)throw error;
    loadPlayersList();
    await loadPlayersFromDB();
    refreshPlayerDropdowns();
  }catch(e){
    showAlert(document.getElementById('pl-alert'),'error','Failed: '+e.message);
  }
}

async function deletePlayer(id,name){
  if(!confirm(`Permanently delete ${name}? Their historic stats will remain in match_stats (tagged by name), but they'll be removed from the squad roster. This cannot be undone.`))return;
  try{
    const{error}=await sb.from('players').delete().eq('id',id);
    if(error)throw error;
    showAlert(document.getElementById('pl-alert'),'success','Deleted '+name+'.');
    loadPlayersList();
    await loadPlayersFromDB();
    refreshPlayerDropdowns();
  }catch(e){
    showAlert(document.getElementById('pl-alert'),'error','Failed: '+e.message);
  }
}

function refreshPlayerDropdowns(){
  ['fine-player','m-mom','m-dod'].forEach(id=>{
    const sel=document.getElementById(id);
    if(!sel)return;
    const current=sel.value;
    sel.innerHTML='<option value="">— Select —</option>';
    PLAYERS.forEach(p=>{const o=document.createElement('option');o.value=o.textContent=p;sel.appendChild(o);});
    if(PLAYERS.includes(current))sel.value=current;
  });
  const tbody=document.getElementById('prows');
  if(tbody && tbody.children.length){
    tbody.innerHTML='';
    PLAYERS.forEach(p=>{
      const tr=document.createElement('tr');tr.dataset.player=p;
      const tdName=document.createElement('td');
      const cb=document.createElement('input');cb.type='checkbox';cb.className='p-played';
      cb.style.cssText='width:15px;height:15px;accent-color:var(--pink);cursor:pointer;vertical-align:middle;margin-right:7px;';
      cb.addEventListener('change',()=>{updateGoalsTally();if(document.getElementById('hide-not-playing').checked)toggleHideNotPlaying();});
      const ns=document.createElement('span');ns.style.cssText='font-size:12px;font-weight:600;color:#fff;vertical-align:middle;';ns.textContent=p;
      tdName.appendChild(cb);tdName.appendChild(ns);tr.appendChild(tdName);
      [['p-mom',''],['p-dod',''],['p-goals',''],['p-assists',''],['p-green','green-s'],['p-yellow','yellow-s'],['p-red','red-s']].forEach(([cls,tint])=>{const td=document.createElement('td');td.appendChild(makeStepper(cls,tint));tr.appendChild(td);});
      tbody.appendChild(tr);
    });
  }
}

// ══════════════════════════════════════════════════════════
// CAPTAIN PORTAL — FIXTURES TAB
// ══════════════════════════════════════════════════════════

async function loadFixturesList(){
  document.getElementById('fx-new-season').textContent=currentSeason;
  document.getElementById('fx-list-season').textContent=currentSeason;

  const list=document.getElementById('fx-list');
  list.className='loading';
  list.innerHTML='<div class="spinner"></div><br>Loading...';
  const{data,error}=await sb.from('fixtures').select('*').eq('season',currentSeason).order('match_date',{ascending:true});
  if(error){list.className='';list.innerHTML='<p class="empty" style="color:#f44336">Failed to load: '+error.message+'</p>';return;}
  renderFixturesList(data||[]);
}

function renderFixturesList(fixtures){
  const list=document.getElementById('fx-list');
  list.className='';
  if(!fixtures.length){list.innerHTML='<p class="empty">No fixtures for '+currentSeason+' yet. Add one above.</p>';return;}
  list.innerHTML='';
  fixtures.forEach(f=>{
    const row=document.createElement('div');
    row.className='fx-row'+(fxEditingId===f.id?' editing':'');
    row.dataset.id=f.id;
    const d=new Date(f.match_date+'T00:00:00');
    const num=d.getDate();
    const mon=d.toLocaleDateString('en-GB',{month:'short'});
    const resultMarkup=f.result?`<span class="fxm-result ${f.result}">${f.result}</span> ${f.whc_goals}–${f.opp_goals}`:'<span class="fxm-upcoming">Upcoming</span>';
    row.innerHTML=`
      <div class="fx-row-head" onclick="toggleFixtureEdit(${f.id})">
        <div class="fx-row-date">
          <div class="fxd-num">${num}</div>
          <div class="fxd-mon">${mon}</div>
        </div>
        <div class="fx-row-info">
          <div class="fx-row-opp">${escapeHtml(f.opponent)}</div>
          <div class="fx-row-meta">
            ${resultMarkup}
            ${f.kick_off_time?`<span>🕐 ${f.kick_off_time}</span>`:''}
            ${f.venue?`<span>📍 ${escapeHtml(f.venue)}</span>`:''}
          </div>
        </div>
        <span class="fx-chev">▼</span>
      </div>
      <div class="fx-row-edit">
        <div class="fx-edit-grid">
          <div class="fx-edit-field">
            <label>Date</label>
            <input type="date" data-field="match_date" value="${f.match_date||''}">
          </div>
          <div class="fx-edit-field">
            <label>Kick-off</label>
            <input type="time" data-field="kick_off_time" value="${f.kick_off_time||''}">
          </div>
          <div class="fx-edit-field fx-edit-full">
            <label>Opponent</label>
            <input type="text" data-field="opponent" value="${escapeHtml(f.opponent||'')}">
          </div>
          <div class="fx-edit-field">
            <label>Venue</label>
            <input type="text" data-field="venue" value="${escapeHtml(f.venue||'')}">
          </div>
          <div class="fx-edit-field">
            <label>Competition</label>
            <input type="text" data-field="competition" value="${escapeHtml(f.competition||'')}">
          </div>
        </div>
        <div class="fx-edit-section">
          <h4>Result (optional)</h4>
          <div class="fx-edit-grid">
            <div class="fx-edit-field">
              <label>WHC Goals</label>
              <input type="number" data-field="whc_goals" value="${f.whc_goals!=null?f.whc_goals:''}" min="0">
            </div>
            <div class="fx-edit-field">
              <label>Opp Goals</label>
              <input type="number" data-field="opp_goals" value="${f.opp_goals!=null?f.opp_goals:''}" min="0">
            </div>
            <div class="fx-edit-field">
              <label>MOM</label>
              <input type="text" data-field="mom" value="${escapeHtml(f.mom||'')}" placeholder="Leave blank if none">
            </div>
            <div class="fx-edit-field">
              <label>DOD</label>
              <input type="text" data-field="dod" value="${escapeHtml(f.dod||'')}">
            </div>
          </div>
        </div>
        <div class="fx-edit-actions">
          <button class="fx-delete" onclick="deleteFixture(${f.id},'${escapeHtml(f.opponent||'this fixture').replace(/'/g,"&#39;")}')">🗑 Delete</button>
          <button class="fx-save" onclick="saveFixtureEdit(${f.id})">💾 Save</button>
        </div>
      </div>`;
    list.appendChild(row);
  });
}

function toggleFixtureEdit(id){
  fxEditingId=(fxEditingId===id?null:id);
  loadFixturesList();
}

async function addFixture(){
  const date=document.getElementById('fx-new-date').value;
  const time=document.getElementById('fx-new-time').value;
  const opp=document.getElementById('fx-new-opp').value.trim();
  const venue=document.getElementById('fx-new-venue').value.trim();
  const comp=document.getElementById('fx-new-comp').value.trim();
  const al=document.getElementById('fx-alert');
  if(!date){showAlert(al,'error','Date is required.');return;}
  if(!opp){showAlert(al,'error','Opponent is required.');return;}
  try{
    const payload={match_date:date,opponent:opp,season:currentSeason};
    if(time)payload.kick_off_time=time;
    if(venue)payload.venue=venue;
    if(comp)payload.competition=comp;
    const{error}=await sb.from('fixtures').insert(payload);
    if(error)throw error;
    showAlert(al,'success','Fixture added.');
    document.getElementById('fx-new-date').value='';
    document.getElementById('fx-new-time').value='';
    document.getElementById('fx-new-opp').value='';
    document.getElementById('fx-new-venue').value='';
    document.getElementById('fx-new-comp').value='';
    loadFixturesList();
  }catch(e){
    showAlert(al,'error','Failed: '+e.message);
  }
}

async function saveFixtureEdit(id){
  const row=document.querySelector('.fx-row[data-id="'+id+'"]');
  if(!row)return;
  const al=document.getElementById('fx-alert');
  const getF=name=>row.querySelector('[data-field="'+name+'"]').value;
  const match_date=getF('match_date');
  const opponent=getF('opponent').trim();
  if(!match_date){showAlert(al,'error','Date is required.');return;}
  if(!opponent){showAlert(al,'error','Opponent is required.');return;}
  const whcRaw=getF('whc_goals'),oppRaw=getF('opp_goals');
  const whc_goals=whcRaw===''?null:parseInt(whcRaw);
  const opp_goals=oppRaw===''?null:parseInt(oppRaw);
  let result=null,match_points=null;
  if(whc_goals!=null&&opp_goals!=null){
    result=whc_goals>opp_goals?'W':whc_goals<opp_goals?'L':'D';
    match_points=result==='W'?3:result==='D'?1:0;
  }
  const payload={
    match_date,
    opponent,
    kick_off_time:getF('kick_off_time')||null,
    venue:getF('venue').trim()||null,
    competition:getF('competition').trim()||null,
    whc_goals,
    opp_goals,
    result,
    match_points,
    mom:getF('mom').trim()||null,
    dod:getF('dod').trim()||null
  };
  try{
    const{error}=await sb.from('fixtures').update(payload).eq('id',id);
    if(error)throw error;
    fxEditingId=null;
    showAlert(al,'success','Saved.');
    loadFixturesList();
  }catch(e){
    showAlert(al,'error','Failed: '+e.message);
  }
}

async function deleteFixture(id,opp){
  if(!confirm(`Delete fixture vs ${opp}?\n\nThis will CASCADE-DELETE all match_stats, vote sessions, and individual votes for this fixture. Cannot be undone.`))return;
  try{
    const{error}=await sb.from('fixtures').delete().eq('id',id);
    if(error)throw error;
    fxEditingId=null;
    showAlert(document.getElementById('fx-alert'),'success','Fixture deleted.');
    loadFixturesList();
  }catch(e){
    showAlert(document.getElementById('fx-alert'),'error','Failed: '+e.message);
  }
}

// ── PWA ───────────────────────────────────────────────────────
const mb=new Blob([JSON.stringify({name:'WHC Hockey',short_name:'WHC',start_url:'/',display:'standalone',background_color:'#120810',theme_color:'#6B1E3A'})],{type:'application/json'});
const ml=document.createElement('link');ml.rel='manifest';ml.href=URL.createObjectURL(mb);document.head.appendChild(ml);

init();
