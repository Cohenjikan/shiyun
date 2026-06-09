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
// `angle` drives the POET layer + 赠诗 + markers + the CPU picker (these must agree to the float).
// `decorAngle` drives ONLY the decorative backdrop, and turns a bit FASTER — a gentle differential
// so (a) the galaxy never looks like a rigid pinwheel, and (b) with 引力 ON the camera co-rotates
// with the poets (frozen → clickable) while the diffuse haze keeps flowing past them ("still
// spinning" illusion). Because the backdrop is mostly haze now, the drift reads as nebulosity, not
// a mismatched second arm set.
export const galaxySpin = { angle: 0, decorAngle: 0 };

// Shared monotonic clock (seconds) for poem-planet SELF-rotation around their poet. Advanced by
// PoemOrbits each frame; read by the planet shaders (uTime), the GPU picker (so a click hits the
// planet where it's drawn), and positions.poemPosition (so locate/flares track the orbiting planet).
export const poemClock = { t: 0 };
export const SPIN_RATE = 0.012; // poet layer rad/sec — gentle; a full turn ≈ 8.7 min
export const DECOR_RATE = 0.019; // backdrop rad/sec — ~1.6× the poets → visible differential

export function advanceSpin(dt: number) {
  // wrap to keep cos/sin precision over very long sessions (seamless — 2π ≡ 0).
  galaxySpin.angle = (galaxySpin.angle + dt * SPIN_RATE) % (Math.PI * 2);
  galaxySpin.decorAngle = (galaxySpin.decorAngle + dt * DECOR_RATE) % (Math.PI * 2);
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
