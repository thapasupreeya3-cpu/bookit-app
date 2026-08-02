import * as THREE from './three.module.min.js';

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

function createHuman(options = {}) {
  const root = new THREE.Group();
  root.scale.setScalar(options.scale ?? .62);
  const skin = standardMaterial(options.skin ?? 0xb97957, .84);
  const shirt = standardMaterial(options.shirt ?? C.tealMid, .86);
  const trousers = standardMaterial(options.trousers ?? 0x344c51, .88);
  const hair = standardMaterial(options.hair ?? 0x2b2625, .95);
  const shoes = standardMaterial(options.shoes ?? C.ink, .76);
  const eye = standardMaterial(0x1e2930, .72);

  const torso = new THREE.Group();
  const torsoMesh = makeCapsule(.38, .56, shirt, 12);
  torsoMesh.scale.set(1, 1, .82);
  torso.add(torsoMesh);

  const head = new THREE.Group();
  const face = makeSphere(.31, skin, 18, 13);
  face.scale.set(.9, 1.08, .9);
  head.add(face);
  const hairCap = makeSphere(.326, hair, 16, 11);
  hairCap.scale.set(.95, .64, .95);
  hairCap.position.set(0, .18, -.035);
  head.add(hairCap);
  if (options.hairStyle === 'bun') {
    const bun = makeSphere(.17, hair, 12, 9);
    bun.position.set(0, .34, -.18);
    head.add(bun);
  } else if (options.hairStyle === 'waves') {
    for (const side of [-1, 1]) {
      const wave = makeCapsule(.085, .34, hair, 9);
      wave.position.set(side * .25, -.03, -.08);
      wave.rotation.z = -side * .1;
      head.add(wave);
    }
  } else if (options.hairStyle === 'curls') {
    for (const [x, y] of [[-.22,.13],[.22,.13],[-.24,-.02],[.24,-.02],[-.14,.29],[.14,.29]]) {
      const curl = makeSphere(.105, hair, 9, 7);
      curl.position.set(x, y, -.07);
      head.add(curl);
    }
  }
  for (const side of [-1, 1]) {
    const eyeMesh = makeSphere(.03, eye, 8, 6);
    eyeMesh.position.set(side * .105, .035, .272);
    head.add(eyeMesh);
  }

  const leftArm = new THREE.Group();
  const rightArm = new THREE.Group();
  const leftLeg = new THREE.Group();
  const rightLeg = new THREE.Group();
  function addArm(target, side) {
    const sleeve = makeCapsule(.105, .34, shirt, 9);
    sleeve.position.y = -.27;
    const hand = makeCapsule(.072, .2, skin, 9);
    hand.position.y = -.61;
    target.add(sleeve, hand);
    target.position.x = side * .47;
  }
  function addLeg(target, side) {
    const upper = makeCapsule(.14, .38, trousers, 10);
    upper.position.y = -.31;
    const lower = makeCapsule(.12, .34, trousers, 10);
    lower.position.y = -.74;
    const shoe = makeBox(.25, .15, .43, shoes, .03);
    shoe.position.set(0, -1, .11);
    target.add(upper, lower, shoe);
    target.position.x = side * .2;
  }
  addArm(leftArm, -1); addArm(rightArm, 1);
  addLeg(leftLeg, -1); addLeg(rightLeg, 1);

  const seated = !!options.seated;
  if (seated) {
    torso.position.y = 1.2; head.position.y = 2.02;
    leftArm.position.y = rightArm.position.y = 1.52;
    leftArm.rotation.x = rightArm.rotation.x = -.25;
    leftLeg.position.y = rightLeg.position.y = .72;
    leftLeg.rotation.x = rightLeg.rotation.x = -1.16;
    leftLeg.children[1].rotation.x = rightLeg.children[1].rotation.x = .78;
  } else {
    torso.position.y = 1.78; head.position.y = 2.64;
    leftArm.position.y = rightArm.position.y = 2.05;
    leftLeg.position.y = rightLeg.position.y = 1.02;
  }
  root.add(torso, head, leftArm, rightArm, leftLeg, rightLeg);

  return {
    root, torso, head, leftArm, rightArm, leftLeg, rightLeg, seated,
    animate(phase, intensity = 1) {
      if (seated) {
        const push = Math.sin(phase * .74);
        leftArm.rotation.x = -.34 + push * .18 * intensity;
        rightArm.rotation.x = -.34 + push * .18 * intensity;
        torso.rotation.z = Math.sin(phase * .36) * .025 * intensity;
        head.rotation.y = Math.sin(phase * .22) * .13 * intensity;
        return;
      }
      const stride = Math.sin(phase);
      const lift = Math.max(0, Math.sin(phase * 2)) * .045 * intensity;
      leftLeg.rotation.x = stride * .48 * intensity;
      rightLeg.rotation.x = -stride * .48 * intensity;
      leftArm.rotation.x = -stride * .4 * intensity;
      rightArm.rotation.x = stride * .4 * intensity;
      torso.position.y = 1.78 + lift;
      torso.rotation.y = stride * .035 * intensity;
      head.position.y = 2.64 + lift * .65;
      head.rotation.y = Math.sin(phase * .35) * .1 * intensity;
    },
  };
}

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
  const cushion = standardMaterial(C.amber, .9);
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
    const casterFork = cylinderBetween(new THREE.Vector3(side * .45, .46, .38), new THREE.Vector3(side * .45, .21, .65), .027, frame, 7);
    const caster = createWheel(.14, false); caster.scale.setScalar(.62); caster.position.set(side * .45, .16, .68); root.add(casterFork, caster);
  }
  const person = createHuman({ skin: 0x9a5d41, shirt: C.amber, trousers: 0x40585a, hair: 0x251e1c, hairStyle: 'bun', seated: true, scale: .67 });
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
  const human = createHuman({ skin: 0x8d563d, shirt: C.tealMid, trousers: 0x355052, hair: 0x241f1e, hairStyle: 'bun', scale: .66 });
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
  const wood=standardMaterial(C.wood,.84), light=standardMaterial(C.woodLight,.86), leaf=standardMaterial(0x5f9171,.94), bloom=standardMaterial(C.coral,.9);
  for(const x of [-1.75,1.75]) for(const z of [-1.05,1.05]){const p=makeBox(.16,2.4,.16,wood,.025);p.position.set(x,1.2,z);root.add(p);}
  for(const z of [-1.05,1.05]){const b=makeBox(3.8,.16,.18,wood,.025);b.position.set(0,2.38,z);root.add(b);}
  for(let i=0;i<8;i+=1){const x=-1.62+i*.46;const slat=makeBox(.11,.11,2.35,light,.02);slat.position.set(x,2.51,0);root.add(slat);}
  const leaves=[];
  for(let i=0;i<22;i+=1){const l=makeSphere(.11+(i%3)*.018,leaf,8,6);l.position.set(-1.7+(i%8)*.48,2.58+Math.sin(i)*.055,-1.1+(i%4)*.72);root.add(l);leaves.push({mesh:l,base:l.position.clone(),phase:i*.7}); if(i%5===0){const f=makeSphere(.04,bloom,7,5);f.position.copy(l.position).add(new THREE.Vector3(.05,.05,.02));root.add(f);}}
  const floor=new THREE.Mesh(new THREE.CircleGeometry(2.15,40),new THREE.MeshStandardMaterial({color:C.path,roughness:.98,transparent:true,opacity:.92}));floor.rotation.x=-Math.PI/2;floor.scale.set(1.15,.72,1);floor.position.y=.006;floor.receiveShadow=true;root.add(floor,contactShadow(3.2,2.1,.045));
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
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,premultipliedAlpha:true,powerPreference:'high-performance'});
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
  }
  setVisible(v){this.visible=v;if(v)activeStages.add(this);else activeStages.delete(this);ensureLoop();}
  update(dt,t){this.elapsed=t;this.trails.update(dt);}
  render(){this.renderer.render(this.scene,this.camera);}
  dispose(){this.disposed=true;this.resizeObserver.disconnect();this.trails.clear();this.renderer.dispose();}
}

