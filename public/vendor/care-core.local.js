import * as THREE from "./three.module.min.js";
import { createNavigationRoute } from "./care-nav.js";
const SERVICES = [
    {
        id: "all",
        title: "All support services",
        shortTitle: "All supports",
        subtitle: "Six NDIS registration groups, one team",
        code: "Service overview",
        accent: "#2d847d",
        accentHex: 0x2d847d,
        moments: ["Choose a service", "Follow the support", "Watch each trail fade"],
    },
    {
        id: "employment",
        title: "Employment support",
        shortTitle: "Employment",
        subtitle: "Find & keep a job — 0102",
        code: "0102",
        accent: "#d6a247",
        accentHex: 0xd6a247,
        moments: ["Explore roles", "Build a résumé", "Practise for work"],
    },
    {
        id: "personal-care",
        title: "Personal care",
        shortTitle: "Personal care",
        subtitle: "Daily personal activities — 0107",
        code: "0107",
        accent: "#d47e6c",
        accentHex: 0xd47e6c,
        moments: ["Choose the routine", "Prepare with dignity", "Leave feeling ready"],
    },
    {
        id: "travel-transport",
        title: "Travel & transport",
        shortTitle: "Transport",
        subtitle: "Get where you’re going — 0108",
        code: "0108",
        accent: "#6f91c2",
        accentHex: 0x6f91c2,
        moments: ["Vehicle arrives", "Ramp lowers", "Travel safely"],
    },
    {
        id: "shared-living",
        title: "Daily tasks & shared living",
        shortTitle: "Shared living",
        subtitle: "Life skills at home — 0115/0138",
        code: "0115 / 0138",
        accent: "#7fa78d",
        accentHex: 0x7fa78d,
        moments: ["Plan together", "Cook a meal", "Sit down & eat"],
    },
    {
        id: "household",
        title: "Household tasks",
        shortTitle: "Household",
        subtitle: "Cleaning, laundry, meals — 0120",
        code: "0120",
        accent: "#806f98",
        accentHex: 0x806f98,
        moments: ["Tidy in passes", "Run the laundry", "Fold and organise"],
    },
    {
        id: "community",
        title: "Community participation",
        shortTitle: "Community",
        subtitle: "Social & recreation — 0125",
        code: "0125",
        accent: "#b98568",
        accentHex: 0xb98568,
        moments: ["Arrive together", "Create & play", "Rest & connect"],
    },
];
const SERVICE_ALIASES = {
    all: "all",
    overview: "all",
    employment: "employment",
    job: "employment",
    "personal-care": "personal-care",
    personal: "personal-care",
    care: "personal-care",
    transport: "travel-transport",
    travel: "travel-transport",
    "travel-transport": "travel-transport",
    "shared-living": "shared-living",
    "daily-tasks": "shared-living",
    household: "household",
    cleaning: "household",
    community: "community",
    participation: "community",
};
const PERSONAS = [
    {
        id: "manual-chair",
        names: "Amara & Eli",
        eyebrow: "Moving together",
        description: "Amara chooses the route and self-propels her chair while support worker Eli keeps pace beside her.",
        accent: "#d6a247",
    },
    {
        id: "white-cane",
        names: "Daniel & Tahlia",
        eyebrow: "At their own pace",
        description: "Daniel travels with his white cane while Tahlia walks alongside, leaving space for each natural cane sweep.",
        accent: "#6f91c2",
    },
    {
        id: "crutches",
        names: "Noor & Grace",
        eyebrow: "A shared journey",
        description: "Noor moves confidently with forearm crutches, with Grace beside her and clear of the crutch path.",
        accent: "#806f98",
    },
    {
        id: "power-chair-dog",
        names: "Kenji, Rosa & Milo",
        eyebrow: "Community time",
        description: "Kenji leads in his power chair while Rosa walks Milo on the outside of the curve.",
        accent: "#2d847d",
    },
    {
        id: "prosthetic",
        names: "Luca & Aisha",
        eyebrow: "Life keeps moving",
        description: "Luca and Aisha follow a wide crescent path together, chatting as they go.",
        accent: "#d47e6c",
    },
    {
        id: "garden-care",
        names: "Maya",
        eyebrow: "Care for every space",
        description: "Maya waters each raised garden, tidies the grass edging, then carries her tools out through the gate.",
        accent: "#7fa78d",
    },
    {
        id: "lawn-care",
        names: "Sam",
        eyebrow: "A welcoming home",
        description: "Sam mows the lawn in neat passes, leaves through the gate, and the grass slowly grows back for the next visit.",
        accent: "#d6a247",
    },
    {
        id: "dog-walk",
        names: "Priya & Alfie",
        eyebrow: "A little fresh air",
        description: "Priya and Alfie take a curved walk through the garden, leaving footprints and paw prints behind them.",
        accent: "#b98568",
    },
];
const VIEW_LABELS = {
    isometric: "Isometric",
    "three-quarter": "Three-quarter",
    "ground-level": "Ground level",
};
const CYCLE_SECONDS = 80;
const GARDEN_START = 3;
const GARDEN_DURATION = 34;
const LAWN_START = 32;
const LAWN_DURATION = 35;
const GARDEN_BEDS = [
    new THREE.Vector3(-15.7, 0.42, 10.5),
    new THREE.Vector3(-11.2, 0.42, 11.2),
];
const UP = new THREE.Vector3(0, 1, 0);
function standardMaterial(color, roughness = 0.78, metalness = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}
function makeCapsule(radius, length, material, radialSegments = 12) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, radialSegments), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
function makeSphere(radius, material, widthSegments = 18, heightSegments = 12) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, widthSegments, heightSegments), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
function makeBox(width, height, depth, material, radius = 0.05) {
    const geometry = new THREE.BoxGeometry(width, height, depth, 2, 2, 2);
    const position = geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index);
        const y = position.getY(index);
        const z = position.getZ(index);
        const length = Math.hypot(x, y, z) || 1;
        const soften = Math.min(radius, 0.045);
        position.setXYZ(index, x - (x / length) * soften, y - (y / length) * soften, z - (z / length) * soften);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
function cylinderBetween(start, end, radius, material, radialSegments = 10) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
}
/* v66 — rebuilt to the approved "polished stylised 3D" concept: realistic
   proportions, warm expressive faces, mitten hands, knee-jointed legs and
   fuller hair. The skeleton contract is unchanged — same pivots, group
   names and leg children[1] (below-knee unit, bends +.78 seated) — so
   applySeatBlend, held props and every scene pose keep working. */
