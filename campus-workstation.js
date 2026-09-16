// campus-plan.js
/* Campus and recovery time are reserved before learning tasks are allocated. */
window.CampusPlan = (() => {
 const effective='2026-09-16';
 const defaults={breakMinutes:10,napMinutes:30,leisureMinutes:90,breakfastMinutes:20,runsPerWeek:3,runMinutes:45,gymMinutes:60,gymStart:'2026-10-07'};
 function reserve({windows,school,profile,activity,events=[]}){
  const busy=school.map(item=>({...item})),fixed=[],warnings=[];
  const start=windows[0]?.[0]??480,end=windows.at(-1)?.[1]??1320;
  const add=(a,b,label,kind)=>{a=Math.max(start,a);b=Math.min(end,b);if(b>a){const row={start:a,end:b,label,kind};fixed.push(row);busy.push(row);return row}};
  events.forEach(event=>add(event.start,event.end,event.label,'event'));
  add(720,765,'午饭','meal');add(765,765+profile.napMinutes,'午休','rest');
  const takeWhole=(minutes,ranges,label,kind)=>{for(const range of ranges){const slot=StudyPlanner.subtract([[Math.max(start,range[0]),Math.min(end,range[1])]],busy).find(s=>s.end-s.start>=minutes);if(slot)return add(slot.start,slot.start+minutes,label,kind)}return null};
  let activitySlot=null,breakfast=null;
  if(activity?.kind==='run'&&activity.ranges?.some(r=>r[0]<720)){
   const slot=takeWhole(profile.runMinutes+profile.breakfastMinutes,activity.ranges.filter(r=>r[0]<720),'运动与早餐','reserved');
   if(slot){fixed.splice(fixed.indexOf(slot),1);busy.splice(busy.indexOf(slot),1);activitySlot=add(slot.start,slot.start+profile.runMinutes,'3 公里跑步 · 含热身与整理','exercise');breakfast=add(activitySlot.end,slot.end,'跑后早餐','meal')}
  }
  if(!breakfast&&!takeWhole(profile.breakfastMinutes,[[start,720]],'早餐','meal'))warnings.push('上午没有完整早餐空档，请核对课程或事务时段。');
  let leisure=profile.leisureMinutes;
  // Use the end of the evening first, and an earlier evening gap on night-class days.
  for(const slot of StudyPlanner.subtract([[Math.max(start,1050),end]],busy).reverse()){
   const minutes=Math.min(leisure,slot.end-slot.start);if(minutes<10)continue;
   add(slot.end-minutes,slot.end,'自由休息 / 娱乐','leisure');leisure-=minutes;if(!leisure)break;
  }
  if(leisure)warnings.push('晚间娱乐还有 '+leisure+' 分钟未能排入；请调整额外事务，不延长到 22:00 之后。');
  if(activity&&!activitySlot)activitySlot=takeWhole(activity.minutes,activity.ranges||[],activity.kind==='gym'?'力量训练 · '+activity.title:'3 公里跑步 · 含热身与整理','exercise');
  if(activity&&!activitySlot)warnings.push('没有可用的完整空课时段容纳本次运动，保留待安排；可调整额外事务。');
  return {busy,fixed,activitySlot,warnings,leisureReserved:profile.leisureMinutes-leisure};
 }
 return {effective,defaults,reserve};
})();

