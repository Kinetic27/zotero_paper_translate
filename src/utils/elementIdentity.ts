import { config, version } from "../../package.json";

// Custom-element definitions cannot be replaced during an in-process addon
// update. Each build must mount its own constructors instead of reusing old UI.
export const elementPrefix = `${config.addonRef.toLowerCase()}-${version.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
