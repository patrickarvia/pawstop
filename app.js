const stops=[
{name:"Hess Recreation Area",place:"Danville, PA",time:"~2h 25m",detour:"+6 min",match:94,tags:["🌱 Large green space","🚻 Restrooms","🚗 Parking"]},
{name:"Western PA Green Stop",place:"I-80 corridor, PA",time:"~4h 55m",detour:"+5 min",match:89,tags:["🌱 Open field","🐕 Leashed dogs","↪ Easy return"]},
{name:"Youngstown Green Stop",place:"Youngstown, OH",time:"~7h 15m",detour:"+4 min",match:87,tags:["🌱 Public park","🚗 Parking","🐕 Dogs permitted"]},
{name:"Wildwood Preserve",place:"Toledo, OH",time:"~9h 35m",detour:"+6 min",match:93,tags:["🌱 Meadows + trails","🐕 Dogs welcome","🚗 Parking"]},
{name:"South Bend Green Stop",place:"South Bend, IN",time:"~11h 40m",detour:"+5 min",match:88,tags:["🌱 Green space","🐕 Leashed dogs","🚫 Not a dog run"]}
];
const $=id=>document.getElementById(id);
document.querySelectorAll(".chip").forEach(x=>x.onclick=()=>x.classList.toggle("active"));
$("planBtn").onclick=()=>{
 const dog=$("dog").value.trim()||"Your dog";
 $("routeFrom").textContent=$("from").value;$("routeTo").textContent=$("to").value;
 $("dogName").textContent=dog;$("profile").textContent=$("age").value+" · breaks every "+$("break").value;
 $("needText").textContent=dog+" needs a stop";
 $("stops").innerHTML=stops.map((s,i)=>`<article class="stop"><div class="stop-head"><div><h3>${i+1}. ${s.name}</h3><p class="place">${s.place}</p></div><span class="match">${s.match}% MATCH</span></div><p class="meta">${s.time} into trip · ${s.detour} detour</p><div class="tags">${s.tags.map(t=>`<span>${t}</span>`).join("")}</div></article>`).join("");
 $("planner").classList.add("hidden");$("route").classList.remove("hidden");scrollTo(0,0);
};
$("backBtn").onclick=()=>{$("route").classList.add("hidden");$("planner").classList.remove("hidden");scrollTo(0,0)};
$("needStop").onclick=()=>{$("route").classList.add("hidden");$("urgent").classList.remove("hidden");scrollTo(0,0)};
$("urgentBack").onclick=()=>{$("urgent").classList.add("hidden");$("route").classList.remove("hidden");scrollTo(0,0)};
