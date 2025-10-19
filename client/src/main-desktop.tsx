import React from "react";
import ReactDOM from "react-dom/client";
import { DesktopApp } from "./desktop/DesktopApp";
import App from "./App";
import "./index.css";
import "./i18n";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DesktopApp WebApp={App} />
  </React.StrictMode>,
);
