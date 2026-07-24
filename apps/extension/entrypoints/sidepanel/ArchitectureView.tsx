import { useEffect, useMemo, useState } from "react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { ArrowLeft, ArrowRight, ChevronsLeft, ChevronsRight, CircleDot } from "lucide-react";
import { getArchitectureSection, getNeighborhoodNodeIds } from "../../primer/lib/review-map";
import type { ExtensionReviewRouteStep } from "../../primer/lib/extension-review";
import type { ReviewGraphNode, ReviewPlan, ReviewStepStatus, Severity } from "../../primer/lib/review-plan";

type MapScope = "focus" | "pr";
type LayoutDirection = "LR" | "TB";
type NodeReviewState = "pending" | "reviewed" | "recheck" | "context";

const NARROW_LAYOUT_QUERY = "(max-width: 699px)";

type ExtensionMapNodeData = Record<string, unknown> & ReviewGraphNode & {
  architectureSection: ReturnType<typeof getArchitectureSection>;
  chapterLabel: string;
  fileCount: number;
  active: boolean;
  reviewState: NodeReviewState;
  reviewPosition?: string | undefined;
  navigable: boolean;
  layoutDirection: LayoutDirection;
  navigate: () => void;
};

const NODE_WIDTH = 196;
const NODE_HEIGHT = 120;

const severityLabel: Record<Severity, string> = {
  "needs-human": "Human attention",
  standard: "Standard review",
  noise: "Low signal",
};

const reviewStateLabel: Record<NodeReviewState, string> = {
  pending: "Open",
  reviewed: "Reviewed",
  recheck: "Recheck",
  context: "Context",
};

function DependencyNode({ data }: NodeProps<Node<ExtensionMapNodeData>>) {
  const vertical = data.layoutDirection === "TB";
  return (
    <div className={`dependency-node severity-${data.severity} review-${data.reviewState} ${data.active ? "is-active" : ""}`}>
      <Handle type="target" position={vertical ? Position.Top : Position.Left} className="dependency-handle" />
      <button type="button" disabled={!data.navigable} onClick={data.navigate}>
        <span className="dependency-node-kicker">
          <span>{data.changed ? "Changed" : "Context"}</span>
          <span>{String(data.fileCount).padStart(2, "0")} files</span>
        </span>
        <span className="dependency-section">{data.architectureSection}</span>
        <strong>{data.label}</strong>
        <span className="dependency-chapter">{data.chapterLabel}</span>
        <span className="dependency-node-footer">
          <span className="dependency-severity"><i /> {severityLabel[data.severity]}</span>
          <span className="dependency-review-state">{data.reviewPosition ?? reviewStateLabel[data.reviewState]}</span>
        </span>
      </button>
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} className="dependency-handle" />
    </div>
  );
}

const nodeTypes = { dependency: DependencyNode };

