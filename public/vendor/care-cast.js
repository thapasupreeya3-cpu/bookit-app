import * as THREE from './three.module.min.js';

/*
 * BookIt care-cast v68 — the ONE character factory, shared by the homepage
 * journey (care-motion.js) and every service diorama (care-core.local.js).
 *
 * The build inside is the approved v66 sculpted cast: realistic proportions
 * (smaller head, neck, shoulders, waist), warm faces (brows, eyes with a
 * catchlight, nose, a real smile, blush), mitten hands, fuller hair, and
 * legs that bend at the knee. It wears this file's full wardrobe — locs,
 * bob, crop, bun, waves, curls, beards, headscarves, glasses, lanyard
 * badges, jackets, short sleeves, prosthetics.
 *
 * The skeleton metrics are IDENTICAL to the previous rigs — torso pivot
 * 1.78/1.2 (standing/seated), head 2.64/2.02, arms 2.05/1.52 at x ±.47,
 * legs 1.02/.72 at x ±.2, lower leg at children[1] — so every existing
 * choreography, seat blend and prop offset keeps working untouched.
 */

function standardMaterial(color, roughness = .9, metalness = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function makeSphere(radius, material, widthSegments = 14, heightSegments = 10) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, widthSegments, heightSegments), material);
    mesh.castShadow = true;
    return mesh;
}
function makeCapsule(radius, length, material, radialSegments = 10) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, radialSegments), material);
    mesh.castShadow = true;
    return mesh;
}
function makeBox(width, height, depth, material, soften = .03) {
    const geometry = new THREE.BoxGeometry(width, height, depth, 2, 2, 2);
    if (soften) {
        const position = geometry.attributes.position;
        const vector = new THREE.Vector3();
        for (let i = 0; i < position.count; i += 1) {
            vector.fromBufferAttribute(position, i);
            const limit = new THREE.Vector3(width / 2 - soften, height / 2 - soften, depth / 2 - soften);
            const clamped = vector.clone().clamp(limit.clone().negate(), limit);
            const overflow = vector.clone().sub(clamped);
            if (overflow.lengthSq() > 0) {
                overflow.setLength(soften);
                vector.copy(clamped.add(overflow));
                position.setXYZ(i, vector.x, vector.y, vector.z);
            }
        }
        geometry.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
}
function cylinderBetween(start, end, radius, material, radialSegments = 7) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material);
    mesh.position.copy(start).addScaledVector(direction, .5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    return mesh;
}

