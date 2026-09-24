const stops=[
{id:"hess",name:"Hess Recreation Area",type:"Recreation area",place:"Danville, PA",address:"843 Meadow Ln, Danville, PA 17821",tripMinutes:145,detour:6,minutes:26,grass:5,traffic:4,restrooms:5,fenced:1,lighting:3,relief:false,tags:["🌱 115-acre recreation area","🐕 Leashed dogs permitted","🚻 Year-round restrooms","🚗 Parking"],why:"Large public recreation area with fields and trails, while avoiding a concentrated highway pet-relief area.",confidence:"High",provenance:"Official MARC park page + official park rules",source:"https://montourrec.com/hess-fields/",caveat:"Dog traffic and current grass condition are not live-verified.",reports:{grass:"Good",traffic:"Low",clean:"Good"},verified:"Prototype demo observation"},
{id:"brandy",name:"Brandy Springs Park",type:"Community park",place:"Mercer, PA",address:"197 William T Wardle Dr, Mercer, PA 16137",tripMinutes:295,detour:7,minutes:31,grass:4,traffic:2,restrooms:3,fenced:4,lighting:3,relief:true,tags:["🌱 Community park","🚗 Parking","🐕 Dog facilities on site","🧺 Recreation space"],why:"A substantial community park near the corridor. A dedicated dog area lowers the match when you prefer to avoid concentrated dog-relief spaces.",confidence:"Medium",provenance:"Official park site + current place data",source:"https://www.brandyspringspark.com/",caveat:"Field verification of pet access outside the dedicated dog park is still needed.",reports:{grass:"Good",traffic:"Medium",clean:"Unknown"},verified:"Demo data only"},
{id:"mill",name:"Mill Creek Park",type:"MetroPark",place:"Youngstown, OH",address:"1001 Canfield Rd, Youngstown, OH 44511",tripMinutes:435,detour:7,minutes:24,grass:5,traffic:3,restrooms:3,fenced:1,lighting:3,relief:false,tags:["🌳 Large park system","🐕 Leashed pets on trails + drives","🚗 Parking","🥾 Walking options"],why:"A large park system where leashed pets are explicitly permitted on trails and drives, offering more room than a highway relief area.",confidence:"High",provenance:"Official Mill Creek MetroParks rules + park information",source:"https://www.millcreekmetroparks.org/park-rules-regulations/",caveat:"Pets are not permitted in picnic, recreation, or garden areas; navigation should target a pet-permitted access point.",reports:{grass:"Good",traffic:"Medium",clean:"Good"},verified:"Demo data only"},
{id:"wildwood",name:"Wildwood Preserve Metropark",type:"Nature preserve",place:"Toledo, OH",address:"5100 W Central Ave, Toledo, OH 43615",tripMinutes:575,detour:6,minutes:29,grass:5,traffic:3,restrooms:5,fenced:1,lighting:2,relief:false,tags:["🌱 493-acre preserve","🐕 Dogs welcome on leash","🚗 Designated parking","🥾 Trails"],why:"Large preserve with extensive outdoor space. Metroparks Toledo explicitly welcomes leashed dogs in Wildwood.",confidence:"High",provenance:"Official Metroparks Toledo Wildwood page + park rules",source:"https://metroparkstoledo.com/wildwoodpreserve",caveat:"Open 7 a.m. to dark. Current dog traffic and grass condition need community verification.",reports:{grass:"Excellent",traffic:"Medium",clean:"Good"},verified:"Demo data only"},
{id:"patrick",name:"St. Patrick's County Park",type:"County park",place:"South Bend, IN",address:"50651 Laurel Rd, South Bend, IN 46637",tripMinutes:700,detour:7,minutes:33,grass:5,traffic:4,restrooms:5,fenced:1,lighting:3,relief:false,tags:["🌳 398 acres","🐕 Leashed dogs documented","🚻 Restrooms","🚗 Parking"],why:"Large county park with trails and practical traveler amenities, with leashed dogs documented in current county programming.",confidence:"High",provenance:"Official St. Joseph County park + facilities information",source:"https://www.sjcparks.org/592/St-Patricks-County-Park",caveat:"Hours and possible seasonal vehicle fees should be checked at trip time.",reports:{grass:"Good",traffic:"Low",clean:"Good"},verified:"Demo data only"},
{id:"rest",name:"I-80 Highway Rest Area",type:"Rest area",place:"Danville area, PA",address:"I-80 Rest Area, Danville, PA",tripMinutes:130,detour:0,minutes:14,grass:2,traffic:1,restrooms:5,fenced:1,lighting:5,relief:true,tags:["↪ Direct highway access","🚻 Restrooms","🐕 Pet area","💡 Lighting"],why:"The fastest option with essentially no route detour, but it conflicts with a preference to avoid concentrated pet-relief areas.",confidence:"Medium",provenance:"Public highway/rest-area information",source:"https://www.pa.gov/agencies/penndot",caveat:"Dog traffic and pet-area condition are unknown.",reports:{grass:"Limited",traffic:"High",clean:"Unknown"},verified:"Demo data only"}
];

