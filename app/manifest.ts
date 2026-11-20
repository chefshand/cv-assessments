import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CV Assessments",
    short_name: "CV A&P",
    description: "Guideline-based cardiology clinic decision support with copy-ready Assessment & Plan.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Hypertension", url: "/m/htn" },
      { name: "Heart failure", url: "/m/hf" },
      { name: "Atrial fibrillation", url: "/m/af" },
      { name: "Billing check", url: "/billing" },
    ],
  };
}
