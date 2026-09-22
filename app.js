const stops=[
{id:"hess",name:"Hess Recreation Area",type:"Recreation area",place:"Danville, PA",address:"843 Meadow Ln, Danville, PA 17821",time:"~2h 25m",detour:6,minutes:26,grass:5,traffic:4,restrooms:5,fenced:1,lighting:3,relief:false,tags:["🌱 115-acre recreation area","🐕 Leashed dogs permitted","🚻 Year-round restrooms","🚗 Parking"],why:"Large public recreation area with fields and trails, while avoiding a concentrated highway pet-relief area.",confidence:"High",provenance:"Official MARC park page + official park rules",source:"https://montourrec.com/hess-fields/",caveat:"Dog traffic and current grass condition are not live-verified.",reports:{grass:"Good",traffic:"Low",clean:"Good"},verified:"Prototype demo observation"},
{id:"brandy",name:"Brandy Springs Park",type:"Community park",place:"Mercer, PA",address:"197 William T Wardle Dr, Mercer, PA 16137",time:"~4h 55m",detour:7,minutes:31,grass:4,traffic:2,restrooms:3,fenced:4,lighting:3,relief:true,tags:["🌱 Community park","🚗 Parking","🐕 Dog facilities on site","🧺 Recreation space"],why:"A substantial community park near the corridor. A dedicated dog area lowers the match when you prefer to avoid concentrated dog-relief spaces.",confidence:"Medium",provenance:"Official park site + current place data",source:"https://www.brandyspringspark.com/",caveat:"Field verification of pet access outside the dedicated dog park is still needed.",reports:{grass:"Good",traffic:"Medium",clean:"Unknown"},verified:"Demo data only"},
{id:"mill",name:"Mill Creek Park",type:"MetroPark",place:"Youngstown, OH",address:"1001 Canfield Rd, Youngstown, OH 44511",time:"~7h 15m",detour:7,minutes:24,grass:5,traffic:3,restrooms:3,fenced:1,lighting:3,relief:false,tags:["🌳 Large park system","🐕 Leashed pets on trails + drives","🚗 Parking","🥾 Walking options"],why:"A large park system where leashed pets are explicitly permitted on trails and drives, offering more room than a highway relief area.",confidence:"High",provenance:"Official Mill Creek MetroParks rules + park information",source:"https://www.millcreekmetroparks.org/park-rules-regulations/",caveat:"Pets are not permitted in picnic, recreation, or garden areas; navigation should target a pet-permitted access point.",reports:{grass:"Good",traffic:"Medium",clean:"Good"},verified:"Demo data only"},
{id:"wildwood",name:"Wildwood Preserve Metropark",type:"Nature preserve",place:"Toledo, OH",address:"5100 W Central Ave, Toledo, OH 43615",time:"~9h 35m",detour:6,minutes:29,grass:5,traffic:3,restrooms:5,fenced:1,lighting:2,relief:false,tags:["🌱 493-acre preserve","🐕 Dogs welcome on leash","🚗 Designated parking","🥾 Trails"],why:"Large preserve with extensive outdoor space. Metroparks Toledo explicitly welcomes leashed dogs in Wildwood.",confidence:"High",provenance:"Official Metroparks Toledo Wildwood page + park rules",source:"https://metroparkstoledo.com/wildwoodpreserve",caveat:"Open 7 a.m. to dark. Current dog traffic and grass condition need community verification.",reports:{grass:"Excellent",traffic:"Medium",clean:"Good"},verified:"Demo data only"},
{id:"patrick",name:"St. Patrick's County Park",type:"County park",place:"South Bend, IN",address:"50651 Laurel Rd, South Bend, IN 46637",time:"~11h 40m",detour:7,minutes:33,grass:5,traffic:4,restrooms:5,fenced:1,lighting:3,relief:false,tags:["🌳 398 acres","🐕 Leashed dogs documented","🚻 Restrooms","🚗 Parking"],why:"Large county park with trails and practical traveler amenities, with leashed dogs documented in current county programming.",confidence:"High",provenance:"Official St. Joseph County park + facilities information",source:"https://www.sjcparks.org/592/St-Patricks-County-Park",caveat:"Hours and possible seasonal vehicle fees should be checked at trip time.",reports:{grass:"Good",traffic:"Low",clean:"Good"},verified:"Demo data only"},
{id:"rest",name:"I-80 Highway Rest Area",type:"Rest area",place:"Danville area, PA",address:"I-80 Rest Area, Danville, PA",time:"~2h 10m",detour:0,minutes:14,grass:2,traffic:1,restrooms:5,fenced:1,lighting:5,relief:true,tags:["↪ Direct highway access","🚻 Restrooms","🐕 Pet area","💡 Lighting"],why:"The fastest option with essentially no route detour, but it conflicts with a preference to avoid concentrated pet-relief areas.",confidence:"Medium",provenance:"Public highway/rest-area information",source:"https://www.pa.gov/agencies/penndot",caveat:"Dog traffic and pet-area condition are unknown.",reports:{grass:"Limited",traffic:"High",clean:"Unknown"},verified:"Demo data only"}
];

