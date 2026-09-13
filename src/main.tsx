import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/rajdhani/latin-400.css";
import "@fontsource/rajdhani/latin-500.css";
import "@fontsource/rajdhani/latin-600.css";
import "@fontsource/rajdhani/latin-700.css";
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "./styles/tokens.css";
import App from "./App";
import { LiveDataSource } from "./data/LiveDataSource";

const requestedSource = new URLSearchParams(window.location.search).get(
  "source",
);
const live =
  requestedSource === "live" ||
  (requestedSource !== "demo" && import.meta.env.VITE_DATA_MODE === "live");
const source = live ? new LiveDataSource() : undefined;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App source={source} />
  </React.StrictMode>,
);
