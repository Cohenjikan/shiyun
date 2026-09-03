// Pure hand-landmark geometry for the exhibition gesture input. No DOM / three.js here so every rule
// is unit-testable. All coordinates are MediaPipe's normalised camera frame (0..1, y down, NOT
// mirrored) unless a function says otherwise.
//
// Landmark ids (MediaPipe hand): 0 wrist · 1-4 thumb (4 = tip) · 5-8 index (5 = MCP, 6 = PIP, 8 = tip)
// · 9-12 middle · 13-16 ring · 17-20 pinky.

export interface GestureLandmark {
  x: number;
  y: number;
  z?: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export interface HandSample {
  landmarks: GestureLandmark[]; // raw normalised camera frame (for mapping + preview)
  // The same points in ISOTROPIC units (x scaled by the camera aspect so that 0.1 means the same
  // physical distance on both axes). Every finger/pinch rule below measures on these — in the raw
  // frame a vertical gap reads 1.78× larger than the same gap held horizontally.
  iso: GestureLandmark[];
  handedness: string;
  gesture: string; // canned classifier label (Victory, Thumb_Up, Open_Palm, …) or "None"
  score: number; // canned classifier score
  // Palm-top point = mean of the four finger MCP joints (5, 9, 13, 17). It is the most stable point
  // on the hand under finger motion: pinching, pointing or closing the hand barely moves it, so the
  // cursor never jumps when the visitor "clicks".
  palm: Point2;
  // Palm centre (wrist + MCPs) — used only for presenter continuity (owner lock).
  center: Point2;
  // Palm size in isotropic units (frame heights), rotation tolerant: the wider of the knuckle line
  // (5→17) and 0.75× the palm length (0→9). Every finger threshold is expressed relative to this, so
  // the same rules hold at 1 m and at 2.5 m from the camera.
  size: number;
  // bounding-box extent, for the "is this hand big enough to be the presenter" gate
  extent: number;
}

export const distance2 = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const clamp01 = (n: number) => clamp(n, 0, 1);

function meanOf(landmarks: GestureLandmark[], ids: number[]): Point2 {
  const pts = ids.map((i) => landmarks[i]).filter(Boolean);
  if (!pts.length) return { x: 0.5, y: 0.5 };
  const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pts.length, y: sum.y / pts.length };
}

export function palmSize(landmarks: GestureLandmark[]): number {
  if (landmarks.length < 21) return 0.08;
  const knuckles = distance2(landmarks[5], landmarks[17]);
  const length = distance2(landmarks[0], landmarks[9]);
  return Math.max(0.02, knuckles, length * 0.75);
}

export function handExtent(landmarks: GestureLandmark[]): number {
  if (!landmarks.length) return 0;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

export const CAMERA_ASPECT = 16 / 9; // the 640×360 capture requested by GestureControls

export function buildHandSample(landmarks: GestureLandmark[], handedness: string, gesture: string, score: number, aspect = CAMERA_ASPECT): HandSample {
  const iso = aspect === 1 ? landmarks : landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z }));
  return {
    landmarks,
    iso,
    handedness,
    gesture,
    score,
    palm: meanOf(landmarks, [5, 9, 13, 17]),
    center: meanOf(landmarks, [0, 5, 9, 13, 17]),
    size: palmSize(iso),
    extent: handExtent(landmarks),
  };
}

// ── finger state helpers ─────────────────────────────────────────────────────────────────────────

// A finger counts as extended when its tip is clearly farther from the wrist than its PIP joint.
export function fingerExtended(l: GestureLandmark[], tip: number, pip: number, factor = 1.12): boolean {
  return !!l[0] && !!l[tip] && !!l[pip] && distance2(l[tip], l[0]) > distance2(l[pip], l[0]) * factor;
}

// …and folded when the tip has come back toward the wrist past its PIP joint.
export function fingerFolded(l: GestureLandmark[], tip: number, pip: number, factor = 1.0): boolean {
  return !!l[0] && !!l[tip] && !!l[pip] && distance2(l[tip], l[0]) < distance2(l[pip], l[0]) * factor;
}

export function extendedFingers(hand: HandSample): { index: boolean; middle: boolean; ring: boolean; pinky: boolean } {
  const l = hand.iso;
  return {
    index: fingerExtended(l, 8, 6),
    middle: fingerExtended(l, 12, 10),
    ring: fingerExtended(l, 16, 14),
    pinky: fingerExtended(l, 20, 18),
  };
}

