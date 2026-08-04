import * as THREE from './three.module.min.js';

/*
 * BookIt care-nav v65 — the ONE obstacle-aware navigation system.
 * Every walking journey on the site (homepage scenes in care-motion.js and
 * the per-service dioramas in care-core.local.js) routes through here.
 *
 * Obstacles: {type:'rect', minX,maxX,minZ,maxZ} or {type:'circle'|other, x,z,r}
 * `clearance` is the radius of EVERYTHING that travels: the character plus
 * whatever is pushed or carried (wheelchair, vacuum head, a stack of plates)
 * — never just the character's centre point. Destination points may sit
 * closer than the clearance (docking at a bench, a bed, a chair), but every
 * segment of the route in between honours it.
 */

export function distanceToObstacle(point, obstacle) {
    if (obstacle.type === 'rect') {
        const dx = Math.max(obstacle.minX - point.x, 0, point.x - obstacle.maxX);
        const dz = Math.max(obstacle.minZ - point.z, 0, point.z - obstacle.maxZ);
        return Math.hypot(dx, dz);
    }
    return Math.hypot(point.x - obstacle.x, point.z - obstacle.z) - obstacle.r;
}

export function routeSegmentMinClearance(start, end, obstacles) {
    const span = Math.max(0.001, start.distanceTo(end));
    const samples = Math.max(8, Math.ceil(span / 0.16));
    let minimum = Number.POSITIVE_INFINITY;
    for (let index = 0; index <= samples; index += 1) {
        const point = start.clone().lerp(end, index / samples);
        for (const obstacle of obstacles) {
            minimum = Math.min(minimum, distanceToObstacle(point, obstacle));
        }
    }
    return minimum;
}

export function routeSegmentIsClear(start, end, obstacles, clearance) {
    return routeSegmentMinClearance(start, end, obstacles) >= clearance;
}

function createObstacleGuidePoints(obstacle, offset) {
    const points = [];
    if (obstacle.type === 'rect') {
        const minX = obstacle.minX - offset;
        const maxX = obstacle.maxX + offset;
        const minZ = obstacle.minZ - offset;
        const maxZ = obstacle.maxZ + offset;
        points.push(
            new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(minX, 0, maxZ),
            new THREE.Vector3(maxX, 0, minZ), new THREE.Vector3(maxX, 0, maxZ),
            new THREE.Vector3((minX + maxX) * 0.5, 0, minZ), new THREE.Vector3((minX + maxX) * 0.5, 0, maxZ),
            new THREE.Vector3(minX, 0, (minZ + maxZ) * 0.5), new THREE.Vector3(maxX, 0, (minZ + maxZ) * 0.5),
        );
    }
    else {
        const radius = obstacle.r + offset;
        for (let index = 0; index < 8; index += 1) {
            const angle = (index / 8) * Math.PI * 2;
            points.push(new THREE.Vector3(obstacle.x + Math.cos(angle) * radius, 0, obstacle.z + Math.sin(angle) * radius));
        }
    }
    return points;
}

function dedupeRoutePoints(points) {
    const deduped = [];
    points.forEach((point) => {
        const duplicate = deduped.some((existing) => existing.distanceToSquared(point) < 0.0001);
        if (!duplicate)
            deduped.push(point.clone());
    });
    return deduped;
}

function simplifyRoutePoints(points, obstacles, clearance) {
    if (points.length <= 2)
        return points.map((point) => point.clone());
    const simplified = [points[0].clone()];
    let currentIndex = 0;
    while (currentIndex < points.length - 1) {
        let nextIndex = points.length - 1;
        while (nextIndex > currentIndex + 1
            && !routeSegmentIsClear(points[currentIndex], points[nextIndex], obstacles, clearance)) {
            nextIndex -= 1;
        }
        simplified.push(points[nextIndex].clone());
        currentIndex = nextIndex;
    }
    return dedupeRoutePoints(simplified);
}

function navCurve(points) {
    return new THREE.CatmullRomCurve3(points.map((point) => point.clone()), false, 'centripetal', 0.28);
}

export function createNavigationRoute(start, end, obstacles, clearance = 0.58, guidePoints = []) {
    const guideOffset = clearance + 0.34;
    const seedNodes = [
        start.clone(),
        end.clone(),
        ...guidePoints.map((point) => point.clone()),
        ...obstacles.flatMap((obstacle) => createObstacleGuidePoints(obstacle, guideOffset)),
    ];
    const nodes = dedupeRoutePoints(seedNodes.filter((point, index) => {
        if (index <= 1)
            return true;
        return obstacles.every((obstacle) => distanceToObstacle(point, obstacle) >= clearance - 0.02);
    }));
    const neighbors = nodes.map(() => []);
    for (let left = 0; left < nodes.length; left += 1) {
        for (let right = left + 1; right < nodes.length; right += 1) {
            if (!routeSegmentIsClear(nodes[left], nodes[right], obstacles, clearance))
                continue;
            const cost = nodes[left].distanceTo(nodes[right]);
            neighbors[left].push({ index: right, cost });
            neighbors[right].push({ index: left, cost });
        }
    }
    const startIndex = 0;
    const endIndex = 1;
    const open = new Set([startIndex]);
    const cameFrom = new Map();
    const gScore = new Array(nodes.length).fill(Number.POSITIVE_INFINITY);
    const fScore = new Array(nodes.length).fill(Number.POSITIVE_INFINITY);
    gScore[startIndex] = 0;
    fScore[startIndex] = nodes[startIndex].distanceTo(nodes[endIndex]);
    while (open.size > 0) {
        let current = -1;
        let best = Number.POSITIVE_INFINITY;
        open.forEach((candidate) => {
            if (fScore[candidate] < best) {
                best = fScore[candidate];
                current = candidate;
            }
        });
        if (current < 0)
            break;
        if (current === endIndex) {
            const points = simplifyRoutePoints((() => {
                const ordered = [nodes[endIndex].clone()];
                let cursor = current;
                while (cameFrom.has(cursor)) {
                    cursor = cameFrom.get(cursor);
                    ordered.unshift(nodes[cursor].clone());
                }
                return ordered;
            })(), obstacles, clearance);
            const path = navCurve(points);
            let minClearance = Number.POSITIVE_INFINITY;
            for (let index = 0; index <= 480; index += 1) {
                const point = path.getPointAt(index / 480);
                obstacles.forEach((obstacle) => {
                    minClearance = Math.min(minClearance, distanceToObstacle(point, obstacle));
                });
            }
            return { points, path, length: path.getLength(), minClearance };
        }
        open.delete(current);
        neighbors[current].forEach(({ index, cost }) => {
            const tentative = gScore[current] + cost;
            if (tentative + 1e-6 >= gScore[index])
                return;
            cameFrom.set(index, current);
            gScore[index] = tentative;
            fScore[index] = tentative + nodes[index].distanceTo(nodes[endIndex]);
            open.add(index);
        });
    }
    const fallbackPoints = [start.clone(), end.clone()];
    const fallbackPath = navCurve(fallbackPoints);
    return {
        points: fallbackPoints,
        path: fallbackPath,
        length: fallbackPath.getLength(),
        minClearance: routeSegmentMinClearance(start, end, obstacles),
    };
}
