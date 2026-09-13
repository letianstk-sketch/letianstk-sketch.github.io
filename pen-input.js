/* One owner per stroke: other contacts never draw, erase, or finish it. */
(function(root){
  function bind(canvas,state,{point,redraw,save,allowTouch,enabled=()=>true}){
    let owner=null,ownerType='',lastPen=-Infinity;
    const block=e=>{if(e.cancelable)e.preventDefault();};
    const finish=(e,cancel=false)=>{
      if(owner===null||(e&&e.pointerId!==owner))return;
      const id=owner;owner=null;ownerType='';state.active=null;
      if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);
      save();
    };
    canvas.addEventListener('pointerdown',e=>{
      if(!enabled())return;
      block(e);
      if(e.pointerType==='pen')lastPen=Date.now();
      if(e.pointerType==='touch'&&(!allowTouch()||Date.now()-lastPen<1000||e.isPrimary===false||Math.max(e.width||0,e.height||0)>35))return;
      if(!['pen','mouse','touch'].includes(e.pointerType)||e.button!==0)return;
      if(owner!==null){
        if(e.pointerType!=='pen'||ownerType!=='touch')return;
        // A pen arriving after a finger wins; discard the provisional finger mark.
        state.strokes=state.strokes.filter(stroke=>stroke!==state.active);finish();
      }
      if(state.loading)return;
      owner=e.pointerId;ownerType=e.pointerType;
      state.active={tool:state.tool,color:state.color,width:state.width,points:[point(e,canvas.getBoundingClientRect())]};
      state.strokes.push(state.active);
      try{canvas.setPointerCapture(e.pointerId)}catch{}
      redraw();
    });
    canvas.addEventListener('pointermove',e=>{
      if(e.pointerType==='pen')lastPen=Date.now();
      if(e.pointerId!==owner||!state.active)return;
      block(e);
      const samples=e.getCoalescedEvents?.()||[];
      const rect=canvas.getBoundingClientRect();
      (samples.length?samples:[e]).forEach(sample=>state.active.points.push(point(sample,rect)));
      redraw();
    });
    ['pointerup','pointercancel','lostpointercapture'].forEach(type=>canvas.addEventListener(type,e=>finish(e)));
    canvas.addEventListener('pointerleave',e=>{if(e.buttons===0)finish(e)});
    canvas.addEventListener('contextmenu',e=>{if(enabled())block(e)});
    // Edge on Android may also emit Touch Events: stop palm scroll/zoom in the writing surface.
    ['touchstart','touchmove','touchend'].forEach(type=>canvas.addEventListener(type,e=>{if(enabled())block(e)},{passive:false}));
    return {finish,isWriting:()=>owner!==null,isPenWriting:()=>owner!==null&&ownerType==='pen'};
  }
  root.PenInput={bind};
})(typeof window==='undefined'?globalThis:window);
