import * as THREE from './three.module.min.js';
import { createNavigationRoute } from './care-nav.js';
import { createHuman, CAST } from './care-cast.js';

/*
 * BookIt live care-background v57
 * --------------------------------
 * Four small transparent WebGL stages are used instead of one full map.
 * Every stage sleeps when it leaves the viewport, and reduced-motion/high-
 * contrast users retain the static fallback artwork.
 */

const rootEl = document.documentElement;
const MOTION_SELECTOR = '[data-care-motion]';
const clock = new THREE.Clock();
const activeStages = new Set();
const allStages = [];
let animationFrame = 0;
let firstFrameSent = false;

const C = {
  cream: 0xfaf6f0,
  paper: 0xfffcf7,
  ink: 0x17313a,
  inkSoft: 0x536b73,
  teal: 0x0e6b62,
  tealMid: 0x2d847d,
  tealLight: 0x8eb9ad,
  amber: 0xd6a247,
  coral: 0xd47e6c,
  wood: 0x9c704f,
  woodLight: 0xc39469,
  green: 0x729b69,
  greenDark: 0x4d7a50,
  greenLight: 0x93b67b,
  soil: 0x75543b,
  path: 0xe9e1d5,
  pathEdge: 0xd9cdbd,
  blue: 0x71b7c9,
};

function clamp(v, min = 0, max = 1) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = clamp(t); return t * t * (3 - 2 * t); }
function smoother(t) { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); }
function invLerp(a, b, v) { return clamp((v - a) / (b - a)); }
function pingPong(t) { const x = t % 2; return x < 1 ? x : 2 - x; }
function easeInOut(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function reduceMotion() {
  return rootEl.getAttribute('data-motion') === 'reduce'
    || rootEl.classList.contains('high-contrast')
    || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function homeIsVisible() {
  const home = document.getElementById('page-home');
  return !!home && !home.hidden && home.getClientRects().length > 0;
}

function standardMaterial(color, roughness = .82, metalness = 0, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...opts });
}

function makeSphere(radius, material, widthSegments = 16, heightSegments = 11) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, widthSegments, heightSegments), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeCapsule(radius, length, material, radialSegments = 10) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, radialSegments), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeBox(width, height, depth, material, soften = .035) {
  const geometry = new THREE.BoxGeometry(width, height, depth, 2, 2, 2);
  if (soften) {
    const p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const len = Math.hypot(x, y, z) || 1;
      const s = Math.min(soften, .045);
      p.setXYZ(i, x - x / len * s, y - y / len * s, z - z / len * s);
    }
    geometry.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
function cylinderBetween(start, end, radius, material, radialSegments = 8) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material);
  mesh.position.copy(start).add(end).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function contactShadow(width = 1.25, depth = .85, opacity = .085) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(.7, 28),
    new THREE.MeshBasicMaterial({ color: 0x294b43, transparent: true, opacity, depthWrite: false }),
  );
  shadow.scale.set(width, depth, 1);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .012;
  shadow.renderOrder = 1;
  return shadow;
}

/* v65.7: createHuman moved to the shared care-cast.js (rendered-lineup style). */
function createWheel(radius = .55, manual = true) {
  const group = new THREE.Group();
  const rubber = standardMaterial(0x27343a, .74);
  const metal = standardMaterial(0xa6b1b4, .36, .48);
  const accent = standardMaterial(manual ? C.amber : C.tealMid, .58, .08);
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius, manual ? .05 : .08, 9, 28), rubber);
  tyre.rotation.y = Math.PI / 2;
  tyre.castShadow = true;
  group.add(tyre);
  if (manual) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * .82, .021, 7, 28), metal);
    rim.rotation.y = Math.PI / 2;
    group.add(rim);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, .11, 12), accent);
  hub.rotation.z = Math.PI / 2;
  group.add(hub);
  for (let i = 0; i < 8; i += 1) {
    const a = i / 8 * Math.PI * 2;
    group.add(cylinderBetween(new THREE.Vector3(), new THREE.Vector3(0, Math.sin(a) * radius * .75, Math.cos(a) * radius * .75), .011, metal, 5));
  }
  return group;
}

function createWheelchair() {
  const root = new THREE.Group();
  const frame = standardMaterial(0x5b7075, .38, .4);
  const cushion = standardMaterial(0x41535a, .84);
  const dark = standardMaterial(0x26363c, .78);
  const radius = .62;
  const leftWheel = createWheel(radius, true);
  const rightWheel = createWheel(radius, true);
  leftWheel.position.set(-.7, radius + .04, -.04);
  rightWheel.position.set(.7, radius + .04, -.04);
  root.add(leftWheel, rightWheel);
  const seat = makeBox(.98, .16, .82, cushion, .06); seat.position.set(0, .82, .02);
  const back = makeBox(.9, .84, .16, cushion, .06); back.position.set(0, 1.2, -.34); back.rotation.x = -.08;
  root.add(seat, back);
  for (const side of [-1, 1]) {
    const arm = makeBox(.13, .1, .68, dark, .03); arm.position.set(side * .57, 1.18, .02); root.add(arm);
    /* push handles — the carer's hands land here */
    const stem = cylinderBetween(new THREE.Vector3(side * .38, 1.36, -.4), new THREE.Vector3(side * .38, 1.6, -.58), .045, frame, 8);
    const grip = cylinderBetween(new THREE.Vector3(side * .38, 1.585, -.555), new THREE.Vector3(side * .38, 1.65, -.7), .062, dark, 8);
    root.add(stem, grip);
    const casterFork = cylinderBetween(new THREE.Vector3(side * .45, .46, .38), new THREE.Vector3(side * .45, .21, .65), .027, frame, 7);
    const caster = createWheel(.14, false); caster.scale.setScalar(.62); caster.position.set(side * .45, .16, .68); root.add(casterFork, caster);
  }
  const person = createHuman({ ...CAST.ruth, seated: true, scale: .67 });
  person.root.position.y = .18;
  root.add(person.root, contactShadow(1.25, 1.05, .1));
  return {
    root, person, leftWheel, rightWheel, radius,
    animate(distance, phase) {
      leftWheel.rotation.x = rightWheel.rotation.x = -distance / radius;
      person.animate(phase, .92);
    },
  };
}

function createPowerChair() {
  const root = new THREE.Group();
  const frame = standardMaterial(0x3a4a50, .5, .25);
  const cushion = standardMaterial(0x41535a, .84);
  const accent = standardMaterial(C.tealMid, .6, .1);
  const base = makeBox(.92, .42, 1.3, frame, .05); base.position.set(0, .5, .04);
  const skirt = makeBox(.94, .1, 1.32, accent, .03); skirt.position.set(0, .74, .04);
  root.add(base, skirt);
  const wheels = [];
  for (const side of [-1, 1]) {
    const drive = createWheel(.4, false);
    drive.position.set(side * .56, .42, -.08);
    root.add(drive); wheels.push({ wheel: drive, r: .4 });
    for (const cz of [.66, -.72]) {
      const caster = createWheel(.12, false);
      caster.scale.setScalar(.55);
      caster.position.set(side * .4, .1, cz);
      root.add(caster); wheels.push({ wheel: caster, r: .066 });
    }
  }
  const seat = makeBox(.9, .16, .82, cushion, .06); seat.position.set(0, .92, .1);
  const back = makeBox(.84, .74, .16, cushion, .06); back.position.set(0, 1.3, -.3); back.rotation.x = -.07;
  const headrest = makeBox(.42, .22, .15, cushion, .05); headrest.position.set(0, 1.72, -.33);
  root.add(seat, back, headrest);
  for (const side of [-1, 1]) {
    const arm = makeBox(.13, .1, .6, frame, .03); arm.position.set(side * .5, 1.24, .08); root.add(arm);
  }
  const joyBox = makeBox(.16, .09, .24, frame, .02); joyBox.position.set(.5, 1.3, .42);
  const stick = makeSphere(.05, accent, 8, 6); stick.position.set(.5, 1.4, .44);
  root.add(joyBox, stick);
  const person = createHuman({ ...CAST.ruth, seated: true, scale: .67 });
  person.root.position.y = .24;
  root.add(person.root, contactShadow(1.2, 1.15, .1));
  return {
    root, person,
    animate(distance, phase) {
      wheels.forEach(({ wheel, r }) => { wheel.rotation.x = -distance / r; });
      person.animate(phase, .9);
      person.rightArm.rotation.x = -.62; /* hand resting on the joystick */
      person.rightArm.rotation.z = -.06;
    },
  };
}

function createWalkerUser() {
  const root = new THREE.Group();
  const metal = standardMaterial(0x7f959c, .42, .38);
  const grip = standardMaterial(C.ink, .7);
  const frame = new THREE.Group();
  const wheels = [];
  for (const side of [-1, 1]) {
    frame.add(
      cylinderBetween(new THREE.Vector3(side * .3, .98, .3), new THREE.Vector3(side * .34, .12, .46), .032, metal, 7),
      cylinderBetween(new THREE.Vector3(side * .3, .98, .3), new THREE.Vector3(side * .34, .12, .02), .032, metal, 7),
      cylinderBetween(new THREE.Vector3(side * .3, .98, .32), new THREE.Vector3(side * .3, 1.04, .02), .04, grip, 7),
    );
    for (const wz of [.46, .02]) {
      const wheel = createWheel(.09, false);
      wheel.scale.setScalar(.5);
      wheel.position.set(side * .34, .075, wz);
      frame.add(wheel); wheels.push(wheel);
    }
  }
  frame.add(
    cylinderBetween(new THREE.Vector3(-.3, .9, .34), new THREE.Vector3(.3, .9, .34), .028, metal, 7),
  );
  const tray = makeBox(.56, .04, .3, standardMaterial(C.woodLight, .8), .01);
  tray.position.set(0, .62, .28);
  frame.add(tray);
  frame.position.z = .34;
  const person = createHuman({ skin: 0xc99772, shirt: 0xf1e8d4, jacket: 0xc29a4e, trousers: 0x4a5a5e, hair: 0xcfc8bd, hairStyle: 'bob', shoes: 0x8a6a4f, scale: .62 });
  person.root.position.z = -.3;
  person.torso.rotation.x = .07;
  root.add(frame, person.root, contactShadow(.95, .95, .09));
  return {
    root, person, frame,
    animate(distance, phase, moving) {
      wheels.forEach(w => { w.rotation.x = -distance / .045; });
      person.animate(phase, moving ? .55 : .05);
      /* both hands stay on the walker grips; an unhurried, steady pace */
      person.leftArm.rotation.x = -.5 + Math.sin(phase) * .03;
      person.rightArm.rotation.x = -.5 - Math.sin(phase) * .03;
      person.torso.rotation.x = .07;
      frame.position.y = Math.abs(Math.sin(phase)) * .008;
    },
  };
}

function createWateringCan() {
  const root = new THREE.Group();
  const bodyMat = standardMaterial(C.coral, .72, .05);
  const darkMat = standardMaterial(0x9f594f, .72, .04);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.25, .29, .43, 14), bodyMat);
  body.castShadow = true;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(.28, .042, 7, 20, Math.PI * 1.42), darkMat);
  handle.position.set(0, .22, -.02); handle.rotation.z = Math.PI * .79;
  const spout = cylinderBetween(new THREE.Vector3(.23, .02, .02), new THREE.Vector3(.68, .2, .24), .052, bodyMat, 9);
  const rose = new THREE.Mesh(new THREE.CylinderGeometry(.11, .07, .075, 10), darkMat);
  rose.position.set(.71, .22, .26); rose.quaternion.copy(spout.quaternion);
  const spoutTip = new THREE.Object3D(); spoutTip.position.set(.76, .24, .28);
  root.add(body, handle, spout, rose, spoutTip);
  return { root, spoutTip };
}

