import React, { useState, useEffect, useCallback } from 'react';
import { marked } from 'marked';
import type { ProjectData } from '@hypervault/core';

interface ProjectSidebarProps {
  project: ProjectData;
  onClose: () => void;
  onOpenEditor: () => void;
}

function stripFrontmatter(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? raw.slice(match[0].length).trim() : raw;
}

function statusColor(status: string): string {
  switch (status) {
    case 'active': return '#00cc66';
    case 'blocked': return '#cc3333';
    case 'paused': return '#3366cc';
    case 'complete': return '#9966cc';
    default: return '#888888';
  }
}

function priorityLabel(priority: string): string {
  switch (priority) {
    case 'critical': return 'CRITICAL';
    case 'high': return 'HIGH';
    case 'medium': return 'MED';
    case 'low': return 'LOW';
    default: return priority?.toUpperCase() ?? '';
  }
}

export function ProjectSidebar({ project, onClose, onOpenEditor }: ProjectSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mdHtml, setMdHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileError, setFileError] = useState(false);

  // Load and render the .md file
  useEffect(() => {
    setLoading(true);
    setMdHtml(null);
    setFileError(false);

    const filePath = project.path;
    if (!filePath || !filePath.endsWith('.md')) {
      setLoading(false);
      setFileError(true);
      return;
    }

    window.hypervault.readFile(filePath).then((result) => {
      if (!result.ok || !result.content) {
        setFileError(true);
        setLoading(false);
        return;
      }

      const body = stripFrontmatter(result.content);
      const html = marked.parse(body) as string;
      setMdHtml(html);
      setLoading(false);
    });
  }, [project.path]);

  // Escape key closes sidebar
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const toggleCollapse = useCallback(() => setCollapsed(c => !c), []);

  // Collapsed state — thin bar
  if (collapsed) {
    return (
      <div className="project-sidebar collapsed" onClick={toggleCollapse}>
        <div className="project-sidebar-collapsed-title">{project.title}</div>
        <div className="project-sidebar-expand-arrow">&#9664;</div>
      </div>
    );
  }

  const hasTasks = project.totalTasks != null && project.totalTasks > 0;
  const taskPct = hasTasks
    ? Math.round(((project.completedTasks ?? 0) / project.totalTasks!) * 100)
    : null;

  return (
    <div className="project-sidebar">
      {/* Header */}
      <div className="project-sidebar-header">
        <button className="project-sidebar-collapse-btn" onClick={toggleCollapse} title="Collapse">
          &#9654;
        </button>
        <div className="project-sidebar-title">{project.title}</div>
        <button className="project-sidebar-close" onClick={onClose} title="Close">&times;</button>
      </div>

      {/* Metadata Banner */}
      <div className="project-sidebar-meta">
        <div className="project-sidebar-badges">
          <span
            className="project-sidebar-badge"
            style={{ background: statusColor(project.status), color: '#fff' }}
          >
            {project.status?.toUpperCase()}
          </span>
          {project.priority && (
            <span className="project-sidebar-badge priority">
              {priorityLabel(project.priority)}
            </span>
          )}
          {project.category && (
            <span className="project-sidebar-badge category">
              {project.category}
            </span>
          )}
        </div>

        {/* Health bar */}
        {project.health != null && (
          <div className="project-sidebar-health">
            <span className="project-sidebar-health-label">Health</span>
            <div className="project-sidebar-health-track">
              <div
                className="project-sidebar-health-fill"
                style={{ width: `${project.health}%` }}
              />
            </div>
            <span className="project-sidebar-health-value">{project.health}%</span>
          </div>
        )}

        {/* Tasks progress */}
        {hasTasks && (
          <div className="project-sidebar-tasks">
            <span className="project-sidebar-tasks-label">Tasks</span>
            <span className="project-sidebar-tasks-value">
              {project.completedTasks ?? 0}/{project.totalTasks} ({taskPct}%)
            </span>
          </div>
        )}

        {/* Stack tags */}
        {project.stack && project.stack.length > 0 && (
          <div className="project-sidebar-stack">
            {project.stack.map((tech) => (
              <span key={tech} className="project-sidebar-stack-tag">{tech}</span>
            ))}
          </div>
        )}
      </div>

      {/* Markdown Body */}
      <div className="project-sidebar-body">
        {loading && (
          <div className="project-sidebar-loading">Loading...</div>
        )}
        {fileError && !loading && (
          <div className="project-sidebar-no-file">
            No project note found.
          </div>
        )}
        {mdHtml && !loading && (
          <div
            className="project-sidebar-markdown"
            dangerouslySetInnerHTML={{ __html: mdHtml }}
          />
        )}
      </div>

      {/* Action Bar */}
      <div className="project-sidebar-actions">
        <button className="project-sidebar-editor-btn" onClick={onOpenEditor}>
          Open Editor
        </button>
      </div>
    </div>
  );
}