const $=id=>document.getElementById(id);
let preferences={grass:true,traffic:true,restrooms:true,detour:true,fenced:false,lighting:false};
const tripDuration=780;
let lifeStage="Puppy", cadenceMinutes=150;
let avoidRelief=true, maxDetour=10, dogName="Conan", current=null, urgentWindow=30;

document.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{b.classList.toggle("active");preferences[b.dataset.pref]=b.classList.contains("active")});
document.querySelectorAll(".time-pill").forEach(b=>b.onclick=()=>{document.querySelectorAll(".time-pill").forEach(x=>x.classList.remove("active"));b.classList.add("active");urgentWindow=+b.dataset.window;renderUrgent(bestForWindow(urgentWindow))});

function scoreStop(s){
  let earned=0,possible=0;
  const add=(enabled,value)=>{if(enabled){earned+=value;possible+=5}};
  add(preferences.grass,s.grass);
  add(preferences.traffic,s.traffic);
  add(preferences.restrooms,s.restrooms);
  add(preferences.fenced,s.fenced);
  add(preferences.lighting,s.lighting);
  if(preferences.detour){possible+=5;earned+=Math.max(0,5-(s.detour/Math.max(maxDetour,1))*3)}
  if(avoidRelief){possible+=5;earned+=s.relief?0:5}
  const raw=possible?earned/possible:0.7;
  // Traffic scores run from 1 (high traffic) to 5 (low traffic).
  const lifeBonus=lifeStage==="Puppy"?(s.traffic-3)*1.5:lifeStage==="Senior"?Math.max(-3,3-s.detour/2):0;
  const excessPenalty=s.detour>maxDetour?10+(s.detour-maxDetour)*6:0;
  return Math.max(0,Math.min(98,Math.round(raw*100+lifeBonus-excessPenalty)));
}
function rankedStops(){return stops.map(s=>({...s,match:scoreStop(s)})).sort((a,b)=>b.match-a.match||a.detour-b.detour)}
function navUrl(s){return "https://www.google.com/maps/dir/?api=1&destination="+encodeURIComponent(s.address)}
function prov(s){return `<strong>${s.confidence} confidence</strong><br>${s.provenance}<br><a class="source-link" href="${s.source}" target="_blank" rel="noopener">View source ↗</a>`}
function reason(s){
  const reasons=[];
  if(preferences.grass&&s.grass>=4) reasons.push("large green space");
  if(preferences.traffic&&s.traffic>=4) reasons.push("lower expected dog traffic");
  if(preferences.restrooms&&s.restrooms>=4) reasons.push("restrooms");
  if(preferences.detour&&s.detour<=7) reasons.push("small route detour");
  if(avoidRelief&&!s.relief) reasons.push("not a dedicated highway dog-relief area");
  return reasons.length?`It matches your priorities for ${reasons.slice(0,-1).join(", ")}${reasons.length>1?" and ":""}${reasons.slice(-1)}.`:s.why;
}
function formatMinutes(minutes){return `${Math.floor(minutes/60)}h ${minutes%60}m`}
function plannedTargets(){
  const targets=[];
  for(let t=cadenceMinutes;t<tripDuration;t+=cadenceMinutes) targets.push(t);
  return targets;
}
function planStops(){
  let lastTripMinute=-1;
  const used=new Set();
  // Limit candidates to half a cadence: sparse demo coverage is shown as a gap.
  const radius=cadenceMinutes/2;
  return plannedTargets().map(target=>{
    const candidates=rankedStops().filter(s=>!used.has(s.id)&&s.tripMinutes>lastTripMinute&&Math.abs(s.tripMinutes-target)<=radius);
    // Quality supplies 70% of the fit; timing supplies up to 30 points.
    const fit=s=>s.match*0.7+30*(1-Math.abs(s.tripMinutes-target)/radius);
    candidates.sort((a,b)=>fit(b)-fit(a)||Math.abs(a.tripMinutes-target)-Math.abs(b.tripMinutes-target)||a.detour-b.detour);
    const stop=candidates[0];
    if(!stop) return {target,stop:null};
    used.add(stop.id);lastTripMinute=stop.tripMinutes;
    return {target,stop};
  });
}
function timingLabel(actual,target){
  const delta=actual-target;
  if(Math.abs(delta)<=15) return "Close to planned break";
  return delta<0?`${-delta} min early`:`${delta} min after planned break`;
}
function renderStops(){
  $("routeLogic").textContent=`Break targets every ${formatMinutes(cadenceMinutes)} on the approximately 13-hour demo trip. Nearby stops balance timing with your preferences; life stage adds a small planning preference. Gaps indicate limited demo coverage.`;
  $("stops").innerHTML=planStops().map(({target,stop:s},i)=>s?`<article class="stop">
    <div class="rec-label">PLANNED BREAK ${i+1} · ${formatMinutes(target)}</div>
    <div class="stop-head"><div><h3>${s.name}</h3><p class="place">${s.place}</p></div><span class="match">${s.match}% PAWSTOP MATCH</span></div>
    <p class="meta">Actual stop: ~${formatMinutes(s.tripMinutes)} into trip · ${timingLabel(s.tripMinutes,target)}<br>+${s.detour} min estimated detour${s.detour>maxDetour?" · Above selected detour limit":""}</p>
    <div class="tags">${s.tags.map(t=>`<span>${t}</span>`).join("")}</div>
    <div class="stop-actions"><button onclick="showWhy('${s.id}')">Why this stop?</button><button onclick="window.open('${navUrl(s)}','_blank')">Navigate ↗</button></div>
    <div id="why-${s.id}" class="data-note hidden">${reason(s)}<br><br>${prov(s)}</div>
  </article>`:`<article class="stop"><h3>Planned break ${i+1} · ${formatMinutes(target)}</h3><p class="meta">No unused demo stop near this target. Plan an additional stop for this gap.</p></article>`).join("");
}
window.showWhy=id=>$("why-"+id).classList.toggle("hidden");

