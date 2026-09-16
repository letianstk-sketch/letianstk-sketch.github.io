/* Pure scheduling helpers. Times are minutes after midnight. */
(function(root){
  const clock = value => { const [h,m]=value.split(':').map(Number); return h*60+m; };
  const label = value => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
  function subtract(windows,blocked){
    let free=windows.map(([start,end])=>({start,end}));
    for(const busy of blocked) free=free.flatMap(slot=>busy.end<=slot.start||busy.start>=slot.end?[slot]:[
      ...(busy.start>slot.start?[{start:slot.start,end:busy.start}]:[]),
      ...(busy.end<slot.end?[{start:busy.end,end:slot.end}]:[])
    ]);
    return free.sort((a,b)=>a.start-b.start);
  }
  function allocate(tasks,windows,blocked,breakMinutes=5){
    const free=subtract(windows,blocked),sessions=[],pending=[];
    // Place long concentration tasks first; smaller tasks fill the gaps.
    const ordered=tasks.map((task,index)=>({...task,index})).sort((a,b)=>(a.priority||0)-(b.priority||0)||(b.morning?1:0)-(a.morning?1:0)||(b.focus?1:0)-(a.focus?1:0)||b.minutes-a.minutes||a.index-b.index);
    for(const task of ordered){
      let remaining=task.minutes,part=0;
      while(remaining>0){
        const candidates=free.filter(slot=>slot.end-slot.start>=Math.min(remaining,task.focus?25:10));
        if(!candidates.length)break;
        const whole=candidates.filter(slot=>slot.end-slot.start>=remaining);
        const pool=whole.length?whole:candidates;
        // Vocabulary favors the morning; focused work favors the longest uninterrupted block.
        const slot=task.morning?pool[0]:whole[0]||pool.reduce((a,b)=>a.end-a.start>=b.end-b.start?a:b);
        const minutes=Math.min(remaining,slot.end-slot.start,90),start=slot.start;
        sessions.push({...task,start,end:start+minutes,minutes,part:++part});
        slot.start=Math.min(slot.end,start+minutes+breakMinutes); remaining-=minutes;
      }
      if(remaining)pending.push({...task,minutes:remaining});
    }
    return {sessions:sessions.sort((a,b)=>a.start-b.start),pending,total:tasks.reduce((n,t)=>n+t.minutes,0),scheduled:sessions.reduce((n,t)=>n+t.minutes,0)};
  }
  root.StudyPlanner={clock,label,subtract,allocate};
})(typeof window==='undefined'?globalThis:window);
