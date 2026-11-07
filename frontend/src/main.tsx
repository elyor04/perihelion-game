import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/cormorant/wght.css";
import "@fontsource-variable/cormorant/wght-italic.css";
import "@fontsource-variable/commissioner/wght.css";
import "./styles.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
