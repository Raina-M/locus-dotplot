import {computeMatches} from './core.js';
let sequences=[];
self.onmessage=({data})=>{
  if(data.type==='init'){sequences=data.sequences;return;}
  try{const {id,x,y,k,options}=data;const result=computeMatches(sequences[x.chr].seq.slice(x.start,x.end),sequences[y.chr].seq.slice(y.start,y.end),k,options);self.postMessage({id,...result},[result.points.buffer]);}
  catch(error){self.postMessage({id:data.id,error:error.message});}
};
