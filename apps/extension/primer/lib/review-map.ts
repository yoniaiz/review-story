import type {
  RepositoryArchitectureSection,
  RepositoryGraph,
  RepositoryGraphEdge,
  RepositoryGraphLevel,
  RepositoryGraphNode,
  ReviewGraphEdge,
  ReviewGraphNode,
} from "./review-plan";

export type ArchitectureSection = RepositoryArchitectureSection;

export interface RepositoryProjectionNode {
  id: string;
  label: string;
  level: "area" | "module";
  architectureSection: ArchitectureSection;
  changed: boolean;
  fileCount: number;
  sourceNodeIds: string[];
}

export interface RepositoryProjection {
  status: "ready" | "absent" | "loading" | "unsupported";
  message?: string;
  nodes: RepositoryProjectionNode[];
  edges: RepositoryGraphEdge[];
}

export interface RepositoryProjectionOptions {
  scope: "full" | "neighborhood";
  selectedNodeId?: string;
  maxVisibleNodes?: number;
}

export function getArchitectureSection(
  node: Pick<ReviewGraphNode, "label" | "architectureSection">,
): ArchitectureSection {
  if (node.architectureSection) return node.architectureSection;
  const label = node.label.toLowerCase();

  if (label.includes("supporting") || label.includes("shared")) return "Shared infrastructure";
  if (label.includes("data") || label.includes("query") || label.includes("api")) return "Data access / API";
  if (label.includes("configuration") || label.includes("state")) return "Application state";
  return "UI";
}

export function getNeighborhoodNodeIds(
  nodes: Array<Pick<ReviewGraphNode, "id" | "chapterId">>,
  edges: Array<Pick<ReviewGraphEdge, "source" | "target">>,
  chapterId: string,
  selectedNodeId?: string,
): Set<string> {
  const knownNodeIds = new Set(nodes.map((node) => node.id));
  const anchorIds = new Set(
    nodes.filter((node) => node.chapterId === chapterId).map((node) => node.id),
  );
  if (selectedNodeId && knownNodeIds.has(selectedNodeId)) anchorIds.add(selectedNodeId);

  const neighborhoodIds = new Set(anchorIds);
  for (const edge of edges) {
    if (anchorIds.has(edge.source) || anchorIds.has(edge.target)) {
      if (knownNodeIds.has(edge.source)) neighborhoodIds.add(edge.source);
      if (knownNodeIds.has(edge.target)) neighborhoodIds.add(edge.target);
    }
  }

  return neighborhoodIds;
}

function repositoryProjectionState(
  repositoryGraph: RepositoryGraph | undefined,
): RepositoryProjection | undefined {
  if (!repositoryGraph) {
    return {
      status: "absent",
      message: "Repository architecture has not been supplied. Full Repo falls back to the complete PR graph.",
      nodes: [],
      edges: [],
    };
  }
  if (repositoryGraph.status === "loading") {
    return {
      status: "loading",
      message: repositoryGraph.message ?? "Repository architecture is still being prepared.",
      nodes: [],
      edges: [],
    };
  }
  if (repositoryGraph.status === "unsupported") {
    return {
      status: "unsupported",
      message: repositoryGraph.message,
      nodes: [],
      edges: [],
    };
  }
  return undefined;
}

function architectureAreaFor(
  node: RepositoryGraphNode,
  nodesById: Map<string, RepositoryGraphNode>,
): RepositoryGraphNode | undefined {
  let current: RepositoryGraphNode | undefined = node;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.level === "area") return current;
    visited.add(current.id);
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }
  return undefined;
}

function moduleFor(
  node: RepositoryGraphNode,
  areaId: string,
  nodesById: Map<string, RepositoryGraphNode>,
): RepositoryGraphNode | undefined {
  let current: RepositoryGraphNode | undefined = node;
  const visited = new Set<string>();
  while (current && current.id !== areaId && !visited.has(current.id)) {
    if (current.level === "module") return current;
    visited.add(current.id);
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }
  return undefined;
}

function aggregateProjectionEdges(
  edges: RepositoryGraphEdge[],
  projectedIdBySourceId: Map<string, string>,
): RepositoryGraphEdge[] {
  const keys = new Set<string>();
  for (const edge of edges) {
    const source = projectedIdBySourceId.get(edge.source);
    const target = projectedIdBySourceId.get(edge.target);
    if (source && target && source !== target) keys.add(`${source}\u0000${target}`);
  }
  return [...keys]
    .sort()
    .map((key) => {
      const [source, target] = key.split("\u0000");
      return { source: source!, target: target!, kind: "imports" as const };
    });
}

function projectionNode(
  visibleNode: RepositoryGraphNode,
  sourceNodes: RepositoryGraphNode[],
  section: ArchitectureSection,
): RepositoryProjectionNode {
  return {
    id: visibleNode.id,
    label: visibleNode.label,
    level: visibleNode.level === "module" ? "module" : "area",
    architectureSection: section,
    changed: sourceNodes.some((node) => node.changed),
    fileCount: sourceNodes.filter((node) => node.level === "file").length,
    sourceNodeIds: sourceNodes.map((node) => node.id).sort(),
  };
}

