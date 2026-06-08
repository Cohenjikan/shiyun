// Shared spiral-galaxy constants so the decorative backdrop (Galaxy) and the 29k poet
// stars (PoetStars) wind into the SAME arms. Recipe: Bruno Simon "Galaxy Generator"
// branch+spin skeleton + logarithmic twist + bulge + 3-stop colour.
export const GALAXY = {
  RADIUS: 3600,
  BRANCHES: 4, // grand-design arms (2 brighter feels MW-like; 4 reads fuller)
  TWIST: 5.2, // radians of winding from centre to edge
  ARM_SPREAD: 0.42, // gaussian angular σ of an arm
  THICKNESS: 0.11, // disk |y| fraction of radius — thicker → less razor-flat, more volumetric
};

// cheap Irwin–Hall gaussian ~ N(0, ~0.5) from three uniforms in [0,1)
export function gauss3(a: number, b: number, c: number): number {
  return a + b + c - 1.5;
}

// ── Shared rigid galaxy spin ────────────────────────────────────────────────
// The backdrop (Galaxy) used to spin in its own vertex shader (with an x/z reflection),
// while the poet stars, 赠诗 arcs and void markers never rotated — so the layers turned
// against each other. Now ALL of them rotate by ONE shared angle, advanced once per frame
// (in Galaxy) and read by everyone: poet group, GiftLines, pull markers, labels, and the
// CPU picker. The rotation EXACTLY matches three's Object3D.rotation.y, so a group set to
// `rotation.y = galaxySpin.angle` and the CPU helpers below agree to the float (picking
// stays accurate as the galaxy turns).
export const galaxySpin = { angle: 0 };
export const SPIN_RATE = 0.012; // rad/sec — gentle; a full turn ≈ 8.7 min

export function advanceSpin(dt: number) {
  // wrap to keep cos/sin precision over very long sessions (seamless — 2π ≡ 0).
  galaxySpin.angle = (galaxySpin.angle + dt * SPIN_RATE) % (Math.PI * 2);
}

// LOCAL galaxy frame → WORLD (matches THREE.Matrix4.makeRotationY(angle)).
export function spinXZ(x: number, z: number): [number, number] {
  const a = galaxySpin.angle,
    c = Math.cos(a),
    s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}
// WORLD → LOCAL galaxy frame (inverse rotation).
export function unspinXZ(x: number, z: number): [number, number] {
  const a = galaxySpin.angle,
    c = Math.cos(a),
    s = Math.sin(a);
  return [x * c - z * s, x * s + z * c];
}
