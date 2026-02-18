import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';
import type { ProjectData } from '../types';

export class BuildingFactory {
    // Deterministic random based on string seed
    private static seededRandom(seed: string): number {
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            hash = (hash << 5) - hash + seed.charCodeAt(i);
            hash |= 0;
        }
        const x = Math.sin(hash) * 10000;
        return x - Math.floor(x);
    }

    static createBuilding(project: ProjectData): THREE.BufferGeometry {
        const { width, height, depth } = project.dimensions!;
        const seed = project.path || 'default';
        const rand = this.seededRandom(seed);

        // Pick style based on project characteristics or random
        if (project.status === 'active') {
            return this.createNeonSpire(width, height, depth, rand);
        } else if (height > 20) {
            return this.createMonolith(width, height, depth, rand);
        } else {
            return this.createZiggurat(width, height, depth, rand);
        }
    }

    static createFoundation(project: ProjectData, height: number): THREE.BufferGeometry {
        const { width, depth } = project.dimensions!;
        const padding = 0.4;

        // Match style logic from createBuilding
        // We re-derive the style decision here or passed in. 
        const isSpire = project.status === 'active';

        if (isSpire) {
            // Hexagonal foundation for Spire
            const radius = Math.min(width, depth) / 2 + padding;
            const geo = new THREE.CylinderGeometry(radius, radius, height, 6);
            geo.translate(0, height / 2, 0);
            return geo;
        } else {
            // Box foundation for others
            const geo = new THREE.BoxGeometry(width + padding, height, depth + padding);
            geo.translate(0, height / 2, 0);
            return geo;
        }
    }

    private static createZiggurat(w: number, h: number, d: number, rand: number): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];

        // Base tier
        const tiers = 3 + Math.floor(rand * 3); // 3-5 tiers
        let currentY = 0;
        const tierHeight = h / tiers;

        for (let i = 0; i < tiers; i++) {
            const shrinkFactor = 1 - (i * 0.15); // Shrink by 15% each tier
            const tierW = w * shrinkFactor;
            const tierD = d * shrinkFactor;

            const geo = new THREE.BoxGeometry(tierW, tierHeight, tierD);
            geo.translate(0, currentY + tierHeight / 2, 0);
            geometries.push(geo);

            // Add cooling fins to sides of base tier
            if (i === 0) {
                const finCount = 4;
                const finGeo = new THREE.BoxGeometry(0.2, tierHeight * 0.8, 1);
                for (let f = 0; f < finCount; f++) {
                    const offset = (f - (finCount - 1) / 2) * (tierD / finCount);
                    // Left side
                    const finL = finGeo.clone();
                    finL.translate(-tierW / 2 - 0.1, currentY + tierHeight / 2, offset);
                    geometries.push(finL);
                    // Right side
                    const finR = finGeo.clone();
                    finR.translate(tierW / 2 + 0.1, currentY + tierHeight / 2, offset);
                    geometries.push(finR);
                }
            }

            currentY += tierHeight;
        }

        // Use mergeBufferGeometries from three-stdlib
        // Note: in newer Three.js mergeBufferGeometries is merged into mergeGeometries, 
        // but three-stdlib exports it as mergeBufferGeometries.
        const merged = mergeBufferGeometries(geometries);
        return merged || new THREE.BoxGeometry(w, h, d); // Fallback if merge fails (empty array)
    }

    private static createMonolith(w: number, h: number, d: number, rand: number): THREE.BufferGeometry {
        // Basic chiseled block
        const geometries: THREE.BufferGeometry[] = [];
        const main = new THREE.BoxGeometry(w, h, d);
        main.translate(0, h / 2, 0);
        geometries.push(main);

        // Add random "datablock" protrusions
        const blockCount = 5 + Math.floor(rand * 5);
        for (let i = 0; i < blockCount; i++) {
            const bw = w * (0.2 + rand * 0.3);
            const bh = h * 0.05;
            const bd = d + 1; // Stick out
            const b = new THREE.BoxGeometry(bw, bh, bd);
            const y = (h * 0.2) + (rand * h * 0.7); // Spread vertically
            b.translate(0, y, 0);
            geometries.push(b);
        }

        const merged = mergeBufferGeometries(geometries);
        return merged || main;
    }

    private static createNeonSpire(w: number, h: number, d: number, rand: number): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        const radius = Math.min(w, d) / 2;

        // Hexagonal Core
        const core = new THREE.CylinderGeometry(radius, radius, h, 6);
        core.translate(0, h / 2, 0);
        geometries.push(core);

        // Rings
        const rings = 4;
        for (let i = 0; i < rings; i++) {
            const y = h * (0.2 + (i / rings) * 0.7);
            const ring = new THREE.TorusGeometry(radius * 1.2, 0.2, 8, 24);
            ring.rotateX(Math.PI / 2);
            ring.translate(0, y, 0);
            geometries.push(ring);
        }

        const merged = mergeBufferGeometries(geometries);
        return merged || core;
    }
}