export function projectRepositoryGraph(
  repositoryGraph: RepositoryGraph | undefined,
  options: RepositoryProjectionOptions,
): RepositoryProjection {
  const state = repositoryProjectionState(repositoryGraph);
  if (state) return state;

  const readyGraph = repositoryGraph as Extract<RepositoryGraph, { status: "ready" }>;
  const maxVisibleNodes = Math.max(2, options.maxVisibleNodes ?? 40);
  const nodesById = new Map(readyGraph.nodes.map((node) => [node.id, node]));
  if (nodesById.size !== readyGraph.nodes.length) {
    return { status: "unsupported", message: "Repository architecture contains duplicate node IDs.", nodes: [], edges: [] };
  }
  if (readyGraph.nodes.some((node) => node.parentId && !nodesById.has(node.parentId))) {
    return { status: "unsupported", message: "Repository architecture contains an unknown parent.", nodes: [], edges: [] };
  }

  const areas = readyGraph.nodes.filter((node) => node.level === "area");
  if (areas.length === 0) {
    return { status: "unsupported", message: "Repository architecture does not contain any areas to display.", nodes: [], edges: [] };
  }
  const firstArea = areas[0]!;

  const areaBySourceId = new Map<string, string>();
  const sourceNodesByAreaId = new Map<string, RepositoryGraphNode[]>();
  for (const node of readyGraph.nodes) {
    const area = architectureAreaFor(node, nodesById);
    if (!area) continue;
    areaBySourceId.set(node.id, area.id);
    const sourceNodes = sourceNodesByAreaId.get(area.id) ?? [];
    sourceNodes.push(node);
    sourceNodesByAreaId.set(area.id, sourceNodes);
  }

  if (options.scope === "full") {
    if (areas.length > maxVisibleNodes) {
      return {
        status: "unsupported",
        message: `Repository architecture has ${areas.length} top-level areas; the map supports ${maxVisibleNodes} or fewer without another clustering level.`,
        nodes: [],
        edges: [],
      };
    }
    return {
      status: "ready",
      nodes: areas
        .map((area) => projectionNode(
          area,
          sourceNodesByAreaId.get(area.id) ?? [area],
          area.architectureSection ?? "Shared infrastructure",
        ))
        .sort((left, right) => left.label.localeCompare(right.label)),
      edges: aggregateProjectionEdges(readyGraph.edges, areaBySourceId),
    };
  }

  const selectedNode = options.selectedNodeId ? nodesById.get(options.selectedNodeId) : undefined;
  const changedNode = readyGraph.nodes.find((node) => node.changed);
  const activeArea = architectureAreaFor(selectedNode ?? changedNode ?? firstArea, nodesById) ?? firstArea;
  const moduleBySourceId = new Map<string, string>();
  const sourceNodesByModuleId = new Map<string, RepositoryGraphNode[]>();
  for (const node of sourceNodesByAreaId.get(activeArea.id) ?? []) {
    if (node.id === activeArea.id) continue;
    const module = moduleFor(node, activeArea.id, nodesById);
    const visibleId = module?.id ?? activeArea.id;
    moduleBySourceId.set(node.id, visibleId);
    const sourceNodes = sourceNodesByModuleId.get(visibleId) ?? [];
    sourceNodes.push(node);
    sourceNodesByModuleId.set(visibleId, sourceNodes);
  }

  const projectedIdBySourceId = new Map(areaBySourceId);
  for (const [sourceId, moduleId] of moduleBySourceId) projectedIdBySourceId.set(sourceId, moduleId);
  const allProjectedEdges = aggregateProjectionEdges(readyGraph.edges, projectedIdBySourceId);
  const anchorIds = new Set(sourceNodesByModuleId.keys());
  const visibleIds = new Set(anchorIds);
  for (const edge of allProjectedEdges) {
    if (anchorIds.has(edge.source) || anchorIds.has(edge.target)) {
      visibleIds.add(edge.source);
      visibleIds.add(edge.target);
    }
  }

  if (visibleIds.size > maxVisibleNodes) {
    return {
      status: "unsupported",
      message: `Repository neighborhood expands to ${visibleIds.size} nodes; narrow the source graph below ${maxVisibleNodes + 1} visible nodes.`,
      nodes: [],
      edges: [],
    };
  }

  const visibleNodes = [...visibleIds].map((id) => {
    const node = nodesById.get(id)!;
    const area = architectureAreaFor(node, nodesById) ?? node;
    const sourceNodes = sourceNodesByModuleId.get(id) ?? sourceNodesByAreaId.get(id) ?? [node];
    return projectionNode(node, sourceNodes, area.architectureSection ?? "Shared infrastructure");
  });
  return {
    status: "ready",
    nodes: visibleNodes.sort((left, right) => left.label.localeCompare(right.label)),
    edges: allProjectedEdges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)),
  };
}
