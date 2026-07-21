export type Severity = "needs-human" | "standard" | "noise";
export type ChapterStatus = "pending" | "done" | "recheck";
export type ReviewStepStatus = "pending" | "reviewed" | "recheck";
export type ReviewEvidenceKind = "changed" | "imports" | "imported-by" | "entry-point" | "risk";

export interface ReviewEvidence {
  kind: ReviewEvidenceKind;
  description: string;
  relatedFile?: string;
}

export interface ReviewStep {
  fileId: string;
  order: number;
  reason: string;
  evidence: ReviewEvidence[];
  patch?: string;
  status: ReviewStepStatus;
}

export interface ReviewChapter {
  id: string;
  title: string;
  summary: string;
  entryPoint: string;
  fileIds: string[];
  status: ChapterStatus;
  steps?: ReviewStep[];
}

export interface ReviewFile {
  id: string;
  path: string;
  chapterId: string;
  severity: Severity;
  noiseReason: "snapshot" | "lockfile" | "generated" | "rename" | null;
  summary: string;
}

export interface ReviewGraphNode {
  id: string;
  label: string;
  architectureSection?: RepositoryArchitectureSection;
  chapterId: string;
  severity: Severity;
  fileIds: string[];
  changed: boolean;
}

export interface ReviewGraphEdge {
  source: string;
  target: string;
  kind: "imports";
}

export type RepositoryGraphLevel = "repository" | "area" | "module" | "file";
export type RepositoryArchitectureSection =
  | "UI"
  | "Application state"
  | "Data access / API"
  | "Database"
  | "Shared infrastructure"
  | "Tooling";

export interface RepositoryGraphNode {
  id: string;
  label: string;
  level: RepositoryGraphLevel;
  parentId?: string;
  architectureSection?: RepositoryArchitectureSection;
  path?: string;
  changed: boolean;
}

export interface RepositoryGraphEdge {
  source: string;
  target: string;
  kind: "imports";
}

export type RepositoryGraph =
  | {
      status: "ready";
      nodes: RepositoryGraphNode[];
      edges: RepositoryGraphEdge[];
    }
  | {
      status: "loading";
      message?: string;
    }
  | {
      status: "unsupported";
      message: string;
    };

export interface ReviewPlan {
  repo: string;
  pr: number;
  headSha: string;
  title: string;
  stats: {
    totalFiles: number;
    noiseFiles: number;
    chapters: number;
  };
  chapters: ReviewChapter[];
  files: ReviewFile[];
  graph: {
    nodes: ReviewGraphNode[];
    edges: ReviewGraphEdge[];
  };
  repositoryGraph?: RepositoryGraph;
}