let dayProfile={},campusEvents=[],dailyLedger={},dailyProgress={},cardioLogs={},planningHistory=null;
const campusRunCache=new Map();
function initCampusPlan(){
 dayProfile={...CampusPlan.defaults,...read('tri-day-profile',{})};
 campusEvents=read('tri-campus-events',[]);dailyLedger=read('tri-daily-ledger-v2',{});dailyProgress=read('tri-daily-progress-v2',{});cardioLogs=read('tri-cardio-logs',{});planningHistory=read('tri-planning-history-v2',null);
 if(!localStorage.getItem('tri-nutrition-profile-v2')){if(nutritionProfile.weight===72&&nutritionProfile.sex==='male'){write('tri-nutrition-profile-before-v2',nutritionProfile);nutritionProfile={...nutritionProfile,age:20,weight:73.4};write('tri-nutrition-profile',nutritionProfile)}localStorage.setItem('tri-nutrition-profile-v2','20260916')}
}
function profileForDate(date){return dateKey(date)<CampusPlan.effective&&planningHistory?.timing?planningHistory.timing:studyTiming}
function campusFreeHalfDays(date){
 const blocked=[...dayConstraints(date).busy,...personalEventsFor(date)];
 return [[480,720],[840,1050],[1140,1320]].filter(([a,b])=>!blocked.some(x=>x.start<b&&x.end>a));
}
function campusRunWeek(date){
 const monday=new Date(date);monday.setDate(monday.getDate()-(monday.getDay()+6)%7);monday.setHours(0,0,0,0);
 const cacheKey=dateKey(monday)+'-'+(window.campusPlanningRevision||0)+'-'+dateKey();if(campusRunCache.has(cacheKey))return campusRunCache.get(cacheKey);
 const rows=[];for(let i=0;i<7;i++){const d=new Date(monday);d.setDate(d.getDate()+i);const key=dateKey(d);if(key<CampusPlan.effective||key>=fitnessSettings.start)continue;const old=dailyLedger['activity-'+key],recorded=key<dateKey()&&key<=(localStorage.getItem('tri-daily-ledger-through')||'');if(recorded&&!old)continue;
  const ranges=campusFreeHalfDays(d),constraints=dayConstraints(d),schoolMinutes=constraints.busy.reduce((n,x)=>n+x.end-x.start,0),studyMinutes=[...studyTasksFor(d),...courseSupplementsFor(d)].reduce((n,t)=>n+t.minutes,0),locked=!!(cardioLogs[key]?.complete||(recorded&&old?.activity==='run'));
  if(ranges.length||locked)rows.push({date:key,day:i,ranges,locked,score:ranges.length*100+(840-schoolMinutes-studyMinutes)/10});
 }
 let best=[],score=-Infinity;const target=Math.min(rows.length,Math.max(1,dayProfile.runsPerWeek||3));
 for(let mask=0;mask<(1<<rows.length);mask++){const selected=rows.filter((_,i)=>mask&(1<<i));if(selected.length!==target||rows.some(r=>r.locked&&!selected.includes(r)))continue;let value=selected.reduce((n,r)=>n+r.score,0);for(let i=1;i<selected.length;i++)if(selected[i].day-selected[i-1].day===1)value-=1000;const previous=new Date(monday);previous.setDate(previous.getDate()-1);if(selected[0]?.day===0&&(cardioLogs[dateKey(previous)]?.complete||dailyLedger['activity-'+dateKey(previous)]?.activity==='run'))value-=1000;if(value>score){score=value;best=selected}}
 if(!best.length)best=rows.filter(r=>r.locked);
 const result={days:best,target:dayProfile.runsPerWeek||3};if(campusRunCache.size>32)campusRunCache.clear();campusRunCache.set(cacheKey,result);return result;
}
function campusActivityFor(date){
 const key=dateKey(date);if(key<CampusPlan.effective)return null;
 if(key<fitnessSettings.start){const day=campusRunWeek(date).days.find(d=>d.date===key);return day?{kind:'run',title:'3 公里跑步',minutes:dayProfile.runMinutes,ranges:day.ranges}:null}
 const info=fitnessInfoFor(date);return info.type==='workout'?{kind:'gym',title:info.muscle.title,minutes:dayProfile.gymMinutes,ranges:campusFreeHalfDays(date)}:null;
}
function personalEventsFor(date){const key=dateKey(date);return campusEvents.filter(e=>e.startDate<=key&&e.endDate>=key&&(!e.days||e.days.includes(date.getDay()))).map(e=>({start:StudyPlanner.clock(e.start),end:StudyPlanner.clock(e.end),label:e.title,id:e.id}))}
function campusTaskId(subject,index,part,date){return subject==='course'?'course-'+dateKey(date):subject+'-step-'+index+'-'+part}
function newDailyTasks(date){
 const key=dateKey(date),tasks=[...studyTasksFor(date).map(task=>({...task,originDate:key})),...courseSupplementsFor(date)],activity=campusActivityFor(date);
 if(activity)tasks.push({id:'activity-'+key,subject:'fitness',title:activity.title,detail:activity.kind==='run'?'完成 3 公里；安排时间包含热身、跑步与整理。':'沿用原有动作模板与部位循环。',minutes:activity.minutes,originDate:key,activity:activity.kind});
 return tasks;
}
function ensureDailyLedger(){
 // Immutable snapshots make missed work traceable even after timetable changes.
 const today=dateKey(),last=localStorage.getItem('tri-daily-ledger-through')||dateKey(new Date(new Date(CampusPlan.effective+'T00:00:00').getTime()-DAY_MS));
 if(last>=today)return;
 let date=new Date(last+'T00:00:00');date.setDate(date.getDate()+1);let changed=false,through=last;
 for(let count=0;dateKey(date)<=today&&count<31;count++,date.setDate(date.getDate()+1)){
  for(const task of newDailyTasks(date))if(!dailyLedger[task.id]){dailyLedger[task.id]=task;changed=true}
  through=dateKey(date);
 }
 // Never advance the checkpoint unless its corresponding tasks were persisted.
 try{if(changed)localStorage.setItem('tri-daily-ledger-v2',JSON.stringify(dailyLedger));localStorage.setItem('tri-daily-ledger-through',through)}catch{toast('待补记录未能保存，请先导出备份并检查浏览器存储空间');return}
 window.campusPlanningRevision=(window.campusPlanningRevision||0)+1;
 if(localStorage.getItem('tri-daily-ledger-through')<today)setTimeout(()=>{ensureDailyLedger();if($('today').classList.contains('active'))renderToday()},0);
}
function dailyTaskMinutes(task){
 if(task.activity){const log=task.activity==='run'?cardioLogs[task.originDate]:fitnessLogs[task.originDate];if(log?.complete)return task.minutes;return Math.min(task.minutes-1,dailyProgress[task.id]?.minutes||0)}
 return Math.min(task.minutes,Math.max(0,dailyProgress[task.id]?.minutes||0));
}
function tasksForDashboard(date){
 const key=dateKey(date),generated=newDailyTasks(date),archived=Object.values(dailyLedger).filter(t=>t.originDate===key),base=key<dateKey()&&archived.length?archived:generated;
 const fresh=base.map(t=>{const old=dailyLedger[t.id];return old?{...t,...old,minutes:Math.max(t.minutes,old.minutes)}:t}),ids=new Set(fresh.map(t=>t.id));
 const backlog=Object.values(dailyLedger).filter(t=>t.originDate<key&&!ids.has(t.id)&&!t.activity&&dailyTaskMinutes(t)<t.minutes).sort((a,b)=>a.originDate.localeCompare(b.originDate));
 return {fresh,backlog};
}
function campusScheduleFor(date){
 const constraints=dayConstraints(date),activity=campusActivityFor(date),windows=studyWindows(date),reservation=CampusPlan.reserve({windows,school:constraints.busy,profile:dayProfile,activity,events:personalEventsFor(date)}),groups=tasksForDashboard(date);
 const quietDay=constraints.classes.length<2&&!constraints.busy.some(b=>b.end-b.start>300);
 const remaining=(task,backlog)=>({...task,minutes:task.minutes-dailyTaskMinutes(task),backlog,priority:backlog?(quietDay?0:2):1});
 const tasks=[...groups.fresh.filter(t=>!t.activity).map(t=>remaining(t,false)),...groups.backlog.map(t=>remaining(t,true))].filter(t=>t.minutes>0);
 const plan=StudyPlanner.allocate(tasks,windows,reservation.busy,dayProfile.breakMinutes);
 const activityTask=groups.fresh.find(t=>t.activity);if(activityTask&&dailyTaskMinutes(activityTask)<activityTask.minutes){const remaining=activityTask.minutes-dailyTaskMinutes(activityTask);if(reservation.activitySlot)plan.sessions.push({...activityTask,...reservation.activitySlot,end:reservation.activitySlot.start+remaining,minutes:remaining,part:1});else plan.pending.push({...activityTask,minutes:remaining})}
 plan.sessions.sort((a,b)=>a.start-b.start);
 const classRows=constraints.busy.map(b=>({start:b.classStart??b.start,end:b.classEnd??b.end,label:b.label,kind:'class'}));
 const fixed=reservation.fixed.filter(b=>b.kind!=='exercise'||!activityTask||dailyTaskMinutes(activityTask)>=activityTask.minutes);
 const rows=[...classRows,...fixed,...plan.sessions.map(s=>({...s,label:s.title,kind:'study'}))].sort((a,b)=>a.start-b.start);
 const pauses=[];for(const s of plan.sessions.filter(s=>!s.activity)){const next=[...rows,...reservation.busy].filter(r=>r.start>=s.end).reduce((n,r)=>Math.min(n,r.start),windows.at(-1)?.[1]||1320),end=Math.min(s.end+dayProfile.breakMinutes,next);if(end>s.end&&!reservation.busy.some(b=>b.start<s.end&&b.end>s.end))pauses.push({start:s.end,end,label:'学习间休息',kind:'rest'})}
 return {...plan,...constraints,busy:reservation.busy,warnings:[...constraints.warnings,...reservation.warnings],fixed:reservation.fixed,rows:[...rows,...pauses].sort((a,b)=>a.start-b.start),fresh:groups.fresh,backlog:groups.backlog,leisureReserved:reservation.leisureReserved,scheduled:plan.sessions.reduce((n,s)=>n+s.minutes,0),total:tasks.reduce((n,t)=>n+t.minutes,0)+(activityTask?Math.max(0,activityTask.minutes-dailyTaskMinutes(activityTask)):0)};
}
function saveDailyTaskProgress(task,minutes){
 const value=Math.max(0,Math.min(task.minutes,Number(minutes)));if(!Number.isFinite(value))return;
 if(!dailyLedger[task.id])dailyLedger[task.id]=task;else if(task.minutes>dailyLedger[task.id].minutes)dailyLedger[task.id]={...dailyLedger[task.id],minutes:task.minutes,originalMinutes:dailyLedger[task.id].originalMinutes||dailyLedger[task.id].minutes};
 dailyProgress[task.id]={minutes:value,updated:Date.now(),completedOn:value===task.minutes?dateKey():''};
 if(task.activity==='run'){cardioLogs[task.originDate]={...(cardioLogs[task.originDate]||{}),complete:value===task.minutes};if(value===task.minutes)cardioLogs[task.originDate].km=Math.max(3,cardioLogs[task.originDate].km||0);write('tri-cardio-logs',cardioLogs)}
 if(task.activity==='gym'){const log=fitnessLogs[task.originDate]||{checks:[],note:''};log.complete=value===task.minutes;fitnessLogs[task.originDate]=log;write('tri-fitness-logs',fitnessLogs)}
 write('tri-daily-ledger-v2',dailyLedger);write('tri-daily-progress-v2',dailyProgress);renderToday();
}
function openDailyTask(task){
 if(task.teacher&&['math','politics'].includes(task.subject))courseLineFilters[task.subject]=task.teacher;
 let date=new Date(task.originDate+'T00:00:00');
 if(task.sourceIndex!==undefined&&SUBJECT_LABELS[task.subject]){for(let i=task.sourceIndex;i<task.sourceIndex+366;i++){const candidate=dateFromIndex(i),state=subjectPlanState(task.subject,candidate);if(state.index===task.sourceIndex&&!state.postponed){date=candidate;break}}}
 setPlanDate(date);navigate(task.subject==='course'?'schedule':task.subject);
}
function dailyTaskMarkup(task,plan){const done=dailyTaskMinutes(task),complete=done>=task.minutes,scheduled=plan.sessions.filter(s=>s.id===task.id).reduce((n,s)=>n+s.minutes,0);return `<article class="daily-task-row ${complete?'done':''}" data-daily-task="${escapeAttr(task.id)}"><button class="daily-task-check" data-daily-check aria-pressed="${complete}" aria-label="${complete?'撤销完成':'完成本环节'}：${escapeAttr(task.title)}">${complete?'✓':''}</button><div class="daily-task-copy"><span class="daily-subject">${escapeHtml(SUBJECT_LABELS[task.subject]||({fitness:'运动',course:'课程'}[task.subject]))}${task.originDate<dateKey(selectedPlanDate)?' · '+task.originDate+' 待补':''}</span><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.detail||'')}</p><small>已完成 ${done} / ${task.minutes} 分钟${!complete?' · 本次排入 '+scheduled+' 分钟':''}</small></div><div class="daily-task-actions"><button class="soft" data-daily-open>进入</button>${!task.activity?'<button class="text-action" data-daily-minutes>记录分钟</button>':''}</div></article>`}
function bindDailyRows(container,tasks){container.querySelectorAll('[data-daily-task]').forEach(row=>{const task=tasks.find(t=>t.id===row.dataset.dailyTask);if(!task)return;row.querySelector('[data-daily-check]').onclick=()=>saveDailyTaskProgress(task,dailyTaskMinutes(task)>=task.minutes?0:task.minutes);row.querySelector('[data-daily-open]').onclick=()=>openDailyTask(task);const minutes=row.querySelector('[data-daily-minutes]');if(minutes)minutes.onclick=()=>{const raw=prompt('累计完成了多少分钟？本环节共 '+task.minutes+' 分钟。',String(dailyTaskMinutes(task)));if(raw!==null&&raw.trim()!=='')saveDailyTaskProgress(task,raw)}})}
function renderCampusTimeline(box,date,plan=campusScheduleFor(date)){
 const labels={...SUBJECT_LABELS,fitness:'运动',course:'课程'};
 box.innerHTML=`<div class="section-head"><div><div class="eyebrow">DAY RHYTHM</div><h3>课程、学习与休息</h3></div><b>${studyTiming.wake}–${studyTiming.end}</b></div><p class="muted">午饭 12:00–12:45 · 午休 ${dayProfile.napMinutes} 分钟 · 娱乐 ${plan.leisureReserved} 分钟 · 学习间休息 ${dayProfile.breakMinutes} 分钟</p>${plan.warnings.length?'<p class="schedule-warning">'+plan.warnings.map(escapeHtml).join('<br>')+'</p>':''}<div class="campus-timeline">${plan.rows.map(r=>`<div class="campus-time-row ${r.kind} ${r.subject||''}"><time>${timeSpan(r)}</time><span><b>${r.subject?labels[r.subject]+' · ':''}${escapeHtml(r.label)}</b>${r.backlog?'<small>补学 '+r.originDate+' 的内容</small>':''}</span>${r.kind==='class'?'<i>上课</i>':r.kind==='leisure'?'<i>留白</i>':''}</div>`).join('')}</div>${plan.pending.length?`<p class="schedule-warning">尚有 ${plan.pending.reduce((n,t)=>n+t.minutes,0)} 分钟未排入；全部内容保留待补，不占用休息和娱乐时间。</p>`:'<p class="schedule-complete">本次学习与运动任务已全部排入。</p>'}`;
}
function renderCampusDay(date=selectedPlanDate,plan=campusScheduleFor(date)){
 const key=dateKey(date),fresh=plan.fresh,scheduledBacklog=plan.backlog.filter(t=>plan.sessions.some(s=>s.id===t.id));
 $('todayTitle').textContent=key+' · '+DAYS[date.getDay()];$('todayHint').textContent='先避开学校课程与事务，再安排学习；做完一段，记录一段。';
 $('todayTasks').innerHTML=fresh.map(t=>dailyTaskMarkup(t,plan)).join('');bindDailyRows($('todayTasks'),fresh);
 $('backlogSummary').textContent=plan.backlog.length?'待补 '+plan.backlog.length+' 项 · '+plan.backlog.reduce((n,t)=>n+t.minutes-dailyTaskMinutes(t),0)+' 分钟':'暂无待补内容';
 $('scheduledBacklog').innerHTML=scheduledBacklog.length?scheduledBacklog.map(t=>dailyTaskMarkup(t,plan)).join(''):'<p class="muted">空课日优先补学；未排入的内容保留在待补清单。</p>';bindDailyRows($('scheduledBacklog'),scheduledBacklog);
 const all=$('allBacklog');all.innerHTML='';$('backlogDetails').open=false;$('backlogDetails').ontoggle=()=>{if($('backlogDetails').open){all.innerHTML=plan.backlog.map(t=>dailyTaskMarkup(t,plan)).join('')||'<p class="muted">没有待补任务。</p>';bindDailyRows(all,plan.backlog)}};
 if(key<CampusPlan.effective)renderStudyTimeline('todayStudyTimeline',date);else renderCampusTimeline($('todayStudyTimeline'),date,plan);renderTodayCourses(date);
 if(key<CampusPlan.effective){$('todayTasks').innerHTML='<p class="muted">原计划打卡 '+(checks[key]||[]).length+' 项；可进入对应日期的科目工作台查看原笔记。</p>';$('scheduledBacklog').innerHTML=''}
}
function renderDailyDashboard(){
 ensureDailyLedger();const date=selectedPlanDate,key=dateKey(date),plan=campusScheduleFor(date),fresh=plan.fresh;
 $('dashboardDate').value=key;const done=fresh.filter(t=>dailyTaskMinutes(t)>=t.minutes).length,pct=fresh.length?Math.round(done/fresh.length*100):0;$('percent').textContent=pct+'%';$('ring').style.setProperty('--p',pct+'%');$('streak').textContent=calcStreak();
 $('dailyPlanSummary').innerHTML=`<span><b>${done} / ${fresh.length}</b> 今日环节完成</span><span><b>${plan.scheduled}</b> 分钟已安排</span><span><b>${plan.backlog.length}</b> 个环节待补</span>`;
 $('planHistoryInfo').textContent=key<CampusPlan.effective?'这一天属于原计划。原打卡与笔记记录保留；新打卡从 9 月 16 日开始。':'';
 if(key<CampusPlan.effective)workstationTab='day';renderWorkstation(plan);
}
function renderCardioPanel(){
 const key=dateKey(selectedPlanDate),before=key>=CampusPlan.effective&&key<fitnessSettings.start,box=$('cardioPanel');box.classList.toggle('hidden',!before);if(!before)return;
 const log=cardioLogs[key]||{},running=!!campusActivityFor(selectedPlanDate);$('cardioDayLabel').textContent=running?'今日指标：3 公里跑步':'今天恢复 · 可散步或休息';$('cardioDistance').value=log.km??'';$('cardioNote').value=log.note||'';$('cardioState').textContent=log.complete?'已完成 3 公里 ✓':'按实际完成距离记录';
 const week=campusRunWeek(selectedPlanDate);$('cardioFrequency').textContent='按整段空课与学习负担安排：'+(week.days.map(d=>d.date.slice(5)).join('、')||'本周暂无完整空课时段')+'。每周目标 '+week.target+' 次，已找到 '+week.days.length+' 次；具体时段见今日安排。力量训练从 '+fitnessSettings.start+' 开始，沿用原有部位循环。';
}
function renderCampusEvents(){const box=$('campusEvents');box.innerHTML=campusEvents.map(e=>`<div class="campus-event"><span><b>${escapeHtml(e.title)}</b><small>${e.startDate}${e.endDate!==e.startDate?' 至 '+e.endDate:''} · ${e.start}–${e.end}${e.days?' · 每周'+e.days.map(d=>DAYS[d]).join('、'):''}</small></span><button class="soft" data-event-delete="${escapeAttr(e.id)}">移除</button></div>`).join('')||'<p class="muted">尚无额外事务。新增后，学习计划会自动避开这些时段。</p>';box.querySelectorAll('[data-event-delete]').forEach(b=>b.onclick=()=>{campusEvents=campusEvents.filter(e=>e.id!==b.dataset.eventDelete);write('tri-campus-events',campusEvents);renderCampusEvents();renderAll()})}
function initCampusControls(){
 $('dashboardDate').onchange=e=>setPlanDate(e.target.value);$('dashboardToday').onclick=()=>setPlanDate(new Date());
 $('cardioForm').onsubmit=e=>{e.preventDefault();const km=+$('cardioDistance').value;if(!Number.isFinite(km)||km<0||km>100)return toast('请填写有效跑步距离');const key=dateKey(selectedPlanDate);cardioLogs[key]={...(cardioLogs[key]||{}),km,complete:km>=3,note:$('cardioNote').value.trim(),updated:Date.now()};write('tri-cardio-logs',cardioLogs);renderCardioPanel();toast('跑步记录已保存')};
 $('campusEventForm').onsubmit=e=>{e.preventDefault();const title=$('campusEventTitle').value.trim(),startDate=$('campusEventDate').value,endDate=$('campusEventEndDate').value||startDate,start=$('campusEventStart').value,end=$('campusEventEnd').value;if(!title||!startDate||endDate<startDate||end<=start)return toast('请检查事务名称、日期与起止时间');campusEvents.push({id:uid(),title,startDate,endDate,start,end,days:$('campusEventWeekly').checked?[new Date(startDate+'T00:00:00').getDay()]:null});write('tri-campus-events',campusEvents);$('campusEventForm').reset();renderCampusEvents();renderAll();toast('事务已加入排期')};
 $('dayBreakMinutes').value=dayProfile.breakMinutes;$('dayNapMinutes').value=dayProfile.napMinutes;$('dayLeisureMinutes').value=dayProfile.leisureMinutes;
 $('runsPerWeek').value=dayProfile.runsPerWeek;
 $('dayProfileForm').onsubmit=e=>{e.preventDefault();const breakMinutes=+$('dayBreakMinutes').value,napMinutes=+$('dayNapMinutes').value,leisureMinutes=+$('dayLeisureMinutes').value,runsPerWeek=+$('runsPerWeek').value;if(breakMinutes<10||breakMinutes>15||napMinutes<0||napMinutes>120||leisureMinutes<0||leisureMinutes>240||runsPerWeek<1||runsPerWeek>4)return toast('请检查休息时长与运动次数');dayProfile={...dayProfile,breakMinutes,napMinutes,leisureMinutes,runsPerWeek};write('tri-day-profile',dayProfile);renderAll();toast('休息与运动安排已更新')};
 renderCampusEvents();
}

