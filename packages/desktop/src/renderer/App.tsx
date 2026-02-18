import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { SceneManager, BinPacker, BuildingRaycaster, KeyboardNav, DEFAULT_SETTINGS } from '@hypervault/core';
import type { ProjectData, WeatherData, BlockPosition } from '@hypervault/core';
import { HolodeckPanel } from './HolodeckPanel';
import { ProjectSidebar } from './ProjectSidebar';
import { AgentsPanel } from './AgentsPanel';
import type { Agent } from './agents';

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectData | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const activeAgentRef = useRef<Agent | null>(null);

  // Keep ref in sync for use in closures that capture stale state
  const handleActiveAgentChange = useCallback((agent: Agent | null) => {
    setActiveAgent(agent);
    activeAgentRef.current = agent;
  }, []);

  const handleTyping = useCallback(() => {
    if (selectedProject?.projectDir && sceneRef.current) {
      sceneRef.current.triggerLaunchEffect(selectedProject.projectDir);
    }
  }, [selectedProject]);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Create SceneManager with layout save callback
    const scene = new SceneManager(containerRef.current, {
      settings: { ...DEFAULT_SETTINGS, enableShaders: true, enableBloom: true },
      onSaveLayout: (positions: BlockPosition[]) => {
        window.hypervault.saveLayout(positions);
      },
    });
    sceneRef.current = scene;

    // 2. Set up raycaster for building clicks
    const raycaster = new BuildingRaycaster(
      scene.getCamera(),
      scene.getScene(),
      scene.getCanvas(),
    );
    raycaster.setClickHandler((hit) => {
      setSelectedProject(hit.project);
      setShowEditor(false);
    });

    // Right-click context menu on buildings
    raycaster.setRightClickHandler((hit, event) => {
      const project = hit.project;
      const agent = activeAgentRef.current;
      if (project.projectDir) {
        window.hypervault.showContextMenu({
          projectPath: project.projectDir,
          title: project.title,
          x: event.screenX,
          y: event.screenY,
          agentName: agent?.name,
          agentCommand: agent?.command,
        });
      }
    });

    // Right-click context menu on Neural Core orb
    raycaster.setOrbRightClickHandler((event) => {
      const agent = activeAgentRef.current;
      window.hypervault.showOrbMenu({
        x: event.screenX,
        y: event.screenY,
        agentCommand: agent?.command,
      });
    });

    // 3. Keyboard navigation
    const keyNav = new KeyboardNav(scene.getCanvas());
    keyNav.setHandlers({
      onResetCamera: () => scene.resetCamera(),
    });

    // 4. Listen for scan results from main process
    const packer = new BinPacker();
    window.hypervault.onScanComplete((projects: ProjectData[]) => {
      const districts = packer.packDistricts(projects);
      scene.buildCity(projects, districts);
    });

    // 5. Listen for weather updates
    window.hypervault.onWeatherUpdate((weather: WeatherData) => {
      scene.applyWeather(weather.projectPath, weather);
    });

    // 6. Signal to main process that renderer is ready for data
    window.hypervault.ready();

    return () => {
      keyNav.dispose();
      scene.dispose();
    };
  }, []);

  const handleSave = () => {
    sceneRef.current?.triggerSave();
  };

  const closeSidebar = () => {
    setSelectedProject(null);
    setShowEditor(false);
  };

  const openEditor = () => setShowEditor(true);

  return (
    <div
      ref={containerRef}
      className="hypervault-container"
      style={activeAgent ? { '--agent-accent': activeAgent.color } as React.CSSProperties : undefined}
    >
      {/* HUD Title */}
      <div className="hypervault-hud-title">
        HYPERVAULT<span className="hypervault-cursor">{'\u2588'}</span>
      </div>

      {/* Agents Panel */}
      <AgentsPanel
        selectedProject={selectedProject}
        activeAgent={activeAgent}
        onActiveAgentChange={handleActiveAgentChange}
      />

      {/* Save Layout Button */}
      <button className="hypervault-save-btn" onClick={handleSave}>
        Save Layout
      </button>

      {/* Legend (collapsed by default) */}
      {showLegend ? (
        <div className="hypervault-legend">
          <div className="hypervault-legend-header">
            <span>LEGEND</span>
            <button className="hypervault-legend-toggle" onClick={() => setShowLegend(false)}>&times;</button>
          </div>
          <div className="hypervault-legend-section">
            <h4>Status (Color)</h4>
            <div className="hypervault-legend-item">
              <div className="hypervault-legend-color active"></div>
              <span>Active</span>
            </div>
            <div className="hypervault-legend-item">
              <div className="hypervault-legend-color blocked"></div>
              <span>Blocked</span>
            </div>
            <div className="hypervault-legend-item">
              <div className="hypervault-legend-color paused"></div>
              <span>Paused</span>
            </div>
            <div className="hypervault-legend-item">
              <div className="hypervault-legend-color complete"></div>
              <span>Complete</span>
            </div>
          </div>
          <div className="hypervault-legend-section">
            <h4>Priority (Height)</h4>
            <div className="hypervault-legend-item">
              <div className="hypervault-legend-height">
                <div className="hypervault-legend-bar" style={{ height: '16px' }}></div>
              </div>
              <span>Critical</span>
            </div>
            <div className="hypervault-legend-item">
              <div className="hypervault-legend-height">
                <div className="hypervault-legend-bar" style={{ height: '10px' }}></div>
              </div>
              <span>High</span>
            </div>
            <div className="hypervault-legend-item">
              <div className="hypervault-legend-height">
                <div className="hypervault-legend-bar" style={{ height: '6px' }}></div>
              </div>
              <span>Medium</span>
            </div>
            <div className="hypervault-legend-item">
              <div className="hypervault-legend-height">
                <div className="hypervault-legend-bar" style={{ height: '3px' }}></div>
              </div>
              <span>Low</span>
            </div>
          </div>
        </div>
      ) : (
        <button className="hypervault-legend-pill" onClick={() => setShowLegend(true)} title="Show Legend">
          ?
        </button>
      )}

      {/* Controls Hint */}
      <div className="hypervault-controls">
        <kbd>Click</kbd> Open project<br />
        <kbd>Right-click</kbd> Menu<br />
        <kbd>Right-drag</kbd> Pan<br />
        <kbd>Scroll</kbd> Zoom<br />
        <kbd>Esc</kbd> Close panel
      </div>

      {/* Project Sidebar (.md viewer) */}
      {selectedProject && !showEditor && (
        <ProjectSidebar
          project={selectedProject}
          onClose={closeSidebar}
          onOpenEditor={openEditor}
        />
      )}

      {/* Holodeck Editor Panel (advanced) */}
      {selectedProject && showEditor && (
        <HolodeckPanel
          projectDir={selectedProject.projectDir ?? null}
          projectTitle={selectedProject.title}
          onClose={closeSidebar}
          onTyping={handleTyping}
        />
      )}
    </div>
  );
}
