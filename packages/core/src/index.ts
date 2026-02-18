// Types
export type { ProjectData, District, Bounds, CityState, BlockPosition, HypervaultSettings, WeatherData } from './types';
export { DEFAULT_SETTINGS } from './types';

// Scene engine
export { SceneManager } from './scene/SceneManager';

// Layout
export { BinPacker } from './layout/BinPacker';
export { CityLayoutEngine } from './layout/CityLayoutEngine';

// Renderers
export { BuildingShader } from './renderers/BuildingShader';
export { GeometryFactory } from './renderers/GeometryFactory';
export { VisualEncoder } from './renderers/VisualEncoder';

// Interactions
export { BuildingRaycaster } from './interactions/Raycaster';
export type { RaycastHit } from './interactions/Raycaster';
export { KeyboardNav } from './interactions/KeyboardNav';

// Visuals
export { NeuralCore } from './visuals/NeuralCore';
export { DataArtery } from './visuals/DataArtery';
export { ArteryManager } from './visuals/ArteryManager';

// Filters
export { FacetFilter } from './filters/FacetFilter';
export { QueryEngine } from './filters/QueryEngine';

// Effects
export { DecayEffect } from './effects/DecayEffect';
export { GlowManager } from './effects/GlowManager';

// Store
export { createProjectStore } from './stores/projectStore';
export type { ProjectState } from './stores/projectStore';