function createGardener() {
  const root = new THREE.Group();
  const human = createHuman({ ...CAST.carer, scale: .66 });
  const can = createWateringCan();
  can.root.position.set(.48, .93, .28);
  can.root.scale.setScalar(.82);
  root.add(human.root, can.root, contactShadow(.86, .66, .08));
  return {
    root, human, can,
    animateWalk(phase, intensity = .9) {
      human.animate(phase, intensity);
      can.root.position.y = .93 + Math.abs(Math.sin(phase * 2)) * .018;
      can.root.rotation.set(0, 0, .04 + Math.sin(phase) * .03);
    },
    animateWater(phase) {
      human.animate(phase, .04);
      human.leftArm.rotation.x = -.58 + Math.sin(phase * .4) * .025;
      human.rightArm.rotation.x = -.94 + Math.sin(phase * .6) * .035;
      human.torso.rotation.z = -.06;
      can.root.position.set(.54, .72, .06);
      can.root.rotation.set(.06, -.42, -.54 + Math.sin(phase * .5) * .035);
    },
  };
}

function createMower() {
  const root = new THREE.Group();
  const frame = standardMaterial(0x314a4f, .46, .22);
  const deckMat = standardMaterial(C.amber, .72, .05);
  const engineMat = standardMaterial(C.tealMid, .62, .07);
  const wheelRadius = .2;
  const deck = makeBox(.98, .18, .76, deckMat, .065); deck.position.set(0, .22, .08);
  const engine = makeBox(.54, .31, .47, engineMat, .065); engine.position.set(0, .45, .04);
  const cap = makeSphere(.085, frame, 10, 7); cap.scale.set(1,.5,1); cap.position.set(0,.64,.04);
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(.35,.35,.03,20), standardMaterial(0xaeb9bc,.36,.48)); blade.position.set(0,.1,.08);
  const bag = makeBox(.65,.38,.45,standardMaterial(0x49645c,.92),.06); bag.position.set(0,.42,-.47); bag.rotation.x=-.08;
  root.add(deck,engine,cap,blade,bag);
  const wheels=[];
  for(const [x,z] of [[-.49,-.25],[.49,-.25],[-.49,.34],[.49,.34]]){
    const wheel=createWheel(wheelRadius,false); wheel.scale.setScalar(.78); wheel.position.set(x,wheelRadius,z); root.add(wheel); wheels.push(wheel);
  }
  for(const side of [-1,1]) root.add(cylinderBetween(new THREE.Vector3(side*.39,.39,-.28),new THREE.Vector3(side*.29,1.16,-1.02),.03,frame,7));
  root.add(cylinderBetween(new THREE.Vector3(-.29,1.16,-1.02),new THREE.Vector3(.29,1.16,-1.02),.04,frame,7));
  const worker=createHuman({skin:0x9a6246,shirt:C.tealMid,trousers:0x3f5759,hair:0x32241e,scale:.62});
  worker.root.position.set(0,0,-1.48); root.add(worker.root,contactShadow(1.08,1.3,.08));
  const clippingMat = new THREE.MeshBasicMaterial({color:0x78986f,transparent:true,opacity:.5,depthWrite:false,toneMapped:false});
  const clippings=[];
  for(let i=0;i<9;i+=1){const c=new THREE.Mesh(new THREE.TetrahedronGeometry(.034,0),clippingMat);root.add(c);clippings.push(c);}
  return {
    root, worker,
    animate(distance, phase, cutting=true){
      wheels.forEach(w=>{w.rotation.x=-distance/wheelRadius;});
      blade.rotation.y=distance*8.4;
      worker.animate(phase,.72);
      worker.leftArm.rotation.x=-.9+Math.sin(phase)*.07;
      worker.rightArm.rotation.x=-.9-Math.sin(phase)*.07;
      clippings.forEach((c,i)=>{
        c.visible=cutting;
        const u=(distance*.55+i/clippings.length)%1;
        c.position.set(.48+u*.62,.17+Math.sin(u*Math.PI)*.28,.12+((i%5)-2)*.05-u*.12);
        c.rotation.set(phase*.11+i,phase*.17+i*.6,phase*.09);
      });
    },
  };
}

function createDog() {
  const root = new THREE.Group(); root.scale.setScalar(.7);
  const coat=standardMaterial(0xbc8356,.94), light=standardMaterial(0xd4aa7e,.96), dark=standardMaterial(C.ink,.8);
  const body=makeSphere(.48,coat,14,10); body.scale.set(.8,.62,1.3); body.position.y=.65;
  const head=makeSphere(.29,coat,14,10); head.position.set(0,.98,.68);
  const muzzle=makeSphere(.16,light,12,8); muzzle.scale.set(.85,.7,1.05); muzzle.position.set(0,.93,.92);
  const nose=makeSphere(.065,dark,8,6); nose.position.set(0,.96,1.06);
  root.add(body,head,muzzle,nose);
  const legs=[];
  for(const [x,z] of [[-.27,-.34],[.27,-.34],[-.27,.38],[.27,.38]]){
    const leg=new THREE.Group(); const limb=makeCapsule(.075,.34,coat,8); limb.position.y=-.25; const paw=makeSphere(.09,light,8,6); paw.scale.set(1,.5,1.2); paw.position.set(0,-.45,.04); leg.add(limb,paw); leg.position.set(x,.49,z); legs.push(leg); root.add(leg);
  }
  const tail=new THREE.Group(); tail.position.set(0,.79,-.6); const tailMesh=makeCapsule(.065,.42,coat,8); tailMesh.position.y=.24; tailMesh.rotation.x=-.55; tail.add(tailMesh); root.add(tail,contactShadow(.72,.75,.07));
  return {root,animate(phase){legs[0].rotation.x=legs[3].rotation.x=Math.sin(phase)*.45;legs[1].rotation.x=legs[2].rotation.x=-Math.sin(phase)*.45;tail.rotation.z=Math.sin(phase*.58)*.4;head.rotation.y=Math.sin(phase*.28)*.1;root.position.y=Math.abs(Math.sin(phase*2))*.02;}};
}

function createRaisedBed(x, z, rotation = 0) {
  const root = new THREE.Group();
  const wood = standardMaterial(C.wood, .88);
  const woodLight = standardMaterial(C.woodLight, .88);
  const soil = standardMaterial(C.soil, .98);
  const leafA = standardMaterial(C.greenDark, .95);
  const leafB = standardMaterial(C.greenLight, .95);
  const bloomA = standardMaterial(C.coral, .9);
  const bloomB = standardMaterial(C.amber, .9);
  const base = makeBox(3.15,.5,1.45,wood,.035); base.position.y=.28;
  const inner = makeBox(2.78,.14,1.1,soil,.02); inner.position.y=.58;
  root.add(base,inner);
  const plants=[];
  for(let i=0;i<11;i+=1){
    const px=-1.23+(i%6)*.49 + (i>5?.12:0), pz=i<6?-.28:.3;
    const stem=cylinderBetween(new THREE.Vector3(px,.62,pz),new THREE.Vector3(px,.84+(i%3)*.05,pz),.018,leafA,6);
    const leaf=makeSphere(.15+(i%2)*.025,i%3?leafA:leafB,9,7); leaf.scale.set(1,.7,1); leaf.position.set(px,.91+(i%3)*.05,pz);
    const flower=makeSphere(.055,i%2?bloomA:bloomB,8,6); flower.position.set(px,.99+(i%3)*.05,pz);
    root.add(stem,leaf,flower); plants.push(leaf,flower);
  }
  root.position.set(x,0,z); root.rotation.y=rotation; root.add(contactShadow(2.5,1.1,.055));
  return {root,soil:inner.material,plants,baseColor:new THREE.Color(C.soil)};
}

function createPergola() {
  const root = new THREE.Group();
  /* the drawn pergola is a bare lattice: slim posts, a full set of rafters,
     and only a few climbing tufts along the beams. */
  const wood=standardMaterial(C.wood,.84), light=standardMaterial(C.woodLight,.86), leaf=standardMaterial(0x62855f,.95);
  for(const x of [-1.75,1.75]) for(const z of [-1.05,1.05]){const p=makeBox(.13,2.4,.13,wood,.025);p.position.set(x,1.2,z);root.add(p);}
  for(const z of [-1.05,1.05]){const b=makeBox(3.82,.13,.15,wood,.025);b.position.set(0,2.36,z);root.add(b);}
  for(let i=0;i<11;i+=1){const x=-1.66+i*.332;const slat=makeBox(.075,.085,2.36,light,.015);slat.position.set(x,2.47,0);root.add(slat);}
  const leaves=[];
  const tufts=[[-1.72,-1.06],[-1.66,1.02],[-.62,1.06],[.35,-1.08],[1.24,1.04],[1.7,-1.02],[1.72,1.0],[-1.1,-1.06]];
  tufts.forEach(([x,z],i)=>{
    const l=makeSphere(.085+(i%3)*.014,leaf,9,7);l.scale.set(1.1,.8,1.1);l.position.set(x,2.55+((i%2)?.03:0),z);
    root.add(l);leaves.push({mesh:l,base:l.position.clone(),phase:i*.8});
    if(i%3===0){const trail=makeSphere(.055,leaf,8,6);trail.position.set(x+(x<0?.06:-.06),2.34,z);root.add(trail);}
  });
  const floor=new THREE.Mesh(new THREE.CircleGeometry(2.05,40),new THREE.MeshStandardMaterial({color:C.path,roughness:.98,transparent:true,opacity:.62}));floor.rotation.x=-Math.PI/2;floor.scale.set(1.1,.66,1);floor.position.y=.006;root.add(floor,contactShadow(2.9,1.8,.04));
  return {root,update(t){leaves.forEach(({mesh,base,phase})=>{mesh.position.y=base.y+Math.sin(t*.9+phase)*.025;mesh.rotation.z=Math.sin(t*.55+phase)*.08;});}};
}

function createTree(scale = 1) {
  const root=new THREE.Group();
  const trunk=makeCapsule(.12,.8,standardMaterial(C.wood,.9),9);trunk.position.y=.5;
  const crown=makeSphere(.55,standardMaterial(C.greenLight,.95),14,10);crown.scale.set(.8,1.15,.8);crown.position.y=1.42;
  root.add(trunk,crown,contactShadow(.8,.62,.06));root.scale.setScalar(scale);
  return {root,crown};
}

function addFlowerPatch(scene,x,z,count=16){
  const stems=[];
  const colors=[C.coral,C.amber,0x7f85ae,0xf1d5d0];
  for(let i=0;i<count;i+=1){const px=x+((i%6)-2.5)*.25+(i%2)*.04,pz=z+(Math.floor(i/6)-1)*.28;const stem=cylinderBetween(new THREE.Vector3(px,.02,pz),new THREE.Vector3(px,.34+(i%3)*.06,pz),.012,standardMaterial(C.greenDark,.95),5);const flower=makeSphere(.045+(i%2)*.012,standardMaterial(colors[i%colors.length],.92),7,5);flower.position.set(px,.39+(i%3)*.06,pz);scene.add(stem,flower);flower.userData.baseY=flower.position.y;stems.push({stem,flower,phase:i*.8});}
  return stems;
}