class HeroJourneyStage extends MiniStage {
  constructor(canvas){
    super(canvas,{cameraPosition:new THREE.Vector3(9.5,8.3,10.5),lookAt:new THREE.Vector3(.4,.4,0),frustum:9.2,lightPosition:new THREE.Vector3(-6,11,6)});
    const pathPoints=[new THREE.Vector3(-5.8,0,3.8),new THREE.Vector3(-4.2,0,2.5),new THREE.Vector3(-2.2,0,1.4),new THREE.Vector3(.1,0,.8),new THREE.Vector3(2.1,0,-.1),new THREE.Vector3(3.8,0,-1.8),new THREE.Vector3(5.5,0,-3.4)];
    this.path=new THREE.CatmullRomCurve3(pathPoints,false,'centripetal',.25);this.pathLength=this.path.getLength();
    const edgeMat=new THREE.MeshStandardMaterial({color:C.pathEdge,roughness:.98,transparent:true,opacity:.52});
    const pathMat=new THREE.MeshStandardMaterial({color:C.path,roughness:.99,transparent:true,opacity:.74});
    this.scene.add(pathRibbon(this.path,1.25,edgeMat,80,.008),pathRibbon(this.path,1.04,pathMat,80,.014));
    this.pergola=createPergola();this.pergola.root.position.set(3.7,0,-2.55);this.pergola.root.scale.setScalar(.82);this.scene.add(this.pergola.root);
    this.pair=new THREE.Group();this.chair=createWheelchair();this.worker=createHuman({skin:0x8a553d,shirt:C.tealMid,trousers:0x3c5557,hair:0x2b211e,hairStyle:'curls',scale:.65});
    this.chair.root.position.x=-.78;this.worker.root.position.x=.75;this.worker.root.position.z=.02;this.pair.add(this.chair.root,this.worker.root,contactShadow(2.25,1.25,.055));this.pair.scale.setScalar(.78);this.scene.add(this.pair);
    this.lastDistance=-1;this.footSide=0;this.lastCycle=-1;
  }
  update(dt,t){
    super.update(dt,t);this.pergola.update(t);
    const duration=17.5;const cycle=Math.floor(t/duration);const local=(t%duration)/duration;
    if(cycle!==this.lastCycle){this.lastCycle=cycle;this.lastDistance=-1;}
    const travel=smoother(invLerp(.035,.91,local));
    const p=this.path.getPointAt(travel),tan=this.path.getTangentAt(travel).normalize(),yaw=Math.atan2(tan.x,tan.z);
    this.pair.position.copy(p);this.pair.rotation.y=yaw;
    const distance=travel*this.pathLength;const moving=local>.035&&local<.91;
    this.chair.animate(distance,t*7.3);this.worker.animate(t*7.3,moving?1:.08);
    const fadeIn=smooth(invLerp(0,.06,local)),fadeOut=1-smooth(invLerp(.9,1,local));this.pair.visible=fadeIn*fadeOut>.01;this.pair.scale.setScalar(.78*(.94+.06*fadeIn*fadeOut));
    this.pair.traverse(o=>{if(o.material&&'opacity'in o.material&&o.material.transparent)o.material.opacity=fadeIn*fadeOut;});
    if(moving&&distance-this.lastDistance>.34){
      this.lastDistance=distance;this.footSide^=1;
      const chairCenter=p.clone();
      this.trails.emit('wheel',offsetPoint(chairCenter,yaw,-.78-.36,-.2),yaw,.09,.56,5.6,.12);
      this.trails.emit('wheel',offsetPoint(chairCenter,yaw,-.78+.36,-.2),yaw,.09,.56,5.6,.12);
      this.trails.emit('foot',offsetPoint(chairCenter,yaw,.75+(this.footSide?-.16:.16),-.28),yaw,.16,.34,4.6,.13,this.footSide===1);
    }
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
    this.positions={start:new THREE.Vector3(-4.6,0,2.4),bed1:new THREE.Vector3(.25,0,1.25),bed2:new THREE.Vector3(2.65,0,1.15),exit:new THREE.Vector3(5.5,0,-2.4)};
  }
  walkBetween(a,b,p,phase){const e=easeInOut(p);const pos=a.clone().lerp(b,e);const dir=b.clone().sub(a).normalize();const yaw=Math.atan2(dir.x,dir.z);this.gardener.root.position.copy(pos);this.gardener.root.rotation.y=yaw;this.gardener.animateWalk(phase,.9);this.emitFootprints(pos,yaw,p);return {pos,yaw};}
  emitFootprints(pos,yaw,progress){const d=progress*6;if(d-this.lastStamp>.33){this.lastStamp=d;this.footSide^=1;this.trails.emit('foot',offsetPoint(pos,yaw,this.footSide?-.15:.15,-.3),yaw,.16,.34,4.2,.13,this.footSide===1);}}
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
    if(p<.24){stage='walk1';this.walkBetween(this.positions.start,this.positions.bed1,invLerp(0,.24,p),t*7.5);}
    else if(p<.43){stage='water1';this.lastStamp=-1;this.waterBed(0,t,t*5);}
    else if(p<.57){stage='walk2';this.walkBetween(this.positions.bed1,this.positions.bed2,invLerp(.43,.57,p),t*7.5);}
    else if(p<.76){stage='water2';this.lastStamp=-1;this.waterBed(1,t,t*5);}
    else{stage='exit';this.walkBetween(this.positions.bed2,this.positions.exit,invLerp(.76,1,p),t*7.5);}
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
    this.trees=[createTree(.75),createTree(.62)];this.trees[0].root.position.set(1.5,0,-.3);this.trees[1].root.position.set(-1.7,0,.45);this.scene.add(this.trees[0].root,this.trees[1].root);this.flowers=addFlowerPatch(this.scene,0,0,22);
    const path=new THREE.CatmullRomCurve3([new THREE.Vector3(-4,0,1.8),new THREE.Vector3(-1.5,0,.8),new THREE.Vector3(.5,0,.4),new THREE.Vector3(2.4,0,-.8),new THREE.Vector3(4,0,-1.6)],false,'centripetal');this.path=path;this.pathLength=path.getLength();this.scene.add(pathRibbon(path,.78,new THREE.MeshStandardMaterial({color:C.path,roughness:1,transparent:true,opacity:.52}),56,.008));
    this.walker=createHuman({skin:0x9f6547,shirt:C.coral,trousers:0x3f5558,hair:0x2d231f,hairStyle:'waves',scale:.58});this.dog=createDog();this.group=new THREE.Group();this.walker.root.position.x=-.35;this.dog.root.position.set(.55,0,.1);this.group.add(this.walker.root,this.dog.root);this.group.scale.setScalar(.72);this.scene.add(this.group);this.lastDistance=-1;this.footSide=0;this.lastCycle=-1;
  }
  update(dt,t){super.update(dt,t);const duration=21,cycle=Math.floor(t/duration),p=(t%duration)/duration;if(cycle!==this.lastCycle){this.lastCycle=cycle;this.lastDistance=-1;}const travel=smoother(invLerp(.12,.88,p));const pos=this.path.getPointAt(travel),tan=this.path.getTangentAt(travel),yaw=Math.atan2(tan.x,tan.z),distance=travel*this.pathLength;this.group.position.copy(pos);this.group.rotation.y=yaw;this.walker.animate(t*7.2,.85);this.dog.animate(t*8.2);const fade=smooth(invLerp(.08,.16,p))*(1-smooth(invLerp(.86,.94,p)));this.group.visible=fade>.01;if(distance-this.lastDistance>.31&&p>.12&&p<.88){this.lastDistance=distance;this.footSide^=1;this.trails.emit('foot',offsetPoint(pos,yaw,-.35+(this.footSide?-.12:.12),-.18),yaw,.14,.3,4.1,.1,this.footSide===1);this.trails.emit('paw',offsetPoint(pos,yaw,.56,-.2),yaw,.16,.18,3.8,.09);}
    this.trees.forEach((tr,i)=>{tr.crown.rotation.z=Math.sin(t*.55+i)*.035;});this.flowers.forEach(({flower,phase})=>{flower.position.y=flower.userData.baseY+Math.sin(t*.9+phase)*.012;flower.rotation.z=Math.sin(t*.8+phase)*.1;});}
}

