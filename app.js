const SUPABASE_URL='https://kxqgtuiybwtubavxbaxf.supabase.co';
const SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4cWd0dWl5Ynd0dWJhdnhiYXhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Mjk2NTAsImV4cCI6MjA5MDIwNTY1MH0.AxtJY6ujK4g9F4qgHshF7wpSCwdJXEhuvsbH6vi3rAU';
let PLAYERS=[];
const PREDICTIONS={'George':{g:3,a:12,app:16},'Dan MM':{g:8,a:5,app:17},'Colesy':{g:3,a:6,app:17},'Ryan':{g:7,a:6,app:20},'Stretch':{g:9,a:8,app:13},'Charge':{g:16,a:7,app:21},'Harvey':{g:15,a:6,app:18},'Hector':{g:1,a:1,app:17},'Ewan':{g:2,a:5,app:12},'Jack':{g:11,a:4,app:18},'Harry':{g:5,a:10,app:15},'Seb C':{g:0,a:2,app:15},'Seb S':{g:3,a:7,app:17},'TH':{g:0,a:0,app:1},'Ollie J':{g:0,a:8,app:15}};
const IND_FINES={'Colesy':['Double baby tax','Values babies over hockey #epstein','Number of sticks purchased this year','Polluting the environment','Moving to Richmond solely because he\'s rich'],'Tom M':['Weeks spent in South Africa','Scores more in training than matches','Where\'s the team bri?'],'Rick':['Shit original name','Who scores more — your missus or you?','Really a 6s player','What is your shirt number?'],'Jack':['Bye bye missus','Good at marathons — unavailable on Saturdays','Parkrun before game day'],'Harvey':['Watched rugby instead of playing','Are you a member of the Chinese Communist Party?','Marrying a man — his name is Charlie','Moving to Richmond solely because he\'s rich','Went to Charterhouse — makes sense you charter ships','Generally smelly human (Charlie validated)','Shin infection from unwashed shin pads'],'Hector':['Too Irish for my liking','Marrying someone posher than your name','Not inviting TH to wedding but inviting 40 family members','Horace the Hung — didn\'t get the genes'],'Ollie J':['Never seen him at teas','Never seen him pass right'],'Ryan':['3 at the back','15% tariff on drinks — getting married in US','Shit Chris Evans','Who is captaining after your shit show?','Short','Passes to centre forwards'],'TH':['Would be better off with George\'s knee','"This is my last year" — again'],'Tom W':['Sieve','Shin splints','No fans in attendance','Future captain (allegedly)'],'Harry':['Better hockey player now he\'s single','Still skinny','Blanking Hector on the tube','Stayed on tube longer with a girl who has a girlfriend','What\'s your handicap?'],'Charge':['Goals under target','Shocked to see you here without Stretch','Times at the clubhouse in the last 3 years'],'Max K':['DOD jacket','Stick throws','Trying to decide his own punishment','General tardiness'],'Seb S':['Poor family roots','General tardiness','What is your personality now you don\'t bobble passes?','Sick on the balcony']};

const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
let currentSeason='2025-26',statsData=[],currentSort='ppg';
let wheelReady=false,spinning=false,wheelAngle=0,audioCtx=null,spinNodes=[];
let meetingPwHash=null,captainPwHash=null,captainAuthed=false;
let tsSquad=[];
let vsSquad=[];            // captain vote setup: squad with selected state
let currentVoteSession=null; // currently open session on the public vote page
// REVEAL state
let rvSession=null;        // currently loaded session for reveal
let rvVotes=[];            // all votes for this session (full list with revealed flags)
let rvRevealing=false;     // lock while animation in progress
let rvMomTally={};         // {playerName:count}
let rvDodTally={};

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
  const active=document.querySelector('.section.active');
  if(!active)return;
  const id=active.id.replace('sec-','');
  if(id==='stats')loadStats();
  if(id==='fixtures')loadFixtures();
  if(id==='vote')loadOpenVoteSession();
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