;
// campus-meals.js
/* Portions and spending caps, never claimed as a merchant's current menu. */
window.CampusMeals=(()=>{
 const defaults={budget:25,bread:150,chicken:150,breadCal:250,chickenCal:165,dinnerCost:7};
 const rotations=[
  {lunch:[['米饭',300],['豆腐蒸蛋',200],['蒜蓉青菜',200]],cost:10,where:'食堂 · 米饭配蛋豆腐与蔬菜'},
  {lunch:[['米饭',250],['宫保鸡丁',150],['蒜蓉青菜',200]],cost:11.5,where:'食堂 · 米饭配鸡肉与蔬菜'},
  {lunch:[['米饭',300],['豆腐蒸蛋',200],['炒西兰花',200]],cost:10,where:'食堂 · 米饭配蛋豆腐与西兰花'},
  {lunch:[['黄焖鸡米饭',550]],cost:11.5,where:'外卖候选 · 黄焖鸡饭，另确认有蔬菜'},
  {lunch:[['米饭',250],['家常豆腐',200],['蒜蓉青菜',200]],cost:10.5,where:'食堂 · 米饭配豆腐与蔬菜'},
  {lunch:[['米饭',250],['土豆烧牛肉',200],['炒西兰花',200]],cost:11.5,where:'食堂 · 米饭配肉菜与西兰花'},
  {lunch:[['兰州牛肉面',600],['水煮蛋',50]],cost:11.5,where:'外卖候选 · 牛肉面加蛋，选带青菜的份量'}
 ];
 function food(name,grams){const row=FOOD_DATA.find(f=>f.name===name);if(!row)throw new Error('Missing meal reference: '+name);return {name,grams,cal:Math.round(row.kcal*grams/100),p:row.p*grams/100,c:row.c*grams/100,f:row.f*grams/100}}
 function meal(type,title,foods,cost,variance=.2){const sum=k=>foods.reduce((n,f)=>n+(f[k]||0),0),cal=Math.round(sum('cal'));return {type,title,foods,cost,cal,low:Math.round(cal*(1-variance)),high:Math.round(cal*(1+variance)),p:+sum('p').toFixed(1),c:+sum('c').toFixed(1),f:+sum('f').toFixed(1)}}
 function forDate(date,settings=defaults){
  const cfg={...defaults,...settings},rotation=rotations[date.getDay()],breakfast=meal('早餐','运动日跑后吃；其余日 08:00 开始',[food('馒头',150),food('水煮蛋',50),food('全脂牛奶',250)],4.5,.12);
  const lunch=meal('午餐',rotation.where,rotation.lunch.map(([n,g])=>food(n,g)),rotation.cost,.25);
  const bread={name:'全麦面包',grams:cfg.bread,cal:Math.round(cfg.bread*cfg.breadCal/100),p:cfg.bread*.09,c:cfg.bread*.43,f:cfg.bread*.04};
  const chicken={...food('鸡胸肉',cfg.chicken),cal:Math.round(cfg.chicken*cfg.chickenCal/100)};
  const dinner=meal('晚餐','全麦面包 + 鸡胸肉 + 即食蔬菜',[bread,chicken,{name:'黄瓜 / 番茄（不加油）',grams:250,cal:40,p:2,c:7,f:.5}],cfg.dinnerCost,.15);
  const snack=meal('加餐','下午或晚餐配一份水果',[food(date.getDay()%2?'香蕉':'苹果',200)],2,.15),meals=[breakfast,lunch,dinner,snack];
  return {meals,cal:meals.reduce((n,m)=>n+m.cal,0),low:meals.reduce((n,m)=>n+m.low,0),high:meals.reduce((n,m)=>n+m.high,0),cost:+meals.reduce((n,m)=>n+m.cost,0).toFixed(1),budget:cfg.budget};
 }
 return {defaults,forDate};
})();
function renderCampusMeals(){
 const box=$('campusMealPlan');if(!box)return;
 const cfg={...CampusMeals.defaults,...read('tri-campus-meal-settings',{})},plan=CampusMeals.forDate(selectedPlanDate,cfg),key=dateKey(selectedPlanDate),energy=calculateEnergy();
 $('campusMealDate').textContent=key+' · '+DAYS[selectedPlanDate.getDay()];
 $('campusMealTotals').textContent=`份量估算约 ${plan.cal} kcal · 采购预算 ¥${plan.cost} / ¥${plan.budget}`;
 $('campusMealBudget').textContent=plan.cost>cfg.budget?'当前组合超出预算 ¥'+(plan.cost-cfg.budget).toFixed(1)+'；先改食堂组合或采购价格，不减少必要餐次。':`午餐采购上限 ¥${plan.meals[1].cost}，外卖需包含配送与包装费；超过就换食堂同类饭菜。`;
 $('campusMealEnergy').textContent=`全天估算区间 ${plan.low}–${plan.high} kcal；与你当前约 ${energy.target} kcal 的参考目标比较，优先用包装标签和实际份量校准。`;
 box.innerHTML=plan.meals.map((m,i)=>`<article class="campus-meal-card"><div class="section-head"><h3>${m.type}</h3><b>预算 ¥${m.cost}</b></div><p>${escapeHtml(m.title)}</p><ul>${m.foods.map(f=>`<li>${escapeHtml(f.name)} ${f.grams}${f.name.includes('牛奶')?'ml':'g'}</li>`).join('')}</ul><strong>约 ${m.cal} kcal</strong><small>${m.low}–${m.high} kcal · 蛋白约 ${m.p}g</small><button class="soft" data-log-campus-meal="${i}" ${(mealLogs[key]||[]).some(x=>x.planId===key+'-'+i)?'disabled':''}>${(mealLogs[key]||[]).some(x=>x.planId===key+'-'+i)?'本餐已记入':'按此份量记入'}</button></article>`).join('');
 box.querySelectorAll('[data-log-campus-meal]').forEach(button=>button.onclick=()=>{const i=+button.dataset.logCampusMeal,planId=key+'-'+i;if((mealLogs[key]||[]).some(x=>x.planId===planId))return;const m=plan.meals[i];addMealEntry({id:uid(),planId,type:m.type,name:'计划份量 · '+m.foods.map(x=>x.name+' '+x.grams+(x.name.includes('牛奶')?'ml':'g')).join(' + '),cal:m.cal,p:m.p,c:m.c,f:m.f,low:m.low,high:m.high,estimated:true})});
 for(const [id,field] of [['campusFoodBudget','budget'],['dinnerBreadGrams','bread'],['dinnerChickenGrams','chicken'],['dinnerBreadCal','breadCal'],['dinnerChickenCal','chickenCal'],['dinnerCost','dinnerCost']])$(id).value=cfg[field];
 $('campusMealSettings').onsubmit=e=>{e.preventDefault();const next={};for(const [id,field] of [['campusFoodBudget','budget'],['dinnerBreadGrams','bread'],['dinnerChickenGrams','chicken'],['dinnerBreadCal','breadCal'],['dinnerChickenCal','chickenCal'],['dinnerCost','dinnerCost']])next[field]=+$(id).value;if(Object.values(next).some(x=>!Number.isFinite(x)||x<=0)||next.bread>500||next.chicken>500||next.breadCal>900||next.chickenCal>900)return toast('请检查份量、热量与预算');write('tri-campus-meal-settings',next);renderCampusMeals();toast('已更新餐饮计划，不改写历史餐饮记录')};
}
function parseResourceLink(text){
 const match=String(text).match(/https?:\/\/[^\s<>"']+/i);if(!match)return null;
 try{const url=new URL(match[0].replace(/[，。；、）)\]}]+$/g,''));if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;const baidu=['pan.baidu.com','yun.baidu.com'].includes(url.hostname.toLowerCase());const code=String(text).match(/(?:提取码|访问码|密码)\s*[:：]?\s*([a-z\d]{4})(?![a-z\d])/i)?.[1];if(baidu&&code&&!url.searchParams.has('pwd'))url.searchParams.set('pwd',code);return{url:url.href,baidu}}catch{return null}
}

