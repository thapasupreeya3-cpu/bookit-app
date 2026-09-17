'use strict';
// Browse order only. Booking eligibility and travel confirmation stay separate.
const fs=require('node:fs'),path=require('node:path');
const travel=require('./travel'),availability=require('./worker-availability');
let uniqueLocalities;
function resolve(text){
  const found=travel.place(text);
  if(!found||!found.assumed_state)return found;
  // The travel estimator can assume a state. Browsing must not invent a
  // distance for an ambiguous suburb name; unique names can use the same data.
  if(!uniqueLocalities){
    uniqueLocalities=new Map();
    try{
      const data=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','au-localities.json'),'utf8'));
      for(const [label,at] of Object.entries(data.localities||{})){
        const name=availability.areaKey(label.replace(/\s+(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)$/,''));
        uniqueLocalities.set(name,uniqueLocalities.has(name)?null:{name:label,at,via:'locality'});
      }
    }catch{/* Unrecognised locations remain visible after known locations. */}
  }
  return uniqueLocalities.get(availability.areaKey(text))||null;
}
function rank(profile,place){
  let declared=profile.service_areas;
  if(typeof declared==='string'){try{declared=JSON.parse(declared);}catch{declared=[];}}
  if(!Array.isArray(declared))declared=[];
  declared=declared.filter(value=>typeof value==='string'&&value.trim());
  const effective=declared.length?declared:[profile.suburb];
  const service_area_match=!!place&&effective.some(area=>availability.areaMatches(area,place));
  const location_match=service_area_match||!!place&&availability.areaMatches(profile.suburb,place);
  if(location_match)return {location_rank:0,location_match:true,distance_km:0,service_area_match};
  const target=resolve(place);
  const distances=target?[profile.suburb,...declared].map(resolve).filter(Boolean).map(from=>travel.distanceKm(from.at,target.at)).filter(Number.isFinite):[];
  const distance=distances.length?Math.round(Math.min(...distances)*10)/10:null;
  return {location_rank:distance===null?2:1,location_match:false,distance_km:distance,service_area_match};
}
function compare(a,b){
  const rankA=Number.isInteger(a.location_rank)?a.location_rank:2,rankB=Number.isInteger(b.location_rank)?b.location_rank:2;
  if(rankA!==rankB)return rankA-rankB;
  if(rankA!==1)return 0;
  const distance=value=>typeof value.distance_km==='number'&&Number.isFinite(value.distance_km)?value.distance_km:Infinity;
  const left=distance(a),right=distance(b);
  return left===right?0:left-right;
}
module.exports={rank,compare};
