import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Acme } from "./Acme.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Acme />
  </StrictMode>,
);
