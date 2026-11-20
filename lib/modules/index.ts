import type { ClinicalModule } from "../types";
import { cacModule } from "./cac";
import { aortaModule } from "./aorta";
import { ascvdModule } from "./ascvd";
import { paModule } from "./pa";
import { periopModule } from "./periop";

export const MODULES: ClinicalModule[] = [cacModule, aortaModule, ascvdModule, paModule, periopModule];
export const getModule = (id: string) => MODULES.find((m) => m.id === id);
