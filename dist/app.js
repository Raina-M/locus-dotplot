import {makeDemo,parseFasta,parseTrack,autoK,clampRegion,sequenceOrigin,referenceName,withSequenceCoordinates,projectTrackFeatures,trackCoverage} from './core.js';
const $=id=>document.getElementById(id),fmt=n=>Math.round(n).toLocaleString('en-US');
const bp=n=>n>=1e6?`${+(n/1e6).toFixed(2)} Mb`:n>=1000?`${+(n/1000).toFixed(1)} kb`:`${Math.round(n)} bp`;
const colors=['#187f78','#b98b47','#648bbb','#a77aa3','#bb7575','#819b60'];
let sequences=[],tracks=[],x,y,linked=true,k=41,result=null,worker,timer,job=0,cache=new Map(),geometry,hover=null,drag=null,toastTimer,viewKey='',demo=true;
const canvas=$('plot'),ctx=canvas.getContext('2d'),base=document.createElement('canvas');
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function setup(data,isDemo=true,label='Synthetic reference'){
  if(worker)worker.terminate();clearTimeout(timer);job++;sequences=data.sequences;tracks=data.tracks.map((t,i)=>({...t,id:crypto.randomUUID(),visible:true,color:t.color||colors[i%colors.length]}));
  x={chr:0,start:0,end:sequences[0].seq.length};y={...x};linked=true;demo=isDemo;cache.clear();result=null;
  for(const id of ['xChr','yChr']){$(id).replaceChildren(...sequences.map((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=s.label||s.name;return o;}));}
  $('genomeName').textContent=label;$('genomeMeta').textContent=`${sequences.length} contig${sequences.length>1?'s':''} · ${bp(sequences.reduce((n,s)=>n+s.seq.length,0))}`;
  $('demoNote').textContent=demo?'Explore a synthetic chromosome with a duplication, an inversion, and repeat elements.':'Your local genome is loaded. Add matching annotation or signal files to explore its context.';
  $('inversionButton').disabled=!demo;document.querySelector('.example-badge').textContent=demo?'EXAMPLE DATA':'LOCAL DATA';
  $('autoK').checked=true;updateLinked();renderTrackList();navigate();
}
function renderTrackList(){
  $('trackCount').textContent=String(tracks.length).padStart(2,'0');$('trackList').replaceChildren();
  const warnings=[];
  for(const t of tracks){
    const entry=document.createElement('div'),row=document.createElement('div');entry.className='track-entry';row.className='track-item';
    const check=document.createElement('input');check.type='checkbox';check.checked=t.visible;check.setAttribute('aria-label',`Show ${t.name}`);check.onchange=()=>{t.visible=check.checked;renderBase();};
    const swatch=document.createElement('span');swatch.className='swatch';swatch.style.background=t.color;
    const name=document.createElement('span');name.className='track-name';name.textContent=t.name;name.title=t.name;
    const kind=document.createElement('span');kind.className='track-kind';kind.textContent=t.kind==='signal'?'SIGNAL':'BED/GFF';
    const remove=document.createElement('button');remove.className='remove-track';remove.textContent='×';remove.setAttribute('aria-label',`Remove ${t.name}`);remove.onclick=()=>{tracks=tracks.filter(a=>a.id!==t.id);renderTrackList();renderBase();};
    row.append(check,swatch,name,kind,remove);entry.append(row);
    const coverage=trackCoverage(t,sequences),summary=document.createElement('small');summary.className='track-coverage';
    summary.textContent=`${fmt(coverage.overlapping)} / ${fmt(coverage.total)} overlap loaded sequence`;
    if(coverage.outside||coverage.unmatched){
      summary.classList.add('track-warning');const detail=[coverage.outside?`${fmt(coverage.outside)} outside loaded coordinates`:null,coverage.unmatched?`${fmt(coverage.unmatched)} with unmatched chromosome names`:null].filter(Boolean).join('; ');
      summary.title=detail;warnings.push(`${t.name}: ${detail}.`);
      const fix=document.createElement('button');fix.className='text-button track-fix';fix.textContent='Check sequence coordinates';fix.onclick=()=>openCoordinates(sequences.findIndex(s=>t.features.some(f=>f.chr===referenceName(s)))) ;entry.append(summary,fix);
    }else entry.append(summary);
    for(const note of t.importNotes||[]){const n=document.createElement('small');n.className='track-import-note';n.textContent=note;entry.append(n);}
    $('trackList').append(entry);
  }
  $('trackWarning').hidden=!warnings.length;$('trackWarningText').textContent=warnings.join(' ')+' Extracted FASTA files need their source chromosome and one-based start set explicitly.';
}
const regionText=r=>`${fmt(sequenceOrigin(sequences[r.chr])+r.start+1)}–${fmt(sequenceOrigin(sequences[r.chr])+r.end)}`;
function updateLinked(){$('linkAxes').classList.toggle('linked',linked);$('linkAxes').setAttribute('aria-pressed',String(linked));$('linkAxes').querySelector('small').textContent=linked?'LINKED':'FREE';}
function navigate(){
  x=clampRegion(x,sequences[x.chr].seq.length);y=clampRegion(y,sequences[y.chr].seq.length);
  $('xChr').value=x.chr;$('yChr').value=y.chr;$('xRegion').value=regionText(x);$('yRegion').value=regionText(y);
  if($('autoK').checked)k=autoK(Math.max(x.end-x.start,y.end-y.start));
  $('kSlider').value=k;$('kValue').innerHTML=`${k} <small>bp</small>`;
  $('zoomLabel').textContent=`${+(sequences[x.chr].seq.length/(x.end-x.start)).toFixed(1)}×`;
  $('modeBadge').textContent=x.chr===y.chr?'SELF COMPARISON':'CONTIG COMPARISON';
  $('windowStat').textContent=`${bp(x.end-x.start)} × ${bp(y.end-y.start)}`;
  viewKey=JSON.stringify([x,y,k,$('repeatFilter').value]);result=cache.get(viewKey)||null;hover=null;renderBase();
  clearTimeout(timer);if(worker){worker.terminate();worker=null;}job++;
  if(result){finish(result);return;}
  $('computing').hidden=false;$('exportButton').disabled=true;
  for(const id of ['matchesStat','timeStat','samplingStat'])$(id).textContent='…';
  $('status').textContent='Computing visible region…';
  const id=job,key=viewKey;
  timer=setTimeout(()=>{
    worker=new Worker('./worker.js',{type:'module'});
    worker.onerror=e=>{if(id!==job)return;$('computing').hidden=true;$('status').textContent='Computation failed';toast('The dotplot worker failed. Serve this app over HTTP and use a smaller region.');console.error(e);};
    worker.onmessage=({data})=>{if(data.id!==job)return;if(data.error){toast(data.error);$('computing').hidden=true;$('status').textContent=data.error;for(const id of ['matchesStat','timeStat','samplingStat'])$(id).textContent='Unavailable';return;}result=data;cache.set(key,result);if(cache.size>8)cache.delete(cache.keys().next().value);finish(result);};
    worker.postMessage({type:'init',sequences});worker.postMessage({id,x,y,k,options:{maxOccurrence:Number($('repeatFilter').value)}});
  },100);
}
function finish(r){$('computing').hidden=true;$('exportButton').disabled=false;$('matchesStat').textContent=fmt(r.points.length/3);$('timeStat').textContent=`${Math.round(r.ms)} ms`;$('samplingStat').textContent=r.w===1?'All k-mer positions':`${r.w} positions`;
  $('filterNote').textContent=`${fmt(r.filtered)} repetitive Y seeds omitted.${r.limited?' Pair cap reached; matches are truncated.':' Sampled exact matches; not an alignment or exhaustive repeat census.'}`;
  $('status').textContent=`${demo?'Synthetic example':'Local genome'} · ${fmt(r.points.length/3)} verified seed pairs${r.limited?' · PAIR CAP REACHED':''}`;renderBase();}
