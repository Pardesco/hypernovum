// Version tracking — 'dev' in source; the build script stamps dist with
// `<pkg version>+<git short hash>.<date>` so the artifact can't drift silently.
export const CORE_BUILD_VERSION = 'dev';

// Types
export type { ProjectData, District, Bounds, CityState, BlockPosition, HypernovumSettings, WeatherData, LinkEdge, RecentCommit, GraphEdge, EdgeType } from './types';
export { EdgeManager } from './scene/EdgeManager';
export { collectImpact } from './graph/traverse';
export type { TraceImpactResult, TraceNode, TraceOptions } from './graph/traverse';
export { DEFAULT_SETTINGS, STATUS_COLORS, STATUS_COLOR_DEFAULT, statusColor } from './types';

// Scene engine
export { SceneManager } from './scene/SceneManager';
export { HighlightManager } from './scene/HighlightManager';
export type { BuildingParts } from './scene/HighlightManager';
export { resolveVisualState } from './scene/visualState';
export type { VisualState, ResolveInput, LabelTier } from './scene/visualState';
export { loftTower, loftTowerCached, clearLoftCache, loftVertexCount } from './renderers/TowerLoft';
export type { TowerLoftParams, TowerProfile } from './renderers/TowerLoft';
export { presetForProject, isParametricCategory } from './renderers/TowerPresets';
export type { TowerBuildInput, TowerBuildResult } from './renderers/TowerPresets';
export { orbVisualForState, stateTintsHost, ORB_COLORS } from './scene/agentOrbVisual';
export type { OrbVisual } from './scene/agentOrbVisual';
export type { AgentOrbInput } from './scene/SceneManager';

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
export { createInteractionStore } from './stores/interactionStore';
export type { InteractionState, InteractionStore, TraceImpactState } from './stores/interactionStore';
/** @deprecated see stores/projectStore.ts */
export { createProjectStore } from './stores/projectStore';
export type { ProjectState } from './stores/projectStore';

// Utils
export { debugLog, refreshDebugFlag } from './utils/log';
export { escapeHtml } from './utils/html';
