import * as THREE from 'three';

/**
 * Procedural Sci-Fi Architecture Factory
 * Creates parametric building silhouettes for the Cyberpunk Code City.
 */
export class GeometryFactory {

  /**
   * WEB-APPS: "The Helix Tower"
   * A box that twists along the Y-axis (like the "Turning Torso" building).
   * Represents the "stack" - dynamic, flowing.
   */
  static createHelixTower(width: number, height: number, depth: number): THREE.BufferGeometry {
    // Increase segments to allow smooth twisting
    const geometry = new THREE.BoxGeometry(width, height, depth, 1, 10, 1);
    const positionAttribute = geometry.attributes.position;
    const vertex = new THREE.Vector3();

    // Twist Factor: How much it rotates (PI / 2 = 90 degrees)
    const twistAmount = Math.PI / 2;

    for (let i = 0; i < positionAttribute.count; i++) {
      vertex.fromBufferAttribute(positionAttribute, i);

      // Calculate rotation based on height (0 at bottom, full twist at top)
      const yNormalized = (vertex.y + height / 2) / height;
      const angle = yNormalized * twistAmount;

      // Apply rotation matrix manually to X/Z
      const cx = vertex.x;
      const cz = vertex.z;
      vertex.x = cx * Math.cos(angle) - cz * Math.sin(angle);
      vertex.z = cx * Math.sin(angle) + cz * Math.cos(angle);

      positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * TRADING: "The Quant Blade"
   * A sharp triangular prism with a slanted roof (The Shard style).
   * Aggressive, sleek, fast.
   */
  static createQuantBlade(width: number, height: number): THREE.BufferGeometry {
    // 3 radial segments = Triangle
    const geometry = new THREE.CylinderGeometry(width * 0.1, width, height, 3, 1);

    // Scale it to be thin and wide (Blade-like)
    geometry.scale(1, 1, 0.4);

    // Fix rotation so flat face faces camera
    geometry.rotateY(Math.PI / 6);

    return geometry;
  }

  /**
   * INFRASTRUCTURE: "The Brutalist Ziggurat"
   * A heavy, stepped pyramid building (Tyrell Corp style).
   * Stable, foundational, immovable.
   */
  static createZiggurat(width: number, height: number, _depth: number): THREE.BufferGeometry {
    // Base is wider (1.4x), Top is narrower (0.7x)
    // 4 sides = square base, 4 height segments for stepped look
    const geometry = new THREE.CylinderGeometry(width * 0.7, width * 1.4, height, 4, 4);
    geometry.rotateY(Math.PI / 4); // Align to grid

    return geometry;
  }

  /**
   * VISUALIZATION: "The Data Shard"
   * Two pyramids connected base-to-base (Octahedron), stretched.
   * Abstract, mathematical.
   */
  static createDataShard(width: number, height: number): THREE.BufferGeometry {
    const geometry = new THREE.OctahedronGeometry(width);
    geometry.scale(1, height / width, 1); // Vertical stretch
    return geometry;
  }

  /**
   * OBSIDIAN-PLUGINS: "The Modular Hive"
   * Hexagonal column - interconnected, modular.
   */
  static createHive(width: number, height: number): THREE.BufferGeometry {
    return new THREE.CylinderGeometry(width, width, height, 6, 1);
  }

  /**
   * CONTENT: "The Memory Core"
   * Cylinder with ribbed edges (16 segments + flat shading = ribbed look).
   * Storage, density.
   */
  static createMemoryCore(width: number, height: number): THREE.BufferGeometry {
    // 16 segments gives a "low poly" ribbed look with flatShading
    return new THREE.CylinderGeometry(width, width, height, 16, 1);
  }

  /**
   * DEFAULT: Standard box for unknown categories
   */
  static createDefault(width: number, height: number, depth: number): THREE.BufferGeometry {
    return new THREE.BoxGeometry(width, height, depth);
  }
}