function readRegion(axis){try{const value=$(axis+'Region').value.trim().replaceAll(',','');const m=value.match(/^(\d+)\s*[-–:]\s*(\d+)$/);if(!m)throw Error('Enter a region as start–end, for example 1–100,000.');let r=axis==='x'?x:y;const origin=sequenceOrigin(sequences[r.chr]),start=Number(m[1])-1-origin,end=Number(m[2])-origin;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>sequences[r.chr].seq.length)throw Error(`Region must be within ${fmt(origin+1)}–${fmt(origin+sequences[r.chr].seq.length)}.`);r={...r,start,end};if(axis==='x')x=r;else y=r;if(linked){if(axis==='x')y={...r};else x={...r};}navigate();}catch(e){toast(e.message);}}
function transformRegion(r,factor,anchor=.5){const span=r.end-r.start,newSpan=span*factor,position=r.start+span*anchor;return clampRegion({...r,start:position-newSpan*anchor,end:position+newSpan*(1-anchor)},sequences[r.chr].seq.length);}
function zoom(factor,ax=.5,ay=.5){x=transformRegion(x,factor,ax);y=linked?{...x}:transformRegion(y,factor,ay);navigate();}
function pan(dx,dy=dx){const shift=(r,d)=>clampRegion({...r,start:r.start+d,end:r.end+d},sequences[r.chr].seq.length);x=shift(x,dx);y=linked?{...x}:shift(y,dy);navigate();}
function ticks(r){const span=r.end-r.start,raw=span/5,power=10**Math.floor(Math.log10(raw)),v=raw/power,step=(v<=1?1:v<=2?2:v<=5?5:10)*power,origin=sequenceOrigin(sequences[r.chr]);const out=[];for(let p=Math.ceil((origin+r.start)/step)*step;p<=origin+r.end;p+=step)out.push(p-origin);return out;}
function scale(v,r){return (v-r.start)/(r.end-r.start);}
function renderBase(){
  if(!x)return;const width=$('plotContainer').clientWidth,dpr=Math.min(window.devicePixelRatio||1,2),visible=tracks.filter(t=>t.visible),row=23,left=visible.length?Math.max(91,94+visible.length*16):60,top=visible.length?24+visible.length*row:34,size=Math.max(130,Math.min(width-left-30,580)),height=top+size+49;
  geometry={left,top,size,width,height,row,visible};canvas.style.height=`${height}px`;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);base.width=canvas.width;base.height=canvas.height;
  const c=base.getContext('2d');c.scale(dpr,dpr);c.fillStyle='#fff';c.fillRect(0,0,width,height);c.font='9px "DM Sans",system-ui';c.textBaseline='middle';
  c.fillStyle='#fbfcf9';c.fillRect(left,top,size,size);
  // Track names at the upper left; the same ordered bands appear on both axes.
  visible.forEach((t,i)=>{
    const yy=12+i*row;c.fillStyle=t.color;c.fillRect(9,yy-2,4,4);c.fillStyle='#8c9c91';c.font='8px "DM Sans",system-ui';let label=t.name;if(label.length>Math.floor((left-22)/4.3))label=label.slice(0,Math.floor((left-22)/4.3)-1)+'…';c.fillText(label,19,yy);
    drawTrack(c,t,x,left,yy-6,size,15,false);
    const xx=left-33-(visible.length-1-i)*16;drawTrack(c,t,y,xx,top,12,size,true);
  });
  c.font='8px ui-monospace,monospace';c.lineWidth=1;
  for(const p of ticks(x)){const px=left+scale(p,x)*size;c.strokeStyle='#edf1eb';c.beginPath();c.moveTo(px,top);c.lineTo(px,top+size);c.stroke();c.fillStyle='#97a49a';c.textAlign='center';c.fillText(bp(p+sequenceOrigin(sequences[x.chr])),px,top-10);}
  for(const p of ticks(y)){const py=top+scale(p,y)*size;c.strokeStyle='#edf1eb';c.beginPath();c.moveTo(left,py);c.lineTo(left+size,py);c.stroke();c.fillStyle='#97a49a';c.textAlign='right';c.fillText(bp(p+sequenceOrigin(sequences[y.chr])),width>420?left-36-visible.length*16:Math.max(20,left-36-visible.length*16),py);}
  c.strokeStyle='#dae4d8';c.strokeRect(left+.5,top+.5,size,size);
  if(result){c.save();c.beginPath();c.rect(left,top,size,size);c.clip();const pts=result.points;
    for(const strand of [1,-1]){if(!$(strand===1?'showForward':'showReverse').checked)continue;c.fillStyle=strand===1?'#177e768c':'#cd8b62a0';c.strokeStyle=strand===1?'#177e768c':'#cd8b62a0';c.lineWidth=1;
      const kx=k/(x.end-x.start)*size,ky=k/(y.end-y.start)*size;
      c.beginPath();for(let i=0;i<pts.length;i+=3){if(pts[i+2]!==strand)continue;const px=left+pts[i]/(x.end-x.start)*size,py=top+pts[i+1]/(y.end-y.start)*size;
        if(kx>1.5||ky>1.5){c.moveTo(px,py+(strand<0?ky:0));c.lineTo(px+Math.max(.7,kx),py+(strand>0?ky:0));}else c.rect(px,py,1,1);
      }if(kx>1.5||ky>1.5)c.stroke();else c.fill();
    }c.restore();}
  c.textAlign='center';c.fillStyle='#6f8878';c.font='9px "DM Sans",system-ui';c.fillText(`${referenceName(sequences[x.chr])}  ·  X`,left+size/2,top+size+29);
  c.save();c.translate(13,top+size/2);c.rotate(-Math.PI/2);c.fillText(`${referenceName(sequences[y.chr])}  ·  Y`,0,0);c.restore();
  $('resolutionStat').textContent=`${bp((x.end-x.start)/size)}/px`;
  drawOverlay();
}
function matchingFeatures(t,r){return projectTrackFeatures(t,sequences[r.chr],r);}
function drawTrack(c,t,r,px,py,w,h,vertical){
  c.save();c.beginPath();c.rect(px,py,w,h);c.clip();c.fillStyle='#f5f7f2';c.fillRect(px,py,w,h);
  const length=vertical?h:w,features=matchingFeatures(t,r),toPos=v=>scale(v,r)*length;
  if(t.kind==='signal'){
    // Pixel summaries retain extrema instead of drawing every input interval.
    const count=Math.ceil(length),lo=new Float64Array(count),hi=new Float64Array(count),occupied=new Uint8Array(count);let min=0,max=0;
    for(const f of features){min=Math.min(min,f.value);max=Math.max(max,f.value);const a=Math.max(0,Math.floor(toPos(f.start))),b=Math.min(count,Math.max(a+1,Math.ceil(toPos(f.end))));for(let i=a;i<b;i++){if(!occupied[i]){lo[i]=hi[i]=f.value;occupied[i]=1;}else{lo[i]=Math.min(lo[i],f.value);hi[i]=Math.max(hi[i],f.value);}}}
    const range=max-min||1,extent=vertical?w:h,z=(0-min)/range*extent;c.fillStyle=t.color;c.globalAlpha=.8;
    for(let i=0;i<count;i++){if(!occupied[i])continue;const l=(Math.min(0,lo[i])-min)/range*extent,u=(Math.max(0,hi[i])-min)/range*extent;
      if(vertical)c.fillRect(px+extent-u,py+i,Math.max(1,u-l),1);else c.fillRect(px+i,py+extent-u,1,Math.max(1,u-l));}
    c.globalAlpha=1;c.strokeStyle='#d4ddd1';c.lineWidth=.5;c.beginPath();if(vertical){c.moveTo(px+extent-z,py);c.lineTo(px+extent-z,py+h);}else{c.moveTo(px,py+extent-z);c.lineTo(px+w,py+extent-z);}c.stroke();
  }else{
    c.fillStyle=t.color;c.strokeStyle=t.color;c.lineWidth=.7;
    for(const f of features){const a=toPos(f.start),b=toPos(f.end),mid=vertical?px+w/2:py+h/2;
      c.globalAlpha=.65;c.beginPath();if(vertical){c.moveTo(mid,py+a);c.lineTo(mid,py+b);}else{c.moveTo(px+a,mid);c.lineTo(px+b,mid);}c.stroke();
      c.globalAlpha=.9;for(const block of f.blocks?.length?f.blocks:[f]){const bs=toPos(block.start),be=toPos(block.end);if(vertical)c.fillRect(mid-2.5,py+bs,5,Math.max(1,be-bs));else c.fillRect(px+bs,mid-3,Math.max(1,be-bs),6);}
      if($('showStrand').checked&&f.strand!=='.'&&f.strand&&b-a>8){
        for(let p=a+6;p<b-2;p+=20){const dir=f.strand==='+'?1:-1;c.beginPath();c.strokeStyle='#fff';c.lineWidth=.8;if(vertical){c.moveTo(mid-1.8,py+p-dir*2);c.lineTo(mid,py+p);c.lineTo(mid+1.8,py+p-dir*2);}else{c.moveTo(px+p-dir*2,mid-1.8);c.lineTo(px+p,mid);c.lineTo(px+p-dir*2,mid+1.8);}c.stroke();}c.strokeStyle=t.color;c.lineWidth=.7;
      }
    }
  }c.restore();
}
function drawOverlay(){
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(base,0,0);const dpr=canvas.width/geometry.width;ctx.setTransform(dpr,0,0,dpr,0,0);const {left,top,size}=geometry;
  if(hover&&inside(hover)){ctx.save();ctx.beginPath();ctx.rect(left,top,size,size);ctx.clip();ctx.strokeStyle='#789e7770';ctx.lineWidth=.7;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(hover.x,top);ctx.lineTo(hover.x,top+size);ctx.moveTo(left,hover.y);ctx.lineTo(left+size,hover.y);ctx.stroke();ctx.restore();}
  if(drag?.select&&hover){ctx.fillStyle='#177e761a';ctx.strokeStyle='#177e76';ctx.lineWidth=1;const a=clipPoint(drag.point),b=clipPoint(hover);ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);}
}
function location(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
function inside(p){const {left,top,size}=geometry;return p.x>=left&&p.x<=left+size&&p.y>=top&&p.y<=top+size;}
function clipPoint(p){const {left,top,size}=geometry;return {x:Math.max(left,Math.min(left+size,p.x)),y:Math.max(top,Math.min(top+size,p.y))};}
function showHover(p){
  const {left,top,size,visible,row,width}=geometry;const tool=$('tooltip');let text='';
  if(inside(p)){text=`X  ${referenceName(sequences[x.chr])}:${fmt(sequenceOrigin(sequences[x.chr])+x.start+(p.x-left)/size*(x.end-x.start)+1)}\nY  ${referenceName(sequences[y.chr])}:${fmt(sequenceOrigin(sequences[y.chr])+y.start+(p.y-top)/size*(y.end-y.start)+1)}`;}
  else{
    let index=-1,r,pos;
    if(p.x>=left&&p.x<=left+size&&p.y<top-14){index=Math.round((p.y-12)/row);r=x;pos=x.start+(p.x-left)/size*(x.end-x.start);}
    else if(p.y>=top&&p.y<=top+size&&p.x<left-20){index=visible.length-1-Math.round((left-27-p.x)/16);r=y;pos=y.start+(p.y-top)/size*(y.end-y.start);}
    const t=visible[index];if(t&&r){const features=matchingFeatures(t,r).filter(f=>f.start<=pos&&f.end>pos),origin=sequenceOrigin(sequences[r.chr]);text=`${t.name}\n${referenceName(sequences[r.chr])}:${fmt(origin+pos+1)}`;if(features.length){text+='\n'+features.slice(0,4).map(f=>`${t.kind==='signal'?`Value: ${+f.value.toPrecision(5)}`:f.name} · ${fmt(origin+f.start+1)}–${fmt(origin+f.end)}${f.strand&&f.strand!=='.'?` (${f.strand})`:''}`).join('\n');}else text+='\nNo feature at this position';}
  }
  tool.hidden=!text;if(text){tool.textContent=text;tool.style.left=`${Math.max(4,Math.min(width-225,p.x+14))}px`;tool.style.top=`${Math.max(4,Math.min(geometry.height-95,p.y+14))}px`;}
}
canvas.addEventListener('pointermove',e=>{hover=location(e);if(drag){$('tooltip').hidden=true;}else showHover(hover);drawOverlay();});
canvas.addEventListener('pointerleave',()=>{if(!drag){hover=null;$('tooltip').hidden=true;drawOverlay();}});
canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;const point=location(e);if(!inside(point))return;canvas.setPointerCapture(e.pointerId);drag={point,select:e.shiftKey,x:{...x},y:{...y}};canvas.style.cursor=e.shiftKey?'crosshair':'grabbing';});
canvas.addEventListener('pointerup',e=>{
  if(!drag)return;const p=clipPoint(location(e)),d=drag;drag=null;canvas.style.cursor='crosshair';$('tooltip').hidden=true;
  const {left,top,size}=geometry,dx=p.x-d.point.x,dy=p.y-d.point.y;if(Math.abs(dx)<3&&Math.abs(dy)<3){drawOverlay();return;}
  if(d.select){if(Math.abs(dx)<5||Math.abs(dy)<5)return;const region=(r,a,b,origin)=>({...r,start:r.start+(Math.min(a,b)-origin)/size*(r.end-r.start),end:r.start+(Math.max(a,b)-origin)/size*(r.end-r.start)});x=region(d.x,d.point.x,p.x,left);y=linked?{...x}:region(d.y,d.point.y,p.y,top);navigate();}
  else pan(-dx/size*(x.end-x.start),-dy/size*(y.end-y.start));
});
canvas.addEventListener('pointercancel',()=>{drag=null;canvas.style.cursor='crosshair';drawOverlay();});
canvas.addEventListener('wheel',e=>{const p=location(e);if(!inside(p))return;e.preventDefault();const {left,top,size}=geometry;zoom(Math.exp(Math.sign(e.deltaY)*.22),(p.x-left)/size,(p.y-top)/size);},{passive:false});
canvas.addEventListener('dblclick',e=>{const p=location(e);if(inside(p))zoom(.5,(p.x-geometry.left)/geometry.size,(p.y-geometry.top)/geometry.size);});
$('zoomIn').onclick=()=>zoom(.5);$('zoomOut').onclick=()=>zoom(2);$('panLeft').onclick=()=>pan(-(x.end-x.start)*.25);$('panRight').onclick=()=>pan((x.end-x.start)*.25);
$('fitButton').onclick=()=>{x={...x,start:0,end:sequences[x.chr].seq.length};y={...y,start:0,end:sequences[y.chr].seq.length};navigate();};
$('linkAxes').onclick=()=>{linked=!linked;if(linked)y={...x};updateLinked();navigate();};
for(const axis of ['x','y']){$('go'+axis.toUpperCase()).onclick=()=>readRegion(axis);$(axis+'Region').onkeydown=e=>{if(e.key==='Enter')readRegion(axis);};$(axis+'Chr').onchange=e=>{const r={chr:Number(e.target.value),start:0,end:sequences[Number(e.target.value)].seq.length};if(axis==='x')x=r;else y=r;if(linked){x={...r};y={...r};}navigate();};}
$('kSlider').oninput=e=>{k=Number(e.target.value);$('autoK').checked=false;navigate();};$('autoK').onchange=navigate;$('repeatFilter').onchange=navigate;
for(const id of ['showForward','showReverse','showStrand'])$(id).onchange=renderBase;
function openGuide(){$('guide').showModal();}for(const id of ['guideButton','helpButton'])$(id).onclick=openGuide;$('closeGuide').onclick=()=>$('guide').close();$('guide').onclick=e=>{if(e.target===$('guide')){const r=$('guide').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('guide').close();}};
function populateCoordinates(){const s=sequences[Number($('coordinateSequence').value)];$('coordinateChromosome').value=referenceName(s);$('coordinateStart').value=fmt(sequenceOrigin(s)+1);$('coordinateLength').textContent=`${fmt(s.seq.length)} bp loaded. Enter the chromosome position of the first FASTA base, one-based.`;$('coordinateError').textContent='';}
function openCoordinates(index=x.chr){
  $('coordinateSequence').replaceChildren(...sequences.map((s,i)=>{const option=document.createElement('option');option.value=i;option.textContent=s.label||s.name;return option;}));
  $('coordinateSequence').value=index>=0?index:x.chr;populateCoordinates();$('coordinatesDialog').showModal();
}
$('sequenceCoordinates').onclick=()=>openCoordinates();$('fixTrackCoordinates').onclick=()=>openCoordinates();$('mobileCoordinates').onclick=()=>openCoordinates();
$('coordinateSequence').onchange=populateCoordinates;$('closeCoordinates').onclick=()=>$('coordinatesDialog').close();
$('coordinatesForm').onsubmit=e=>{
  e.preventDefault();try{const value=$('coordinateStart').value.trim().replaceAll(',','');if(!/^\d+$/.test(value))throw Error('Enter a one-based integer source start.');
    const index=Number($('coordinateSequence').value);sequences[index]=withSequenceCoordinates(sequences[index],$('coordinateChromosome').value,Number(value));
    $('coordinatesDialog').close();renderTrackList();navigate();toast('Sequence coordinates updated. Locus labels and tracks now use the source chromosome coordinates.');
  }catch(error){$('coordinateError').textContent=error.message;}
};
$('workspaceTab').onclick=()=>canvas.focus();$('loadGenome').onclick=()=>$('genomeFile').click();$('addTrack').onclick=()=>$('trackFile').click();
$('mobileGenome').onclick=()=>$('genomeFile').click();$('mobileTrack').onclick=()=>$('trackFile').click();$('mobileFit').onclick=()=>$('fitButton').click();
$('genomeFile').onchange=async e=>{
  const files=[...e.target.files];if(!files.length)return;
  try{if(files.reduce((n,f)=>n+f.size,0)>20*1024**2)throw Error('This prototype accepts up to 20 MiB of uncompressed FASTA per workspace. Larger genomes need the indexed backend described in Methods.');
    const loaded=[];for(const file of files){for(const s of parseFasta(await file.text()))loaded.push({...s,label:files.length>1?`${file.name} / ${s.name}`:s.name});}
    setup({sequences:loaded,tracks:[]},false,files.length===1?files[0].name:`${files.length} FASTA files`);toast(`Loaded ${loaded.length} sequences. For an extracted region, use Sequence coordinates to set its source start (or a chr:start-end FASTA header).`);
  }catch(error){toast(error.message);}finally{e.target.value='';}
};
$('trackFile').onchange=async e=>{
  const files=[...e.target.files];try{if(tracks.length+files.length>12)throw Error('Please keep at most 12 tracks in this prototype.');
    const loaded=[];for(const file of files){if(file.size>10*1024**2)throw Error('Track files must be at most 10 MiB; use indexed formats for larger datasets.');const t=parseTrack(await file.text(),file.name);t.id=crypto.randomUUID();t.visible=true;t.color=colors[(tracks.length+loaded.length)%colors.length];loaded.push(t);}
    tracks.push(...loaded);renderTrackList();renderBase();const overlapping=loaded.reduce((n,t)=>n+trackCoverage(t,sequences).overlapping,0);toast(`Added ${loaded.length} track${loaded.length>1?'s':''}; ${fmt(overlapping)} features overlap the loaded sequence coordinates.${overlapping?'':' Check Sequence coordinates for an extracted FASTA.'}`);
  }catch(error){toast(error.message);}finally{e.target.value='';}
};
$('resetDemo').onclick=()=>setup(makeDemo());
$('inversionButton').onclick=()=>{if(!demo)return;linked=false;updateLinked();x={chr:0,start:140000,end:220000};y={chr:0,start:385000,end:465000};navigate();};
$('exportButton').onclick=()=>{hover=null;drawOverlay();const origin=sequenceOrigin(sequences[x.chr]),filename=`locus-${referenceName(sequences[x.chr]).replace(/[^\w.-]/g,'_')}-${origin+x.start+1}-${origin+x.end}-k${k}.png`;canvas.toBlob(blob=>{if(!blob){toast('PNG generation failed.');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.download=filename;a.href=url;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);},'image/png');};
document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||$('guide').open||$('coordinatesDialog').open)return;const d=(x.end-x.start)*.15;if(e.key==='+'||e.key==='='){e.preventDefault();zoom(.5);}if(e.key==='-'){e.preventDefault();zoom(2);}if(e.key==='ArrowLeft'){e.preventDefault();pan(-d);}if(e.key==='ArrowRight'){e.preventDefault();pan(d);}if(e.key==='ArrowUp'){e.preventDefault();pan(linked?-d:0,-(y.end-y.start)*.15);}if(e.key==='ArrowDown'){e.preventDefault();pan(linked?d:0,(y.end-y.start)*.15);}});
new ResizeObserver(()=>renderBase()).observe($('plotContainer'));
setup(makeDemo());
