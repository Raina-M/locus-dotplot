export const sequenceLength = sequence => sequence.length ?? sequence.seq.length;
export const MAX_DOTPLOT_SPAN = 5_000_000;
export const canComputeDotplot = (x,y,cutoff=MAX_DOTPLOT_SPAN) => Number.isFinite(cutoff) && cutoff>0 && x.end-x.start <= cutoff && y.end-y.start <= cutoff;
export const reverseComplement = s => [...s].reverse().map(b => ({A:'T',T:'A',G:'C',C:'G'}[b] || 'N')).join('');
export function parseFasta(text) {
  const sequences = []; let current;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith(';')) continue;
    if (line.startsWith('>')) {
      const name = line.slice(1).trim().split(/\s/)[0];
      if (!name || sequences.some(s => s.name === name)) throw Error('FASTA headers must have unique, nonempty sequence names.');
      current = {name, chunks: []}; sequences.push(current);
    } else {
      if (!current) throw Error('FASTA sequence must follow a >header.');
      const seq = line.replace(/\s/g,'').toUpperCase();
      if (/[^ACGTURYSWKMBDHVN.-]/.test(seq)) throw Error('FASTA contains an invalid DNA character.');
      current.chunks.push(seq.replace(/U/g,'T').replace(/[^ACGT]/g,'N'));
    }
  }
  if (!sequences.length) throw Error('No FASTA records found.');
  return sequences.map(({name,chunks}) => {
    const seq=chunks.join(''); if (!seq.length) throw Error(`Empty sequence: ${name}`);
    const region=name.match(/^(.+):(\d+)-(\d+)$/);
    if(region){const start=Number(region[2]),end=Number(region[3]);
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end-start+1!==seq.length)throw Error(`FASTA region header ${name} does not match its sequence length. Region headers use one-based inclusive coordinates.`);
      return {name,seq,referenceName:region[1],origin:start-1};
    }
    return {name,seq};
  });
}
export function parseTrack(text, filename) {
  const gff = /\.(gff3?|gtf)$/i.test(filename), signal = /\.(bedgraph|bg)$/i.test(filename);
  const features=[]; let lineNumber=0,bed4Strands=0;
  for (const line of text.split(/\r?\n/)) {
    lineNumber++;
    if (line === '##FASTA') break;
    if (!line.trim() || /^(#|track\s|browser\s)/.test(line)) continue;
    const c=line.trim().split(/\t| +/), min=gff?9:3;
    const fail=msg=>{throw Error(`${filename}, line ${lineNumber}: ${msg}`);};
    if(c.length<min) fail(`expected at least ${min} columns`);
    let start=Number(c[gff?3:1])-(gff?1:0),end=Number(c[gff?4:2]);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start) fail('invalid interval coordinates');
    const value=signal?Number(c[3]):null;
    if(signal && (c.length<4||!Number.isFinite(value))) fail('bedGraph needs a numeric fourth column');
    const attrs=gff?line.split('\t').slice(8).join('\t') || c.slice(8).join(' '):'';
    const attribute=key=>{const m=attrs.match(new RegExp('(?:^|;)[ ]*'+key+'(?:=| +)"?([^;"\\n]+)')); if(!m)return null;try{return decodeURIComponent(m[1]);}catch{return m[1];}};
    // Common nonstandard BED4 shorthand: chromosome, start, end, strand.
    // Only recognize exactly four columns and an explicit +/- value; BED6
    // continues to use column 6, and ordinary BED4 names stay names.
    const bed4Strand=!gff&&!signal&&c.length===4&&['+','-'].includes(c[3]);
    if(bed4Strand)bed4Strands++;
    const strand=c[bed4Strand?3:gff?6:5];
    const f={chr:c[0],start,end,name:gff?(attribute('Name')||attribute('gene_name')||attribute('ID')||c[2]):(bed4Strand?`Feature ${features.length+1}`:c[3]||'Feature'),strand:['+','-'].includes(strand)?strand:'.',value,type:gff?c[2]:'interval',id:gff?attribute('ID'):null,parent:gff?(attribute('Parent')||attribute('transcript_id')):null,blocks:[]};
    if(!gff&&!signal&&c.length>=12) {
      const count=Number(c[9]),sizes=c[10].split(',').filter(Boolean).map(Number),starts=c[11].split(',').filter(Boolean).map(Number);
      if(!Number.isInteger(count)||count<1||sizes.length!==count||starts.length!==count) fail('invalid BED12 block count');
      f.blocks=starts.map((p,i)=>{if(!Number.isInteger(p)||!Number.isInteger(sizes[i])||p<0||sizes[i]<=0||p+sizes[i]>end-start)fail('invalid BED12 block');return {start:start+p,end:start+p+sizes[i]};});
    }
    features.push(f);
  }
  if(!features.length) throw Error('No supported track records found.');
  if(gff){
    const parents=new Map(features.filter(f=>/^(mRNA|transcript)$/i.test(f.type)&&f.id).map(f=>[f.id,f]));
    for(const f of features) if(/^(exon|CDS)$/i.test(f.type)&&f.parent) for(const p of f.parent.split(',')) if(parents.has(p))parents.get(p).blocks.push({start:f.start,end:f.end});
    if(parents.size) return {name:filename,kind:'annotation',features:features.filter(f=>parents.has(f.id)||(!/^(gene|exon|CDS)$/i.test(f.type)&&!parents.has(f.parent)))};
  }
  return {name:filename,kind:signal?'signal':'annotation',features,...(bed4Strands?{importNotes:[`${bed4Strands} BED4 records: column 4 interpreted as strand (+/-).`]}:{})};
}
// Sequence indices are always local, zero-based offsets. Source coordinates are
// metadata, shared by locus labels and annotation projection, never worker input.
export const sequenceOrigin = sequence => sequence.origin ?? 0;
export const referenceName = sequence => sequence.referenceName ?? sequence.name;
export function withSequenceCoordinates(sequence,name,start){
  if(!name.trim())throw Error('A source chromosome name is required.');
  if(!Number.isSafeInteger(start)||start<1||!Number.isSafeInteger(start-1+sequenceLength(sequence)))throw Error('Source start must be a positive, safe integer (one-based).');
  return {...sequence,referenceName:name.trim(),origin:start-1};
}
export function projectTrackFeatures(track,sequence,region={start:0,end:sequenceLength(sequence)}){
  const origin=sequenceOrigin(sequence),name=referenceName(sequence);
  return track.features.filter(f=>f.chr===name&&f.end>origin+region.start&&f.start<origin+region.end).map(f=>({...f,start:f.start-origin,end:f.end-origin,blocks:f.blocks?.map(b=>({start:b.start-origin,end:b.end-origin}))}));
}
export function trackCoverage(track,sequences){
  let overlapping=0,outside=0,unmatched=0;
  for(const f of track.features){const matching=sequences.filter(s=>referenceName(s)===f.chr);
    if(!matching.length)unmatched++;
    else if(matching.some(s=>f.end>sequenceOrigin(s)&&f.start<sequenceOrigin(s)+sequenceLength(s)))overlapping++;
    else outside++;
  }
  return {total:track.features.length,overlapping,outside,unmatched};
}
export function autoK(span) {return span>5000000?101:span>1000000?71:span>250000?41:span>50000?31:span>10000?21:span>2000?15:9;}
export function clampRegion(region,length){const span=Math.min(length,Math.max(Math.min(40,length),Math.round(region.end-region.start)));const start=Math.max(0,Math.min(length-span,Math.round(region.start)));return {...region,start,end:start+span};}
// Canonical rolling hashes, winnowed over w positions. Hash candidates are verified
// against sequence text before emitting: collisions cannot create false dot matches.
export function minimizers(seq,k,w=1) {
  const codes=new Int8Array(seq.length);for(let i=0;i<seq.length;i++)codes[i]='ACGT'.indexOf(seq[i]);
  let power=1;for(let i=1;i<k;i++)power=Math.imul(power,5)>>>0;
  const inverse5=0xcccccccd;let forward=0,reverse=0,valid=0,head=0,last=-1;
  let queue=[];const seeds=[];
  for(let i=0;i<codes.length;i++){
    const b=codes[i];
    if(b<0){forward=reverse=valid=0;queue=[];head=0;continue;}
    if(valid<k){forward=(Math.imul(forward,5)+b+1)>>>0;reverse=(reverse+Math.imul(4-b,valid===0?1:pow5(valid)))>>>0;valid++;}
    else {const old=codes[i-k];forward=(Math.imul((forward-Math.imul(old+1,power))>>>0,5)+b+1)>>>0;reverse=(Math.imul((reverse-(4-old))>>>0,inverse5)+Math.imul(4-b,power))>>>0;}
    if(valid<k)continue;
    const pos=i-k+1,hash=Math.min(forward,reverse),orientation=forward<=reverse?1:-1;
    while(queue.length>head && queue[queue.length-1].hash>=hash)queue.pop();
    queue.push({pos,hash,orientation});
    while(head<queue.length && queue[head].pos<=pos-w)head++;
    if(valid>=k && pos>=w-1 && queue[head].pos!==last){const seed=queue[head];seeds.push(seed);last=seed.pos;if(seeds.length>200000)throw Error('Seed budget exceeded in this region. Zoom to a smaller window; a highly repetitive genome needs the indexed backend.');}
    if(head>4096){queue=queue.slice(head);head=0;}
  }
  return seeds;
}
const powers=[1];function pow5(i){while(powers.length<=i)powers.push(Math.imul(powers.at(-1),5)>>>0);return powers[i];}
export function computeMatches(x,y,k,{budget=60000,maxOccurrence=30,maxPairs=240000}={}) {
  const t=performance.now(),w=Math.max(1,Math.ceil(2*Math.max(x.length,y.length)/budget));
  const xs=minimizers(x,k,w),ys=x===y?xs:minimizers(y,k,w),index=new Map();
  for(const seed of xs){let a=index.get(seed.hash);if(!a){a=[];index.set(seed.hash,a);}if(a.length<=maxOccurrence)a.push(seed);}
  const yc=new Map();for(const s of ys)yc.set(s.hash,(yc.get(s.hash)||0)+1);
  const out=[];let filtered=0,limited=false;
  outer:for(const b of ys){const a=index.get(b.hash);if(!a)continue;if(a.length>maxOccurrence||yc.get(b.hash)>maxOccurrence){filtered++;continue;}
    const word=y.slice(b.pos,b.pos+k),rc=reverseComplement(word);
    for(const s of a){const xword=x.slice(s.pos,s.pos+k);const strands=[];if(xword===word)strands.push(1);if(xword===rc)strands.push(-1);
      for(const strand of strands){if(out.length/3>=maxPairs){limited=true;break outer;}out.push(s.pos,b.pos,strand);}
    }
  }
  return {points:new Int32Array(out),k,w,seeds:xs.length+ys.length,filtered,limited,ms:performance.now()-t};
}
export function makeDemo(){
  let seed=71829;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  const dna=n=>Array.from({length:n},()=> 'ACGT'[Math.floor(random()*4)]).join('');
  let seq=dna(600000);const replace=(p,s)=>{seq=seq.slice(0,p)+s+seq.slice(p+s.length);};
  replace(240000,seq.slice(85000,137000));replace(402000,reverseComplement(seq.slice(155000,205000)));
  const te=dna(2600);for(const p of [44000,113000,188000,267000,339000,462000,522000])replace(p,te);
  const genes=[],tes=[],chip=[],meth=[];
  for(let i=0;i<25;i++){const start=11000+i*23200+Math.floor(random()*5000),end=start+4000+Math.floor(random()*6000);genes.push({chr:'demo_chr1',start,end,name:`GENE${String(i+1).padStart(2,'0')}`,strand:i%3?'+':'-',blocks:[{start,end:start+900},{start:start+1700,end:start+2600},{start:end-1200,end}]});}
  for(const p of [44000,113000,188000,267000,339000,462000,522000])tes.push({chr:'demo_chr1',start:p,end:p+2600,name:'LTR/Gypsy',strand:p%3?'+':'-'});
  for(let i=0;i<600;i++){const start=i*1000;chip.push({chr:'demo_chr1',start,end:start+1000,value:Math.max(0,...genes.map(g=>80*Math.exp(-(((start-g.start)/4200)**2))))+random()*6});meth.push({chr:'demo_chr1',start,end:start+1000,value:Math.min(1,.25+.28*Math.sin(i/21)+random()*.35)});}
  return {sequences:[{name:'demo_chr1',seq}],tracks:[{name:'Gene models',kind:'annotation',features:genes,color:'#187f78'},{name:'Transposable elements',kind:'annotation',features:tes,color:'#b98b47'},{name:'ChIP-seq signal',kind:'signal',features:chip,color:'#648bbb'},{name:'DNA methylation',kind:'signal',features:meth,color:'#a77aa3'}]};
}
