import test from 'node:test';
import {Blob} from 'node:buffer';
import assert from 'node:assert/strict';
import {indexFasta,readSequenceRegion} from '../dist/fasta.js';
import {parseFasta,canComputeDotplot,sequenceLength,withSequenceCoordinates,trackCoverage} from '../dist/core.js';

test('sparse FASTA reads match eager parsing across chunk boundaries, comments and CRLF',async()=>{
  const text=';intro\r\n>chr7:101-114 description\r\nacgU RY\r\n;ignore me\r\n\r\nNN.-ACGT\r\n>other\nGGAA\nTTCC';
  const expected=parseFasta(text);
  for(const size of [1,2,3,7,13,64,1024]){
    const indexed=await indexFasta(new Blob([text]),()=>{},size);
    for(let i=0;i<expected.length;i++){
      assert.equal(indexed[i].name,expected[i].name);assert.equal(indexed[i].origin,expected[i].origin);
      assert.equal(sequenceLength(indexed[i]),expected[i].seq.length);
      for(let start=0;start<=indexed[i].length;start++)for(let end=start;end<=indexed[i].length;end++){
        assert.equal(await readSequenceRegion(indexed[i],start,end),expected[i].seq.slice(start,end),`chunk=${size} region=${start}-${end}`);
      }
    }
  }
});
test('unwrapped FASTA above the former 20 MiB cap stays file-backed and supports regional reads',async()=>{
  const bases='ACGT'.repeat(6*1024*1024),blob=new Blob(['>chromosome\n',bases]);let progress=0;
  const [s]=await indexFasta(blob,p=>progress=p);
  assert.equal(s.length,bases.length);assert.equal(s.seq,undefined);assert.ok(s.blocks.length<10);assert.equal(progress,1);
  for(const start of [0,4194290,8388600,bases.length-100])assert.equal(await readSequenceRegion(s,start,start+100),bases.slice(start,start+100));
  const shifted=withSequenceCoordinates(s,'chr1',101);
  assert.equal(trackCoverage({features:[{chr:'chr1',start:100,end:110}]},[shifted]).overlapping,1);
});
test('file-backed parser rejects invalid input and malformed region headers',async()=>{
  for(const text of ['ACGT','>a\nAA\n>a\nTT','>empty\n','>a\nAC!T','>chr1:2-10\nACGT','>chr1:0-3\nACGT'])await assert.rejects(indexFasta(new Blob([text]),()=>{},3));
});
test('comparison gate requires both axes to be at most 5 Mb, regardless of absolute position',()=>{
  const r=(n,start=0)=>({start,end:start+n});
  assert.equal(canComputeDotplot(r(5e6,1e9),r(5e6)),true);
  assert.equal(canComputeDotplot(r(5e6+1),r(100)),false);
  assert.equal(canComputeDotplot(r(100),r(5e6+1)),false);
  assert.equal(canComputeDotplot(r(10e6),r(10e6),10e6),true);
  assert.equal(canComputeDotplot(r(10e6+1),r(10e6),10e6),false);
  for(const cutoff of [0,-1,Infinity,NaN])assert.equal(canComputeDotplot(r(100),r(100),cutoff),false);
});
