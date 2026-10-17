// Stage mode shows only the game, for screen recordings. The app owns it, the player bar toggles it.
import { createContext } from "react";

export const StageContext = createContext<{ stage: boolean; toggle: () => void }>({ stage: false, toggle: () => {} });
