import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {Blob} from 'node:buffer';
import * as core from '../dist/core.js';
import * as fasta from '../dist/fasta.js';
import assert from 'node:assert/strict';
test('large-view gate, box zoom, and regional worker payload stay consistent',async()=>{
 const elements=new Map(),messages=[],handlers={},paint=[],ctx=new Proxy({},{get:(t,k)=>t[k]??(()=>{}),set:(t,k,v)=>(paint.push([k,v]),t[k]=v,true)});
 function element(id){return {id,value:({repeatFilter:'30',forwardColor:'#177e76',reverseColor:'#cd8b62',strokeSize:'1',computeCutoff:'5'})[id]||'',checked:true,hidden:false,disabled:false,clientWidth:900,width:900,height:700,style:{},classList:{toggle(){},add(){}},replaceChildren(){},append(){},remove(){},setAttribute(){},querySelector(){return element('small');},getContext(){return ctx;},getBoundingClientRect(){return {left:0,top:0};},setPointerCapture(){},addEventListener(name,fn){handlers[name]=fn;}};}
 const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
 const sandbox={...core,...fasta,document:{getElementById:get,createElement:element,querySelector:element,addEventListener(){}},window:{devicePixelRatio:1},ResizeObserver:class{observe(){}},crypto:{randomUUID:()=>String(Math.random())},console,setTimeout,clearTimeout,Worker:class{terminate(){this.dead=true;}postMessage(data){messages.push(data);setTimeout(()=>{if(!this.dead)this.onmessage({data:{id:data.id,points:new Int32Array([0,0,1,10,10,-1]),w:1,ms:1,filtered:0,limited:false}});},0);}}};
 vm.createContext(sandbox);const app=(await fs.readFile(new URL('../dist/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');vm.runInContext(app,sandbox);
 const wait=()=>new Promise(r=>setTimeout(r,400));await wait();assert.equal(messages.length,1);
 const bases='ACGT'.repeat(6*1024*1024);sandbox.big=await fasta.indexFasta(new Blob(['>big\n',bases]));
 vm.runInContext('setup({sequences:big,tracks:[]},false)',sandbox);await wait();assert.equal(messages.length,1);assert.match(get('status').textContent,/Zoom in/);assert.equal(get('computing').hidden,true);assert.equal(get('exportButton').disabled,true);
 // Rectangle from 10% to 20% of X and 30% to 40% of Y, on a paused view.
 const geometry=vm.runInContext('geometry',sandbox),{left,top,size}=geometry;
 handlers.pointerdown({button:0,pointerId:1,clientX:left+size*.1,clientY:top+size*.3,shiftKey:false});
 handlers.pointermove({clientX:left+size*.2,clientY:top+size*.4});
 handlers.pointerup({clientX:left+size*.2,clientY:top+size*.4});await wait();
 assert.equal(messages.length,2);assert.equal(messages[1].xSequence.length,2516582);assert.equal(messages[1].ySequence.length,2516582);assert.equal('sequences' in messages[1],false);
 assert.equal(vm.runInContext('linked',sandbox),false);assert.ok(vm.runInContext('y.start > x.start',sandbox));assert.equal(get('exportButton').disabled,false);
 // Fit cancels computation and clears the old result; returning to a cached view resumes.
 get('fitButton').onclick();await wait();assert.equal(messages.length,2);assert.equal(vm.runInContext('result',sandbox),null);assert.match(get('status').textContent,/Zoom in/);
 vm.runInContext('x={chr:0,start:0,end:5000000};y={chr:0,start:0,end:5000001};navigate()',sandbox);await wait();assert.equal(messages.length,2);
 vm.runInContext('y.end=5000000;navigate()',sandbox);await wait();assert.equal(messages.length,3);
 // Appearance updates the legend and canvas without scheduling another comparison.
 const beforeStyle=messages.length;paint.length=0;
 get('forwardColor').value='#3167c6';get('forwardColor').onchange();
 get('reverseColor').value='#8a52b5';get('reverseColor').onchange();
 get('strokeSize').value='3';get('strokeSize').onchange();await wait();
 assert.equal(messages.length,beforeStyle);assert.equal(get('forwardLegend').style.backgroundColor,'#3167c6');assert.equal(get('reverseLegend').style.backgroundColor,'#8a52b5');
 assert.ok(paint.some(([key,value])=>key==='fillStyle'&&value==='#3167c68c'));assert.ok(paint.some(([key,value])=>key==='strokeStyle'&&value==='#8a52b5a0'));assert.ok(paint.some(([key,value])=>key==='lineWidth'&&value===3));
 // Four arrows move one axis, and the diagonal button restores overlapping windows.
 vm.runInContext('linked=true;x={chr:0,start:2000000,end:3000000};y={...x};navigate()',sandbox);await wait();
 const yBefore=vm.runInContext('y.start',sandbox);get('panRight').onclick();assert.equal(vm.runInContext('y.start',sandbox),yBefore);assert.equal(vm.runInContext('linked',sandbox),false);
 const xBefore=vm.runInContext('x.start',sandbox);get('panDown').onclick();assert.equal(vm.runInContext('x.start',sandbox),xBefore);assert.ok(vm.runInContext('y.start',sandbox)>yBefore);
 get('panUp').onclick();assert.equal(vm.runInContext('y.start',sandbox),yBefore);get('panLeft').onclick();assert.equal(vm.runInContext('x.start',sandbox),2000000);
 vm.runInContext('y={chr:0,start:10000000,end:11000000};navigate()',sandbox);get('centerDiagonal').onclick();assert.equal(vm.runInContext('x.start===y.start&&x.end===y.end',sandbox),true);await wait();
 // Pan mode makes an ordinary drag move the viewport; box mode restores selection.
 get('panMode').onclick();assert.equal(get('plot').style.cursor,'grab');
 const panStart=vm.runInContext('x.start',sandbox),panY=vm.runInContext('y.start',sandbox);
 handlers.pointerdown({button:0,pointerId:1,clientX:left+size*.5,clientY:top+size*.5,shiftKey:false});handlers.pointerup({clientX:left+size*.4,clientY:top+size*.5});
 assert.ok(vm.runInContext('x.start',sandbox)>panStart);assert.equal(vm.runInContext('y.start',sandbox),panY);get('boxMode').onclick();assert.equal(get('plot').style.cursor,'crosshair');await wait();
 // Raising the cutoff resumes a paused view; lowering it hides cached dots.
 vm.runInContext('x={chr:0,start:0,end:6000000};y={...x};navigate()',sandbox);await wait();const beforeCutoff=messages.length;
 get('computeCutoff').value='10';get('computeCutoff').onchange();assert.equal(get('cutoffWarning').hidden,true);await wait();assert.equal(messages.length,beforeCutoff+1);
 get('computeCutoff').value='10.1';get('computeCutoff').onchange();assert.equal(get('cutoffWarning').hidden,false);assert.equal(vm.runInContext('dotplotCutoff',sandbox),10100000);
 get('computeCutoff').value='5';get('computeCutoff').onchange();assert.equal(get('cutoffWarning').hidden,true);assert.equal(vm.runInContext('result',sandbox),null);assert.match(get('status').textContent,/5 Mb/);
 get('computeCutoff').value='';get('computeCutoff').onchange();assert.equal(vm.runInContext('dotplotCutoff',sandbox),5000000);vm.runInContext('clearTimeout(toastTimer)',sandbox);
 vm.runInContext('x={chr:0,start:0,end:5000000};y={...x};navigate()',sandbox);await wait();
 const start=vm.runInContext('x.start',sandbox);handlers.pointerdown({button:0,pointerId:1,clientX:left+size*.5,clientY:top+size*.5,shiftKey:true});handlers.pointerup({clientX:left+size*.4,clientY:top+size*.5});assert.ok(vm.runInContext('x.start',sandbox)>start);await wait();
});