export function createHuman(options = {}) {
    const root = new THREE.Group();
    root.scale.setScalar(options.scale ?? .78);
    const skin = standardMaterial(options.skin ?? 0xb97957, .72);
    const shirt = standardMaterial(options.shirt ?? 0x9cbcab, .84);
    const trousers = standardMaterial(options.trousers ?? 0x33504f, .88);
    const hair = standardMaterial(options.hair ?? 0x2b2625, .9);
    const shoes = standardMaterial(options.shoes ?? 0x283844, .72);
    const jacket = options.jacket ? standardMaterial(options.jacket, .86) : null;
    const eye = standardMaterial(0x241d1a, .5);
    const white = standardMaterial(0xfffdf6, .4);
    const lip = standardMaterial(0x8e5147, .78);
    const blushMat = standardMaterial(0xd8907e, .95);
    const prostheticMat = standardMaterial(0x75838d, .42, .42);
    const outerwear = jacket ?? shirt;
    const shortSleeves = options.sleeves === 'short' || options.shortSleeves === true;

    /* ---- torso: shoulders, tapered chest, hips ---- */
    const torso = new THREE.Group();
    const chest = makeCapsule(.31, .5, shirt, 16);
    chest.position.y = .04;
    chest.scale.set(1.04, 1, .76);
    const shoulderBar = makeCapsule(.15, .37, outerwear, 12);
    shoulderBar.rotation.z = Math.PI / 2;
    shoulderBar.position.y = .34;
    shoulderBar.scale.set(1, 1, .82);
    const hips = makeCapsule(.275, .14, trousers, 14);
    hips.position.y = -.5;
    hips.scale.set(1.08, 1, .8);
    const waistband = makeBox(.6, .09, .45, trousers, .025);
    waistband.position.y = -.36;
    torso.add(chest, shoulderBar, hips, waistband);
    if (jacket) {
        /* an open cardigan: two soft front panels over the shirt */
        for (const side of [-1, 1]) {
            const panel = makeBox(.26, .62, .1, jacket, .05);
            panel.position.set(side * .17, .02, .19);
            panel.rotation.y = side * .06;
            torso.add(panel);
        }
        const backPanel = makeBox(.56, .64, .1, jacket, .05);
        backPanel.position.set(0, .03, -.17);
        torso.add(backPanel);
    }
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.118, .028, 8, 20, Math.PI * 1.5), outerwear);
    collar.position.set(0, .43, .1);
    collar.rotation.set(Math.PI / 2, 0, Math.PI * .75);
    torso.add(collar);
    const shirtPocket = makeBox(.15, .13, .022, outerwear, .014);
    shirtPocket.position.set(.17, .1, .243);
    torso.add(shirtPocket);
    if (options.badge) {
        const lanyardMaterial = standardMaterial(0x486c71, .72);
        torso.add(
            cylinderBetween(new THREE.Vector3(-.09, .38, .2), new THREE.Vector3(0, .05, .25), .012, lanyardMaterial, 6),
            cylinderBetween(new THREE.Vector3(.09, .38, .2), new THREE.Vector3(0, .05, .25), .012, lanyardMaterial, 6),
        );
        const badge = makeBox(.18, .23, .03, white, .02);
        badge.position.set(0, -.07, .265);
        const badgeStripe = makeBox(.13, .03, .012, standardMaterial(0x2d847d, .72), .008);
        badgeStripe.position.set(0, .07, .019);
        badge.add(badgeStripe);
        const photo = makeBox(.07, .08, .012, standardMaterial(0xc9a07e, .85), .006);
        photo.position.set(-.04, -.04, .019);
        badge.add(photo);
        torso.add(badge);
    }

    /* ---- head: the v66 face ---- */
    const head = new THREE.Group();
    const face = makeSphere(.26, skin, 24, 17);
    face.scale.set(.94, 1.06, .92);
    head.add(face);
    const neck = makeCapsule(.078, .12, skin, 10);
    neck.position.set(0, -.28, -.01);
    head.add(neck);
    for (const side of [-1, 1]) {
        const ear = makeSphere(.053, skin, 10, 8);
        ear.scale.set(.55, .95, .55);
        ear.position.set(side * .243, -.01, .01);
        head.add(ear);
        const eyeMesh = makeSphere(.043, eye, 10, 8);
        eyeMesh.scale.set(1, 1.22, .5);
        eyeMesh.position.set(side * .094, .028, .218);
        head.add(eyeMesh);
        const catchlight = makeSphere(.0135, white, 6, 5);
        catchlight.position.set(side * .082, .052, .243);
        head.add(catchlight);
        const eyebrow = makeCapsule(.0145, .062, hair, 7);
        eyebrow.position.set(side * .096, .118, .222);
        eyebrow.rotation.z = Math.PI / 2 + side * .16;
        head.add(eyebrow);
        const blush = makeSphere(.036, blushMat, 8, 6);
        blush.scale.set(1.3, .55, .38);
        blush.position.set(side * .148, -.072, .193);
        head.add(blush);
    }
    const nose = makeSphere(.032, skin, 10, 8);
    nose.scale.set(.82, 1.18, .9);
    nose.position.set(0, -.028, .243);
    head.add(nose);
    const smile = new THREE.Mesh(new THREE.TorusGeometry(.052, .0125, 7, 18, 2.5), lip);
    smile.position.set(0, -.098, .222);
    smile.rotation.z = Math.PI + (Math.PI - 2.5) / 2;
    smile.scale.set(1, .82, .5);
    head.add(smile);
    if (options.beard) {
        const beard = makeSphere(.16, hair, 14, 10);
        beard.scale.set(.84, .58, .62);
        beard.position.set(0, -.135, .1);
        head.add(beard);
        const moustache = makeCapsule(.02, .07, hair, 7);
        moustache.position.set(0, -.062, .225);
        moustache.rotation.z = Math.PI / 2;
        head.add(moustache);
        smile.position.set(0, -.112, .235);
    }

    /* ---- hair: full cap + fringe, then the style ---- */
    const hairCap = makeSphere(.268, hair, 20, 14);
    hairCap.scale.set(.97, .82, .99);
    hairCap.position.set(0, .095, -.028);
    const fringe = makeSphere(.252, hair, 16, 11);
    fringe.scale.set(.95, .46, .88);
    fringe.position.set(0, .215, .005);
    const style = options.hairStyle;
    if (!options.headscarf) head.add(hairCap, fringe);
    if (options.headscarf) {
        const scarfMaterial = standardMaterial(options.headscarf, .9);
        const scarfCap = makeSphere(.285, scarfMaterial, 20, 14);
        scarfCap.scale.set(1, .9, 1);
        scarfCap.position.set(0, .075, -.02);
        const scarfDrape = makeCapsule(.19, .3, scarfMaterial, 12);
        scarfDrape.scale.set(1.08, 1, .48);
        scarfDrape.position.set(0, -.2, -.17);
        head.add(scarfCap, scarfDrape);
    }
    else if (style === 'bun') {
        const nape = makeSphere(.17, hair, 12, 9);
        nape.scale.set(.92, .7, .8);
        nape.position.set(0, -.03, -.185);
        const bun = makeSphere(.13, hair, 12, 9);
        bun.position.set(0, .275, -.21);
        head.add(nape, bun);
    }
    else if (style === 'curls') {
        for (const [x, y, z, r] of [
            [-.19, .17, -.06, .1], [.19, .17, -.06, .1],
            [-.225, .02, -.075, .092], [.225, .02, -.075, .092],
            [-.11, .275, -.05, .095], [.11, .275, -.05, .095],
            [0, .3, -.09, .1], [-.19, -.1, -.12, .08], [.19, -.1, -.12, .08],
        ]) {
            const curl = makeSphere(r, hair, 10, 8);
            curl.position.set(x, y, z);
            head.add(curl);
        }
    }
    else if (style === 'waves') {
        const back = makeSphere(.2, hair, 12, 9);
        back.scale.set(1, .95, .62);
        back.position.set(0, -.05, -.155);
        head.add(back);
        for (const side of [-1, 1]) {
            const wave = makeCapsule(.075, .3, hair, 10);
            wave.position.set(side * .215, -.075, -.055);
            wave.rotation.z = -side * .12;
            head.add(wave);
        }
    }
    else if (style === 'bob') {
        const shell = makeSphere(.262, hair, 18, 13);
        shell.scale.set(1, .96, .98);
        shell.position.set(0, .03, -.05);
        head.add(shell);
        for (const side of [-1, 1]) {
            const panel = makeCapsule(.075, .17, hair, 9);
            panel.position.set(side * .205, -.065, .01);
            head.add(panel);
        }
    }
    else if (style === 'locs') {
        for (let i = 0; i < 11; i += 1) {
            const angle = (-.62 + (i / 10) * 1.24) * Math.PI + Math.PI; /* back arc */
            const anchorX = Math.sin(angle) * .21;
            const anchorZ = Math.cos(angle) * .21;
            const length = .17 + ((i * 37) % 10) / 10 * .1;
            const loc = makeCapsule(.027, length, hair, 6);
            loc.position.set(anchorX, .02 - length / 2 + .06, anchorZ - .015);
            loc.rotation.z = -anchorX * .5;
            loc.rotation.x = anchorZ * .4;
            head.add(loc);
        }
        for (const [x, y, z] of [[-.12, .26, .05], [.12, .26, .05], [0, .29, -.06], [-.18, .2, -.1], [.18, .2, -.1]]) {
            const knot = makeSphere(.062, hair, 8, 6);
            knot.position.set(x, y, z);
            head.add(knot);
        }
    }
    else { /* crop — a neat nape so the back of the head reads groomed */
        const nape = makeSphere(.185, hair, 12, 9);
        nape.scale.set(.9, .58, .72);
        nape.position.set(0, -.015, -.16);
        head.add(nape);
    }
    if (options.glasses) {
        const glassesMaterial = standardMaterial(0x4b5f67, .42, .42);
        for (const side of [-1, 1]) {
            const lens = new THREE.Mesh(new THREE.TorusGeometry(.078, .011, 6, 18), glassesMaterial);
            lens.scale.y = .8;
            lens.position.set(side * .096, .03, .238);
            head.add(lens);
        }
        const bridge = makeBox(.06, .016, .014, glassesMaterial, .006);
        bridge.position.set(0, .035, .248);
        head.add(bridge);
    }

    /* ---- limbs (lower leg stays at children[1] for the seat blends) ---- */
    const leftArm = new THREE.Group();
    const rightArm = new THREE.Group();
    const leftLeg = new THREE.Group();
    const rightLeg = new THREE.Group();
    function addArm(target, side) {
        const shoulderCap = makeSphere(.135, outerwear, 12, 9);
        shoulderCap.scale.set(1, .9, .82);
        shoulderCap.position.set(-side * .025, .015, 0);
        target.add(shoulderCap);
        if (shortSleeves) {
            const sleeve = makeCapsule(.1, .16, outerwear, 10);
            sleeve.position.y = -.13;
            const arm = makeCapsule(.068, .31, skin, 10);
            arm.position.y = -.4;
            target.add(sleeve, arm);
        } else {
            const sleeve = makeCapsule(.096, .42, outerwear, 10);
            sleeve.position.y = -.26;
            const cuff = new THREE.Mesh(new THREE.TorusGeometry(.082, .02, 7, 16), outerwear);
            cuff.position.y = -.5;
            cuff.rotation.x = Math.PI / 2;
            target.add(sleeve, cuff);
        }
        const hand = makeSphere(.083, skin, 10, 8);
        hand.scale.set(.88, 1.12, .72);
        hand.position.y = -.62;
        target.add(hand);
        target.position.x = side * .47;
    }
    function addLeg(target, side) {
        const isProsthetic = options.prosthetic === (side < 0 ? 'left' : 'right');
        const upper = new THREE.Group();
        const hip = makeSphere(.135, trousers, 12, 9);
        hip.scale.set(1, .9, .9);
        hip.position.y = -.02;
        const thigh = makeCapsule(.125, .34, trousers, 11);
        thigh.position.y = -.3;
        thigh.scale.set(1, 1, .92);
        upper.add(hip, thigh);
        /* below-knee unit — children[1]; bends at the knee, shoe rides along */
        const lower = new THREE.Group();
        lower.position.y = -.55;
        const knee = makeSphere(.104, trousers, 11, 8);
        const shin = makeCapsule(isProsthetic ? .058 : .088, .27, isProsthetic ? prostheticMat : trousers, 10);
        shin.position.y = -.2;
        const shoe = makeBox(.2, .13, .35, shoes, .045);
        shoe.position.set(0, -.42, .075);
        const sole = makeBox(.21, .048, .37, standardMaterial(0x202d33, .78), .016);
        sole.position.set(0, -.487, .08);
        lower.add(knee, shin, shoe, sole);
        target.add(upper, lower);
        target.position.x = side * .2;
    }
    addArm(leftArm, -1); addArm(rightArm, 1);
    addLeg(leftLeg, -1); addLeg(rightLeg, 1);

    const seated = Boolean(options.seated);
    if (seated) {
        torso.position.y = 1.2; head.position.y = 2.02;
        leftArm.position.y = rightArm.position.y = 1.52;
        leftArm.rotation.x = rightArm.rotation.x = -.25;
        leftArm.rotation.z = .1; rightArm.rotation.z = -.1;
        leftLeg.position.y = rightLeg.position.y = .72;
        leftLeg.rotation.x = rightLeg.rotation.x = -1.16;
        leftLeg.children[1].rotation.x = rightLeg.children[1].rotation.x = .78;
    } else {
        torso.position.y = 1.78; head.position.y = 2.64;
        leftArm.position.y = rightArm.position.y = 2.05;
        leftLeg.position.y = rightLeg.position.y = 1.02;
    }
    root.add(torso, head, leftArm, rightArm, leftLeg, rightLeg);

    const animate = (phase, intensity = 1) => {
        if (seated) {
            /* hands rest; the body breathes and looks around — no rowing */
            const sway = Math.sin(phase * .6);
            leftArm.rotation.x = -.32 + sway * .05 * intensity;
            rightArm.rotation.x = -.32 - sway * .04 * intensity;
            torso.rotation.z = Math.sin(phase * .36) * .022 * intensity;
            torso.position.y = 1.2 + Math.sin(phase * .9) * .008 * intensity;
            head.rotation.y = Math.sin(phase * .22) * .14 * intensity;
            head.rotation.z = Math.sin(phase * .31) * .02 * intensity;
            return;
        }
        const stride = Math.sin(phase);
        const leftStepLift = Math.max(0, Math.sin(phase)) * .06 * intensity;
        const rightStepLift = Math.max(0, -Math.sin(phase)) * .06 * intensity;
        const lift = Math.max(0, Math.sin(phase * 2)) * .055 * intensity;
        leftLeg.rotation.x = stride * .56 * intensity;
        rightLeg.rotation.x = -stride * .56 * intensity;
        /* the swinging leg folds at the knee */
        leftLeg.children[1].rotation.x = Math.max(0, Math.sin(phase)) * .55 * intensity;
        rightLeg.children[1].rotation.x = Math.max(0, -Math.sin(phase)) * .55 * intensity;
        leftLeg.position.y = 1.02 + leftStepLift;
        rightLeg.position.y = 1.02 + rightStepLift;
        leftArm.rotation.x = -stride * .46 * intensity;
        rightArm.rotation.x = stride * .46 * intensity;
        leftArm.rotation.z = .035 + Math.sin(phase * .5) * .022 * intensity;
        rightArm.rotation.z = -.035 - Math.sin(phase * .5) * .022 * intensity;
        torso.position.y = 1.78 + lift;
        torso.rotation.y = stride * .04 * intensity;
        torso.rotation.z = Math.sin(phase * .5) * .02 * intensity;
        head.position.y = 2.64 + lift * .65;
        head.rotation.y = Math.sin(phase * .35) * .12 * intensity;
        head.rotation.z = Math.sin(phase * .52) * .02 * intensity;
    };
    return { root, leftArm, rightArm, leftLeg, rightLeg, head, torso, baseY: 0, seated, animate };
}