$("planBtn").onclick=()=>{
  dogName=$("dog").value.trim()||"Your dog";
  avoidRelief=$("avoidRelief").checked;
  maxDetour=+$("detour").value;
  lifeStage=$("age").value;
  cadenceMinutes=+$("break").value*60;
  $("routeFrom").textContent=$("from").value;
  $("routeTo").textContent=$("to").value;
  $("dogName").textContent=dogName;
  $("profile").textContent=$("age").value;
  $("breakPlan").textContent="Every "+$("break").selectedOptions[0].text;
  $("maxDetour").textContent=maxDetour+" min";
  $("needText").textContent=dogName+" needs a stop";
  renderStops();
  $("planner").classList.add("hidden");$("route").classList.remove("hidden");scrollTo(0,0)
};
$("backBtn").onclick=()=>{$("route").classList.add("hidden");$("planner").classList.remove("hidden");scrollTo(0,0)};

function urgentRank(windowMins){
  const ranked=rankedStops();
  const within=ranked.filter(s=>s.minutes<=windowMins);
  const candidates=within.length?within:ranked;
  const weights=windowMins<=15?{quality:0.2,time:3,detour:3}:windowMins<=30?{quality:0.65,time:1,detour:1.5}:{quality:1,time:0.2,detour:0.5};
  const fit=s=>weights.quality*s.match-weights.time*s.minutes-weights.detour*s.detour;
  // If nothing is within the window, show the soonest option and label it honestly.
  return candidates.sort((a,b)=>(within.length?0:a.minutes-b.minutes)||fit(b)-fit(a)||a.detour-b.detour);
}
function bestForWindow(windowMins){return urgentRank(windowMins)[0]}
function renderUrgent(s){
  current=s;
  $("urgentTitle").textContent=`Best stop ahead for ${dogName}`;
  $("urgentMatch").textContent=s.match+"% MATCH";
  $("urgentType").textContent=s.type.toUpperCase();
  $("urgentName").textContent=s.name;
  $("urgentPlace").textContent=s.place;
  $("urgentMinutes").textContent=s.minutes;
  $("urgentDetour").textContent=(s.detour?`+${s.detour} min`:"No")+" estimated route detour";
  const within=s.minutes<=urgentWindow;
  $("urgentStatus").textContent=within?`Within your ${urgentWindow}-minute window · demo estimate`:`Outside your ${urgentWindow}-minute window by ${s.minutes-urgentWindow} min · demo estimate`;
  $("urgentStatus").classList.toggle("warning",!within);
  $("urgentFeatures").innerHTML=s.tags.map(t=>`<span>${t}</span>`).join("");
  $("urgentWhy").textContent=reason(s);
  $("communityGrid").innerHTML=`
    <div class="report"><span>Grass</span><strong>${s.reports.grass}</strong></div>
    <div class="report"><span>Dog traffic</span><strong>${s.reports.traffic}</strong></div>
    <div class="report"><span>Cleanliness</span><strong>${s.reports.clean}</strong></div>`;
  $("lastVerified").textContent="Prototype community layer · "+s.verified;
  $("urgentConfidence").innerHTML=prov(s);
  $("urgentCaveat").textContent=s.caveat;
}
$("needStop").onclick=()=>{
  urgentWindow=30;
  document.querySelectorAll(".time-pill").forEach(b=>b.classList.toggle("active",b.dataset.window==="30"));
  renderUrgent(bestForWindow(30));
  $("route").classList.add("hidden");$("urgent").classList.remove("hidden");scrollTo(0,0)
};
$("urgentBack").onclick=()=>{$("urgent").classList.add("hidden");$("route").classList.remove("hidden");scrollTo(0,0)};
$("navBtn").onclick=()=>window.open(navUrl(current),"_blank");

document.querySelectorAll("[data-alt]").forEach(b=>b.onclick=()=>{
  const rs=urgentRank(urgentWindow);
  let s;
  if(b.dataset.alt==="best") s=rs[0];
  if(b.dataset.alt==="fastest") s=[...rs].sort((a,b)=>a.minutes-b.minutes||a.detour-b.detour)[0];
  if(b.dataset.alt==="grass") s=[...rs].sort((a,b)=>b.grass-a.grass||b.match-a.match)[0];
  if(b.dataset.alt==="restrooms") s=[...rs].sort((a,b)=>b.restrooms-a.restrooms||b.match-a.match)[0];
  renderUrgent(s||bestForWindow(urgentWindow));
});
