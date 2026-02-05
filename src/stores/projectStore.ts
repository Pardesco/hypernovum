import { createStore } from 'zustand/vanilla';
import type { ProjectData, District } from '../types';

export interface ProjectState {
  projects: ProjectData[];
  districts: Map<string, District>;
  selectedProject: ProjectData | null;
  filterStatus: string | null;
  filterCategory: string | null;

  setProjects: (projects: ProjectData[]) => void;
  setDistricts: (districts: Map<string, District>) => void;
  selectProject: (project: ProjectData | null) => void;
  setFilterStatus: (status: string | null) => void;
  setFilterCategory: (category: string | null) => void;
}

export const createProjectStore = () =>
  createStore<ProjectState>((set) => ({
    projects: [],
    districts: new Map(),
    selectedProject: null,
    filterStatus: null,
    filterCategory: null,

    setProjects: (projects) => set({ projects }),
    setDistricts: (districts) => set({ districts }),
    selectProject: (project) => set({ selectedProject: project }),
    setFilterStatus: (status) => set({ filterStatus: status }),
    setFilterCategory: (category) => set({ filterCategory: category }),
  }));
