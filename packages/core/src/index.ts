// Version tracking — 'dev' in source; the build script stamps dist with
// `<pkg version>+<git short hash>.<date>` so the artifact can't drift silently.
export const CORE_BUILD_VERSION = 'dev';

// Types
export type { ProjectData, District, Bounds, CityState, BlockPosition, HypernovumSettings, WeatherData, RecentCommit, GraphEdge, EdgeType } from './types';
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
export { loftTower, loftTowerCached, clearLoftCache, loftVertexCount, loftRoofDeckY } from './renderers/TowerLoft';
export { loftStack, loftStackCached, clearStackCache, stackVertexCount, stackFloors, stackRoofDeckY } from './renderers/TowerLoft';
export type { TowerSegment, TowerStackParams } from './renderers/TowerLoft';
export type { TowerLoftParams, TowerProfile } from './renderers/TowerLoft';
export { presetForProject } from './renderers/TowerPresets';
export type { TowerBuildInput, TowerBuildResult } from './renderers/TowerPresets';
export { orbVisualForState, stateTintsHost, ORB_COLORS } from './scene/agentOrbVisual';
export type { OrbVisual } from './scene/agentOrbVisual';
export type { AgentOrbInput } from './scene/SceneManager';

// Layout
export { BinPacker } from './layout/BinPacker';

// Renderers
export { BuildingShader } from './renderers/BuildingShader';
export { GeometryFactory } from './renderers/GeometryFactory';

// Interactions
export { BuildingRaycaster } from './interactions/Raycaster';
export type { RaycastHit } from './interactions/Raycaster';
export { isSceneVisible } from './interactions/visibility';
export { KeyboardNav } from './interactions/KeyboardNav';

// Visuals
export { NeuralCore } from './visuals/NeuralCore';
export { DataArtery } from './visuals/DataArtery';
export { ArteryManager } from './visuals/ArteryManager';

// Store
export { createInteractionStore } from './stores/interactionStore';
export type { InteractionState, InteractionStore, TraceImpactState } from './stores/interactionStore';

// Utils
export { debugLog } from './utils/log';
