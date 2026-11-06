import test from 'node:test';
import assert from 'node:assert/strict';
import {computeMatches,minimizers,parseTrack,parseFasta,reverseComplement,clampRegion,autoK,makeDemo,withSequenceCoordinates,projectTrackFeatures,trackCoverage} from '../dist/core.js';
function brute(x,y,k){const out=[];for(let i=0;i<=x.length-k;i++)for(let j=0;j<=y.length-k;j++){const a=x.slice(i,i+k),b=y.slice(j,j+k);if(/[^ACGT]/.test(a+b))continue;if(a===b)out.push(`${i},${j},1`);if(a===reverseComplement(b))out.push(`${i},${j},-1`);}return out.sort();}
const triples=points=>{const a=[];for(let i=0;i<points.length;i+=3)a.push(`${points[i]},${points[i+1]},${points[i+2]}`);return a.sort();};
test('rolling hashes match brute-force forward and reverse exact matches, including ambiguous gaps',()=>{
  for(const k of [3,9,15,31,41,71,101]){const a=makeDemo().sequences[0].seq.slice(0,250),x=a+'NNN'+a.slice(20,170),y=reverseComplement(a.slice(35,190))+a.slice(80,190);assert.deepEqual(triples(computeMatches(x,y,k,{budget:1e6,maxOccurrence:1000}).points),brute(x,y,k));}
});
test('minimizer sampling retains forward duplications and reverse complements',()=>{
  const s=makeDemo().sequences[0].seq.slice(0,5000);const r=computeMatches(s,reverseComplement(s),31,{budget:1000});assert.ok(r.w>1);assert.ok(r.points.length>100);for(let i=0;i<r.points.length;i+=3){const a=s.slice(r.points[i],r.points[i]+31),b=reverseComplement(s).slice(r.points[i+1],r.points[i+1]+31);assert.equal(a,r.points[i+2]===1?b:reverseComplement(b));}
});
test('repeat filter and pair budget are enforced and reported',()=>{const s='A'.repeat(200);const filtered=computeMatches(s,s,9,{maxOccurrence:2,budget:10000});assert.equal(filtered.points.length,0);assert.ok(filtered.filtered>0);const capped=computeMatches(s,s,9,{maxOccurrence:1000,budget:10000,maxPairs:11});assert.equal(capped.points.length/3,11);assert.equal(capped.limited,true);});
test('minimizers skip ambiguous words and short sequences',()=>{assert.equal(minimizers('ACG',9).length,0);assert.equal(minimizers('NNNNNN',3).length,0);for(const m of minimizers('ACGTNNACGTACGT',3))assert.ok(!'ACGTNNACGTACGT'.slice(m.pos,m.pos+3).includes('N'));});
test('FASTA parsing preserves coordinates when masking ambiguity',()=>{assert.deepEqual(parseFasta('>chr1 description\nacgr-u\n>chr2\nTT'),[{name:'chr1',seq:'ACGNNT'},{name:'chr2',seq:'TT'}]);assert.throws(()=>parseFasta('ACGT'));assert.throws(()=>parseFasta('>a\nAA\n>a\nTT'));});
test('GFF3 and GTF convert one-based coordinates and preserve minus strand and transcript blocks',()=>{const t=parseTrack('chr1\tsrc\tmRNA\t1\t100\t.\t-\t.\tID=tx1;Name=Gene%20A\nchr1\tsrc\texon\t1\t20\t.\t-\t.\tParent=tx1','a.gff3');assert.equal(t.features[0].start,0);assert.equal(t.features[0].end,100);assert.equal(t.features[0].strand,'-');assert.equal(t.features[0].name,'Gene A');assert.deepEqual(t.features[0].blocks,[{start:0,end:20}]);const gtf=parseTrack('chr1\tsrc\texon\t2\t20\t.\t+\t.\tgene_id "g"; gene_name "ABC";','a.gtf');assert.equal(gtf.features[0].name,'ABC');assert.equal(gtf.features[0].start,1);});
test('BED12 blocks, negative bedGraph, and invalid coordinates',()=>{const b=parseTrack('chr1\t0\t100\tgene\t0\t-\t0\t100\t0\t2\t10,20,\t0,80,','a.bed');assert.deepEqual(b.features[0].blocks,[{start:0,end:10},{start:80,end:100}]);assert.equal(b.features[0].strand,'-');assert.equal(parseTrack('chr1\t0\t10\t-2.5','a.bedGraph').features[0].value,-2.5);assert.throws(()=>parseTrack('chr1\t10\t2','a.bed'));assert.throws(()=>parseTrack('chr1\t0\t10\tNaN','a.bg'));});
test('region clamping preserves span, and automatic k decreases with span',()=>{assert.deepEqual(clampRegion({chr:0,start:-50,end:50},1000),{chr:0,start:0,end:100});assert.deepEqual(clampRegion({chr:0,start:990,end:1090},1000),{chr:0,start:900,end:1000});assert.ok(autoK(600000)>autoK(6000));});
test('BED4 strand shorthand preserves orientation and reports the interpretation',()=>{
  const t=parseTrack('chr7\t500010\t500020\t+\nchr7\t500030\t500040\t-','repeats.bed');
  assert.deepEqual(t.features.map(f=>f.strand),['+','-']);assert.equal(t.importNotes.length,1);assert.equal(t.features[0].name,'Feature 1');
  const ordinary=parseTrack('chr7\t10\t20\tCRM','standard.bed');assert.equal(ordinary.features[0].name,'CRM');assert.equal(ordinary.features[0].strand,'.');assert.equal(ordinary.importNotes,undefined);
  const bed6=parseTrack('chr7\t10\t20\t+\t0\t-','six.bed');assert.equal(bed6.features[0].name,'+');assert.equal(bed6.features[0].strand,'-');
});
test('extracted sequence origin projects source intervals and exon blocks without mutating input',()=>{
  const original={name:'slice',seq:'A'.repeat(100)},s=withSequenceCoordinates(original,'chr7',500001);
  const t=parseTrack('chr7\t500010\t500060\tgene\t0\t-\t500010\t500060\t0\t2\t10,10\t0,40','a.bed');
  assert.equal(projectTrackFeatures(t,original).length,0);
  const f=projectTrackFeatures(t,s)[0];assert.deepEqual([f.start,f.end,f.strand],[10,60,'-']);assert.deepEqual(f.blocks,[{start:10,end:20},{start:50,end:60}]);assert.equal(t.features[0].start,500010);assert.equal(original.origin,undefined);
  assert.equal(projectTrackFeatures(t,s,{start:60,end:100}).length,0);
});
test('coverage distinguishes out-of-range coordinates from unmatched chromosome names',()=>{
  const s=withSequenceCoordinates({name:'slice',seq:'A'.repeat(100)},'chr7',500001);
  const t=parseTrack('chr7\t499990\t500010\tleft\nchr7\t500100\t500120\tright\nchr8\t0\t20\tother','a.bed');
  assert.deepEqual(trackCoverage(t,[s]),{total:3,overlapping:1,outside:1,unmatched:1});
  const f=projectTrackFeatures(t,s)[0];assert.deepEqual([f.start,f.end],[-10,10]);
  assert.equal(projectTrackFeatures(t,s,{start:10,end:100}).length,0);
});
test('region FASTA headers are one-based inclusive and must agree with sequence length',()=>{
  const [s]=parseFasta('>chr7:500001-500004 slice\nACGT');assert.equal(s.referenceName,'chr7');assert.equal(s.origin,500000);
  const t=parseTrack('chr7\t500000\t500001\t+','a.bed');assert.equal(projectTrackFeatures(t,s)[0].start,0);
  assert.throws(()=>parseFasta('>chr7:500001-500004\nACG'),/sequence length/);
  assert.throws(()=>parseFasta('>chr7:0-3\nACGT'),/one-based/);
  assert.throws(()=>withSequenceCoordinates(s,'chr7',0),/positive/);assert.throws(()=>withSequenceCoordinates(s,'',1),/chromosome/);
});
