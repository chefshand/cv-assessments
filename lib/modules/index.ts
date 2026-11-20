import type { ClinicalModule } from "../types";
import { cacModule } from "./cac";
import { aortaModule } from "./aorta";
import { ascvdModule } from "./ascvd";
import { paModule } from "./pa";
import { periopModule } from "./periop";
import { htnModule } from "./htn";
import { hfModule } from "./hf";
import { hcmModule } from "./hcm";
import { attrModule } from "./attr";
import { valveModule } from "./valve";
import { afModule } from "./af";
import { syncopeModule } from "./syncope";
import { chestPainModule } from "./chestpain";
import { cardioOncModule } from "./cardioonc";

export const MODULES: ClinicalModule[] = [
  htnModule, hfModule, afModule, valveModule, chestPainModule, ascvdModule, cacModule,
  hcmModule, attrModule, cardioOncModule, aortaModule, syncopeModule, paModule, periopModule,
];
export const getModule = (id: string) => MODULES.find((m) => m.id === id);