function layoutGraph({
  plan,
  route,
  visibleNodeIds,
  activeNodeId,
  selectedIndex,
  statuses,
  layoutDirection,
  navigateTo,
}: {
  plan: ReviewPlan;
  route: ExtensionReviewRouteStep[];
  visibleNodeIds: Set<string>;
  activeNodeId?: string | undefined;
  selectedIndex: number;
  statuses: Record<string, ReviewStepStatus>;
  layoutDirection: LayoutDirection;
  navigateTo: (index: number) => void;
}): { nodes: Node<ExtensionMapNodeData>[]; edges: Edge[] } {
  const visibleNodes = plan.graph.nodes.filter((node) => visibleNodeIds.has(node.id));
  const visibleEdges = plan.graph.edges.filter((edge) => (
    visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  ));
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: layoutDirection,
    ranksep: layoutDirection === "TB" ? 48 : 68,
    nodesep: layoutDirection === "TB" ? 22 : 34,
    marginx: 24,
    marginy: 24,
  });

  for (const node of visibleNodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of visibleEdges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  const nodes = visibleNodes.map((node) => {
    const positioned = graph.node(node.id);
    const routeIndex = route.findIndex((item) => node.fileIds.includes(item.file.id));
    const chapter = plan.chapters.find((item) => item.id === node.chapterId);
    const chapterIndex = plan.chapters.findIndex((item) => item.id === node.chapterId);
    const nodeRoute = route.filter((item) => node.fileIds.includes(item.file.id));
    const nodeStatuses = nodeRoute.map((item) => statuses[item.step.fileId] ?? item.step.status);
    const reviewState: NodeReviewState = nodeStatuses.length === 0
      ? "context"
      : nodeStatuses.includes("recheck")
        ? "recheck"
        : nodeStatuses.every((status) => status === "reviewed")
          ? "reviewed"
          : "pending";
    const activeRouteItem = node.id === activeNodeId ? route[selectedIndex] : undefined;
    const activeChapterRoute = activeRouteItem
      ? route.filter((item) => item.chapter.id === activeRouteItem.chapter.id)
      : [];
    const activeChapterStepIndex = activeRouteItem
      ? activeChapterRoute.findIndex((item) => item.file.id === activeRouteItem.file.id)
      : -1;
    return {
      id: node.id,
      type: "dependency",
      position: {
        x: positioned.x - NODE_WIDTH / 2,
        y: positioned.y - NODE_HEIGHT / 2,
      },
      data: {
        ...node,
        architectureSection: getArchitectureSection(node),
        chapterLabel: chapterIndex >= 0
          ? `Chapter ${chapterIndex + 1} · ${chapter?.title ?? "Review area"}`
          : "Supporting context",
        fileCount: node.fileIds.length,
        active: node.id === activeNodeId,
        reviewState,
        reviewPosition: activeChapterStepIndex >= 0
          ? `Step ${activeChapterStepIndex + 1} / ${activeChapterRoute.length}`
          : undefined,
        navigable: routeIndex >= 0,
        layoutDirection,
        navigate: () => { if (routeIndex >= 0) navigateTo(routeIndex); },
      },
    } satisfies Node<ExtensionMapNodeData>;
  });

  const edges = visibleEdges.map((edge, index) => {
    const highlighted = edge.source === activeNodeId || edge.target === activeNodeId;
    return {
      id: `dependency-${index}-${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: highlighted,
      className: highlighted ? "dependency-edge is-active" : "dependency-edge",
      style: {
        stroke: highlighted ? "#315cf5" : "#bfc4bc",
        strokeWidth: highlighted ? 2.2 : 1.2,
      },
    } satisfies Edge;
  });

  return { nodes, edges };
}

export function ArchitectureView({
  plan,
  route,
  selectedIndex,
  statuses,
  navigateTo,
}: {
  plan: ReviewPlan;
  route: ExtensionReviewRouteStep[];
  selectedIndex: number;
  statuses: Record<string, ReviewStepStatus>;
  navigateTo: (index: number) => void;
}) {
  const [scope, setScope] = useState<MapScope>("focus");
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>(() => (
    window.matchMedia(NARROW_LAYOUT_QUERY).matches ? "TB" : "LR"
  ));
  const [layoutPinned, setLayoutPinned] = useState(false);
  const pickLayoutDirection = (direction: LayoutDirection) => {
    setLayoutPinned(true);
    setLayoutDirection(direction);
  };
  const selected = route[selectedIndex];
  const selectedChapterIndex = selected
    ? plan.chapters.findIndex((chapter) => chapter.id === selected.chapter.id)
    : -1;
  const selectedChapterRoute = selected
    ? route.filter((item) => item.chapter.id === selected.chapter.id)
    : [];
  const selectedChapterStepIndex = selected
    ? selectedChapterRoute.findIndex((item) => item.file.id === selected.file.id)
    : -1;
  const activeNode = plan.graph.nodes.find((node) => (
    selected ? node.fileIds.includes(selected.file.id) : false
  ));
  const chapterStartIndex = (index: number): number => {
    const chapterId = route[index]?.chapter.id;
    let start = index;
    while (start > 0 && route[start - 1]?.chapter.id === chapterId) start -= 1;
    return start;
  };
  const currentChapterStart = selected ? chapterStartIndex(selectedIndex) : -1;
  const previousChapterIndex = currentChapterStart > 0 ? chapterStartIndex(currentChapterStart - 1) : -1;
  const nextChapterIndex = selected
    ? route.findIndex((item, index) => index > selectedIndex && item.chapter.id !== selected.chapter.id)
    : route.length > 0 ? 0 : -1;
  const previousStepIndex = selectedIndex > 0 ? selectedIndex - 1 : -1;
  const nextStepIndex = selectedIndex < route.length - 1 ? selectedIndex + 1 : -1;
  const focusNodeIds = useMemo(() => getNeighborhoodNodeIds(
    plan.graph.nodes,
    plan.graph.edges,
    activeNode?.chapterId ?? selected?.chapter.id ?? plan.chapters[0]?.id ?? "",
    activeNode?.id,
  ), [activeNode?.chapterId, activeNode?.id, plan.graph.edges, plan.graph.nodes, plan.chapters, selected?.chapter.id]);
  const visibleNodeIds = useMemo(() => scope === "focus"
    ? focusNodeIds
    : new Set(plan.graph.nodes.map((node) => node.id)), [focusNodeIds, plan.graph.nodes, scope]);

  useEffect(() => {
    if (layoutPinned) return undefined;
    const narrowLayout = window.matchMedia(NARROW_LAYOUT_QUERY);
    const updateLayoutDirection = ({ matches }: MediaQueryListEvent) => {
      setLayoutDirection(matches ? "TB" : "LR");
    };
    narrowLayout.addEventListener("change", updateLayoutDirection);
    return () => narrowLayout.removeEventListener("change", updateLayoutDirection);
  }, [layoutPinned]);

  const graph = useMemo(() => layoutGraph({
    plan,
    route,
    visibleNodeIds,
    activeNodeId: activeNode?.id,
    selectedIndex,
    statuses,
    layoutDirection,
    navigateTo,
  }), [activeNode?.id, layoutDirection, navigateTo, plan, route, selectedIndex, statuses, visibleNodeIds]);

  return (
    <section className="architecture-view" aria-label="Architecture dependency map">
      <div className="architecture-view-heading">
        <div>
          <span>{selectedChapterIndex >= 0
            ? `Chapter ${selectedChapterIndex + 1} / ${plan.chapters.length} · Step ${selectedChapterStepIndex + 1} / ${selectedChapterRoute.length}`
            : "Review map · Fixture-backed"}</span>
          <strong>Dependency flow</strong>
          <p>{selected ? `Following ${selected.file.path.split("/").at(-1)} in the guided review.` : "Select an area to navigate its first review step in GitHub."}</p>
        </div>
        <div className="architecture-toolbar">
          <div className="architecture-scope" role="group" aria-label="Dependency map scope">
            <button type="button" aria-pressed={scope === "focus"} onClick={() => setScope("focus")}>Focus</button>
            <button type="button" aria-pressed={scope === "pr"} onClick={() => setScope("pr")}>Full PR</button>
          </div>
          <div className="architecture-scope" role="group" aria-label="Dependency map layout direction">
            <button type="button" aria-pressed={layoutDirection === "LR"} onClick={() => pickLayoutDirection("LR")}>Horizontal</button>
            <button type="button" aria-pressed={layoutDirection === "TB"} onClick={() => pickLayoutDirection("TB")}>Vertical</button>
          </div>
          <div className="architecture-nav" role="group" aria-label="Guided review navigation">
            <button className="control-button" type="button" aria-label="Previous chapter" disabled={previousChapterIndex < 0} onClick={() => navigateTo(previousChapterIndex)}><ChevronsLeft size={14} /></button>
            <button className="control-button" type="button" aria-label="Previous step" disabled={previousStepIndex < 0} onClick={() => navigateTo(previousStepIndex)}><ArrowLeft size={14} /></button>
            <span className="architecture-nav-position">{selected ? `${selectedIndex + 1} / ${route.length}` : `— / ${route.length}`}</span>
            <button className="control-button" type="button" aria-label="Next step" disabled={nextStepIndex < 0 && selected !== undefined} onClick={() => navigateTo(selected ? nextStepIndex : 0)}><ArrowRight size={14} /></button>
            <button className="control-button" type="button" aria-label="Next chapter" disabled={nextChapterIndex < 0} onClick={() => navigateTo(nextChapterIndex)}><ChevronsRight size={14} /></button>
          </div>
        </div>
      </div>

      <div className="architecture-flow-canvas">
        <ReactFlow<Node<ExtensionMapNodeData>, Edge>
          key={`${plan.headSha}-${layoutDirection}-${scope === "focus" ? activeNode?.chapterId ?? "focus" : "pr"}`}
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.28, maxZoom: 0.95 }}
          minZoom={0.22}
          maxZoom={1.45}
          nodesDraggable={false}
          nodesConnectable={false}
          panOnScroll
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#d9ddd7" />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="architecture-view-status">
        <CircleDot size={12} />
        {graph.nodes.length} shown · {plan.graph.nodes.length} areas · {plan.graph.edges.length} dependencies
      </div>
    </section>
  );
}