;
// workstation.js
/* Event-driven workstation: no background animation or idle polling. */
let workstationTab='now',workstationMinutes=30,workstationMode='next';
function setWorkstationTab(tab,plan){
 workstationTab=['now','day','week'].includes(tab)?tab:'now';
 document.querySelectorAll('[data-workstation-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.workstationTab===workstationTab);b.setAttribute('aria-selected',String(b.dataset.workstationTab===workstationTab));b.tabIndex=b.dataset.workstationTab===workstationTab?0:-1});
 $('workstationNow').classList.toggle('hidden',workstationTab!=='now');$('workstationWeek').classList.toggle('hidden',workstationTab!=='week');$('today').querySelector('.today-stack').classList.toggle('hidden',workstationTab!=='day');
 if(workstationTab==='week')renderWorkstationWeek();else if(workstationTab==='day')renderCampusDay(selectedPlanDate,plan);
}
function workstationSuggestions(plan){
 const tasks=[...plan.fresh,...plan.backlog].filter(t=>!t.activity&&dailyTaskMinutes(t)<t.minutes),rank=new Map();
 const now=new Date(),minute=dateKey(selectedPlanDate)===dateKey()?now.getHours()*60+now.getMinutes():0;
 [...plan.sessions.filter(s=>s.end>minute),...plan.sessions.filter(s=>s.end<=minute)].forEach((s,i)=>{if(!rank.has(s.id))rank.set(s.id,i)});
 return tasks.sort((a,b)=>{const left=a.minutes-dailyTaskMinutes(a),right=b.minutes-dailyTaskMinutes(b);if(workstationMode==='catchup'){const diff=a.originDate.localeCompare(b.originDate);if(diff)return diff}if(workstationMode==='short')return left-right;return (rank.get(a.id)??999)-(rank.get(b.id)??999)||left-right}).slice(0,3);
}
function startWorkstationFocus(task){
 const existing=read('tri-workstation-focus',null);
 if(existing&&studyTimers[existing.timerKey])return resumeWorkstationFocus(existing);
 const homeDate=dateKey(selectedPlanDate),base='campus-'+task.id+'-'+Date.now();openDailyTask(task);showStudyTimerPanel(base,task.title);
 const state=activeStudyTimer();Object.values(studyTimers).forEach(pauseStudyTimer);state.mode='stopwatch';state.baseSeconds=0;state.running=true;state.startedAt=Date.now();saveStudyTimers();
 write('tri-workstation-focus',{task,homeDate,timerKey:activeStudyTimerKey,suggested:Math.min(workstationMinutes,task.minutes-dailyTaskMinutes(task))});renderActiveStudyTimer();
}
function resumeWorkstationFocus(focus=read('tri-workstation-focus',null)){
 if(!focus||!studyTimers[focus.timerKey])return;
 openDailyTask(focus.task);activeStudyTimerKey=focus.timerKey;localStorage.setItem('tri-active-study-timer',activeStudyTimerKey);openActiveStudyTimerPanel();
}
function renderWorkstation(plan){
 if(!$('workstationNow'))return;const key=dateKey(selectedPlanDate),suggestions=workstationSuggestions(plan),classes=dayConstraints(selectedPlanDate),focus=read('tri-workstation-focus',null),actual=dateKey()===key,now=new Date(),minute=now.getHours()*60+now.getMinutes(),current=actual?plan.rows.find(row=>row.start<=minute&&row.end>minute):null;
 $('workstationContext').textContent=current?'当前安排：'+current.label+' · 至 '+StudyPlanner.label(current.end):`${classes.classes.length} 节课 · ${plan.leisureReserved} 分钟娱乐 · ${plan.pending.reduce((n,t)=>n+t.minutes,0)} 分钟待安排`;
 $('workstationNext').innerHTML=suggestions.length?suggestions.map((task,i)=>`<article class="focus-suggestion ${i?'secondary':''}"><span class="eyebrow">${task.originDate<key?'待补 · '+task.originDate:'继续推进'} · ${escapeHtml(SUBJECT_LABELS[task.subject]||'课程')}</span><h3>${escapeHtml(task.title)}</h3><p>${escapeHtml(task.detail||'')}</p><div class="section-head"><small>本次可做 ${Math.min(workstationMinutes,task.minutes-dailyTaskMinutes(task))} 分钟 · 还剩 ${task.minutes-dailyTaskMinutes(task)} 分钟</small><button class="${i?'soft':'primary'}" data-focus-task="${escapeAttr(task.id)}">${focus?'返回进行中的专注':'开始这一段'}</button></div></article>`).join(''):'<div class="empty">当前环节已完成。可以查看待补、整理笔记或休息。</div>';
 $('workstationNext').querySelectorAll('[data-focus-task]').forEach(b=>b.onclick=()=>startWorkstationFocus(suggestions.find(t=>t.id===b.dataset.focusTask)));
 const resume=$('workstationResume');resume.classList.toggle('hidden',!focus||!studyTimers[focus?.timerKey]);
 if(focus&&studyTimers[focus.timerKey]){const seconds=studyTimerValue(studyTimers[focus.timerKey]);$('workstationResumeTitle').textContent=focus.task.title+' · 已计时 '+formatStudyTime(seconds);$('workstationActualMinutes').value=Math.floor(seconds/60);$('workstationResumeOpen').onclick=()=>resumeWorkstationFocus(focus);$('workstationRecord').onclick=()=>{const minutes=+$('workstationActualMinutes').value;if(!Number.isFinite(minutes)||minutes<1||minutes>600)return toast('请填写实际学习分钟');pauseStudyTimer(studyTimers[focus.timerKey]);saveStudyTimers();write('tri-workstation-focus',null);saveDailyTaskProgress(focus.task,dailyTaskMinutes(focus.task)+minutes);toast('已记录本段进度，剩余内容继续保留')};$('workstationDismiss').onclick=()=>{pauseStudyTimer(studyTimers[focus.timerKey]);saveStudyTimers();write('tri-workstation-focus',null);renderToday();toast('已结束本段，计时记录保留，未计入完成进度')}}
 const notes=read('tri-workstation-notes',{});$('workstationReflection').value=notes[key]?.text||'';$('workstationReflectionState').textContent=notes[key]?'已保存 · '+key:'本日尚无复盘';
 $('workstationReflectionSave').onclick=()=>{const all=read('tri-workstation-notes',{});all[key]={text:$('workstationReflection').value.trim(),updated:Date.now()};write('tri-workstation-notes',all);$('workstationReflectionState').textContent='已保存 · '+key};
 setWorkstationTab(workstationTab,plan);
}
function renderWorkstationWeek(){
 const start=new Date(selectedPlanDate);start.setDate(start.getDate()-(start.getDay()+6)%7);let planned=0,done=0,backlog=0;
 const days=Array.from({length:7},(_,i)=>{const date=new Date(start);date.setDate(date.getDate()+i);const key=dateKey(date),tasks=key<CampusPlan.effective?[]:tasksForDashboard(date).fresh,minutes=tasks.reduce((n,t)=>n+t.minutes,0),completed=tasks.reduce((n,t)=>n+dailyTaskMinutes(t),0),activity=campusActivityFor(date),classes=dayConstraints(date);planned+=minutes;done+=completed;return{key,tasks,minutes,completed,activity,classes,date}});
 backlog=Object.values(dailyLedger).filter(t=>!t.activity&&t.originDate<dateKey()&&dailyTaskMinutes(t)<t.minutes).length;
 $('workstationWeekSummary').textContent=`本周环节记录 ${done} / ${planned} 分钟 · 历史待补 ${backlog} 项`;
 $('workstationWeekDays').innerHTML=days.map(d=>`<button class="workstation-week-day ${d.key===dateKey(selectedPlanDate)?'selected':''}" data-workstation-date="${d.key}"><span>${DAYS[d.date.getDay()]}</span><b>${d.key.slice(5)}</b><span class="week-meter"><i style="width:${d.minutes?Math.round(d.completed/d.minutes*100):0}%"></i></span><small>${d.classes.classes.length} 节课</small><em>${d.activity?escapeHtml(d.activity.title):'学习 / 恢复'}</em><small>${d.completed} / ${d.minutes} 分钟</small></button>`).join('');
 $('workstationWeekDays').querySelectorAll('[data-workstation-date]').forEach(b=>b.onclick=()=>{workstationTab='day';setPlanDate(b.dataset.workstationDate)});
}
function initWorkstation(){
 document.querySelectorAll('[data-workstation-tab]').forEach(b=>{b.onclick=()=>setWorkstationTab(b.dataset.workstationTab);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-workstation-tab]')],i=tabs.indexOf(b),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;tabs[next].click();tabs[next].focus()}});
 document.querySelectorAll('[data-focus-minutes]').forEach(b=>b.onclick=()=>{workstationMinutes=+b.dataset.focusMinutes;document.querySelectorAll('[data-focus-minutes]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))});renderWorkstation(campusScheduleFor(selectedPlanDate))});
 $('workstationMode').onchange=e=>{workstationMode=e.target.value;renderWorkstation(campusScheduleFor(selectedPlanDate))};
 $('workstationReturn').onclick=()=>{const focus=read('tri-workstation-focus',null);if(focus)setPlanDate(focus.homeDate);navigate('today')};
}

;
// course-lines.js
/* Teacher navigation stores metadata only; no account credentials or video bytes. */
window.CourseLines={
 rootFolder:'【27公共课】（更ing）',
 teachers:[{id:'wuzhongxiang',name:'武忠祥',subject:'math',folder:'【有道-武忠祥-姜晓千-刘金峰】'},{id:'zhangyu',name:'张宇',subject:'math',folder:'张宇高昆轮领衔丨27考研数学零基础全程班'},{id:'daya',name:'大牙老师',subject:'politics',folder:'【大牙】'}],
 stages:{unknown:'阶段待确认',foundation:'基础',reinforce:'强化',papers:'真题',sprint:'冲刺',notes:'讲义',complete:'全程'},
 teacher(subject,item){
  const allowed=this.teachers.filter(t=>t.subject===subject);
  if(item.teacher==='unknown'||allowed.some(t=>t.id===item.teacher))return item.teacher;
  const text=[item.name,item.path].filter(Boolean).join(' '),matches=allowed.filter(t=>text.includes(t.id==='daya'?'大牙':t.name));
  return matches.length===1?matches[0].id:'unknown';
 },
 stage(item){
  if(Object.hasOwn(this.stages,item.stage))return item.stage;
  const text=[item.name,item.path].filter(Boolean).join(' ');
  const found=[['全程','complete'],['冲刺','sprint'],['真题','papers'],['强化','reinforce'],['基础','foundation']].find(([label])=>text.includes(label));
  return found?.[1]||'unknown';
 },
 label(subject,item){const teacher=this.teachers.find(t=>t.id===this.teacher(subject,item));return [teacher?.name||'老师待分类',item.year||'',this.stages[this.stage(item)]].filter(Boolean).join(' · ')}
};
const courseLineFilters={math:'all',politics:'all'},courseResourceEpoch={math:0,politics:0};
let courseSupplementCache={raw:null,byDate:new Map()};
function mathPrimaryLine(){const saved=localStorage.getItem('tri-math-primary-line');return ['wuzhongxiang','zhangyu'].includes(saved)?saved:'wuzhongxiang'}
function mathDualLabel(){const primary=mathPrimaryLine(),name=id=>CourseLines.teachers.find(t=>t.id===id).name;return name(primary)+'主线 · '+name(primary==='wuzhongxiang'?'zhangyu':'wuzhongxiang')+'按章补充'}
function courseItemsForPlan(subject){const items=courseCatalog[subject]||[];return subject==='math'&&mathRoute==='dual'?items.filter(item=>['unknown',mathPrimaryLine()].includes(CourseLines.teacher(subject,item))):items}
function setMathPrimaryLine(id){
 if(!['wuzhongxiang','zhangyu'].includes(id))return;
 if(mathRoute==='dual'&&mathPrimaryLine()===id)return;
 const history=read('tri-course-line-history',[]);history.push({at:new Date().toISOString(),route:mathRoute,primary:mathPrimaryLine(),schedule:smartSchedules.math});write('tri-course-line-history',history);
 localStorage.setItem('tri-math-primary-line',id);mathRoute='dual';localStorage.setItem('tri-math-route',mathRoute);
 window.campusPlanningRevision=(window.campusPlanningRevision||0)+1;rebuildSmartSchedule('math');renderMath();render365();renderToday();toast(mathDualLabel()+'；已记录的任务与进度保留');
}
function courseSupplementsFor(date){
 const raw=localStorage.getItem('tri-course-supplements');
 if(raw!==courseSupplementCache.raw){const byDate=new Map();for(const task of Object.values(read('tri-course-supplements',{}))){const items=byDate.get(task.originDate)||[];items.push(task);byDate.set(task.originDate,items)}courseSupplementCache={raw,byDate}}
 return courseSupplementCache.byDate.get(dateKey(date))||[];
}
function addCourseSupplement(subject,item,kind,minutes){
 const key=dateKey(selectedPlanDate),value=Number(minutes),teacher=CourseLines.teacher(subject,item);
 if(key<dateKey())return toast('请选择今天或未来日期添加补充任务');
 if(!Number.isFinite(value)||value<1||value>600)return toast('请填写 1–600 分钟的补充学习时间');
 const id='course-supplement-'+key+'-'+item.id,requests=read('tri-course-supplements',{});
 if(requests[id])return toast('本日已添加这项补充任务');
 const task={id,subject,teacher,title:'本章补充 · '+item.name,detail:CourseLines.label(subject,item),minutes:value,originDate:key,...(kind==='local'?{courseId:item.id}:{resourceId:item.id})};
 requests[id]=task;write('tri-course-supplements',requests);
 if(key===dateKey()){dailyLedger[id]=task;write('tri-daily-ledger-v2',dailyLedger)}
 renderSubjectTime(subject);renderToday();toast('补充任务已加入 '+key+'，空档不足的部分保留待补');
}
function initCourseLines(){
 if(!localStorage.getItem('tri-course-lines-version')){
  write('tri-math-route-before-dual',{value:localStorage.getItem('tri-math-route'),schedule:smartSchedules.math,savedAt:new Date().toISOString()});
  mathRoute='dual';localStorage.setItem('tri-math-route',mathRoute);localStorage.setItem('tri-course-lines-version','20260916b');
 }
 for(const subject of ['math','politics']){
  const picker=$(subject+'ResourceTeacher');
  picker.innerHTML=CourseLines.teachers.filter(t=>t.subject===subject).map(t=>`<option value="${t.id}">${t.name}</option>`).join('')+'<option value="unknown">暂不分类</option>';
  $(subject+'ResourceStage').innerHTML=Object.entries(CourseLines.stages).map(([id,name])=>`<option value="${id}">${name}</option>`).join('');
  $(subject+'ResourceYear').value='2027';
 }
}
function renderCourseLines(subject){
 const box=$(subject+'CourseLines');if(!box)return;
 const teachers=CourseLines.teachers.filter(t=>t.subject===subject),catalog=courseCatalog[subject]||[],links=resources.filter(r=>r.subject===subject),filter=courseLineFilters[subject];
 box.innerHTML=`<div class="section-head"><div><div class="eyebrow">COURSE LIBRARY</div><h3>${subject==='math'?'武忠祥 × 张宇 · 数学双线':'大牙老师 · 政治课程'}</h3></div><button class="soft" data-course-filter="all" aria-pressed="${filter==='all'}">全部课程</button></div><p class="muted">${subject==='math'?escapeHtml(mathRoute==='dual'?mathDualLabel():'当前使用单线路线；可在下方切换为双线')+'。补充内容由你按章节加入，原有练习和复习保留。':'2027 考研政治 · 大牙课程入口与讲义。'} 群目录：${escapeHtml(CourseLines.rootFolder)}</p><div class="teacher-line-grid">`+teachers.map(t=>{
  const files=catalog.filter(item=>CourseLines.teacher(subject,item)===t.id),attached=links.filter(item=>CourseLines.teacher(subject,item)===t.id),done=files.filter(item=>courseProgress[item.id]).length;
  const primary=subject==='math'&&mathRoute==='dual'&&mathPrimaryLine()===t.id;
  return `<article class="teacher-line ${filter===t.id?'selected':''}"><h4>${t.name}${primary?' · 主线':''}</h4><p class="course-folder-name">${escapeHtml(t.folder)}</p><p>${attached.length} 个链接 · ${files.length} 份本地课程 / 讲义</p><small>${files.length?`已完成 ${done} / ${files.length} 项`:'已确认目录名称 · 待添加访问链接'}</small><div class="inline-actions"><button class="soft" data-course-filter="${t.id}" aria-pressed="${filter===t.id}">查看${t.name}课程</button><button class="soft" data-course-attach="${t.id}">添加入口</button>${subject==='math'?`<button class="soft" data-course-primary="${t.id}" ${primary?'disabled':''}>${primary?'当前主线':'设为主线'}</button>`:''}</div></article>`;
 }).join('')+`</div><div class="course-line-footer"><button class="soft" data-course-filter="unknown" aria-pressed="${filter==='unknown'}">待分类 ${[...catalog,...links].filter(item=>CourseLines.teacher(subject,item)==='unknown').length} 项</button><span>目前使用网盘页面播放；站内视频尚未接通。</span></div><div id="${subject}TeacherFiles"></div>`;
 box.querySelectorAll('[data-course-filter]').forEach(button=>button.onclick=()=>{courseLineFilters[subject]=button.dataset.courseFilter;renderResources(subject);renderStoredFiles(subject)});
 box.querySelectorAll('[data-course-attach]').forEach(button=>button.onclick=()=>{$(subject+'ResourceTeacher').value=button.dataset.courseAttach;$(subject+'ResourceUrl').scrollIntoView({block:'center'});$(subject+'ResourceUrl').focus()});
 box.querySelectorAll('[data-course-primary]').forEach(button=>button.onclick=()=>setMathPrimaryLine(button.dataset.coursePrimary));
 // Open a teacher's local catalog on demand, avoiding a large hidden list at startup.
 if(filter!=='all'){
  const items=catalog.filter(item=>CourseLines.teacher(subject,item)===filter),list=$(subject+'TeacherFiles');
  if(items.length){list.innerHTML='<h4>已导入的本地课程与讲义</h4>'+items.map(item=>`<div class="teacher-file"><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(CourseLines.label(subject,item))} · ${courseProgress[item.id]?'已完成':'未完成'}</small></div><div class="inline-actions"><button class="soft" data-teacher-file="${escapeAttr(item.id)}">打开文件</button>${subject==='math'&&filter!==mathPrimaryLine()?`<button class="soft" data-file-supplement="${escapeAttr(item.id)}">加入 ${dateKey(selectedPlanDate)} 补充</button>`:''}</div></div>`).join('');list.querySelectorAll('[data-teacher-file]').forEach(button=>button.onclick=()=>openCourseFile(subject,items.find(item=>item.id===button.dataset.teacherFile)));list.querySelectorAll('[data-file-supplement]').forEach(button=>button.onclick=()=>{const item=items.find(item=>item.id===button.dataset.fileSupplement);addCourseSupplement(subject,item,'local',item.minutes||45)})}
 }
}
function addCourseResource(subject){
 const name=$(subject+'ResourceName').value.trim(),link=parseResourceLink($(subject+'ResourceUrl').value),teacher=$(subject+'ResourceTeacher').value,stage=$(subject+'ResourceStage').value,year=$(subject+'ResourceYear').value.trim();
 if(!name||!link)return toast('请填写名称和有效的 http / https 分享链接');
 if(year&&!/^20\d{2}$/.test(year))return toast('课程年份请填四位数字，也可以留空');
 if(!CourseLines.teachers.some(t=>t.subject===subject&&t.id===teacher)&&teacher!=='unknown')return toast('请选择本学科的老师');
 if(!Object.hasOwn(CourseLines.stages,stage))return toast('请选择课程阶段');
 if(resources.some(r=>r.subject===subject&&r.url===link.url&&CourseLines.teacher(subject,r)===teacher))return toast('这位老师的相同链接已保存');
 resources.push({id:uid(),subject,name,url:link.url,teacher,stage,year});write('tri-resources',resources);
 $(subject+'ResourceName').value='';$(subject+'ResourceUrl').value='';courseLineFilters[subject]=teacher;
 renderResources(subject);renderStoredFiles(subject);toast('课程入口已保存，可从老师分类中打开');
}