// Switch between Teamsheet / Start Vote / Quick Entry tabs
function showCpTab(id,btn){
  document.querySelectorAll('.cp-tab-content').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.cp-tab').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if(id==='cp-votesetup')loadVsData();
  if(id==='cp-quickstats')loadFixtureDropdown();
}

// ── CAPTAIN VOTE SETUP ───────────────────────────────────────
async function loadVsData(){
  // Populate fixture dropdown (open fixtures = no result set)
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

  // Load squad from DB for "who played" ticklist
  const{data:players}=await sb.from('players').select('name').eq('active',true).order('sort_order',{ascending:true});
  vsSquad=(players||[]).map(p=>({name:p.name,selected:false}));
  renderVsSquad();

  // Load any existing open sessions so captain sees them
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
  const s=sessions[0];  // most recent only (we only allow one open at a time practically)
  // Count votes cast
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
  // Prefill score from fixture if already entered
  const sel=document.getElementById('vs-fixture');
  if(!sel.value)return;
  const opt=sel.options[sel.selectedIndex];
  // We didn't store score on the option; re-fetch it from DB cheaply
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
    // Upsert so running this twice on same fixture doesn't error (overwrites eligible list + score)
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
    // Delete session (cascade deletes votes)
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
  // Show Reveal button only when there's an open session
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

  // Populate MOM and DOD dropdowns
  // Order: eligible players first (as captain ticked), then any remaining full-squad players
  const eligible=new Set(s.eligible_players);
  const rest=PLAYERS.filter(p=>!eligible.has(p));
  const orderedList=[...s.eligible_players,...rest];

  ['vote-mom','vote-dod'].forEach(id=>{
    const sel=document.getElementById(id);
    const placeholder=id==='vote-mom'?'— Pick your MOM —':'— Pick your DOD —';
    sel.innerHTML=`<option value="">${placeholder}</option>`;
    // Group label: played
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

  // Clear any previous form state
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

// ── STATS ─────────────────────────────────────────────────────
async function loadStats(){
  document.getElementById('stats-loading').style.display='block';
  document.getElementById('stats-wrap').style.display='none';
  try{
    const{data,error}=await sb.from('player_stats_view').select('*').eq('season',currentSeason);
    if(error)throw error;
    statsData=data||[];renderStats(currentSort);
  }catch(e){document.getElementById('stats-loading').innerHTML=`<p style="color:#f44336">Failed.</p>`;}
}
function sortStats(col,btn){currentSort=col;if(btn){document.querySelectorAll('.sort-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}renderStats(col);}
function renderStats(col){
  document.getElementById('stats-loading').style.display='none';
  document.getElementById('stats-wrap').style.display='block';
  const sorted=[...statsData].sort((a,b)=>(parseFloat(b[col])||0)-(parseFloat(a[col])||0));
  const topG=sorted.length?Math.max(...sorted.map(r=>parseInt(r.goals)||0)):0;
  const topA=sorted.length?Math.max(...sorted.map(r=>parseInt(r.assists)||0)):0;
  const tbody=document.getElementById('stats-tbody');tbody.innerHTML='';
  if(!sorted.length){tbody.innerHTML='<tr><td colspan="10" class="empty">No stats yet.</td></tr>';return;}
  sorted.forEach((r,i)=>{
    const g=parseInt(r.goals)||0,a=parseInt(r.assists)||0,ppg=parseFloat(r.ppg||0);
    const isTopG=g>0&&g===topG,isTopA=a>0&&a===topA;
    const rNum=i<3?`<span class="rank rank-${i+1}">${i+1}</span>`:`<span style="color:#444;font-size:11px">${i+1}</span>`;
    const badges=(isTopG?`<span class="badge-stat badge-g">⚽TOP</span>`:'')+(isTopA?`<span class="badge-stat badge-a">🎯TOP</span>`:'');
    const tr=document.createElement('tr');
    if(isTopG&&col==='goals')tr.classList.add('top-goals');
    if(isTopA&&col==='assists')tr.classList.add('top-assists');
    tr.innerHTML=`<td>${rNum}</td><td>${r.player_name}${badges}</td><td>${r.appearances||0}</td><td>${r.total_points||0}</td><td>${g}</td><td>${a}</td><td>${g+a}</td><td>${r.mom_wins||0}</td><td>${r.dod_wins||0}</td><td class="ppg-val">${ppg.toFixed(2)}</td>`;
    tbody.appendChild(tr);
  });
}

// ── FIXTURES ──────────────────────────────────────────────────
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
    const{data,error}=await sb.from('fines').select('*').order('created_at',{ascending:false}).limit(40);
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
    const{error}=await sb.from('fines').insert({player_name:player,description:desc,submitted_by:by||'Anonymous'});
    if(error)throw error;
    showAlert(al,'success',`Fine submitted against ${player}!`);
    document.getElementById('fine-desc').value='';document.getElementById('fine-by').value='';document.getElementById('fine-player').value='';
    loadFines();
  }catch(e){showAlert(al,'error','Failed: '+e.message);}
  btn.disabled=false;
}

// ── MATCH (Quick Entry fallback — inside Captain's Portal) ──
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
  const{data}=await sb.from('fines').select('player_name,description').order('created_at',{ascending:true});
  const live={};(data||[]).forEach(r=>{if(!live[r.player_name])live[r.player_name]=[];live[r.player_name].push(r.description);});
  const all=new Set([...Object.keys(IND_FINES),...Object.keys(live)]);
  all.forEach(name=>{
    const pre=IND_FINES[name]||[],lv=live[name]||[];
    if(!pre.length&&!lv.length)return;
    const card=document.createElement('div');card.className='player-card';
    card.innerHTML=`<div class="pcard-name">🏑 ${name}</div><ul>${pre.map(f=>`<li>${f}</li>`).join('')}${lv.map(f=>`<li style="color:var(--pink);font-style:italic">📱 ${f}</li>`).join('')}</ul>`;
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
// REVEAL — MOM/DOD paper ball theatre
// ══════════════════════════════════════════════════════════

// ── Modal open/close + password gate ─────────────────────────
function openRevealFromVote(){
  const modal=document.getElementById('reveal-modal');
  modal.classList.add('open');
  // If captain already authed in this session, skip password
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
  // Also close the full-screen ball overlay if it was open
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

// ── Paper ball SVG builder ───────────────────────────────────
// Generates a fresh crumpled-paper SVG with random crease positions.
// `size` is the intended on-screen size (drives stroke weights); returns SVG string.
function buildPaperBallSVG(size){
  const big=size>=200;
  // Unique IDs per ball (timestamps + random) so gradients don't collide
  const uid='pb'+Date.now()+Math.floor(Math.random()*10000);
  // Irregular blob outline — slight variations per ball
  const jitter=()=>90+Math.random()*20;
  const p1=jitter(),p2=jitter(),p3=jitter(),p4=jitter();
  const blob=`M 100,${p1-90}
    C ${150+Math.random()*10},${p1-88} ${188+Math.random()*10},${140-Math.random()*8} 188,100
    C ${194-Math.random()*6},${145+Math.random()*8} ${158+Math.random()*6},${194-Math.random()*8} 100,${p3}
    C ${55-Math.random()*8},${194-Math.random()*6} ${10+Math.random()*6},${158-Math.random()*10} 10,100
    C ${8+Math.random()*6},${55+Math.random()*8} ${45-Math.random()*6},${10+Math.random()*6} 100,${p2-90}
    Z`;
  // Crease lines — irregular zigzags inside the blob
  const creases=[];
  for(let i=0;i<(big?7:5);i++){
    const x1=30+Math.random()*140,y1=30+Math.random()*140;
    const x2=x1+(-30+Math.random()*60),y2=y1+(-30+Math.random()*60);
    const mx=(x1+x2)/2+(-15+Math.random()*30);
    const my=(y1+y2)/2+(-15+Math.random()*30);
    const opacity=0.08+Math.random()*0.14;
    creases.push(`<path d="M ${x1.toFixed(1)},${y1.toFixed(1)} Q ${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" stroke="rgba(60,40,10,${opacity.toFixed(2)})" stroke-width="${big?1.2:0.9}" fill="none" stroke-linecap="round"/>`);
  }
  // Small shadow splotches (crumpled dents)
  const dents=[];
  for(let i=0;i<(big?6:4);i++){
    const cx=40+Math.random()*120,cy=40+Math.random()*120;
    const rx=8+Math.random()*14,ry=5+Math.random()*10;
    const rot=Math.floor(Math.random()*180);
    dents.push(`<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="url(#${uid}-dent)" opacity="${(0.3+Math.random()*0.3).toFixed(2)}" transform="rotate(${rot} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`);
  }
  // Highlights (paper catches light)
  const highlights=[];
  for(let i=0;i<(big?4:3);i++){
    const cx=30+Math.random()*140,cy=30+Math.random()*140;
    const rx=6+Math.random()*10,ry=3+Math.random()*6;
    const rot=Math.floor(Math.random()*180);
    highlights.push(`<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="url(#${uid}-hl)" opacity="${(0.35+Math.random()*0.3).toFixed(2)}" transform="rotate(${rot} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`);
  }
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="${uid}-paper" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#fffdf5"/>
        <stop offset="35%" stop-color="#f6f0dc"/>
        <stop offset="70%" stop-color="#d9cfb3"/>
        <stop offset="100%" stop-color="#a39678"/>
      </radialGradient>
      <radialGradient id="${uid}-dent" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(60,40,10,0.35)"/>
        <stop offset="100%" stop-color="rgba(60,40,10,0)"/>
      </radialGradient>
      <radialGradient id="${uid}-hl" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="rgba(255,253,240,0.9)"/>
        <stop offset="100%" stop-color="rgba(255,253,240,0)"/>
      </radialGradient>
      <filter id="${uid}-rough" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${Math.floor(Math.random()*100)}"/>
        <feDisplacementMap in="SourceGraphic" scale="${big?2.5:1.5}"/>
      </filter>
    </defs>
    <g filter="url(#${uid}-rough)">
      <path d="${blob}" fill="url(#${uid}-paper)" stroke="rgba(110,85,45,0.4)" stroke-width="${big?1.2:0.8}"/>
      ${dents.join('')}
      ${highlights.join('')}
      ${creases.join('')}
    </g>
  </svg>`;
}

// ── Data loaders ─────────────────────────────────────────────
async function loadRevealFixtures(){
  const sel=document.getElementById('rv-fixture-sel');
  sel.innerHTML='<option value="">— Select match —</option>';
  document.getElementById('rv-stage').style.display='none';
  document.getElementById('rv-picker-hint').textContent='Loading...';

  // Fetch all sessions in this season (any status — we want to handle already-revealed too)
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

  // Load full session + votes
  const{data:session}=await sb.from('match_vote_sessions')
    .select('id,fixture_id,status,whc_goals,opp_goals,eligible_players,fixtures!inner(opponent,match_date)')
    .eq('id',sessionId).single();
  const{data:votes}=await sb.from('match_votes')
    .select('*').eq('session_id',sessionId).order('created_at',{ascending:true});

  rvSession=session;
  rvVotes=votes||[];

  // Rebuild tallies from already-revealed votes (handles page refresh mid-reveal)
  rvMomTally={};rvDodTally={};
  rvVotes.filter(v=>v.revealed).forEach(v=>{
    rvMomTally[v.mom_vote]=(rvMomTally[v.mom_vote]||0)+1;
    rvDodTally[v.dod_vote]=(rvDodTally[v.dod_vote]||0)+1;
  });

  document.getElementById('rv-stage').style.display='block';
  renderRevealPile();
  renderTally('mom');
  renderTally('dod');

  // If all revealed already, show confirm section straight away
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

  // Mark revealed in DB first (optimistic)
  try{
    await sb.from('match_votes').update({revealed:true,revealed_at:new Date().toISOString()}).eq('id',voteId);
  }catch(e){
    console.error('Failed to mark revealed:',e);
    rvRevealing=false;
    return;
  }
  vote.revealed=true;

  // Update tallies
  rvMomTally[vote.mom_vote]=(rvMomTally[vote.mom_vote]||0)+1;
  rvDodTally[vote.dod_vote]=(rvDodTally[vote.dod_vote]||0)+1;

  // Ball fades from pile
  ballEl.classList.add('discarded');

  // Open full-screen overlay
  const overlay=document.getElementById('rv-overlay');
  const bigBall=document.getElementById('rv-ball-big');
  const paper=document.getElementById('rv-paper');
  const doneBtn=document.getElementById('rv-done-btn');

  // Inject a freshly-generated big paper ball SVG
  bigBall.innerHTML=buildPaperBallSVG(280);

  // Populate paper content
  document.getElementById('rv-paper-mom-name').textContent=vote.mom_vote;
  document.getElementById('rv-paper-mom-reason').textContent='"'+vote.mom_reason+'"';
  document.getElementById('rv-paper-dod-name').textContent=vote.dod_vote;
  document.getElementById('rv-paper-dod-reason').textContent='"'+vote.dod_reason+'"';

  // Reset animation states
  bigBall.className='rv-ball-big';
  paper.className='rv-paper';
  doneBtn.style.display='none';
  void bigBall.offsetWidth;  // force reflow

  overlay.classList.add('open');

  // Stage 1: ball flies in
  setTimeout(()=>bigBall.classList.add('animating'),50);
  // Stage 2: ball unfolds (after 0.7s)
  setTimeout(()=>bigBall.classList.add('unfolding'),750);
  // Stage 3: paper reveals (triggered by its own animation-delay in CSS)
  setTimeout(()=>paper.classList.add('reveal'),800);
  // Stage 4: show done button
  setTimeout(()=>{doneBtn.style.display='inline-block';},1700);
}

function dismissReveal(){
  const overlay=document.getElementById('rv-overlay');
  overlay.classList.remove('open');
  rvRevealing=false;

  // Remove the ball element from pile (it animated out)
  setTimeout(()=>{
    // Re-render pile to sync — discarded ball is removed, count updates
    renderRevealPile();
    renderTally('mom');
    renderTally('dod');

    // Check if all revealed now
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

  // Populate dropdowns — full player list, leaders first
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

  // Render stats grid with only eligible players
  const tbody=document.getElementById('rv-stats-rows');
  tbody.innerHTML='';
  const eligible=rvSession.eligible_players||[];
  // Fallback: if no eligible list, show all players
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
    // 1. Update fixtures row
    const{error:fe}=await sb.from('fixtures').update({
      whc_goals:gf,opp_goals:ga,result,match_points:pts,mom,dod
    }).eq('id',rvSession.fixture_id);
    if(fe)throw fe;

    // 2. Build match_stats inserts
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
      // Delete any existing rows for this fixture first (in case of re-finalise)
      await sb.from('match_stats').delete().eq('fixture_id',rvSession.fixture_id);
      const{error:se}=await sb.from('match_stats').insert(inserts);
      if(se)throw se;
    }

    // 3. Mark session complete
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

// ── PWA ───────────────────────────────────────────────────────
const mb=new Blob([JSON.stringify({name:'WHC Hockey',short_name:'WHC',start_url:'/',display:'standalone',background_color:'#120810',theme_color:'#6B1E3A'})],{type:'application/json'});
const ml=document.createElement('link');ml.rel='manifest';ml.href=URL.createObjectURL(mb);document.head.appendChild(ml);

init();