// ── pinch (thumb tip ↔ index tip) ────────────────────────────────────────────────────────────────
//
// Pinch is the one "click" primitive: a single scalar (tip distance ÷ palm size) with hysteresis is
// far more stable than any whole-hand pose label, works at every hand rotation the camera can still
// see the thumb in, and — because the cursor rides on the palm, not the fingertip — it does not move
// the cursor while the fingers close.
export const PINCH_ENTER = 0.38; // ratio below which a pinch begins
export const PINCH_EXIT = 0.58; // ratio above which it ends (hysteresis band ≈ 1/5 palm width)

export function pinchRatio(hand: HandSample): number {
  const l = hand.iso;
  if (l.length < 21) return 9;
  return distance2(l[4], l[8]) / hand.size;
}

// A closing fist also brings the thumb and index tips together. Separate the two by WHERE the contact
// happens: in a pinch the thumb/index contact point sits out in front of the knuckle line, in a fist
// it collapses into the palm. A curled "OK-sign" pinch (index tip only ~0.75× as far from the wrist
// as its PIP) must still pass, so the reach factor is deliberately loose.
export function pinchGuard(hand: HandSample): boolean {
  const l = hand.iso;
  if (l.length < 21) return false;
  const wrist = l[0];
  const indexReach = distance2(l[8], wrist) > distance2(l[6], wrist) * 0.72;
  const contact = { x: (l[4].x + l[8].x) / 2, y: (l[4].y + l[8].y) / 2 };
  const palmCentre = meanOf(l, [0, 5, 9, 13, 17]);
  const contactOutside = distance2(contact, palmCentre) > hand.size * 0.55;
  const thumbOut = distance2(l[4], l[9]) > hand.size * 0.32;
  return indexReach && contactOutside && thumbOut;
}

// 0 when the fingers are wide apart, 1 when they touch — drives the shrinking cursor ring so a
// visitor sees the pinch forming before it registers.
export function pinchStrength(ratio: number): number {
  return clamp01((1.1 - ratio) / (1.1 - PINCH_ENTER));
}

// ── whole-hand poses used for the two "special" hold triggers ────────────────────────────────────

export function isFistPose(hand: HandSample): boolean {
  const l = hand.iso;
  if (l.length < 21) return false;
  return fingerFolded(l, 8, 6, 1.05) && fingerFolded(l, 12, 10, 1.05) && fingerFolded(l, 16, 14, 1.05) && fingerFolded(l, 20, 18, 1.05);
}