/* The cast lineup, by name — pass overrides on top when a scene
   needs a variation (seated, scale, sleeves). */
export const CAST = {
    /* the BookIt carer: sage polo, slate trousers, locs, lanyard badge */
    carer: { skin: 0x8a553d, shirt: 0x9cbcab, trousers: 0x33504f, hair: 0x1f1a18, hairStyle: 'locs', badge: true, sleeves: 'short', shoes: 0xf2efe8 },
    /* silver-haired senior in the mustard cardigan */
    ruth: { skin: 0xd8a67f, shirt: 0xf1e8d4, jacket: 0xd6a544, trousers: 0xb5a58c, hair: 0xc9c2b8, hairStyle: 'bob', shoes: 0x8a6a4f },
    /* bearded man, teal sweater */
    marcus: { skin: 0xd8a67f, shirt: 0x4d7a74, trousers: 0x2e3b3d, hair: 0x5b4632, hairStyle: 'crop', beard: true, shoes: 0x6b4f38 },
    /* red-haired woman, mustard top */
    sophie: { skin: 0xe8b48f, shirt: 0xd6a544, trousers: 0x2e3b3d, hair: 0xa4522e, hairStyle: 'waves', shoes: 0xc98a5a },
    /* dark bob, sage coat */
    priya: { skin: 0x8a5a40, shirt: 0xf1e8d4, jacket: 0x9cbcab, trousers: 0x7d5f43, hair: 0x2a2320, hairStyle: 'bob', shoes: 0xe8e2d6 },
    /* young man, sage polo and badge */
    eli: { skin: 0x6d4636, shirt: 0x9cbcab, trousers: 0x33504f, hair: 0x1c1c1c, hairStyle: 'crop', badge: true, sleeves: 'short', shoes: 0xf2efe8 },
};
