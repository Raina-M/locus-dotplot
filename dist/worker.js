import {computeMatches} from './core.js';
self.onmessage=({data})=>{
  try{const {id,xSequence,ySequence,k,options}=data;const result=computeMatches(xSequence,ySequence,k,options);self.postMessage({id,...result},[result.points.buffer]);}
  catch(error){self.postMessage({id:data.id,error:error.message});}
};
