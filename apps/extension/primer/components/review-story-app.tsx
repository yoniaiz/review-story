"use client";

import { useMemo, useState } from "react";
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
import dagre from "@dagrejs/dagre";
import type {
  ReviewGraphNode,
  ReviewPlan,
  ReviewStep,
  ReviewStepStatus,
  Severity,
} from "../lib/review-plan";
import {
  getArchitectureSection,
  getNeighborhoodNodeIds,
  projectRepositoryGraph,
  type ArchitectureSection,
  type RepositoryProjection,
} from "../lib/review-map";
import { deriveChapterStatus } from "../lib/review-state";

type ViewMode = "map" | "review";
type MapScope = "pr" | "neighborhood" | "full-repo";
type MapNodeData = Record<string, unknown> & ReviewGraphNode & {
  architectureSection: ArchitectureSection;
  chapterTitle: string;
  fileCount: number;
  hierarchyLevel?: "area" | "module" | undefined;
  sourceNodeIds?: string[] | undefined;
  isRepositoryProjection: boolean;
  isCore: boolean;
  isOnRoute: boolean;
  isSelected: boolean;
};

const severityLabel: Record<Severity, string> = {
  "needs-human": "Human attention",
  standard: "Standard review",
  noise: "Low signal",
};

function ArchitectureNode({ data }: NodeProps<Node<MapNodeData>>) {
  return (
    <div
      className={`architecture-node severity-${data.severity} ${data.changed ? "is-changed" : "is-context"} ${data.isCore ? "is-core" : ""} ${data.isOnRoute ? "is-route" : ""} ${data.isSelected ? "is-selected" : ""}`}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-kicker">
        <span>{data.changed ? "Changed" : "Context"}</span>
        <span>{String(data.fileCount).padStart(2, "0")} files</span>
      </div>
      <span className="node-architecture-section">{data.architectureSection}</span>
      <strong>{data.label}</strong>
      <span className="node-chapter">{data.chapterTitle}</span>
      <div className="node-severity">
        <span className="severity-dot" />
        {severityLabel[data.severity]}
      </div>
      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  );
}

const nodeTypes = { architecture: ArchitectureNode };
const NODE_WIDTH = 232;
const NODE_HEIGHT = 146;

function fileName(path?: string): string {
  return path?.split("/").at(-1) ?? "Select a file";
}

function DiffLine({ line, index }: { line: string; index: number }) {
  const kind = line.startsWith("+") && !line.startsWith("+++")
    ? "added"
    : line.startsWith("-") && !line.startsWith("---")
      ? "removed"
      : line.startsWith("@@")
        ? "hunk"
        : "context";

  return (
    <div className={`diff-line diff-${kind}`}>
      <span className="diff-number">{kind === "hunk" ? "" : String(index + 1).padStart(2, "0")}</span>
      <code>{line || " "}</code>
    </div>
  );
}