function pathRibbon(curve, width, material, segments = 72, y = .012) {
  const positions=[],uvs=[],indices=[];
  for(let i=0;i<=segments;i+=1){const u=i/segments,p=curve.getPointAt(u),t=curve.getTangentAt(u).normalize();const n=new THREE.Vector3(t.z,0,-t.x).normalize();const l=p.clone().addScaledVector(n,width*.5),r=p.clone().addScaledVector(n,-width*.5);positions.push(l.x,y,l.z,r.x,y,r.z);uvs.push(0,u,1,u);if(i<segments){const a=i*2,b=a+1,c=a+2,d=a+3;indices.push(a,c,b,c,d,b);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();const mesh=new THREE.Mesh(g,material);mesh.receiveShadow=true;return mesh;
}

function makeTrailTexture(kind) {
  const canvas=document.createElement('canvas'); canvas.width=128; canvas.height=128; const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,128,128); ctx.fillStyle='#fff'; ctx.strokeStyle='#fff'; ctx.lineCap='round';
  if(kind==='foot'){
    ctx.save();ctx.translate(64,64);ctx.rotate(-.08);ctx.beginPath();ctx.ellipse(0,-10,18,36,0,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.ellipse(0,31,13,10,0,0,Math.PI*2);ctx.fill();ctx.restore();
  }else if(kind==='paw'){
    ctx.beginPath();ctx.ellipse(64,73,22,19,0,0,Math.PI*2);ctx.fill();for(const [x,y] of [[39,46],[56,37],[75,38],[91,48]]){ctx.beginPath();ctx.ellipse(x,y,9,12,0,0,Math.PI*2);ctx.fill();}
  }else{
    ctx.fillRect(44,5,40,118);ctx.globalCompositeOperation='destination-out';for(let y=16;y<120;y+=22){ctx.fillRect(50,y,28,8);}ctx.globalCompositeOperation='source-over';
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

/* a small seamless paver tile: offset stone courses over warm grout, with a
   soft top-light on each stone and a little speckle so it reads as pavement */
function makePaverTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c7b79e';
  ctx.fillRect(0, 0, 96, 96);
  const tones = ['#ece1c9', '#e6dabf', '#e0d3b6', '#eadfc7', '#e3d6bb'];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const stone = (x, y) => {
    const w = 44, h = 20, r = 6;
    for (const ox of [-96, 0, 96]) for (const oy of [-96, 0, 96]) {
      const sx = x + ox, sy = y + oy;
      ctx.fillStyle = ctx.fillStyle;
      ctx.beginPath();
      ctx.moveTo(sx + r, sy);
      ctx.arcTo(sx + w, sy, sx + w, sy + h, r);
      ctx.arcTo(sx + w, sy + h, sx, sy + h, r);
      ctx.arcTo(sx, sy + h, sx, sy, r);
      ctx.arcTo(sx, sy, sx + w, sy, r);
      ctx.closePath();
      ctx.fill();
    }
  };
  for (let row = 0; row < 4; row += 1) {
    const y = row * 24 + 2;
    const off = (row % 2) * 24;
    for (let col = 0; col < 2; col += 1) {
      ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
      stone(off + col * 48 + 2, y);
    }
  }
  ctx.fillStyle = 'rgba(120,102,78,.16)';
  for (let i = 0; i < 70; i += 1) {
    ctx.beginPath();
    ctx.arc(rnd() * 96, rnd() * 96, .6 + rnd() * .9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  for (let i = 0; i < 40; i += 1) {
    ctx.beginPath();
    ctx.arc(rnd() * 96, rnd() * 96, .5 + rnd() * .8, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

class TrailPool {
  constructor(scene){this.scene=scene;this.marks=[];this.textures={foot:makeTrailTexture('foot'),wheel:makeTrailTexture('wheel'),paw:makeTrailTexture('paw')};}
  emit(kind,position,yaw,width=.22,height=.42,lifetime=5,opacity=.16,mirror=false){
    const material=new THREE.MeshBasicMaterial({map:this.textures[kind],color:kind==='paw'?0x9a725a:kind==='wheel'?0x557879:0x4e7771,transparent:true,opacity,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width*(mirror?-1:1),height),material);mesh.rotation.set(-Math.PI/2,0,-yaw);mesh.position.copy(position);mesh.position.y=.027;mesh.renderOrder=3;this.scene.add(mesh);this.marks.push({mesh,material,age:0,lifetime,baseOpacity:opacity});
    if(this.marks.length>130){const old=this.marks.shift();this.scene.remove(old.mesh);old.mesh.geometry.dispose();old.material.dispose();}
  }
  update(dt){
    for(let i=this.marks.length-1;i>=0;i-=1){const m=this.marks[i];m.age+=dt;const p=m.age/m.lifetime;if(p>=1){this.scene.remove(m.mesh);m.mesh.geometry.dispose();m.material.dispose();this.marks.splice(i,1);continue;}m.material.opacity=m.baseOpacity*Math.pow(1-p,1.55);m.mesh.scale.setScalar(1+p*.08);}
  }
  clear(){this.marks.forEach(m=>{this.scene.remove(m.mesh);m.mesh.geometry.dispose();m.material.dispose();});this.marks=[];}
}

function offsetPoint(center,yaw,lateral=0,longitudinal=0,y=.025){
  const fwd=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
  const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  return center.clone().addScaledVector(right,lateral).addScaledVector(fwd,longitudinal).setY(y);
}

class MiniStage {
  constructor(canvas, options={}) {
    this.canvas=canvas;
    this.kind=canvas.dataset.careMotion;
    this.scene=new THREE.Scene();
    this.scene.background=null;
    /* preserveDrawingBuffer keeps the scene readable to html2canvas-style
       screenshot tools (and to the user's own captures) — the cost is one
       buffer copy on a canvas that is only ever a few hundred K pixels. */
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    this.renderer.setClearColor(0x000000,0);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.08;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.6));
    this.camera=new THREE.OrthographicCamera(-5,5,5,-5,.1,100);
    this.camera.position.copy(options.cameraPosition||new THREE.Vector3(8,7,9));
    this.lookAt=options.lookAt||new THREE.Vector3();
    this.camera.lookAt(this.lookAt);
    this.frustum=options.frustum||10;
    this.visible=false;this.disposed=false;this.elapsed=0;this.lastTime=0;
    this.trails=new TrailPool(this.scene);
    this.setupLights(options.lightPosition||new THREE.Vector3(-5,10,7));
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();
  }
  setupLights(pos){
    const hemi=new THREE.HemisphereLight(0xfff7e9,0x7b9a91,2.15);this.scene.add(hemi);
    const sun=new THREE.DirectionalLight(0xfff3d7,3.2);sun.position.copy(pos);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-8;sun.shadow.camera.right=8;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;sun.shadow.bias=-.00025;this.scene.add(sun);
    const fill=new THREE.DirectionalLight(0xcce3df,1.05);fill.position.set(7,4,-7);this.scene.add(fill);
  }
  resize(){
    const rect=this.canvas.getBoundingClientRect();const w=Math.max(1,Math.round(rect.width)),h=Math.max(1,Math.round(rect.height));
    this.renderer.setSize(w,h,false);const aspect=w/h;this.camera.left=-this.frustum*aspect/2;this.camera.right=this.frustum*aspect/2;this.camera.top=this.frustum/2;this.camera.bottom=-this.frustum/2;this.camera.updateProjectionMatrix();
    /* With no animation loop running, a resize is the only chance to fill a
       canvas that was collapsed when the still frame was first attempted. */
    if(staticMode&&w>1&&h>1)queueStaticRedraw();
  }
  setVisible(v){this.visible=v;if(v)activeStages.add(this);else activeStages.delete(this);ensureLoop();}
  update(dt,t){this.elapsed=t;this.trails.update(dt);}
  render(){this.renderer.render(this.scene,this.camera);}
  dispose(){this.disposed=true;this.resizeObserver.disconnect();this.trails.clear();this.renderer.dispose();}
}

/* ═══════════ v60 — the hero journey, on the drawn path ═══════════
   The hero artwork is authored in one coordinate system: the reference hero
   box, 1448 × 1025 CSS px. Every landmark below is a point in that drawing —
   the ink line traced from it, the bench at its western dip, the pergola in
   the north-east. designToGround() unprojects a drawing point onto the ground
   plane of the isometric camera, so the line, the furniture and the walking
   pair all land exactly where the artwork puts them, at any viewport size. */
const HERO_DESIGN = { w: 1448, h: 1025 };
const HERO_LINE = [
  [1620,958],
  [1452,931],[1440,928],[1385,918],[1322,908],[1271,898],[1236,888],[1189,878],
  [1135,866],[1083,878],[1054,888],[1035,898],[1017,908],[1003,918],[984,928],
  [955,937],[920,943],[890,944],[860,938],[830,928],[789,908],[760,898],[733,888],
  [710,878],[692,868],[679,858],[669,848],[661,838],[655,828],
  [650,818],[646,808],[637,788],[640,778],[644,758],[649,748],[663,738],[690,725],
  [714,718],[724,708],[728,698],[729,688],[730,638],[729,588],[728,513],[726,483],
  [724,458],[721,438],[718,418],[715,388],[713,368],[712,328],[710,288],[707,258],
  [705,238],[703,208],[704,188],[707,168],[711,158],[717,148],[730,138],[752,128],
  [792,118],[900,110],[988,98],[1009,88],[1020,78],[1029,68],[1041,58],[1061,48],
  [1075,38],[1100,34],[1130,33],[1160,35],[1175,40],[1183,48],[1190,58],[1195,68],
  [1195,98],[1196,118],[1206,140],[1245,175],[1290,212],[1330,242],[1356,258],
  [1362,268],[1366,278],[1368,288],[1369,308],[1369,338],[1370,368],[1372,378],
  [1377,388],[1385,398],[1398,408],[1417,418],[1441,428],[1452,433],
  [1620,428],
];
const HERO_STOP = 29;               // first halt — the bench, at the western dip
const HERO_PERGOLA_AT = [1330,242]; // second halt — the pergola, beside the exit slope
const HERO_TREES = [[1305, 80, 52], [1355, 98, 42]];
const HERO_SHRUBS = [[500, 640, 26], [820, 560, 22]];
const HERO_PATH = { grout: 0xc7b79e, opacity: .96, edgeOpacity: .8 };
/* one round: in from off the bottom corner, a rest at the bench, on to the
   pergola, a rest under it, then all the way off the top corner. The pair
   never fades — only footprints and wheel tracks do. */
const HERO_TIME = { legA: 13, benchRest: 7, legB: 14, pergolaRest: 5, legC: 6, gap: 2 };
HERO_TIME.tBench = HERO_TIME.legA;
HERO_TIME.tLegB = HERO_TIME.tBench + HERO_TIME.benchRest;
HERO_TIME.tPergola = HERO_TIME.tLegB + HERO_TIME.legB;
HERO_TIME.tLegC = HERO_TIME.tPergola + HERO_TIME.pergolaRest;
HERO_TIME.tEnd = HERO_TIME.tLegC + HERO_TIME.legC;
HERO_TIME.cycle = HERO_TIME.tEnd + HERO_TIME.gap;

/* one pooled, single-draw-call field of fading ground marks per kind */
class MarkField {
  constructor(scene, kind, hex, capacity = 200) {
    this.capacity = capacity; this.head = 0; this.live = 0;
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.base = new Float32Array(capacity);
    const pos = new Float32Array(capacity * 12);
    const uv = new Float32Array(capacity * 8);
    const alpha = new Float32Array(capacity * 4);
    const index = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i += 1) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const v = i * 4;
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.alphaAttr = new THREE.BufferAttribute(alpha, 1);
    if (THREE.DynamicDrawUsage) { this.posAttr.setUsage(THREE.DynamicDrawUsage); this.alphaAttr.setUsage(THREE.DynamicDrawUsage); }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.posAttr);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('aAlpha', this.alphaAttr);
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry = geometry;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeTrailTexture(kind) },
        uColor: { value: new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255) },
      },
      vertexShader: 'attribute float aAlpha;varying float vA;varying vec2 vM;void main(){vA=aAlpha;vM=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D uMap;uniform vec3 uColor;varying float vA;varying vec2 vM;void main(){float a=texture2D(uMap,vM).a*vA;if(a<0.006)discard;gl_FragColor=vec4(uColor,a);}',
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  emit(center, tangent, normal, width, height, lifetime, alpha) {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.live = Math.min(this.live + 1, this.capacity);
    this.age[i] = 0; this.life[i] = lifetime; this.base[i] = alpha;
    const hw = width / 2, hh = height / 2, arr = this.posAttr.array;
    let o = i * 12;
    for (const [u, v] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      arr[o] = center.x + normal.x * u + tangent.x * v;
      arr[o + 1] = .028;
      arr[o + 2] = center.z + normal.z * u + tangent.z * v;
      o += 3;
    }
    this.posAttr.needsUpdate = true;
  }
  update(dt) {
    if (!this.live) return;
    const arr = this.alphaAttr.array;
    let live = 0;
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const p = this.age[i] / this.life[i];
      const a = p >= 1 ? 0 : this.base[i] * Math.pow(1 - p, 1.45);
      if (a <= 0) { this.life[i] = 0; } else { live += 1; }
      arr[i * 4] = arr[i * 4 + 1] = arr[i * 4 + 2] = arr[i * 4 + 3] = a;
    }
    this.live = live;
    this.alphaAttr.needsUpdate = true;
  }
  clear() {
    this.life.fill(0); this.age.fill(0);
    this.alphaAttr.array.fill(0);
    this.alphaAttr.needsUpdate = true;
    this.live = 0;
  }
  dispose() { this.geometry.dispose(); this.material.uniforms.uMap.value.dispose(); this.material.dispose(); }
}

function createShrub() {
  const root = new THREE.Group();
  const dark = standardMaterial(0x5f6a4c, .96);
  const light = standardMaterial(0x7d8b5d, .96);
  for (const [x, y, z, r, m] of [[0, .3, 0, .34, dark], [.22, .22, .1, .24, light], [-.2, .24, -.08, .26, light], [.04, .5, -.04, .2, dark]]) {
    const blob = makeSphere(r, m, 10, 8);
    blob.scale.set(1, .92, 1);
    blob.position.set(x, y, z);
    root.add(blob);
  }
  root.add(contactShadow(.62, .5, .075));
  return { root };
}

function createParkBench() {
  const root = new THREE.Group();
  const wood = standardMaterial(0x9a7757, .9);
  const woodLight = standardMaterial(0xb2895f, .9);
  const iron = standardMaterial(0x4c4a45, .62, .16);
  [-.27, -.09, .09, .27].forEach((z, i) => {
    const slat = makeBox(2.06, .075, .145, i % 2 ? wood : woodLight, .02);
    slat.position.set(0, .52, z);
    root.add(slat);
  });
  for (let i = 0; i < 3; i += 1) {
    const slat = makeBox(2.06, .155, .07, i % 2 ? woodLight : wood, .02);
    slat.position.set(0, .7 + i * .21, -.38 - i * .05);
    slat.rotation.x = .2;
    root.add(slat);
  }
  for (const side of [-1, 1]) {
    const front = makeBox(.09, .54, .1, iron, .02); front.position.set(side * .9, .26, .27);
    const back = makeBox(.09, 1.2, .1, iron, .02); back.position.set(side * .9, .6, -.42); back.rotation.x = .13;
    const arm = makeBox(.085, .085, .78, iron, .02); arm.position.set(side * .9, .88, -.06);
    const foot = makeBox(.14, .07, .82, iron, .02); foot.position.set(side * .9, .035, .02);
    root.add(front, back, arm, foot);
  }
  root.add(contactShadow(1.1, .45, .07));
  return { root };
}

class HeroJourneyStage extends MiniStage {
  constructor(canvas) {
    super(canvas, {
      cameraPosition: new THREE.Vector3(46, 34, 52),
      lookAt: new THREE.Vector3(0, 0, 0),
      frustum: 15,
      lightPosition: new THREE.Vector3(-16, 26, 14),
    });
    this.renderer.shadowMap.enabled = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
    this.camera.near = 1; this.camera.far = 400;
    this.camera.updateProjectionMatrix();

    this.footMarks = new MarkField(this.scene, 'foot', 0x8d8474, 160);
    this.wheelMarks = new MarkField(this.scene, 'wheel', 0x8a8375, 260);
    this.pawMarks = new MarkField(this.scene, 'paw', 0x9a8a74, 140);

    this.bench = createParkBench();
    this.pergola = createPergola();
    /* v65.2: the park is lived-in — a neighbour on the bench, two friends
       chatting under the pergola. All three ride their prop's transform, so
       they scale and place with it on every viewport. */
    this.benchSitter = createHuman({ ...CAST.marcus, seated: true, scale: .62 });
    this.benchSitter.root.position.set(-.45, -.17, -.02);
    this.bench.root.add(this.benchSitter.root);
    this.pergolaPair = [
      createHuman({ ...CAST.sophie, scale: .62 }),
      createHuman({ ...CAST.priya, scale: .6 }),
    ];
    this.pergolaPair[0].root.position.set(-.55, 0, .3);
    this.pergolaPair[1].root.position.set(.5, 0, -.28);
    this.pergolaPair[0].root.rotation.y = Math.atan2(1.05, -.58);
    this.pergolaPair[1].root.rotation.y = Math.atan2(-1.05, .58);
    this.pergolaPair.forEach(h => { h.root.add(contactShadow(.8, .6, .07)); this.pergola.root.add(h.root); });
    this.flowerBeds = [14, 12].map(count => {
      const g = new THREE.Group();
      const flowers = addFlowerPatch(g, 0, 0, count);
      this.scene.add(g);
      return { root: g, flowers };
    });
    this.extraShrubs = [createShrub(), createShrub()];
    this.extraShrubs.forEach(s => this.scene.add(s.root));
    this.butterflies = [];
    [0xd47e6c, 0xf5b841, 0x7f85ae].forEach((tint, i) => {
      const b = new THREE.Group();
      const wingMat = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: .78, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const wl = new THREE.Mesh(new THREE.CircleGeometry(.09, 8), wingMat);
      wl.scale.set(1.2, .7, 1); wl.position.x = -.08;
      const wr = wl.clone(); wr.position.x = .08;
      const body = makeCapsule(.02, .08, standardMaterial(0x40545c, .6), 5);
      body.rotation.z = Math.PI / 2;
      b.add(body, wl, wr);
      this.scene.add(b);
      this.butterflies.push({ root: b, wl, wr, anchor: new THREE.Vector3(), phase: i * 2.1 });
    });
    this.trees = HERO_TREES.map(() => createTree(1));
    this.trees.forEach(t => t.crown.material.color.set(0x8ba871));
    this.shrubs = HERO_SHRUBS.map(() => createShrub());
    this.scene.add(this.bench.root, this.pergola.root);
    this.trees.forEach(t => this.scene.add(t.root));
    this.shrubs.forEach(s => this.scene.add(s.root));

    /* v65.5: the walk is shared around — each loop a different pair travels
       the path. Loop A: a carer walking the dog beside a power-chair user.
       Loop B: a carer strolling with someone using a wheeled walker. */
    const carerOpts = { ...CAST.carer, scale: .66 };
    const groupA = (() => {
      const g = new THREE.Group();
      const chair = createPowerChair();
      chair.root.scale.setScalar(.72);
      chair.root.position.set(-.52, 0, .18);
      const carer = createHuman(carerOpts);
      carer.root.position.set(.5, 0, -.05);
      const dog = createDog();
      dog.root.scale.setScalar(.58);
      dog.root.position.set(1.42, 0, .85);
      g.add(chair.root, carer.root, dog.root);
      return {
        root: g,
        /* gaze: heads lead, the rider adds a little torso, the carer pivots
           on the spot at half strength — nobody's feet slide */
        gaze: (localYaw, amount) => {
          const look = Math.max(-1.05, Math.min(1.05, localYaw));
          chair.person.head.rotation.y += look * .65 * amount;
          chair.person.torso.rotation.y = look * .14 * amount;
          carer.head.rotation.y += look * .4 * amount;
          carer.root.rotation.y = look * .5 * amount;
        },
        animate: (distance, gait, moving, t, s) => {
          chair.animate(distance / s, moving ? gait : t * 1.2);
          carer.animate(moving ? gait : t * 1.2, moving ? .95 : .08);
          dog.animate(moving ? gait * 1.15 : Math.sin(t * .7) * .4);
        },
        marks: (mark, footSide) => {
          mark('wheel', -.92, .3, 6.5, 11, 14, .3);
          mark('wheel', -.12, .3, 6.5, 11, 14, .3);
          mark('foot', .5 + (footSide ? -.12 : .12), -.4, footSide ? 8.5 : -8.5, 14, 12, .38);
          mark('paw', 1.42, .95, 6.5, 6.5, 9, .3);
        },
      };
    })();
    const groupB = (() => {
      const g = new THREE.Group();
      const walker = createWalkerUser();
      walker.root.position.set(-.45, 0, .1);
      const carer = createHuman(carerOpts);
      carer.root.position.set(.55, 0, 0);
      g.add(walker.root, carer.root);
      return {
        root: g,
        gaze: (localYaw, amount) => {
          const look = Math.max(-1.05, Math.min(1.05, localYaw));
          walker.person.head.rotation.y += look * .6 * amount;
          walker.person.torso.rotation.y = look * .1 * amount;
          carer.head.rotation.y += look * .4 * amount;
          carer.root.rotation.y = look * .5 * amount;
        },
        animate: (distance, gait, moving, t, s) => {
          walker.animate(distance / s, moving ? gait * .85 : t * 1.1, moving);
          carer.animate(moving ? gait * .85 : t * 1.2, moving ? .8 : .08);
          /* a guiding hand hovers by their companion's back */
          carer.leftArm.rotation.x = -.42 + Math.sin(moving ? gait * .85 : t * 1.2) * .04;
        },
        marks: (mark, footSide) => {
          mark('wheel', -.79, .48, 4, 8, 12, .26);
          mark('wheel', -.11, .48, 4, 8, 12, .26);
          mark('foot', -.45 + (footSide ? -.11 : .11), -.32, footSide ? 8 : -8, 13, 12, .36);
          mark('foot', .55 + (footSide ? -.12 : .12), -.38, footSide ? 8.5 : -8.5, 14, 12, .38);
        },
      };
    })();
    this.travellers = [groupA, groupB];
    this.activeTraveller = 0;
    this.pair = new THREE.Group();
    this.travellers.forEach((tr, i) => { tr.root.visible = i === 0; this.pair.add(tr.root); });
    this.scene.add(this.pair);
    this.lastStamp = -1; this.footSide = 0; this.lastCycle = -1;
    this.ready = true;
    this.layout();
  }

  /* ---- drawing space → ground plane ---- */
  designToGround(x, y) {
    const p = new THREE.Vector3((x / HERO_DESIGN.w) * 2 - 1, 1 - (y / HERO_DESIGN.h) * 2, -1).unproject(this.camera);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return p.addScaledVector(dir, -p.y / dir.y);
  }
  screenToGround(x, y) {
    const p = new THREE.Vector3((x / this.viewW) * 2 - 1, 1 - (y / this.viewH) * 2, -1).unproject(this.camera);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return p.addScaledVector(dir, -p.y / dir.y);
  }
  /* screen px per world unit along a world direction */
  screenScale(origin, dir) {
    const a = origin.clone().project(this.camera);
    const b = origin.clone().add(dir).project(this.camera);
    return Math.hypot((b.x - a.x) * this.viewW / 2, (b.y - a.y) * this.viewH / 2) || .001;
  }

  resize() {
    super.resize();
    if (this.ready) this.layout();
  }

  layout() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) { this.needsLayout = true; return; }
    this.needsLayout = false;
    this.viewW = Math.max(1, rect.width);
    this.viewH = Math.max(1, rect.height);
    this.camera.updateMatrixWorld();
    const origin = new THREE.Vector3();
    this.upPx = this.screenScale(origin, UP);

    /* Measure the copy the animation must flow around. On the dedicated
       mobile stage nothing overlaps the canvas, so this stays null and the
       authored route is used as-is. */
    const hero = this.canvas.closest('.hero');
    let content = null;
    if (hero) {
      hero.querySelectorAll('.kicker, h1, .lead, .hero-ctas, .hero-search, .trust-chips').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        const b = { left: r.left - rect.left, top: r.top - rect.top, right: r.right - rect.left, bottom: r.bottom - rect.top };
        content = content
          ? { left: Math.min(content.left, b.left), top: Math.min(content.top, b.top), right: Math.max(content.right, b.right), bottom: Math.max(content.bottom, b.bottom) }
          : b;
      });
    }
    const W = this.viewW, H = this.viewH;
    const overlaps = content && content.right > 20 && content.bottom > 20 && content.left < W - 20 && content.top < H - 20;
    const x0 = overlaps ? content.right + 46 : 0;
    const x1 = W - 40;
    const band = overlaps && x1 - x0 >= 170;
    this.band = band;
    this.content = content;

    let points, benchLocator, pergolaLocator;
    if (band) {
      /* the walk promenades up the open lane beside the copy — generated
         from the measured layout, so it adapts to any viewport and never
         runs beneath the headline, buttons or search field */
      const w = (x1 - x0) / 2, mx = x0 + w;
      const wig = Math.min(w * .42, 120);
      /* the floating cards are keep-outs too: each rest stop slides down
         until its prop clears any card hovering over the lane */
      const cards = [];
      hero.querySelectorAll('.float-card').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || getComputedStyle(el).display === 'none') return;
        cards.push({ left: r.left - rect.left, top: r.top - rect.top, right: r.right - rect.left, bottom: r.bottom - rect.top });
      });
      const dodge = (y, clearance, maxY) => {
        for (const cd of cards) {
          if (cd.right < x0 - 20 || cd.left > x1 + 20) continue;
          if (y - clearance < cd.bottom + 16 && y + 54 > cd.top) y = cd.bottom + 16 + clearance;
        }
        return Math.min(y, maxY);
      };
      this.fit = Math.max(.42, Math.min(1, Math.min((x1 - x0) / 640, H / HERO_DESIGN.h)));
      const pergPxEst = Math.max(70, Math.min(100 * this.fit, (x1 - x0) * .26));
      const yP = dodge(H * .30, pergPxEst + 24, H * .58) / H;
      const yB = Math.max(yP + .17, dodge(H * .745, 74, H * .84) / H);
      const yMid = (yB + yP) / 2;
      const pts = [
        [mx + wig * .5, H + 90],
        [mx + wig * .42, H * .94],
        [mx - wig * .25, H * (yB + .10)],
        [mx - wig * .58, H * yB],
        [mx - wig * .2, H * (yB - .10)],
        [mx + wig * .72, H * (yMid + .05)],
        [mx + wig * .9, H * (yMid - .045)],
        [mx + wig * .35, H * (yP + .075)],
        [mx - wig * .5, H * yP],
        [mx - wig * .32, H * Math.max(.14, yP - .08)],
        [mx + wig * .28, H * Math.max(.09, yP - .152)],
        [mx + wig * .55, H * .05],
        [mx + wig * .62, -90],
      ];
      points = pts.map(([x, y]) => this.screenToGround(x, y));
      benchLocator = this.screenToGround(mx - wig * .58, H * yB);
      pergolaLocator = this.screenToGround(mx - wig * .5, H * yP);
    } else {
      points = HERO_LINE.map(([x, y]) => this.designToGround(x, y));
      this.fit = Math.max(.42, Math.min(1, Math.min(W / HERO_DESIGN.w, H / HERO_DESIGN.h)));
    }
    this.travel = new THREE.CatmullRomCurve3(points, false, 'centripetal', .3);
    this.line = this.travel;
    this.travelLength = this.travel.getLength();
    this.uBench = this.closestU(band ? benchLocator : points[HERO_STOP]);
    this.uPergola = this.closestU(band ? pergolaLocator : this.designToGround(HERO_PERGOLA_AT[0], HERO_PERGOLA_AT[1]));

    /* people first — props are sized and placed around them */
    this.pair.scale.setScalar(1);
    this.pair.position.set(0, 0, 0);
    this.pair.rotation.y = 0;
    this.pair.updateMatrixWorld(true);
    const pairBox = new THREE.Box3().setFromObject(this.pair);
    this.pairScale = Math.max(88, 118 * this.fit) / (Math.max(.001, pairBox.max.y - pairBox.min.y) * this.upPx);
    this.pair.scale.setScalar(this.pairScale);
    this.buildInk();

    /* bench: one body-width beside its stop, on the roomier side */
    const benchPoint = this.travel.getPointAt(this.uBench);
    const benchTan = this.travel.getTangentAt(this.uBench).normalize();
    const benchNormal = new THREE.Vector3(benchTan.z, 0, -benchTan.x).normalize();
    this.scaleProp(this.bench.root, Math.max(46, 62 * this.fit));
    const benchBox = new THREE.Box3().setFromObject(this.bench.root);
    const benchOffset = (benchBox.max.z - benchBox.min.z) * .65 + this.pairScale * 1.3;
    const bw = benchPoint.clone().addScaledVector(benchNormal, benchOffset);
    const be = benchPoint.clone().addScaledVector(benchNormal, -benchOffset);
    const benchPos = band ? this.pickSide(bw, be)
      : (bw.clone().project(this.camera).x <= be.clone().project(this.camera).x ? bw : be);
    this.bench.root.position.copy(benchPos);
    this.bench.root.rotation.y = Math.atan2(benchPoint.x - benchPos.x, benchPoint.z - benchPos.z);
    this.benchWorld = benchPos.clone();
    this.restYaw = Math.atan2(benchPos.x - benchPoint.x, benchPos.z - benchPoint.z);

    /* pergola: same treatment at the second stop */
    const pergPoint = this.travel.getPointAt(this.uPergola);
    const pergTan = this.travel.getTangentAt(this.uPergola).normalize();
    const pergNormal = new THREE.Vector3(pergTan.z, 0, -pergTan.x).normalize();
    this.scaleProp(this.pergola.root, Math.max(70, Math.min(100 * this.fit, band ? (x1 - x0) * .26 : 1000)));
    const pergBox = new THREE.Box3().setFromObject(this.pergola.root);
    const pergOffset = (pergBox.max.z - pergBox.min.z) * .62 + this.pairScale * 1.25;
    const pw = pergPoint.clone().addScaledVector(pergNormal, pergOffset);
    const pe = pergPoint.clone().addScaledVector(pergNormal, -pergOffset);
    const pergPos = band ? this.pickSide(pw, pe)
      : (pw.clone().project(this.camera).x <= pe.clone().project(this.camera).x ? pw : pe);
    this.pergola.root.position.copy(pergPos);
    this.pergola.root.rotation.y = Math.atan2(pergPoint.x - pergPos.x, pergPoint.z - pergPos.z);
    this.pergolaWorld = pergPos.clone();
    this.restYawPergola = Math.atan2(pergPos.x - pergPoint.x, pergPos.z - pergPoint.z);

    /* trees + shrubs fill the measured pockets around the copy on desktop;
       the mobile stage keeps its authored spots */
    if (band) {
      const stripH = H - content.bottom;
      const gutterW = content.left;
      this.placePropAt(this.trees[0].root, x1 - 30, H * .175, 44 * this.fit + 16);
      this.placePropAt(this.trees[1].root, x1 - 26, H * .655, 36 * this.fit + 14);
      this.placePropAt(this.shrubs[0].root, x0 + 14, H * .47, 20 * this.fit + 8);
      if (stripH >= 64) this.placePropAt(this.shrubs[1].root, content.left + Math.min(110, (content.right - content.left) * .16), content.bottom + stripH * .52, 20 * this.fit + 8);
      else this.placePropAt(this.shrubs[1].root, x1 - 22, H * .885, 18 * this.fit + 8);
      if (gutterW >= 92) {
        this.extraShrubs[0].root.visible = true;
        this.extraShrubs[1].root.visible = true;
        this.placePropAt(this.extraShrubs[0].root, gutterW * .42, H * .36, 18 * this.fit + 8);
        this.placePropAt(this.extraShrubs[1].root, gutterW * .52, H * .70, 22 * this.fit + 8);
      } else {
        this.extraShrubs[0].root.visible = this.extraShrubs[1].root.visible = false;
      }
    } else {
      HERO_TREES.forEach(([x, y, px], i) => this.placeProp(this.trees[i].root, [x, y], px * this.fit));
      HERO_SHRUBS.forEach(([x, y, px], i) => this.placeProp(this.shrubs[i].root, [x, y], px * this.fit));
      this.extraShrubs.forEach(s => { s.root.visible = false; });
    }

    /* flower beds tuck in behind each rest stop; butterflies hover them */
    const benchBack = benchPos.clone().sub(benchPoint).normalize();
    this.flowerBeds[0].root.position.copy(benchPos).addScaledVector(benchBack, (benchBox.max.z - benchBox.min.z) * 1.15);
    this.flowerBeds[0].root.scale.setScalar(this.pairScale * .85);
    const pergBack = pergPos.clone().sub(pergPoint).normalize();
    this.flowerBeds[1].root.position.copy(pergPos).addScaledVector(pergBack, (pergBox.max.z - pergBox.min.z) * .82);
    this.flowerBeds[1].root.scale.setScalar(this.pairScale * .9);
    this.butterflies[0].anchor.copy(this.flowerBeds[0].root.position);
    this.butterflies[1].anchor.copy(this.flowerBeds[1].root.position);
    this.butterflies[2].anchor.copy(this.trees[0].root.position);
    this.butterflies.forEach(b => b.root.scale.setScalar(this.pairScale * .5));
  }

  placePropAt(root, x, y, targetPx) {
    this.scaleProp(root, Math.max(10, targetPx));
    root.position.copy(this.screenToGround(x, y));
  }

  /* prefer the candidate with the most open room: inside the frame and
     clear of the measured copy */
  pickSide(a, b) {
    const score = (v) => {
      const p = v.clone().project(this.camera);
      const sx = (p.x + 1) / 2 * this.viewW;
      const sy = (1 - p.y) / 2 * this.viewH;
      let s = Math.min(sx - 6, this.viewW - 6 - sx, sy - 6, this.viewH + 60 - sy);
      if (this.content) s = Math.min(s, sx - (this.content.right + 10));
      return s;
    };
    return score(a) >= score(b) ? a : b;
  }

    closestU(target) {
    let best = Infinity, u = .35;
    for (let i = 0; i <= 600; i += 1) {
      const d = this.travel.getPointAt(i / 600).distanceToSquared(target);
      if (d < best) { best = d; u = i / 600; }
    }
    return u;
  }

  scaleProp(root, targetPx) {
    root.scale.setScalar(1);
    root.position.set(0, 0, 0);
    root.rotation.y = 0;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    root.scale.setScalar(targetPx / (Math.max(.001, box.max.y - box.min.y) * this.upPx));
  }

    placeProp(root, design, targetPx) {
    root.scale.setScalar(1);
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    root.scale.setScalar(targetPx / (Math.max(.001, box.max.y - box.min.y) * this.upPx));
    root.position.copy(this.designToGround(design[0], design[1]));
  }

  /* the route is a real paved footpath: offset stone courses laid along the
     walk (UVs follow arc length, so the pavers turn with every bend), a
     grout-toned edge kerb, and screen-constant width so the drawing's
     switchbacks never merge */
  buildInk() {
    if (this.ink) { this.scene.remove(this.ink); this.ink.geometry.dispose(); }
    if (this.inkEdge) { this.scene.remove(this.inkEdge); this.inkEdge.geometry.dispose(); }
    const mainHalfPx = Math.max(7.5, 12 * this.fit);
    const tilePx = 58; /* one texture repeat per ~58 screen px of path */
    const ribbon = (halfPx, y, withUv) => {
      const segments = 460, positions = [], indices = [], uvs = [];
      let cumPx = 0, prev = null;
      for (let i = 0; i <= segments; i += 1) {
        const u = i / segments;
        const p = this.line.getPointAt(u);
        const t = this.line.getTangentAt(u).normalize();
        const n = new THREE.Vector3(t.z, 0, -t.x).normalize();
        const halfWidth = halfPx / this.screenScale(p, n);
        if (prev) cumPx += prev.distanceTo(p) * this.screenScale(p, t);
        prev = p;
        positions.push(
          p.x + n.x * halfWidth, y, p.z + n.z * halfWidth,
          p.x - n.x * halfWidth, y, p.z - n.z * halfWidth,
        );
        if (withUv) uvs.push(0, cumPx / tilePx, 1, cumPx / tilePx);
        if (i < segments) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      if (withUv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      return geometry;
    };
    if (!this.inkMaterial) {
      this.paverTexture = makePaverTexture();
      this.inkMaterial = new THREE.MeshBasicMaterial({
        map: this.paverTexture, transparent: true, opacity: HERO_PATH.opacity,
        depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      });
      this.inkEdgeMaterial = new THREE.MeshBasicMaterial({
        color: HERO_PATH.grout, transparent: true, opacity: HERO_PATH.edgeOpacity,
        depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      });
    }
    this.inkEdge = new THREE.Mesh(ribbon(mainHalfPx + 2.2, .01, false), this.inkEdgeMaterial);
    this.inkEdge.renderOrder = 1;
    this.ink = new THREE.Mesh(ribbon(mainHalfPx, .014, true), this.inkMaterial);
    this.ink.renderOrder = 1;
    this.scene.add(this.inkEdge, this.ink);
  }

    update(dt, t) {
    if (this.needsLayout) { this.layout(); if (this.needsLayout) return; }
    super.update(dt, t);
    this.pergola.update(t);
    this.footMarks.update(dt);
    this.wheelMarks.update(dt);
    this.pawMarks.update(dt);
    this.trees.forEach((tree, i) => { tree.crown.rotation.z = Math.sin(t * .5 + i) * .03; });
    /* park life idles on its own clock */
    this.benchSitter.animate(t * .8, .55);
    this.pergolaPair[0].animate(t * 1.02, .06);
    this.pergolaPair[1].animate(t * 1.13 + 2, .06);
    this.pergolaPair[0].rightArm.rotation.x = -.62 + Math.sin(t * 1.8) * .16;
    this.pergolaPair[1].leftArm.rotation.x = -.5 + Math.sin(t * 2.1 + 1) * .13;
    this.flowerBeds.forEach(bed => bed.flowers.forEach(({ flower, phase }) => {
      flower.position.y = flower.userData.baseY + Math.sin(t * 1.1 + phase) * .014;
      flower.rotation.z = Math.sin(t * .9 + phase) * .09;
    }));
    this.butterflies.forEach((b, i) => {
      const tt = t * (.55 + i * .12) + b.phase;
      const r = this.pairScale;
      b.root.position.set(
        b.anchor.x + Math.sin(tt * .8) * r * 1.3,
        (Math.sin(tt * 1.6) * .3 + 1.2) * r,
        b.anchor.z + Math.cos(tt * .62) * r * 1.1,
      );
      b.root.rotation.y = tt * .5;
      const flap = Math.sin(tt * 11) * .75;
      b.wl.rotation.y = flap;
      b.wr.rotation.y = -flap;
    });

    const cycle = Math.floor(t / HERO_TIME.cycle);
    const local = t % HERO_TIME.cycle;
    if (cycle !== this.lastCycle) {
      this.lastCycle = cycle;
      this.lastStamp = -1;
      /* a different pair takes the next loop */
      this.activeTraveller = ((cycle % this.travellers.length) + this.travellers.length) % this.travellers.length;
      this.travellers.forEach((tr, i) => { tr.root.visible = i === this.activeTraveller; });
      this.heading = undefined;
    }

    /* walk in from off-screen, rest at the bench, rest under the pergola,
       then walk fully off-screen; only the ground marks are left to fade */
    let u, moving, resting = 0, restLen = 0;
    if (local < HERO_TIME.tBench) {
      u = smoother(local / HERO_TIME.legA) * this.uBench;
      moving = true;
    } else if (local < HERO_TIME.tLegB) {
      u = this.uBench; moving = false;
      resting = local - HERO_TIME.tBench; restLen = HERO_TIME.benchRest;
    } else if (local < HERO_TIME.tPergola) {
      u = this.uBench + smoother((local - HERO_TIME.tLegB) / HERO_TIME.legB) * (this.uPergola - this.uBench);
      moving = true;
    } else if (local < HERO_TIME.tLegC) {
      u = this.uPergola; moving = false;
      resting = local - HERO_TIME.tPergola; restLen = HERO_TIME.pergolaRest;
    } else if (local < HERO_TIME.tEnd) {
      u = this.uPergola + smoother((local - HERO_TIME.tLegC) / HERO_TIME.legC) * (1 - this.uPergola);
      moving = true;
    } else {
      u = 1; moving = false;
    }
    const p = this.travel.getPointAt(u);
    const tan = this.travel.getTangentAt(Math.min(.999, Math.max(.001, u))).normalize();
    const yaw = Math.atan2(tan.x, tan.z);
    const distance = u * this.travelLength;
    const gait = distance / Math.max(.05, .52 * this.pairScale) * Math.PI;
    this.pair.position.copy(p);
    /* v65.8: no more statue-swivel at the stops. The group keeps its path
       heading (drifting a touch toward the prop); the LOOKING is done by
       heads and a half-pivot from the carer, so feet never slide. */
    let heading = yaw;
    let gazeAmount = 0, gazeTarget = null;
    if (!moving && restLen) {
      gazeTarget = Math.abs(u - this.uPergola) < 1e-6 ? this.pergolaWorld : this.benchWorld;
      const restYaw = Math.abs(u - this.uPergola) < 1e-6 ? this.restYawPergola : this.restYaw;
      const turnIn = smooth(invLerp(0, 1.7, resting));
      const turnOut = smooth(invLerp(restLen - .9, restLen, resting));
      gazeAmount = turnIn * (1 - turnOut);
      const delta = Math.atan2(Math.sin(restYaw - yaw), Math.cos(restYaw - yaw));
      heading = yaw + delta * .28 * gazeAmount;
    }
    if (this.heading === undefined) this.heading = heading;
    const headingDelta = Math.atan2(Math.sin(heading - this.heading), Math.cos(heading - this.heading));
    const maxTurn = 2.2 * Math.min(dt, .05);
    this.heading += Math.sign(headingDelta) * Math.min(Math.abs(headingDelta) * .1, maxTurn);
    this.pair.rotation.y = this.heading;

    const traveller = this.travellers[this.activeTraveller];
    traveller.animate(distance, gait, moving, t, this.pairScale);
    if (gazeTarget) {
      const worldYaw = Math.atan2(gazeTarget.x - p.x, gazeTarget.z - p.z);
      const localYaw = Math.atan2(Math.sin(worldYaw - this.heading), Math.cos(worldYaw - this.heading));
      traveller.gaze(localYaw, gazeAmount);
    } else {
      traveller.gaze(0, 0);
    }

    if (!moving) return;
    const normal = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
    const alongPx = this.screenScale(p, tan);
    const acrossPx = this.screenScale(p, normal);
    const markFit = Math.sqrt(this.fit);
    if (this.lastStamp >= 0 && (distance - this.lastStamp) * alongPx < 15 * markFit) return;
    this.lastStamp = distance;
    this.footSide ^= 1;
    const s = this.pairScale;
    const fields = { foot: this.footMarks, wheel: this.wheelMarks, paw: this.pawMarks };
    const mark = (kind, lat, lon, wPx, hPx, life, alpha) => {
      const center = p.clone()
        .addScaledVector(normal, lat * s)
        .addScaledVector(tan, lon * s);
      fields[kind].emit(center, tan, normal, wPx * markFit / acrossPx, hPx * markFit / alongPx, life, alpha);
    };
    traveller.marks(mark, this.footSide);
  }

    dispose() {
    super.dispose();
    this.footMarks.dispose();
    this.wheelMarks.dispose();
    this.pawMarks.dispose();
    if (this.ink) this.ink.geometry.dispose();
    if (this.inkEdge) this.inkEdge.geometry.dispose();
    if (this.inkMaterial) this.inkMaterial.dispose();
    if (this.inkEdgeMaterial) this.inkEdgeMaterial.dispose();
    if (this.paverTexture) this.paverTexture.dispose();
  }
}

class GardenCareStage extends MiniStage {
  constructor(canvas){
    super(canvas,{cameraPosition:new THREE.Vector3(8.8,7.6,9.5),lookAt:new THREE.Vector3(.2,.5,.2),frustum:8.2,lightPosition:new THREE.Vector3(-5,10,6)});
    const patch=new THREE.Mesh(new THREE.CircleGeometry(4.1,48),new THREE.MeshStandardMaterial({color:0xf3efe8,roughness:1,transparent:true,opacity:.58}));patch.rotation.x=-Math.PI/2;patch.scale.set(1.42,.78,1);patch.position.y=.001;patch.receiveShadow=true;this.scene.add(patch);
    this.beds=[createRaisedBed(1.1,.25,-.06),createRaisedBed(3.55,.15,.04)];this.beds[0].root.scale.setScalar(.82);this.beds[1].root.scale.setScalar(.82);this.scene.add(this.beds[0].root,this.beds[1].root);
    const tree=createTree(.72);tree.root.position.set(4.8,0,-1.05);this.scene.add(tree.root);this.tree=tree;
    this.flowers=addFlowerPatch(this.scene,4.1,-1.4,13);
    this.gardener=createGardener();this.gardener.root.scale.setScalar(.78);this.scene.add(this.gardener.root);
    this.waterMaterial=new THREE.MeshBasicMaterial({color:C.blue,transparent:true,opacity:.6,depthWrite:false,toneMapped:false});this.drops=[];
    for(let i=0;i<18;i+=1){const drop=new THREE.Mesh(new THREE.SphereGeometry(.035+(i%3)*.006,7,5),this.waterMaterial);drop.visible=false;this.scene.add(drop);this.drops.push(drop);}
    this.lastStamp=-1;this.footSide=0;this.lastCycle=-1;
    this.positions={start:new THREE.Vector3(-4.6,0,2.4),bed1:new THREE.Vector3(.25,0,1.3),bed2:new THREE.Vector3(2.65,0,1.2),exit:new THREE.Vector3(5.9,0,-2.75)};
    /* v65: the gardener's legs are solved against the same obstacle map the
       props are built from — beds, tree trunk and flower patch included — so
       the exit no longer cuts through the second raised bed. */
    this.obstacles=[
      {type:'rect',label:'bed1',minX:-.22,maxX:2.42,minZ:-.37,maxZ:.87},
      {type:'rect',label:'bed2',minX:2.23,maxX:4.87,minZ:-.47,maxZ:.77},
      {type:'circle',label:'trunk',x:4.8,z:-1.05,r:.3},
      {type:'circle',label:'flowers',x:4.1,z:-1.4,r:1.0},
    ];
    const guide=(x,z)=>new THREE.Vector3(x,0,z);
    this.routes={
      toBed1:createNavigationRoute(this.positions.start,this.positions.bed1,this.obstacles,.34),
      toBed2:createNavigationRoute(this.positions.bed1,this.positions.bed2,this.obstacles,.3),
      toExit:createNavigationRoute(this.positions.bed2,this.positions.exit,this.obstacles,.38,[guide(5.6,.95),guide(5.85,-.7)]),
    };
  }
  walkRoute(route,p,phase){const u=Math.min(.9999,easeInOut(p));const pos=route.path.getPointAt(u);const tan=route.path.getTangentAt(u).normalize();const yaw=Math.atan2(tan.x,tan.z);this.gardener.root.position.copy(pos);const cur=this.gardener.root.rotation.y;const d=Math.atan2(Math.sin(yaw-cur),Math.cos(yaw-cur));this.gardener.root.rotation.y=cur+Math.sign(d)*Math.min(Math.abs(d)*.14,.075);this.gardener.animateWalk(phase,.9);this.emitFootprints(pos,yaw,u*route.length);return {pos,yaw};}
  emitFootprints(pos,yaw,d){if(d-this.lastStamp>.33){this.lastStamp=d;this.footSide^=1;this.trails.emit('foot',offsetPoint(pos,yaw,this.footSide?-.15:.15,-.3),yaw,.16,.34,4.2,.13,this.footSide===1);}}
  waterBed(index,t,phase){
    const bed=this.beds[index],target=bed.root.position.clone().add(new THREE.Vector3(0,.62,0));
    const pos=(index===0?this.positions.bed1:this.positions.bed2).clone();this.gardener.root.position.copy(pos);const yaw=Math.atan2(target.x-pos.x,target.z-pos.z);this.gardener.root.rotation.y=yaw;this.gardener.animateWater(phase);
    this.gardener.root.updateMatrixWorld(true);const start=new THREE.Vector3();this.gardener.can.spoutTip.getWorldPosition(start);
    this.drops.forEach((drop,i)=>{const u=(t*1.55+i/this.drops.length)%1;const end=target.clone().add(new THREE.Vector3(((i%5)-2)*.09,0,((i%3)-1)*.08));drop.position.copy(start).lerp(end,u);drop.position.y+=Math.sin(u*Math.PI)*.68;drop.scale.setScalar(.72+Math.sin(u*Math.PI)*.45);drop.visible=true;});
    const soil=bed.soil;const wet=new THREE.Color(0x4f3c2f);soil.color.lerp(wet,.035);bed.plants.forEach((p,i)=>{p.rotation.z=Math.sin(t*2+i)*.025;});
  }
  update(dt,t){
    super.update(dt,t);const duration=18.5,cycle=Math.floor(t/duration),p=(t%duration)/duration;if(cycle!==this.lastCycle){this.lastCycle=cycle;this.lastStamp=-1;this.beds.forEach(b=>b.soil.color.copy(b.baseColor));}
    this.drops.forEach(d=>d.visible=false);let stage='';
    if(p<.24){stage='walk1';this.walkRoute(this.routes.toBed1,invLerp(0,.24,p),t*7.5);}
    else if(p<.43){stage='water1';this.lastStamp=-1;this.waterBed(0,t,t*5);}
    else if(p<.57){stage='walk2';this.walkRoute(this.routes.toBed2,invLerp(.43,.57,p),t*7.5);}
    else if(p<.76){stage='water2';this.lastStamp=-1;this.waterBed(1,t,t*5);}
    else{stage='exit';this.walkRoute(this.routes.toExit,invLerp(.76,1,p),t*7.5);}
    const fade=smooth(invLerp(0,.04,p))*(1-smooth(invLerp(.95,1,p)));this.gardener.root.visible=fade>.01;
    this.tree.crown.rotation.z=Math.sin(t*.55)*.035;this.flowers.forEach(({flower,phase})=>{flower.position.y=flower.userData.baseY+Math.sin(t*1.1+phase)*.012;});
  }
}

function lineSamples(a,b,count,label=null){const out=[];for(let i=0;i<=count;i+=1){const u=i/count;out.push({p:new THREE.Vector3(lerp(a[0],b[0],u),0,lerp(a[1],b[1],u)),lane:label,laneProgress:label===null?0:u,cut:label!==null});}return out;}
function arcSamples(cx,cz,rx,rz,a0,a1,count){const out=[];for(let i=1;i<=count;i+=1){const a=lerp(a0,a1,i/count);out.push({p:new THREE.Vector3(cx+Math.cos(a)*rx,0,cz+Math.sin(a)*rz),lane:null,laneProgress:0,cut:false});}return out;}
function appendSamples(target,samples){if(target.length&&samples.length&&target[target.length-1].p.distanceTo(samples[0].p)<.001)samples=samples.slice(1);target.push(...samples);}

class MowerStage extends MiniStage {
  constructor(canvas){
    super(canvas,{cameraPosition:new THREE.Vector3(8.7,9.3,10.2),lookAt:new THREE.Vector3(0,.35,0),frustum:9.6,lightPosition:new THREE.Vector3(-6,11,5)});
    this.lawn={left:-3.35,right:3.35,bottom:-2.45,top:2.45,laneBottom:-1.72,laneTop:1.72};
    const ground=new THREE.Mesh(new THREE.BoxGeometry(7.1,.08,5.35),standardMaterial(C.greenLight,.98));ground.position.y=-.035;ground.receiveShadow=true;this.scene.add(ground);
    const lawnLines=[];for(let z=-2.3;z<2.5;z+=.28){const line=makeBox(6.9,.008,.018,new THREE.MeshBasicMaterial({color:0x6f9667,transparent:true,opacity:.17,depthWrite:false}),0);line.position.set(0,.02,z);this.scene.add(line);lawnLines.push(line);}
    this.strips=[];this.lanes=[-2.45,-.82,.82,2.45];
    this.lanes.forEach((x,i)=>{const mat=new THREE.MeshStandardMaterial({color:i%2?0x527c49:0x5f884f,roughness:.98,transparent:true,opacity:.82});const mesh=makeBox(1.54,.035,3.44,mat,.01);mesh.position.set(x,.03,0);mesh.scale.z=.001;this.scene.add(mesh);this.strips.push({mesh,amount:0,direction:i%2===0?1:-1});});
    this.addFence();
    this.mower=createMower();this.mower.root.scale.setScalar(.73);this.scene.add(this.mower.root);
    this.route=this.buildRoute();this.routeLengths=[];let total=0;for(let i=0;i<this.route.length;i+=1){if(i>0)total+=this.route[i].p.distanceTo(this.route[i-1].p);this.routeLengths.push(total);}this.routeTotal=total;
    this.lastDistance=-1;this.lastCycle=-1;this.footSide=0;
  }
  addFence(){
    const mat=standardMaterial(C.wood,.88),rail=standardMaterial(C.woodLight,.9);const y=.52;
    const post=(x,z)=>{const p=makeBox(.1,1.02,.1,mat,.018);p.position.set(x,y,z);this.scene.add(p);};
    const railSeg=(a,b,height)=>{const s=cylinderBetween(new THREE.Vector3(a[0],height,a[1]),new THREE.Vector3(b[0],height,b[1]),.035,rail,7);this.scene.add(s);};
    const {left,right,bottom,top}=this.lawn;
    for(let x=left;x<=right+.01;x+=1.1){post(x,top);post(x,bottom);}for(let z=bottom+1.1;z<top;z+=1.1){post(left,z);post(right,z);}
    for(let h of [.38,.78]){railSeg([left,top],[right,top],h);railSeg([left,bottom],[-.8,bottom],h);railSeg([.8,bottom],[right,bottom],h);railSeg([left,bottom],[left,top],h);railSeg([right,bottom],[right,top],h);}
    const gatePad=makeBox(1.45,.045,.72,standardMaterial(0xd8c37f,.95),.01);gatePad.position.set(0,.02,bottom-.28);this.scene.add(gatePad);
  }
  buildRoute(){
    const r=[];const b=this.lawn.laneBottom,t=this.lawn.laneTop;appendSamples(r,lineSamples([0,-4.15],[0,-2.7],14));appendSamples(r,lineSamples([0,-2.7],[this.lanes[0],b],18));
    for(let i=0;i<this.lanes.length;i+=1){const x=this.lanes[i],up=i%2===0;appendSamples(r,lineSamples([x,up?b:t],[x,up?t:b],28,i));if(i<this.lanes.length-1){const nx=this.lanes[i+1],cx=(x+nx)/2,rx=Math.abs(nx-x)/2;appendSamples(r,arcSamples(cx,up?t:b,rx,.56,Math.PI,up?0:Math.PI*2,18));}}
    appendSamples(r,lineSamples([this.lanes[3],b],[0,-2.72],20));appendSamples(r,lineSamples([0,-2.72],[0,-4.25],14));return r;
  }
  sample(distance){
    distance=clamp(distance,0,this.routeTotal);let i=1;while(i<this.routeLengths.length&&this.routeLengths[i]<distance)i+=1;i=Math.min(i,this.route.length-1);const d0=this.routeLengths[i-1],d1=this.routeLengths[i],u=(distance-d0)/Math.max(.0001,d1-d0),a=this.route[i-1],b=this.route[i];const p=a.p.clone().lerp(b.p,u);const tangent=b.p.clone().sub(a.p).normalize();const lane=a.lane===b.lane?a.lane:null;const laneProgress=lane===null?0:lerp(a.laneProgress,b.laneProgress,u);return {p,tangent,lane,laneProgress};
  }
  updateStrips(regrow){
    this.strips.forEach((s,i)=>{const amount=clamp(s.amount*(1-regrow));const len=3.44*amount;s.mesh.scale.z=Math.max(.001,amount);const start=s.direction>0?this.lawn.laneBottom:this.lawn.laneTop;const end=s.direction>0?start+len:start-len;s.mesh.position.z=(start+end)/2;s.mesh.material.opacity=.78*(1-regrow*.9);});
  }
  update(dt,t){
    super.update(dt,t);const duration=31,cycle=Math.floor(t/duration),p=(t%duration)/duration;if(cycle!==this.lastCycle){this.lastCycle=cycle;this.strips.forEach(s=>s.amount=0);this.lastDistance=-1;}
    const moveEnd=.74;const moving=p<moveEnd;const moveP=smoother(invLerp(.015,moveEnd,p));const distance=moveP*this.routeTotal;const sample=this.sample(distance);const yaw=Math.atan2(sample.tangent.x,sample.tangent.z);this.mower.root.position.copy(sample.p);this.mower.root.rotation.y=yaw;this.mower.root.visible=p<.78;
    const cutting=sample.lane!==null&&sample.p.z>this.lawn.laneBottom-.05&&sample.p.z<this.lawn.laneTop+.05;this.mower.animate(distance,t*8.4,cutting);
    if(sample.lane!==null)this.strips[sample.lane].amount=Math.max(this.strips[sample.lane].amount,sample.laneProgress);
    const regrow=p<.78?0:smooth(invLerp(.78,1,p));this.updateStrips(regrow);
    if(moving&&distance-this.lastDistance>.34){this.lastDistance=distance;this.footSide^=1;this.trails.emit('wheel',offsetPoint(sample.p,yaw,-.38,.08),yaw,.08,.46,5,.1);this.trails.emit('wheel',offsetPoint(sample.p,yaw,.38,.08),yaw,.08,.46,5,.1);this.trails.emit('foot',offsetPoint(sample.p,yaw,this.footSide?-.14:.14,-1.38),yaw,.15,.32,4.3,.1,this.footSide===1);}
  }
}

class StoryGardenStage extends MiniStage {
  constructor(canvas){
    super(canvas,{cameraPosition:new THREE.Vector3(7.8,7.5,8.8),lookAt:new THREE.Vector3(0,.5,0),frustum:7.2,lightPosition:new THREE.Vector3(-4,9,5)});
    const patch=new THREE.Mesh(new THREE.CircleGeometry(3.4,44),new THREE.MeshStandardMaterial({color:0xf3efe8,roughness:1,transparent:true,opacity:.45}));patch.rotation.x=-Math.PI/2;patch.scale.set(1.5,.68,1);patch.position.y=.001;this.scene.add(patch);
    this.trees=[createTree(.75),createTree(.62)];this.trees[0].root.position.set(1.9,0,.85);this.trees[1].root.position.set(-1.95,0,.3);this.scene.add(this.trees[0].root,this.trees[1].root);this.flowers=addFlowerPatch(this.scene,-.35,-1.35,22);
    const path=new THREE.CatmullRomCurve3([new THREE.Vector3(-4,0,1.8),new THREE.Vector3(-1.5,0,.8),new THREE.Vector3(.5,0,.4),new THREE.Vector3(2.4,0,-.8),new THREE.Vector3(4,0,-1.6)],false,'centripetal');this.path=path;this.pathLength=path.getLength();this.scene.add(pathRibbon(path,.78,new THREE.MeshStandardMaterial({color:C.path,roughness:1,transparent:true,opacity:.52}),56,.008));
    this.walker=createHuman({ ...CAST.eli, scale:.58 });this.dog=createDog();this.group=new THREE.Group();this.walker.root.position.x=-.35;this.dog.root.position.set(.55,0,.1);this.group.add(this.walker.root,this.dog.root);this.group.scale.setScalar(.72);this.scene.add(this.group);this.lastDistance=-1;this.footSide=0;this.lastCycle=-1;
  }
  update(dt,t){super.update(dt,t);const duration=21,cycle=Math.floor(t/duration),p=(t%duration)/duration;if(cycle!==this.lastCycle){this.lastCycle=cycle;this.lastDistance=-1;}const travel=smoother(invLerp(.12,.88,p));const pos=this.path.getPointAt(travel),tan=this.path.getTangentAt(travel),yaw=Math.atan2(tan.x,tan.z),distance=travel*this.pathLength;this.group.position.copy(pos);this.group.rotation.y=yaw;this.walker.animate(t*7.2,.85);this.dog.animate(t*8.2);const fade=smooth(invLerp(.08,.16,p))*(1-smooth(invLerp(.86,.94,p)));this.group.visible=fade>.01;if(distance-this.lastDistance>.31&&p>.12&&p<.88){this.lastDistance=distance;this.footSide^=1;this.trails.emit('foot',offsetPoint(pos,yaw,-.35+(this.footSide?-.12:.12),-.18),yaw,.14,.3,4.1,.1,this.footSide===1);this.trails.emit('paw',offsetPoint(pos,yaw,.56,-.2),yaw,.16,.18,3.8,.09);}
    this.trees.forEach((tr,i)=>{tr.crown.rotation.z=Math.sin(t*.55+i)*.035;});this.flowers.forEach(({flower,phase})=>{flower.position.y=flower.userData.baseY+Math.sin(t*.9+phase)*.012;flower.rotation.z=Math.sin(t*.8+phase)*.1;});}
}

function createStage(canvas){try{switch(canvas.dataset.careMotion){case'hero':return new HeroJourneyStage(canvas);case'garden':return new GardenCareStage(canvas);case'mower':return new MowerStage(canvas);case'story':return new StoryGardenStage(canvas);default:return null;}}catch(error){console.warn('[BookIt care motion] stage unavailable:',canvas.dataset.careMotion,error);return null;}}

function ensureLoop(){if(animationFrame||!activeStages.size||reduceMotion()||!homeIsVisible())return;clock.start();animationFrame=requestAnimationFrame(loop);}
let frameCount=0;
/* Show time, accumulated from frame deltas rather than read off the rAF
   timestamp. The old `t=now/1000` was time-since-page-load, so any pause made
   the journey jump forward by however long the pause lasted — and a visitor who
   arrived late always saw the walk mid-cycle. */
let showTime=0,retryTimer=0;

/* A paused loop must keep a heartbeat. Previously every pause condition
   returned WITHOUT rescheduling, so one transient moment — a hidden tab, a
   route change, activeStages briefly empty — permanently killed the animation
   and only an incidental event could revive it. That is what froze the pair at
   the bench. Now nothing but static mode can end the loop. */
function scheduleRetry(){
  if(retryTimer||staticMode||!allStages.length)return;
  retryTimer=setTimeout(()=>{
    retryTimer=0;
    if(staticMode||animationFrame)return;
    clock.start();
    animationFrame=requestAnimationFrame(loop);
  },250);
}

function loop(now){
  animationFrame=0;frameCount+=1;
  if(staticMode)return;
  if(reduceMotion()||!homeIsVisible()||document.hidden||!activeStages.size){
    /* paused (route changed, tab hidden, nothing on screen): keep only the
       cheap retry heartbeat. No update, no render — each canvas keeps its
       last painted frame, so nothing burns GPU behind other pages. */
    scheduleRetry();
    return;
  }
  const dt=Math.min(.05,clock.getDelta()||.016);
  showTime+=dt;
  activeStages.forEach(stage=>{if(!stage.disposed){stage.update(dt,showTime);stage.render();}});
  if(!firstFrameSent){firstFrameSent=true;rootEl.classList.add('care-motion-ready');window.dispatchEvent(new CustomEvent('bookit-care-motion-ready'));}
  animationFrame=requestAnimationFrame(loop);
}

function updateHomeState(){
  const active=homeIsVisible();
  rootEl.classList.toggle('care-home-active',active);
  if(!active){
    if(animationFrame){cancelAnimationFrame(animationFrame);animationFrame=0;}
    scheduleRetry();
  }else ensureLoop();
}

/* One still frame, posed at the bench, for people who asked for less motion:
   this build ships no static crops, so bailing out left the hero empty. */
const STATIC_POSE = 15.4;
let staticMode=false,staticPending=false;
function renderStatic(){
  let drawn=0,pending=0;
  allStages.forEach(stage=>{
    /* A stage whose canvas is still collapsed cannot produce pixels, and
       render() succeeds on it regardless — so measure the box, never the
       absence of a throw. Counting throw-free renders is what let a 0x0 hero
       report success and stay permanently blank. */
    if(stage.canvas.width<2||stage.canvas.height<2||stage.needsLayout){stage.canvas.classList.remove('care-motion-painted');pending+=1;return;}
    try{
      if(stage instanceof HeroJourneyStage){stage.footMarks.clear();stage.wheelMarks.clear();stage.pawMarks.clear();stage.lastCycle=-1;stage.lastStamp=-1;for(let t=0;t<=STATIC_POSE;t+=1/12)stage.update(1/12,t);}
      else stage.update(1/60,STATIC_POSE);
      if(stage.needsLayout){stage.canvas.classList.remove('care-motion-painted');pending+=1;return;}
      stage.render();stage.canvas.classList.add('care-motion-painted');drawn+=1;
    }catch(error){console.warn('[BookIt care motion] static frame unavailable:',error);}
  });
  if(drawn)rootEl.classList.add('care-motion-static','care-motion-ready');
  staticPending=pending>0;
  return drawn===allStages.length;
}

/* Entering reduced motion at ANY time must land in the same place: loop
   stopped, one still frame painted, and a retry that survives a canvas which
   is not laid out yet. Boot and both runtime observers call these. */
function enterStaticMode(){
  if(staticMode)return;
  staticMode=true;
  activeStages.clear();
  if(animationFrame){cancelAnimationFrame(animationFrame);animationFrame=0;}
  if(retryTimer){clearTimeout(retryTimer);retryTimer=0;}
  rootEl.classList.remove('care-motion-ready');
  const attempt=n=>{if(!staticMode||renderStatic()||n<=0)return;setTimeout(()=>attempt(n-1),n>6?120:500);};
  requestAnimationFrame(()=>attempt(12));
}
function exitStaticMode(){
  if(!staticMode)return;
  staticMode=false;staticPending=false;
  if(staticRedrawTimer){clearTimeout(staticRedrawTimer);staticRedrawTimer=0;}
  rootEl.classList.remove('care-motion-static');
  allStages.forEach(s=>s.canvas.classList.remove('care-motion-painted'));
  showTime=0;
  startMotion();
}

let staticRedrawTimer=0;
function queueStaticRedraw(){
  if(staticRedrawTimer)return;
  staticRedrawTimer=setTimeout(()=>{staticRedrawTimer=0;renderStatic();},60);
}

function boot(){
  const canvases=[...document.querySelectorAll(MOTION_SELECTOR)];if(!canvases.length)return;
  /* Keep every stage that builds. One failing scene used to dispose all four,
     which is why a single bad stage emptied the whole homepage. */
  canvases.forEach(canvas=>{const stage=createStage(canvas);if(stage)allStages.push(stage);else canvas.style.display='none';});
  if(!allStages.length)return;
  window.__bookitCareMotion={stages:allStages,active:activeStages,ready:()=>rootEl.classList.contains('care-motion-ready'),renderStatic,enterStaticMode,exitStaticMode,isStatic:()=>staticMode};

  /* ---- wiring, registered unconditionally ----------------------------------
     Everything below must exist on BOTH boot paths. When the listeners lived
     after an `if(reduceMotion()) … return`, the branch that picked the initial
     state also decided whether any listener existed, so a page loaded with
     reduce already on had nothing watching data-motion and could never leave
     the still frame. The reduce check now chooses only the starting state. */
  window.addEventListener('resize',()=>{if(staticMode&&staticPending)renderStatic();},{passive:true});
  window.addEventListener('resize',()=>{if(!staticMode)ensureLoop();},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!staticMode)ensureLoop();});
  window.addEventListener('hashchange',()=>setTimeout(updateHomeState,0));
  const home=document.getElementById('page-home');
  if(home)new MutationObserver(updateHomeState).observe(home,{attributes:true,attributeFilter:['hidden','class','style']});

  /* Only the scene in view runs. Built here, not in the motion branch, so the
     cull is in place whenever motion is (re-)enabled — otherwise leaving the
     still frame would animate all four scenes at once, unculled. */
  if(typeof IntersectionObserver==='function'){
    const io=new IntersectionObserver(entries=>{entries.forEach(entry=>{
      if(staticMode)return;
      const stage=allStages.find(s=>s.canvas===entry.target);
      if(stage)stage.setVisible(entry.isIntersecting&&entry.intersectionRatio>.04);
    });},{rootMargin:'220px 0px',threshold:[0,.04,.16]});
    allStages.forEach(s=>io.observe(s.canvas));
  }

  /* The site's accessibility toggle writes data-motion (and is two-way), so
     watch it in both directions; high contrast hides the canvases outright. */
  const syncMotionPreference=()=>{if(reduceMotion())enterStaticMode();else exitStaticMode();};
  const media=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)');
  if(media)media.addEventListener?.('change',syncMotionPreference);
  new MutationObserver(syncMotionPreference).observe(rootEl,{attributes:true,attributeFilter:['class','data-motion']});

  /* `care-home-active` retires the legacy full-page walker layer; it has to be
     set on the reduce path too, or re-enabling motion brings those walkers
     back to compete with the care scenes. */
  updateHomeState();

  /* ---- initial state ---- */
  if(reduceMotion()){enterStaticMode();return;}
  startMotion();
}