function createStage(canvas){try{switch(canvas.dataset.careMotion){case'hero':return new HeroJourneyStage(canvas);case'garden':return new GardenCareStage(canvas);case'mower':return new MowerStage(canvas);case'story':return new StoryGardenStage(canvas);default:return null;}}catch(error){console.warn('[BookIt care motion] stage unavailable:',canvas.dataset.careMotion,error);return null;}}

function ensureLoop(){if(animationFrame||!activeStages.size||reduceMotion()||!homeIsVisible())return;clock.start();animationFrame=requestAnimationFrame(loop);}
function loop(now){animationFrame=0;if(reduceMotion()||!homeIsVisible()||document.hidden){activeStages.forEach(stage=>stage.render());return;}const dt=Math.min(.05,clock.getDelta()||.016),t=now/1000;activeStages.forEach(stage=>{if(!stage.disposed){stage.update(dt,t);stage.render();}});if(!firstFrameSent&&activeStages.size){firstFrameSent=true;rootEl.classList.add('care-motion-ready');window.dispatchEvent(new CustomEvent('bookit-care-motion-ready'));}if(activeStages.size)animationFrame=requestAnimationFrame(loop);}

function updateHomeState(){const active=homeIsVisible();rootEl.classList.toggle('care-home-active',active);if(!active&&animationFrame){cancelAnimationFrame(animationFrame);animationFrame=0;}else ensureLoop();}

