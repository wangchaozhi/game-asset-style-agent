// Shared mutable UI state.

export const state = {
  config: null,
  project: null,
  selectedTypes: new Set(),
  filter: "all",
  /** asset library: type filter ("" = all) and free-text query */
  typeFilter: "",
  query: "",
  job: null,
  source: null,
  textEntry: null,
  /** asset library selection mode */
  selecting: false,
  selected: new Set(),
  lastSelected: null,
  /** id of the asset open in the viewer */
  viewing: null,
  /** the attached job's tally: { projectId, known: Set<assetId>, made, error } */
  run: null,
};

export const fileUrl = (rel) => `/api/projects/${state.project.id}/files/${rel}`;

/** Cached WebP thumbnail (160 / 320 / 640 px). */
export const thumbUrl = (rel, w = 320) => `/api/projects/${state.project.id}/thumbs/${rel}?w=${w}`;
