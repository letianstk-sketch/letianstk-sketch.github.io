/* Cache finished ink; repaint only the changing stroke's area. Stored points are never modified. */
(function(root){
  function paint(ctx,stroke,ratio,width,height){
    if(!stroke?.points.length)return;
    const w=width/ratio,h=height/ratio;
    ctx.save();ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.globalCompositeOperation=stroke.tool==='eraser'?'destination-out':'source-over';
    ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.tool==='eraser'?stroke.width*4:stroke.width;
    ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
    stroke.points.forEach((p,i)=>{const x=p.x*w,y=p.y*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
    if(stroke.points.length===1)ctx.lineTo(stroke.points[0].x*w+.1,stroke.points[0].y*h+.1);
    ctx.stroke();ctx.restore();
  }
  function bounds(stroke,width,height,ratio){
    if(!stroke?.points.length)return null;
    let x=Infinity,y=Infinity,r=-Infinity,b=-Infinity;
    for(const p of stroke.points){x=Math.min(x,p.x*width);y=Math.min(y,p.y*height);r=Math.max(r,p.x*width);b=Math.max(b,p.y*height)}
    const margin=(stroke.tool==='eraser'?stroke.width*4:stroke.width)*ratio/2+3;
    return {x:Math.max(0,Math.floor(x-margin)),y:Math.max(0,Math.floor(y-margin)),r:Math.min(width,Math.ceil(r+margin)),b:Math.min(height,Math.ceil(b+margin))};
  }
  function union(a,b){if(!a)return b;if(!b)return a;return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),r:Math.max(a.r,b.r),b:Math.max(a.b,b.b)}}
  function create(canvas,makeCanvas=()=>document.createElement('canvas')){
    const cache=makeCanvas();let source=null,count=0,last=null,lastRatio=0,previous=null,lastActive=null,lastPointCount=-1;
    function draw(strokes,active,ratio){
      const width=canvas.width,height=canvas.height;if(!width||!height)return;
      const finished=strokes.length-(active&&strokes.at(-1)===active?1:0);
      const reset=cache.width!==width||cache.height!==height||source!==strokes||lastRatio!==ratio||finished<count||(count&&last!==strokes[count-1]);
      let dirty=previous;
      if(reset){cache.width=width;cache.height=height;source=strokes;count=0;last=null;lastRatio=ratio;dirty={x:0,y:0,r:width,b:height};lastPointCount=-1}
      if(!reset&&count===finished&&lastActive===active&&lastPointCount===(active?.points.length??0))return;
      const base=cache.getContext('2d');
      for(;count<finished;count++){paint(base,strokes[count],ratio,width,height);dirty=union(dirty,bounds(strokes[count],width,height,ratio))}
      last=count?strokes[count-1]:null;
      const current=bounds(active,width,height,ratio);dirty=union(dirty,current);
      if(dirty&&dirty.r>dirty.x&&dirty.b>dirty.y){
        const ctx=canvas.getContext('2d'),w=dirty.r-dirty.x,h=dirty.b-dirty.y;
        ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(dirty.x,dirty.y,w,h);
        ctx.drawImage(cache,dirty.x,dirty.y,w,h,dirty.x,dirty.y,w,h);
        if(active){ctx.beginPath();ctx.rect(dirty.x,dirty.y,w,h);ctx.clip();paint(ctx,active,ratio,width,height)}
        ctx.restore();
      }
      previous=current;lastActive=active;lastPointCount=active?.points.length??0;
    }
    function release(){cache.width=cache.height=0;source=null;count=0;last=null;previous=null;lastActive=null;lastPointCount=-1}
    return {draw,release};
  }
  root.InkRenderer={create};
})(typeof window==='undefined'?globalThis:window);