function boot(){
  if(reduceMotion())return;
  const canvases=[...document.querySelectorAll(MOTION_SELECTOR)];if(!canvases.length)return;
  canvases.forEach(canvas=>{const stage=createStage(canvas);if(stage)allStages.push(stage);});if(allStages.length!==canvases.length){allStages.forEach(stage=>stage.dispose());allStages.length=0;return;}
  const io=new IntersectionObserver(entries=>{entries.forEach(entry=>{const stage=allStages.find(s=>s.canvas===entry.target);if(stage)stage.setVisible(entry.isIntersecting&&entry.intersectionRatio>.04);});},{rootMargin:'120px 0px',threshold:[0,.04,.16]});allStages.forEach(s=>io.observe(s.canvas));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)ensureLoop();});
  window.addEventListener('hashchange',()=>setTimeout(updateHomeState,0));
  const home=document.getElementById('page-home');if(home)new MutationObserver(updateHomeState).observe(home,{attributes:true,attributeFilter:['hidden','class','style']});
  const media=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)');if(media)media.addEventListener?.('change',()=>{if(reduceMotion()){rootEl.classList.remove('care-motion-ready');activeStages.clear();if(animationFrame)cancelAnimationFrame(animationFrame);animationFrame=0;}else ensureLoop();});
  new MutationObserver(()=>{if(reduceMotion()){rootEl.classList.remove('care-motion-ready');activeStages.clear();if(animationFrame)cancelAnimationFrame(animationFrame);animationFrame=0;}}).observe(rootEl,{attributes:true,attributeFilter:['class','data-motion']});
  updateHomeState();ensureLoop();
  window.__bookitCareMotion={stages:allStages,active:activeStages,ready:()=>rootEl.classList.contains('care-motion-ready')};
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