const $=id=>document.getElementById(id);
let preferences={grass:true,traffic:true,restrooms:true,detour:true,fenced:false,lighting:false};
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
  if(s.detour>maxDetour) earned-=3;
  const raw=possible?earned/possible:0.7;
  return Math.max(45,Math.min(98,Math.round(raw*100)));
}
function rankedStops(){return stops.filter(s=>s.id!=="rest"||true).map(s=>({...s,match:scoreStop(s)})).sort((a,b)=>b.match-a.match||a.detour-b.detour)}
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
function renderStops(){
  const ranked=rankedStops().filter(s=>s.id!=="rest").slice(0,5);
  $("stops").innerHTML=ranked.map((s,i)=>`<article class="stop ${i===0?"recommended":""}">
    ${i===0?'<div class="rec-label">BEST MATCH FOR '+dogName.toUpperCase()+'</div>':""}
    <div class="stop-head"><div><h3>${i+1}. ${s.name}</h3><p class="place">${s.place}</p></div><span class="match">${s.match}% MATCH</span></div>
    <p class="meta">${s.time} into trip · +${s.detour} min estimated detour</p>
    <div class="tags">${s.tags.map(t=>`<span>${t}</span>`).join("")}</div>
    <div class="stop-actions"><button onclick="showWhy('${s.id}')">Why this stop?</button><button onclick="window.open('${navUrl(s)}','_blank')">Navigate ↗</button></div>
    <div id="why-${s.id}" class="data-note hidden">${reason(s)}<br><br>${prov(s)}</div>
  </article>`).join("");
}
window.showWhy=id=>$("why-"+id).classList.toggle("hidden");

$("planBtn").onclick=()=>{
  dogName=$("dog").value.trim()||"Your dog";
  avoidRelief=$("avoidRelief").checked;
  maxDetour=+$("detour").value;
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

function bestForWindow(windowMins){
  const candidates=rankedStops().filter(s=>s.minutes<=windowMins);
  return candidates[0]||rankedStops().sort((a,b)=>a.minutes-b.minutes)[0];
}
function renderUrgent(s){
  current=s;
  $("urgentTitle").textContent=`Best stop ahead for ${dogName}`;
  $("urgentMatch").textContent=s.match+"% MATCH";
  $("urgentType").textContent=s.type.toUpperCase();
  $("urgentName").textContent=s.name;
  $("urgentPlace").textContent=s.place;
  $("urgentMinutes").textContent=s.minutes;
  $("urgentDetour").textContent=(s.detour?`+${s.detour} min`:"No")+" estimated route detour";
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
  const rs=rankedStops().filter(s=>s.minutes<=urgentWindow);
  let s;
  if(b.dataset.alt==="best") s=rs[0];
  if(b.dataset.alt==="fastest") s=[...rs].sort((a,b)=>a.minutes-b.minutes||a.detour-b.detour)[0];
  if(b.dataset.alt==="grass") s=[...rs].sort((a,b)=>b.grass-a.grass||b.match-a.match)[0];
  if(b.dataset.alt==="restrooms") s=[...rs].sort((a,b)=>b.restrooms-a.restrooms||b.match-a.match)[0];
  renderUrgent(s||bestForWindow(urgentWindow));
});