function createHuman(options) {
    const root = new THREE.Group();
    root.scale.setScalar(options.scale ?? 0.78);
    const skin = standardMaterial(options.skin, 0.72);
    const shirt = standardMaterial(options.shirt, 0.84);
    const trousers = standardMaterial(options.trousers, 0.88);
    const hair = standardMaterial(options.hair, 0.9);
    const shoes = standardMaterial(options.shoes ?? 0x283844, 0.72);
    const jacket = options.jacket ? standardMaterial(options.jacket, 0.86) : null;
    const eye = standardMaterial(0x241d1a, 0.5);
    const white = standardMaterial(0xfffdf6, 0.4);
    const lip = standardMaterial(0x8e5147, 0.78);
    const blushMat = standardMaterial(0xd8907e, 0.95);
    const prosthetic = standardMaterial(0x75838d, 0.42, 0.42);
    const outerwear = jacket ?? shirt;
    /* badge wearers are the uniformed team — they get the polo look */
    const shortSleeves = options.shortSleeves ?? (Boolean(options.badge) && !jacket);
    /* ---- torso: shoulders, tapered chest, hips ---- */
    const torso = new THREE.Group();
    const chest = makeCapsule(0.31, 0.5, shirt, 16);
    chest.position.y = 0.04;
    chest.scale.set(1.04, 1, 0.76);
    const shoulderBar = makeCapsule(0.15, 0.37, outerwear, 12);
    shoulderBar.rotation.z = Math.PI / 2;
    shoulderBar.position.y = 0.34;
    shoulderBar.scale.set(1, 1, 0.82);
    const hips = makeCapsule(0.275, 0.14, trousers, 14);
    hips.position.y = -0.5;
    hips.scale.set(1.08, 1, 0.8);
    const waistband = makeBox(0.6, 0.09, 0.45, trousers, 0.025);
    waistband.position.y = -0.36;
    torso.add(chest, shoulderBar, hips, waistband);
    if (jacket) {
        /* an open cardigan: two soft front panels over the shirt */
        for (const side of [-1, 1]) {
            const panel = makeBox(0.26, 0.62, 0.1, jacket, 0.05);
            panel.position.set(side * 0.17, 0.02, 0.19);
            panel.rotation.y = side * 0.06;
            torso.add(panel);
        }
        const backPanel = makeBox(0.56, 0.64, 0.1, jacket, 0.05);
        backPanel.position.set(0, 0.03, -0.17);
        torso.add(backPanel);
    }
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.028, 8, 20, Math.PI * 1.5), outerwear);
    collar.position.set(0, 0.43, 0.1);
    collar.rotation.set(Math.PI / 2, 0, Math.PI * 0.75);
    torso.add(collar);
    const shirtPocket = makeBox(0.15, 0.13, 0.022, outerwear, 0.014);
    shirtPocket.position.set(0.17, 0.1, 0.243);
    torso.add(shirtPocket);
    if (options.badge) {
        const lanyardMaterial = standardMaterial(0x486c71, 0.72);
        const leftLanyard = cylinderBetween(new THREE.Vector3(-0.09, 0.38, 0.2), new THREE.Vector3(0, 0.05, 0.25), 0.012, lanyardMaterial, 6);
        const rightLanyard = cylinderBetween(new THREE.Vector3(0.09, 0.38, 0.2), new THREE.Vector3(0, 0.05, 0.25), 0.012, lanyardMaterial, 6);
        const badge = makeBox(0.18, 0.23, 0.03, white, 0.02);
        badge.position.set(0, -0.07, 0.265);
        const badgeStripe = makeBox(0.13, 0.03, 0.012, standardMaterial(0x2d847d, 0.72), 0.008);
        badgeStripe.position.set(0, 0.07, 0.019);
        badge.add(badgeStripe);
        torso.add(leftLanyard, rightLanyard, badge);
    }
    /* ---- head: a real face ---- */
    const head = new THREE.Group();
    const face = makeSphere(0.26, skin, 24, 17);
    face.scale.set(0.94, 1.06, 0.92);
    head.add(face);
    const neck = makeCapsule(0.078, 0.12, skin, 10);
    neck.position.set(0, -0.28, -0.01);
    head.add(neck);
    for (const side of [-1, 1]) {
        const ear = makeSphere(0.053, skin, 10, 8);
        ear.scale.set(0.55, 0.95, 0.55);
        ear.position.set(side * 0.243, -0.01, 0.01);
        head.add(ear);
        const eyeMesh = makeSphere(0.043, eye, 10, 8);
        eyeMesh.scale.set(1, 1.22, 0.5);
        eyeMesh.position.set(side * 0.094, 0.028, 0.218);
        head.add(eyeMesh);
        const catchlight = makeSphere(0.0135, white, 6, 5);
        catchlight.position.set(side * 0.082, 0.052, 0.243);
        head.add(catchlight);
        const eyebrow = makeCapsule(0.0145, 0.062, hair, 7);
        eyebrow.position.set(side * 0.096, 0.118, 0.222);
        eyebrow.rotation.z = Math.PI / 2 + side * 0.16;
        head.add(eyebrow);
        const blush = makeSphere(0.036, blushMat, 8, 6);
        blush.scale.set(1.3, 0.55, 0.38);
        blush.position.set(side * 0.148, -0.072, 0.193);
        head.add(blush);
    }
    const nose = makeSphere(0.032, skin, 10, 8);
    nose.scale.set(0.82, 1.18, 0.9);
    nose.position.set(0, -0.028, 0.243);
    head.add(nose);
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.0125, 7, 18, 2.5), lip);
    smile.position.set(0, -0.098, 0.222);
    smile.rotation.z = Math.PI + (Math.PI - 2.5) / 2;
    smile.scale.set(1, 0.82, 0.5);
    head.add(smile);
    if (options.glasses) {
        const glassesMaterial = standardMaterial(0x4b5f67, 0.42, 0.42);
        for (const side of [-1, 1]) {
            const lens = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.011, 6, 18), glassesMaterial);
            lens.scale.y = 0.8;
            lens.position.set(side * 0.096, 0.03, 0.238);
            head.add(lens);
        }
        const bridge = makeBox(0.06, 0.016, 0.014, glassesMaterial, 0.006);
        bridge.position.set(0, 0.035, 0.248);
        head.add(bridge);
    }
    /* ---- hair: full cap + fringe, then the style ---- */
    const hairCap = makeSphere(0.268, hair, 20, 14);
    hairCap.scale.set(0.97, 0.82, 0.99);
    hairCap.position.set(0, 0.095, -0.028);
    const fringe = makeSphere(0.252, hair, 16, 11);
    fringe.scale.set(0.95, 0.46, 0.88);
    fringe.position.set(0, 0.215, 0.005);
    if (!options.headscarf) head.add(hairCap, fringe);
    if (options.headscarf) {
        const scarfMaterial = standardMaterial(options.headscarf, 0.9);
        const scarfCap = makeSphere(0.285, scarfMaterial, 20, 14);
        scarfCap.scale.set(1, 0.9, 1);
        scarfCap.position.set(0, 0.075, -0.02);
        const scarfDrape = makeCapsule(0.19, 0.3, scarfMaterial, 12);
        scarfDrape.scale.set(1.08, 1, 0.48);
        scarfDrape.position.set(0, -0.2, -0.17);
        head.add(scarfCap, scarfDrape);
    }
    else if (options.hairStyle === "bun") {
        const nape = makeSphere(0.17, hair, 12, 9);
        nape.scale.set(0.92, 0.7, 0.8);
        nape.position.set(0, -0.03, -0.185);
        const bun = makeSphere(0.13, hair, 12, 9);
        bun.position.set(0, 0.275, -0.21);
        head.add(nape, bun);
    }
    else if (options.hairStyle === "curls") {
        for (const [x, y, z, scale] of [
            [-0.19, 0.17, -0.06, 0.1],
            [0.19, 0.17, -0.06, 0.1],
            [-0.225, 0.02, -0.075, 0.092],
            [0.225, 0.02, -0.075, 0.092],
            [-0.11, 0.275, -0.05, 0.095],
            [0.11, 0.275, -0.05, 0.095],
            [0, 0.3, -0.09, 0.1],
            [-0.19, -0.1, -0.12, 0.08],
            [0.19, -0.1, -0.12, 0.08],
        ]) {
            const curl = makeSphere(scale, hair, 10, 8);
            curl.position.set(x, y, z);
            head.add(curl);
        }
    }
    else if (options.hairStyle === "waves") {
        const back = makeSphere(0.2, hair, 12, 9);
        back.scale.set(1, 0.95, 0.62);
        back.position.set(0, -0.05, -0.155);
        head.add(back);
        for (const side of [-1, 1]) {
            const wave = makeCapsule(0.075, 0.3, hair, 10);
            wave.position.set(side * 0.215, -0.075, -0.055);
            wave.rotation.z = -side * 0.12;
            head.add(wave);
        }
    }
    else {
        const nape = makeSphere(0.185, hair, 12, 9);
        nape.scale.set(0.9, 0.58, 0.72);
        nape.position.set(0, -0.015, -0.16);
        head.add(nape);
    }
    /* ---- limbs ---- */
    const leftArm = new THREE.Group();
    const rightArm = new THREE.Group();
    const leftLeg = new THREE.Group();
    const rightLeg = new THREE.Group();
    function addArm(target, side) {
        const shoulderCap = makeSphere(0.135, outerwear, 12, 9);
        shoulderCap.scale.set(1, 0.9, 0.82);
        shoulderCap.position.set(-side * 0.025, 0.015, 0);
        target.add(shoulderCap);
        if (shortSleeves) {
            const sleeve = makeCapsule(0.1, 0.16, outerwear, 10);
            sleeve.position.y = -0.13;
            const arm = makeCapsule(0.068, 0.31, skin, 10);
            arm.position.y = -0.4;
            target.add(sleeve, arm);
        }
        else {
            const sleeve = makeCapsule(0.096, 0.42, outerwear, 10);
            sleeve.position.y = -0.26;
            const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.082, 0.02, 7, 16), outerwear);
            cuff.position.y = -0.5;
            cuff.rotation.x = Math.PI / 2;
            target.add(sleeve, cuff);
        }
        const hand = makeSphere(0.083, skin, 10, 8);
        hand.scale.set(0.88, 1.12, 0.72);
        hand.position.y = -0.62;
        target.add(hand);
        target.position.x = side * 0.47;
    }
    function addLeg(target, side) {
        const isProsthetic = options.prosthetic === (side < 0 ? "left" : "right");
        const upper = new THREE.Group();
        const hip = makeSphere(0.135, trousers, 12, 9);
        hip.scale.set(1, 0.9, 0.9);
        hip.position.y = -0.02;
        const thigh = makeCapsule(0.125, 0.34, trousers, 11);
        thigh.position.y = -0.3;
        thigh.scale.set(1, 1, 0.92);
        upper.add(hip, thigh);
        /* below-knee unit — children[1]; bends at the knee, shoe rides along */
        const lower = new THREE.Group();
        lower.position.y = -0.55;
        const knee = makeSphere(0.104, trousers, 11, 8);
        const shin = makeCapsule(isProsthetic ? 0.058 : 0.088, 0.27, isProsthetic ? prosthetic : trousers, 10);
        shin.position.y = -0.2;
        const shoe = makeBox(0.2, 0.13, 0.35, shoes, 0.045);
        shoe.position.set(0, -0.42, 0.075);
        const sole = makeBox(0.21, 0.048, 0.37, standardMaterial(0x202d33, 0.78), 0.016);
        sole.position.set(0, -0.487, 0.08);
        lower.add(knee, shin, shoe, sole);
        target.add(upper, lower);
        target.position.x = side * 0.2;
    }
    addArm(leftArm, -1);
    addArm(rightArm, 1);
    addLeg(leftLeg, -1);
    addLeg(rightLeg, 1);
    const seated = Boolean(options.seated);
    const baseY = 0;
    if (seated) {
        torso.position.y = 1.2;
        head.position.y = 2.02;
        leftArm.position.y = 1.52;
        rightArm.position.y = 1.52;
        leftArm.rotation.x = -0.25;
        rightArm.rotation.x = -0.25;
        leftArm.rotation.z = 0.1;
        rightArm.rotation.z = -0.1;
        leftLeg.position.y = 0.72;
        rightLeg.position.y = 0.72;
        leftLeg.rotation.x = -1.16;
        rightLeg.rotation.x = -1.16;
        leftLeg.children[1].rotation.x = 0.78;
        rightLeg.children[1].rotation.x = 0.78;
    }
    else {
        torso.position.y = 1.78;
        head.position.y = 2.64;
        leftArm.position.y = 2.05;
        rightArm.position.y = 2.05;
        leftLeg.position.y = 1.02;
        rightLeg.position.y = 1.02;
    }
    root.add(torso, head, leftArm, rightArm, leftLeg, rightLeg);
    const animate = (phase, intensity = 1) => {
        if (seated) {
            /* hands rest; the body breathes and looks around — no rowing */
            const sway = Math.sin(phase * 0.6);
            leftArm.rotation.x = -0.32 + sway * 0.05 * intensity;
            rightArm.rotation.x = -0.32 - sway * 0.04 * intensity;
            torso.rotation.z = Math.sin(phase * 0.36) * 0.022 * intensity;
            torso.position.y = 1.2 + Math.sin(phase * 0.9) * 0.008 * intensity;
            head.rotation.y = Math.sin(phase * 0.22) * 0.14 * intensity;
            head.rotation.z = Math.sin(phase * 0.31) * 0.02 * intensity;
            return;
        }
        const stride = Math.sin(phase);
        const leftStepLift = Math.max(0, Math.sin(phase)) * 0.06 * intensity;
        const rightStepLift = Math.max(0, -Math.sin(phase)) * 0.06 * intensity;
        const lift = Math.max(0, Math.sin(phase * 2)) * 0.055 * intensity;
        leftLeg.rotation.x = stride * 0.56 * intensity;
        rightLeg.rotation.x = -stride * 0.56 * intensity;
        /* the swinging leg folds at the knee */
        leftLeg.children[1].rotation.x = Math.max(0, Math.sin(phase)) * 0.55 * intensity;
        rightLeg.children[1].rotation.x = Math.max(0, -Math.sin(phase)) * 0.55 * intensity;
        leftLeg.position.y = 1.02 + leftStepLift;
        rightLeg.position.y = 1.02 + rightStepLift;
        leftArm.rotation.x = -stride * 0.46 * intensity;
        rightArm.rotation.x = stride * 0.46 * intensity;
        leftArm.rotation.z = 0.035 + Math.sin(phase * 0.5) * 0.022 * intensity;
        rightArm.rotation.z = -0.035 - Math.sin(phase * 0.5) * 0.022 * intensity;
        torso.position.y = 1.78 + lift;
        torso.rotation.y = stride * 0.04 * intensity;
        torso.rotation.z = Math.sin(phase * 0.5) * 0.02 * intensity;
        head.position.y = 2.64 + lift * 0.65;
        head.rotation.y = Math.sin(phase * 0.35) * 0.12 * intensity;
        head.rotation.z = Math.sin(phase * 0.52) * 0.02 * intensity;
    };
    return {
        root,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        head,
        torso,
        baseY,
        seated,
        animate,
    };
}
function applySeatBlend(person, amount) {
    const a = amount;
    person.torso.position.y = THREE.MathUtils.lerp(1.78, 1.2, a);
    person.head.position.y = THREE.MathUtils.lerp(2.64, 2.02, a);
    person.leftArm.position.y = THREE.MathUtils.lerp(2.05, 1.52, a);
    person.rightArm.position.y = THREE.MathUtils.lerp(2.05, 1.52, a);
    person.leftLeg.position.y = THREE.MathUtils.lerp(1.02, 0.72, a);
    person.rightLeg.position.y = THREE.MathUtils.lerp(1.02, 0.72, a);
    person.leftLeg.rotation.x = THREE.MathUtils.lerp(person.leftLeg.rotation.x, -1.16, a);
    person.rightLeg.rotation.x = THREE.MathUtils.lerp(person.rightLeg.rotation.x, -1.16, a);
    person.leftLeg.children[1].rotation.x = 0.78 * a;
    person.rightLeg.children[1].rotation.x = 0.78 * a;
}
function createContactShadow(width = 1.5, depth = 1.1, opacity = 0.11) {
    const material = new THREE.MeshBasicMaterial({
        color: 0x284941,
        transparent: true,
        opacity,
        depthWrite: false,
    });
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.7, 28), material);
    shadow.scale.set(width, depth, 1);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.009;
    shadow.renderOrder = 1;
    return shadow;
}
function createWheel(radius, manual) {
    const group = new THREE.Group();
    const rubber = standardMaterial(0x27343a, 0.74);
    const metal = standardMaterial(0xa6b1b4, 0.34, 0.52);
    const accent = standardMaterial(manual ? 0xd6a247 : 0x2d847d, 0.58, 0.08);
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(radius, manual ? 0.052 : 0.09, 10, 34), rubber);
    tyre.rotation.y = Math.PI / 2;
    tyre.castShadow = true;
    group.add(tyre);
    if (manual) {
        const handRim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.83, 0.022, 8, 32), metal);
        handRim.rotation.y = Math.PI / 2;
        group.add(handRim);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.12, 14), accent);
    hub.rotation.z = Math.PI / 2;
    group.add(hub);
    const spokeMaterial = manual ? metal : accent;
    for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        const end = new THREE.Vector3(0, Math.sin(angle) * radius * 0.78, Math.cos(angle) * radius * 0.78);
        group.add(cylinderBetween(new THREE.Vector3(), end, 0.012, spokeMaterial, 6));
    }
    return group;
}
function createWheelchair(power, person) {
    const root = new THREE.Group();
    const frame = standardMaterial(power ? 0x354149 : 0x5b7075, 0.38, 0.42);
    const cushion = standardMaterial(power ? 0x365b61 : 0xd6a247, 0.9);
    const dark = standardMaterial(0x26363c, 0.76);
    const radius = power ? 0.46 : 0.68;
    const wheelX = power ? 0.68 : 0.74;
    const wheelY = radius + 0.04;
    const leftWheel = createWheel(radius, !power);
    const rightWheel = createWheel(radius, !power);
    leftWheel.position.set(-wheelX, wheelY, -0.06);
    rightWheel.position.set(wheelX, wheelY, -0.06);
    root.add(leftWheel, rightWheel);
    const seat = makeBox(1.02, 0.17, 0.84, cushion, 0.08);
    seat.position.set(0, power ? 0.82 : 0.86, 0.02);
    const back = makeBox(0.94, power ? 1.02 : 0.86, 0.17, cushion, 0.08);
    back.position.set(0, power ? 1.28 : 1.25, -0.34);
    back.rotation.x = -0.08;
    root.add(seat, back);
    const leftRail = cylinderBetween(new THREE.Vector3(-0.56, 0.52, -0.34), new THREE.Vector3(-0.56, 1.34, -0.34), 0.035, frame);
    const rightRail = leftRail.clone();
    rightRail.position.x *= -1;
    root.add(leftRail, rightRail);
    for (const side of [-1, 1]) {
        const arm = makeBox(0.13, 0.11, 0.72, dark, 0.035);
        arm.position.set(side * 0.59, 1.22, 0.02);
        root.add(arm);
        const casterFork = cylinderBetween(new THREE.Vector3(side * 0.48, 0.42, 0.36), new THREE.Vector3(side * 0.48, 0.2, 0.62), 0.032, frame);
        const caster = createWheel(power ? 0.17 : 0.14, false);
        caster.scale.setScalar(0.72);
        caster.position.set(side * 0.48, 0.18, 0.65);
        root.add(casterFork, caster);
    }
    const footPlate = makeBox(0.72, 0.06, 0.42, frame, 0.025);
    footPlate.position.set(0, 0.28, 0.73);
    footPlate.rotation.x = -0.08;
    root.add(footPlate);
    if (power) {
        const base = makeBox(1.28, 0.34, 1.16, frame, 0.1);
        base.position.set(0, 0.39, 0.02);
        root.add(base);
        const headrest = makeBox(0.45, 0.34, 0.13, dark, 0.06);
        headrest.position.set(0, 1.98, -0.38);
        root.add(headrest);
        const joystickStem = cylinderBetween(new THREE.Vector3(0.64, 1.2, 0.17), new THREE.Vector3(0.64, 1.48, 0.35), 0.022, frame);
        const joystick = makeSphere(0.07, standardMaterial(0xd47e6c, 0.62), 12, 8);
        joystick.position.set(0.64, 1.5, 0.36);
        const tablet = makeBox(0.42, 0.3, 0.05, standardMaterial(0x1f3139, 0.4, 0.18), 0.04);
        tablet.position.set(-0.24, 1.53, 0.34);
        tablet.rotation.x = -0.18;
        root.add(joystickStem, joystick, tablet);
    }
    const seatedPerson = createHuman({ ...person, seated: true, scale: 0.69 });
    seatedPerson.root.position.set(0, 0.82, -0.02);
    root.add(seatedPerson.root);
    root.add(createContactShadow(power ? 1.25 : 1.35, 1.22, 0.13));
    return {
        root,
        person: seatedPerson,
        animate(distance, phase) {
            leftWheel.rotation.x = -distance / radius;
            rightWheel.rotation.x = -distance / radius;
            seatedPerson.animate(phase, power ? 0.55 : 1);
        },
    };
}
function createCrutch(color) {
    const root = new THREE.Group();
    const metal = standardMaterial(0xa7b4b8, 0.34, 0.5);
    const grip = standardMaterial(color, 0.82);
    root.add(cylinderBetween(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 1.48, 0), 0.025, metal, 8));
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 7, 20, Math.PI * 1.45), grip);
    cuff.position.set(0, 1.42, 0);
    cuff.rotation.set(Math.PI / 2, 0, 0.78);
    const handle = makeBox(0.28, 0.055, 0.07, grip, 0.02);
    handle.position.set(0.09, 1.1, 0);
    const tip = makeSphere(0.047, standardMaterial(0x2d3840, 0.92), 10, 7);
    tip.scale.set(0.9, 0.55, 0.9);
    tip.position.y = 0.025;
    root.add(cuff, handle, tip);
    return root;
}
function createDog() {
    const root = new THREE.Group();
    root.scale.setScalar(0.78);
    const coat = standardMaterial(0xbc8356, 0.94);
    const lightCoat = standardMaterial(0xd4aa7e, 0.96);
    const nose = standardMaterial(0x27343a, 0.8);
    const harness = standardMaterial(0x2d847d, 0.7);
    const body = makeSphere(0.5, coat, 18, 12);
    body.scale.set(0.82, 0.62, 1.38);
    body.position.y = 0.68;
    const chest = makeSphere(0.33, lightCoat, 16, 10);
    chest.scale.set(0.75, 1.05, 0.58);
    chest.position.set(0, 0.72, 0.45);
    const head = makeSphere(0.31, coat, 16, 11);
    head.position.set(0, 1.02, 0.73);
    const muzzle = makeSphere(0.18, lightCoat, 14, 9);
    muzzle.scale.set(0.85, 0.7, 1.08);
    muzzle.position.set(0, 0.96, 0.99);
    const noseMesh = makeSphere(0.075, nose, 10, 7);
    noseMesh.position.set(0, 1, 1.15);
    root.add(body, chest, head, muzzle, noseMesh);
    for (const side of [-1, 1]) {
        const ear = makeCapsule(0.09, 0.24, coat, 9);
        ear.position.set(side * 0.23, 1.04, 0.67);
        ear.rotation.z = side * 0.28;
        root.add(ear);
        const eye = makeSphere(0.034, nose, 9, 7);
        eye.position.set(side * 0.105, 1.08, 1.01);
        root.add(eye);
    }
    const legs = [];
    for (const [x, z] of [
        [-0.29, -0.37],
        [0.29, -0.37],
        [-0.29, 0.42],
        [0.29, 0.42],
    ]) {
        const leg = new THREE.Group();
        const limb = makeCapsule(0.085, 0.38, coat, 9);
        limb.position.y = -0.28;
        const paw = makeSphere(0.1, lightCoat, 10, 7);
        paw.scale.set(1, 0.55, 1.25);
        paw.position.set(0, -0.51, 0.05);
        leg.add(limb, paw);
        leg.position.set(x, 0.53, z);
        legs.push(leg);
        root.add(leg);
    }
    const harnessBand = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.045, 8, 24), harness);
    harnessBand.scale.set(0.9, 1, 1);
    harnessBand.position.set(0, 0.7, 0.08);
    harnessBand.rotation.x = Math.PI / 2;
    root.add(harnessBand);
    const tail = new THREE.Group();
    tail.position.set(0, 0.82, -0.65);
    const tailMesh = makeCapsule(0.075, 0.5, coat, 9);
    tailMesh.position.y = 0.29;
    tailMesh.rotation.x = -0.56;
    tail.add(tailMesh);
    root.add(tail);
    root.add(createContactShadow(0.78, 0.82, 0.1));
    return {
        root,
        animate(phase) {
            legs[0].rotation.x = Math.sin(phase) * 0.48;
            legs[3].rotation.x = Math.sin(phase) * 0.48;
            legs[1].rotation.x = -Math.sin(phase) * 0.48;
            legs[2].rotation.x = -Math.sin(phase) * 0.48;
            tail.rotation.z = Math.sin(phase * 0.58) * 0.42;
            head.rotation.y = Math.sin(phase * 0.28) * 0.12;
            root.position.y = Math.abs(Math.sin(phase * 2)) * 0.025;
        },
    };
}
function createWateringCan() {
    const root = new THREE.Group();
    const bodyMaterial = standardMaterial(0xd47e6c, 0.72, 0.06);
    const darkMaterial = standardMaterial(0x9f594f, 0.72, 0.04);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.31, 0.46, 16), bodyMaterial);
    body.castShadow = true;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 8, 24, Math.PI * 1.42), darkMaterial);
    handle.position.set(0, 0.23, -0.02);
    handle.rotation.z = Math.PI * 0.79;
    const spout = cylinderBetween(new THREE.Vector3(0.25, 0.02, 0.02), new THREE.Vector3(0.72, 0.22, 0.25), 0.055, bodyMaterial, 10);
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.075, 0.08, 12), darkMaterial);
    rose.position.set(0.75, 0.24, 0.27);
    rose.quaternion.copy(spout.quaternion);
    root.add(body, handle, spout, rose);
    return root;
}
function createGardenShears() {
    const root = new THREE.Group();
    const steel = standardMaterial(0xb6c2c5, 0.34, 0.52);
    const grip = standardMaterial(0xd6a247, 0.78);
    const pivot = makeSphere(0.07, standardMaterial(0x6e777b, 0.42, 0.42), 10, 8);
    const leftHalf = new THREE.Group();
    const rightHalf = new THREE.Group();
    const leftBlade = makeBox(0.09, 0.055, 0.72, steel, 0.02);
    leftBlade.position.z = 0.36;
    const rightBlade = leftBlade.clone();
    const leftHandle = makeCapsule(0.065, 0.42, grip, 9);
    leftHandle.position.z = -0.28;
    leftHandle.rotation.x = Math.PI / 2;
    const rightHandle = leftHandle.clone();
    leftHalf.add(leftBlade, leftHandle);
    rightHalf.add(rightBlade, rightHandle);
    root.add(leftHalf, rightHalf, pivot);
    return {
        root,
        animate(phase) {
            const open = 0.16 + (Math.sin(phase * 2.4) * 0.5 + 0.5) * 0.28;
            leftHalf.rotation.y = open;
            rightHalf.rotation.y = -open;
        },
    };
}
function createLawnMower(workerOptions) {
    const root = new THREE.Group();
    const frame = standardMaterial(0x314a4f, 0.46, 0.24);
    const deckMaterial = standardMaterial(0xd6a247, 0.72, 0.06);
    const engineMaterial = standardMaterial(0x2d847d, 0.62, 0.08);
    const wheelRadius = 0.22;
    const deck = makeBox(1.06, 0.2, 0.82, deckMaterial, 0.08);
    deck.position.set(0, 0.24, 0.1);
    const engine = makeBox(0.58, 0.34, 0.5, engineMaterial, 0.08);
    engine.position.set(0, 0.48, 0.05);
    const cap = makeSphere(0.09, frame, 12, 8);
    cap.scale.set(1, 0.5, 1);
    cap.position.set(0, 0.68, 0.05);
    root.add(deck, engine, cap);
    const wheels = [];
    for (const [x, z] of [
        [-0.53, -0.27],
        [0.53, -0.27],
        [-0.53, 0.38],
        [0.53, 0.38],
    ]) {
        const wheel = createWheel(wheelRadius, false);
        wheel.scale.setScalar(0.84);
        wheel.position.set(x, wheelRadius, z);
        root.add(wheel);
        wheels.push(wheel);
    }
    for (const side of [-1, 1]) {
        root.add(cylinderBetween(new THREE.Vector3(side * 0.42, 0.42, -0.31), new THREE.Vector3(side * 0.31, 1.24, -1.13), 0.034, frame));
    }
    root.add(cylinderBetween(new THREE.Vector3(-0.31, 1.24, -1.13), new THREE.Vector3(0.31, 1.24, -1.13), 0.045, frame));
    const worker = createHuman(workerOptions);
    worker.root.position.set(0, 0, -1.62);
    root.add(worker.root, createContactShadow(1.15, 1.42, 0.1));
    return {
        root,
        worker,
        animate(distance, phase) {
            for (const wheel of wheels)
                wheel.rotation.x = -distance / wheelRadius;
            worker.animate(phase, 0.72);
            worker.leftArm.rotation.x = -0.92 + Math.sin(phase) * 0.08;
            worker.rightArm.rotation.x = -0.92 - Math.sin(phase) * 0.08;
            worker.head.rotation.y = Math.sin(phase * 0.2) * 0.08;
        },
    };
}
function createTrailTexture(kind) {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const context = canvas.getContext("2d");
    if (!context)
        throw new Error("Unable to create trail texture");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#ffffff";
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = "rgba(255,255,255,0.72)";
    context.shadowBlur = 2;
    if (kind === "foot" || kind === "prosthetic") {
        context.beginPath();
        context.moveTo(67, 169);
        context.bezierCurveTo(51, 151, 53, 126, 61, 106);
        context.bezierCurveTo(70, 85, 67, 59, 78, 34);
        context.bezierCurveTo(89, 11, 122, 13, 132, 39);
        context.bezierCurveTo(140, 62, 126, 84, 127, 106);
        context.bezierCurveTo(130, 134, 121, 159, 107, 172);
        context.bezierCurveTo(96, 181, 77, 180, 67, 169);
        context.closePath();
        context.fill();
        context.globalCompositeOperation = "destination-out";
        context.shadowBlur = 0;
        context.lineWidth = kind === "prosthetic" ? 8 : 6;
        for (let y = 46; y <= 146; y += 23) {
            context.beginPath();
            context.moveTo(69, y + 8);
            context.lineTo(126, y - 8);
            context.stroke();
        }
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(94, 29);
        context.lineTo(94, 70);
        context.stroke();
        context.beginPath();
        context.moveTo(99, 119);
        context.lineTo(99, 169);
        context.stroke();
        if (kind === "prosthetic") {
            context.lineWidth = 10;
            context.beginPath();
            context.moveTo(68, 95);
            context.lineTo(125, 95);
            context.stroke();
            context.beginPath();
            context.arc(97, 136, 18, 0, Math.PI * 2);
            context.stroke();
        }
        context.globalCompositeOperation = "source-over";
    }
    else if (kind === "paw") {
        context.beginPath();
        context.ellipse(96, 119, 34, 27, 0, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.ellipse(96, 99, 18, 20, 0, 0, Math.PI * 2);
        context.fill();
        for (const [x, y, rx, ry, rotation] of [
            [56, 77, 13, 18, -0.28],
            [81, 59, 13, 19, -0.09],
            [111, 59, 13, 19, 0.09],
            [136, 77, 13, 18, 0.28],
        ]) {
            context.beginPath();
            context.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
            context.fill();
        }
        context.globalCompositeOperation = "destination-out";
        context.beginPath();
        context.ellipse(96, 116, 11, 8, 0, 0, Math.PI * 2);
        context.fill();
        context.globalCompositeOperation = "source-over";
    }
    else if (kind === "wheel" || kind === "vehicle") {
        const width = kind === "vehicle" ? 48 : 34;
        const left = 96 - width * 0.5;
        context.fillRect(left, 4, width, 184);
        context.globalCompositeOperation = "destination-out";
        context.shadowBlur = 0;
        context.lineWidth = kind === "vehicle" ? 8 : 7;
        for (let y = -5; y < 200; y += kind === "vehicle" ? 25 : 24) {
            context.beginPath();
            context.moveTo(left - 3, y + 3);
            context.lineTo(96, y + 17);
            context.lineTo(left + width + 3, y + 3);
            context.stroke();
            if (kind === "vehicle") {
                context.beginPath();
                context.moveTo(left - 3, y + 18);
                context.lineTo(96, y + 4);
                context.lineTo(left + width + 3, y + 18);
                context.stroke();
            }
        }
        context.fillRect(92, 4, 8, 184);
        context.globalCompositeOperation = "source-over";
    }
    else if (kind === "mow" || kind === "clean") {
        const gradient = context.createLinearGradient(0, 0, 192, 0);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(0.12, "rgba(255,255,255,0.72)");
        gradient.addColorStop(0.5, "rgba(255,255,255,1)");
        gradient.addColorStop(0.88, "rgba(255,255,255,0.72)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 7, 192, 178);
        context.globalCompositeOperation = "destination-out";
        context.shadowBlur = 0;
        context.globalAlpha = kind === "clean" ? 0.58 : 0.36;
        if (kind === "clean") {
            for (let y = 20; y < 188; y += 22)
                context.fillRect(10, y, 172, 4);
            for (let x = 30; x < 180; x += 36)
                context.fillRect(x, 7, 4, 178);
        }
        else {
            for (let x = 24; x < 192; x += 24)
                context.fillRect(x, 7, 5, 178);
        }
        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
    }
    else {
        const radius = kind === "cane" ? 24 : 31;
        context.lineWidth = kind === "cane" ? 13 : 16;
        context.beginPath();
        context.arc(96, 96, radius, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha = 0.62;
        context.beginPath();
        context.arc(96, 96, kind === "cane" ? 9 : 12, 0, Math.PI * 2);
        context.fill();
        if (kind === "crutch") {
            context.globalAlpha = 0.38;
            context.lineWidth = 7;
            context.beginPath();
            context.moveTo(66, 125);
            context.lineTo(126, 67);
            context.stroke();
        }
        context.globalAlpha = 1;
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
}
class TrailPool {
    constructor(scene, size = 240) {
        this.geometry = new THREE.PlaneGeometry(1, 1);
        this.items = [];
        this.cursor = 0;
        this.scene = scene;
        this.textures = {
            foot: createTrailTexture("foot"),
            prosthetic: createTrailTexture("prosthetic"),
            wheel: createTrailTexture("wheel"),
            paw: createTrailTexture("paw"),
            crutch: createTrailTexture("crutch"),
            cane: createTrailTexture("cane"),
            mow: createTrailTexture("mow"),
            vehicle: createTrailTexture("vehicle"),
            clean: createTrailTexture("clean"),
        };
        for (let index = 0; index < size; index += 1) {
            const material = new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 0,
                depthWrite: false,
                alphaTest: 0.012,
                polygonOffset: true,
                polygonOffsetFactor: -3,
                polygonOffsetUnits: -3,
                side: THREE.DoubleSide,
                toneMapped: false,
            });
            const mesh = new THREE.Mesh(this.geometry, material);
            mesh.rotation.x = -Math.PI / 2;
            const group = new THREE.Group();
            group.visible = false;
            group.add(mesh);
            group.renderOrder = 4;
            this.scene.add(group);
            this.items.push({
                group,
                mesh,
                age: 0,
                lifetime: 1,
                baseOpacity: 0,
                baseScaleX: 1,
                baseScaleY: 1,
                startColor: new THREE.Color(),
                endColor: new THREE.Color(),
            });
        }
    }
    surfaceHeight(position, kind) {
        const onLawn = position.x >= 3.25 &&
            position.x <= 20.75 &&
            position.z >= -13 &&
            position.z <= -2;
        if (onLawn)
            return kind === "mow" ? 0.075 : 0.19;
        return kind === "mow" || kind === "clean" ? 0.035 : 0.026;
    }
    emit(kind, position, yaw, width, depth, lifetime, flip = false) {
        const item = this.items[this.cursor];
        this.cursor = (this.cursor + 1) % this.items.length;
        const onLawn = position.x >= 3.25 &&
            position.x <= 20.75 &&
            position.z >= -13 &&
            position.z <= -2;
        const defaultLifetime = kind === "mow"
            ? 18
            : kind === "clean"
                ? 10.5
                : kind === "vehicle"
                    ? 10
                    : kind === "wheel"
                        ? 10
                        : kind === "paw"
                            ? 7.2
                            : kind === "cane"
                                ? 5.8
                                : kind === "crutch"
                                    ? 7.2
                                    : kind === "prosthetic"
                                        ? 9.8
                                        : 8.8;
        const colour = kind === "foot"
            ? 0x397f78
            : kind === "prosthetic"
                ? 0xc57065
                : kind === "vehicle"
                    ? 0xdde6e8
                    : kind === "wheel"
                        ? 0x52697a
                        : kind === "paw"
                            ? 0xaa7459
                            : kind === "crutch"
                                ? 0x76658e
                                : kind === "mow"
                                    ? 0xd1dfaa
                                    : kind === "clean"
                                        ? 0x9fc8cf
                                        : 0x668fa3;
        item.age = 0;
        item.lifetime = lifetime ?? defaultLifetime;
        item.group.visible = true;
        item.group.position.set(position.x, this.surfaceHeight(position, kind), position.z);
        item.group.rotation.y = yaw + Math.sin((position.x * 3.1 + position.z * 1.7 + this.cursor) * 0.73) * 0.022;
        const printBoost = (kind === "foot" || kind === "prosthetic" || kind === "wheel" || kind === "paw") ? 1.38 : 1;
        item.baseScaleX = (flip ? -width : width) * printBoost;
        item.baseScaleY = depth * printBoost;
        item.mesh.scale.set(item.baseScaleX * 0.88, item.baseScaleY * 0.88, 1);
        item.mesh.material.map = this.textures[kind];
        item.startColor.set(colour);
        item.endColor.set(onLawn ? 0x91a67b : 0xb8aea2);
        item.mesh.material.color.copy(item.startColor);
        item.baseOpacity =
            kind === "cane"
                ? 0.34
                : kind === "crutch"
                    ? 0.38
                    : kind === "mow"
                        ? 0.26
                        : kind === "clean"
                            ? 0.3
                            : kind === "vehicle"
                                ? 0.4
                                : kind === "wheel"
                                    ? 0.48
                                    : 0.52;
        item.mesh.material.opacity = 0;
        item.mesh.material.needsUpdate = true;
    }
    update(delta) {
        for (const item of this.items) {
            if (!item.group.visible)
                continue;
            item.age += delta;
            const life = THREE.MathUtils.clamp(item.age / item.lifetime, 0, 1);
            const fadeIn = smoothStep(THREE.MathUtils.clamp(item.age / 0.13, 0, 1));
            const fadeOut = 1 - smoothStep((life - 0.34) / 0.66);
            const opacity = item.baseOpacity * fadeIn * fadeOut;
            const spread = THREE.MathUtils.lerp(0.88, 1.075, smoothStep(life));
            item.mesh.scale.set(item.baseScaleX * spread, item.baseScaleY * spread, 1);
            item.mesh.material.color.lerpColors(item.startColor, item.endColor, smoothStep(THREE.MathUtils.clamp((life - 0.2) / 0.8, 0, 1)));
            item.mesh.material.opacity = opacity;
            if (item.age >= item.lifetime || opacity <= 0.001) {
                item.group.visible = false;
                item.mesh.material.opacity = 0;
            }
        }
    }
    clear() {
        for (const item of this.items) {
            item.group.visible = false;
            item.mesh.material.opacity = 0;
            item.age = 0;
        }
    }
    dispose() {
        this.geometry.dispose();
        Object.values(this.textures).forEach((texture) => texture.dispose());
        for (const item of this.items) {
            item.mesh.material.dispose();
            this.scene.remove(item.group);
        }
    }
}
function localPoint(root, x, z) {
    return new THREE.Vector3(x, 0, z).applyQuaternion(root.quaternion).add(root.position);
}
function yawFromQuaternion(quaternion) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    return Math.atan2(forward.x, forward.z);
}
function makeHitbox(id, width, height, depth, y = 1.2) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    mesh.position.y = y;
    mesh.userData.actorId = id;
    return mesh;
}
function createPath(points) {
    return new THREE.CatmullRomCurve3(points.map(([x, z], index) => {
        const atEdge = index === 0 || index === points.length - 1;
        return new THREE.Vector3(atEdge ? x * 1.25 : x, 0, atEdge ? z * 1.25 : z);
    }), false, "centripetal", 0.35);
}
function cycleLocalTime(simulationTime, start) {
    return ((simulationTime - start) % CYCLE_SECONDS + CYCLE_SECONDS) % CYCLE_SECONDS;
}
function smoothStep(value) {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}
function travelBetween(progress, startTime, endTime, startPath, endPath) {
    const t = smoothStep((progress - startTime) / Math.max(0.001, endTime - startTime));
    return THREE.MathUtils.lerp(startPath, endPath, t);
}
function closestPathProgress(path, target) {
    let closest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= 320; index += 1) {
        const progress = index / 320;
        const distance = path.getPointAt(progress).distanceToSquared(target);
        if (distance < closestDistance) {
            closest = progress;
            closestDistance = distance;
        }
    }
    return closest;
}
function facePoint(root, point, blend = 0.18) {
    const direction = point.clone().sub(root.position);
    direction.y = 0;
    if (direction.lengthSq() < 0.0001)
        return;
    const target = new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(direction.x, direction.z));
    root.quaternion.slerp(target, blend);
}
function edgeMotion(progress) {
    if (progress < 0.1) {
        const t = THREE.MathUtils.clamp(progress / 0.1, 0, 1);
        return (t * t * (3 - 2 * t)) * 0.24;
    }
    if (progress > 0.9) {
        const t = THREE.MathUtils.clamp((progress - 0.9) / 0.1, 0, 1);
        return 0.76 + (t * t * (3 - 2 * t)) * 0.239;
    }
    return 0.24 + ((progress - 0.1) / 0.8) * 0.52;
}
function createEnsembles(scene, clickables, grounding) {
    const ensembles = [];
    const workerTeal = 0x2d847d;
    {
        const root = new THREE.Group();
        const chair = createWheelchair(false, {
            skin: 0x70452f,
            shirt: 0xd6a247,
            trousers: 0x273b48,
            hair: 0x201a18,
            hairStyle: "curls",
        });
        chair.root.position.x = -0.55;
        const worker = createHuman({
            skin: 0xe7b796,
            shirt: workerTeal,
            trousers: 0x2f4652,
            hair: 0x4b3327,
            hairStyle: "crop",
        });
        worker.root.position.set(0.88, 0, -0.08);
        root.add(chair.root, worker.root, makeHitbox("manual-chair", 3.2, 2.8, 2.3, 1.35));
        scene.add(root);
        clickables.push(root.children[root.children.length - 1]);
        const path = createPath([
            [-62, 38],
            [-42, 25],
            [-25, 10],
            [-19, -8.2],
            [-13, -6],
            [-8, -3.7],
            [-3.5, -4.6],
            [1, -1.7],
            [7, -3.4],
            [13, -1.7],
            [20, -4.2],
            [40, -23],
            [62, -38],
        ]);
        ensembles.push({
            id: "manual-chair",
            root,
            path,
            pathLength: path.getLength(),
            start: 0,
            duration: 30,
            stampEvery: 0.34,
            lastStamp: -1,
            wasActive: false,
            targetQuaternion: new THREE.Quaternion(),
            motion: edgeMotion,
            animate(distance, phase) {
                chair.animate(distance, phase);
                worker.animate(phase + 1.2);
                chair.person.head.rotation.y = 0.22 + Math.sin(phase * 0.16) * 0.08;
                worker.head.rotation.y = -0.18 + Math.sin(phase * 0.18) * 0.06;
            },
            stamp(trails, distance) {
                const yaw = yawFromQuaternion(root.quaternion);
                trails.emit("wheel", localPoint(root, -1.3, -0.08), yaw, 0.13, 0.48, 6.5);
                trails.emit("wheel", localPoint(root, 0.2, -0.08), yaw, 0.13, 0.48, 6.5);
                const left = Math.floor(distance / 0.34) % 2 === 0;
                trails.emit("foot", localPoint(root, left ? 0.76 : 1.0, -0.36), yaw, 0.18, 0.42, 5.5, left);
            },
        });
    }
    {
        const root = new THREE.Group();
        const participant = createHuman({
            skin: 0x8f6046,
            shirt: 0x6f91c2,
            trousers: 0x334552,
            hair: 0x2c2522,
            hairStyle: "waves",
        });
        participant.root.position.x = -0.55;
        const worker = createHuman({
            skin: 0x6c402e,
            shirt: workerTeal,
            trousers: 0x2e3c48,
            hair: 0x191919,
            hairStyle: "bun",
        });
        worker.root.position.set(0.65, 0, -0.1);
        const cane = new THREE.Group();
        cane.position.set(-0.27, 1.22, 0.08);
        cane.add(cylinderBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.12, -1.2, 0.72), 0.021, standardMaterial(0xf3f4ef, 0.38, 0.2), 8));
        const caneTip = makeSphere(0.04, standardMaterial(0xd95445, 0.8), 9, 7);
        caneTip.position.set(0.12, -1.2, 0.72);
        cane.add(caneTip);
        root.add(participant.root, worker.root, cane, makeHitbox("white-cane", 2.8, 2.8, 2.4, 1.35));
        root.add(createContactShadow(1.38, 0.85, 0.08));
        scene.add(root);
        clickables.push(root.children[root.children.length - 2]);
        const path = createPath([
            [62, -38],
            [43, -23],
            [26, -8],
            [20, 8.2],
            [13.5, 6.5],
            [9, 4.1],
            [5, 1.1],
            [1.5, 4.3],
            [-5, 6.1],
            [-11, 4.2],
            [-19, 7.2],
            [-39, 24],
            [-62, 38],
        ]);
        ensembles.push({
            id: "white-cane",
            root,
            path,
            pathLength: path.getLength(),
            start: 10,
            duration: 29,
            stampEvery: 0.46,
            lastStamp: -1,
            wasActive: false,
            targetQuaternion: new THREE.Quaternion(),
            motion: edgeMotion,
            animate(_distance, phase) {
                participant.animate(phase);
                worker.animate(phase + 1.5);
                cane.rotation.y = Math.sin(phase * 0.52) * 0.54;
            },
            stamp(trails, distance) {
                const yaw = yawFromQuaternion(root.quaternion);
                const left = Math.floor(distance / 0.46) % 2 === 0;
                trails.emit("foot", localPoint(root, left ? -0.72 : -0.42, -0.32), yaw, 0.18, 0.42, 5.3, left);
                trails.emit("foot", localPoint(root, left ? 0.5 : 0.8, -0.3), yaw, 0.18, 0.42, 5.3, !left);
                const sweep = Math.sin(distance * 1.3) > 0 ? -0.96 : 0.12;
                trails.emit("cane", localPoint(root, sweep, 0.8), yaw, 0.13, 0.13, 2.2);
            },
        });
    }
    {
        const root = new THREE.Group();
        const participant = createHuman({
            skin: 0xc98d65,
            shirt: 0x806f98,
            trousers: 0x374957,
            hair: 0x392a23,
            hairStyle: "curls",
            jacket: 0x9a5476,
        });
        participant.root.position.x = -0.48;
        participant.root.scale.multiplyScalar(0.97);
        const worker = createHuman({
            skin: 0xe0ac86,
            shirt: workerTeal,
            trousers: 0x43515c,
            hair: 0xa46e49,
            hairStyle: "waves",
        });
        worker.root.position.set(0.72, 0, -0.15);
        const leftCrutch = createCrutch(0x806f98);
        const rightCrutch = createCrutch(0x806f98);
        leftCrutch.position.set(-0.92, 0, 0.12);
        rightCrutch.position.set(-0.06, 0, 0.12);
        root.add(participant.root, worker.root, leftCrutch, rightCrutch, makeHitbox("crutches", 3, 2.8, 2.5, 1.35), createContactShadow(1.45, 0.85, 0.1));
        scene.add(root);
        clickables.push(root.children[4]);
        const path = createPath([
            [-62, 38],
            [-42, 25],
            [-25, 8],
            [-20, -0.8],
            [-14, 0.4],
            [-11, 4.3],
            [-6.5, 5.8],
            [-2.5, 3.6],
            [0.3, 0.4],
            [6, 1.3],
            [12, 4],
            [20, 5.5],
            [42, -19],
            [62, -38],
        ]);
        ensembles.push({
            id: "crutches",
            root,
            path,
            pathLength: path.getLength(),
            start: 24,
            duration: 31,
            stampEvery: 0.48,
            lastStamp: -1,
            wasActive: false,
            targetQuaternion: new THREE.Quaternion(),
            motion: edgeMotion,
            animate(_distance, phase) {
                participant.animate(phase, 0.66);
                worker.animate(phase + 1.05);
                leftCrutch.rotation.x = -0.1 + Math.sin(phase) * 0.18;
                rightCrutch.rotation.x = -0.1 - Math.sin(phase) * 0.18;
            },
            stamp(trails, distance) {
                const yaw = yawFromQuaternion(root.quaternion);
                const even = Math.floor(distance / 0.48) % 2 === 0;
                trails.emit("foot", localPoint(root, even ? -0.65 : -0.32, -0.35), yaw, 0.18, 0.42, 5.4, even);
                trails.emit("foot", localPoint(root, even ? 0.58 : 0.82, -0.34), yaw, 0.18, 0.42, 5.4, !even);
                trails.emit("crutch", localPoint(root, even ? -0.95 : -0.05, 0.18), yaw, 0.15, 0.15, 5.5);
            },
        });
    }
    {
        const root = new THREE.Group();
        const chair = createWheelchair(true, {
            skin: 0xd8a27e,
            shirt: 0x426d8d,
            trousers: 0x2f3f49,
            hair: 0x171b1f,
            hairStyle: "crop",
        });
        chair.root.position.x = -0.68;
        const worker = createHuman({
            skin: 0xa86e4f,
            shirt: workerTeal,
            trousers: 0x3e4a54,
            hair: 0x2e1f19,
            hairStyle: "bun",
        });
        worker.root.position.set(0.68, 0, -0.28);
        const dog = createDog();
        dog.root.position.set(1.62, 0, 0.26);
        const lead = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.95, 1.08, 0.18),
            new THREE.Vector3(1.25, 0.92, 0.5),
            new THREE.Vector3(1.58, 0.72, 0.38),
        ]), 16, 0.012, 6, false), standardMaterial(0x915d3f, 0.8));
        root.add(chair.root, worker.root, dog.root, lead, makeHitbox("power-chair-dog", 4.2, 3, 2.7, 1.45));
        scene.add(root);
        clickables.push(root.children[4]);
        const path = createPath([
            [62, -38],
            [43, -25],
            [31, -16],
            [26, -6],
            [23, 3.5],
            [20, 9],
            [15, 12.5],
            [7, 14],
            [-16, 21],
            [-40, 29],
            [-62, 38],
        ]);
        ensembles.push({
            id: "power-chair-dog",
            root,
            path,
            pathLength: path.getLength(),
            start: 40,
            duration: 30,
            stampEvery: 0.31,
            lastStamp: -1,
            wasActive: false,
            targetQuaternion: new THREE.Quaternion(),
            motion: edgeMotion,
            animate(distance, phase) {
                chair.animate(distance, phase);
                worker.animate(phase + 0.8);
                dog.animate(phase * 1.35);
            },
            stamp(trails, distance) {
                const yaw = yawFromQuaternion(root.quaternion);
                trails.emit("wheel", localPoint(root, -1.35, -0.08), yaw, 0.16, 0.45, 6.5);
                trails.emit("wheel", localPoint(root, 0.02, -0.08), yaw, 0.16, 0.45, 6.5);
                const left = Math.floor(distance / 0.31) % 2 === 0;
                trails.emit("foot", localPoint(root, left ? 0.54 : 0.8, -0.52), yaw, 0.18, 0.42, 5.2, left);
                trails.emit("paw", localPoint(root, left ? 1.42 : 1.78, 0.1), yaw, 0.16, 0.18, 4.6, left);
            },
        });
    }
    {
        const root = new THREE.Group();
        const participant = createHuman({
            skin: 0x6c4636,
            shirt: 0xd47e6c,
            trousers: 0x405765,
            hair: 0x1d1d1d,
            hairStyle: "crop",
            prosthetic: "right",
        });
        participant.root.position.x = -0.55;
        const worker = createHuman({
            skin: 0xc1845f,
            shirt: workerTeal,
            trousers: 0x2e4852,
            hair: 0x4c3025,
            hairStyle: "waves",
        });
        worker.root.position.set(0.66, 0, -0.08);
        const tote = makeBox(0.46, 0.58, 0.14, standardMaterial(0xd6a247, 0.9), 0.06);
        tote.position.set(1.03, 0.86, 0.02);
        tote.rotation.z = -0.08;
        root.add(participant.root, worker.root, tote, makeHitbox("prosthetic", 2.8, 2.8, 2.4, 1.35));
        root.add(createContactShadow(1.4, 0.85, 0.09));
        scene.add(root);
        clickables.push(root.children[3]);
        const path = createPath([
            [-62, 38],
            [-42, 27],
            [-34, 8],
            [-26, -1.5],
            [-18, -0.8],
            [-10, 2],
            [-3, 5],
            [5, 7],
            [14, 5.5],
            [24, 0.5],
            [31, -8],
            [39, -20],
            [45, -33],
            [62, -38],
        ]);
        ensembles.push({
            id: "prosthetic",
            root,
            path,
            pathLength: path.getLength(),
            start: 56,
            duration: 28,
            stampEvery: 0.45,
            lastStamp: -1,
            wasActive: false,
            targetQuaternion: new THREE.Quaternion(),
            motion: edgeMotion,
            animate(_distance, phase) {
                participant.animate(phase, 0.94);
                worker.animate(phase + 1.3);
                participant.rightLeg.rotation.x *= 0.9;
            },
            stamp(trails, distance) {
                const yaw = yawFromQuaternion(root.quaternion);
                const left = Math.floor(distance / 0.45) % 2 === 0;
                trails.emit("foot", localPoint(root, left ? -0.7 : -0.4, -0.34), yaw, 0.18, 0.42, 5.4, left);
                trails.emit("foot", localPoint(root, left ? 0.52 : 0.82, -0.34), yaw, 0.18, 0.42, 5.4, !left);
            },
        });
    }
    {
        const root = new THREE.Group();
        const worker = createHuman({
            skin: 0x8f6046,
            shirt: workerTeal,
            trousers: 0x3d5260,
            hair: 0x27201d,
            hairStyle: "bun",
            jacket: 0x67947a,
        });
        const wateringCan = createWateringCan();
        wateringCan.position.set(0.46, 0.92, 0.32);
        wateringCan.scale.setScalar(0.82);
        const shears = createGardenShears();
        shears.root.position.set(-0.38, 0.92, 0.62);
        shears.root.scale.setScalar(0.72);
        shears.root.visible = false;
        const waterDrops = new THREE.Group();
        const waterMaterial = new THREE.MeshBasicMaterial({
            color: 0x82bed0,
            transparent: true,
            opacity: 0.78,
            depthWrite: false,
        });
        const drops = [];
        for (let index = 0; index < 32; index += 1) {
            const drop = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 6), waterMaterial);
            drop.scale.set(0.62, 1.72, 0.62);
            drops.push(drop);
            waterDrops.add(drop);
        }
        waterDrops.visible = false;
        const hitbox = makeHitbox("garden-care", 1.9, 2.8, 2.1, 1.35);
        root.add(worker.root, wateringCan, shears.root, waterDrops, hitbox, createContactShadow(0.9, 0.72, 0.09));
        scene.add(root);
        clickables.push(hitbox);
        const path = createPath([
            [-72, 44],
            [-48, 30],
            [-33, 19],
            [-23, 12],
            [-18.2, 8.5],
            [-17.5, 8.6],
            [-13.4, 8.8],
            [-12.8, 8.9],
            [-10.1, 8.5],
            [-8.4, 8.1],
            [-17, 13.6],
            [-33, 17.5],
            [-50, 31.5],
            [-72, 44],
        ]);
        const waterOneStation = new THREE.Vector3(-17.5, 0, 8.6);
        const waterTwoStation = new THREE.Vector3(-12.8, 0, 8.9);
        const trimStart = new THREE.Vector3(-10.1, 0, 8.5);
        const trimEnd = new THREE.Vector3(-8.4, 0, 8.1);
        const waterOnePath = closestPathProgress(path, waterOneStation);
        const waterTwoPath = closestPathProgress(path, waterTwoStation);
        const trimStartPath = closestPathProgress(path, trimStart);
        const trimEndPath = closestPathProgress(path, trimEnd);
        const trimTarget = new THREE.Vector3(-9.3, 0, 9.9);
        ensembles.push({
            id: "garden-care",
            root,
            path,
            pathLength: path.getLength(),
            start: GARDEN_START,
            duration: GARDEN_DURATION,
            stampEvery: 0.42,
            lastStamp: -1,
            wasActive: false,
            targetQuaternion: new THREE.Quaternion(),
            motion(progress) {
                if (progress < 0.21)
                    return travelBetween(progress, 0, 0.21, 0, waterOnePath);
                if (progress < 0.35)
                    return waterOnePath;
                if (progress < 0.47) {
                    return travelBetween(progress, 0.35, 0.47, waterOnePath, waterTwoPath);
                }
                if (progress < 0.61)
                    return waterTwoPath;
                if (progress < 0.7) {
                    return travelBetween(progress, 0.61, 0.7, waterTwoPath, trimStartPath);
                }
                if (progress < 0.82) {
                    return travelBetween(progress, 0.7, 0.82, trimStartPath, trimEndPath);
                }
                return travelBetween(progress, 0.82, 1, trimEndPath, 0.999);
            },
            animate(_distance, phase, progress) {
                const wateringOne = progress >= 0.21 && progress < 0.35;
                const wateringTwo = progress >= 0.47 && progress < 0.61;
                const watering = wateringOne || wateringTwo;
                const trimming = progress >= 0.7 && progress < 0.82;
                worker.animate(phase, watering ? 0 : trimming ? 0.14 : 0.88);
                if (watering) {
                    const waterStart = wateringOne ? 0.21 : 0.47;
                    const waterEnd = wateringOne ? 0.35 : 0.61;
                    const waterProgress = smoothStep((progress - waterStart) / (waterEnd - waterStart));
                    const waterTarget = (wateringOne ? GARDEN_BEDS[0] : GARDEN_BEDS[1]).clone();
                    waterTarget.x += THREE.MathUtils.lerp(-1.15, 1.15, waterProgress);
                    facePoint(root, waterTarget, 0.5);
                    worker.leftArm.rotation.x = -0.76;
                    worker.rightArm.rotation.x = -0.94;
                    wateringCan.position.set(0.46, 0.92, 0.32);
                    wateringCan.rotation.set(0, -1.06, -0.42);
                }
                else if (trimming) {
                    facePoint(root, trimTarget, 0.32);
                    worker.leftArm.rotation.x = -0.78 + Math.sin(phase * 1.2) * 0.08;
                    worker.rightArm.rotation.x = -0.84 - Math.sin(phase * 1.2) * 0.08;
                    wateringCan.position.set(0.54, 0.69, -0.02);
                    wateringCan.rotation.set(0.08, -0.2, 0.08);
                    shears.animate(phase);
                    grounding.trimGardenEdge((progress - 0.7) / 0.12);
                }
                else {
                    wateringCan.position.set(0.46, 0.92, 0.32);
                    wateringCan.rotation.set(0, 0, 0.05);
                }
                shears.root.visible = trimming;
                waterDrops.visible = watering;
                if (!watering)
                    return;
                for (let index = 0; index < drops.length; index += 1) {
                    const fall = (progress * GARDEN_DURATION * 1.85 + index / drops.length) % 1;
                    const fan = ((index % 7) - 3) / 3;
                    drops[index].position.set(0.58 + fan * (0.06 + fall * 0.24), 1.15 + Math.sin(fall * Math.PI) * 0.18 - fall * 0.74, 1.02 + fall * 1.62);
                    drops[index].scale.y = 0.85 + fall * 1.45;
                }
            },
            stamp(trails, distance) {
                const yaw = yawFromQuaternion(root.quaternion);
                const left = Math.floor(distance / 0.42) % 2 === 0;
                trails.emit("foot", localPoint(root, left ? -0.17 : 0.17, -0.3), yaw, 0.18, 0.42, 5.5, left);
            },
        });
    }
    {
        const root = new THREE.Group();
        const mower = createLawnMower({
            skin: 0xe0ad87,
            shirt: workerTeal,
            trousers: 0x344956,
            hair: 0x5f402f,
            hairStyle: "crop",
        });
        const hitbox = makeHitbox("lawn-care", 2.5, 2.8, 3.4, 1.35);
        root.add(mower.root, hitbox);
        scene.add(root);
        clickables.push(hitbox);
        const path = createPath([
            [72, -44],
            [48, -30],
            [34, -22],
            [24, -15],
            [20, -12.1],
            [4.5, -12.1],
            [4.5, -10.7],
            [19.5, -10.7],
            [19.5, -9.3],
            [4.5, -9.3],
            [4.5, -7.9],
            [19.5, -7.9],
            [19.5, -6.5],
            [4.5, -6.5],
            [4.5, -5.1],
            [19.5, -5.1],
            [19.5, -3.6],
            [4.5, -3.6],
            [1, -1],
            [-12, 7],
            [-30, 17.5],
            [-49, 31],
            [-72, 44],
        ]);
        ensembles.push({
            id: "lawn-care",
            root,
            path,
            pathLength: path.getLength(),
            start: LAWN_START,
            duration: LAWN_DURATION,
            stampEvery: 0.7,
            lastStamp: -1,
            wasActive: false,
            targetQuaternion: new THREE.Quaternion(),
            motion: smoothStep,
            animate(distance, phase, progress) {
                mower.animate(distance, phase);
                if (progress > 0.12 && progress < 0.82) {
                    grounding.markMowed(root.position.x, root.position.z);
                }
            },
            stamp(trails, distance) {
                const yaw = yawFromQuaternion(root.quaternion);
                const left = Math.floor(distance / 0.7) % 2 === 0;
                trails.emit("foot", localPoint(root, left ? -0.18 : 0.18, -1.92), yaw, 0.18, 0.42, 5.2, left);
                trails.emit("wheel", localPoint(root, -0.45, 0.1), yaw, 0.1, 0.34, 5.4);
                trails.emit("wheel", localPoint(root, 0.45, 0.1), yaw, 0.1, 0.34, 5.4);
            },
        });
    }
    {
        const root = new THREE.Group();
        const worker = createHuman({
            skin: 0x6f4635,
            shirt: workerTeal,
            trousers: 0x344955,
            hair: 0x191919,
            hairStyle: "waves",
        });
        worker.root.position.x = -0.48;
        const dog = createDog();
        dog.root.position.set(0.96, 0, 0.3);
        dog.root.scale.multiplyScalar(0.9);
        const lead = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.1, 1.08, 0.1),
            new THREE.Vector3(0.42, 0.9, 0.46),
            new THREE.Vector3(0.92, 0.72, 0.42),
        ]), 14, 0.012, 6, false), standardMaterial(0x915d3f, 0.8));
        const hitbox = makeHitbox("dog-walk", 3.1, 2.8, 2.5, 1.35);
        root.add(worker.root, dog.root, lead, hitbox);
        scene.add(root);
        clickables.push(hitbox);
        const path = createPath([
            [-62, 38],
            [-44, 24],
            [-32, 7],
            [-25, -16],
            [-17, -12],
            [-10, -14],
            [-2, -10],
            [5, -12.5],
            [12, -9],
            [18, -2],
            [23, 6],
            [28, 13],
            [42, -5],
            [62, -38],
        ]);
        ensembles.push({
            id: "dog-walk",
            root,
            path,
            pathLength: path.getLength(),
            start: 56,
            duration: 22,
            stampEvery: 0.34,
            lastStamp: -1,
            wasActive: false,
            targetQuaternion: new THREE.Quaternion(),
            motion: edgeMotion,
            animate(_distance, phase) {
                worker.animate(phase, 0.92);
                dog.animate(phase * 1.35);
                worker.rightArm.rotation.x = -0.42 + Math.sin(phase) * 0.08;
            },
            stamp(trails, distance) {
                const yaw = yawFromQuaternion(root.quaternion);
                const left = Math.floor(distance / 0.34) % 2 === 0;
                trails.emit("foot", localPoint(root, left ? -0.63 : -0.34, -0.34), yaw, 0.18, 0.42, 5.2, left);
                trails.emit("paw", localPoint(root, left ? 0.78 : 1.08, 0.18), yaw, 0.16, 0.18, 4.6, left);
            },
        });
    }
    return ensembles;
}
function createScenePath(points) {
    return new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal", 0.32);
}
function createOffsetScenePath(path, lateral, forward = 0, samples = 72) {
    const points = [];
    for (let index = 0; index < samples; index += 1) {
        const progress = index / Math.max(1, samples - 1);
        const point = path.getPointAt(progress);
        const tangent = path.getTangentAt(Math.min(0.9999, progress + 0.0008)).normalize();
        const right = new THREE.Vector3(tangent.z, 0, -tangent.x);
        points.push(point.clone()
            .addScaledVector(right, lateral)
            .addScaledVector(tangent, forward));
    }
    return new THREE.CatmullRomCurve3(points, false, "centripetal", 0.24);
}
function createVectorScenePath(points) {
    return new THREE.CatmullRomCurve3(points.map((point) => point.clone()), false, "centripetal", 0.28);
}
/* v65: obstacle-aware routing moved to the shared care-nav.js module. */
function combineRoutePoints(...segments) {
    const combined = [];
    segments.forEach((segment) => {
        const points = Array.isArray(segment) ? segment : segment.points;
        points.forEach((point, index) => {
            if (combined.length > 0 && index === 0 && combined[combined.length - 1].distanceToSquared(point) < 0.0001) {
                return;
            }
            combined.push(point.clone());
        });
    });
    return combined;
}
function timedEase(time, start, end) {
    return smoothStep((time - start) / Math.max(0.001, end - start));
}
function roundedCanvasRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
}
function createCanvasPanel(title, subtitle, accent, width = 6.6, height = 2.05) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 320;
    const context = canvas.getContext("2d");
    if (!context)
        throw new Error("Unable to create service label");
    roundedCanvasRect(context, 16, 16, 992, 288, 44);
    context.fillStyle = "rgba(255,253,248,0.96)";
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = `#${accent.toString(16).padStart(6, "0")}`;
    context.stroke();
    context.fillStyle = "#233747";
    context.font = "700 68px Arial, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(title, 72, 125, 875);
    context.fillStyle = "#536671";
    context.font = "500 38px Arial, sans-serif";
    context.fillText(subtitle, 72, 215, 875);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: true,
        alphaTest: 0.05,
        toneMapped: false,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    panel.renderOrder = 2;
    return panel;
}
function createServicePlant(color = 0x7fa78d) {
    const root = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.48, 0.8, 16), standardMaterial(0xd7b49b, 0.9));
    pot.position.y = 0.4;
    pot.castShadow = true;
    const leafMaterial = standardMaterial(color, 0.86);
    for (let index = 0; index < 7; index += 1) {
        const angle = (index / 7) * Math.PI * 2;
        const leaf = makeCapsule(0.13, 0.72, leafMaterial, 9);
        leaf.position.set(Math.sin(angle) * 0.2, 1.1 + (index % 2) * 0.12, Math.cos(angle) * 0.2);
        leaf.rotation.z = Math.sin(angle) * 0.58;
        leaf.rotation.x = Math.cos(angle) * 0.58;
        root.add(leaf);
    }
    root.add(pot);
    return root;
}
const STAGE_X = 18, STAGE_Z = 12;
function onStage(position, margin = 0.45) {
    return (position.x > -STAGE_X - margin && position.x < STAGE_X + margin &&
        position.z > -STAGE_Z - margin && position.z < STAGE_Z + margin);
}
function applyStageVisibility(object, margin = 0.55) {
    object.visible = onStage(object.position, margin);
}
function createFramedArt(accent) {
    const art = new THREE.Group();
    const frame = makeBox(3.55, 2.45, 0.14, standardMaterial(0xb5916e, 0.76), 0.03);
    const mat = makeBox(3.15, 2.05, 0.06, standardMaterial(0xfffdf8, 0.95), 0.02);
    mat.position.z = 0.06;
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.05, 26, 1, false, -Math.PI / 2, Math.PI), standardMaterial(accent, 0.82));
    arch.rotation.x = Math.PI / 2;
    arch.position.set(-0.62, -0.28, 0.12);
    const bar = makeBox(1.15, 0.16, 0.05, standardMaterial(0x536671, 0.85), 0.02);
    bar.position.set(0.62, -0.62, 0.12);
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 22), standardMaterial(0x7fa78d, 0.82));
    dot.rotation.x = Math.PI / 2;
    dot.position.set(0.72, 0.42, 0.12);
    art.add(frame, mat, arch, bar, dot);
    return art;
}
function createServiceBase(root, accent, title, subtitle, floorColor = 0xf7f2ea, mode = "indoor", options) {
    const base = makeBox(36, 0.5, 24, standardMaterial(0xe5ddd1, 0.98), 0.08);
    base.position.y = -0.28;
    base.receiveShadow = true;
    const floor = makeBox(33.2, 0.12, 21.2, standardMaterial(floorColor, 0.96), 0.05);
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    root.add(base, floor);
    const accentLine = makeBox(17.8, 0.045, 0.17, standardMaterial(accent, 0.74), 0.025);
    accentLine.position.set(-5.1, 0.105, 9.02);
    root.add(accentLine);
    if (mode === "indoor") {
        const wallMaterial = standardMaterial(0xfffdf8, 0.96);
        const backWall = makeBox(31.4, 6.4, 0.42, wallMaterial, 0.07);
        backWall.position.set(0.5, 3.18, -9.25);
        const sideWall = makeBox(0.42, 6.4, 10.2, standardMaterial(0xf5eee4, 0.96), 0.07);
        sideWall.position.set(-15.4, 3.18, -4.35);
        const baseboard = makeBox(31.1, 0.27, 0.16, standardMaterial(0xd9cec0, 0.92), 0.03);
        baseboard.position.set(0.5, 0.18, -9.0);
        const sideBaseboard = makeBox(0.16, 0.27, 9.8, standardMaterial(0xd9cec0, 0.92), 0.03);
        sideBaseboard.position.set(-15.14, 0.18, -4.35);
        root.add(backWall, sideWall, baseboard, sideBaseboard);
        const frameMaterial = standardMaterial(0x71858b, 0.46, 0.24);
        const skyMaterial = new THREE.MeshStandardMaterial({
            color: 0xbfdce3,
            roughness: 0.38,
            emissive: new THREE.Color(0xb8dbe3),
            emissiveIntensity: 0.16,
        });
        const windowGroup = new THREE.Group();
        const windowBack = makeBox(5.55, 3.15, 0.08, skyMaterial, 0.035);
        const windowTop = makeBox(5.9, 0.17, 0.17, frameMaterial, 0.025);
        const windowBottom = windowTop.clone();
        const windowLeft = makeBox(0.17, 3.25, 0.17, frameMaterial, 0.025);
        const windowRight = windowLeft.clone();
        const windowMiddle = makeBox(0.12, 3.1, 0.13, frameMaterial, 0.02);
        windowTop.position.y = 1.62;
        windowBottom.position.y = -1.62;
        windowLeft.position.x = -2.9;
        windowRight.position.x = 2.9;
        const sill = makeBox(6.2, 0.2, 0.58, standardMaterial(0xe2d4c2, 0.82), 0.04);
        sill.position.set(0, -1.78, 0.2);
        const blind = makeBox(5.55, 0.22, 0.06, standardMaterial(accent, 0.84), 0.025);
        blind.position.set(0, 1.25, 0.09);
        windowGroup.add(windowBack, windowTop, windowBottom, windowLeft, windowRight, windowMiddle, sill, blind);
        windowGroup.position.set(-9.4, 3.55, -8.98);
        root.add(windowGroup);
        const wallArt = createFramedArt(accent);
        wallArt.position.set(options?.artX ?? 8.3, 3.55, -8.98);
        root.add(wallArt);
        const floorLineMaterial = new THREE.MeshBasicMaterial({
            color: 0xb7aa9a,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            toneMapped: false,
        });
        for (let x = -14.5; x <= 15; x += 2.2) {
            const seam = makeBox(0.025, 0.012, 19.4, floorLineMaterial, 0.004);
            seam.position.set(x, 0.094, 0.15);
            seam.renderOrder = 2;
            root.add(seam);
        }
    }
    else {
        const portal = options?.outdoorPortal;
        const skyMaterial = standardMaterial(0xeaf1eb, 0.98);
        const curbMaterial = standardMaterial(0xd8d1c6, 0.94);
        let panelX = 8.2;
        if (portal) {
            const leftEdge = -15;
            const rightEdge = 16;
            const portalLeft = THREE.MathUtils.clamp(portal.centerX - portal.width * 0.5, leftEdge + 0.5, rightEdge - 0.5);
            const portalRight = THREE.MathUtils.clamp(portal.centerX + portal.width * 0.5, leftEdge + 0.5, rightEdge - 0.5);
            const wallHeight = portal.wallHeight ?? 3.8;
            const curbHeight = portal.curbHeight ?? 0.42;
            const addWallSegment = (startX, endX, height, y, depth, material, radius) => {
                const width = endX - startX;
                if (width <= 0.12)
                    return;
                const segment = makeBox(width, height, depth, material, radius);
                segment.position.set((startX + endX) * 0.5, y, height > 1 ? -9.35 : -9.05);
                root.add(segment);
            };
            addWallSegment(leftEdge, portalLeft, wallHeight, wallHeight * 0.5 - 0.02, 0.3, skyMaterial, 0.05);
            addWallSegment(portalRight, rightEdge, wallHeight, wallHeight * 0.5 - 0.02, 0.3, skyMaterial, 0.05);
            addWallSegment(leftEdge, portalLeft, curbHeight, 0.22, 0.62, curbMaterial, 0.07);
            addWallSegment(portalRight, rightEdge, curbHeight, 0.22, 0.62, curbMaterial, 0.07);
            const jambMaterial = standardMaterial(0xe1d7ca, 0.96);
            const leftJamb = makeBox(0.26, wallHeight, 0.36, jambMaterial, 0.04);
            leftJamb.position.set(portalLeft - 0.13, wallHeight * 0.5 - 0.02, -9.2);
            const rightJamb = leftJamb.clone();
            rightJamb.position.x = portalRight + 0.13;
            const lintel = makeBox(portal.width + 0.52, 0.24, 0.34, standardMaterial(0xd3c6b6, 0.9), 0.04);
            lintel.position.set((portalLeft + portalRight) * 0.5, wallHeight - 0.16, -9.2);
            root.add(leftJamb, rightJamb, lintel);
            panelX = THREE.MathUtils.clamp(portalRight + 3.35, 8.2, 11.9);
        }
        else {
            const horizon = makeBox(31, 3.8, 0.3, skyMaterial, 0.05);
            horizon.position.set(0.5, 1.88, -9.35);
            const lowWall = makeBox(31, 0.42, 0.62, curbMaterial, 0.07);
            lowWall.position.set(0.5, 0.22, -9.05);
            root.add(horizon, lowWall);
        }
        void panelX;
        const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, toneMapped: false, depthWrite: false });
        [[-11.6, 2.95], [-6.4, 3.32], [8.9, 3.18], [13.1, 2.8]].forEach(([cx, cy], index) => {
            const cloud = makeSphere(0.5, cloudMaterial, 14, 9);
            cloud.castShadow = false;
            cloud.receiveShadow = false;
            cloud.scale.set(2.5 + (index % 2) * 0.5, 0.44, 0.06);
            cloud.position.set(cx, cy, -9.14);
            cloud.renderOrder = 1;
            root.add(cloud);
        });
    }
    const plantA = createServicePlant();
    plantA.position.set(14.9, 0.03, -7.65);
    plantA.scale.setScalar(0.82);
    const plantB = createServicePlant(0x6f91c2);
    plantB.position.set(-14.7, 0.03, 8.1);
    plantB.scale.setScalar(0.68);
    root.add(plantA, plantB);
}
function createRouteRibbon(root, path, color) {
    const kept = [];
    for (let index = 0; index <= 150; index += 1) {
        const point = path.getPointAt(index / 150);
        if (point.x > -16.9 && point.x < 16.9 && point.z > -11.35 && point.z < 11.35)
            kept.push(point.clone());
    }
    if (kept.length < 3)
        return new THREE.Group();
    const clipped = new THREE.CatmullRomCurve3(kept, false, "centripetal", 0.2);
    const ribbon = new THREE.Mesh(new THREE.TubeGeometry(clipped, 120, 0.062, 6, false), new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.085,
        depthWrite: false,
        toneMapped: false,
    }));
    ribbon.position.y = 0.055;
    ribbon.renderOrder = 2;
    root.add(ribbon);
    return ribbon;
}
function sampleCurvePose(path, progress, direction = 1) {
    const p = THREE.MathUtils.clamp(progress, 0, 0.9999);
    const position = path.getPointAt(p);
    const tangentSample = direction > 0
        ? Math.min(0.9999, p + 0.0008)
        : Math.max(0, p - 0.0008);
    const tangent = path.getTangentAt(tangentSample).normalize();
    if (direction < 0)
        tangent.multiplyScalar(-1);
    return {
        position,
        yaw: Math.atan2(tangent.x, tangent.z),
        distance: p * path.getLength(),
    };
}
function sampleWaypointPose(points, progress) {
    if (points.length === 0) {
        return { position: new THREE.Vector3(), yaw: 0, distance: 0 };
    }
    if (points.length === 1) {
        return { position: points[0].clone(), yaw: 0, distance: 0 };
    }
    const path = new THREE.CatmullRomCurve3(points, false, "centripetal", 0.32);
    return sampleCurvePose(path, progress);
}
function yawToPoint(from, to) {
    const direction = to.clone().sub(from);
    direction.y = 0;
    if (direction.lengthSq() < 0.0001)
        return 0;
    return Math.atan2(direction.x, direction.z);
}
function placeChildAtWorldPose(parent, child, worldPosition, worldYaw) {
    const local = parent.worldToLocal(worldPosition.clone());
    child.position.copy(local);
    child.rotation.set(0, worldYaw - yawFromQuaternion(parent.quaternion), 0);
}
function poseOnPath(root, path, progress, direction = 1) {
    const pose = sampleCurvePose(path, progress, direction);
    root.position.copy(pose.position);
    root.quaternion.setFromAxisAngle(UP, pose.yaw);
    return {
        distance: pose.distance,
        yaw: pose.yaw,
    };
}
function createDesk(accent) {
    const root = new THREE.Group();
    const top = makeBox(6.2, 0.28, 2.35, standardMaterial(0xd7b28e, 0.8), 0.08);
    top.position.y = 1.55;
    const frame = standardMaterial(0x50656e, 0.5, 0.28);
    for (const x of [-2.65, 2.65]) {
        for (const z of [-0.82, 0.82]) {
            const leg = makeBox(0.18, 1.45, 0.18, frame, 0.03);
            leg.position.set(x, 0.75, z);
            root.add(leg);
        }
    }
    const privacy = makeBox(5.5, 0.76, 0.12, standardMaterial(accent, 0.82), 0.04);
    privacy.position.set(0, 1.17, -0.92);
    root.add(top, privacy);
    return root;
}
function createLaptop(accent) {
    const root = new THREE.Group();
    const shell = standardMaterial(0x4d5c64, 0.38, 0.48);
    const base = makeBox(1.45, 0.09, 0.92, shell, 0.035);
    const screenGroup = new THREE.Group();
    screenGroup.position.set(0, 0.08, -0.4);
    screenGroup.rotation.x = -0.18;
    const screenFrame = makeBox(1.4, 0.92, 0.08, shell, 0.04);
    screenFrame.position.y = 0.45;
    const screenMaterial = new THREE.MeshStandardMaterial({
        color: 0xcfe7e3,
        roughness: 0.44,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.22,
    });
    const screen = makeBox(1.17, 0.69, 0.025, screenMaterial, 0.02);
    screen.position.set(0, 0.45, 0.053);
    const lineMaterial = standardMaterial(0xffffff, 0.7);
    for (let index = 0; index < 3; index += 1) {
        const line = makeBox(0.7 - index * 0.12, 0.035, 0.02, lineMaterial, 0.01);
        line.position.set(-0.12 + index * 0.04, 0.58 - index * 0.17, 0.076);
        screenGroup.add(line);
    }
    screenGroup.add(screenFrame, screen);
    root.add(base, screenGroup);
    return { root, screenGroup, screenMaterial };
}
function createBriefcase(color = 0xd6a247) {
    const root = new THREE.Group();
    const body = makeBox(0.72, 0.58, 0.22, standardMaterial(color, 0.82), 0.06);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 7, 18, Math.PI), standardMaterial(0x50656e, 0.54, 0.22));
    handle.position.y = 0.33;
    handle.rotation.z = Math.PI;
    root.add(body, handle);
    return root;
}
function createWardrobe(accent) {
    const root = new THREE.Group();
    const body = makeBox(4.6, 5.2, 1.45, standardMaterial(0xe7d8c9, 0.9), 0.08);
    body.position.y = 2.6;
    const interior = makeBox(4.05, 4.7, 0.9, standardMaterial(0xf6efe7, 0.95), 0.04);
    interior.position.set(0, 2.55, 0.55);
    const leftDoor = new THREE.Group();
    const rightDoor = new THREE.Group();
    leftDoor.position.set(-2.1, 2.6, 0.83);
    rightDoor.position.set(2.1, 2.6, 0.83);
    const doorMaterial = standardMaterial(accent, 0.88);
    const leftPanel = makeBox(2.05, 4.95, 0.13, doorMaterial, 0.06);
    leftPanel.position.x = 1.02;
    const rightPanel = makeBox(2.05, 4.95, 0.13, doorMaterial, 0.06);
    rightPanel.position.x = -1.02;
    const leftKnob = makeSphere(0.07, standardMaterial(0xd6a247, 0.4, 0.5), 10, 8);
    leftKnob.position.set(1.75, 0, 0.12);
    const rightKnob = leftKnob.clone();
    rightKnob.position.x = -1.75;
    leftDoor.add(leftPanel, leftKnob);
    rightDoor.add(rightPanel, rightKnob);
    root.add(body, interior, leftDoor, rightDoor);
    return { root, leftDoor, rightDoor };
}
function createMirror(accent) {
    const root = new THREE.Group();
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: accent,
        roughness: 0.5,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.08,
    });
    const frame = makeBox(3.2, 4.2, 0.18, frameMaterial, 0.08);
    const glass = makeBox(2.78, 3.76, 0.05, standardMaterial(0xc9dfe2, 0.2, 0.38), 0.04);
    glass.position.z = 0.12;
    root.add(frame, glass);
    return { root, frameMaterial };
}
function createPrivacyScreen(accent) {
    const root = new THREE.Group();
    const frame = standardMaterial(0x6b777b, 0.48, 0.25);
    for (const x of [-1.55, 0, 1.55]) {
        const post = makeBox(0.12, 4.6, 0.12, frame, 0.02);
        post.position.set(x, 2.3, 0);
        root.add(post);
    }
    for (const y of [0.5, 4.32]) {
        const rail = makeBox(3.18, 0.1, 0.1, frame, 0.02);
        rail.position.set(0, y, 0);
        root.add(rail);
    }
    const fabricMaterial = standardMaterial(accent, 0.94);
    const insetMaterial = standardMaterial(0xf6e9e3, 0.96);
    const stitchMaterial = standardMaterial(0xd9b8ad, 0.9);
    for (const x of [-0.78, 0.78]) {
        const panel = makeBox(1.42, 3.66, 0.07, fabricMaterial, 0.04);
        panel.position.set(x, 2.41, 0);
        const inset = makeBox(1.12, 3.28, 0.035, insetMaterial, 0.03);
        inset.position.set(x, 2.41, 0.055);
        root.add(panel, inset);
        for (const y of [1.55, 2.41, 3.27]) {
            const stitch = makeBox(0.94, 0.05, 0.02, stitchMaterial, 0.008);
            stitch.position.set(x, y, 0.085);
            root.add(stitch);
        }
    }
    return root;
}
function createAccessibleVan(accent) {
    const root = new THREE.Group();
    const bodyMaterial = standardMaterial(0xf7f5ef, 0.62, 0.08);
    const lowerMaterial = standardMaterial(accent, 0.62, 0.12);
    const dark = standardMaterial(0x344650, 0.42, 0.28);
    const glass = new THREE.MeshStandardMaterial({
        color: 0x9fc2cf,
        roughness: 0.18,
        metalness: 0.18,
        transparent: true,
        opacity: 0.78,
    });
    const lower = makeBox(3.4, 1.15, 6.2, lowerMaterial, 0.12);
    lower.position.y = 0.95;
    const upper = makeBox(3.18, 1.95, 5.55, bodyMaterial, 0.14);
    upper.position.set(0, 2.35, -0.15);
    const frontGlass = makeBox(2.75, 0.92, 0.08, glass, 0.04);
    frontGlass.position.set(0, 2.62, 2.67);
    frontGlass.rotation.x = -0.11;
    root.add(lower, upper, frontGlass);
    for (const side of [-1, 1]) {
        for (const z of [-1.4, 0.45]) {
            const window = makeBox(0.07, 0.86, 1.28, glass, 0.04);
            window.position.set(side * 1.62, 2.48, z);
            root.add(window);
        }
    }
    const wheels = [];
    for (const [x, z] of [
        [-1.45, -1.9],
        [1.45, -1.9],
        [-1.45, 1.85],
        [1.45, 1.85],
    ]) {
        const wheel = createWheel(0.56, false);
        wheel.position.set(x, 0.59, z);
        root.add(wheel);
        wheels.push(wheel);
    }
    const ramp = new THREE.Group();
    ramp.position.set(0, 0.68, -3.08);
    const rampDeck = makeBox(2.45, 0.12, 3.35, standardMaterial(0x7d8d93, 0.48, 0.34), 0.04);
    rampDeck.position.z = -1.68;
    const gripMaterial = standardMaterial(0xd7dee0, 0.64);
    for (let index = 0; index < 8; index += 1) {
        const grip = makeBox(2.22, 0.035, 0.08, gripMaterial, 0.01);
        grip.position.set(0, 0.085, -0.35 - index * 0.39);
        ramp.add(grip);
    }
    for (const side of [-1, 1]) {
        const rail = cylinderBetween(new THREE.Vector3(side * 1.08, 0.12, -0.15), new THREE.Vector3(side * 1.08, 0.56, -3.18), 0.035, standardMaterial(0xe2e8e9, 0.36, 0.5), 8);
        ramp.add(rail);
    }
    for (let index = 0; index < 4; index += 1) {
        const warning = makeBox(0.32, 0.025, 0.72, standardMaterial(index % 2 ? 0x27343a : 0xe1b54d, 0.62), 0.012);
        warning.position.set(-0.95 + index * 0.63, 0.095, -3.05);
        ramp.add(warning);
    }
    ramp.add(rampDeck);
    ramp.rotation.x = Math.PI / 2;
    const leftDoor = makeBox(1.53, 2.8, 0.14, bodyMaterial, 0.06);
    const rightDoor = leftDoor.clone();
    leftDoor.position.set(-0.82, 2.02, -3.04);
    rightDoor.position.set(0.82, 2.02, -3.04);
    const badge = createCanvasPanel("ACCESSIBLE", "travel", accent, 2.4, 0.8);
    badge.position.set(1.73, 1.65, 0.5);
    badge.rotation.y = -Math.PI / 2;
    const bumperFront = makeBox(3.18, 0.34, 0.28, dark, 0.08);
    bumperFront.position.set(0, 0.72, 3.08);
    const bumperRear = bumperFront.clone();
    bumperRear.position.z = -3.08;
    const grille = makeBox(1.72, 0.52, 0.08, standardMaterial(0x26353b, 0.4, 0.5), 0.04);
    grille.position.set(0, 1.26, 3.16);
    root.add(bumperFront, bumperRear, grille);
    const indicatorMaterials = [];
    const brakeMaterials = [];
    for (const side of [-1, 1]) {
        const headlightMaterial = new THREE.MeshStandardMaterial({
            color: 0xfff3cf,
            roughness: 0.3,
            emissive: new THREE.Color(0xffd57e),
            emissiveIntensity: 0.42,
        });
        const headlight = makeBox(0.64, 0.38, 0.08, headlightMaterial, 0.06);
        headlight.position.set(side * 1.02, 1.45, 3.19);
        const indicatorMaterial = new THREE.MeshStandardMaterial({
            color: 0xe4a438,
            roughness: 0.34,
            emissive: new THREE.Color(0xe49b2b),
            emissiveIntensity: 0.08,
        });
        const indicator = makeBox(0.25, 0.18, 0.09, indicatorMaterial, 0.04);
        indicator.position.set(side * 1.33, 1.2, 3.2);
        indicatorMaterials.push(indicatorMaterial);
        const brakeMaterial = new THREE.MeshStandardMaterial({
            color: 0xb8443f,
            roughness: 0.38,
            emissive: new THREE.Color(0xc9403b),
            emissiveIntensity: 0.12,
        });
        const brake = makeBox(0.55, 0.58, 0.09, brakeMaterial, 0.06);
        brake.position.set(side * 1.08, 1.5, -3.2);
        brakeMaterials.push(brakeMaterial);
        root.add(headlight, indicator, brake);
        const mirrorStem = cylinderBetween(new THREE.Vector3(side * 1.62, 2.55, 1.9), new THREE.Vector3(side * 1.9, 2.55, 2.0), 0.035, dark, 7);
        const mirror = makeBox(0.22, 0.42, 0.55, dark, 0.08);
        mirror.position.set(side * 1.95, 2.55, 2.02);
        root.add(mirrorStem, mirror);
    }
    const frontPlate = makeBox(1.15, 0.34, 0.05, standardMaterial(0xfffdf8, 0.72), 0.035);
    frontPlate.position.set(0, 0.78, 3.25);
    const rearPlate = frontPlate.clone();
    rearPlate.position.z = -3.25;
    const plateStripe = makeBox(0.86, 0.055, 0.015, standardMaterial(0x344650, 0.58), 0.01);
    plateStripe.position.set(0, 0.02, 0.04);
    frontPlate.add(plateStripe);
    rearPlate.add(plateStripe.clone());
    root.add(frontPlate, rearPlate);
    for (const side of [-1, 1]) {
        const handle = makeBox(0.42, 0.06, 0.06, dark, 0.018);
        handle.position.set(side * 1.66, 2.02, -1.0);
        root.add(handle);
    }
    const wheelchairBadge = new THREE.Group();
    const badgeBase = makeBox(0.78, 0.78, 0.045, standardMaterial(accent, 0.7), 0.09);
    const badgeWheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 20), standardMaterial(0xffffff, 0.68));
    badgeWheel.position.set(-0.07, -0.08, 0.055);
    const badgeHead = makeSphere(0.07, standardMaterial(0xffffff, 0.68), 10, 7);
    badgeHead.position.set(0.03, 0.22, 0.055);
    const badgeBody = makeBox(0.08, 0.27, 0.055, standardMaterial(0xffffff, 0.68), 0.02);
    badgeBody.position.set(0.03, 0.06, 0.055);
    badgeBody.rotation.z = -0.45;
    wheelchairBadge.add(badgeBase, badgeWheel, badgeHead, badgeBody);
    wheelchairBadge.position.set(1.73, 2.52, -0.85);
    wheelchairBadge.rotation.y = -Math.PI / 2;
    root.add(wheelchairBadge);
    const interiorLightMaterial = new THREE.MeshStandardMaterial({
        color: 0xffefd1,
        roughness: 0.32,
        emissive: new THREE.Color(0xffc966),
        emissiveIntensity: 0.08,
    });
    const interiorLight = makeBox(1.2, 0.08, 0.4, interiorLightMaterial, 0.03);
    interiorLight.position.set(0, 3.14, -2.62);
    root.add(ramp, leftDoor, rightDoor, badge, interiorLight);
    root.add(createContactShadow(2.3, 3.35, 0.12));
    return {
        root,
        wheels,
        ramp,
        leftDoor,
        rightDoor,
        indicatorMaterials,
        brakeMaterials,
        interiorLightMaterial,
    };
}
function createKitchen(accent) {
    const root = new THREE.Group();
    const cabinetry = standardMaterial(0xf7f1e8, 0.9);
    const timber = standardMaterial(0xd7b28e, 0.78);
    const dark = standardMaterial(0x405660, 0.46, 0.2);
    const backCounter = makeBox(10.8, 1.6, 1.65, cabinetry, 0.08);
    backCounter.position.set(4.3, 0.8, -5.8);
    const backTop = makeBox(11.1, 0.16, 1.85, timber, 0.05);
    backTop.position.set(4.3, 1.65, -5.75);
    const island = makeBox(6.5, 1.55, 2.25, standardMaterial(accent, 0.9), 0.08);
    island.position.set(-1.2, 0.78, -0.1);
    const islandTop = makeBox(6.8, 0.17, 2.5, timber, 0.05);
    islandTop.position.set(-1.2, 1.61, -0.1);
    const fridge = makeBox(2.4, 5.2, 1.8, standardMaterial(0xe5eaeb, 0.45, 0.28), 0.1);
    fridge.position.set(10.2, 2.6, -5.65);
    const fridgeSplit = makeBox(2.15, 0.06, 0.05, standardMaterial(0x9aabad, 0.42, 0.35), 0.015);
    fridgeSplit.position.set(10.2, 2.65, -4.72);
    const fridgeHandleTop = makeBox(0.08, 1.45, 0.08, standardMaterial(0x71858b, 0.34, 0.52), 0.018);
    fridgeHandleTop.position.set(9.42, 3.65, -4.69);
    const fridgeHandleBottom = makeBox(0.08, 1.12, 0.08, standardMaterial(0x71858b, 0.34, 0.52), 0.018);
    fridgeHandleBottom.position.set(9.42, 1.52, -4.69);
    const stove = makeBox(2.1, 0.08, 1.25, dark, 0.03);
    stove.position.set(2.3, 1.76, -5.42);
    const sink = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 0.95), standardMaterial(0x93a8ae, 0.32, 0.55));
    sink.position.set(6.2, 1.76, -5.52);
    root.add(backCounter, backTop, island, islandTop, fridge, fridgeSplit, fridgeHandleTop, fridgeHandleBottom, stove, sink);
    const cabinetMaterial = standardMaterial(0xf4eee6, 0.9);
    const handleMaterial = standardMaterial(0x71858b, 0.34, 0.52);
    for (let index = 0; index < 4; index += 1) {
        const cabinet = makeBox(2.25, 1.72, 0.82, cabinetMaterial, 0.07);
        cabinet.position.set(-0.2 + index * 2.55, 4.08, -6.12);
        const handle = makeBox(0.62, 0.06, 0.06, handleMaterial, 0.015);
        handle.position.set(cabinet.position.x, 3.66, -5.68);
        root.add(cabinet, handle);
    }
    const tileMaterialA = standardMaterial(0xdce8e5, 0.74);
    const tileMaterialB = standardMaterial(0xf4ebe0, 0.8);
    for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 12; column += 1) {
            const tile = makeBox(0.78, 0.48, 0.035, (row + column) % 2 ? tileMaterialA : tileMaterialB, 0.018);
            tile.position.set(-0.6 + column * 0.82, 2.23 + row * 0.52, -6.24);
            root.add(tile);
        }
    }
    const ovenMaterial = new THREE.MeshStandardMaterial({
        color: 0x293b43,
        roughness: 0.32,
        metalness: 0.2,
        emissive: new THREE.Color(0xd6a247),
        emissiveIntensity: 0.04,
    });
    const oven = makeBox(2.2, 1.15, 0.12, ovenMaterial, 0.055);
    oven.position.set(2.3, 0.75, -4.9);
    const ovenHandle = makeBox(1.5, 0.08, 0.09, handleMaterial, 0.018);
    ovenHandle.position.set(2.3, 1.18, -4.79);
    root.add(oven, ovenHandle);
    for (const [x, z, radius] of [
        [1.82, -5.65, 0.34],
        [2.78, -5.65, 0.34],
        [1.82, -5.17, 0.28],
        [2.78, -5.17, 0.28],
    ]) {
        const burner = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.035, 7, 20), standardMaterial(0x1f3037, 0.46, 0.28));
        burner.rotation.x = -Math.PI / 2;
        burner.position.set(x, 1.82, z);
        root.add(burner);
    }
    const faucet = new THREE.Group();
    const faucetMaterial = standardMaterial(0x8fa2a7, 0.25, 0.62);
    const stem = makeBox(0.09, 0.72, 0.09, faucetMaterial, 0.02);
    stem.position.set(6.2, 2.12, -6.0);
    const neck = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.045, 8, 18, Math.PI), faucetMaterial);
    neck.position.set(6.2, 2.45, -5.65);
    neck.rotation.y = Math.PI / 2;
    neck.rotation.z = Math.PI;
    const spout = makeBox(0.09, 0.09, 0.52, faucetMaterial, 0.02);
    spout.position.set(6.2, 2.45, -5.35);
    faucet.add(stem, neck, spout);
    root.add(faucet);
    const magnetColours = [accent, 0xd47e6c, 0xd6a247, 0x6f91c2];
    for (let index = 0; index < 6; index += 1) {
        const magnet = makeBox(0.22 + (index % 2) * 0.08, 0.28, 0.04, standardMaterial(magnetColours[index % magnetColours.length], 0.74), 0.035);
        magnet.position.set(9.72 + (index % 2) * 0.48, 3.2 + Math.floor(index / 2) * 0.55, -4.71);
        magnet.rotation.z = (index - 2) * 0.04;
        root.add(magnet);
    }
    const islandShelf = makeBox(4.8, 0.12, 1.5, standardMaterial(0xd7b28e, 0.82), 0.04);
    islandShelf.position.set(-1.2, 0.46, -0.1);
    root.add(islandShelf);
    for (let index = 0; index < 4; index += 1) {
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.26, 0.18, 16), standardMaterial(index % 2 ? 0xd47e6c : 0x6f91c2, 0.74));
        bowl.position.set(-2.55 + index * 0.9, 0.62, -0.1);
        root.add(bowl);
    }
    const pot = new THREE.Group();
    const potBody = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.46, 0.65, 18), standardMaterial(0x657984, 0.36, 0.46));
    potBody.position.y = 0.34;
    const handleA = makeBox(0.55, 0.1, 0.12, dark, 0.03);
    const handleB = handleA.clone();
    handleA.position.set(-0.7, 0.45, 0);
    handleB.position.set(0.7, 0.45, 0);
    pot.add(potBody, handleA, handleB);
    pot.position.set(2.3, 1.78, -5.42);
    root.add(pot);
    const steam = new THREE.Group();
    const steamMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
    });
    for (let index = 0; index < 12; index += 1) {
        const puff = makeSphere(0.11 + (index % 3) * 0.025, steamMaterial, 10, 7);
        steam.add(puff);
    }
    root.add(steam);
    const table = new THREE.Group();
    const top = makeBox(4.5, 0.22, 3.2, timber, 0.08);
    top.position.y = 1.35;
    for (const [x, z] of [
        [-1.8, -1.15],
        [1.8, -1.15],
        [-1.8, 1.15],
        [1.8, 1.15],
    ]) {
        const leg = makeBox(0.16, 1.3, 0.16, dark, 0.03);
        leg.position.set(x, 0.66, z);
        table.add(leg);
    }
    table.add(top);
    table.position.set(8.2, 0, 2.8);
    root.add(table);
    const diningChairs = [
        [5.9, 0, 2.8, Math.PI / 2],
        [10.5, 0, 2.8, -Math.PI / 2],
        [8.2, 0, 0.85, 0],
        [8.2, 0, 4.75, Math.PI],
    ];
    diningChairs.forEach(([x, y, z, rotation], index) => {
        const chair = createDiningChair(index % 2 ? 0x7fa78d : 0xd6a247);
        chair.scale.setScalar(0.72);
        chair.position.set(x, y, z);
        chair.rotation.y = rotation;
        root.add(chair);
    });
    const fruitBowl = createFruitBowl();
    fruitBowl.position.set(8.2, 1.48, 2.8);
    root.add(fruitBowl);
    const cuttingBoard = makeBox(1.8, 0.08, 1.15, standardMaterial(0xc89e77, 0.8), 0.04);
    cuttingBoard.position.set(-1.2, 1.75, -0.1);
    const knifeBlade = makeBox(0.85, 0.035, 0.16, standardMaterial(0xb8c4c7, 0.24, 0.68), 0.015);
    knifeBlade.position.set(-1.3, 1.82, -0.15);
    knifeBlade.rotation.y = -0.28;
    const knifeHandle = makeBox(0.38, 0.08, 0.19, standardMaterial(0x43555d, 0.48), 0.025);
    knifeHandle.position.set(-0.78, 1.83, 0.01);
    knifeHandle.rotation.y = -0.28;
    root.add(cuttingBoard, knifeBlade, knifeHandle);
    const pendantMaterials = [];
    for (const x of [-2.45, 0.05]) {
        const cord = makeBox(0.035, 0.85, 0.035, standardMaterial(0x52646a, 0.46, 0.38), 0.008);
        cord.position.set(x, 4.5, -0.1);
        const shade = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.58, 16, 1, false), standardMaterial(accent, 0.62));
        shade.position.set(x, 3.78, -0.1);
        const material = new THREE.MeshStandardMaterial({
            color: 0xffefc1,
            roughness: 0.32,
            emissive: new THREE.Color(0xffcc63),
            emissiveIntensity: 0.45,
        });
        pendantMaterials.push(material);
        const bulb = makeSphere(0.15, material, 11, 7);
        bulb.position.set(x, 3.52, -0.1);
        root.add(cord, shade, bulb);
    }
    return { root, pot, steam, table, ovenMaterial, pendantMaterials, faucet };
}
function createWashingMachine(accent) {
    const root = new THREE.Group();
    const body = makeBox(3.1, 4.2, 2.2, standardMaterial(0xf5f4ef, 0.72), 0.12);
    body.position.y = 2.1;
    const panel = makeBox(2.55, 0.52, 0.14, standardMaterial(accent, 0.72), 0.05);
    panel.position.set(0, 3.65, 1.13);
    const drawer = makeBox(0.82, 0.25, 0.08, standardMaterial(0xfffdf8, 0.78), 0.035);
    drawer.position.set(-0.72, 3.67, 1.24);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 20), standardMaterial(0x657984, 0.32, 0.54));
    dial.rotation.x = Math.PI / 2;
    dial.position.set(0.52, 3.67, 1.25);
    const statusLightMaterial = new THREE.MeshStandardMaterial({
        color: 0x7fc9a5,
        roughness: 0.32,
        emissive: new THREE.Color(0x66d3a1),
        emissiveIntensity: 0.08,
    });
    const statusLight = makeSphere(0.07, statusLightMaterial, 10, 7);
    statusLight.position.set(1.05, 3.67, 1.24);
    const drumMaterial = new THREE.MeshStandardMaterial({
        color: 0x9fc2cf,
        roughness: 0.18,
        metalness: 0.28,
        transparent: true,
        opacity: 0.76,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.1,
    });
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.2, 28), drumMaterial);
    drum.rotation.x = Math.PI / 2;
    drum.position.set(0, 2.05, 1.18);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.12, 10, 30), standardMaterial(0x72838a, 0.36, 0.45));
    rim.position.set(0, 2.05, 1.26);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.16, 26, 1, true), standardMaterial(0x5f747c, 0.28, 0.48));
    inner.rotation.x = Math.PI / 2;
    inner.position.set(0, 2.05, 1.08);
    const clothes = new THREE.Group();
    const colours = [accent, 0xd47e6c, 0x6f91c2, 0x7fa78d, 0xfffdf8];
    for (let index = 0; index < 8; index += 1) {
        const cloth = makeSphere(0.2 + (index % 3) * 0.035, standardMaterial(colours[index % colours.length], 0.92), 10, 7);
        const angle = (index / 8) * Math.PI * 2;
        cloth.scale.set(1.25, 0.7, 0.65);
        cloth.position.set(Math.sin(angle) * 0.55, Math.cos(angle) * 0.52, 1.16 + (index % 2) * 0.04);
        clothes.add(cloth);
    }
    clothes.position.set(0, 2.05, 0);
    for (const [x, z] of [
        [-1.16, -0.82],
        [1.16, -0.82],
        [-1.16, 0.82],
        [1.16, 0.82],
    ]) {
        const foot = makeBox(0.22, 0.14, 0.22, standardMaterial(0x4d5e65, 0.58), 0.04);
        foot.position.set(x, 0.07, z);
        root.add(foot);
    }
    root.add(body, panel, drawer, dial, statusLight, drum, inner, clothes, rim);
    return { root, drum, drumMaterial, clothes, dial, statusLightMaterial };
}
function createVacuum(accent) {
    const root = new THREE.Group();
    const dark = standardMaterial(0x536771, 0.5, 0.24);
    const metal = standardMaterial(0x70858c, 0.34, 0.42);
    const accentMaterial = standardMaterial(accent, 0.62, 0.1);
    const head = makeBox(1.2, 0.22, 0.68, accentMaterial, 0.08);
    head.position.set(0, 0.14, 0.77);
    const brush = makeBox(0.92, 0.055, 0.12, standardMaterial(0x26383f, 0.78), 0.018);
    brush.position.set(0, 0.035, 1.05);
    const body = makeSphere(0.4, dark, 16, 11);
    body.scale.set(0.88, 1.16, 0.82);
    body.position.set(0, 0.54, 0.17);
    const bodyBand = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.045, 8, 20), accentMaterial);
    bodyBand.rotation.x = Math.PI / 2;
    bodyBand.position.set(0, 0.58, 0.19);
    const handle = cylinderBetween(new THREE.Vector3(0, 0.6, 0.15), new THREE.Vector3(0, 1.92, -0.62), 0.045, metal, 9);
    const grip = cylinderBetween(new THREE.Vector3(-0.2, 1.88, -0.6), new THREE.Vector3(0.2, 1.88, -0.6), 0.055, standardMaterial(0x33464d, 0.7), 9);
    const hoseCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.22, 0.57, 0.1),
        new THREE.Vector3(0.58, 0.8, -0.12),
        new THREE.Vector3(0.34, 1.18, -0.42),
        new THREE.Vector3(0.08, 1.62, -0.57),
    ]);
    const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 18, 0.03, 7, false), standardMaterial(0x35484f, 0.62, 0.2));
    const wheelMaterial = standardMaterial(0x25363d, 0.74);
    const wheels = [];
    for (const side of [-1, 1]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 14), wheelMaterial);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 0.34, 0.21, 0.02);
        wheels.push(wheel);
        root.add(wheel);
    }
    const indicatorMaterial = new THREE.MeshStandardMaterial({
        color: 0x9fe1c0,
        roughness: 0.32,
        emissive: new THREE.Color(0x62d99e),
        emissiveIntensity: 0.12,
    });
    const indicator = makeSphere(0.055, indicatorMaterial, 9, 6);
    indicator.position.set(0, 0.79, 0.46);
    root.add(head, brush, body, bodyBand, handle, grip, hose, indicator);
    return { root, head, wheels, indicatorMaterial };
}
function createArtStation(accent) {
    const root = new THREE.Group();
    const timber = standardMaterial(0xd7b28e, 0.82);
    const frameMaterial = standardMaterial(0x596b72, 0.5, 0.25);
    const tableTop = makeBox(6.4, 0.24, 3.3, timber, 0.1);
    tableTop.position.y = 1.42;
    const edge = makeBox(6.5, 0.16, 0.16, standardMaterial(accent, 0.78), 0.035);
    edge.position.set(0, 1.31, 1.62);
    root.add(tableTop, edge);
    for (const [x, z] of [
        [-2.65, -1.25],
        [2.65, -1.25],
        [-2.65, 1.22],
        [2.65, 1.22],
    ]) {
        const leg = makeBox(0.18, 1.38, 0.18, frameMaterial, 0.03);
        leg.position.set(x, 0.7, z);
        root.add(leg);
    }
    const crossBrace = makeBox(5.1, 0.13, 0.13, frameMaterial, 0.025);
    crossBrace.position.set(0, 0.55, -1.22);
    root.add(crossBrace);
    const paper = makeBox(2.4, 0.035, 1.55, standardMaterial(0xfffdf8, 0.98), 0.028);
    paper.position.set(-0.35, 1.57, 0.05);
    paper.rotation.y = -0.08;
    root.add(paper);
    const strokes = [];
    const paletteColours = [accent, 0xd6a247, 0x6f91c2, 0x7fa78d, 0xd47e6c, 0x806f98];
    for (let index = 0; index < 7; index += 1) {
        const stroke = makeBox(0.48 + (index % 3) * 0.18, 0.022, 0.07 + (index % 2) * 0.035, standardMaterial(paletteColours[index % paletteColours.length], 0.74), 0.018);
        stroke.position.set(-0.92 + (index % 4) * 0.55, 1.6, -0.42 + Math.floor(index / 4) * 0.66);
        stroke.rotation.y = -0.35 + index * 0.12;
        strokes.push(stroke);
        root.add(stroke);
    }
    const paintPots = [];
    for (let index = 0; index < 5; index += 1) {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.34, 12), standardMaterial(paletteColours[index], 0.72));
        pot.position.set(-2.35 + index * 0.48, 1.72, -1.0);
        paintPots.push(pot);
        root.add(pot);
    }
    const brushJar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.19, 0.45, 14), standardMaterial(0x6f91c2, 0.64, 0.12));
    brushJar.position.set(2.35, 1.78, -0.92);
    root.add(brushJar);
    const brushes = [];
    for (let index = 0; index < 6; index += 1) {
        const brush = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.86 + (index % 2) * 0.16, 7), standardMaterial(index % 2 ? 0xa8784f : 0xd6a247, 0.7));
        brush.position.set(2.21 + index * 0.06, 2.25 + (index % 2) * 0.06, -0.94 + Math.sin(index) * 0.07);
        brush.rotation.z = -0.16 + index * 0.06;
        brushes.push(brush);
        root.add(brush);
    }
    const palette = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.065, 22), standardMaterial(0xe2bc93, 0.8));
    palette.scale.z = 0.72;
    palette.position.set(1.55, 1.62, 0.92);
    palette.rotation.set(0.08, 0.22, 0.02);
    root.add(palette);
    for (let index = 0; index < 5; index += 1) {
        const dab = makeSphere(0.1, standardMaterial(paletteColours[index], 0.76), 9, 6);
        const angle = (index / 5) * Math.PI * 2;
        dab.scale.y = 0.28;
        dab.position.set(palette.position.x + Math.sin(angle) * 0.36, 1.67, palette.position.z + Math.cos(angle) * 0.25);
        root.add(dab);
    }
    const easel = new THREE.Group();
    const canvas = makeBox(3.8, 2.8, 0.14, standardMaterial(0xfffdf8, 0.94), 0.05);
    canvas.position.y = 2.6;
    const canvasFrame = makeBox(4.08, 3.08, 0.08, standardMaterial(0xb58e68, 0.78), 0.04);
    canvasFrame.position.set(0, 2.6, -0.08);
    const innerCanvas = makeBox(3.72, 2.72, 0.08, standardMaterial(0xfffdf8, 0.98), 0.035);
    innerCanvas.position.set(0, 2.6, 0.05);
    const legs = [
        cylinderBetween(new THREE.Vector3(-1.1, 0, 0), new THREE.Vector3(-0.7, 1.45, 0), 0.06, timber, 8),
        cylinderBetween(new THREE.Vector3(1.1, 0, 0), new THREE.Vector3(0.7, 1.45, 0), 0.06, timber, 8),
        cylinderBetween(new THREE.Vector3(0, 0, -0.58), new THREE.Vector3(0, 1.45, -0.12), 0.05, timber, 8),
    ];
    const dots = [];
    for (let index = 0; index < 24; index += 1) {
        const dot = makeSphere(0.09 + (index % 4) * 0.018, standardMaterial(paletteColours[index % paletteColours.length], 0.74), 10, 7);
        dot.scale.z = 0.24;
        dot.position.set(-1.45 + (index % 8) * 0.42, 1.72 + Math.floor(index / 8) * 0.55, 0.13);
        dot.visible = false;
        dots.push(dot);
        easel.add(dot);
    }
    const canvasShelf = makeBox(4.2, 0.12, 0.42, timber, 0.03);
    canvasShelf.position.set(0, 1.14, 0.16);
    easel.add(canvasFrame, canvas, innerCanvas, canvasShelf, ...legs);
    easel.position.set(7.2, 0, -5.45);
    root.add(easel);
    const speaker = makeBox(1.05, 1.42, 0.72, standardMaterial(0x354a52, 0.52, 0.28), 0.12);
    speaker.position.set(-3.65, 0.78, -0.78);
    const speakerMaterial = new THREE.MeshStandardMaterial({
        color: accent,
        roughness: 0.42,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.12,
    });
    for (const [y, radius] of [[0.35, 0.27], [-0.28, 0.2]]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.045, 8, 20), speakerMaterial);
        ring.position.set(0, y, 0.39);
        speaker.add(ring);
    }
    const handle = makeBox(0.55, 0.09, 0.12, frameMaterial, 0.025);
    handle.position.set(0, 0.82, 0);
    speaker.add(handle);
    root.add(speaker);
    const notes = new THREE.Group();
    const noteMaterial = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.56,
        depthWrite: false,
    });
    for (let index = 0; index < 16; index += 1) {
        const note = makeSphere(0.09 + (index % 2) * 0.04, noteMaterial, 10, 7);
        notes.add(note);
    }
    root.add(notes);
    return { root, dots, notes, paintPots, brushes, strokes, speakerMaterial };
}
function createPatternedRug(width, depth, baseColor, accent) {
    const root = new THREE.Group();
    const base = makeBox(width, 0.085, depth, standardMaterial(baseColor, 0.98), 0.055);
    base.position.y = 0.11;
    base.receiveShadow = true;
    root.add(base);
    const borderMaterial = standardMaterial(accent, 0.92);
    const borderThickness = 0.12;
    for (const [w, d, x, z] of [
        [width - 0.24, borderThickness, 0, depth * 0.5 - 0.16],
        [width - 0.24, borderThickness, 0, -depth * 0.5 + 0.16],
        [borderThickness, depth - 0.24, width * 0.5 - 0.16, 0],
        [borderThickness, depth - 0.24, -width * 0.5 + 0.16, 0],
    ]) {
        const border = makeBox(w, 0.025, d, borderMaterial, 0.018);
        border.position.set(x, 0.165, z);
        root.add(border);
    }
    const motifMaterial = new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        toneMapped: false,
    });
    for (let index = -2; index <= 2; index += 1) {
        const motif = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 6), motifMaterial);
        motif.rotation.x = -Math.PI / 2;
        motif.rotation.z = Math.PI / 6;
        motif.position.set(index * (width / 6), 0.172, Math.sin(index * 1.7) * depth * 0.16);
        root.add(motif);
    }
    return root;
}
function createOfficeChair(accent) {
    const root = new THREE.Group();
    const dark = standardMaterial(0x52656d, 0.5, 0.26);
    const upholstery = standardMaterial(accent, 0.78);
    const seat = makeBox(1.25, 0.2, 1.25, upholstery, 0.09);
    seat.position.y = 1.05;
    const back = makeBox(1.3, 1.45, 0.2, upholstery, 0.1);
    back.position.set(0, 1.82, -0.52);
    back.rotation.x = -0.08;
    const stem = makeBox(0.13, 0.82, 0.13, dark, 0.025);
    stem.position.y = 0.58;
    const hub = makeSphere(0.18, dark, 12, 8);
    hub.position.y = 0.22;
    root.add(seat, back, stem, hub);
    for (let index = 0; index < 5; index += 1) {
        const angle = (index / 5) * Math.PI * 2;
        const arm = cylinderBetween(new THREE.Vector3(0, 0.22, 0), new THREE.Vector3(Math.sin(angle) * 0.67, 0.16, Math.cos(angle) * 0.67), 0.035, dark, 7);
        const caster = makeSphere(0.1, standardMaterial(0x26353b, 0.68), 10, 7);
        caster.scale.set(0.72, 1, 0.72);
        caster.position.set(Math.sin(angle) * 0.73, 0.11, Math.cos(angle) * 0.73);
        root.add(arm, caster);
    }
    for (const side of [-1, 1]) {
        const armRest = makeBox(0.14, 0.1, 0.92, dark, 0.035);
        armRest.position.set(side * 0.73, 1.38, -0.02);
        const support = makeBox(0.09, 0.52, 0.09, dark, 0.02);
        support.position.set(side * 0.73, 1.17, -0.22);
        root.add(armRest, support);
    }
    return root;
}
function createBookshelf(accent) {
    const root = new THREE.Group();
    const timber = standardMaterial(0xb99674, 0.84);
    const frame = makeBox(3.55, 5.1, 0.38, timber, 0.08);
    frame.position.set(0, 2.55, -0.45);
    const inner = makeBox(3.14, 4.66, 0.58, standardMaterial(0xf4ece2, 0.96), 0.04);
    inner.position.set(0, 2.5, -0.17);
    root.add(frame, inner);
    const colours = [accent, 0x6f91c2, 0x7fa78d, 0xd47e6c, 0x806f98, 0xd6a247];
    for (let shelfIndex = 0; shelfIndex < 4; shelfIndex += 1) {
        const shelf = makeBox(3.15, 0.12, 0.72, timber, 0.025);
        shelf.position.set(0, 0.72 + shelfIndex * 1.05, 0);
        root.add(shelf);
        for (let bookIndex = 0; bookIndex < 5; bookIndex += 1) {
            const height = 0.48 + ((bookIndex + shelfIndex) % 3) * 0.12;
            const book = makeBox(0.28 + ((bookIndex + 1) % 2) * 0.06, height, 0.46, standardMaterial(colours[(bookIndex + shelfIndex) % colours.length], 0.86), 0.02);
            book.position.set(-1.2 + bookIndex * 0.52, 0.82 + shelfIndex * 1.05 + height * 0.5, 0.07);
            book.rotation.z = bookIndex === 4 ? -0.08 : 0;
            root.add(book);
        }
    }
    const storageBox = makeBox(1.05, 0.58, 0.62, standardMaterial(accent, 0.88), 0.05);
    storageBox.position.set(0.85, 0.42, 0.06);
    root.add(storageBox);
    return root;
}
function createWallClock(accent) {
    const root = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.12, 30), standardMaterial(0xfffdf8, 0.74));
    face.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.065, 9, 30), standardMaterial(accent, 0.5, 0.2));
    const dotMaterial = standardMaterial(0x405660, 0.7);
    for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2;
        const dot = makeSphere(index % 3 === 0 ? 0.045 : 0.028, dotMaterial, 8, 6);
        dot.position.set(Math.sin(angle) * 0.55, Math.cos(angle) * 0.55, 0.095);
        root.add(dot);
    }
    const hour = makeBox(0.055, 0.4, 0.035, dotMaterial, 0.01);
    hour.position.set(0, 0.16, 0.105);
    const minute = makeBox(0.04, 0.55, 0.035, standardMaterial(accent, 0.62), 0.01);
    minute.position.set(0, 0.23, 0.11);
    root.add(face, rim, hour, minute);
    return { root, hour, minute };
}
function createMug(color) {
    const root = new THREE.Group();
    const material = standardMaterial(color, 0.68);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.42, 16), material);
    cup.position.y = 0.21;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.035, 7, 16, Math.PI * 1.55), material);
    handle.position.set(0.18, 0.23, 0);
    handle.rotation.y = Math.PI / 2;
    handle.rotation.z = -Math.PI * 0.78;
    root.add(cup, handle);
    return root;
}
function createClipboard(accent) {
    const root = new THREE.Group();
    const board = makeBox(1.25, 1.75, 0.09, standardMaterial(0xd7b28e, 0.84), 0.05);
    const paper = makeBox(1.05, 1.42, 0.035, standardMaterial(0xfffdf8, 0.95), 0.025);
    paper.position.set(0, -0.07, 0.07);
    const clip = makeBox(0.42, 0.17, 0.06, standardMaterial(0x637780, 0.38, 0.5), 0.025);
    clip.position.set(0, 0.77, 0.1);
    root.add(board, paper, clip);
    for (let index = 0; index < 4; index += 1) {
        const line = makeBox(0.72 - index * 0.08, 0.035, 0.018, standardMaterial(index === 0 ? accent : 0x9aa9ad, 0.76), 0.008);
        line.position.set(-0.08, 0.42 - index * 0.28, 0.105);
        root.add(line);
    }
    return root;
}
function createFloorLamp(accent) {
    const root = new THREE.Group();
    const metal = standardMaterial(0x62777e, 0.38, 0.45);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.6, 0.12, 20), metal);
    base.position.y = 0.06;
    const pole = makeBox(0.09, 3.65, 0.09, metal, 0.018);
    pole.position.y = 1.88;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.78, 18, 1, true), standardMaterial(accent, 0.66));
    shade.position.y = 3.75;
    const bulbMaterial = new THREE.MeshStandardMaterial({
        color: 0xffe7aa,
        roughness: 0.35,
        emissive: new THREE.Color(0xffc85d),
        emissiveIntensity: 0.55,
    });
    const bulb = makeSphere(0.16, bulbMaterial, 12, 8);
    bulb.position.y = 3.49;
    root.add(base, pole, shade, bulb);
    return { root, bulbMaterial };
}
function createToiletrySet(accent) {
    const root = new THREE.Group();
    const tray = makeBox(2.4, 0.12, 0.9, standardMaterial(0xd9c6b2, 0.82), 0.05);
    tray.position.y = 0.06;
    root.add(tray);
    const colours = [accent, 0x7fa78d, 0x6f91c2, 0xd6a247, 0xfffdf8];
    for (let index = 0; index < 5; index += 1) {
        const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.13 + (index % 2) * 0.035, 0.15, 0.42 + (index % 3) * 0.12, 12), standardMaterial(colours[index], 0.78));
        bottle.position.set(-0.83 + index * 0.42, 0.25 + (index % 3) * 0.06, 0);
        const cap = makeBox(0.18, 0.1, 0.18, standardMaterial(0x4f6269, 0.5, 0.25), 0.02);
        cap.position.set(bottle.position.x, bottle.position.y + 0.28 + (index % 3) * 0.06, 0);
        root.add(bottle, cap);
    }
    return root;
}
function createAccessibleBathroomDetails(accent) {
    const root = new THREE.Group();
    const glassMaterial = new THREE.MeshStandardMaterial({
        color: 0xcbe3e6,
        roughness: 0.12,
        metalness: 0.08,
        transparent: true,
        opacity: 0.42,
    });
    const showerFloor = makeBox(5.1, 0.08, 4.1, standardMaterial(0xe7eeee, 0.88), 0.04);
    showerFloor.position.set(0, 0.08, 0);
    const glass = makeBox(0.09, 4.4, 4.0, glassMaterial, 0.03);
    glass.position.set(-2.5, 2.25, 0);
    const railMaterial = standardMaterial(0x71868d, 0.34, 0.56);
    const verticalRail = makeBox(0.1, 2.5, 0.1, railMaterial, 0.02);
    verticalRail.position.set(1.85, 2.0, -1.88);
    const horizontalRail = makeBox(2.4, 0.1, 0.1, railMaterial, 0.02);
    horizontalRail.position.set(0.7, 1.15, -1.88);
    const stoolSeat = makeBox(1.55, 0.18, 1.25, standardMaterial(0xfffdf8, 0.72), 0.08);
    stoolSeat.position.set(-0.25, 1.15, -0.2);
    const stoolLegMaterial = standardMaterial(0x657984, 0.36, 0.5);
    root.add(showerFloor, glass, verticalRail, horizontalRail, stoolSeat);
    for (const [x, z] of [
        [-0.6, -0.45],
        [0.1, -0.45],
        [-0.6, 0.15],
        [0.1, 0.15],
    ]) {
        const leg = makeBox(0.08, 1.1, 0.08, stoolLegMaterial, 0.015);
        leg.position.set(x, 0.56, z);
        root.add(leg);
    }
    const showerHead = makeSphere(0.22, railMaterial, 14, 9);
    showerHead.scale.set(1.1, 0.36, 1.1);
    showerHead.position.set(1.85, 3.62, -1.76);
    showerHead.rotation.x = 0.3;
    const pipe = cylinderBetween(new THREE.Vector3(1.85, 2.75, -1.86), new THREE.Vector3(1.85, 3.55, -1.82), 0.04, railMaterial, 8);
    const bathMat = createPatternedRug(3.0, 1.8, 0xf2ded7, accent);
    bathMat.position.set(0.2, 0, 2.7);
    root.add(showerHead, pipe, bathMat);
    return root;
}
function createTactilePaving(width, depth, accent) {
    const root = new THREE.Group();
    const base = makeBox(width, 0.08, depth, standardMaterial(accent, 0.84), 0.035);
    base.position.y = 0.08;
    root.add(base);
    const dotMaterial = standardMaterial(0xe9d58f, 0.72);
    const columns = Math.max(2, Math.floor(width / 0.42));
    const rows = Math.max(2, Math.floor(depth / 0.42));
    for (let xIndex = 0; xIndex < columns; xIndex += 1) {
        for (let zIndex = 0; zIndex < rows; zIndex += 1) {
            const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.055, 10), dotMaterial);
            dot.position.set(-width * 0.5 + 0.25 + xIndex * ((width - 0.5) / Math.max(1, columns - 1)), 0.14, -depth * 0.5 + 0.25 + zIndex * ((depth - 0.5) / Math.max(1, rows - 1)));
            root.add(dot);
        }
    }
    return root;
}
function createStreetTree(accent = 0x7fa78d) {
    const root = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 3.6, 12), standardMaterial(0x8b664b, 0.94));
    trunk.position.y = 1.8;
    root.add(trunk);
    const leafMaterial = standardMaterial(accent, 0.92);
    for (const [x, y, z, scale] of [
        [0, 4.1, 0, 1.4],
        [-0.8, 3.85, 0.15, 1.0],
        [0.8, 3.85, -0.1, 1.05],
        [0.05, 4.75, -0.15, 0.9],
    ]) {
        const crown = makeSphere(1.15 * scale, leafMaterial, 15, 10);
        crown.scale.set(1.15, 0.82, 1);
        crown.position.set(x, y, z);
        root.add(crown);
    }
    const grate = new THREE.Mesh(new THREE.RingGeometry(0.62, 1.05, 24), standardMaterial(0x657984, 0.42, 0.38));
    grate.rotation.x = -Math.PI / 2;
    grate.position.y = 0.09;
    root.add(grate);
    return root;
}
function createBusStopSign(accent) {
    const root = new THREE.Group();
    const post = makeBox(0.12, 4.4, 0.12, standardMaterial(0x60747c, 0.4, 0.42), 0.02);
    post.position.y = 2.2;
    const sign = makeBox(1.25, 1.65, 0.12, standardMaterial(0xfffdf8, 0.84), 0.06);
    sign.position.set(0, 3.65, 0.04);
    const stripe = makeBox(1.0, 0.2, 0.03, standardMaterial(accent, 0.64), 0.02);
    stripe.position.set(0, 4.05, 0.12);
    const icon = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.34, 20), standardMaterial(accent, 0.62));
    icon.position.set(0, 3.55, 0.12);
    root.add(post, sign, stripe, icon);
    return root;
}
function createDiningChair(accent) {
    const root = new THREE.Group();
    const timber = standardMaterial(0x657984, 0.5, 0.2);
    const seat = makeBox(1.05, 0.18, 1.05, standardMaterial(accent, 0.82), 0.065);
    seat.position.y = 1.02;
    const back = makeBox(1.08, 1.28, 0.16, standardMaterial(accent, 0.82), 0.07);
    back.position.set(0, 1.68, -0.45);
    root.add(seat, back);
    for (const [x, z] of [
        [-0.4, -0.4],
        [0.4, -0.4],
        [-0.4, 0.4],
        [0.4, 0.4],
    ]) {
        const leg = makeBox(0.1, 0.98, 0.1, timber, 0.02);
        leg.position.set(x, 0.5, z);
        root.add(leg);
    }
    return root;
}
function createFruitBowl() {
    const root = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), standardMaterial(0xd7b28e, 0.74));
    bowl.rotation.x = Math.PI;
    bowl.position.y = 0.28;
    root.add(bowl);
    const colours = [0xd47e6c, 0xd6a247, 0x7fa78d, 0xc8624e, 0xe2b651];
    for (let index = 0; index < 7; index += 1) {
        const fruit = makeSphere(0.2 + (index % 2) * 0.03, standardMaterial(colours[index % colours.length], 0.86), 12, 8);
        const angle = (index / 7) * Math.PI * 2;
        fruit.position.set(Math.sin(angle) * 0.36, 0.48 + (index % 3) * 0.08, Math.cos(angle) * 0.28);
        root.add(fruit);
    }
    return root;
}
function createSofa(accent) {
    const root = new THREE.Group();
    const upholstery = standardMaterial(accent, 0.9);
    const base = makeBox(5.4, 0.8, 2.35, upholstery, 0.18);
    base.position.y = 0.7;
    const back = makeBox(5.4, 1.9, 0.55, upholstery, 0.18);
    back.position.set(0, 1.55, -0.9);
    const leftArm = makeBox(0.55, 1.45, 2.35, upholstery, 0.16);
    leftArm.position.set(-2.48, 1.05, 0);
    const rightArm = leftArm.clone();
    rightArm.position.x = 2.48;
    root.add(base, back, leftArm, rightArm);
    for (let index = 0; index < 3; index += 1) {
        const cushion = makeBox(1.48, 0.36, 1.72, standardMaterial(index === 1 ? 0xf1e9df : accent, 0.93), 0.12);
        cushion.position.set(-1.55 + index * 1.55, 1.22, 0.12);
        root.add(cushion);
    }
    for (const x of [-2.1, 2.1]) {
        const leg = makeBox(0.18, 0.38, 0.18, standardMaterial(0x6e5847, 0.72), 0.03);
        leg.position.set(x, 0.18, 0.75);
        root.add(leg);
    }
    return root;
}
function createLaundryBasket(accent) {
    const root = new THREE.Group();
    const basketMaterial = standardMaterial(accent, 0.9);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.68, 1.15, 18, 1, true), basketMaterial);
    basket.position.y = 0.58;
    root.add(basket);
    for (let index = 0; index < 8; index += 1) {
        const slot = makeBox(0.08, 0.68, 0.035, standardMaterial(0xf7f2ea, 0.96), 0.01);
        const angle = (index / 8) * Math.PI * 2;
        slot.position.set(Math.sin(angle) * 0.75, 0.6, Math.cos(angle) * 0.75);
        slot.rotation.y = angle;
        root.add(slot);
    }
    const clothes = [0xd47e6c, 0x6f91c2, 0xfffdf8, 0x7fa78d];
    for (let index = 0; index < 4; index += 1) {
        const cloth = makeBox(0.75, 0.18, 0.55, standardMaterial(clothes[index], 0.95), 0.05);
        cloth.position.set((index - 1.5) * 0.18, 1.05 + index * 0.09, (index % 2) * 0.15);
        cloth.rotation.y = index * 0.33;
        root.add(cloth);
    }
    return root;
}
function createCleaningCaddy(accent) {
    const root = new THREE.Group();
    const body = makeBox(1.55, 0.72, 0.92, standardMaterial(accent, 0.86), 0.12);
    body.position.y = 0.36;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.05, 8, 18, Math.PI), standardMaterial(0x586d74, 0.48, 0.32));
    handle.position.y = 0.72;
    handle.rotation.z = Math.PI;
    root.add(body, handle);
    for (const [x, color, height] of [
        [-0.42, 0x6f91c2, 0.82],
        [0, 0xd6a247, 0.72],
        [0.42, 0x7fa78d, 0.9],
    ]) {
        const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, height, 12), standardMaterial(color, 0.8));
        bottle.position.set(x, 0.72 + height * 0.5, 0);
        root.add(bottle);
    }
    return root;
}
function createParkTree(accent = 0x7fa78d) {
    const root = createStreetTree(accent);
    root.scale.setScalar(1.18);
    const flowers = [0xd47e6c, 0xd6a247, 0x806f98];
    for (let index = 0; index < 9; index += 1) {
        const flower = makeSphere(0.09, standardMaterial(flowers[index % flowers.length], 0.78), 9, 6);
        const angle = (index / 9) * Math.PI * 2;
        flower.position.set(Math.sin(angle) * 1.18, 0.18, Math.cos(angle) * 1.18);
        root.add(flower);
    }
    return root;
}
function createRaisedPlanter(accent) {
    const root = new THREE.Group();
    const box = makeBox(3.6, 0.85, 1.55, standardMaterial(0xb68c68, 0.9), 0.08);
    box.position.y = 0.48;
    const soil = makeBox(3.25, 0.15, 1.2, standardMaterial(0x654736, 0.98), 0.04);
    soil.position.y = 0.95;
    root.add(box, soil);
    const colours = [accent, 0xd6a247, 0xd47e6c, 0x806f98];
    for (let index = 0; index < 9; index += 1) {
        const stem = makeBox(0.035, 0.65 + (index % 3) * 0.16, 0.035, standardMaterial(0x4f7f5b, 0.9), 0.008);
        stem.position.set(-1.35 + (index % 5) * 0.67, 1.28 + (index % 3) * 0.08, -0.32 + Math.floor(index / 5) * 0.62);
        const bloom = makeSphere(0.16 + (index % 2) * 0.04, standardMaterial(colours[index % colours.length], 0.82), 10, 7);
        bloom.position.set(stem.position.x, stem.position.y + 0.38, stem.position.z);
        root.add(stem, bloom);
    }
    return root;
}
function createStringLights(start, end, accent, count = 12) {
    const root = new THREE.Group();
    const wire = cylinderBetween(start, end, 0.018, standardMaterial(0x566970, 0.5, 0.28), 6);
    root.add(wire);
    const bulbs = [];
    for (let index = 0; index < count; index += 1) {
        const t = index / Math.max(1, count - 1);
        const position = start.clone().lerp(end, t);
        position.y -= Math.sin(t * Math.PI) * 0.4;
        const cord = makeBox(0.025, 0.24, 0.025, standardMaterial(0x566970, 0.5, 0.28), 0.006);
        cord.position.copy(position).add(new THREE.Vector3(0, -0.12, 0));
        const material = new THREE.MeshStandardMaterial({
            color: index % 3 === 0 ? accent : 0xffe4a8,
            roughness: 0.38,
            emissive: new THREE.Color(index % 3 === 0 ? accent : 0xffca64),
            emissiveIntensity: 0.5,
        });
        bulbs.push(material);
        const bulb = makeSphere(0.105, material, 10, 7);
        bulb.position.copy(position).add(new THREE.Vector3(0, -0.29, 0));
        root.add(cord, bulb);
    }
    return { root, bulbs };
}
function createCommunityBench(accent) {
    const root = new THREE.Group();
    const timber = standardMaterial(0xc39b76, 0.84);
    const frame = standardMaterial(0x586b72, 0.42, 0.38);
    for (let index = 0; index < 4; index += 1) {
        const slat = makeBox(4.6, 0.16, 0.32, timber, 0.04);
        slat.position.set(0, 1.0, -0.48 + index * 0.34);
        root.add(slat);
    }
    for (let index = 0; index < 3; index += 1) {
        const slat = makeBox(4.6, 0.16, 0.32, index === 1 ? standardMaterial(accent, 0.82) : timber, 0.04);
        slat.position.set(0, 1.62 + index * 0.34, -0.75);
        slat.rotation.x = -0.08;
        root.add(slat);
    }
    for (const x of [-1.85, 1.85]) {
        const leg = makeBox(0.16, 1.0, 0.16, frame, 0.03);
        leg.position.set(x, 0.52, 0);
        root.add(leg);
    }
    return root;
}
function createEmploymentScene(parent) {
    const id = "employment";
    const root = new THREE.Group();
    createServiceBase(root, 0xd6a247, "EMPLOYMENT SUPPORT", "Explore roles · build confidence · keep growing", 0xf7f2ea, "indoor", { artX: -2.5 });
    const officeRug = createPatternedRug(13.6, 8.1, 0xeee4d3, 0xd6a247);
    officeRug.position.set(3.6, 0, 0.35);
    const bookshelf = createBookshelf(0xd6a247);
    bookshelf.position.set(12.2, 0, -6.85);
    const officeChair = createOfficeChair(0x6f91c2);
    officeChair.position.set(6.3, 0, -4.15);
    officeChair.rotation.y = -0.08;
    const clock = createWallClock(0xd6a247);
    clock.root.position.set(12.4, 4.8, -8.96);
    const floorLamp = createFloorLamp(0xd6a247);
    floorLamp.root.position.set(-3.1, 0, -5.6);
    root.add(officeRug, bookshelf, officeChair, clock.root, floorLamp.root);
    const desk = createDesk(0xd6a247);
    desk.position.set(5.2, 0, -1.8);
    const laptop = createLaptop(0xd6a247);
    laptop.root.position.set(4.7, 1.72, -1.25);
    const mug = createMug(0x2d847d);
    mug.position.set(6.55, 1.72, -1.52);
    const clipboard = createClipboard(0xd6a247);
    clipboard.scale.setScalar(0.62);
    clipboard.position.set(3.25, 1.88, -1.28);
    clipboard.rotation.set(-Math.PI / 2, 0, -0.08);
    const jobBoard = makeBox(5.4, 3.5, 0.18, standardMaterial(0xefe8dc, 0.9), 0.07);
    jobBoard.position.set(7.2, 3.2, -8.78);
    const boardFrameMaterial = standardMaterial(0xb5916e, 0.72);
    for (const [width, height, x, y] of [
        [5.65, 0.14, 0, 1.79],
        [5.65, 0.14, 0, -1.79],
        [0.14, 3.55, -2.79, 0],
        [0.14, 3.55, 2.79, 0],
    ]) {
        const frame = makeBox(width, height, 0.12, boardFrameMaterial, 0.025);
        frame.position.set(x, y, 0.12);
        jobBoard.add(frame);
    }
    const roleCards = [];
    const roleColours = [0x7fa78d, 0x6f91c2, 0xd47e6c, 0x806f98];
    for (let index = 0; index < 4; index += 1) {
        const card = makeBox(1.45, 0.85, 0.045, standardMaterial(0xfffdf8, 0.94), 0.035);
        card.position.set(-1.65 + (index % 2) * 3.25, 0.76 - Math.floor(index / 2) * 1.6, 0.16);
        const header = makeBox(1.08, 0.12, 0.018, standardMaterial(roleColours[index], 0.76), 0.012);
        header.position.set(0, 0.23, 0.035);
        const lineA = makeBox(0.82, 0.045, 0.016, standardMaterial(0x9aa9ad, 0.8), 0.008);
        lineA.position.set(-0.08, -0.02, 0.035);
        const lineB = makeBox(0.6, 0.045, 0.016, standardMaterial(0xb7c1c4, 0.8), 0.008);
        lineB.position.set(-0.18, -0.2, 0.035);
        const pin = makeSphere(0.065, standardMaterial(roleColours[index], 0.5, 0.25), 9, 6);
        pin.position.set(0, 0.34, 0.07);
        card.add(header, lineA, lineB, pin);
        roleCards.push(card);
        jobBoard.add(card);
    }
    const resume = makeBox(1.15, 1.5, 0.055, standardMaterial(0xfffdf8, 0.9), 0.035);
    const resumeDeskPosition = new THREE.Vector3(3.35, 1.86, -0.63);
    const resumeFiledPosition = new THREE.Vector3(3.25, 1.92, -1.28);
    resume.position.copy(resumeDeskPosition);
    resume.rotation.x = -Math.PI / 2;
    const resumeLineMaterial = standardMaterial(0x6f91c2, 0.78);
    for (let index = 0; index < 4; index += 1) {
        const line = makeBox(0.78 - index * 0.09, 0.045, 0.026, resumeLineMaterial, 0.01);
        line.position.set(0, 0.42 - index * 0.25, 0.048);
        resume.add(line);
    }
    const dialogue = new THREE.Group();
    const dialogueMaterials = [];
    for (let index = 0; index < 3; index += 1) {
        const material = new THREE.MeshBasicMaterial({
            color: index === 0 ? 0xd6a247 : index === 1 ? 0x2d847d : 0x6f91c2,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
        });
        dialogueMaterials.push(material);
        const bubble = makeSphere(0.2 - index * 0.035, material, 12, 8);
        bubble.position.set(index * 0.42, index * 0.22, 0);
        dialogue.add(bubble);
    }
    dialogue.position.set(0.4, 3.55, -0.1);
    dialogue.visible = false;
    root.add(desk, laptop.root, mug, clipboard, jobBoard, resume, dialogue);
    const pair = new THREE.Group();
    const chair = createWheelchair(false, {
        skin: 0x7b4c36,
        shirt: 0xd6a247,
        trousers: 0x2f4652,
        hair: 0x211b19,
        hairStyle: "curls",
    });
    chair.root.position.x = -0.72;
    pair.add(chair.root);
    root.add(pair);
    const workerCarrier = new THREE.Group();
    const worker = createHuman({
        skin: 0xe1ae88,
        shirt: 0x2d847d,
        trousers: 0x344956,
        hair: 0x513628,
        hairStyle: "waves",
        badge: true,
        glasses: true,
    });
    worker.root.position.set(0, 0, 0);
    const briefcase = createBriefcase();
    briefcase.scale.setScalar(0.88);
    briefcase.position.set(0.36, 0.86, 0.14);
    const resumeHeld = resume.clone();
    resumeHeld.visible = false;
    resumeHeld.scale.set(0.94, 1, 0.94);
    resumeHeld.position.set(0.08, -0.76, 0.18);
    resumeHeld.rotation.set(-1.06, 0.25, 0.18);
    worker.leftArm.add(resumeHeld);
    workerCarrier.add(worker.root, briefcase);
    root.add(workerCarrier);
    const path = createScenePath([
        [-23, 10.5],
        [-15, 8],
        [-8.5, 5.4],
        [-3.2, 2.5],
        [-0.8, 1.4],
        [3.2, 1.8],
        [8.5, 4.1],
        [15, 7.4],
        [23, 11],
    ]);
    const workerMainPath = createOffsetScenePath(path, 0.95, -0.08);
    createRouteRibbon(root, path, 0xd6a247);
    const stop = closestPathProgress(path, new THREE.Vector3(-0.8, 0, 1.4));
    const workerHome = workerMainPath.getPointAt(stop);
    const pairStopPose = sampleCurvePose(path, stop);
    const conversationLook = new THREE.Vector3(2.6, 0, 1.5);
    const interviewSpot = new THREE.Vector3(1.6, 0, 1.55);
    const interviewLeg = new THREE.Vector3();
    const workerDeskPickupWorld = new THREE.Vector3(2.75, 0, 0.05);
    const workerLaptopWorld = new THREE.Vector3(1.72, 0, -1.35);
    const workerBoardWorld = new THREE.Vector3(3.35, 0, -5.75);
    const workerShelfWorld = new THREE.Vector3(8.7, 0, -4.85);
    const workerDeskLook = new THREE.Vector3(4.8, 0, -1.35);
    const workerLaptopLook = new THREE.Vector3(4.7, 1.8, -1.25);
    const workerBoardLook = new THREE.Vector3(7.2, 0, -8.2);
    const workerShelfLook = new THREE.Vector3(12.2, 1.9, -6.85);
    const employmentObstacles = [
        { type: "rect", label: "desk", minX: 2.15, maxX: 8.25, minZ: -3.1, maxZ: -0.5 },
        { type: "rect", label: "chair", minX: 5.25, maxX: 7.35, minZ: -5.25, maxZ: -3.1 },
        { type: "circle", label: "lamp", x: -3.1, z: -5.6, r: 0.85 },
        { type: "rect", label: "bookshelf", minX: 10.85, maxX: 13.55, minZ: -7.75, maxZ: -5.95 },
    ];
    const deskTaskRoute = createNavigationRoute(workerHome, workerDeskPickupWorld, employmentObstacles, 0.62, [new THREE.Vector3(0.8, 0, 1.05), new THREE.Vector3(1.8, 0, 0.52)]);
    const laptopTaskRoute = createNavigationRoute(workerHome, workerLaptopWorld, employmentObstacles, 0.62, [new THREE.Vector3(1.05, 0, 0.55), new THREE.Vector3(1.35, 0, -0.35)]);
    const boardTaskRoute = createNavigationRoute(workerHome, workerBoardWorld, employmentObstacles, 0.62, [new THREE.Vector3(0.75, 0, -1.4), new THREE.Vector3(1.05, 0, -3.85)]);
    const boardToShelfRoute = createNavigationRoute(workerBoardWorld, workerShelfWorld, employmentObstacles, 0.62, [new THREE.Vector3(4.15, 0, -5.82), new THREE.Vector3(6.95, 0, -5.82)]);
    const shelfToHomeRoute = createNavigationRoute(workerShelfWorld, workerHome, employmentObstacles, 0.62, [new THREE.Vector3(8.15, 0, -5.05), new THREE.Vector3(4.55, 0, -4.85), new THREE.Vector3(1.15, 0, -1.15)]);
    const workerMainLength = workerMainPath.getLength();
    const workerMainStopDistance = stop * workerMainLength;
    const deskTaskLength = deskTaskRoute.length;
    const laptopTaskLength = laptopTaskRoute.length;
    const boardTaskLength = boardTaskRoute.length;
    const boardToShelfLength = boardToShelfRoute.length;
    const shelfToHomeLength = shelfToHomeRoute.length;
    const trails = new TrailPool(root, 240);
    const duration = 56;
    const tempWorkerFoot = new THREE.Vector3();
    let previousTime = 0;
    let lastPairStamp = -1;
    let lastWorkerStamp = -1;
    const reset = () => {
        previousTime = 0;
        lastPairStamp = -1;
        lastWorkerStamp = -1;
        trails.clear();
    };
    const update = (localTime, delta) => {
        if (localTime + 0.05 < previousTime)
            reset();
        previousTime = localTime;
        const entering = localTime < 7;
        const roleDiscovery = localTime >= 7 && localTime < 9.5;
        const resumeWalkOut = localTime >= 9.5 && localTime < 12.8;
        const resumePickup = localTime >= 12.8 && localTime < 14.2;
        const resumeWalkBack = localTime >= 14.2 && localTime < 17.5;
        const interviewA = localTime >= 17.5 && localTime < 20;
        const laptopWalkOut = localTime >= 20 && localTime < 23.2;
        const laptopCoach = localTime >= 23.2 && localTime < 25.8;
        const laptopWalkBack = localTime >= 25.8 && localTime < 29;
        const planningChat = localTime >= 29 && localTime < 31.2;
        const boardWalkOut = localTime >= 31.2 && localTime < 35.8;
        const boardExplain = localTime >= 35.8 && localTime < 38.4;
        const shelfWalkOut = localTime >= 38.4 && localTime < 41.3;
        const shelfReview = localTime >= 41.3 && localTime < 43.4;
        const shelfWalkBack = localTime >= 43.4 && localTime < 46.9;
        const interviewB = localTime >= 46.9 && localTime < 50.2;
        const wrapUp = localTime >= 50.2 && localTime < 52;
        const working = localTime >= 7 && localTime < 52;
        const movingPair = entering || !working;
        const pathProgress = entering
            ? THREE.MathUtils.lerp(0, stop, timedEase(localTime, 0, 7))
            : working
                ? stop
                : THREE.MathUtils.lerp(stop, 0.999, timedEase(localTime, 52, duration));
        let pose;
        if (movingPair) {
            pose = poseOnPath(pair, path, pathProgress);
        }
        else {
            pose = { position: pairStopPose.position, yaw: pairStopPose.yaw, distance: pairStopPose.distance };
            pair.position.copy(pairStopPose.position);
        }
        applyStageVisibility(pair);
        const pairPhase = pose.distance * 5.2;
        let focusTarget = workerDeskLook;
        if (laptopWalkOut || laptopCoach || laptopWalkBack || planningChat) {
            focusTarget = workerLaptopLook;
        }
        if (boardWalkOut || boardExplain) {
            focusTarget = workerBoardLook;
        }
        if (shelfWalkOut || shelfReview) {
            focusTarget = workerShelfLook;
        }
        if (interviewB || wrapUp || shelfWalkBack) {
            focusTarget = workerHome;
        }
        if (roleDiscovery || interviewA || planningChat || interviewB || wrapUp) {
            focusTarget = conversationLook;
        }
        if (working)
            facePoint(pair, focusTarget, 0.14);
        chair.animate(pose.distance, pairPhase);
        let workerPose = sampleCurvePose(workerMainPath, pathProgress);
        let workerTravelMetric = workerPose.distance;
        let workerMoving = entering || !working;
        let workerIntensity = workerMoving ? 0.88 : 0.04;
        const baseAfterDeskCycle = workerMainStopDistance + deskTaskLength * 2;
        const baseAfterLaptopCycle = baseAfterDeskCycle + laptopTaskLength * 2;
        const baseAtBoard = baseAfterLaptopCycle + boardTaskLength;
        const baseAtShelf = baseAtBoard + boardToShelfLength;
        const baseAfterShelfReturn = baseAtShelf + shelfToHomeLength;
        if (resumeWalkOut || resumePickup || resumeWalkBack) {
            if (resumeWalkOut) {
                const progress = timedEase(localTime, 9.5, 12.8);
                workerPose = sampleCurvePose(deskTaskRoute.path, progress);
                workerTravelMetric = workerMainStopDistance + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
            else if (resumePickup) {
                workerPose = sampleCurvePose(deskTaskRoute.path, 1);
                workerPose.yaw = yawToPoint(workerPose.position, workerDeskLook);
                workerTravelMetric = workerMainStopDistance + deskTaskLength;
                workerMoving = false;
                workerIntensity = 0.04;
            }
            else {
                const progress = 1 - timedEase(localTime, 14.2, 17.5);
                workerPose = sampleCurvePose(deskTaskRoute.path, progress, -1);
                workerTravelMetric = workerMainStopDistance + deskTaskLength + (deskTaskLength - workerPose.distance);
                workerMoving = true;
                workerIntensity = 1.02;
            }
        }
        else if (laptopWalkOut || laptopCoach || laptopWalkBack) {
            if (laptopWalkOut) {
                const progress = timedEase(localTime, 20, 23.2);
                workerPose = sampleCurvePose(laptopTaskRoute.path, progress);
                workerTravelMetric = baseAfterDeskCycle + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
            else if (laptopCoach) {
                workerPose = sampleCurvePose(laptopTaskRoute.path, 1);
                workerPose.yaw = yawToPoint(workerPose.position, workerLaptopLook);
                workerTravelMetric = baseAfterDeskCycle + laptopTaskLength;
                workerMoving = false;
                workerIntensity = 0.04;
            }
            else {
                const progress = 1 - timedEase(localTime, 25.8, 29);
                workerPose = sampleCurvePose(laptopTaskRoute.path, progress, -1);
                workerTravelMetric = baseAfterDeskCycle + laptopTaskLength + (laptopTaskLength - workerPose.distance);
                workerMoving = true;
                workerIntensity = 1.02;
            }
        }
        else if (boardWalkOut || boardExplain) {
            if (boardWalkOut) {
                const progress = timedEase(localTime, 31.2, 35.8);
                workerPose = sampleCurvePose(boardTaskRoute.path, progress);
                workerTravelMetric = baseAfterLaptopCycle + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
            else {
                workerPose = sampleCurvePose(boardTaskRoute.path, 1);
                workerPose.yaw = yawToPoint(workerPose.position, workerBoardLook);
                workerTravelMetric = baseAfterLaptopCycle + boardTaskLength;
                workerMoving = false;
                workerIntensity = 0.04;
            }
        }
        else if (shelfWalkOut || shelfReview || shelfWalkBack) {
            if (shelfWalkOut) {
                const progress = timedEase(localTime, 38.4, 41.3);
                workerPose = sampleCurvePose(boardToShelfRoute.path, progress);
                workerTravelMetric = baseAtBoard + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
            else if (shelfReview) {
                workerPose = sampleCurvePose(boardToShelfRoute.path, 1);
                workerPose.yaw = yawToPoint(workerPose.position, workerShelfLook);
                workerTravelMetric = baseAtBoard + boardToShelfLength;
                workerMoving = false;
                workerIntensity = 0.04;
            }
            else {
                const progress = timedEase(localTime, 43.4, 46.9);
                workerPose = sampleCurvePose(shelfToHomeRoute.path, progress);
                workerTravelMetric = baseAtShelf + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
        }
        else if (interviewA || interviewB) {
            const t0 = interviewA ? 17.5 : 46.9;
            const t1 = interviewA ? 20 : 50.2;
            const walkIn = timedEase(localTime, t0, t0 + 0.7);
            const walkBack = timedEase(localTime, t1 - 0.7, t1);
            const blend = walkIn - walkBack;
            interviewLeg.lerpVectors(workerHome, interviewSpot, blend);
            const walking = (localTime < t0 + 0.7) || (localTime > t1 - 0.7);
            workerPose = {
                position: interviewLeg.clone(),
                yaw: walkBack > 0.02 ? yawToPoint(interviewLeg, workerHome) : blend > 0.6 ? yawToPoint(interviewLeg, pairStopPose.position) : yawToPoint(interviewLeg, interviewSpot),
                distance: 0,
            };
            workerTravelMetric = (interviewA ? baseAfterDeskCycle : baseAfterShelfReturn) + (walkIn + walkBack) * 2.6;
            workerMoving = walking;
            workerIntensity = walking ? 0.92 : 0.04;
        }
        else if (working) {
            workerPose = sampleCurvePose(workerMainPath, stop);
            workerPose.yaw = yawToPoint(workerPose.position, focusTarget);
            workerTravelMetric = localTime < 20
                ? baseAfterDeskCycle
                : localTime < 31.2
                    ? baseAfterLaptopCycle
                    : localTime < 38.4
                        ? baseAfterLaptopCycle
                        : localTime < 43.4
                            ? baseAtBoard
                            : baseAfterShelfReturn;
            workerMoving = false;
            workerIntensity = 0.04;
        }
        else if (!entering) {
            workerTravelMetric = baseAfterShelfReturn + Math.max(0, workerPose.distance - workerMainStopDistance);
        }
        workerCarrier.position.copy(workerPose.position);
        workerCarrier.quaternion.setFromAxisAngle(UP, workerPose.yaw);
        applyStageVisibility(workerCarrier);
        worker.animate(workerTravelMetric * 4.9 + 0.7, workerIntensity);
        briefcase.visible = entering || localTime >= 52;
        if (roleDiscovery || interviewA || planningChat || interviewB || wrapUp) {
            const turn = 0.5 + 0.5 * Math.sin(localTime * 1.15);
            chair.person.rightArm.rotation.x = -0.42 - (1 - turn) * 0.5 + Math.sin(localTime * 2.1) * 0.08;
            worker.rightArm.rotation.x = -0.4 - turn * 0.55 + Math.sin(localTime * 2.3 + 0.3) * 0.16;
            worker.rightArm.rotation.z = -0.22;
            worker.leftArm.rotation.x = -0.36;
        }
        if (resumeWalkOut) {
            chair.person.rightArm.rotation.x = -0.52;
            worker.leftArm.rotation.x = -0.34;
            worker.rightArm.rotation.x = -0.26;
        }
        else if (resumePickup) {
            chair.person.rightArm.rotation.x = -0.62;
            worker.leftArm.rotation.x = -1.22 + Math.sin(localTime * 3.7) * 0.08;
            worker.leftArm.rotation.z = 0.24;
            worker.rightArm.rotation.x = -0.46;
        }
        else if (resumeWalkBack) {
            worker.leftArm.rotation.x = -0.92;
            worker.leftArm.rotation.z = 0.22;
        }
        if (laptopWalkOut || laptopWalkBack) {
            worker.leftArm.rotation.x = -0.86;
            worker.leftArm.rotation.z = 0.18;
            worker.rightArm.rotation.x = -0.36;
        }
        else if (laptopCoach) {
            chair.person.rightArm.rotation.x = -0.58 + Math.sin(localTime * 2.0) * 0.08;
            worker.leftArm.rotation.x = -0.88;
            worker.leftArm.rotation.z = 0.2;
            worker.rightArm.rotation.x = -1.02 + Math.sin(localTime * 2.8) * 0.12;
            worker.rightArm.rotation.z = -0.32;
        }
        if (boardWalkOut) {
            worker.leftArm.rotation.x = -0.94;
            worker.leftArm.rotation.z = 0.22;
            worker.rightArm.rotation.x = -0.18;
        }
        else if (boardExplain) {
            chair.person.rightArm.rotation.x = -0.66 + Math.sin(localTime * 1.7) * 0.08;
            worker.leftArm.rotation.x = -0.98;
            worker.leftArm.rotation.z = 0.24;
            worker.rightArm.rotation.x = -1.08 + Math.sin(localTime * 2.6) * 0.14;
            worker.rightArm.rotation.z = -0.26;
        }
        if (shelfWalkOut) {
            worker.leftArm.rotation.x = -0.98;
            worker.leftArm.rotation.z = 0.22;
            worker.rightArm.rotation.x = -0.32;
        }
        else if (shelfReview) {
            worker.leftArm.rotation.x = -1.04 + Math.sin(localTime * 3.2) * 0.08;
            worker.leftArm.rotation.z = 0.3;
            worker.rightArm.rotation.x = -0.92 + Math.sin(localTime * 2.8) * 0.1;
            worker.rightArm.rotation.z = -0.18;
        }
        const resumeTaken = localTime >= 13.4 && localTime < 43.2;
        resumeHeld.visible = resumeTaken;
        if (resumeTaken) {
            resume.visible = false;
            resumeHeld.position.set(0.08 + Math.sin(localTime * 2.1) * 0.02, -0.76, 0.18);
            resumeHeld.rotation.set(-1.06, 0.24, 0.18 + Math.sin(localTime * 1.7) * 0.04);
        }
        else {
            resume.visible = true;
            if (localTime < 13.4) {
                resume.position.copy(resumeDeskPosition);
                resume.rotation.set(-Math.PI / 2, 0, 0);
            }
            else {
                resume.position.copy(resumeFiledPosition);
                resume.rotation.set(-Math.PI / 2, 0, -0.08);
            }
        }
        const dialogueActive = roleDiscovery || interviewA || planningChat || interviewB || wrapUp;
        dialogue.visible = dialogueActive;
        dialogue.position.set(pair.position.x + 0.2, 3.0, pair.position.z + 0.3);
        dialogue.quaternion.copy(pair.quaternion);
        dialogueMaterials.forEach((material, index) => {
            material.opacity = dialogueActive
                ? 0.28 + Math.sin(localTime * 3.2 + index * 1.4) * 0.08
                : 0;
        });
        dialogue.children.forEach((child, index) => {
            const pulse = 0.9 + Math.sin(localTime * 3.2 + index) * 0.12;
            child.scale.setScalar(pulse);
        });
        clock.minute.rotation.z = -localTime * 0.15;
        clock.hour.rotation.z = -localTime * 0.025;
        floorLamp.bulbMaterial.emissiveIntensity = 0.48 + Math.sin(localTime * 1.8) * 0.05;
        roleCards.forEach((card, index) => {
            card.rotation.z = Math.sin(localTime * 0.8 + index) * 0.006;
        });
        laptop.screenGroup.rotation.x = -0.16 + Math.sin(Math.min(1, localTime / 3) * Math.PI) * 0.08;
        laptop.screenMaterial.emissiveIntensity = laptopCoach
            ? 0.48 + Math.sin(localTime * 2.4) * 0.12
            : working
                ? 0.34 + Math.sin(localTime * 2.2) * 0.08
                : 0.13;
        if (movingPair && onStage(pair.position) && (lastPairStamp < 0 || pose.distance - lastPairStamp >= 0.36)) {
            const yaw = yawFromQuaternion(pair.quaternion);
            trails.emit("wheel", localPoint(pair, -1.46, -0.08), yaw, 0.14, 0.46, 7.2);
            trails.emit("wheel", localPoint(pair, 0.02, -0.08), yaw, 0.14, 0.46, 7.2);
            lastPairStamp = pose.distance;
        }
        if (workerMoving && onStage(workerPose.position) && (lastWorkerStamp < 0 || workerTravelMetric - lastWorkerStamp >= 0.42)) {
            const left = Math.floor(workerTravelMetric / 0.42) % 2 === 0;
            tempWorkerFoot.set(left ? -0.17 : 0.17, 0, -0.34)
                .applyAxisAngle(UP, workerPose.yaw)
                .add(workerPose.position);
            trails.emit("foot", tempWorkerFoot, workerPose.yaw, 0.18, 0.42, 6.2, left);
            lastWorkerStamp = workerTravelMetric;
        }
        trails.update(delta);
    };
    root.visible = false;
    parent.add(root);
    return { id, root, duration, trails, update, reset };
}
function createPersonalCareScene(parent) {
    const id = "personal-care";
    const root = new THREE.Group();
    createServiceBase(root, 0xd47e6c, "PERSONAL CARE", "Choice · privacy · dignity in every routine", 0xf8f1ed);
    const bedroomRug = createPatternedRug(13.2, 7.7, 0xf2ddd6, 0xd47e6c);
    bedroomRug.position.set(1.4, 0, 1.15);
    const dressingBench = createCommunityBench(0xd47e6c);
    dressingBench.scale.setScalar(0.68);
    dressingBench.position.set(-7.8, 0, 3.65);
    dressingBench.rotation.y = 0.08;
    const floorLamp = createFloorLamp(0xd47e6c);
    floorLamp.root.position.set(-10.7, 0, -4.7);
    const bathroom = createAccessibleBathroomDetails(0xd47e6c);
    bathroom.scale.setScalar(0.78);
    bathroom.position.set(10.2, 0, 1.15);
    const hamper = createLaundryBasket(0xd47e6c);
    hamper.scale.setScalar(0.78);
    hamper.position.set(12.7, 0, -4.7);
    root.add(bedroomRug, dressingBench, floorLamp.root, bathroom, hamper);
    const wardrobe = createWardrobe(0xd47e6c);
    wardrobe.root.position.set(-6.5, 0, -5.85);
    const wardrobeRod = makeBox(3.4, 0.08, 0.08, standardMaterial(0x657984, 0.38, 0.5), 0.016);
    wardrobeRod.position.set(0, 3.8, 0.56);
    wardrobe.root.add(wardrobeRod);
    const hangingGarments = [];
    const garmentColours = [0x6f91c2, 0x7fa78d, 0xd6a247, 0x806f98];
    for (let index = 0; index < 4; index += 1) {
        const hanger = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 6, 16, Math.PI), standardMaterial(0x657984, 0.42, 0.35));
        hanger.rotation.z = Math.PI;
        hanger.position.y = 0.47;
        const garment = makeBox(0.7, 1.08 + (index % 2) * 0.16, 0.1, standardMaterial(garmentColours[index], 0.9), 0.055);
        garment.position.y = -0.18;
        const hanging = new THREE.Group();
        hanging.position.set(-1.2 + index * 0.8, 3.35, 0.66);
        hanging.add(hanger, garment);
        hangingGarments.push(hanging);
        wardrobe.root.add(hanging);
    }
    const mirror = createMirror(0xd47e6c);
    mirror.root.position.set(4.2, 3.05, -8.75);
    const mirrorBulbs = [];
    for (let index = 0; index < 10; index += 1) {
        const side = index < 5 ? -1 : 1;
        const row = index % 5;
        const material = new THREE.MeshStandardMaterial({
            color: 0xffefd2,
            roughness: 0.3,
            emissive: new THREE.Color(0xffc86d),
            emissiveIntensity: 0.14,
        });
        const bulb = makeSphere(0.095, material, 10, 7);
        bulb.position.set(side * 1.48, -1.46 + row * 0.73, 0.16);
        mirror.root.add(bulb);
        mirrorBulbs.push({ mesh: bulb, material });
    }
    const vanity = createDesk(0xd47e6c);
    vanity.scale.set(0.7, 0.7, 0.7);
    vanity.position.set(4.2, 0, -4.8);
    const toiletries = createToiletrySet(0xd47e6c);
    toiletries.scale.setScalar(0.68);
    toiletries.position.set(4.2, 1.66, -4.5);
    const stool = createOfficeChair(0xd47e6c);
    stool.scale.setScalar(0.64);
    stool.position.set(4.2, 0, -2.65);
    stool.rotation.y = Math.PI;
    const privacy = createPrivacyScreen(0xe8c9c1);
    privacy.position.set(11.9, 0, 1.8);
    privacy.rotation.y = -0.18;
    const foldedTowels = new THREE.Group();
    for (let index = 0; index < 3; index += 1) {
        const towel = makeBox(1.2, 0.18, 0.72, standardMaterial(index === 1 ? 0xf5e1d8 : 0xfffdf8, 0.96), 0.05);
        towel.position.y = 0.1 + index * 0.2;
        foldedTowels.add(towel);
    }
    foldedTowels.position.set(8.4, 1.15, -5.2);
    const towelRail = makeBox(2.3, 0.09, 0.09, standardMaterial(0x6f7f84, 0.35, 0.52), 0.02);
    towelRail.position.set(8.4, 2.55, -8.92);
    const hangingTowel = makeBox(1.45, 1.15, 0.08, standardMaterial(0xfffdf8, 0.96), 0.06);
    hangingTowel.position.set(8.4, 1.93, -8.82);
    root.add(wardrobe.root, mirror.root, vanity, toiletries, stool, privacy, foldedTowels, towelRail, hangingTowel);
    const clothing = makeBox(0.95, 1.15, 0.12, standardMaterial(0x7fa78d, 0.88), 0.06);
    clothing.position.set(-6.5, 2.5, -5.05);
    const clothingCollar = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.028, 7, 18, Math.PI), standardMaterial(0xf5efe6, 0.9));
    clothingCollar.position.set(0, 0.42, 0.08);
    clothingCollar.rotation.z = Math.PI;
    clothing.add(clothingCollar);
    const clothingHeld = clothing.clone();
    clothingHeld.visible = false;
    clothingHeld.scale.set(0.9, 0.9, 0.9);
    clothingHeld.position.set(-0.06, -0.72, 0.18);
    clothingHeld.rotation.set(-1.05, -0.18, -0.08);
    const clothingPlaced = clothing.clone();
    clothingPlaced.visible = false;
    clothingPlaced.scale.set(0.82, 0.48, 0.9);
    clothingPlaced.position.set(4.2, 1.7, -4.55);
    clothingPlaced.rotation.set(-Math.PI / 2, 0, 0.12);
    root.add(clothing, clothingPlaced);
    const pair = new THREE.Group();
    const participant = createHuman({
        skin: 0x8d5c43,
        shirt: 0x6f91c2,
        trousers: 0x3b4c59,
        hair: 0x28211e,
        hairStyle: "waves",
        glasses: true,
    });
    participant.root.position.x = -0.58;
    const brush = makeBox(0.12, 0.56, 0.11, standardMaterial(0xd6a247, 0.72), 0.04);
    brush.position.set(0, -0.7, 0.12);
    brush.visible = false;
    participant.rightArm.add(brush);
    pair.add(participant.root);
    root.add(pair);
    const workerCarrier = new THREE.Group();
    const worker = createHuman({
        skin: 0xd6a17c,
        shirt: 0x2d847d,
        trousers: 0x354b57,
        hair: 0x5b3b2e,
        hairStyle: "bun",
        badge: true,
    });
    worker.root.position.set(0, 0, 0);
    const towel = makeBox(0.62, 0.18, 0.52, standardMaterial(0xfffdf8, 0.95), 0.05);
    towel.position.set(0, -0.68, 0.08);
    worker.leftArm.add(towel);
    worker.rightArm.add(clothingHeld);
    workerCarrier.add(worker.root);
    root.add(workerCarrier);
    const careSparkles = new THREE.Group();
    const sparkleMaterials = [];
    for (let index = 0; index < 8; index += 1) {
        const material = new THREE.MeshBasicMaterial({
            color: index % 2 ? 0xd47e6c : 0xd6a247,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
        });
        const sparkle = new THREE.Mesh(new THREE.OctahedronGeometry(0.09 + (index % 3) * 0.025), material);
        careSparkles.add(sparkle);
        sparkleMaterials.push(material);
    }
    careSparkles.visible = false;
    root.add(careSparkles);
    /* v65.3: the entry walkway swings south of the dressing bench instead of
       running through it */
    const path = createScenePath([
        [-23, 10],
        [-15, 7.6],
        [-11.6, 4.8],
        [-10.4, 1.9],
        [-5.2, 1.7],
        [-1.2, 1.3],
        [3.2, 1.2],
        [7.6, 3.7],
        [15, 7.1],
        [23, 10.6],
    ]);
    const workerMainPath = createOffsetScenePath(path, 0.72, -0.1);
    createRouteRibbon(root, path, 0xd47e6c);
    const wardrobeStop = closestPathProgress(path, new THREE.Vector3(-5.2, 0, 1.7));
    const mirrorStop = closestPathProgress(path, new THREE.Vector3(3.2, 0, 1.2));
    const wardrobeHome = workerMainPath.getPointAt(wardrobeStop);
    const mirrorHome = workerMainPath.getPointAt(mirrorStop);
    const pairVanityWorld = new THREE.Vector3(2.55, 0, -1.5);
    const workerGroomWorld = new THREE.Vector3(5.9, 0, -1.5);
    const wardrobeStopPose = sampleCurvePose(path, wardrobeStop);
    const workerWardrobeWorld = new THREE.Vector3(-6.15, 0, -3.55);
    const workerToiletryWorld = new THREE.Vector3(1.95, 0, -3.2);
    const workerTowelWorld = new THREE.Vector3(8.05, 0, -3.95);
    const workerHamperWorld = new THREE.Vector3(11.45, 0, -3.95);
    const workerWardrobeLook = new THREE.Vector3(-6.5, 0, -5.55);
    const workerMirrorLook = new THREE.Vector3(4.2, 2.5, -8.6);
    const workerToiletryLook = new THREE.Vector3(4.2, 1.7, -4.5);
    const workerTowelLook = new THREE.Vector3(8.4, 0, -5.2);
    const workerHamperLook = new THREE.Vector3(12.7, 0, -4.7);
    const personalObstacles = [
        { type: "rect", label: "wardrobe", minX: -8.25, maxX: -4.75, minZ: -7.45, maxZ: -4.3 },
        { type: "rect", label: "bench", minX: -9.9, maxX: -5.7, minZ: 2.75, maxZ: 4.55 },
        { type: "circle", label: "lamp", x: -10.7, z: -4.7, r: 0.85 },
        { type: "rect", label: "vanity", minX: 2.0, maxX: 6.4, minZ: -5.65, maxZ: -3.95 },
        { type: "rect", label: "stool", minX: 3.25, maxX: 5.15, minZ: -3.65, maxZ: -1.75 },
        { type: "rect", label: "bathroom", minX: 8.3, maxX: 12.1, minZ: 0.05, maxZ: 2.55 },
        { type: "rect", label: "privacy", minX: 10.55, maxX: 13.25, minZ: 0.1, maxZ: 3.45 },
        { type: "rect", label: "folded-towels", minX: 7.65, maxX: 9.15, minZ: -5.6, maxZ: -4.8 },
        { type: "rect", label: "hamper", minX: 11.85, maxX: 13.55, minZ: -5.65, maxZ: -3.75 },
    ];
    const wardrobeTaskRoute = createNavigationRoute(wardrobeHome, workerWardrobeWorld, personalObstacles, 0.62, [new THREE.Vector3(-5.0, 0, 0.95), new THREE.Vector3(-5.15, 0, -1.05)]);
    const toiletryTaskRoute = createNavigationRoute(workerGroomWorld, workerToiletryWorld, personalObstacles, 0.6);
    const towelTaskRoute = createNavigationRoute(workerGroomWorld, workerTowelWorld, personalObstacles, 0.6);
    const hamperTaskRoute = createNavigationRoute(workerGroomWorld, workerHamperWorld, personalObstacles, 0.6);
    const hamperReturnRoute = createNavigationRoute(workerHamperWorld, workerGroomWorld, personalObstacles, 0.6);
    const pairVanityRoute = createNavigationRoute(wardrobeStopPose.position, pairVanityWorld, personalObstacles, 0.55);
    const pairExitRoute = createNavigationRoute(pairVanityWorld, path.getPointAt(mirrorStop), personalObstacles, 0.55);
    const workerGroomRoute = createNavigationRoute(wardrobeHome, workerGroomWorld, personalObstacles, 0.6);
    const workerExitRoute = createNavigationRoute(workerGroomWorld, workerMainPath.getPointAt(mirrorStop), personalObstacles, 0.6);
    const workerExitLength = workerExitRoute.length;
    const pairVanityLength = pairVanityRoute.length;
    const pairExitLength = pairExitRoute.length;
    const workerGroomLength = workerGroomRoute.length;
    const pairMainLength = path.getLength();
    const workerMainLength = workerMainPath.getLength();
    const workerWardrobeStopDistance = wardrobeStop * workerMainLength;
    const workerMirrorStopDistance = mirrorStop * workerMainLength;
    const wardrobeTaskLength = wardrobeTaskRoute.length;
    const toiletryTaskLength = toiletryTaskRoute.length;
    const towelTaskLength = towelTaskRoute.length;
    const hamperTaskLength = hamperTaskRoute.length;
    const hamperReturnLength = hamperReturnRoute.length;
    const trails = new TrailPool(root, 250);
    const duration = 60;
    const tempWorkerFoot = new THREE.Vector3();
    let previousTime = 0;
    let lastPairStamp = -1;
    let lastWorkerStamp = -1;
    const reset = () => {
        previousTime = 0;
        lastPairStamp = -1;
        lastWorkerStamp = -1;
        trails.clear();
    };
    const update = (localTime, delta) => {
        if (localTime + 0.05 < previousTime)
            reset();
        previousTime = localTime;
        let pathProgress = wardrobeStop;
        let movingPair = true;
        let pose;
        const pairBaseWardrobe = wardrobeStop * pairMainLength;
        const pairBaseVanity = pairBaseWardrobe + pairVanityLength;
        const pairBaseExit = pairBaseVanity + pairExitLength;
        if (localTime < 6.5) {
            pathProgress = THREE.MathUtils.lerp(0, wardrobeStop, timedEase(localTime, 0, 6.5));
            pose = poseOnPath(pair, path, pathProgress);
        }
        else if (localTime < 18) {
            movingPair = false;
            pose = { position: wardrobeStopPose.position, yaw: wardrobeStopPose.yaw, distance: pairBaseWardrobe };
            pair.position.copy(wardrobeStopPose.position);
        }
        else if (localTime < 21) {
            pose = poseOnPath(pair, pairVanityRoute.path, timedEase(localTime, 18, 21));
            pose.distance += pairBaseWardrobe;
        }
        else if (localTime < 55) {
            movingPair = false;
            pose = { position: pairVanityWorld, yaw: 0, distance: pairBaseVanity };
            pair.position.copy(pairVanityWorld);
        }
        else if (localTime < 56.8) {
            pose = poseOnPath(pair, pairExitRoute.path, timedEase(localTime, 55, 56.8));
            pose.distance += pairBaseVanity;
        }
        else {
            pathProgress = THREE.MathUtils.lerp(mirrorStop, 0.999, timedEase(localTime, 56.8, duration));
            pose = poseOnPath(pair, path, pathProgress);
            pose.distance = pairBaseExit + Math.max(0, pose.distance - mirrorStop * pairMainLength);
        }
        applyStageVisibility(pair);
        const pairPhase = pose.distance * 5.1;
        const choosing = localTime >= 6.5 && localTime < 18;
        const groomingA = localTime >= 21 && localTime < 23.5;
        const toiletryWalkOut = localTime >= 23.5 && localTime < 26.3;
        const toiletryCollect = localTime >= 26.3 && localTime < 27.4;
        const toiletryWalkBack = localTime >= 27.4 && localTime < 30.2;
        const groomingB = localTime >= 30.2 && localTime < 33;
        const towelWalkOut = localTime >= 33 && localTime < 36.5;
        const towelCollect = localTime >= 36.5 && localTime < 37.7;
        const towelWalkBack = localTime >= 37.7 && localTime < 41.2;
        const groomingC = localTime >= 41.2 && localTime < 43.7;
        const hamperWalkOut = localTime >= 43.7 && localTime < 46.8;
        const hamperLoad = localTime >= 46.8 && localTime < 48;
        const hamperWalkBack = localTime >= 48 && localTime < 51;
        const readyToGo = localTime >= 51 && localTime < 55;
        const grooming = groomingA || groomingB || groomingC || readyToGo;
        if (choosing) {
            facePoint(pair, workerWardrobeLook, 0.16);
        }
        else if (localTime >= 21 && localTime < 55) {
            facePoint(pair, new THREE.Vector3(4.2, 0, -4.6), 0.16);
        }
        participant.animate(pairPhase, movingPair ? 0.88 : 0.05);
        let workerPose = sampleCurvePose(workerMainPath, pathProgress);
        let workerTravelMetric = workerPose.distance;
        let workerMoving = movingPair;
        let workerIntensity = workerMoving ? 0.88 : 0.04;
        const baseAfterWardrobeCycle = workerWardrobeStopDistance + wardrobeTaskLength * 2;
        const baseAfterMoveToMirror = baseAfterWardrobeCycle + workerGroomLength;
        const baseAfterToiletryCycle = baseAfterMoveToMirror + toiletryTaskLength * 2;
        const baseAfterTowelCycle = baseAfterToiletryCycle + towelTaskLength * 2;
        const baseAtHamper = baseAfterTowelCycle + hamperTaskLength;
        const baseAfterHamperReturn = baseAtHamper + hamperReturnLength;
        if (localTime >= 6.5 && localTime < 15.8) {
            if (localTime < 10.5) {
                const progress = timedEase(localTime, 6.5, 10.5);
                workerPose = sampleCurvePose(wardrobeTaskRoute.path, progress);
                workerTravelMetric = workerWardrobeStopDistance + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
            else if (localTime < 11.8) {
                workerPose = sampleCurvePose(wardrobeTaskRoute.path, 1);
                workerPose.yaw = yawToPoint(workerPose.position, workerWardrobeLook);
                workerTravelMetric = workerWardrobeStopDistance + wardrobeTaskLength;
                workerMoving = false;
                workerIntensity = 0.04;
            }
            else {
                const progress = 1 - timedEase(localTime, 11.8, 15.8);
                workerPose = sampleCurvePose(wardrobeTaskRoute.path, progress, -1);
                workerTravelMetric = workerWardrobeStopDistance + wardrobeTaskLength + (wardrobeTaskLength - workerPose.distance);
                workerMoving = true;
                workerIntensity = 1.02;
            }
        }
        else if (toiletryWalkOut || toiletryCollect || toiletryWalkBack) {
            if (toiletryWalkOut) {
                const progress = timedEase(localTime, 23.5, 26.3);
                workerPose = sampleCurvePose(toiletryTaskRoute.path, progress);
                workerTravelMetric = baseAfterMoveToMirror + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
            else if (toiletryCollect) {
                workerPose = sampleCurvePose(toiletryTaskRoute.path, 1);
                workerPose.yaw = yawToPoint(workerPose.position, workerToiletryLook);
                workerTravelMetric = baseAfterMoveToMirror + toiletryTaskLength;
                workerMoving = false;
                workerIntensity = 0.04;
            }
            else {
                const progress = 1 - timedEase(localTime, 27.4, 30.2);
                workerPose = sampleCurvePose(toiletryTaskRoute.path, progress, -1);
                workerTravelMetric = baseAfterMoveToMirror + toiletryTaskLength + (toiletryTaskLength - workerPose.distance);
                workerMoving = true;
                workerIntensity = 1.02;
            }
        }
        else if (towelWalkOut || towelCollect || towelWalkBack) {
            if (towelWalkOut) {
                const progress = timedEase(localTime, 33, 36.5);
                workerPose = sampleCurvePose(towelTaskRoute.path, progress);
                workerTravelMetric = baseAfterToiletryCycle + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
            else if (towelCollect) {
                workerPose = sampleCurvePose(towelTaskRoute.path, 1);
                workerPose.yaw = yawToPoint(workerPose.position, workerTowelLook);
                workerTravelMetric = baseAfterToiletryCycle + towelTaskLength;
                workerMoving = false;
                workerIntensity = 0.04;
            }
            else {
                const progress = 1 - timedEase(localTime, 37.7, 41.2);
                workerPose = sampleCurvePose(towelTaskRoute.path, progress, -1);
                workerTravelMetric = baseAfterToiletryCycle + towelTaskLength + (towelTaskLength - workerPose.distance);
                workerMoving = true;
                workerIntensity = 1.02;
            }
        }
        else if (hamperWalkOut || hamperLoad || hamperWalkBack) {
            if (hamperWalkOut) {
                const progress = timedEase(localTime, 43.7, 46.8);
                workerPose = sampleCurvePose(hamperTaskRoute.path, progress);
                workerTravelMetric = baseAfterTowelCycle + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
            else if (hamperLoad) {
                workerPose = sampleCurvePose(hamperTaskRoute.path, 1);
                workerPose.yaw = yawToPoint(workerPose.position, workerHamperLook);
                workerTravelMetric = baseAfterTowelCycle + hamperTaskLength;
                workerMoving = false;
                workerIntensity = 0.04;
            }
            else {
                const progress = timedEase(localTime, 48, 51);
                workerPose = sampleCurvePose(hamperReturnRoute.path, progress);
                workerTravelMetric = baseAtHamper + workerPose.distance;
                workerMoving = true;
                workerIntensity = 1.02;
            }
        }
        else if (localTime >= 18 && localTime < 21) {
            const progress = timedEase(localTime, 18, 21);
            workerPose = sampleCurvePose(workerGroomRoute.path, progress);
            workerTravelMetric = baseAfterWardrobeCycle + workerPose.distance;
            workerMoving = true;
            workerIntensity = 0.92;
        }
        else if (!movingPair) {
            if (localTime < 18) {
                workerPose = sampleCurvePose(workerMainPath, wardrobeStop);
                workerPose.yaw = yawToPoint(workerPose.position, workerWardrobeLook);
                workerTravelMetric = baseAfterWardrobeCycle;
            }
            else {
                workerPose = { position: workerGroomWorld.clone(), yaw: yawToPoint(workerGroomWorld, new THREE.Vector3(2.55, 0, -1.5)), distance: 0 };
                workerTravelMetric = localTime < 23.5
                    ? baseAfterMoveToMirror
                    : localTime < 33
                        ? baseAfterToiletryCycle
                        : localTime < 43.7
                            ? baseAfterTowelCycle
                            : baseAfterHamperReturn;
            }
            workerMoving = false;
            workerIntensity = 0.04;
        }
        else if (localTime >= 55 && localTime < 56.8) {
            workerPose = sampleCurvePose(workerExitRoute.path, timedEase(localTime, 55, 56.8));
            workerTravelMetric = baseAfterHamperReturn + workerPose.distance;
        }
        else if (localTime >= 56.8) {
            workerPose = sampleCurvePose(workerMainPath, pathProgress);
            workerTravelMetric = baseAfterHamperReturn + workerExitLength + Math.max(0, workerPose.distance - workerMirrorStopDistance);
        }
        workerCarrier.position.copy(workerPose.position);
        workerCarrier.quaternion.setFromAxisAngle(UP, workerPose.yaw);
        applyStageVisibility(workerCarrier);
        worker.animate(workerTravelMetric * 4.9 + 0.45, workerIntensity);
        const doorOpen = timedEase(localTime, 9.55, 10.7);
        const doorClose = timedEase(localTime, 12.1, 15.45);
        const doorAmount = THREE.MathUtils.clamp(doorOpen - doorClose, 0, 1);
        wardrobe.leftDoor.rotation.y = -doorAmount * 0.92;
        wardrobe.rightDoor.rotation.y = doorAmount * 0.92;
        const carryingOutfit = localTime >= 11.1 && localTime < 21.25;
        clothing.visible = localTime < 11.1;
        clothingHeld.visible = carryingOutfit;
        clothingPlaced.visible = localTime >= 21.25;
        clothing.rotation.y = Math.sin(localTime * 1.8) * 0.08;
        if (carryingOutfit) {
            clothingHeld.position.set(-0.06 + Math.sin(localTime * 1.6) * 0.02, -0.72, 0.18);
            clothingHeld.rotation.set(-1.05, -0.18, -0.08 + Math.sin(localTime * 1.5) * 0.03);
            worker.rightArm.rotation.x = -1.02;
            worker.rightArm.rotation.z = -0.22;
        }
        if (choosing) {
            participant.rightArm.rotation.x = -0.68;
            if (localTime >= 10.5 && localTime < 11.8) {
                worker.leftArm.rotation.x = -0.92 + Math.sin(localTime * 3) * 0.08;
                worker.leftArm.rotation.z = 0.3;
                worker.rightArm.rotation.x = -0.78;
            }
        }
        brush.visible = groomingA || groomingB || groomingC;
        towel.visible = localTime >= 37 && localTime < 47.9;
        if (groomingA) {
            participant.rightArm.rotation.x = -1.22 + Math.sin(localTime * 3.1) * 0.2;
            participant.rightArm.rotation.z = -0.24;
            worker.leftArm.rotation.x = -0.56;
            mirror.frameMaterial.emissiveIntensity = 0.18 + Math.sin(localTime * 2.4) * 0.06;
        }
        else if (groomingB) {
            participant.rightArm.rotation.x = -1.16 + Math.sin(localTime * 3.2) * 0.16;
            participant.rightArm.rotation.z = -0.2;
            worker.leftArm.rotation.x = -0.82 + Math.sin(localTime * 2.8) * 0.12;
            worker.leftArm.rotation.z = 0.14;
            worker.rightArm.rotation.x = -0.28;
            mirror.frameMaterial.emissiveIntensity = 0.19 + Math.sin(localTime * 2.4) * 0.06;
        }
        else if (groomingC || readyToGo) {
            participant.rightArm.rotation.x = -0.96 + Math.sin(localTime * 2.4) * 0.12;
            participant.rightArm.rotation.z = -0.18;
            worker.leftArm.rotation.x = -0.64 + Math.sin(localTime * 2.2) * 0.1;
            worker.leftArm.rotation.z = 0.14;
            worker.rightArm.rotation.x = -0.34;
            mirror.frameMaterial.emissiveIntensity = 0.17 + Math.sin(localTime * 2.1) * 0.05;
        }
        else {
            mirror.frameMaterial.emissiveIntensity = 0.07;
        }
        if (toiletryCollect) {
            worker.leftArm.rotation.x = -0.96 + Math.sin(localTime * 3.1) * 0.08;
            worker.leftArm.rotation.z = 0.16;
            worker.rightArm.rotation.x = -0.46;
        }
        if (towelCollect) {
            worker.leftArm.rotation.x = -1.0 + Math.sin(localTime * 3.5) * 0.08;
            worker.leftArm.rotation.z = 0.18;
        }
        if (hamperLoad) {
            worker.leftArm.rotation.x = -0.98 + Math.sin(localTime * 3.4) * 0.08;
            worker.leftArm.rotation.z = 0.22;
            worker.rightArm.rotation.x = -0.42;
        }
        mirrorBulbs.forEach(({ mesh, material }, index) => {
            const active = localTime >= 21 && localTime < 55 ? 1 : 0;
            material.emissiveIntensity = 0.13 + active * (0.55 + Math.sin(localTime * 2.5 + index * 0.42) * 0.08);
            mesh.scale.setScalar(0.92 + active * 0.08 + Math.sin(localTime * 1.7 + index) * 0.025);
        });
        floorLamp.bulbMaterial.emissiveIntensity = 0.45 + Math.sin(localTime * 1.4) * 0.04;
        hangingGarments.forEach((garment, index) => {
            garment.rotation.z = doorAmount * Math.sin(localTime * 1.1 + index) * 0.025;
        });
        careSparkles.visible = grooming;
        careSparkles.position.set(pair.position.x - 0.15, 2.75, pair.position.z - 0.25);
        careSparkles.children.forEach((sparkle, index) => {
            const angle = localTime * 0.65 + (index / careSparkles.children.length) * Math.PI * 2;
            sparkle.position.set(Math.sin(angle) * (0.72 + (index % 2) * 0.22), -0.3 + ((localTime * 0.18 + index / 8) % 1) * 1.4, Math.cos(angle) * 0.34);
            sparkle.rotation.y = localTime * 1.8 + index;
            const opacity = grooming ? 0.22 + Math.sin(localTime * 2.1 + index) * 0.08 : 0;
            sparkleMaterials[index].opacity = Math.max(0, opacity);
        });
        if (movingPair && onStage(pair.position) && (lastPairStamp < 0 || pose.distance - lastPairStamp >= 0.43)) {
            const yaw = yawFromQuaternion(pair.quaternion);
            const left = Math.floor(pose.distance / 0.43) % 2 === 0;
            trails.emit("foot", localPoint(pair, left ? -0.74 : -0.42, -0.34), yaw, 0.18, 0.42, 6.3, left);
            lastPairStamp = pose.distance;
        }
        if (workerMoving && onStage(workerPose.position) && (lastWorkerStamp < 0 || workerTravelMetric - lastWorkerStamp >= 0.42)) {
            const left = Math.floor(workerTravelMetric / 0.42) % 2 === 0;
            tempWorkerFoot.set(left ? -0.17 : 0.17, 0, -0.34)
                .applyAxisAngle(UP, workerPose.yaw)
                .add(workerPose.position);
            trails.emit("foot", tempWorkerFoot, workerPose.yaw, 0.18, 0.42, 6.1, left);
            lastWorkerStamp = workerTravelMetric;
        }
        trails.update(delta);
    };
    root.visible = false;
    parent.add(root);
    return { id, root, duration, trails, update, reset };
}
function createTravelTransportScene(parent) {
    const id = "travel-transport";
    const root = new THREE.Group();
    createServiceBase(root, 0x6f91c2, "TRAVEL & TRANSPORT", "An accessible vehicle journey from door to destination", 0xf1f5f6, "outdoor", { outdoorPortal: { centerX: 3.4, width: 5.6 } });
    const road = makeBox(13.5, 0.08, 21.2, standardMaterial(0x68777e, 0.94), 0.04);
    road.position.set(5, 0.09, 0);
    root.add(road);
    const sidewalk = makeBox(8.9, 0.18, 21.0, standardMaterial(0xe6e0d7, 0.94), 0.04);
    sidewalk.position.set(-6.45, 0.13, 0);
    const curb = makeBox(0.42, 0.34, 21.1, standardMaterial(0xc7beb2, 0.92), 0.04);
    curb.position.set(-1.8, 0.2, 0);
    const curbCut = makeBox(1.75, 0.12, 3.15, standardMaterial(0xe7e1d8, 0.94), 0.035);
    curbCut.position.set(-1.65, 0.16, -3.7);
    curbCut.rotation.z = -0.035;
    const tactile = createTactilePaving(1.45, 2.55, 0xe4c55d);
    tactile.position.set(-2.15, 0.05, -3.7);
    root.add(sidewalk, curb, curbCut, tactile);
    for (const z of [-8, -1.5, 5]) {
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.9, 3), standardMaterial(0xf6e8ac, 0.76));
        arrow.rotation.x = -Math.PI / 2;
        arrow.rotation.z = Math.PI;
        arrow.scale.y = 0.35;
        arrow.position.set(8.2, 0.16, z);
        root.add(arrow);
    }
    for (const x of [0.3, 2.2, 4.1, 6, 7.9, 9.8]) {
        const crossing = makeBox(1.1, 0.035, 0.42, standardMaterial(0xf7f4ed, 0.76), 0.02);
        crossing.position.set(x, 0.15, -6.55);
        root.add(crossing);
    }
    const laneEdgeA = makeBox(0.12, 0.03, 19.5, standardMaterial(0xf7f4ed, 0.62), 0.015);
    laneEdgeA.position.set(-1.18, 0.15, 0);
    const laneEdgeB = laneEdgeA.clone();
    laneEdgeB.position.x = 11.18;
    root.add(laneEdgeA, laneEdgeB);
    const shelterRoof = makeBox(6.6, 0.28, 2.7, standardMaterial(0x7fa78d, 0.68), 0.08);
    shelterRoof.position.set(-9, 4.4, -4.5);
    const shelterGlassMaterial = new THREE.MeshStandardMaterial({
        color: 0xbfdce3,
        roughness: 0.14,
        metalness: 0.08,
        transparent: true,
        opacity: 0.42,
    });
    const shelterBack = makeBox(5.4, 3.65, 0.08, shelterGlassMaterial, 0.03);
    shelterBack.position.set(-9, 2.35, -5.68);
    const shelterSide = makeBox(0.08, 3.65, 2.25, shelterGlassMaterial, 0.03);
    shelterSide.position.set(-11.6, 2.35, -4.55);
    for (const x of [-11.6, -6.4]) {
        const post = makeBox(0.18, 4.2, 0.18, standardMaterial(0x657984, 0.42, 0.35), 0.03);
        post.position.set(x, 2.15, -4.5);
        root.add(post);
    }
    const bench = makeBox(4.2, 0.28, 1.1, standardMaterial(0xd7b28e, 0.82), 0.06);
    bench.position.set(-9, 1.05, -4.5);
    const benchBack = makeBox(4.2, 1.05, 0.2, standardMaterial(0xd7b28e, 0.82), 0.06);
    benchBack.position.set(-9, 1.65, -5.0);
    for (const x of [-10.75, -7.25]) {
        const leg = makeBox(0.16, 1.0, 0.16, standardMaterial(0x596c74, 0.45, 0.38), 0.025);
        leg.position.set(x, 0.52, -4.5);
        root.add(leg);
    }
    const timetableMaterial = new THREE.MeshStandardMaterial({
        color: 0xfffdf8,
        roughness: 0.72,
        emissive: new THREE.Color(0x6f91c2),
        emissiveIntensity: 0.06,
    });
    const timetable = makeBox(1.5, 2.15, 0.07, timetableMaterial, 0.05);
    timetable.position.set(-10.2, 2.65, -5.6);
    for (let index = 0; index < 5; index += 1) {
        const route = makeBox(1.08 - index * 0.08, 0.07, 0.018, standardMaterial(index === 0 ? 0x6f91c2 : 0x93a5aa, 0.72), 0.01);
        route.position.set(-0.05, 0.65 - index * 0.29, 0.055);
        timetable.add(route);
    }
    const stopSign = createBusStopSign(0x6f91c2);
    stopSign.position.set(-5.2, 0, -4.6);
    const treeA = createStreetTree(0x7fa78d);
    treeA.position.set(-13.4, 0, 2.4);
    treeA.scale.setScalar(0.82);
    const treeB = createStreetTree(0x6e9b79);
    treeB.position.set(13.8, 0, -6.4);
    treeB.scale.setScalar(0.74);
    root.add(shelterRoof, shelterBack, shelterSide, bench, benchBack, timetable, stopSign, treeA, treeB);
    for (const [x, z] of [
        [-3.3, -1.9],
        [-3.3, 0.1],
        [-3.3, 2.1],
    ]) {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 1.05, 14), standardMaterial(0x60747c, 0.4, 0.45));
        bollard.position.set(x, 0.55, z);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 7, 18), standardMaterial(0xe6b84d, 0.66));
        ring.position.set(x, 0.82, z);
        ring.rotation.x = Math.PI / 2;
        root.add(bollard, ring);
    }
    const van = createAccessibleVan(0x6f91c2);
    van.root.position.set(3.2, 0, -23);
    root.add(van.root);
    const boarding = new THREE.Group();
    const chair = createWheelchair(true, {
        skin: 0xc78d68,
        shirt: 0x6f91c2,
        trousers: 0x314651,
        hair: 0x24201e,
        hairStyle: "crop",
    });
    chair.root.position.x = -0.65;
    const worker = createHuman({
        skin: 0x7b4b36,
        shirt: 0x2d847d,
        trousers: 0x354a55,
        hair: 0x1d1b1a,
        hairStyle: "bun",
        badge: true,
    });
    worker.root.position.set(0.88, 0, -0.2);
    boarding.add(chair.root, worker.root);
    root.add(boarding);
    const boardPath = createScenePath([
        [-7.9, -2.55],
        [-5.5, -3.05],
        [-2.9, -3.5],
        [-0.5, -3.65],
        [1.5, -3.4],
        [3.2, -2.5],
        [3.2, -0.5],
        [3.2, 1.55],
    ]);
    createRouteRibbon(root, boardPath, 0x6f91c2);
    const trails = new TrailPool(root, 190);
    const duration = 18.5;
    let previousTime = 0;
    let lastVanStamp = -1;
    let lastBoardStamp = -1;
    const reset = () => {
        previousTime = 0;
        lastVanStamp = -1;
        lastBoardStamp = -1;
        trails.clear();
    };
    const update = (localTime, delta) => {
        if (localTime + 0.05 < previousTime)
            reset();
        previousTime = localTime;
        const arrival = timedEase(localTime, 0, 3.7);
        const departure = timedEase(localTime, 12.7, duration);
        const vanZ = localTime < 12.7
            ? THREE.MathUtils.lerp(-23, 3, arrival)
            : THREE.MathUtils.lerp(3, 24, departure);
        const previousVanZ = van.root.position.z;
        van.root.position.set(3.2, 0, vanZ);
        van.root.visible = vanZ > -15.6 && vanZ < 14.9;
        const vanDistance = localTime < 12.7 ? (vanZ + 23) : 26 + (vanZ - 3);
        for (const wheel of van.wheels)
            wheel.rotation.x = -vanDistance / 0.56;
        const rampDown = timedEase(localTime, 3.8, 5.4);
        const rampUp = timedEase(localTime, 10.7, 12.4);
        const openAmount = THREE.MathUtils.clamp(rampDown - rampUp, 0, 1);
        van.ramp.rotation.x = THREE.MathUtils.lerp(2.32, -0.16, openAmount);
        van.leftDoor.position.x = -0.82 - openAmount * 1.15;
        van.rightDoor.position.x = 0.82 + openAmount * 1.15;
        const indicatorOn = (Math.floor(localTime * 2.8) % 2 === 0) && (localTime < 4.5 || localTime > 11.8);
        van.indicatorMaterials.forEach((material) => {
            material.emissiveIntensity = indicatorOn ? 1.25 : 0.08;
        });
        const braking = (localTime > 2.9 && localTime < 4.2) || (localTime > 11.8 && localTime < 13.1);
        van.brakeMaterials.forEach((material) => {
            material.emissiveIntensity = braking ? 1.1 : 0.12;
        });
        van.interiorLightMaterial.emissiveIntensity = openAmount > 0.05 ? 0.78 : 0.08;
        timetableMaterial.emissiveIntensity = 0.06 + Math.sin(localTime * 1.7) * 0.025;
        const boardProgress = localTime < 5.4
            ? 0
            : localTime < 10.7
                ? timedEase(localTime, 5.4, 10.7)
                : 1;
        let boardPose;
        if (localTime < 5.4) {
            boardPose = { position: boardPath.getPointAt(0), yaw: 0, distance: 0 };
            boarding.position.copy(boardPose.position);
            const watchTarget = new THREE.Vector3(3.2, 0, Math.min(vanZ, 1.4));
            facePoint(boarding, watchTarget, 0.16);
        }
        else {
            boardPose = poseOnPath(boarding, boardPath, boardProgress);
        }
        const boardPhase = boardPose.distance * 5.2;
        chair.animate(boardPose.distance, boardPhase);
        worker.animate(boardPhase + 1.1, localTime >= 5.4 && localTime < 10.7 ? 0.86 : 0.04);
        boarding.visible = localTime < 11.5 && onStage(boarding.position, 0.8);
        if (boardProgress > 0.76)
            boarding.position.y = (boardProgress - 0.76) * 1.85;
        else
            boarding.position.y = 0;
        const vanMoving = Math.abs(vanZ - previousVanZ) > 0.0005;
        if (vanMoving && Math.abs(vanZ) < 11.2 && (lastVanStamp < 0 || vanDistance - lastVanStamp >= 0.55)) {
            trails.emit("vehicle", new THREE.Vector3(1.75, 0, vanZ - 1.9), 0, 0.2, 0.58, 8.4);
            trails.emit("vehicle", new THREE.Vector3(4.65, 0, vanZ - 1.9), 0, 0.2, 0.58, 8.4);
            lastVanStamp = vanDistance;
        }
        if (localTime >= 5.4 && localTime < 10.7 && (lastBoardStamp < 0 || boardPose.distance - lastBoardStamp >= 0.34)) {
            const yaw = yawFromQuaternion(boarding.quaternion);
            trails.emit("wheel", localPoint(boarding, -1.34, -0.08), yaw, 0.16, 0.46, 7.2);
            trails.emit("wheel", localPoint(boarding, 0.05, -0.08), yaw, 0.16, 0.46, 7.2);
            const left = Math.floor(boardPose.distance / 0.34) % 2 === 0;
            trails.emit("foot", localPoint(boarding, left ? 0.72 : 1.02, -0.4), yaw, 0.18, 0.42, 6.4, left);
            lastBoardStamp = boardPose.distance;
        }
        trails.update(delta);
    };
    root.visible = false;
    parent.add(root);
    return { id, root, duration, trails, update, reset };
}
function createSharedLivingScene(parent) {
    const id = "shared-living";
    const root = new THREE.Group();
    createServiceBase(root, 0x7fa78d, "DAILY TASKS & SHARED LIVING", "Plan, cook and build everyday skills together", 0xf2f5ef, "indoor", { artX: -1.4 });
    const kitchenRug = createPatternedRug(8.2, 4.5, 0xe4ecdf, 0x7fa78d);
    kitchenRug.position.set(-1.2, 0, 2.25);
    const pantry = createBookshelf(0x7fa78d);
    pantry.scale.setScalar(0.86);
    pantry.position.set(-12.1, 0, -6.85);
    const clock = createWallClock(0x7fa78d);
    clock.root.position.set(-4.2, 4.8, -8.96);
    root.add(kitchenRug, pantry, clock.root);
    const kitchen = createKitchen(0x7fa78d);
    root.add(kitchen.root);
    const planner = makeBox(4.8, 3.1, 0.15, standardMaterial(0xfffdf8, 0.94), 0.05);
    planner.position.set(7.2, 3.1, -8.73);
    const plannerFrame = standardMaterial(0xb6916f, 0.76);
    for (const [width, height, x, y] of [
        [5.0, 0.13, 0, 1.62],
        [5.0, 0.13, 0, -1.62],
        [0.13, 3.18, -2.47, 0],
        [0.13, 3.18, 2.47, 0],
    ]) {
        const frame = makeBox(width, height, 0.1, plannerFrame, 0.02);
        frame.position.set(x, y, 0.12);
        planner.add(frame);
    }
    for (let index = 0; index < 3; index += 1) {
        const number = makeBox(0.48, 0.48, 0.035, standardMaterial(index === 0 ? 0xd6a247 : index === 1 ? 0x6f91c2 : 0xd47e6c, 0.78), 0.06);
        number.position.set(-1.75, 0.65 - index * 0.72, 0.12);
        planner.add(number);
    }
    root.add(planner);
    const checks = [];
    for (let index = 0; index < 3; index += 1) {
        const bar = makeBox(2.5, 0.11, 0.04, standardMaterial(index === 0 ? 0xd6a247 : 0x6f91c2, 0.8), 0.02);
        bar.position.set(7.1, 3.75 - index * 0.72, -8.62);
        root.add(bar);
        const check = makeSphere(0.13, standardMaterial(0x2d847d, 0.72), 10, 7);
        check.scale.z = 0.22;
        check.position.set(5.25, 3.75 - index * 0.72, -8.57);
        check.visible = false;
        checks.push(check);
        root.add(check);
    }
    const pair = new THREE.Group();
    const workerCarrier = new THREE.Group();
    const participant = createHuman({
        skin: 0x6d4636,
        shirt: 0x7fa78d,
        trousers: 0x3b4f5a,
        hair: 0x1c1c1c,
        hairStyle: "crop",
        prosthetic: "right",
        glasses: true,
    });
    participant.root.position.x = 0;
    const worker = createHuman({
        skin: 0xd3a17e,
        shirt: 0x2d847d,
        trousers: 0x354956,
        hair: 0x5b3a2d,
        hairStyle: "waves",
        badge: true,
    });
    const apron = makeBox(0.58, 0.72, 0.05, standardMaterial(0xd6a247, 0.86), 0.06);
    apron.position.set(0, -0.1, 0.43);
    const apronPocket = makeBox(0.34, 0.18, 0.025, standardMaterial(0xf7f1e8, 0.88), 0.03);
    apronPocket.position.set(0, -0.22, 0.045);
    apron.add(apronPocket);
    worker.torso.add(apron);
    worker.root.position.set(0, 0, 0);
    const groceryBag = makeBox(0.72, 0.82, 0.4, standardMaterial(0xd6a247, 0.88), 0.06);
    groceryBag.position.set(1.08, 0.78, 0.14);
    const bagHandle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 7, 18, Math.PI), standardMaterial(0x7c5a3d, 0.72));
    bagHandle.position.set(0, 0.42, 0);
    bagHandle.rotation.z = Math.PI;
    groceryBag.add(bagHandle);
    groceryBag.position.set(0.52, 0.78, 0.2);
    pair.add(participant.root, groceryBag);
    workerCarrier.add(worker.root);
    root.add(pair, workerCarrier);
    const groceries = [];
    const groceryColours = [0xd47e6c, 0x7fa78d, 0xd6a247];
    for (let index = 0; index < 3; index += 1) {
        const item = makeSphere(0.22, standardMaterial(groceryColours[index], 0.88), 12, 8);
        item.position.set(-1.5 + index * 0.55, 1.92, -0.1);
        item.visible = false;
        groceries.push(item);
        root.add(item);
    }
    const ingredientGroup = new THREE.Group();
    const carrot = makeCapsule(0.1, 0.48, standardMaterial(0xe58a3b, 0.88), 10);
    carrot.rotation.z = Math.PI / 2;
    carrot.position.set(-2.05, 1.88, -0.05);
    const carrotLeaf = makeCapsule(0.045, 0.22, standardMaterial(0x5d8d65, 0.88), 8);
    carrotLeaf.rotation.z = Math.PI / 2;
    carrotLeaf.position.set(-2.38, 1.9, -0.05);
    const milk = makeBox(0.42, 0.72, 0.38, standardMaterial(0xf8f4ed, 0.88), 0.04);
    milk.position.set(-0.98, 2.08, -0.05);
    const milkBand = makeBox(0.32, 0.14, 0.025, standardMaterial(0x6f91c2, 0.76), 0.02);
    milkBand.position.set(0, 0.05, 0.21);
    milk.add(milkBand);
    const bread = makeBox(0.72, 0.42, 0.48, standardMaterial(0xd4a56f, 0.92), 0.12);
    bread.position.set(-0.35, 1.96, -0.05);
    ingredientGroup.add(carrot, carrotLeaf, milk, bread);
    ingredientGroup.visible = false;
    root.add(ingredientGroup);
    const carriedPlates = new THREE.Group();
    for (let index = 0; index < 2; index += 1) {
        const carried = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.075, 22), standardMaterial(0xfffdf8, 0.78));
        carried.position.set(0.02, 1.06 + index * 0.09, 0.42);
        carriedPlates.add(carried);
    }
    carriedPlates.visible = false;
    workerCarrier.add(carriedPlates);
    const plates = [];
    const tablePlates = [];
    for (let index = 0; index < 2; index += 1) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.08, 24), standardMaterial(0xfffdf8, 0.78));
        plate.position.set(-0.8 + index * 1.3, 1.78, -0.1);
        plates.push(plate);
        root.add(plate);
        const tablePlate = plate.clone();
        tablePlate.position.set(7.2 + index * 1.85, 1.52, 2.6);
        tablePlate.visible = false;
        tablePlate.scale.setScalar(0.01);
        tablePlates.push(tablePlate);
        root.add(tablePlate);
    }
    const spoon = cylinderBetween(new THREE.Vector3(2.3, 2.2, -5.42), new THREE.Vector3(2.3, 3.05, -5.42), 0.035, standardMaterial(0xd6a247, 0.42, 0.35), 8);
    const recipeLaptop = createLaptop(0x7fa78d);
    recipeLaptop.root.scale.setScalar(0.68);
    recipeLaptop.root.position.set(0.85, 1.72, 0.05);
    recipeLaptop.root.rotation.y = -0.12;
    const tableMugs = [createMug(0x7fa78d), createMug(0xd6a247)];
    tableMugs[0].position.set(6.7, 1.5, 3.45);
    tableMugs[1].position.set(9.7, 1.5, 2.15);
    root.add(spoon, recipeLaptop.root, ...tableMugs);
    /* v65: the walkway clears the island and the dining table by a full body
       width — the drawn route is also the route people actually walk. */
    const path = createScenePath([
        [-23, 10],
        [-15, 7.6],
        [-8, 4.4],
        [-3.4, 2.15],
        [-0.8, 1.9],
        [1.8, 1.35],
        [5.3, 0.62],
        [8.9, 0.42],
        [12.4, 0.85],
        [15.2, 6.0],
        [23, 10.8],
    ]);
    createRouteRibbon(root, path, 0x7fa78d);
    const station = closestPathProgress(path, new THREE.Vector3(-0.8, 0, 1.4));
    const stationPose = sampleCurvePose(path, station);
    const mainLength = path.getLength();
    const sharedObstacles = [
        { type: "rect", label: "island", minX: -4.75, maxX: 2.35, minZ: -1.5, maxZ: 1.3 },
        { type: "rect", label: "back-counter", minX: -1.35, maxX: 10.0, minZ: -6.85, maxZ: -4.75 },
        { type: "rect", label: "fridge", minX: 8.85, maxX: 11.55, minZ: -6.7, maxZ: -4.6 },
        { type: "rect", label: "table", minX: 5.8, maxX: 10.6, minZ: 1.05, maxZ: 4.55 },
        { type: "rect", label: "pantry", minX: -13.6, maxX: -10.6, minZ: -7.8, maxZ: -6.0 },
    ];
    const prepSpotParticipant = new THREE.Vector3(-2.15, 0, -2.35);
    const prepSpotWorker = new THREE.Vector3(-0.15, 0, -2.4);
    const stoveSpot = new THREE.Vector3(2.3, 0, -3.7);
    const tableSpotWorker = new THREE.Vector3(6.35, 0, 0.22);
    const tableSpotParticipant = new THREE.Vector3(4.7, 0, 1.7);
    const exitJoin = closestPathProgress(path, new THREE.Vector3(8.9, 0, 0.42));
    const exitJoinPose = sampleCurvePose(path, exitJoin);
    const workerEntryPath = createOffsetScenePath(path, -1.05, -0.15);
    const workerEntryEnd = workerEntryPath.getPointAt(station).setY(0);
    /* v65: every walking leg is solved by the shared obstacle-aware navigator
       (care-nav.js) against sharedObstacles. Clearance covers the whole body;
       the plate-carrying leg gets extra room for the stack held out front. */
    const gp = (x, z) => new THREE.Vector3(x, 0, z);
    const bodyClear = 0.55;
    const carryClear = 0.7;
    const sp = stationPose.position;
    const participantPrepRoute = createNavigationRoute(sp, prepSpotParticipant, sharedObstacles, bodyClear, [gp(-3.9, 2.35), gp(-6.35, 1.0), gp(-6.45, -1.35), gp(-4.5, -2.6)]);
    const workerPrepRoute = createNavigationRoute(workerEntryEnd, prepSpotWorker, sharedObstacles, bodyClear, [gp(-3.3, 3.05), gp(-7.3, 1.4), gp(-7.4, -1.7), gp(-4.9, -3.1)]);
    const workerStoveRoute = createNavigationRoute(prepSpotWorker, stoveSpot, sharedObstacles, bodyClear, [gp(1.1, -3.0)]);
    const workerTableRoute = createNavigationRoute(stoveSpot, tableSpotWorker, sharedObstacles, carryClear, [gp(4.0, -2.4), gp(5.0, -1.0)]);
    const participantTableRoute = createNavigationRoute(prepSpotParticipant, tableSpotParticipant, sharedObstacles, bodyClear, [gp(0.7, -2.55), gp(3.15, -2.15), gp(4.45, -0.55)]);
    const chairApproachP = new THREE.Vector3(5.28, 0, 1.58);
    const chairSeatP = new THREE.Vector3(5.9, 0, 2.78);
    const chairApproachW = new THREE.Vector3(11.3, 0, 1.9);
    const chairSeatW = new THREE.Vector3(10.5, 0, 2.82);
    /* the walk to each chair goes AROUND the table, never through it */
    const participantSitRoute = createNavigationRoute(tableSpotParticipant, chairApproachP, sharedObstacles, 0.34);
    const workerSitRoute = createNavigationRoute(tableSpotWorker, chairApproachW, sharedObstacles, 0.5, [gp(11.55, 0.35)]);
    const participantExitRoute = createNavigationRoute(chairApproachP, exitJoinPose.position, sharedObstacles, 0.4, [gp(5.05, 0.5), gp(7.0, 0.3)]);
    const workerExitRoute2 = createNavigationRoute(chairApproachW, exitJoinPose.position, sharedObstacles, 0.4, [gp(11.5, 0.6), gp(9.9, 0.45)]);
    const tableFood = [];
    for (let index = 0; index < 2; index += 1) {
        const mound = makeSphere(0.26, standardMaterial(index ? 0x7fa78d : 0xd6a247, 0.9), 12, 8);
        mound.position.set(7.2 + index * 1.85, 1.63, 2.6);
        mound.visible = false;
        root.add(mound);
        tableFood.push(mound);
    }
    const seatLerp = new THREE.Vector3();
    const trails = new TrailPool(root, 200);
    const duration = 31;
    let previousTime = 0;
    let lastStamp = -1;
    let lastWorkerStamp2 = -1;
    const reset = () => {
        previousTime = 0;
        lastStamp = -1;
        trails.clear();
    };
    const update = (localTime, delta) => {
        if (localTime + 0.05 < previousTime)
            reset();
        previousTime = localTime;
        const entering = localTime < 4.4;
        const toPrep = localTime >= 4.4 && localTime < 6.4;
        const prepping = localTime >= 6.4 && localTime < 15.2;
        const stoveWalk = localTime >= 9.4 && localTime < 11.2;
        const cooking = localTime >= 11.2 && localTime < 14.8;
        const workerTableWalk = localTime >= 14.8 && localTime < 16.4;
        const participantTableWalk = localTime >= 15.2 && localTime < 17.2;
        const together = localTime >= 16.4 && localTime < 18.8;
        const sitWalk = localTime >= 18.8 && localTime < 20.15;
        const sitAmount = timedEase(localTime, 20.15, 20.75) - timedEase(localTime, 25.8, 26.4);
        const eating = localTime >= 20.75 && localTime < 25.8;
        const exitWalk = localTime >= 26.4 && localTime < 27.8;
        const stationDistance = station * mainLength;
        const pBaseStation = stationDistance;
        const pBasePrep = pBaseStation + participantPrepRoute.length;
        const pBaseTable = pBasePrep + participantTableRoute.length;
        const pBaseExit = pBaseTable + participantSitRoute.length + participantExitRoute.length;
        let pose;
        let participantMoving = true;
        if (entering) {
            pose = poseOnPath(pair, path, THREE.MathUtils.lerp(0, station, timedEase(localTime, 0, 4.4)));
        }
        else if (toPrep) {
            pose = poseOnPath(pair, participantPrepRoute.path, timedEase(localTime, 4.4, 6.4));
            pose.distance += pBaseStation;
        }
        else if (localTime < 15.2) {
            participantMoving = false;
            pose = { position: prepSpotParticipant, yaw: 0, distance: pBasePrep };
            pair.position.copy(prepSpotParticipant);
            facePoint(pair, new THREE.Vector3(-1.6, 0, -0.1), 0.16);
        }
        else if (participantTableWalk) {
            pose = poseOnPath(pair, participantTableRoute.path, timedEase(localTime, 15.2, 17.2));
            pose.distance += pBasePrep;
        }
        else if (localTime < 18.8) {
            participantMoving = false;
            pose = { position: tableSpotParticipant, yaw: 0, distance: pBaseTable };
            pair.position.copy(tableSpotParticipant);
            facePoint(pair, new THREE.Vector3(7.4, 0, 1.6), 0.16);
        }
        else if (sitWalk) {
            pose = poseOnPath(pair, participantSitRoute.path, timedEase(localTime, 18.8, 20.15));
            pose.distance += pBaseTable;
        }
        else if (localTime < 26.4) {
            participantMoving = false;
            seatLerp.lerpVectors(chairApproachP, chairSeatP, sitAmount);
            seatLerp.y = 0.24 * sitAmount;
            pose = { position: seatLerp.clone(), yaw: 0, distance: pBaseTable + participantSitRoute.length };
            pair.position.copy(seatLerp);
            facePoint(pair, new THREE.Vector3(8.2, 0, 2.8), 0.22);
        }
        else if (exitWalk) {
            pose = poseOnPath(pair, participantExitRoute.path, timedEase(localTime, 26.4, 27.8));
            pose.distance += pBaseTable + participantSitRoute.length;
        }
        else {
            const progress = THREE.MathUtils.lerp(exitJoin, 0.999, timedEase(localTime, 27.8, duration));
            pose = poseOnPath(pair, path, progress);
            pose.distance = pBaseExit + Math.max(0, pose.distance - exitJoin * mainLength);
        }
        applyStageVisibility(pair);
        participant.animate(pose.distance * 5.2, participantMoving ? 0.88 : 0.05);
        const wBaseStation = stationDistance;
        const wBasePrep = wBaseStation + workerPrepRoute.length;
        const wBaseStove = wBasePrep + workerStoveRoute.length;
        const wBaseTable = wBaseStove + workerTableRoute.length;
        const wBaseExit = wBaseTable + workerSitRoute.length + workerExitRoute2.length;
        let workerPose;
        let workerMoving = true;
        if (entering) {
            const progress = THREE.MathUtils.lerp(0, station, timedEase(localTime, 0, 4.4));
            workerPose = poseOnPath(workerCarrier, workerEntryPath, progress);
        }
        else if (toPrep) {
            workerPose = poseOnPath(workerCarrier, workerPrepRoute.path, timedEase(localTime, 4.4, 6.4));
            workerPose.distance += wBaseStation;
        }
        else if (localTime < 9.4) {
            workerMoving = false;
            workerPose = { position: prepSpotWorker, yaw: 0, distance: wBasePrep };
            workerCarrier.position.copy(prepSpotWorker);
            facePoint(workerCarrier, new THREE.Vector3(-0.4, 0, -0.1), 0.16);
        }
        else if (stoveWalk) {
            workerPose = poseOnPath(workerCarrier, workerStoveRoute.path, timedEase(localTime, 9.4, 11.2));
            workerPose.distance += wBasePrep;
        }
        else if (cooking) {
            workerMoving = false;
            workerPose = { position: stoveSpot, yaw: 0, distance: wBaseStove };
            workerCarrier.position.copy(stoveSpot);
            facePoint(workerCarrier, new THREE.Vector3(2.3, 0, -5.42), 0.18);
        }
        else if (workerTableWalk) {
            workerPose = poseOnPath(workerCarrier, workerTableRoute.path, timedEase(localTime, 14.8, 16.4));
            workerPose.distance += wBaseStove;
        }
        else if (localTime < 18.8) {
            workerMoving = false;
            workerPose = { position: tableSpotWorker, yaw: 0, distance: wBaseTable };
            workerCarrier.position.copy(tableSpotWorker);
            facePoint(workerCarrier, localTime < 17.4 ? new THREE.Vector3(8.2, 0, 2.8) : new THREE.Vector3(4.7, 0, 1.7), 0.16);
        }
        else if (sitWalk) {
            workerPose = poseOnPath(workerCarrier, workerSitRoute.path, timedEase(localTime, 18.8, 20.15));
            workerPose.distance += wBaseTable;
        }
        else if (localTime < 26.4) {
            workerMoving = false;
            seatLerp.lerpVectors(chairApproachW, chairSeatW, sitAmount);
            seatLerp.y = 0.24 * sitAmount;
            workerPose = { position: seatLerp.clone(), yaw: 0, distance: wBaseTable + workerSitRoute.length };
            workerCarrier.position.copy(seatLerp);
            facePoint(workerCarrier, new THREE.Vector3(8.2, 0, 2.8), 0.22);
        }
        else if (exitWalk) {
            workerPose = poseOnPath(workerCarrier, workerExitRoute2.path, timedEase(localTime, 26.4, 27.8));
            workerPose.distance += wBaseTable + workerSitRoute.length;
        }
        else {
            const progress = Math.max(exitJoin, THREE.MathUtils.lerp(exitJoin, 0.999, timedEase(localTime, 27.8, duration)) - 0.022);
            workerPose = poseOnPath(workerCarrier, path, progress);
            workerPose.distance = wBaseExit + Math.max(0, workerPose.distance - exitJoin * mainLength);
        }
        applyStageVisibility(workerCarrier);
        worker.animate(workerPose.distance * 5.2 + 1.15, workerMoving ? 0.86 : 0.06);
        if (sitAmount > 0.001) {
            applySeatBlend(participant, sitAmount);
            applySeatBlend(worker, sitAmount);
        }
        const eatingNow = eating ? 1 : 0;
        if (eatingNow) {
            const bite = Math.sin(localTime * 2.1);
            participant.rightArm.rotation.x = -0.58 - Math.max(0, bite) * 0.58;
            participant.rightArm.rotation.z = -0.1;
            participant.leftArm.rotation.x = -0.3;
            worker.rightArm.rotation.x = -0.58 - Math.max(0, -bite) * 0.58;
            worker.rightArm.rotation.z = -0.1;
            worker.leftArm.rotation.x = -0.3;
            participant.head.rotation.x = 0.06 + Math.max(0, bite) * 0.1;
            worker.head.rotation.x = 0.06 + Math.max(0, -bite) * 0.1;
            participant.head.rotation.y = Math.sin(localTime * 0.7) * 0.22;
            worker.head.rotation.y = -Math.sin(localTime * 0.7 + 0.4) * 0.22;
        }
        tableFood.forEach((mound, index) => {
            const served = smoothStep(timedEase(localTime, 16.9 + index * 0.3, 17.5 + index * 0.3));
            const eaten = timedEase(localTime, 20.9, 25.5);
            mound.visible = served > 0.02 && eaten < 0.97;
            const size = served * (1 - eaten * 0.85);
            mound.scale.set(size, 0.55 * size, size);
        });
        groceryBag.visible = localTime < 6.6;
        const unpack = timedEase(localTime, 6.6, 9.4);
        groceries.forEach((item, index) => {
            const itemProgress = THREE.MathUtils.clamp(unpack * 1.5 - index * 0.25, 0, 1);
            const settle = smoothStep(itemProgress);
            item.visible = itemProgress > 0.02;
            item.position.set(-1.5 + index * 0.55, 1.84 + settle * 0.08 + Math.sin(localTime * 4 + index) * 0.012, -0.1);
            item.scale.setScalar(0.72 + settle * 0.28);
        });
        ingredientGroup.visible = unpack > 0.18;
        ingredientGroup.children.forEach((item, index) => {
            item.scale.setScalar(0.82 + smoothStep(THREE.MathUtils.clamp(unpack * 1.4 - index * 0.08, 0, 1)) * 0.18);
        });
        kitchen.steam.visible = cooking;
        kitchen.steam.children.forEach((child, index) => {
            const rise = (localTime * 0.38 + index / kitchen.steam.children.length) % 1;
            child.position.set(2.3 + Math.sin(index * 2.2) * 0.22, 2.35 + rise * 1.8, -5.42 + Math.cos(index * 1.8) * 0.18);
            child.scale.setScalar(0.7 + rise * 0.9);
        });
        spoon.visible = cooking;
        spoon.rotation.y = localTime * 2.8;
        kitchen.ovenMaterial.emissiveIntensity = cooking ? 0.2 + Math.sin(localTime * 2.4) * 0.05 : 0.04;
        kitchen.pendantMaterials.forEach((material, index) => {
            material.emissiveIntensity = 0.42 + Math.sin(localTime * 1.6 + index) * 0.045;
        });
        recipeLaptop.screenMaterial.emissiveIntensity = localTime >= 4.4 && localTime < 15.2 ? 0.28 + Math.sin(localTime * 1.9) * 0.04 : 0.08;
        clock.minute.rotation.z = -localTime * 0.12;
        clock.hour.rotation.z = -localTime * 0.022;
        if (prepping && !participantMoving) {
            participant.rightArm.rotation.x = -0.86 + Math.sin(localTime * 2.9) * 0.14;
            participant.leftArm.rotation.x = -0.44 + Math.sin(localTime * 2.2 + 0.4) * 0.06;
        }
        if (localTime >= 6.4 && localTime < 9.4) {
            worker.leftArm.rotation.x = -0.78 + Math.sin(localTime * 2.7) * 0.14;
            worker.rightArm.rotation.x = -0.5 + Math.sin(localTime * 2.4 + 0.6) * 0.1;
        }
        else if (cooking) {
            worker.rightArm.rotation.x = -0.94 + Math.sin(localTime * 2.8) * 0.14;
            worker.leftArm.rotation.x = -0.46;
        }
        else if (together && !workerMoving) {
            worker.rightArm.rotation.x = -0.66 + Math.sin(localTime * 2.1) * 0.1;
            participant.rightArm.rotation.x = -0.58 + Math.sin(localTime * 2.3 + 0.8) * 0.1;
        }
        carriedPlates.visible = workerTableWalk;
        const counterFade = 1 - smoothStep(timedEase(localTime, 14.5, 15.1));
        plates.forEach((plate, index) => {
            plate.visible = counterFade > 0.02 && localTime < 15.2;
            plate.position.set(-0.8 + index * 1.3, 1.78, -0.1);
            plate.scale.setScalar(0.7 + counterFade * 0.3);
        });
        tablePlates.forEach((plate, index) => {
            const tableAmount = smoothStep(timedEase(localTime, 16.1 + index * 0.3, 16.8 + index * 0.3));
            plate.visible = tableAmount > 0.02;
            plate.position.set(7.2 + index * 1.85, 1.56 - tableAmount * 0.04, 2.6);
            plate.scale.setScalar(0.01 + tableAmount * 0.99);
        });
        checks.forEach((check, index) => {
            check.visible = localTime > 7 + index * 3.4;
            check.scale.setScalar(check.visible ? 0.9 + Math.sin(localTime * 3 + index) * 0.08 : 0);
            check.scale.z = 0.22;
        });
        if (participantMoving && onStage(pair.position) && (lastStamp < 0 || pose.distance - lastStamp >= 0.43)) {
            const yaw = yawFromQuaternion(pair.quaternion);
            const left = Math.floor(pose.distance / 0.43) % 2 === 0;
            trails.emit(left ? "foot" : "prosthetic", localPoint(pair, left ? -0.15 : 0.16, -0.34), yaw, 0.18, 0.42, 8.2, left);
            lastStamp = pose.distance;
        }
        if (workerMoving && onStage(workerCarrier.position) && (lastWorkerStamp2 < 0 || workerPose.distance - lastWorkerStamp2 >= 0.42)) {
            const yaw = yawFromQuaternion(workerCarrier.quaternion);
            const left = Math.floor(workerPose.distance / 0.42) % 2 === 0;
            trails.emit("foot", localPoint(workerCarrier, left ? -0.17 : 0.17, -0.34), yaw, 0.18, 0.42, 6.2, left);
            lastWorkerStamp2 = workerPose.distance;
        }
        trails.update(delta);
    };
    root.visible = false;
    parent.add(root);
    return { id, root, duration, trails, update, reset };
}
function createHouseholdScene(parent) {
    const id = "household";
    const root = new THREE.Group();
    createServiceBase(root, 0x806f98, "HOUSEHOLD TASKS", "Cleaning, laundry and organised everyday spaces", 0xf4f1f6, "indoor", { artX: 2.6 });
    const rug = createPatternedRug(14.4, 10.4, 0xe9e1ec, 0x806f98);
    rug.position.set(-2.2, 0, 0.65);
    const sofa = createSofa(0xc9bdd4);
    sofa.position.set(-10.9, 0, -5.65);
    sofa.scale.setScalar(0.88);
    const coffeeTable = new THREE.Group();
    const coffeeTop = makeBox(4.3, 0.24, 2.15, standardMaterial(0xc9a785, 0.82), 0.12);
    coffeeTop.position.y = 0.92;
    coffeeTable.add(coffeeTop);
    for (const [x, z] of [[-1.62, -0.68], [1.62, -0.68], [-1.62, 0.68], [1.62, 0.68]]) {
        const leg = makeBox(0.16, 0.88, 0.16, standardMaterial(0x586a72, 0.44, 0.34), 0.035);
        leg.position.set(x, 0.45, z);
        coffeeTable.add(leg);
    }
    const magazine = makeBox(1.18, 0.055, 0.82, standardMaterial(0xfffdf8, 0.96), 0.025);
    magazine.position.set(-0.72, 1.07, 0.14);
    magazine.rotation.y = 0.18;
    const magazineBand = makeBox(0.88, 0.018, 0.18, standardMaterial(0x806f98, 0.76), 0.008);
    magazineBand.position.set(0, 0.04, 0.08);
    magazine.add(magazineBand);
    const livingMug = createMug(0x806f98);
    livingMug.scale.setScalar(0.82);
    livingMug.position.set(0.86, 1.08, -0.2);
    coffeeTable.add(magazine, livingMug);
    coffeeTable.position.set(-7.2, 0, -1.95);
    const bookshelf = createBookshelf(0x806f98);
    bookshelf.position.set(-13.15, 0, -6.85);
    bookshelf.scale.setScalar(0.86);
    const lamp = createFloorLamp(0x806f98);
    lamp.root.position.set(-7.45, 0, -6.55);
    const clock = createWallClock(0x806f98);
    clock.root.position.set(-1.8, 4.82, -8.97);
    root.add(rug, sofa, coffeeTable, bookshelf, lamp.root, clock.root);
    const washer = createWashingMachine(0x806f98);
    washer.root.position.set(10.25, 0, -5.95);
    root.add(washer.root);
    const utilityCabinet = new THREE.Group();
    const cabinetMaterial = standardMaterial(0xe8e0e9, 0.94);
    const cabinet = makeBox(3.1, 5.5, 2.05, cabinetMaterial, 0.12);
    cabinet.position.y = 2.75;
    const cabinetSplit = makeBox(0.075, 5.05, 0.05, standardMaterial(0xcabdd1, 0.88), 0.018);
    cabinetSplit.position.set(0, 2.75, 1.045);
    utilityCabinet.add(cabinet, cabinetSplit);
    for (const side of [-1, 1]) {
        const handle = makeBox(0.08, 0.72, 0.11, standardMaterial(0x657984, 0.38, 0.42), 0.02);
        handle.position.set(side * 0.36, 2.82, 1.12);
        utilityCabinet.add(handle);
    }
    utilityCabinet.position.set(14.1, 0, -6.42);
    root.add(utilityCabinet);
    const wallStorage = new THREE.Group();
    for (let index = 0; index < 2; index += 1) {
        const cupboard = makeBox(2.75, 1.7, 0.72, standardMaterial(index ? 0xeee8ef : 0xe2d7e6, 0.92), 0.08);
        cupboard.position.set(index * 2.9, 0, 0);
        const handle = makeBox(0.34, 0.07, 0.08, standardMaterial(0x667b82, 0.4, 0.42), 0.018);
        handle.position.set(index * 2.9, -0.52, 0.41);
        wallStorage.add(cupboard, handle);
    }
    wallStorage.position.set(6.2, 5.25, -8.62);
    root.add(wallStorage);
    const detergentShelf = makeBox(4.9, 0.16, 0.72, standardMaterial(0xbe9c7a, 0.82), 0.035);
    detergentShelf.position.set(8.1, 4.35, -8.58);
    root.add(detergentShelf);
    const detergentBottles = [];
    for (const [index, color, height] of [
        [0, 0x6f91c2, 0.82],
        [1, 0xd47e6c, 0.7],
        [2, 0x7fa78d, 0.9],
        [3, 0xd6a247, 0.74],
    ]) {
        const bottle = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, height, 14), standardMaterial(color, 0.78));
        body.position.y = height * 0.5;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.13, 12), standardMaterial(0xfffdf8, 0.84));
        cap.position.y = height + 0.065;
        const label = makeBox(0.31, 0.24, 0.035, standardMaterial(0xfffdf8, 0.9), 0.015);
        label.position.set(0, height * 0.52, 0.235);
        bottle.add(body, cap, label);
        bottle.position.set(6.7 + index * 0.92, 4.44, -8.27);
        detergentBottles.push(bottle);
        root.add(bottle);
    }
    const foldTable = createDesk(0x806f98);
    foldTable.scale.set(0.68, 0.68, 0.68);
    foldTable.position.set(7.7, 0, 2.9);
    root.add(foldTable);
    const caddy = createCleaningCaddy(0x806f98);
    caddy.position.set(2.85, 0.02, -5.85);
    caddy.scale.setScalar(0.88);
    root.add(caddy);
    const participantRoot = new THREE.Group();
    const chair = createWheelchair(true, {
        skin: 0x8c5c43,
        shirt: 0x806f98,
        trousers: 0x354955,
        hair: 0x2c211e,
        hairStyle: "waves",
        glasses: true,
    });
    const carriedBasket = createLaundryBasket(0xd6a247);
    carriedBasket.scale.setScalar(0.62);
    carriedBasket.position.set(0, 0.92, 0.9);
    carriedBasket.rotation.x = -0.08;
    participantRoot.add(chair.root, carriedBasket);
    root.add(participantRoot);
    const floorBasket = createLaundryBasket(0xd6a247);
    floorBasket.scale.setScalar(0.78);
    floorBasket.position.set(7.85, 0.02, -5.25);
    floorBasket.visible = false;
    root.add(floorBasket);
    const workerRoot = new THREE.Group();
    const worker = createHuman({
        skin: 0xd5a27e,
        shirt: 0x2d847d,
        trousers: 0x354956,
        hair: 0x5c3b2c,
        hairStyle: "bun",
        badge: true,
    });
    worker.root.position.z = -0.86;
    const vacuum = createVacuum(0x806f98);
    vacuum.root.position.z = 0.82;
    workerRoot.add(worker.root, vacuum.root);
    root.add(workerRoot);
    const dustGroup = new THREE.Group();
    const dustParticles = [];
    for (let index = 0; index < 18; index += 1) {
        const material = new THREE.MeshBasicMaterial({
            color: index % 3 === 0 ? 0xe8c9a2 : 0xc4b8aa,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
        });
        const mote = makeSphere(0.035 + (index % 3) * 0.012, material, 8, 6);
        const offset = new THREE.Vector3(-0.78 + (index % 6) * 0.3, 0.08 + Math.floor(index / 6) * 0.13, 0.3 + (index % 4) * 0.16);
        mote.position.copy(offset);
        dustParticles.push({ mesh: mote, offset, speed: 1.4 + (index % 4) * 0.27 });
        dustGroup.add(mote);
    }
    dustGroup.position.set(0, 0, 1.05);
    workerRoot.add(dustGroup);
    const cleanSparkles = new THREE.Group();
    const sparkleMaterials = [];
    for (let index = 0; index < 8; index += 1) {
        const material = new THREE.MeshBasicMaterial({
            color: index % 2 ? 0xffffff : 0xd9cfe1,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
        });
        sparkleMaterials.push(material);
        const sparkle = new THREE.Mesh(new THREE.OctahedronGeometry(0.08 + (index % 2) * 0.035, 0), material);
        sparkle.position.set(-0.8 + (index % 4) * 0.52, 0.13 + Math.floor(index / 4) * 0.25, 1.35 + (index % 3) * 0.18);
        cleanSparkles.add(sparkle);
    }
    workerRoot.add(cleanSparkles);
    const chairPath = createScenePath([
        [-22, 9.5],
        [-14, 7.2],
        [-6, 4.2],
        [2.2, 1],
        [8.1, -2.4],
        [9.2, -4.2],
        [12.5, -1],
        [17, 5],
        [23, 10.2],
    ]);
    const chairStop = closestPathProgress(chairPath, new THREE.Vector3(9.2, 0, -4.2));
    const chairStopPose = sampleCurvePose(chairPath, chairStop);
    createRouteRibbon(root, chairPath, 0x806f98);
    const workerObstacles = [
        { type: "rect", label: "sofa", minX: -13.55, maxX: -8.85, minZ: -7.2, maxZ: -4.4 },
        { type: "rect", label: "coffee-table", minX: -9.4, maxX: -5.0, minZ: -3.05, maxZ: -0.85 },
        { type: "circle", label: "lamp", x: -7.45, z: -6.55, r: 0.82 },
        { type: "rect", label: "bookshelf", minX: -14.7, maxX: -11.55, minZ: -7.85, maxZ: -5.95 },
        { type: "rect", label: "washer", minX: 8.95, maxX: 11.65, minZ: -7.3, maxZ: -4.7 },
        { type: "rect", label: "cabinet", minX: 12.45, maxX: 15.75, minZ: -7.5, maxZ: -5.3 },
        { type: "rect", label: "fold-table", minX: 5.55, maxX: 9.85, minZ: 2.05, maxZ: 3.75 },
        { type: "circle", label: "caddy", x: 2.85, z: -5.85, r: 0.82 },
        { type: "rect", label: "floor-basket", minX: 7.15, maxX: 8.55, minZ: -5.95, maxZ: -4.55 },
    ];
    const vacuumWaypoints = [
        new THREE.Vector3(-16, 0, 7.5),
        new THREE.Vector3(-10.4, 0, 4.9),
        new THREE.Vector3(-10.4, 0, -3.55),
        new THREE.Vector3(-4.0, 0, -3.55),
        new THREE.Vector3(-4.0, 0, 4.9),
        new THREE.Vector3(0.35, 0, 4.9),
        new THREE.Vector3(0.35, 0, -3.55),
        new THREE.Vector3(3.85, 0, -3.55),
    ];
    const vacuumSegments = [];
    for (let index = 0; index < vacuumWaypoints.length - 1; index += 1) {
        vacuumSegments.push(createNavigationRoute(vacuumWaypoints[index], vacuumWaypoints[index + 1], workerObstacles, 0.62));
    }
    const washerFront = new THREE.Vector3(8.55, 0, -3.9);
    const supplyFront = new THREE.Vector3(3.35, 0, -4.45);
    const foldFront = new THREE.Vector3(7.35, 0, 1.05);
    const workerExit = new THREE.Vector3(21, 0, 10);
    const washerRoute = createNavigationRoute(vacuumWaypoints[vacuumWaypoints.length - 1], washerFront, workerObstacles, 0.62, [new THREE.Vector3(5.85, 0, -4.0), new THREE.Vector3(7.05, 0, -3.95)]);
    const supplyRoute = createNavigationRoute(washerFront, supplyFront, workerObstacles, 0.62, [new THREE.Vector3(6.95, 0, -3.85), new THREE.Vector3(5.15, 0, -3.95)]);
    const foldRoute = createNavigationRoute(supplyFront, foldFront, workerObstacles, 0.62, [new THREE.Vector3(4.35, 0, -1.15), new THREE.Vector3(5.95, 0, -0.05)]);
    const exitRoute = createNavigationRoute(foldFront, workerExit, workerObstacles, 0.62, [new THREE.Vector3(9.55, 0, 4.35), new THREE.Vector3(13.75, 0, 6.2)]);
    const chairFoldWatch = new THREE.Vector3(10.45, 0, 1.05);
    const chairFoldRoute = createNavigationRoute(new THREE.Vector3(9.2, 0, -4.2), chairFoldWatch, workerObstacles, 0.72);
    const chairExitJoin = closestPathProgress(chairPath, new THREE.Vector3(12.5, 0, -1));
    const chairExitRoute = createNavigationRoute(chairFoldWatch, chairPath.getPointAt(chairExitJoin), workerObstacles, 0.72);
    const workerTaskPath = createVectorScenePath(combineRoutePoints(...vacuumSegments, washerRoute, supplyRoute, foldRoute, exitRoute));
    const workerTaskLength = workerTaskPath.getLength();
    const washerStop = closestPathProgress(workerTaskPath, washerFront);
    const supplyStop = closestPathProgress(workerTaskPath, supplyFront);
    const foldStop = closestPathProgress(workerTaskPath, foldFront);
    const washerStopDistance = washerStop * workerTaskLength;
    const supplyStopDistance = supplyStop * workerTaskLength;
    const foldStopDistance = foldStop * workerTaskLength;
    const trails = new TrailPool(root, 320);
    const duration = 32;
    let previousTime = 0;
    let lastChairStamp = -1;
    let lastWorkerStamp = -1;
    const towels = [];
    const towelColours = [0xf5e2d9, 0xcbdedd, 0xe8dff0, 0xfff8ec, 0xcbd8c6];
    for (let index = 0; index < 5; index += 1) {
        const towel = makeBox(1.18, 0.16, 0.72, standardMaterial(towelColours[index], 0.95), 0.05);
        towel.position.set(7.7, 1.3 + index * 0.17, 2.9);
        towel.visible = false;
        towels.push(towel);
        root.add(towel);
    }
    const foldedShirts = [];
    for (let index = 0; index < 3; index += 1) {
        const shirt = makeBox(0.96, 0.13, 0.82, standardMaterial([0x806f98, 0x6f91c2, 0x7fa78d][index], 0.92), 0.045);
        shirt.position.set(9.05, 1.29 + index * 0.14, 2.9);
        shirt.visible = false;
        foldedShirts.push(shirt);
        root.add(shirt);
    }
    const washBubbles = new THREE.Group();
    const washBubbleMaterials = [];
    for (let index = 0; index < 13; index += 1) {
        const material = new THREE.MeshBasicMaterial({
            color: index % 2 ? 0xcde8f0 : 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
        });
        washBubbleMaterials.push(material);
        const bubble = new THREE.Mesh(new THREE.RingGeometry(0.08 + (index % 3) * 0.03, 0.105 + (index % 3) * 0.03, 12), material);
        bubble.position.set(10.25, 1.45 + (index % 5) * 0.35, -4.68);
        washBubbles.add(bubble);
    }
    root.add(washBubbles);
    const reset = () => {
        previousTime = 0;
        lastChairStamp = -1;
        lastWorkerStamp = -1;
        trails.clear();
    };
    const update = (localTime, delta) => {
        if (localTime + 0.05 < previousTime)
            reset();
        previousTime = localTime;
        const chairAtLaundry = localTime >= 4.2 && localTime < 20.6;
        const chairFoldMove = localTime >= 20.6 && localTime < 22.8;
        const chairAtFold = localTime >= 22.8 && localTime < 27.2;
        const chairBaseStop = chairStop * chairPath.getLength();
        const chairBaseFold = chairBaseStop + chairFoldRoute.length;
        const chairBaseExit = chairBaseFold + chairExitRoute.length;
        let chairPose;
        if (localTime < 4.2) {
            chairPose = poseOnPath(participantRoot, chairPath, THREE.MathUtils.lerp(0, chairStop, timedEase(localTime, 0, 4.2)));
        }
        else if (chairAtLaundry) {
            chairPose = { position: chairStopPose.position, yaw: chairStopPose.yaw, distance: chairBaseStop };
            participantRoot.position.copy(chairStopPose.position);
        }
        else if (chairFoldMove) {
            chairPose = poseOnPath(participantRoot, chairFoldRoute.path, timedEase(localTime, 20.6, 22.8));
            chairPose.distance += chairBaseStop;
        }
        else if (chairAtFold) {
            chairPose = { position: chairFoldWatch, yaw: 0, distance: chairBaseFold };
            participantRoot.position.copy(chairFoldWatch);
        }
        else if (localTime < 29) {
            chairPose = poseOnPath(participantRoot, chairExitRoute.path, timedEase(localTime, 27.2, 29));
            chairPose.distance += chairBaseFold;
        }
        else {
            const progress = THREE.MathUtils.lerp(chairExitJoin, 0.999, timedEase(localTime, 29, duration));
            chairPose = poseOnPath(participantRoot, chairPath, progress);
            chairPose.distance = chairBaseExit + Math.max(0, chairPose.distance - chairExitJoin * chairPath.getLength());
        }
        applyStageVisibility(participantRoot);
        chair.animate(chairPose.distance, chairPose.distance * 5.2);
        if (chairAtLaundry) {
            facePoint(participantRoot, new THREE.Vector3(10.25, 0, -5.8), 0.16);
            const unloadPhase = timedEase(localTime, 4.6, 7.1);
            chair.person.rightArm.rotation.x = -0.38 - unloadPhase * 0.62 + Math.sin(localTime * 2.2) * 0.06;
            chair.person.leftArm.rotation.x = -0.28 - unloadPhase * 0.32;
            chair.person.head.rotation.y = Math.sin(localTime * 0.8) * 0.08;
        }
        else if (chairAtFold) {
            facePoint(participantRoot, new THREE.Vector3(7.7, 0, 2.9), 0.16);
            chair.person.rightArm.rotation.x = -0.62 + Math.sin(localTime * 2.6) * 0.14;
            chair.person.leftArm.rotation.x = -0.4 + Math.sin(localTime * 2.2 + 0.5) * 0.08;
        }
        const vacuuming = localTime < 14;
        const washerAssist = localTime >= 14 && localTime < 16.2;
        const supplyWalk = localTime >= 16.2 && localTime < 18;
        const supplyCollect = localTime >= 18 && localTime < 19.2;
        const foldWalk = localTime >= 19.2 && localTime < 21.3;
        const folding = localTime >= 21.3 && localTime < 25.8;
        let workerProgress = 0;
        let workerMoving = true;
        if (vacuuming) {
            workerProgress = THREE.MathUtils.lerp(0, washerStop, timedEase(localTime, 0, 14));
        }
        else if (washerAssist) {
            workerProgress = washerStop;
            workerMoving = false;
        }
        else if (supplyWalk) {
            workerProgress = THREE.MathUtils.lerp(washerStop, supplyStop, timedEase(localTime, 16.2, 18));
        }
        else if (supplyCollect) {
            workerProgress = supplyStop;
            workerMoving = false;
        }
        else if (foldWalk) {
            workerProgress = THREE.MathUtils.lerp(supplyStop, foldStop, timedEase(localTime, 19.2, 21.3));
        }
        else if (folding) {
            workerProgress = foldStop;
            workerMoving = false;
        }
        else {
            workerProgress = THREE.MathUtils.lerp(foldStop, 0.999, timedEase(localTime, 25.8, duration));
        }
        let workerPose;
        if (workerMoving) {
            workerPose = poseOnPath(workerRoot, workerTaskPath, workerProgress);
        }
        else {
            const anchor = washerAssist ? washerFront : supplyCollect ? supplyFront : foldFront;
            const anchorDistance = washerAssist ? washerStopDistance : supplyCollect ? supplyStopDistance : foldStopDistance;
            workerPose = { position: anchor, yaw: 0, distance: anchorDistance };
            workerRoot.position.copy(anchor);
        }
        applyStageVisibility(workerRoot);
        const workerTravelMetric = workerPose.distance;
        worker.animate(workerTravelMetric * 5.1, workerMoving ? 0.82 : 0.04);
        if (vacuuming) {
            worker.leftArm.rotation.x = -0.9 + Math.sin(localTime * 2.4) * 0.08;
            worker.rightArm.rotation.x = -0.9 - Math.sin(localTime * 2.4) * 0.08;
        }
        else if (washerAssist) {
            facePoint(workerRoot, new THREE.Vector3(10.25, 0, -5.8), 0.16);
            worker.leftArm.rotation.x = -0.96 + Math.sin(localTime * 3) * 0.12;
            worker.leftArm.rotation.z = 0.18;
            worker.rightArm.rotation.x = -0.84 + Math.sin(localTime * 2.7 + 0.3) * 0.08;
            worker.rightArm.rotation.z = -0.14;
        }
        else if (supplyCollect) {
            facePoint(workerRoot, new THREE.Vector3(2.85, 0, -5.85), 0.16);
            worker.leftArm.rotation.x = -1.02 + Math.sin(localTime * 3.2) * 0.08;
            worker.leftArm.rotation.z = 0.24;
            worker.rightArm.rotation.x = -0.56;
        }
        else if (folding) {
            facePoint(workerRoot, new THREE.Vector3(7.7, 0, 2.9), 0.16);
            worker.leftArm.rotation.x = -0.92 + Math.sin(localTime * 3.1) * 0.16;
            worker.rightArm.rotation.x = -0.92 - Math.sin(localTime * 3.1) * 0.16;
            worker.leftArm.rotation.z = 0.16;
            worker.rightArm.rotation.z = -0.16;
        }
        vacuum.root.visible = vacuuming;
        dustGroup.visible = vacuuming;
        cleanSparkles.visible = vacuuming;
        vacuum.wheels.forEach((wheel, index) => {
            wheel.rotation.x = workerTravelMetric * 5.5 + index * 0.3;
        });
        vacuum.indicatorMaterial.emissiveIntensity = vacuuming ? 0.5 + Math.sin(localTime * 5) * 0.16 : 0.08;
        dustParticles.forEach(({ mesh, offset, speed }, index) => {
            const material = mesh.material;
            const pulse = (localTime * speed + index * 0.19) % 1;
            mesh.position.set(offset.x + Math.sin(localTime * 2.1 + index) * 0.09, offset.y + pulse * 0.42, offset.z + Math.cos(localTime * 1.7 + index) * 0.07);
            material.opacity = vacuuming ? Math.sin(pulse * Math.PI) * 0.22 : 0;
        });
        sparkleMaterials.forEach((material, index) => {
            const pulse = (localTime * 1.7 + index * 0.17) % 1;
            material.opacity = vacuuming ? Math.sin(pulse * Math.PI) * 0.48 : 0;
            const sparkle = cleanSparkles.children[index];
            sparkle.rotation.y = localTime * 2 + index;
            sparkle.scale.setScalar(0.65 + Math.sin(pulse * Math.PI) * 0.55);
        });
        const washing = localTime >= 5.4 && localTime < 24.6;
        washer.drum.rotation.z = washing ? localTime * 4.2 : 0;
        washer.clothes.rotation.z = washing ? localTime * 5.4 : 0;
        washer.clothes.children.forEach((cloth, index) => {
            cloth.rotation.z = washing ? -localTime * 2.4 + index * 0.6 : index * 0.2;
            cloth.scale.setScalar(washing ? 0.92 + Math.sin(localTime * 3 + index) * 0.08 : 1);
        });
        washer.dial.rotation.z = washing ? localTime * 0.18 : 0;
        washer.drumMaterial.emissiveIntensity = washing ? 0.24 + Math.sin(localTime * 3) * 0.08 : 0.06;
        washer.statusLightMaterial.emissiveIntensity = washing ? 0.74 + Math.sin(localTime * 4.4) * 0.2 : 0.08;
        carriedBasket.visible = localTime < 6.1;
        floorBasket.visible = localTime >= 6.1 && localTime < 21.3;
        washBubbleMaterials.forEach((material, index) => {
            const rise = (localTime * 0.28 + index / washBubbleMaterials.length) % 1;
            const bubble = washBubbles.children[index];
            bubble.position.set(10.25 + Math.sin(index * 1.8 + localTime) * 0.92, 1.35 + rise * 3.25, -4.7 + Math.cos(index * 1.2) * 0.18);
            bubble.scale.setScalar(0.55 + (1 - rise) * 0.75);
            material.opacity = washing ? Math.sin(rise * Math.PI) * 0.42 : 0;
        });
        towels.forEach((towel, index) => {
            towel.visible = localTime > 21.45 + index * 0.5;
            if (towel.visible) {
                towel.rotation.y = Math.sin(localTime * 1.8 + index) * 0.022;
                towel.position.y = 1.3 + index * 0.17 + Math.max(0, 1 - timedEase(localTime, 21.45 + index * 0.5, 21.95 + index * 0.5)) * 0.32;
            }
        });
        foldedShirts.forEach((shirt, index) => {
            shirt.visible = localTime > 23.2 + index * 0.5;
            if (shirt.visible)
                shirt.rotation.y = Math.sin(localTime * 1.5 + index) * 0.02;
        });
        clock.minute.rotation.z = -localTime * 0.09;
        clock.hour.rotation.z = -localTime * 0.012;
        lamp.bulbMaterial.emissiveIntensity = 0.52 + Math.sin(localTime * 0.7) * 0.07;
        detergentBottles.forEach((bottle, index) => {
            bottle.rotation.y = Math.sin(localTime * 0.45 + index) * 0.012;
        });
        const chairMoving = !chairAtLaundry && !chairAtFold;
        if (chairMoving && onStage(participantRoot.position) && (lastChairStamp < 0 || chairPose.distance - lastChairStamp >= 0.34)) {
            const yaw = yawFromQuaternion(participantRoot.quaternion);
            trails.emit("wheel", localPoint(participantRoot, -0.68, -0.08), yaw, 0.16, 0.46, 7.6);
            trails.emit("wheel", localPoint(participantRoot, 0.68, -0.08), yaw, 0.16, 0.46, 7.6);
            lastChairStamp = chairPose.distance;
        }
        if (workerMoving && onStage(workerRoot.position) && (lastWorkerStamp < 0 || workerTravelMetric - lastWorkerStamp >= 0.38)) {
            const yaw = yawFromQuaternion(workerRoot.quaternion);
            const left = Math.floor(workerTravelMetric / 0.38) % 2 === 0;
            trails.emit("foot", localPoint(workerRoot, left ? -0.18 : 0.18, -1.16), yaw, 0.18, 0.42, 6.6, left);
            if (vacuuming) {
                trails.emit("clean", localPoint(workerRoot, 0, 1.58), yaw, 1.08, 0.66, 10.2);
            }
            lastWorkerStamp = workerTravelMetric;
        }
        trails.update(delta);
    };
    root.visible = false;
    parent.add(root);
    return { id, root, duration, trails, update, reset };
}
function createCommunityScene(parent) {
    const id = "community";
    const root = new THREE.Group();
    createServiceBase(root, 0xb98568, "COMMUNITY PARTICIPATION", "Creative, social and recreational moments with others", 0xf3f0e8, "outdoor");
    const patioMaterial = standardMaterial(0xe8ddcf, 0.94);
    const patio = new THREE.Mesh(new THREE.CylinderGeometry(9.0, 9.0, 0.16, 48), patioMaterial);
    patio.position.set(4.2, 0.13, -1.9);
    patio.receiveShadow = true;
    const patioRing = new THREE.Mesh(new THREE.TorusGeometry(8.3, 0.08, 8, 48), standardMaterial(0xb98568, 0.82));
    patioRing.rotation.x = Math.PI / 2;
    patioRing.position.set(4.2, 0.23, -1.9);
    root.add(patio, patioRing);
    const pavilion = new THREE.Group();
    const canopyMaterial = new THREE.MeshStandardMaterial({
        color: 0x82aa91,
        roughness: 0.72,
        metalness: 0.04,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(7.8, 1.72, 8), canopyMaterial);
    roof.position.set(4.6, 6.48, -2.2);
    roof.rotation.y = Math.PI / 8;
    roof.renderOrder = 2;
    const ceiling = new THREE.Mesh(new THREE.RingGeometry(6.45, 7.45, 8), new THREE.MeshStandardMaterial({
        color: 0x6f9982,
        roughness: 0.72,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: THREE.DoubleSide,
    }));
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.rotation.z = Math.PI / 8;
    ceiling.position.set(4.6, 5.58, -2.2);
    ceiling.renderOrder = 3;
    pavilion.add(roof, ceiling);
    const roofHub = makeSphere(0.18, standardMaterial(0x5f7d70, 0.48, 0.3), 12, 8);
    roofHub.position.set(4.6, 5.72, -2.2);
    pavilion.add(roofHub);
    for (let index = 0; index < 8; index += 1) {
        const angle = Math.PI / 8 + (index / 8) * Math.PI * 2;
        const rib = cylinderBetween(new THREE.Vector3(4.6, 5.7, -2.2), new THREE.Vector3(4.6 + Math.sin(angle) * 7.28, 5.5, -2.2 + Math.cos(angle) * 7.28), 0.045, standardMaterial(0x607c70, 0.46, 0.32), 7);
        pavilion.add(rib);
    }
    const postPositions = [
        [-0.65, -7.45],
        [9.85, -7.45],
        [-0.65, 3.05],
        [9.85, 3.05],
    ];
    for (const [x, z] of postPositions) {
        const post = makeBox(0.26, 5.55, 0.26, standardMaterial(0x657984, 0.4, 0.36), 0.045);
        post.position.set(x, 2.82, z);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.44, 0.24, 12), standardMaterial(0x53676e, 0.48, 0.32));
        base.position.set(x, 0.16, z);
        const cap = makeBox(0.44, 0.2, 0.44, standardMaterial(0x8aa393, 0.62), 0.04);
        cap.position.set(x, 5.55, z);
        pavilion.add(post, base, cap);
    }
    const frontBeam = makeBox(11.0, 0.3, 0.35, standardMaterial(0x5f7d70, 0.58, 0.22), 0.04);
    frontBeam.position.set(4.6, 5.42, 3.02);
    const backBeam = frontBeam.clone();
    backBeam.position.z = -7.42;
    const leftBeam = makeBox(0.35, 0.3, 10.8, standardMaterial(0x5f7d70, 0.58, 0.22), 0.04);
    leftBeam.position.set(-0.62, 5.42, -2.2);
    const rightBeam = leftBeam.clone();
    rightBeam.position.x = 9.82;
    pavilion.add(frontBeam, backBeam, leftBeam, rightBeam);
    root.add(pavilion);
    const lightA = createStringLights(new THREE.Vector3(-0.45, 5.18, -7.15), new THREE.Vector3(9.65, 5.18, 2.75), 0xb98568, 13);
    const lightB = createStringLights(new THREE.Vector3(9.65, 5.18, -7.15), new THREE.Vector3(-0.45, 5.18, 2.75), 0xd6a247, 13);
    root.add(lightA.root, lightB.root);
    const bunting = new THREE.Group();
    const buntingColours = [0xb98568, 0xd6a247, 0x6f91c2, 0x7fa78d, 0x806f98];
    const buntingWire = cylinderBetween(new THREE.Vector3(-0.2, 4.72, 2.88), new THREE.Vector3(9.4, 4.72, 2.88), 0.018, standardMaterial(0x566970, 0.5, 0.28), 6);
    bunting.add(buntingWire);
    for (let index = 0; index < 12; index += 1) {
        const flag = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 3), standardMaterial(buntingColours[index % buntingColours.length], 0.78));
        flag.rotation.z = Math.PI;
        flag.rotation.y = Math.PI / 2;
        flag.position.set(0.2 + index * 0.82, 4.43, 2.88);
        bunting.add(flag);
    }
    root.add(bunting);
    const art = createArtStation(0xb98568);
    art.root.position.set(1.65, 0, 0.25);
    root.add(art.root);
    const leftPlanter = createRaisedPlanter(0xb98568);
    leftPlanter.position.set(-9.9, 0, -5.35);
    leftPlanter.rotation.y = 0.18;
    const rightPlanter = createRaisedPlanter(0x6f91c2);
    rightPlanter.position.set(13.7, 0, 2.0);
    rightPlanter.rotation.y = -0.18;
    const treeA = createParkTree(0x7fa78d);
    treeA.position.set(-13.2, 0, -5.2);
    const treeB = createParkTree(0x6d947d);
    treeB.position.set(13.45, 0, -5.2);
    const treeC = createParkTree(0x80a284);
    treeC.position.set(-12.6, 0, 6.2);
    treeC.scale.setScalar(0.86);
    root.add(leftPlanter, rightPlanter, treeA, treeB, treeC);
    const benchA = createCommunityBench(0xb98568);
    benchA.position.set(-8.6, 0, 3.55);
    benchA.rotation.y = 0.24;
    const benchB = createCommunityBench(0x6f91c2);
    benchB.position.set(11.4, 0, -1.1);
    benchB.rotation.y = -Math.PI / 2;
    benchB.scale.setScalar(0.82);
    root.add(benchA, benchB);
    const welcomeBoard = makeBox(4.4, 2.35, 0.18, standardMaterial(0xfbf6ef, 0.95), 0.08);
    welcomeBoard.position.set(-8.8, 2.35, -8.82);
    const welcomeFrame = makeBox(4.72, 2.66, 0.08, standardMaterial(0xb58c68, 0.76), 0.04);
    welcomeFrame.position.set(0, 0, -0.08);
    welcomeBoard.add(welcomeFrame);
    for (let index = 0; index < 5; index += 1) {
        const row = makeBox(2.9 - index * 0.18, 0.12, 0.035, standardMaterial(buntingColours[index], 0.72), 0.02);
        row.position.set(-0.2, 0.72 - index * 0.34, 0.12);
        welcomeBoard.add(row);
    }
    root.add(welcomeBoard);
    const friends = [];
    const friendRoots = [];
    const friendOptions = [
        {
            skin: 0xe0ad88,
            shirt: 0xd6a247,
            trousers: 0x43515c,
            hair: 0x5f402f,
            hairStyle: "waves",
            glasses: true,
        },
        {
            skin: 0x70452f,
            shirt: 0x806f98,
            trousers: 0x334956,
            hair: 0x1f1b19,
            hairStyle: "curls",
        },
        {
            skin: 0xb77a58,
            shirt: 0x6f91c2,
            trousers: 0x40545d,
            hair: 0x352825,
            hairStyle: "crop",
            headscarf: 0x7fa78d,
        },
    ];
    const friendPositions = [
        [1.0, -2.55, 0.42],
        [3.65, -2.8, -0.38],
        [5.45, 1.35, -1.55],
    ];
    friendOptions.forEach((options, index) => {
        const friendRoot = new THREE.Group();
        const friend = createHuman(options);
        friendRoot.position.set(friendPositions[index][0], 0, friendPositions[index][1]);
        friendRoot.rotation.y = friendPositions[index][2];
        friendRoot.add(friend.root);
        root.add(friendRoot);
        friends.push(friend);
        friendRoots.push(friendRoot);
    });
    const pair = new THREE.Group();
    const chair = createWheelchair(true, {
        skin: 0xc48965,
        shirt: 0xb98568,
        trousers: 0x334956,
        hair: 0x26201d,
        hairStyle: "crop",
        glasses: true,
    });
    chair.root.position.x = -0.72;
    const worker = createHuman({
        skin: 0x81533d,
        shirt: 0x2d847d,
        trousers: 0x354956,
        hair: 0x201b19,
        hairStyle: "bun",
        badge: true,
    });
    worker.root.position.set(0.92, 0, -0.18);
    pair.add(chair.root, worker.root);
    root.add(pair);
    const activityBasket = makeBox(1.3, 0.78, 1.0, standardMaterial(0xd6a247, 0.86), 0.12);
    activityBasket.position.set(-7.35, 0.43, 2.0);
    const basketHandle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 18, Math.PI), standardMaterial(0x6d7f85, 0.45, 0.3));
    basketHandle.position.set(0, 0.46, 0);
    basketHandle.rotation.z = Math.PI;
    activityBasket.add(basketHandle);
    const ball = makeSphere(0.42, standardMaterial(0x6f91c2, 0.78), 18, 12);
    ball.position.set(-4.3, 0.52, 1.7);
    const ballStripe = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 20), standardMaterial(0xfffdf8, 0.88));
    ball.add(ballStripe);
    root.add(activityBasket, ball);
    const butterflies = [];
    for (let index = 0; index < 7; index += 1) {
        const butterfly = new THREE.Group();
        const body = makeCapsule(0.025, 0.11, standardMaterial(0x40545c, 0.62), 6);
        body.rotation.z = Math.PI / 2;
        const wingMaterial = new THREE.MeshBasicMaterial({
            color: buntingColours[index % buntingColours.length],
            transparent: true,
            opacity: 0.62,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
        });
        const leftWing = new THREE.Mesh(new THREE.CircleGeometry(0.12, 10), wingMaterial);
        leftWing.scale.set(1.25, 0.72, 1);
        leftWing.position.x = -0.11;
        const rightWing = leftWing.clone();
        rightWing.position.x = 0.11;
        butterfly.add(body, leftWing, rightWing);
        butterfly.position.set(-8 + index * 2.8, 1.35 + (index % 3) * 0.48, -5.8 + (index % 4) * 3.1);
        root.add(butterfly);
        butterflies.push({ root: butterfly, phase: index * 1.13 });
    }
    const path = createScenePath([
        [-23, 10.5],
        [-15, 7.8],
        [-8.8, 5.2],
        [-4.8, 4.0],
        [-2.2, 3.55],
        [0.8, 3.2],
        [4.4, 3.25],
        [8.8, 4.6],
        [15.2, 7.6],
        [23, 10.8],
    ]);
    createRouteRibbon(root, path, 0xb98568);
    const arrivalStop = closestPathProgress(path, new THREE.Vector3(-1.2, 0, 3.45));
    const station = closestPathProgress(path, new THREE.Vector3(0.8, 0, 3.2));
    const communityStationPose = sampleCurvePose(path, station);
    const lawnSpot = new THREE.Vector3(-4.9, 0, 2.9);
    const friendGameSpot = new THREE.Vector3(-2.45, 0, 1.5);
    const chairRestSpot = new THREE.Vector3(-6.05, 0, 4.85);
    const benchSeatWorld = new THREE.Vector3(-7.99, 0, 3.71);
    const friendHome = new THREE.Vector3(1.0, 0, -2.55);
    const workerHomeLocal = new THREE.Vector3(0.92, 0, -0.18);
    const moveLerp = new THREE.Vector3();
    const workerLocal = new THREE.Vector3();
    /* v65.1: the yard's own furniture is the obstacle map — pavilion posts,
       art station, activity basket, bench — and every pair leg is solved by
       the shared navigator with wheelchair-wide clearance, so the carer no
       longer sweeps through the pavilion post on the way to the lawn. */
    const communityObstacles = [
        { type: "circle", label: "post-nw", x: -0.65, z: -7.45, r: 0.42 },
        { type: "circle", label: "post-ne", x: 9.85, z: -7.45, r: 0.42 },
        { type: "circle", label: "post-sw", x: -0.65, z: 3.05, r: 0.42 },
        { type: "circle", label: "post-se", x: 9.85, z: 3.05, r: 0.42 },
        { type: "rect", label: "art-station", minX: 0.35, maxX: 2.95, minZ: -0.85, maxZ: 1.35 },
        { type: "circle", label: "basket", x: -7.35, z: 2.0, r: 0.85 },
        { type: "rect", label: "bench", minX: -9.75, maxX: -7.45, minZ: 3.0, maxZ: 4.1 },
    ];
    const pairClear = 1.0; /* the whole wheelchair plus the carer beside it */
    const toLawnRoute = createNavigationRoute(communityStationPose.position, lawnSpot, communityObstacles, pairClear);
    const toBenchRoute = createNavigationRoute(lawnSpot, chairRestSpot, communityObstacles, pairClear);
    const regroupRoute = createNavigationRoute(chairRestSpot, communityStationPose.position, communityObstacles, pairClear);
    const segLawn = toLawnRoute.length;
    const segRest = toBenchRoute.length;
    const segBack = regroupRoute.length;
    const trails = new TrailPool(root, 220);
    const duration = 34;
    let previousTime = 0;
    let lastStamp = -1;
    const greetingBubbles = new THREE.Group();
    const greetingMaterials = [];
    for (let index = 0; index < 5; index += 1) {
        const material = new THREE.MeshBasicMaterial({
            color: buntingColours[index],
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
        });
        greetingMaterials.push(material);
        const bubble = makeSphere(0.13 + (index % 2) * 0.04, material, 10, 7);
        greetingBubbles.add(bubble);
    }
    root.add(greetingBubbles);
    const reset = () => {
        previousTime = 0;
        lastStamp = -1;
        trails.clear();
    };
    const update = (localTime, delta) => {
        if (localTime + 0.05 < previousTime)
            reset();
        previousTime = localTime;
        const arriving = localTime < 4.8;
        const settling = localTime >= 4.8 && localTime < 6.4;
        const greeting = localTime >= 5 && localTime < 8;
        const participating = localTime >= 6.4 && localTime < 16.6;
        const painting = localTime >= 8 && localTime < 16.6;
        const toLawn = localTime >= 16.6 && localTime < 18.4;
        const ballGame = localTime >= 18.4 && localTime < 23.8;
        const toBench = localTime >= 23.8 && localTime < 25.6;
        const resting = localTime >= 25.6 && localTime < 30.8;
        const regroup = localTime >= 29.8 && localTime < 30.8;
        const exiting = localTime >= 30.8;
        const sitBench = timedEase(localTime, 25.6, 26.4) - timedEase(localTime, 29.4, 30.1);
        const baseStation = communityStationPose.distance;
        let pose;
        if (arriving || settling) {
            const pathProgress = arriving
                ? THREE.MathUtils.lerp(0, arrivalStop, timedEase(localTime, 0, 4.8))
                : THREE.MathUtils.lerp(arrivalStop, station, timedEase(localTime, 4.8, 6.4));
            pose = poseOnPath(pair, path, pathProgress);
        }
        else if (participating) {
            pose = { position: communityStationPose.position, yaw: communityStationPose.yaw, distance: baseStation };
            pair.position.copy(communityStationPose.position);
        }
        else if (toLawn) {
            pose = poseOnPath(pair, toLawnRoute.path, timedEase(localTime, 16.6, 18.4));
            pose.distance += baseStation;
        }
        else if (ballGame) {
            pose = { position: lawnSpot, yaw: 0, distance: baseStation + segLawn };
            pair.position.copy(lawnSpot);
            facePoint(pair, friendGameSpot, 0.2);
        }
        else if (toBench) {
            pose = poseOnPath(pair, toBenchRoute.path, timedEase(localTime, 23.8, 25.6));
            pose.distance += baseStation + segLawn;
        }
        else if (resting && !regroup) {
            pose = { position: chairRestSpot, yaw: 0, distance: baseStation + segLawn + segRest };
            pair.position.copy(chairRestSpot);
            facePoint(pair, benchSeatWorld, 0.2);
        }
        else if (regroup) {
            pose = poseOnPath(pair, regroupRoute.path, timedEase(localTime, 29.8, 30.8));
            pose.distance += baseStation + segLawn + segRest;
        }
        else {
            const progress = THREE.MathUtils.lerp(station, 0.999, timedEase(localTime, 30.8, duration));
            pose = poseOnPath(pair, path, progress);
            pose.distance = baseStation + segLawn + segRest + segBack + Math.max(0, pose.distance - baseStation);
        }
        applyStageVisibility(pair);
        const phase = pose.distance * 5.2;
        chair.animate(pose.distance, phase);
        const workerWalking = arriving || settling || toLawn || toBench || regroup || exiting;
        worker.animate(phase + 1.15, workerWalking ? 0.86 : 0.05);
        if (sitBench > 0.001) {
            pair.updateMatrixWorld();
            workerLocal.copy(benchSeatWorld);
            pair.worldToLocal(workerLocal);
            worker.root.position.lerpVectors(workerHomeLocal, workerLocal, sitBench);
            worker.root.position.y = 0.68 * sitBench;
            const dx = -0.72 - worker.root.position.x;
            const dz = 0 - worker.root.position.z;
            worker.root.rotation.y = THREE.MathUtils.lerp(0, Math.atan2(dx, dz), sitBench);
            applySeatBlend(worker, sitBench);
            worker.leftArm.rotation.x = -0.34 + Math.sin(localTime * 1.4) * 0.12 * sitBench;
            worker.rightArm.rotation.x = -0.4 + Math.sin(localTime * 1.7 + 0.6) * 0.14 * sitBench;
            worker.head.rotation.y = Math.atan2(dx, dz) * 0.2 + Math.sin(localTime * 0.8) * 0.1;
        }
        else if (!workerWalking && !participating && !ballGame) {
            worker.root.position.copy(workerHomeLocal);
            worker.root.rotation.y = 0;
        }
        if (resting) {
            chair.person.rightArm.rotation.x = -0.48 + Math.sin(localTime * 1.6) * 0.16;
            chair.person.leftArm.rotation.x = -0.3 + Math.sin(localTime * 1.3 + 0.9) * 0.1;
            chair.person.head.rotation.y = 0.3 + Math.sin(localTime * 0.7) * 0.12;
        }
        if (participating || settling) {
            facePoint(pair, painting ? new THREE.Vector3(2.2, 0, 0.2) : new THREE.Vector3(1.4, 0, -1.0), 0.15);
            if (greeting) {
                chair.person.leftArm.rotation.x = -0.72 + Math.sin(localTime * 4.2) * 0.3;
                chair.person.leftArm.rotation.z = 0.24;
                worker.rightArm.rotation.x = -0.82 + Math.sin(localTime * 4.0 + 0.7) * 0.28;
                worker.rightArm.rotation.z = -0.22;
            }
            else if (participating) {
                chair.person.leftArm.rotation.x = -0.88 + Math.sin(localTime * 2.4) * 0.16;
                chair.person.rightArm.rotation.x = -0.6 + Math.sin(localTime * 2.1 + 1) * 0.1;
                worker.rightArm.rotation.x = -1.04 + Math.sin(localTime * 2.6) * 0.18;
                worker.leftArm.rotation.x = -0.56 + Math.sin(localTime * 2.2 + 1.2) * 0.11;
            }
        }
        const friendOut = timedEase(localTime, 16.6, 18.2) - timedEase(localTime, 23.8, 25.4);
        if (friendOut > 0.001) {
            moveLerp.lerpVectors(friendHome, friendGameSpot, friendOut);
            friendRoots[0].position.set(moveLerp.x, friendRoots[0].position.y, moveLerp.z);
            const walkingOut = (localTime >= 16.6 && localTime < 18.2) || (localTime >= 23.8 && localTime < 25.4);
            friendRoots[0].rotation.y = localTime < 23.8
                ? Math.atan2(lawnSpot.x - moveLerp.x, lawnSpot.z - moveLerp.z)
                : Math.atan2(friendHome.x - moveLerp.x, friendHome.z - moveLerp.z);
            friends[0].animate(localTime * 7.5, walkingOut ? 0.8 : 0.08);
        }
        else if (localTime >= 25.4) {
            friendRoots[0].position.set(friendHome.x, friendRoots[0].position.y, friendHome.z);
            friendRoots[0].rotation.y = 0.42;
        }
        if (ballGame) {
            const cycle = (localTime - 18.4) / 1.35;
            const k = Math.floor(cycle);
            const f = cycle - k;
            const fromPair = k % 2 === 0;
            const handPair = new THREE.Vector3(-4.45, 1.32, 2.72);
            const handFriend = new THREE.Vector3(-2.75, 1.28, 1.68);
            const from = fromPair ? handPair : handFriend;
            const to = fromPair ? handFriend : handPair;
            ball.position.lerpVectors(from, to, smoothStep(f));
            ball.position.y += Math.sin(f * Math.PI) * 1.05;
            const squash = 1 - Math.sin(Math.min(1, f * 6) * Math.PI) * 0.12;
            ball.scale.set(1, squash, 1);
            const throwing = f < 0.3;
            chair.person.rightArm.rotation.x = fromPair && throwing ? -1.7 + f * 2.4 : -0.62;
            chair.person.rightArm.rotation.z = -0.12;
            chair.person.leftArm.rotation.x = !fromPair && f > 0.7 ? -1.15 : -0.4;
            friends[0].rightArm.rotation.x = !fromPair && throwing ? -1.7 + f * 2.4 : -0.7;
            friends[0].leftArm.rotation.x = fromPair && f > 0.7 ? -1.2 : -0.35;
        }
        else if (localTime >= 23.8) {
            ball.position.set(-4.3, 0.52, 1.7);
            ball.scale.set(1, 1, 1);
        }
        friends.forEach((friend, index) => {
            if (index === 0 && (friendOut > 0.001 || ballGame))
                return;
            friend.animate(localTime * 2 + index, 0.08);
            if (greeting) {
                friend.rightArm.rotation.x = -0.98 + Math.sin(localTime * 4.1 + index) * 0.52;
                friend.rightArm.rotation.z = -0.24;
            }
            else if (painting) {
                friend.rightArm.rotation.x = -0.94 + Math.sin(localTime * 2.5 + index) * 0.38;
                friend.leftArm.rotation.x = index === 2 ? -0.52 + Math.sin(localTime * 1.8) * 0.2 : -0.24;
            }
            friend.head.rotation.y = Math.sin(localTime * 0.8 + index) * 0.3;
            friend.torso.rotation.y = Math.sin(localTime * 0.9 + index * 1.4) * 0.08;
            friendRoots[index].position.y = Math.sin(localTime * 1.3 + index) * 0.03;
        });
        const artProgress = timedEase(localTime, 8, 15.8);
        art.dots.forEach((dot, index) => {
            dot.visible = artProgress * art.dots.length > index;
            if (dot.visible) {
                dot.scale.setScalar(0.86 + Math.sin(localTime * 3 + index) * 0.08);
                dot.scale.z = 0.24;
            }
        });
        art.strokes.forEach((stroke, index) => {
            stroke.visible = artProgress * art.strokes.length > index;
            stroke.scale.x = stroke.visible ? 0.9 + Math.sin(localTime * 2.4 + index) * 0.06 : 0.01;
        });
        art.paintPots.forEach((pot, index) => {
            pot.position.y = 1.72 + Math.sin(localTime * 1.2 + index) * 0.018;
        });
        art.brushes.forEach((brush, index) => {
            brush.rotation.z = -0.16 + index * 0.06 + (painting ? Math.sin(localTime * 2 + index) * 0.025 : 0);
        });
        art.speakerMaterial.emissiveIntensity = participating ? 0.38 + Math.sin(localTime * 5.2) * 0.18 : 0.08;
        art.notes.visible = participating;
        art.notes.children.forEach((note, index) => {
            const rise = (localTime * 0.24 + index / art.notes.children.length) % 1;
            note.position.set(-1.8 + Math.sin(index * 1.7) * 2.2, 1.8 + rise * 4.1, -0.7 + Math.cos(index * 1.3) * 1.5);
            note.scale.setScalar(0.65 + (1 - rise) * 0.7);
        });
        const lightMaterials = [...lightA.bulbs, ...lightB.bulbs];
        lightMaterials.forEach((material, index) => {
            material.emissiveIntensity = 0.45 + Math.sin(localTime * 2.6 + index * 0.55) * 0.22;
        });
        bunting.children.forEach((object, index) => {
            if (index === 0)
                return;
            object.rotation.z = Math.PI + Math.sin(localTime * 1.4 + index) * 0.04;
        });
        const benchVisit = timedEase(localTime, 26, 27.4) - timedEase(localTime, 29.2, 30.2);
        butterflies.forEach(({ root: butterfly, phase: butterflyPhase }, index) => {
            if (index === 2 && benchVisit > 0.001) {
                const hover = new THREE.Vector3(-7.35 + Math.sin(localTime * 1.1) * 0.5, 2.05 + Math.sin(localTime * 1.9) * 0.22, 3.35 + Math.cos(localTime * 0.9) * 0.45);
                butterfly.position.lerp(hover, 0.06 + benchVisit * 0.06);
                butterfly.rotation.y = localTime * 0.6;
                const flapFast = Math.sin(localTime * 9 + butterflyPhase) * 0.75;
                butterfly.children[1].rotation.y = flapFast;
                butterfly.children[2].rotation.y = -flapFast;
                return;
            }
            butterfly.position.x += Math.sin(localTime * 0.42 + butterflyPhase) * 0.002;
            butterfly.position.y += Math.sin(localTime * 1.5 + butterflyPhase) * 0.0025;
            butterfly.rotation.y = localTime * 0.25 + butterflyPhase;
            const flap = Math.sin(localTime * 7 + butterflyPhase) * 0.7;
            butterfly.children[1].rotation.y = flap;
            butterfly.children[2].rotation.y = -flap;
            butterfly.scale.setScalar(0.88 + (index % 3) * 0.08);
        });
        if (localTime < 23.8) {
            ball.rotation.x = localTime * 0.26;
            ball.rotation.z = localTime * 0.18;
        }
        greetingBubbles.position.set(0.5, 3.55, 0.2);
        greetingMaterials.forEach((material, index) => {
            const pulse = (localTime * 0.6 + index * 0.17) % 1;
            const bubble = greetingBubbles.children[index];
            bubble.position.set(-0.7 + index * 0.35, pulse * 1.2, Math.sin(index) * 0.18);
            bubble.scale.setScalar(0.7 + Math.sin(pulse * Math.PI) * 0.55);
            material.opacity = greeting ? Math.sin(pulse * Math.PI) * 0.56 : 0;
        });
        const moving = arriving || settling || toLawn || toBench || regroup || exiting;
        if (moving && onStage(pair.position) && (lastStamp < 0 || pose.distance - lastStamp >= 0.34)) {
            const yaw = yawFromQuaternion(pair.quaternion);
            trails.emit("wheel", localPoint(pair, -1.4, -0.08), yaw, 0.16, 0.46, 7.8);
            trails.emit("wheel", localPoint(pair, -0.02, -0.08), yaw, 0.16, 0.46, 7.8);
            const left = Math.floor(pose.distance / 0.34) % 2 === 0;
            trails.emit("foot", localPoint(pair, left ? 0.7 : 1.02, -0.38), yaw, 0.18, 0.42, 6.6, left);
            lastStamp = pose.distance;
        }
        trails.update(delta);
    };
    root.visible = false;
    parent.add(root);
    return { id, root, duration, trails, update, reset };
}
function createServiceScenes(parent, onlyService) {
    const factories = {
        employment: () => createEmploymentScene(parent),
        "personal-care": () => createPersonalCareScene(parent),
        "travel-transport": () => createTravelTransportScene(parent),
        "shared-living": () => createSharedLivingScene(parent),
        household: () => createHouseholdScene(parent),
        community: () => createCommunityScene(parent),
    };
    const ids = onlyService
        ? [onlyService]
        : Object.keys(factories);
    const scenes = ids.map((id) => factories[id]());
    return new Map(scenes.map((scene) => [scene.id, scene]));
}
function addGroundingElements(scene) {
    const lawnTiles = [];
    const gardenEdgeGrass = [];
    let gardenTrimAmount = 0;
    const groundMaterial = standardMaterial(0xf4efe7, 0.98);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(144, 100), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.035;
    ground.receiveShadow = true;
    scene.add(ground);
    const lawnMaterial = new THREE.MeshStandardMaterial({
        color: 0x9eb77d,
        roughness: 0.96,
        transparent: true,
        opacity: 0.9,
    });
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(17, 10.5), lawnMaterial);
    lawn.rotation.x = -Math.PI / 2;
    lawn.position.set(12, -0.008, -7.5);
    lawn.receiveShadow = true;
    scene.add(lawn);
    const grassTileMaterial = standardMaterial(0x86a96d, 0.98);
    const grassTileGeometry = new THREE.BoxGeometry(1, 1, 1);
    const lawnColumns = 14;
    const lawnRows = 8;
    const tileWidth = 17 / lawnColumns;
    const tileDepth = 10.5 / lawnRows;
    const grassTiles = new THREE.InstancedMesh(grassTileGeometry, grassTileMaterial, lawnColumns * lawnRows);
    grassTiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    grassTiles.castShadow = true;
    grassTiles.receiveShadow = true;
    const grassTransform = new THREE.Object3D();
    const uncutGrassColor = new THREE.Color(0x86a96d);
    const cutGrassColor = new THREE.Color(0xb9cc8e);
    const grassColor = new THREE.Color();
    for (let row = 0; row < lawnRows; row += 1) {
        for (let column = 0; column < lawnColumns; column += 1) {
            const x = 3.5 + tileWidth * (column + 0.5);
            const z = -12.75 + tileDepth * (row + 0.5);
            const baseHeight = 0.14 + ((row * 7 + column * 3) % 4) * 0.012;
            grassTransform.scale.set(tileWidth * 0.94, baseHeight, tileDepth * 0.94);
            grassTransform.position.set(x, 0.008 + baseHeight * 0.5, z);
            grassTransform.updateMatrix();
            const tileIndex = row * lawnColumns + column;
            grassTiles.setMatrixAt(tileIndex, grassTransform.matrix);
            grassTiles.setColorAt(tileIndex, uncutGrassColor);
            lawnTiles.push({ x, z, baseHeight, cut: 0 });
        }
    }
    grassTiles.instanceMatrix.needsUpdate = true;
    if (grassTiles.instanceColor)
        grassTiles.instanceColor.needsUpdate = true;
    scene.add(grassTiles);
    const lawnBorder = standardMaterial(0x78986f, 0.94);
    for (const [x, z, width, depth] of [
        [12, -12.68, 17.3, 0.16],
        [12, -2.32, 17.3, 0.16],
        [3.42, -7.5, 0.16, 10.5],
        [20.58, -7.5, 0.16, 10.5],
    ]) {
        const edge = makeBox(width, 0.08, depth, lawnBorder, 0.025);
        edge.position.set(x, 0.01, z);
        edge.receiveShadow = true;
        scene.add(edge);
    }
    const islandMaterial = new THREE.MeshStandardMaterial({
        color: 0xe6ddd0,
        roughness: 0.95,
        transparent: true,
        opacity: 0.7,
    });
    for (const [x, z, sx, sz] of [
        [-21, -13, 4.8, 1.4],
        [23, 16, 4.2, 1.25],
        [-14, 10.5, 6.2, 3.2],
        [17, 16, 2.6, 0.8],
    ]) {
        const island = new THREE.Mesh(new THREE.CircleGeometry(1, 48), islandMaterial);
        island.rotation.x = -Math.PI / 2;
        island.position.set(x, -0.012, z);
        island.scale.set(sx, sz, 1);
        island.receiveShadow = true;
        scene.add(island);
    }
    const wood = standardMaterial(0xa57955, 0.91);
    const soil = standardMaterial(0x795640, 0.98);
    const leaf = standardMaterial(0x6f9f78, 0.94);
    const flowerColors = [0xd47e6c, 0xd6a247, 0x806f98, 0x6f91c2];
    for (const [index, bedPosition] of GARDEN_BEDS.entries()) {
        const bedX = bedPosition.x;
        const bedZ = bedPosition.z;
        const rotation = index === 0 ? -0.08 : 0.09;
        const bed = new THREE.Group();
        const frame = makeBox(3.8, 0.34, 1.72, wood, 0.07);
        frame.position.y = 0.17;
        const earth = makeBox(3.42, 0.18, 1.36, soil, 0.05);
        earth.position.y = 0.37;
        bed.add(frame, earth);
        for (let index = 0; index < 7; index += 1) {
            const plant = new THREE.Group();
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.48, 7), leaf);
            stem.position.y = 0.24;
            const bloom = makeSphere(0.13, standardMaterial(flowerColors[index % flowerColors.length], 0.9), 10, 7);
            bloom.scale.set(1.1, 0.7, 1.1);
            bloom.position.y = 0.51;
            plant.add(stem, bloom);
            plant.position.set(-1.35 + (index % 4) * 0.9, 0.43, (index % 2) * 0.58 - 0.29);
            bed.add(plant);
        }
        bed.position.set(bedX, 0, bedZ);
        bed.rotation.y = rotation;
        scene.add(bed);
    }
    const gardenGrassGeometry = new THREE.ConeGeometry(0.12, 0.62, 6);
    const gardenGrassMaterial = standardMaterial(0x6f9770, 0.98);
    for (let index = 0; index < 26; index += 1) {
        const baseHeight = 0.74 + (index % 4) * 0.06;
        const tuft = new THREE.Mesh(gardenGrassGeometry, gardenGrassMaterial);
        tuft.scale.set(0.72 + (index % 3) * 0.08, baseHeight, 0.78);
        tuft.position.set(-18.2 + index * 0.42, 0.31 * baseHeight, 9.02 + Math.sin(index * 1.7) * 0.14);
        tuft.rotation.y = (index % 5) * 0.26;
        tuft.castShadow = true;
        scene.add(tuft);
        gardenEdgeGrass.push({ mesh: tuft, baseHeight });
    }
    const stone = standardMaterial(0xc8bdaf, 0.97);
    for (let index = 0; index < 8; index += 1) {
        const step = new THREE.Mesh(new THREE.CircleGeometry(0.48 + (index % 2) * 0.08, 18), stone);
        step.rotation.x = -Math.PI / 2;
        step.position.set(-22 + index * 1.2, 0.006, 14.4 - index * 0.62);
        step.scale.y = 0.72;
        step.receiveShadow = true;
        scene.add(step);
    }
    const shrubMaterial = standardMaterial(0x769a78, 0.96);
    for (const [x, z, size] of [
        [-18.5, 8.4, 0.6],
        [-16.8, 8.1, 0.74],
        [-10.1, 9, 0.68],
        [-8.8, 10.1, 0.58],
    ]) {
        const shrub = makeSphere(size, shrubMaterial, 12, 8);
        shrub.scale.set(1.2, 0.72, 1);
        shrub.position.set(x, size * 0.58, z);
        scene.add(shrub);
    }
    const trunk = standardMaterial(0x96765d, 0.9);
    const foliage = standardMaterial(0x7fa78d, 0.92);
    for (const [x, z, size] of [
        [-22, -13, 0.94],
        [23.6, 16, 0.82],
        [-21.4, 16.6, 0.72],
        [19.1, 16.2, 0.66],
    ]) {
        const tree = new THREE.Group();
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.7, 9), trunk);
        stem.position.y = 0.85;
        const crown = makeSphere(0.78, foliage, 12, 8);
        crown.scale.set(1.08, 1.22, 0.95);
        crown.position.y = 2.05;
        tree.add(stem, crown, createContactShadow(0.8, 0.62, 0.08));
        tree.position.set(x, 0, z);
        tree.scale.setScalar(size);
        scene.add(tree);
    }
    const fence = new THREE.Group();
    const fenceMaterial = standardMaterial(0xd9c5aa, 0.9);
    const fencePostMaterial = standardMaterial(0xb8906c, 0.88);
    function addFenceSegment(x1, z1, x2, z2) {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const length = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        for (const height of [0.48, 0.98]) {
            const rail = makeBox(0.12, 0.1, length, fenceMaterial, 0.025);
            rail.position.set((x1 + x2) * 0.5, height, (z1 + z2) * 0.5);
            rail.rotation.y = yaw;
            fence.add(rail);
        }
        const posts = Math.max(1, Math.ceil(length / 2.8));
        for (let index = 0; index <= posts; index += 1) {
            const t = index / posts;
            const post = makeBox(0.18, 1.34, 0.18, fencePostMaterial, 0.035);
            post.position.set(THREE.MathUtils.lerp(x1, x2, t), 0.67, THREE.MathUtils.lerp(z1, z2, t));
            fence.add(post);
        }
    }
    addFenceSegment(-31, 23, -27, 23);
    addFenceSegment(-17, 23, 28, 23);
    addFenceSegment(-31, -20.5, 28, -20.5);
    addFenceSegment(-31, -20.5, -31, 2);
    addFenceSegment(-31, 20, -31, 23);
    addFenceSegment(28, -2, 28, 10);
    addFenceSegment(28, 16, 28, 23);
    scene.add(fence);
    return {
        markMowed(x, z) {
            if (x < 3.25 || x > 20.75 || z < -13 || z > -2)
                return;
            for (const tile of lawnTiles) {
                const dx = tile.x - x;
                const dz = tile.z - z;
                if (dx * dx + dz * dz <= 1.32)
                    tile.cut = 1;
            }
        },
        trimGardenEdge(amount) {
            gardenTrimAmount = Math.max(gardenTrimAmount, THREE.MathUtils.clamp(amount, 0, 1));
        },
        update(simulationTime, delta) {
            const lawnTime = cycleLocalTime(simulationTime, LAWN_START);
            const lawnCanRegrow = lawnTime > LAWN_DURATION + 1.5;
            lawnTiles.forEach((tile, index) => {
                if (lawnCanRegrow)
                    tile.cut = Math.max(0, tile.cut - delta / 12);
                const cut = smoothStep(tile.cut);
                const height = THREE.MathUtils.lerp(tile.baseHeight, 0.03, cut);
                grassTransform.scale.set(tileWidth * 0.94, height, tileDepth * 0.94);
                grassTransform.position.set(tile.x, 0.008 + height * 0.5, tile.z);
                grassTransform.updateMatrix();
                grassTiles.setMatrixAt(index, grassTransform.matrix);
                grassColor.lerpColors(uncutGrassColor, cutGrassColor, cut);
                grassTiles.setColorAt(index, grassColor);
            });
            grassTiles.instanceMatrix.needsUpdate = true;
            if (grassTiles.instanceColor)
                grassTiles.instanceColor.needsUpdate = true;
            const gardenTime = cycleLocalTime(simulationTime, GARDEN_START);
            if (gardenTime > GARDEN_DURATION + 1.5) {
                gardenTrimAmount = Math.max(0, gardenTrimAmount - delta / 10);
            }
            gardenEdgeGrass.forEach(({ mesh, baseHeight }, index) => {
                const sequence = THREE.MathUtils.clamp(gardenTrimAmount * 1.18 - (index / Math.max(1, gardenEdgeGrass.length - 1)) * 0.18, 0, 1);
                const heightScale = THREE.MathUtils.lerp(baseHeight, baseHeight * 0.32, smoothStep(sequence));
                mesh.scale.y = heightScale;
                mesh.position.y = 0.31 * heightScale;
            });
        },
    };
}
function getCameraGoal(view, aspect, service = "all") {
    const portrait = aspect < 0.85;
    const compact = aspect < 1.2;
    const wide = aspect > 2;
    const distance = portrait ? 1.86 : compact ? 1.36 : wide ? 1.1 : 1;
    if (service !== "all") {
        const frames = {
            employment: {
                target: [1.15, 0.78, -0.72],
                orthoHalfHeight: 12.45,
                groundPosition: [1.5, 6.15, 24.4],
                closerPosition: [17.1, 12.5, 22.2],
            },
            "personal-care": {
                target: [1.35, 0.78, -0.28],
                orthoHalfHeight: 12.35,
                groundPosition: [1.9, 6.05, 23.7],
                closerPosition: [17.3, 12.25, 21.8],
            },
            "travel-transport": {
                target: [1.45, 0.72, -0.25],
                orthoHalfHeight: 12.95,
                groundPosition: [1.0, 5.85, 25.2],
                closerPosition: [18.0, 12.7, 23.1],
            },
            "shared-living": {
                target: [1.55, 0.8, -0.52],
                orthoHalfHeight: 12.35,
                groundPosition: [1.4, 6.1, 23.9],
                closerPosition: [17.2, 12.3, 21.9],
            },
            household: {
                target: [1.6, 0.72, -0.35],
                orthoHalfHeight: 12.55,
                groundPosition: [1.9, 5.95, 24.2],
                closerPosition: [17.5, 12.25, 22.3],
            },
            community: {
                target: [2.7, 0.78, -1.28],
                orthoHalfHeight: 12.9,
                groundPosition: [2.3, 6.1, 25.1],
                closerPosition: [18.6, 12.7, 23.0],
            },
        };
        const frame = frames[service];
        const target = new THREE.Vector3(...frame.target);
        const serviceDistance = portrait ? 1.38 : compact ? 1.16 : wide ? 0.94 : 1;
        if (view === "ground-level") {
            const [x, y, z] = frame.groundPosition;
            return {
                position: new THREE.Vector3(x, portrait ? y * 1.28 : y, z * serviceDistance),
                target: target.clone().setY(1.18),
                fov: portrait ? 50 : 40,
                orthographic: false,
                orthoHalfHeight: 0,
            };
        }
        if (view === "isometric") {
            return {
                position: new THREE.Vector3(28, 29, 29),
                target,
                fov: 34,
                orthographic: true,
                orthoHalfHeight: Math.max(frame.orthoHalfHeight, 17.4 / Math.max(0.52, aspect)),
            };
        }
        const [x, y, z] = frame.closerPosition;
        return {
            position: new THREE.Vector3(x * serviceDistance, y * serviceDistance, z * serviceDistance),
            target: target.clone().setY(1.08),
            fov: portrait ? 49 : 40,
            orthographic: false,
            orthoHalfHeight: 0,
        };
    }
    if (view === "ground-level") {
        return {
            position: new THREE.Vector3(0, portrait ? 10.5 : 7.2, 34 * distance),
            target: new THREE.Vector3(0, 1.05, 0),
            fov: portrait ? 48 : 40,
            orthographic: false,
            orthoHalfHeight: 0,
        };
    }
    if (view === "isometric") {
        return {
            position: new THREE.Vector3(48, 54, 48),
            target: new THREE.Vector3(-1.5, 0.2, 0.5),
            fov: 34,
            orthographic: true,
            orthoHalfHeight: Math.max(27, 40 / Math.max(0.42, aspect)),
        };
    }
    return {
        position: new THREE.Vector3(24 * distance, 19 * distance, 30 * distance),
        target: new THREE.Vector3(0, 0.8, 0),
        fov: portrait ? 47 : 40,
        orthographic: false,
        orthoHalfHeight: 0,
    };
}
export { createServiceScenes, getCameraGoal, SERVICES };
