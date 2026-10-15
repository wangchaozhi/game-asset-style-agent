// Shared mutable UI state.

export const state = {
  config: null,
  project: null,
  selectedTypes: new Set(),
  filter: "all",
  job: null,
  source: null,
  textEntry: null,
  /** asset library selection mode */
  selecting: false,
  selected: new Set(),
  lastSelected: null,
};

export const fileUrl = (rel) => `/api/projects/${state.project.id}/files/${rel}`;
