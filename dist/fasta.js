// Keep the original File and sparse byte ranges, rather than a genome-sized string.
// Chunk boundaries also work for unwrapped chromosome-length sequence lines.
export async function indexFasta(file, onProgress=()=>{}, chunkSize=4*1024*1024) {
  const records=[], names=new Set(), decoder=new TextDecoder();
  let current, mode='start', header='';
  function finishHeader(){
    const name=header.trim().split(/\s/)[0];
    if(!name||names.has(name))throw Error('FASTA headers must have unique, nonempty sequence names.');
    names.add(name);current={name,length:0,file,blocks:[]};records.push(current);header='';
  }
  for(let offset=0;offset<file.size;offset+=chunkSize){
    const bytes=new Uint8Array(await file.slice(offset,offset+chunkSize).arrayBuffer());
    let start=0;
    while(start<bytes.length){
      let end=bytes.indexOf(10,start);const newline=end!==-1;if(!newline)end=bytes.length;
      let text=decoder.decode(bytes.subarray(start,end));
      if(mode==='start'){
        if(text.startsWith('>')){mode='header';text=text.slice(1);}
        else if(text.startsWith(';'))mode='comment';
        else mode='sequence';
      }
      if(mode==='header'){
        header+=text;if(header.length>65536)throw Error('FASTA header exceeds 64 KiB.');
        if(newline)finishHeader();
      }else if(mode==='sequence'){
        const clean=text.replace(/\s/g,'').toUpperCase();
        if(clean){
          if(!current)throw Error('FASTA sequence must follow a >header.');
          if(/[^ACGTURYSWKMBDHVN.-]/.test(clean))throw Error('FASTA contains an invalid DNA character.');
          const previous=current.blocks.at(-1), byteStart=offset+start, byteEnd=offset+end;
          if(previous?.chunk===offset){previous.byteEnd=byteEnd;previous.end+=clean.length;}
          else current.blocks.push({chunk:offset,byteStart,byteEnd,start:current.length,end:current.length+clean.length});
          current.length+=clean.length;
        }
      }
      if(newline)mode='start';start=end+1;
    }
    onProgress(Math.min(1,(offset+bytes.length)/file.size));
  }
  if(mode==='header')finishHeader();
  if(!records.length)throw Error('No FASTA records found.');
  for(const record of records){
    if(!record.length)throw Error(`Empty sequence: ${record.name}`);
    const region=record.name.match(/^(.+):(\d+)-(\d+)$/);
    if(region){const start=Number(region[2]),end=Number(region[3]);
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end-start+1!==record.length)throw Error(`FASTA region header ${record.name} does not match its sequence length. Region headers use one-based inclusive coordinates.`);
      record.referenceName=region[1];record.origin=start-1;
    }
  }
  return records;
}
export async function readSequenceRegion(sequence,start,end){
  if(sequence.seq!==undefined)return sequence.seq.slice(start,end);
  if(start<0||end>sequence.length||end<start)throw Error('Sequence region is outside the loaded FASTA.');
  const parts=[];
  // Binary search the sparse index, then read only blocks overlapping the viewport.
  let lo=0,hi=sequence.blocks.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(sequence.blocks[mid].end<=start)lo=mid+1;else hi=mid;}
  for(let i=lo;i<sequence.blocks.length&&sequence.blocks[i].start<end;i++){
    const b=sequence.blocks[i];
    const text=(await sequence.file.slice(b.byteStart,b.byteEnd).text()).replace(/^;[^\n]*/gm,'').replace(/\s/g,'').toUpperCase().replace(/U/g,'T').replace(/[^ACGT]/g,'N');
    parts.push(text.slice(Math.max(0,start-b.start),Math.min(text.length,end-b.start)));
  }
  return parts.join('');
}