export function isOpenPalmPose(hand: HandSample): boolean {
  const f = extendedFingers(hand);
  const n = [f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;
  return n >= 3 && (f.index || f.middle);
}

// ✌️ index + middle extended and apart, ring + pinky folded. Orientation-agnostic on purpose: an
// upright, tilted or sideways V all count, which is what a visitor who was told "比个 V" will do.
export function isVictoryPose(hand: HandSample): boolean {
  const l = hand.iso;
  if (l.length < 21) return false;
  const geometry = fingerExtended(l, 8, 6, 1.08) && fingerExtended(l, 12, 10, 1.08)
    && fingerFolded(l, 16, 14, 1.02) && fingerFolded(l, 20, 18, 1.02)
    && distance2(l[8], l[12]) > hand.size * 0.22;
  return geometry || (hand.gesture === "Victory" && hand.score >= 0.6);
}

// 👍 thumb clearly extended away from the fist while the four fingers are folded. The canned label
// alone is accepted at high confidence; geometry alone is accepted without it.
export function isThumbUpPose(hand: HandSample): boolean {
  const l = hand.iso;
  if (l.length < 21) return false;
  const fingersFolded = fingerFolded(l, 8, 6, 1.05) && fingerFolded(l, 12, 10, 1.05) && fingerFolded(l, 16, 14, 1.05) && fingerFolded(l, 20, 18, 1.05);
  const thumbAway = distance2(l[4], l[5]) > hand.size * 0.55 && distance2(l[4], l[0]) > distance2(l[2], l[0]) * 1.15;
  const thumbAboveKnuckles = l[4].y < Math.min(l[5].y, l[9].y, l[13].y, l[17].y) - hand.size * 0.15;
  return (fingersFolded && thumbAway && thumbAboveKnuckles) || (hand.gesture === "Thumb_Up" && hand.score >= 0.7 && fingersFolded);
}

// ── cursor mapping ───────────────────────────────────────────────────────────────────────────────
//
// The cursor is ABSOLUTE inside a "reach box" that is sized in palm widths and anchored where the
// presenter's hand was when it took control — not a fixed fraction of the camera frame. A fixed
// 74 %-of-frame box is ~1.8 m of arm travel at 1.5 m from a laptop webcam; a box of ~9 palm widths is
// ~70 cm at any distance, so a visitor at 2 m and a child at 1 m get the same comfortable sweep.
// x is mirrored so moving the hand right moves the cursor right. Output is a screen fraction (0..1).
export interface ReachBox {
  anchor: Point2; // raw camera coords of the box centre
  halfW: number; // raw x units
  halfH: number; // raw y units
}

export const REACH_PALMS = 9; // box width in palm sizes
export const REACH_MAX_FRACTION = 0.9; // never wider than this fraction of the frame

export function makeReachBox(anchor: Point2, palmSizeIso: number, cameraAspect = CAMERA_ASPECT, screenAspect = 16 / 9): ReachBox {
  // width in isotropic units → raw x units; height keeps the screen's aspect so motion feels 1:1
  const widthIso = Math.min(REACH_PALMS * palmSizeIso, REACH_MAX_FRACTION * cameraAspect);
  const halfW = widthIso / cameraAspect / 2;
  const halfH = Math.min(0.5, widthIso / screenAspect / 2);
  return {
    anchor: {
      x: clamp(anchor.x, Math.min(0.5, halfW), Math.max(0.5, 1 - halfW)),
      y: clamp(anchor.y, Math.min(0.5, halfH), Math.max(0.5, 1 - halfH)),
    },
    halfW,
    halfH,
  };
}

// Unclamped box coordinates (0..1 inside the box; <0 / >1 when the hand has left it).
export function reachCoords(box: ReachBox, palm: Point2): Point2 {
  return {
    x: 1 - ((palm.x - box.anchor.x) / (2 * box.halfW) + 0.5),
    y: (palm.y - box.anchor.y) / (2 * box.halfH) + 0.5,
  };
}

export function mapToScreenFraction(box: ReachBox, palm: Point2): Point2 {
  const u = reachCoords(box, palm);
  return { x: clamp01(u.x), y: clamp01(u.y) };
}

// When the hand pushes past a box edge, slide the box after it (at most `rate` box widths per second)
// so the presenter can always reach the far side of the screen without walking sideways.
export function recentreReachBox(box: ReachBox, palm: Point2, dtSeconds: number, rate = 0.5): ReachBox {
  const u = reachCoords(box, palm);
  const step = rate * dtSeconds;
  let ax = box.anchor.x, ay = box.anchor.y;
  // u.x is mirrored: u.x > 1 means the hand is past the camera-LEFT edge (anchor.x must decrease)
  if (u.x > 1) ax -= Math.min(u.x - 1, step) * 2 * box.halfW;
  else if (u.x < 0) ax += Math.min(-u.x, step) * 2 * box.halfW;
  if (u.y > 1) ay += Math.min(u.y - 1, step) * 2 * box.halfH;
  else if (u.y < 0) ay -= Math.min(-u.y, step) * 2 * box.halfH;
  if (ax === box.anchor.x && ay === box.anchor.y) return box;
  return { ...box, anchor: { x: ax, y: ay } };
}

// Presenter acquisition region: a hand must sit inside this and be big enough for a short while to
// become the "owner". Slightly smaller than the reach box so a visitor at the edge of the frame does
// not steal control from the presenter mid-demo.
export const ACQUIRE_BOX = { x0: 0.16, x1: 0.84, y0: 0.1, y1: 0.92 } as const;
export const MIN_OWNER_EXTENT = 0.06;

export function insideAcquireBox(p: Point2): boolean {
  return p.x > ACQUIRE_BOX.x0 && p.x < ACQUIRE_BOX.x1 && p.y > ACQUIRE_BOX.y0 && p.y < ACQUIRE_BOX.y1;
}
