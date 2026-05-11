import React from "react";
import ReactDOM from "react-dom/client";
import "@git-diff-view/react/styles/diff-view.css";
import "./styles.css";
import "./components/PreviewModalShell.css";
import "./components/MarkdownRenderer.css";
import "./components/CopyableCodeBlock.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