function isSafeRepositoryPath(value: string): boolean {
  if (!value || value !== value.trim()) return false;
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\")) return false;
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(value) || value.includes("//")) return false;
  if (/[\0?#%]/.test(value)) return false;

  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function validateReviewPlan(
  plan: ReviewPlan,
  options: { suppliedStepChapterIds?: string[] } = {},
): string[] {
  const errors: string[] = [];
  const chapterIds = new Set(plan.chapters.map((chapter) => chapter.id));
  const fileIds = new Set(plan.files.map((file) => file.id));
  const nodeIds = new Set(plan.graph.nodes.map((node) => node.id));

  if (plan.graph.nodes.length > 10) errors.push("Graph must contain 10 nodes or fewer.");
  if (plan.stats.chapters !== plan.chapters.length) errors.push("Chapter count does not match stats.");

  for (const suppliedChapterId of options.suppliedStepChapterIds ?? []) {
    if (!chapterIds.has(suppliedChapterId)) {
      errors.push(`Review steps reference unknown chapter ${suppliedChapterId}.`);
    }
  }

  for (const node of plan.graph.nodes) {
    if (!chapterIds.has(node.chapterId)) errors.push(`Node ${node.id} references an unknown chapter.`);
    for (const fileId of node.fileIds) {
      if (!fileIds.has(fileId)) errors.push(`Node ${node.id} references unknown file ${fileId}.`);
    }
  }

  for (const chapter of plan.chapters) {
    for (const fileId of chapter.fileIds) {
      if (!fileIds.has(fileId)) errors.push(`Chapter ${chapter.id} references unknown file ${fileId}.`);
    }

    if (!chapter.steps) continue;

    const stepOrders = new Set<number>();
    const stepFileIds = new Set<string>();
    for (const step of chapter.steps) {
      if (!fileIds.has(step.fileId)) {
        errors.push(`Chapter ${chapter.id} step references unknown file ${step.fileId}.`);
      }
      if (!Number.isInteger(step.order) || step.order <= 0) {
        errors.push(`Chapter ${chapter.id} step order ${step.order} must be a positive integer.`);
      }
      if (stepOrders.has(step.order)) {
        errors.push(`Chapter ${chapter.id} step order ${step.order} is duplicated.`);
      }
      stepOrders.add(step.order);

      if (stepFileIds.has(step.fileId)) {
        errors.push(`Chapter ${chapter.id} contains duplicate step file ${step.fileId}.`);
      }
      stepFileIds.add(step.fileId);

      if (!step.reason.trim()) {
        errors.push(`Chapter ${chapter.id} step ${step.fileId} must include a reason.`);
      }
      if (step.evidence.length === 0) {
        errors.push(`Chapter ${chapter.id} step ${step.fileId} must include evidence.`);
      }
      for (const evidence of step.evidence) {
        if (!evidence.description.trim()) {
          errors.push(`Chapter ${chapter.id} step ${step.fileId} has evidence without a description.`);
        }
        if (evidence.relatedFile !== undefined && !isSafeRepositoryPath(evidence.relatedFile)) {
          errors.push(`Chapter ${chapter.id} step ${step.fileId} has unsafe related file ${evidence.relatedFile}.`);
        }
      }
    }

    const expectedOrders = chapter.steps.map((_, index) => index + 1);
    const actualOrders = [...stepOrders].sort((left, right) => left - right);
    if (actualOrders.length !== expectedOrders.length || actualOrders.some((order, index) => order !== expectedOrders[index])) {
      errors.push(`Chapter ${chapter.id} step orders must be contiguous from 1.`);
    }
  }

  for (const edge of plan.graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.source} -> ${edge.target} references an unknown node.`);
    }
  }

  if (plan.repositoryGraph?.status === "ready") {
    const repositoryNodes = plan.repositoryGraph.nodes;
    const repositoryNodeIds = new Set(repositoryNodes.map((node) => node.id));
    const levelRank: Record<RepositoryGraphLevel, number> = {
      repository: 0,
      area: 1,
      module: 2,
      file: 3,
    };

    if (repositoryNodes.length === 0) errors.push("Ready repository graph must contain at least one node.");
    if (repositoryNodes.length > 50_000) errors.push("Repository graph must contain 50,000 nodes or fewer.");
    if (repositoryNodeIds.size !== repositoryNodes.length) errors.push("Repository graph node IDs must be unique.");

    for (const node of repositoryNodes) {
      if (node.level === "repository" && node.parentId) {
        errors.push(`Repository node ${node.id} cannot have a parent.`);
      }
      if (node.level !== "repository" && !node.parentId) {
        errors.push(`Repository graph node ${node.id} must have a parent.`);
      }
      if (node.parentId) {
        const parent = repositoryNodes.find((candidate) => candidate.id === node.parentId);
        if (!parent) {
          errors.push(`Repository graph node ${node.id} references unknown parent ${node.parentId}.`);
        } else if (levelRank[parent.level] >= levelRank[node.level]) {
          errors.push(`Repository graph node ${node.id} must be below its parent in the hierarchy.`);
        }
      }
      if (node.path !== undefined && !isSafeRepositoryPath(node.path)) {
        errors.push(`Repository graph node ${node.id} has unsafe path ${node.path}.`);
      }
    }

    for (const edge of plan.repositoryGraph.edges) {
      if (!repositoryNodeIds.has(edge.source) || !repositoryNodeIds.has(edge.target)) {
        errors.push(`Repository edge ${edge.source} -> ${edge.target} references an unknown node.`);
      }
    }
  }

  return errors;
}

