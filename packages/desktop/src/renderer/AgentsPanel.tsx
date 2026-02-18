import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectData } from '@hypervault/core';
import { KNOWN_AGENTS, DEFAULT_AGENTS_CONFIG } from './agents';
import type { Agent, AgentsConfig } from './agents';

const COLOR_PRESETS = ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#ff922b', '#cc5de8'];

interface AgentsPanelProps {
  selectedProject: ProjectData | null;
  activeAgent: Agent | null;
  onActiveAgentChange: (agent: Agent | null) => void;
}

/** Sort agents by saved order, with unordered agents appended at the end */
function sortByOrder(agents: Agent[], order: string[]): Agent[] {
  if (!order.length) return agents;
  const orderMap = new Map(order.map((id, i) => [id, i]));
  return [...agents].sort((a, b) => {
    const ai = orderMap.get(a.id) ?? Infinity;
    const bi = orderMap.get(b.id) ?? Infinity;
    return ai - bi;
  });
}

export function AgentsPanel({ selectedProject, activeAgent, onActiveAgentChange }: AgentsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showNotInstalled, setShowNotInstalled] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0]);
  const [config, setConfig] = useState<AgentsConfig>(DEFAULT_AGENTS_CONFIG);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Tandem two-step picker: pick agent 1, then agent 2, auto-launch
  const [tandemStep, setTandemStep] = useState<0 | 1 | 2>(0); // 0=hidden, 1=pick first, 2=pick second
  const [tandemLeft, setTandemLeft] = useState<Agent | null>(null);

  // Drag-to-reorder state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragCounter = useRef(0);

  // Initialize: load config + detect agents
  useEffect(() => {
    let mounted = true;

    async function init() {
      // Load saved config
      const savedConfig: AgentsConfig | null = await window.hypervault.loadAgentsConfig();
      const cfg = savedConfig || DEFAULT_AGENTS_CONFIG;
      // Backfill agentOrder for older configs
      if (!cfg.agentOrder) cfg.agentOrder = [];
      if (!mounted) return;
      setConfig(cfg);

      // Gather all commands to detect
      const allCommands = [
        ...KNOWN_AGENTS.map(a => a.command),
        ...(cfg.customAgents || []).map(a => a.command),
      ];

      const detected = await window.hypervault.detectAgents(allCommands);
      if (!mounted) return;

      // Build full agent list
      const builtins: Agent[] = KNOWN_AGENTS
        .filter(a => !(cfg.hiddenBuiltins || []).includes(a.id))
        .map(a => ({ ...a, detected: !!detected[a.command] }));

      const customs: Agent[] = (cfg.customAgents || []).map(a => ({
        ...a,
        detected: !!detected[a.command],
      }));

      const allAgents = [...builtins, ...customs];
      setAgents(allAgents);

      // Restore active agent
      if (cfg.activeAgentId) {
        const restored = allAgents.find(a => a.id === cfg.activeAgentId);
        if (restored) {
          onActiveAgentChange(restored);
        }
      }
    }

    init();
    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveConfig = useCallback((newConfig: AgentsConfig) => {
    setConfig(newConfig);
    window.hypervault.saveAgentsConfig(newConfig);
  }, []);

  const selectAgent = useCallback((agent: Agent) => {
    onActiveAgentChange(agent);
    const newConfig = { ...config, activeAgentId: agent.id };
    saveConfig(newConfig);
  }, [config, onActiveAgentChange, saveConfig]);

  const handleLaunch = useCallback(() => {
    if (!activeAgent || !selectedProject?.projectDir) return;
    window.hypervault.launchTerminal({
      projectPath: selectedProject.projectDir,
      command: activeAgent.command,
    });
  }, [activeAgent, selectedProject]);

  const launchTandem = useCallback((left: Agent, right: Agent) => {
    const projectPath = selectedProject?.projectDir || '.';
    window.hypervault.openTandem({
      projectPath,
      leftAgent: { name: left.name, command: left.command, color: left.color },
      rightAgent: { name: right.name, command: right.command, color: right.color },
    });
  }, [selectedProject]);

  const handleAddAgent = useCallback(() => {
    if (!newName.trim() || !newCommand.trim()) return;

    const id = 'custom-' + Date.now();
    const icon = newName.trim()[0].toUpperCase();
    const agent: Agent = {
      id,
      name: newName.trim(),
      command: newCommand.trim(),
      color: newColor,
      icon,
      builtin: false,
      detected: false, // will re-detect on next init
    };

    const newCustoms = [...(config.customAgents || []), agent];
    const newConfig = { ...config, customAgents: newCustoms };
    saveConfig(newConfig);
    setAgents(prev => [...prev, agent]);
    setNewName('');
    setNewCommand('');
    setNewColor(COLOR_PRESETS[0]);
    setShowAddForm(false);

    // Detect the new command
    window.hypervault.detectAgents([agent.command]).then(result => {
      if (result[agent.command]) {
        setAgents(prev => prev.map(a => a.id === id ? { ...a, detected: true } : a));
      }
    });
  }, [newName, newCommand, newColor, config, saveConfig]);

  const copyInstallHint = useCallback((agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!agent.installHint) return;
    window.hypervault.copyToClipboard(agent.installHint);
    setCopiedId(agent.id);
    setTimeout(() => setCopiedId(prev => prev === agent.id ? null : prev), 1500);
  }, []);

  const removeCustomAgent = useCallback((agentId: string) => {
    const newCustoms = (config.customAgents || []).filter(a => a.id !== agentId);
    const newOrder = (config.agentOrder || []).filter(id => id !== agentId);
    const newConfig = {
      ...config,
      customAgents: newCustoms,
      agentOrder: newOrder,
      activeAgentId: config.activeAgentId === agentId ? null : config.activeAgentId,
    };
    saveConfig(newConfig);
    setAgents(prev => prev.filter(a => a.id !== agentId));
    if (activeAgent?.id === agentId) {
      onActiveAgentChange(null);
    }
  }, [config, activeAgent, onActiveAgentChange, saveConfig]);

  // --- Drag-to-reorder handlers ---
  const handleDragStart = useCallback((e: React.DragEvent, agentId: string) => {
    setDragId(agentId);
    e.dataTransfer.effectAllowed = 'move';
    // Use a tiny transparent image so native drag preview doesn't clash
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, agentId: string) => {
    e.preventDefault();
    dragCounter.current++;
    setDragOverId(agentId);
  }, []);

  const handleDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOverId(null);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOverId(null);

    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }

    // Compute new order from the current detected agents
    const detectedAgents = sortByOrder(agents.filter(a => a.detected), config.agentOrder || []);
    const ids = detectedAgents.map(a => a.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) {
      setDragId(null);
      return;
    }

    // Reorder
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);

    const newConfig = { ...config, agentOrder: ids };
    saveConfig(newConfig);
    setDragId(null);
  }, [dragId, agents, config, saveConfig]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
    dragCounter.current = 0;
  }, []);

  // Get sorted detected agents
  const detectedAgents = sortByOrder(agents.filter(a => a.detected), config.agentOrder || []);
  const notDetectedAgents = agents.filter(a => !a.detected);

  // Collapsed state: show active agent icon pill
  if (collapsed) {
    return (
      <div
        className="agents-panel agents-panel-collapsed"
        onClick={() => setCollapsed(false)}
        style={activeAgent ? {
          borderColor: activeAgent.color + '60',
          boxShadow: `0 0 12px ${activeAgent.color}30`,
        } : undefined}
      >
        {activeAgent ? (
          <div
            className="agents-icon-circle"
            style={{ background: activeAgent.color }}
          >
            {activeAgent.icon}
          </div>
        ) : (
          <div className="agents-icon-circle agents-icon-empty">?</div>
        )}
      </div>
    );
  }

  return (
    <div className="agents-panel agents-panel-expanded">
      {/* Header */}
      <div className="agents-header">
        <span className="agents-title">AGENTS</span>
        <button
          className="agents-collapse-btn"
          onClick={() => setCollapsed(true)}
          title="Collapse"
        >
          &#x25C0;
        </button>
      </div>

      {/* Installed Agents (draggable) */}
      <div className="agents-list">
        {detectedAgents.map(agent => (
          <div
            key={agent.id}
            className={
              `agents-item${activeAgent?.id === agent.id ? ' active' : ''}` +
              `${dragId === agent.id ? ' agents-dragging' : ''}` +
              `${dragOverId === agent.id && dragId !== agent.id ? ' agents-drag-over' : ''}`
            }
            onClick={() => selectAgent(agent)}
            style={activeAgent?.id === agent.id ? { borderLeftColor: agent.color } : undefined}
            draggable
            onDragStart={(e) => handleDragStart(e, agent.id)}
            onDragEnter={(e) => handleDragEnter(e, agent.id)}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, agent.id)}
            onDragEnd={handleDragEnd}
          >
            <div className="agents-drag-handle" title="Drag to reorder">&#x2630;</div>
            <div
              className="agents-icon-circle"
              style={{ background: agent.color }}
            >
              {agent.icon}
            </div>
            <span className="agents-item-name">{agent.name}</span>
            {!agent.builtin && (
              <button
                className="agents-remove-btn"
                onClick={(e) => { e.stopPropagation(); removeCustomAgent(agent.id); }}
                title="Remove"
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Not Installed (collapsible) */}
      {notDetectedAgents.length > 0 && (
        <div className="agents-not-installed">
          <button
            className="agents-not-installed-toggle"
            onClick={() => setShowNotInstalled(!showNotInstalled)}
          >
            <span className="agents-not-installed-chevron">{showNotInstalled ? '\u25BE' : '\u25B8'}</span>
            Not Installed ({notDetectedAgents.length})
          </button>
          {showNotInstalled && (
            <div className="agents-not-installed-list">
              {notDetectedAgents.map(agent => (
                <div key={agent.id} className="agents-uninstalled-entry">
                  <div className="agents-item not-detected">
                    <div
                      className="agents-icon-circle"
                      style={{ background: 'rgba(80,80,100,0.4)' }}
                    >
                      {agent.icon}
                    </div>
                    <span className="agents-item-name">{agent.name}</span>
                    {!agent.builtin && (
                      <button
                        className="agents-remove-btn"
                        onClick={(e) => { e.stopPropagation(); removeCustomAgent(agent.id); }}
                        title="Remove"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                  {agent.installHint && (
                    <div className="agents-install-row">
                      <code className="agents-install-cmd">{agent.installHint}</code>
                      <button
                        className="agents-copy-btn"
                        onClick={(e) => copyInstallHint(agent, e)}
                        title="Copy to clipboard"
                      >
                        {copiedId === agent.id ? '\u2713' : '\u2398'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add Agent Form */}
      {showAddForm ? (
        <div className="agents-add-form">
          <input
            className="agents-input"
            type="text"
            placeholder="Name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            maxLength={24}
          />
          <input
            className="agents-input"
            type="text"
            placeholder="Command"
            value={newCommand}
            onChange={e => setNewCommand(e.target.value)}
            maxLength={32}
          />
          <div className="agents-color-row">
            {COLOR_PRESETS.map(c => (
              <button
                key={c}
                className={`agents-color-swatch ${newColor === c ? 'selected' : ''}`}
                style={{ background: c }}
                onClick={() => setNewColor(c)}
              />
            ))}
          </div>
          <div className="agents-add-actions">
            <button className="agents-btn agents-btn-confirm" onClick={handleAddAgent}>Add</button>
            <button className="agents-btn agents-btn-cancel" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="agents-add-btn" onClick={() => setShowAddForm(true)}>
          + Add Agent
        </button>
      )}

      {/* Launch Button */}
      {activeAgent && (
        <button
          className="agents-launch-btn"
          onClick={handleLaunch}
          disabled={!selectedProject?.projectDir}
          style={{
            background: selectedProject?.projectDir
              ? `linear-gradient(135deg, ${activeAgent.color}cc, ${activeAgent.color}88)`
              : undefined,
          }}
          title={selectedProject?.projectDir ? `Launch ${activeAgent.name} in ${selectedProject.title}` : 'Select a project first'}
        >
          Launch {activeAgent.name}
        </button>
      )}

      {/* Tandem Terminal — two-click agent picker */}
      <div className="agents-tandem-section">
        {tandemStep === 0 && (
          <button
            className="agents-tandem-btn"
            onClick={() => { setTandemLeft(null); setTandemStep(1); }}
            disabled={detectedAgents.filter(a => a.terminalBased !== false).length < 2}
            title="Open two CLI agents side-by-side in a split terminal"
          >
            Tandem Terminal
          </button>
        )}

        {tandemStep === 1 && (
          <div className="agents-tandem-picker">
            <div className="agents-tandem-label">Select Agent 1:</div>
            {detectedAgents.map(agent => {
              const isCli = agent.terminalBased !== false;
              return (
                <div
                  key={agent.id}
                  className={`agents-item agents-tandem-option${!isCli ? ' not-detected' : ''}`}
                  onClick={() => {
                    if (!isCli) return;
                    setTandemLeft(agent);
                    setTandemStep(2);
                  }}
                  style={!isCli ? { cursor: 'not-allowed' } : undefined}
                  title={!isCli ? `${agent.name} is not a terminal-based agent` : undefined}
                >
                  <div className="agents-icon-circle" style={{ background: isCli ? agent.color : 'rgba(80,80,100,0.4)' }}>
                    {agent.icon}
                  </div>
                  <span className="agents-item-name">{agent.name}</span>
                  {!isCli && <span className="agents-tandem-tag">GUI</span>}
                </div>
              );
            })}
            <button
              className="agents-btn agents-btn-cancel"
              style={{ marginTop: '4px' }}
              onClick={() => setTandemStep(0)}
            >
              Cancel
            </button>
          </div>
        )}

        {tandemStep === 2 && tandemLeft && (
          <div className="agents-tandem-picker">
            <div className="agents-tandem-label">
              <span className="agents-tandem-selected" style={{ color: tandemLeft.color }}>{tandemLeft.name}</span>
              {' + '}Select Agent 2:
            </div>
            {detectedAgents.map(agent => {
              const isCli = agent.terminalBased !== false;
              const isSame = agent.id === tandemLeft.id;
              const disabled = !isCli || isSame;
              return (
                <div
                  key={agent.id}
                  className={`agents-item agents-tandem-option${disabled ? ' not-detected' : ''}`}
                  onClick={() => {
                    if (disabled) return;
                    launchTandem(tandemLeft, agent);
                    setTandemStep(0);
                  }}
                  style={disabled ? { cursor: 'not-allowed' } : undefined}
                  title={isSame ? 'Already selected as Agent 1' : !isCli ? `${agent.name} is not a terminal-based agent` : undefined}
                >
                  <div className="agents-icon-circle" style={{ background: disabled ? 'rgba(80,80,100,0.4)' : agent.color }}>
                    {agent.icon}
                  </div>
                  <span className="agents-item-name">{agent.name}</span>
                  {!isCli && <span className="agents-tandem-tag">GUI</span>}
                </div>
              );
            })}
            <button
              className="agents-btn agents-btn-cancel"
              style={{ marginTop: '4px' }}
              onClick={() => setTandemStep(1)}
            >
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
