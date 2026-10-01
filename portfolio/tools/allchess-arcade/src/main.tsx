import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/styles/globals.css";
import "@/styles/studio.css";
import "@/styles/discovery.css";
import "@/styles/minimal.css";
import "@/styles/pages-play.css";
import "./arcade.css";
import { ArcadeApp } from "./arcade-app";

createRoot(document.getElementById("root")!).render(<StrictMode><ArcadeApp /></StrictMode>);