/* Wake every stage and paint one frame synchronously. Waiting on the
   IntersectionObserver meant that anywhere it is throttled — a background tab,
   an embedded frame, some in-app browsers — nothing was ever marked visible and
   the homepage stayed empty. */
function startMotion(){
  /* Cull from live geometry, not from the IntersectionObserver: on re-enable it
     has no pending callback for a stage that was already off-screen, so
     trusting it would animate all four scenes until the next scroll. */
  const margin=220;
  allStages.forEach(s=>{
    const r=s.canvas.getBoundingClientRect();
    const onScreen=r.width>1&&r.height>1&&r.bottom>-margin&&r.top<innerHeight+margin;
    s.visible=onScreen;
    if(onScreen)activeStages.add(s);else activeStages.delete(s);
  });
  if(!activeStages.size&&allStages[0]){allStages[0].visible=true;activeStages.add(allStages[0]);}
  const seed=performance.now()/1000;
  allStages.forEach(stage=>{try{stage.update(1/60,seed);stage.render();}catch(error){console.warn('[BookIt care motion] first frame failed:',error);}});
  rootEl.classList.add('care-motion-ready');
  frameCount=0;
  /* if the animation loop never got a frame, leave a still one on screen */
  setTimeout(()=>{if(frameCount<2&&!staticMode)renderStatic();},1200);
  ensureLoop();
  /* if the hero was still zero-sized at boot, nudge it once the layout lands */
  requestAnimationFrame(()=>{updateHomeState();ensureLoop();});
  setTimeout(()=>{allStages.forEach(s=>s.resize&&s.resize());ensureLoop();},600);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
