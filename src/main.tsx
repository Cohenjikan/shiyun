import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// set by the index.html capability gate (no WebGL / no BigInt). A WebGL-less but otherwise-modern
// browser still parses this bundle — mounting React would wipe the gate's message and black-screen.
declare global {
  interface Window {
    __SHIYUN_UNSUPPORTED__?: boolean;
  }
}

if (!window.__SHIYUN_UNSUPPORTED__) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