function ReviewQueue({
  steps,
  filesById,
  selectedStep,
  statuses,
  onSelect,
}: {
  steps: ReviewStep[];
  filesById: Map<string, ReviewPlan["files"][number]>;
  selectedStep?: ReviewStep | undefined;
  statuses: Record<string, ReviewStepStatus>;
  onSelect: (step: ReviewStep) => void;
}) {
  return (
    <aside className="review-queue" aria-label="Ordered files in this chapter">
      <div className="queue-heading">
        <span>Review order</span>
        <strong>{String(steps.length).padStart(2, "0")} files</strong>
      </div>
      <div className="queue-list">
        {steps.map((step) => {
          const file = filesById.get(step.fileId);
          const status = statuses[step.fileId] ?? step.status;
          return (
            <button
              key={step.fileId}
              className={`queue-file ${selectedStep?.fileId === step.fileId ? "active" : ""} status-${status}`}
              onClick={() => onSelect(step)}
            >
              <span className="queue-order">{String(step.order).padStart(2, "0")}</span>
              <span className="queue-file-copy">
                <strong>{fileName(file?.path)}</strong>
                <small>{status === "reviewed" ? "Reviewed" : status === "recheck" ? "Recheck" : step.order === 1 ? "Start here" : "Pending"}</small>
              </span>
              <span className="queue-state" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function layoutGraph(
  plan: ReviewPlan,
  repositoryProjection?: RepositoryProjection,
): { nodes: Node<MapNodeData>[]; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: 92, nodesep: 54, marginx: 28, marginy: 28 });

  const repositoryNodes = repositoryProjection?.status === "ready" ? repositoryProjection.nodes : undefined;
  const sourceNodes: ReviewGraphNode[] = repositoryNodes
    ? repositoryNodes.map((node) => ({
        id: node.id,
        label: node.label,
        chapterId: "",
        severity: node.changed ? "standard" : "noise",
        fileIds: [],
        changed: node.changed,
      }))
    : plan.graph.nodes;
  const sourceEdges = repositoryNodes ? repositoryProjection?.edges ?? [] : plan.graph.edges;

  for (const node of sourceNodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of sourceEdges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  const nodes = sourceNodes.map((node) => {
    const positioned = graph.node(node.id);
    const chapter = plan.chapters.find((item) => item.id === node.chapterId);
    const repositoryNode = repositoryNodes?.find((item) => item.id === node.id);
    return {
      id: node.id,
      type: "architecture",
      position: { x: positioned.x - NODE_WIDTH / 2, y: positioned.y - NODE_HEIGHT / 2 },
      data: {
        ...node,
        architectureSection: repositoryNode?.architectureSection ?? getArchitectureSection(node),
        chapterTitle: repositoryNode
          ? repositoryNode.level === "area" ? "Repository area" : "Repository module"
          : chapter?.title ?? "Supporting context",
        fileCount: repositoryNode?.fileCount ?? node.fileIds.length,
        hierarchyLevel: repositoryNode?.level,
        sourceNodeIds: repositoryNode?.sourceNodeIds,
        isRepositoryProjection: Boolean(repositoryNode),
        isCore: false,
        isOnRoute: false,
        isSelected: false,
      },
    } satisfies Node<MapNodeData>;
  });

  const edges = sourceEdges.map((edge, index) => ({
    id: `edge-${index}-${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
  }));

  return { nodes, edges };
}

export function ReviewStoryApp({ plan }: { plan: ReviewPlan }) {
  const [chapterId, setChapterId] = useState(plan.chapters[0]?.id ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState(
    plan.graph.nodes.find((node) => node.chapterId === plan.chapters[0]?.id)?.id ?? plan.graph.nodes[0]?.id ?? "",
  );
  const [view, setView] = useState<ViewMode>("map");
  const [mapScope, setMapScope] = useState<MapScope>("neighborhood");
  const [selectedStepId, setSelectedStepId] = useState(plan.chapters[0]?.steps?.[0]?.fileId ?? "");
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewStepStatus>>(() =>
    Object.fromEntries(
      plan.chapters.flatMap((chapter) => chapter.steps ?? []).map((step) => [step.fileId, step.status]),
    ),
  );
  const [dismissedCompletions, setDismissedCompletions] = useState<Set<string>>(() => new Set());

  const activeChapter = plan.chapters.find((chapter) => chapter.id === chapterId) ?? plan.chapters[0];
  const activeSteps = activeChapter?.steps ?? [];
  const selectedStep = activeSteps.find((step) => step.fileId === selectedStepId) ?? activeSteps[0];
  const filesById = useMemo(() => new Map(plan.files.map((file) => [file.id, file])), [plan.files]);
  const selectedReviewFile = selectedStep ? filesById.get(selectedStep.fileId) : undefined;
  const reviewedCount = activeSteps.filter((step) => reviewStatuses[step.fileId] === "reviewed").length;
  const recheckCount = activeSteps.filter((step) => reviewStatuses[step.fileId] === "recheck").length;
  const pendingCount = activeSteps.filter((step) => reviewStatuses[step.fileId] === "pending").length;
  const activeChapterStatus = deriveChapterStatus(activeSteps, reviewStatuses);
  const showCompletion = activeSteps.length > 0 && pendingCount === 0 && !dismissedCompletions.has(activeChapter?.id ?? "");
  const progress = activeSteps.length ? Math.round((reviewedCount / activeSteps.length) * 100) : 0;
  const repositoryProjection = useMemo(
    () => projectRepositoryGraph(plan.repositoryGraph, { scope: "full" }),
    [plan.repositoryGraph],
  );
  const usesRepositoryProjection = mapScope === "full-repo" && repositoryProjection.status === "ready";
  const laidOutGraph = useMemo(
    () => layoutGraph(plan, usesRepositoryProjection ? repositoryProjection : undefined),
    [plan, repositoryProjection, usesRepositoryProjection],
  );
  const neighborhoodNodeIds = useMemo(
    () => getNeighborhoodNodeIds(plan.graph.nodes, plan.graph.edges, chapterId, selectedNodeId),
    [chapterId, plan.graph.edges, plan.graph.nodes, selectedNodeId],
  );
  const coreIds = useMemo(
    () => new Set(plan.graph.nodes.filter((node) => node.chapterId === chapterId).map((node) => node.id)),
    [chapterId, plan.graph.nodes],
  );
  const effectiveSelectedNodeId = laidOutGraph.nodes.some((node) => node.id === selectedNodeId)
    ? selectedNodeId
    : laidOutGraph.nodes[0]?.id ?? "";
  const nodes = useMemo(
    () => laidOutGraph.nodes.map((node) => {
      const onRoute = usesRepositoryProjection ? node.data.changed : neighborhoodNodeIds.has(node.id);
      return {
        ...node,
        hidden: !usesRepositoryProjection && mapScope === "neighborhood" && !neighborhoodNodeIds.has(node.id),
        data: {
          ...node.data,
          isCore: !usesRepositoryProjection && coreIds.has(node.id),
          isOnRoute: onRoute,
          isSelected: effectiveSelectedNodeId === node.id,
        },
      };
    }),
    [coreIds, effectiveSelectedNodeId, laidOutGraph.nodes, mapScope, neighborhoodNodeIds, usesRepositoryProjection],
  );
  const edges = useMemo(
    () => laidOutGraph.edges.map((edge) => {
      const highlighted = usesRepositoryProjection
        ? nodes.some((node) => node.data.changed && (node.id === edge.source || node.id === edge.target))
        : coreIds.has(edge.source) || coreIds.has(edge.target);
      const visible = usesRepositoryProjection
        || mapScope !== "neighborhood"
        || (neighborhoodNodeIds.has(edge.source) && neighborhoodNodeIds.has(edge.target));
      return {
        ...edge,
        hidden: !visible,
        animated: highlighted,
        className: highlighted ? "route-edge" : "quiet-edge",
        style: { stroke: highlighted ? "#D95C3F" : "#CBC5B9", strokeWidth: highlighted ? 2.4 : 1.25 },
      };
    }),
    [coreIds, laidOutGraph.edges, mapScope, neighborhoodNodeIds, nodes, usesRepositoryProjection],
  );
  const selectedMapNode = nodes.find((node) => node.id === effectiveSelectedNodeId)?.data;
  const selectedGraphNode = selectedMapNode?.isRepositoryProjection
    ? undefined
    : plan.graph.nodes.find((node) => node.id === effectiveSelectedNodeId);
  const selectedArchitectureSection = selectedMapNode?.architectureSection;
  const selectedChapter = plan.chapters.find((chapter) => chapter.id === selectedGraphNode?.chapterId) ?? activeChapter;
  const selectedFiles = plan.files.filter((file) => selectedGraphNode?.fileIds.includes(file.id));
  const mapCaption = usesRepositoryProjection
    ? {
        eyebrow: "Repository overview",
        title: "Repository architecture",
        summary: "Collapsed architecture areas from the supplied repository graph. Select an area to inspect its scope.",
      }
    : mapScope === "pr"
      ? {
          eyebrow: "Pull request scope",
          title: `PR #${plan.pr} architecture`,
          summary: "Every changed and supporting area represented in this pull request.",
        }
      : mapScope === "full-repo"
        ? {
            eyebrow: "Repository overview",
            title: "Repository architecture",
            summary: "Showing the pull request graph until a full repository artifact is available.",
          }
        : { eyebrow: "Chapter route", title: activeChapter?.title, summary: activeChapter?.summary };

  const selectChapter = (nextChapterId: string) => {
    setChapterId(nextChapterId);
    const nextChapter = plan.chapters.find((chapter) => chapter.id === nextChapterId);
    setSelectedStepId(nextChapter?.steps?.[0]?.fileId ?? "");
    const firstNode = plan.graph.nodes.find((node) => node.chapterId === nextChapterId);
    if (firstNode) setSelectedNodeId(firstNode.id);
  };

  const updateStepStatus = (status: ReviewStepStatus) => {
    if (!selectedStep) return;
    setReviewStatuses((current) => ({ ...current, [selectedStep.fileId]: status }));
    setDismissedCompletions((current) => {
      if (!activeChapter || !current.has(activeChapter.id)) return current;
      const next = new Set(current);
      next.delete(activeChapter.id);
      return next;
    });
    if (status === "reviewed") {
      const currentIndex = activeSteps.findIndex((step) => step.fileId === selectedStep.fileId);
      const next = activeSteps[currentIndex + 1];
      if (next) setSelectedStepId(next.fileId);
    }
  };

  const revisitRechecks = () => {
    const firstRecheck = activeSteps.find((step) => reviewStatuses[step.fileId] === "recheck");
    if (!firstRecheck || !activeChapter) return;
    setSelectedStepId(firstRecheck.fileId);
    setDismissedCompletions((current) => new Set(current).add(activeChapter.id));
  };

  const moveStep = (direction: -1 | 1) => {
    if (!selectedStep) return;
    const currentIndex = activeSteps.findIndex((step) => step.fileId === selectedStep.fileId);
    const next = activeSteps[currentIndex + direction];
    if (next) setSelectedStepId(next.fileId);
  };

  return (
    <main className="app-shell review-story-root">
      <header className="topbar">
        <a href="#main-content" className="skip-link">Skip to map</a>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">RS</div>
          <div><span>Review Story</span><small>Guided code review</small></div>
        </div>
        <div className="repo-identity">
          <span className="eyebrow">{plan.repo}</span>
          <h1><span>#{plan.pr}</span> {plan.title}</h1>
        </div>
        <div className="review-stats" aria-label="Pull request statistics">
          <div><strong>{plan.stats.totalFiles}</strong><span>files changed</span></div>
          <div><strong>{plan.stats.noiseFiles}</strong><span>collapsed</span></div>
          <div><strong>{plan.stats.chapters}</strong><span>chapters</span></div>
        </div>
      </header>

      <div className="workspace">
        <aside className="chapter-rail" aria-label="Review chapters">
          <div className="rail-heading"><span>Review path</span><strong>01—{String(plan.chapters.length).padStart(2, "0")}</strong></div>
          <nav>
            {plan.chapters.map((chapter, index) => {
              const active = chapter.id === chapterId;
              const chapterStatus = chapter.steps?.length
                ? deriveChapterStatus(chapter.steps, reviewStatuses)
                : chapter.status;
              const chapterReviewedCount = chapter.steps?.filter(
                (step) => reviewStatuses[step.fileId] === "reviewed",
              ).length ?? 0;
              const chapterStateLabel = chapterStatus === "done"
                ? "Reviewed"
                : chapterStatus === "recheck"
                  ? "Recheck"
                  : chapterReviewedCount > 0
                    ? `${chapterReviewedCount}/${chapter.steps?.length ?? 0} reviewed`
                    : "Up next";
              return (
                <button key={chapter.id} className={`chapter-button status-${chapterStatus} ${active ? "active" : ""}`} onClick={() => selectChapter(chapter.id)}>
                  <span className="chapter-index">{String(index + 1).padStart(2, "0")}</span>
                  <span><strong>{chapter.title}</strong><small>{chapterStateLabel}</small></span>
                  <span className="chapter-status" aria-hidden="true" />
                </button>
              );
            })}
          </nav>
          <div className="rail-note"><span className="mono">HEAD {plan.headSha.slice(0, 7)}</span><p>The plan is cached for this exact version of the pull request.</p></div>
        </aside>

        <section className="content-column" id="main-content">
          <div className="view-toolbar">
            <div className="view-tabs" role="tablist" aria-label="Review view">
              <button role="tab" aria-selected={view === "map"} onClick={() => setView("map")}>Architecture map</button>
              <button role="tab" aria-selected={view === "review"} onClick={() => setView("review")}>Guided review</button>
            </div>
            <div className="legend"><span className="human">Human attention</span><span className="standard">Standard</span><span className="context">Context only</span></div>
          </div>

          {view === "map" ? (
            <div className="map-stage" aria-label="Architecture dependency map">
              <div className="map-caption">
                <span className="eyebrow">{mapCaption.eyebrow}</span>
                <h2>{mapCaption.title}</h2>
                <p>{mapCaption.summary}</p>
              </div>
              <div className="map-scope-trigger" role="group" aria-label="Map scope">
                {([
                  ["pr", "PR"],
                  ["neighborhood", "Neighborhood"],
                  ["full-repo", "Full Repo"],
                ] as const).map(([scope, label]) => (
                  <button
                    key={scope}
                    type="button"
                    aria-pressed={mapScope === scope}
                    onClick={() => setMapScope(scope)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mapScope === "full-repo" ? (
                <div
                  className={`repository-map-status status-${repositoryProjection.status}`}
                  role={repositoryProjection.status === "unsupported" ? "alert" : "status"}
                >
                  <span>
                    {repositoryProjection.status === "ready"
                      ? "Repository graph"
                      : repositoryProjection.status === "loading"
                        ? "Repository graph loading"
                        : repositoryProjection.status === "unsupported"
                          ? "PR graph fallback"
                          : "PR graph only"}
                  </span>
                  <p>
                    {repositoryProjection.status === "ready"
                      ? `${repositoryProjection.nodes.length} architecture areas from the supplied artifact.`
                      : repositoryProjection.message}
                  </p>
                </div>
              ) : null}
              <ReactFlow<Node<MapNodeData>, Edge>
                key={`${chapterId}-${mapScope}`}
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodeClick={(_, node) => {
                  setSelectedNodeId(node.id);
                  if (node.data.chapterId) setChapterId(node.data.chapterId);
                }}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1.05 }}
                minZoom={0.38}
                maxZoom={1.4}
                nodesDraggable={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#D8D1C5" />
                <Controls position="bottom-left" showInteractive={false} />
              </ReactFlow>
            </div>
          ) : (
            <div className="guided-review">
              <div className="review-progress-bar" aria-label={`${progress}% of chapter reviewed`}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="review-chapter-heading">
                <div>
                  <span className="eyebrow">Chapter {String(plan.chapters.findIndex((chapter) => chapter.id === activeChapter?.id) + 1).padStart(2, "0")}</span>
                  <h2>{activeChapter?.title}</h2>
                </div>
                <div className="chapter-progress-copy"><strong>{reviewedCount}/{activeSteps.length}</strong><span>reviewed</span></div>
              </div>
              {showCompletion ? (
                <div className={`review-complete status-${activeChapterStatus}`} role="status">
                  <span className="eyebrow">Review pass complete</span>
                  <h3>{activeChapterStatus === "done" ? "Chapter reviewed" : "Rechecks captured"}</h3>
                  <p>No files remain pending in this chapter.</p>
                  <div className="completion-counts" aria-label="Chapter review totals">
                    <div><strong>{reviewedCount}</strong><span>reviewed</span></div>
                    <div><strong>{recheckCount}</strong><span>recheck</span></div>
                  </div>
                  <div className="completion-actions">
                    <button className="return-map" onClick={() => setView("map")}>Return to architecture map</button>
                    {recheckCount > 0 ? <button className="revisit-rechecks" onClick={revisitRechecks}>Revisit rechecks</button> : null}
                  </div>
                </div>
              ) : activeSteps.length ? (
                <div className="review-workspace">
                  <ReviewQueue
                    steps={activeSteps}
                    filesById={filesById}
                    selectedStep={selectedStep}
                    statuses={reviewStatuses}
                    onSelect={(step) => setSelectedStepId(step.fileId)}
                  />
                  <section className="diff-panel" aria-label={`Diff for ${fileName(selectedReviewFile?.path)}`}>
                    <div className="diff-toolbar">
                      <div><span className="mono">{String(selectedStep?.order ?? 0).padStart(2, "0")}</span><strong>{fileName(selectedReviewFile?.path)}</strong></div>
                      <span className="fixture-badge">Fixture patch</span>
                    </div>
                    <div className="diff-path">{selectedReviewFile?.path}</div>
                    <div className="diff-code">
                      {(selectedStep?.patch ?? "Patch arrives from the Tuesday integration pipeline.").split("\n").map((line, index) => (
                        <DiffLine key={`${index}-${line}`} line={line} index={index} />
                      ))}
                    </div>
                    <div className="diff-navigation">
                      <button onClick={() => moveStep(-1)} disabled={selectedStep?.order === 1}>← Previous</button>
                      <span>{selectedStep?.order} of {activeSteps.length}</span>
                      <button onClick={() => moveStep(1)} disabled={selectedStep?.order === activeSteps.length}>Next →</button>
                    </div>
                  </section>
                </div>
              ) : (
                <div className="review-empty">
                  <span className="eyebrow">Planned for Tuesday</span>
                  <h3>This chapter is waiting for ordered review evidence.</h3>
                  <p>The interface is ready; Itay’s planner will supply its steps through the shared contract.</p>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="inspector" aria-label="Selected architecture area">
          {view === "map" ? (
            <>
              <div className="inspector-top"><span className="eyebrow">Selected area</span><span className={`severity-badge ${selectedMapNode?.severity}`}>{selectedMapNode ? severityLabel[selectedMapNode.severity] : "Context"}</span></div>
              {selectedArchitectureSection ? <span className="architecture-section-badge">{selectedArchitectureSection}</span> : null}
              <h2>{selectedMapNode?.label}</h2>
              <p>{selectedMapNode?.isRepositoryProjection
                ? `${selectedMapNode.fileCount} repository files are grouped into this ${selectedMapNode.hierarchyLevel}.`
                : selectedChapter?.summary}</p>
              {mapScope === "neighborhood" && selectedGraphNode && !selectedGraphNode.changed ? (
                <p className="neighborhood-context-note">Included because this unchanged area is one hop from the active chapter route.</p>
              ) : null}
              <div className="inspector-rule" />
              <span className="section-label">{selectedMapNode?.isRepositoryProjection ? "Files in this area" : "Files in this change"}</span>
              <div className="file-list">
                {selectedMapNode?.isRepositoryProjection
                  ? <p className="context-note">File detail remains collapsed at this level. Neighborhood projections expand the selected area when the repository artifact is connected.</p>
                  : selectedFiles.length
                    ? selectedFiles.slice(0, 5).map((file) => <div key={file.id}><code>{file.path.split("/").at(-1)}</code><span>{file.summary}</span></div>)
                    : <p className="context-note">This area is unchanged context included to explain the path of the feature.</p>}
              </div>
              <button className="open-chapter" onClick={() => setView("review")}><span>{selectedMapNode?.isRepositoryProjection ? "Open active chapter" : "Open chapter"}</span><span aria-hidden="true">→</span></button>
            </>
          ) : showCompletion ? (
            <div className="completion-inspector">
              <span className="eyebrow">Chapter state</span>
              <h2>{activeChapterStatus === "done" ? "Reviewed" : "Recheck"}</h2>
              <p>{reviewedCount} reviewed · {recheckCount} marked for recheck</p>
            </div>
          ) : selectedStep ? (
            <>
              <div className="inspector-top">
                <span className="eyebrow">Why this file matters</span>
                <span className="step-count">{String(selectedStep.order).padStart(2, "0")}/{String(activeSteps.length).padStart(2, "0")}</span>
              </div>
              <h2>{fileName(selectedReviewFile?.path)}</h2>
              <p>{selectedStep.reason}</p>
              <div className="inspector-rule" />
              <span className="section-label">Evidence</span>
              <div className="evidence-list">
                {selectedStep.evidence.map((evidence, index) => (
                  <div key={`${evidence.kind}-${index}`} className={`evidence-item evidence-${evidence.kind}`}>
                    <span>{evidence.kind.replace("-", " ")}</span>
                    <p>{evidence.description}</p>
                    {evidence.relatedFile ? <code>{evidence.relatedFile}</code> : null}
                  </div>
                ))}
              </div>
              <div className="review-actions">
                <button className="mark-recheck" onClick={() => updateStepStatus("recheck")}>Recheck later</button>
                <button className="mark-reviewed" onClick={() => updateStepStatus("reviewed")}>Mark reviewed <span>→</span></button>
              </div>
            </>
          ) : (
            <div className="context-note">Select Chapter 1 to use the pre-hackathon review fixture.</div>
          )}
        </aside>
      </div>
    </main>
  );
}
