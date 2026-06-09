import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Galaxy } from "./three/Galaxy";
import { PoetStars } from "./three/PoetStars";
import { PoemOrbits } from "./three/PoemOrbits";
import { PoemGuides } from "./three/PoemGuides";
import { GiftLines } from "./three/GiftLines";
import { GiftTrail } from "./three/GiftTrail";
import { PulledStars } from "./three/PulledStars";
import { FlyControls } from "./three/FlyControls";
import { HUD } from "./ui/HUD";
import { PoemPanel } from "./ui/PoemPanel";
import { PoetPanel } from "./ui/PoetPanel";
import { SearchPanel } from "./ui/SearchPanel";
import { GiftRoam } from "./ui/GiftRoam";
import { SettingsMenu } from "./ui/SettingsMenu";
import { PoemHoverLabel } from "./ui/PoemHoverLabel";
import { Onboarding } from "./ui/Onboarding";
import { Cinema } from "./ui/Cinema";
import { FeedbackViewer } from "./ui/FeedbackViewer";
import { useStore } from "./state/store";
import { applyHash, syncHash } from "./state/permalink";
import { loadData } from "./data/load";
import { WEAK } from "./three/detectQuality";

// dpr is keyed to the INITIAL device seed, not the live 画质 toggle: dpr 1→2 quadruples the additive
// fragment work (the dominant cost), so weak/mobile GPUs cap at 1.5. It must NOT respond to the runtime
// toggle — changing a Canvas's dpr forces a GL context resize/flash. Bloom (below) toggles live; that's
// safe. gpuPick reads gl.getPixelRatio() at pick time, so a capped dpr never breaks picking.
const DPR_MAX = WEAK ? 1.5 : 2;

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const setLoaded = useStore((s) => s.setLoaded);
  const quality = useStore((s) => s.quality);
  const selected = useStore((s) => s.selected);
  const selectedPoet = useStore((s) => s.selectedPoet);
  const uiHidden = useStore((s) => s.uiHidden);
  const cinema = useStore((s) => s.cinema);
  // boot-data failure (network/CDN) — without this the user faces an eternal 正在点亮… spinner
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    loadData()
      .then(() => {
        setLoaded(true);
        applyHash(); // restore a shared #a=poet / #p=poem link
      })
      .catch((e) => {
        console.error("数据载入失败", e);
        setLoadError(true);
      });
  }, [setLoaded]);

  // H = hide / show ALL overlay UI (screenshot mode). Ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement;
      if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
      if (e.code === "KeyH") {
        e.preventDefault();
        useStore.getState().toggleUI();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // keep the address bar shareable as the selection changes
  useEffect(() => {
    if (loaded) syncHash();
  }, [loaded, selected, selectedPoet]);

  return (
    <div className="app">
      <Canvas
        camera={{ position: [700, 4600, 4600], fov: 55, near: 0.1, far: 18000 }}
        dpr={[1, DPR_MAX]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <color attach="background" args={["#03040a"]} />
        <fog attach="fog" args={["#03040a", 2400, 13000]} />
        <Galaxy />
        {loaded && <PoetStars />}
        {loaded && <PoemOrbits />}
        {loaded && <PoemGuides />}
        {loaded && <GiftLines />}
        {loaded && <GiftTrail />}
        <PulledStars />
        <FlyControls />
        {/* HDR additive bloom — turns discrete bright particles into continuous nebulosity and
            makes the core glow fade smoothly (the single biggest "real galaxy" cue). Disabled on
            low quality (it's the heaviest pass) for weak GPUs. */}
        {quality === "high" && (
          <EffectComposer>
            <Bloom
              intensity={1.4}
              luminanceThreshold={0.1}
              luminanceSmoothing={0.28}
              radius={0.85}
              mipmapBlur
            />
          </EffectComposer>
        )}
      </Canvas>

      {!uiHidden && !cinema && (
        <>
          <HUD />
          <SettingsMenu />
          {loaded && <SearchPanel />}
          {loaded && <GiftRoam />}
          {loaded && <PoemHoverLabel />}
          <PoemPanel />
          <PoetPanel />
        </>
      )}

      {/* 奇迹时刻: framed share card over the frozen scene (hides the normal UI; keeps camera composable) */}
      {cinema && <Cinema />}

      {/* owner-only feedback inbox (opened by the hidden 5-tap-on-logo gesture); self-gates on the store */}
      <FeedbackViewer />

      {loaded && <Onboarding />}

      {!loaded && (
        <div className="loading-screen">
          <div className="ls-title">诗云</div>
          {loadError ? (
            <>
              <div className="ls-sub">星图数据载入失败 —— 可能是网络波动。</div>
              <button className="retry-btn big" onClick={() => location.reload()}>重新载入</button>
            </>
          ) : (
            <div className="ls-sub">正在点亮 32,657 位诗人…</div>
          )}
        </div>
      )}
    </div>
  );
}
