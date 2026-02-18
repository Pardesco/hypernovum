import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { ProjectData } from '../types';

/**
 * Manages CSS2D labels and hover tooltips for buildings.
 * Renders crisp, theme-integrated HTML labels that track 3D positions.
 */
export class TooltipManager {
  private labelRenderer: CSS2DRenderer;
  private labels = new Map<string, CSS2DObject>();
  private activeTooltip: CSS2DObject | null = null;
  private scene: THREE.Scene;

  constructor(container: HTMLElement, scene: THREE.Scene) {
    this.scene = scene;
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);
  }

  createLabel(project: ProjectData, position: THREE.Vector3): CSS2DObject {
    const div = document.createElement('div');
    div.className = 'hypervault-label';
    div.textContent = project.title;

    const label = new CSS2DObject(div);
    label.position.copy(position);
    label.position.y += 2;

    this.labels.set(project.path, label);
    return label;
  }

  showTooltip(project: ProjectData, buildingPosition: THREE.Vector3, buildingHeight: number): void {
    this.hideTooltip();

    const div = document.createElement('div');
    div.className = 'hypervault-tooltip';
    div.innerHTML = `
      <strong>${this.escapeHtml(project.title)}</strong>
      <div>Status: ${this.escapeHtml(project.status)}</div>
      <div>Priority: ${this.escapeHtml(project.priority)}</div>
      <div>Health: ${project.health}%</div>
      <div>Last modified: ${this.formatDate(project.lastModified)}</div>
      <div>Scope: ${project.noteCount} notes</div>
    `;

    const tooltip = new CSS2DObject(div);
    tooltip.position.copy(buildingPosition);
    tooltip.position.y = buildingHeight + 2;

    this.activeTooltip = tooltip;
    this.scene.add(tooltip);
  }

  hideTooltip(): void {
    if (this.activeTooltip) {
      this.scene.remove(this.activeTooltip);
      this.activeTooltip = null;
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.labelRenderer.render(scene, camera);
  }

  resize(width: number, height: number): void {
    this.labelRenderer.setSize(width, height);
  }

  private formatDate(timestamp: number): string {
    const d = new Date(timestamp);
    return d.toLocaleDateString();
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
