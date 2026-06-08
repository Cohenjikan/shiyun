import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { Galaxy } from "./three/Galaxy";
import { PoetStars } from "./three/PoetStars";
import { GiftLines } from "./three/GiftLines";
import { PulledStars } from "./three/PulledStars";
import { FlyControls } from "./three/FlyControls";
import { HUD } from "./ui/HUD";
import { PoemPanel } from "./ui/PoemPanel";
import { PoetPanel } from "./ui/PoetPanel";
import { SearchPanel } from "./ui/SearchPanel";
import { DynastyLegend } from "./ui/DynastyLegend";
import { useStore } from "./state/store";
import { applyHash, syncHash } from "./state/permalink";
import { loadData } from "./data/load";

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const setLoaded = useStore((s) => s.setLoaded);
  const quality = useStore((s) => s.quality);
  const selected = useStore((s) => s.selected);
  const selectedPoet = useStore((s) => s.selectedPoet);

  useEffect(() => {
    loadData()
      .then(() => {
        setLoaded(true);
        applyHash(); // restore a shared #a=poet / #p=poem link
      })
      .catch((e) => console.error("数据载入失败", e));
  }, [setLoaded]);

  // keep the address bar shareable as the selection changes
  useEffect(() => {
    if (loaded) syncHash();
  }, [loaded, selected, selectedPoet]);

  return (
    <div className="app">
      <Canvas
        camera={{ position: [700, 4600, 4600], fov: 55, near: 0.1, far: 18000 }}
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: "high-performance" }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <color attach="background" args={["#03040a"]} />
        <fog attach="fog" args={["#03040a", 2400, 13000]} />
        <Galaxy />
        {loaded && <PoetStars />}
        {loaded && <GiftLines />}
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

      <div className="crosshair" />
      <HUD />
      {loaded && <SearchPanel />}
      {loaded && <DynastyLegend />}
      <PoemPanel />
      <PoetPanel />

      {!loaded && (
        <div className="loading-screen">
          <div className="ls-title">诗云</div>
          <div className="ls-sub">正在点亮 29,300 位诗人…</div>
        </div>
      )}
    </div>
  );
}
