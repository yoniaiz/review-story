import type {
  ReviewChapter,
  ReviewFile,
  ReviewGraphNode,
  ReviewPlan,
  ReviewStep,
} from "../lib/review-plan";

// Cached from https://github.com/twentyhq/twenty/pull/22908 at the exact head SHA below.
// This fixture intentionally exercises a server-side PR outside the calendar graph extractor.
const changedPaths = [
  "packages/twenty-apps/public/call-recorder/package.json",
  "packages/twenty-apps/public/call-recorder/src/application-config.ts",
  "packages/twenty-apps/public/call-recorder/src/constants/call-recording-artifacts-import-claimed-at-field-universal-identifier.ts",
  "packages/twenty-apps/public/call-recorder/src/constants/cleanup-orphaned-recall-bots-logic-function-universal-identifier.ts",
  "packages/twenty-apps/public/call-recorder/src/constants/import-call-recording-artifacts-logic-function-universal-identifier.ts",
  "packages/twenty-apps/public/call-recorder/src/constants/import-call-recording-artifacts-route-path.ts",
  "packages/twenty-apps/public/call-recorder/src/constants/pending-call-recording-requests-logic-function-universal-identifier.ts",
  "packages/twenty-apps/public/call-recorder/src/fields/call-recording-artifacts-import-claimed-at-on-call-recording.field.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/__tests__/import-call-recording-artifacts.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/__tests__/process-recall-webhook.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/cleanup-orphaned-recall-bots.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/constants/cleanup-orphaned-recall-bots-cron-pattern.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/constants/pending-call-recording-requests-cron-pattern.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/constants/stale-bot-state-cron-pattern.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/data/__tests__/claim-call-recording-artifacts-import.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/data/claim-call-recording-artifacts-import.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/data/find-call-recordings-by-filter.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/data/replace-canceled-call-recording-external-bot-id.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/data/request-call-recording-artifacts-import.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/domain/has-meeting-ended.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/__tests__/cleanup-orphaned-recall-bots.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/__tests__/converge-diverged-call-recordings.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/__tests__/handle-recall-webhook.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/__tests__/import-call-recording-artifacts.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/__tests__/retry-failed-recall-cancellations.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/__tests__/schedule-recall-bots-for-pending-call-recordings.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/attach-existing-recall-bot-to-call-recording.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/cleanup-orphaned-recall-bots.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/converge-diverged-call-recordings.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/handle-recall-webhook.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/import-call-recording-artifacts.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/import-call-recording-media.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/persist-call-recording-progress.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/retry-failed-recall-cancellations.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/schedule-recall-bots-for-pending-call-recordings.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/sync-call-recording.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/import-call-recording-artifacts.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/process-pending-call-recording-requests.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/__tests__/recall-bot-api.test.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/fetch-recall-list-pages.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/find-scheduled-recall-bot-id-for-call-recording.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/get-recall-api-config.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/list-recall-transcripts.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/list-scheduled-recall-bots.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/recall-bot-api-request.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/schedule-recall-bot.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/reconcile-stale-bot-state.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/types/call-recording-artifacts-import-request.type.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/types/call-recording-record.type.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/types/call-recording-update-fields.type.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/utils/build-step-failure.util.ts",
  "packages/twenty-apps/public/call-recorder/src/logic-functions/utils/normalize-optional-string.util.ts",
] as const;

function chapterFor(path: string): string {
  if (/process-pending|schedule-recall-bots-for-pending|attach-existing|find-scheduled-recall-bot|has-meeting-ended/.test(path)) return "ch1";
  if (/cleanup-orphaned|retry-failed-recall-cancellations|replace-canceled|reconcile-stale/.test(path)) return "ch2";
  if (/artifact|webhook|import-call-recording|persist-call-recording/.test(path)) return "ch3";
  if (/recall-api|sync-call-recording|converge-diverged/.test(path)) return "ch4";
  return "ch5";
}

function summaryFor(path: string, chapterId: string): string {
  if (path.includes("/__tests__/")) return "Regression coverage for the changed Call Recorder behavior.";
  if (path.includes("/constants/") || path.endsWith("package.json") || path.endsWith("application-config.ts")) {
    return "Configuration and stable identifiers supporting the lifecycle change.";
  }
  return {
    ch1: "Recovers or schedules pending recording requests without creating duplicate bots.",
    ch2: "Retries cancellation and converges orphaned bot state safely.",
    ch3: "Moves recording artifact import behind an explicit, lease-protected handoff.",
    ch4: "Scopes Recall provider calls and synchronizes recording state.",
    ch5: "Shared contracts and utilities used across the lifecycle workflow.",
  }[chapterId] ?? "Changed in this pull request.";
}

const files: ReviewFile[] = changedPaths.map((path, index) => {
  const chapterId = chapterFor(path);
  const lowSignal = path.includes("/__tests__/") || path.includes("/constants/") || path.endsWith("package.json");
  return {
    id: `p22908-f${String(index + 1).padStart(2, "0")}`,
    path,
    chapterId,
    severity: lowSignal ? "noise" : chapterId === "ch4" || chapterId === "ch5" ? "standard" : "needs-human",
    noiseReason: null,
    summary: summaryFor(path, chapterId),
  };
});

function fileId(path: string): string {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`PR #22908 fixture is missing ${path}.`);
  return file.id;
}

const stepPaths = {
  trigger: "packages/twenty-apps/public/call-recorder/src/logic-functions/process-pending-call-recording-requests.ts",
  scheduler: "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/schedule-recall-bots-for-pending-call-recordings.util.ts",
  lookup: "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/find-scheduled-recall-bot-id-for-call-recording.util.ts",
  attach: "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/attach-existing-recall-bot-to-call-recording.util.ts",
} as const;

const chapterOneSteps: ReviewStep[] = [
  {
    fileId: fileId(stepPaths.trigger),
    order: 1,
    reason: "Start at the five-minute maintenance trigger to see the two recovery responsibilities and their failure isolation.",
    evidence: [
      { kind: "entry-point", description: "Introduces the cron-triggered orchestration entry point." },
      { kind: "imports", description: "Runs scheduling and cancellation recovery independently so one failure does not suppress the other.", relatedFile: "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/retry-failed-recall-cancellations.util.ts" },
    ],
    patch: `@@ -0,0 +1,29 @@
+const processPendingCallRecordingRequestsHandler = async (): Promise<object> => {
+  const now = new Date();
+  const client = new CoreApiClient();
+
+  const pendingCallRecordingScheduleResult =
+    await scheduleRecallBotsForPendingCallRecordingsSafely(client, now);
+  const failedCancellationResult =
+    await retryFailedRecallCancellationsSafely(client, now);
+
+  return {
+    pendingCallRecordingScheduleResult,
+    failedCancellationResult,
+  };
+};
+
+export default defineLogicFunction({
+  name: 'process-pending-call-recording-requests',
+  description:
+    'Processes pending CallRecording requests by attaching or scheduling missing Recall bots and retrying incomplete cancellations.',
+  timeoutSeconds: 250,
+  handler: processPendingCallRecordingRequestsHandler,
+  cronTriggerSettings: {
+    pattern: PENDING_CALL_RECORDING_REQUESTS_CRON_PATTERN,
+  },
+});`,
    status: "pending",
  },
  {
    fileId: fileId(stepPaths.scheduler),
    order: 2,
    reason: "Follow the decision point that now looks for a previously created bot before scheduling a replacement.",
    evidence: [
      { kind: "changed", description: "Adds attached IDs to the result and skips new creation after a successful recovery." },
      { kind: "risk", description: "A failed provider lookup defers work; treating it as no match could create a duplicate bot." },
      { kind: "imports", description: "Delegates metadata recovery to the new attachment flow.", relatedFile: stepPaths.attach },
    ],
    patch: `@@ -41,12 +43,25 @@
+  const attachedCallRecordingIds: string[] = [];
   const scheduledCallRecordingIds: string[] = [];
\u0020
   for (const callRecording of pendingCallRecordings) {
+    const attachResult = await attachExistingRecallBotToCallRecording(client, {
+      callRecording,
+    });
+
+    if (attachResult.status === 'attached') {
+      attachedCallRecordingIds.push(callRecording.id);
+      continue;
+    }
+
+    // A failed lookup can hide an existing bot; creating one now could duplicate it, so defer to the next run.
+    if (attachResult.status === 'lookup-failed') {
+      continue;
+    }
\u0020
     const didScheduleRecallBot = await scheduleRecallBotForCallRecording(
       client,
       { callRecording, calendarEvent },
     );
@@ -68,3 +83,3 @@
-  return { scheduledCallRecordingIds };
+  return { attachedCallRecordingIds, scheduledCallRecordingIds };
 };`,
    status: "pending",
  },
  {
    fileId: fileId(stepPaths.lookup),
    order: 3,
    reason: "Verify the provider query is scoped by both workspace and recording metadata and only accepts active bot states.",
    evidence: [
      { kind: "changed", description: "Adds a typed lookup result that distinguishes provider failure from no existing bot." },
      { kind: "risk", description: "Workspace scoping is the boundary preventing cross-tenant bot attachment." },
      { kind: "imported-by", description: "Used by both pending scheduling and canceled-request recovery.", relatedFile: stepPaths.scheduler },
    ],
    patch: `@@ -0,0 +1,25 @@
+const ACTIVE_RECALL_BOT_STATUSES = [
+  'ready',
+  'joining_call',
+  'in_waiting_room',
+  'in_call_not_recording',
+  'recording_permission_allowed',
+  'recording_permission_denied',
+  'in_call_recording',
+];
+
+export const findScheduledRecallBotIdForCallRecording = async ({
+  callRecordingId,
+  workspaceId,
+}: {
+  callRecordingId: string;
+  workspaceId: string;
+}): Promise<FindScheduledRecallBotIdResult> => {
+  const listResult = await listScheduledRecallBots({
+    metadata: {
+      twentyWorkspaceId: workspaceId,
+      twentyCallRecordingId: callRecordingId,
+    },
+    statuses: ACTIVE_RECALL_BOT_STATUSES,
+  });`,
    status: "pending",
  },
  {
    fileId: fileId(stepPaths.attach),
    order: 4,
    reason: "Close the crash window by checking that a recovered provider bot ID is written back before the scheduler reports success.",
    evidence: [
      { kind: "changed", description: "Introduces explicit attached, no-existing-bot, and lookup-failed outcomes." },
      { kind: "risk", description: "The write-back is the durable claim that prevents the next cron run from creating a duplicate." },
      { kind: "imports", description: "Persists the recovered external bot identifier on the CallRecording.", relatedFile: "packages/twenty-apps/public/call-recorder/src/logic-functions/data/update-call-recording.util.ts" },
    ],
    patch: `@@ -0,0 +1,32 @@
+export const attachExistingRecallBotToCallRecording = async (
+  client: CoreApiClient,
+  { callRecording }: { callRecording: CallRecordingRecord },
+): Promise<AttachExistingRecallBotToCallRecordingResult> => {
+  const workspaceId = getCurrentWorkspaceId();
+
+  if (isUndefined(workspaceId)) {
+    return { status: 'no-existing-bot' };
+  }
+
+  const findResult = await findScheduledRecallBotIdForCallRecording({
+    callRecordingId: callRecording.id,
+    workspaceId,
+  });
+
+  if (!findResult.ok) return { status: 'lookup-failed' };
+  if (isUndefined(findResult.externalBotId)) return { status: 'no-existing-bot' };
+
+  await updateCallRecording(client, {
+    id: callRecording.id,
+    data: { externalBotId: findResult.externalBotId },
+  });
+
+  return { status: 'attached', externalBotId: findResult.externalBotId };
+};`,
    status: "pending",
  },
];

const chapterSeeds: Array<Omit<ReviewChapter, "fileIds" | "status" | "steps">> = [
  {
    id: "ch1",
    title: "Pending request recovery",
    summary: "Recovers a provider bot after a write-back crash before deciding whether a new bot must be scheduled.",
    entryPoint: stepPaths.trigger,
  },
  {
    id: "ch2",
    title: "Cancellation convergence",
    summary: "Retries incomplete cancellations and moves broad orphan cleanup onto a separate daily path.",
    entryPoint: "packages/twenty-apps/public/call-recorder/src/logic-functions/flows/retry-failed-recall-cancellations.util.ts",
  },
  {
    id: "ch3",
    title: "Artifact import handoff",
    summary: "Claims recording artifact imports and moves provider work behind a retryable internal route.",
    entryPoint: "packages/twenty-apps/public/call-recorder/src/logic-functions/import-call-recording-artifacts.ts",
  },
  {
    id: "ch4",
    title: "Recall provider boundary",
    summary: "Filters provider list operations by workspace metadata and carries the lifecycle state through synchronization.",
    entryPoint: "packages/twenty-apps/public/call-recorder/src/logic-functions/recall-api/list-scheduled-recall-bots.util.ts",
  },
  {
    id: "ch5",
    title: "Contracts & coverage",
    summary: "Updates shared record types, stable identifiers, configuration, and regression coverage.",
    entryPoint: "packages/twenty-apps/public/call-recorder/src/application-config.ts",
  },
];

const chapters: ReviewChapter[] = chapterSeeds.map((chapter) => ({
  ...chapter,
  fileIds: files.filter((file) => file.chapterId === chapter.id).map((file) => file.id),
  status: "pending",
  ...(chapter.id === "ch1" ? { steps: chapterOneSteps } : {}),
}));

const graphNodes: ReviewGraphNode[] = [
  { id: "p22908-n-trigger", label: "Maintenance trigger", architectureSection: "Application state", chapterId: "ch1", severity: "needs-human", changed: true, fileIds: [fileId(stepPaths.trigger)] },
  { id: "p22908-n-recovery", label: "Bot recovery", architectureSection: "Application state", chapterId: "ch1", severity: "needs-human", changed: true, fileIds: [fileId(stepPaths.scheduler), fileId(stepPaths.lookup), fileId(stepPaths.attach)] },
  { id: "p22908-n-cancel", label: "Cancellation safety", architectureSection: "Application state", chapterId: "ch2", severity: "needs-human", changed: true, fileIds: files.filter((file) => file.chapterId === "ch2" && !file.path.includes("cleanup-orphaned")).map((file) => file.id) },
  { id: "p22908-n-orphans", label: "Orphan cleanup", architectureSection: "Shared infrastructure", chapterId: "ch2", severity: "needs-human", changed: true, fileIds: files.filter((file) => file.path.includes("cleanup-orphaned")).map((file) => file.id) },
  { id: "p22908-n-lease", label: "Artifact lease", architectureSection: "Database", chapterId: "ch3", severity: "needs-human", changed: true, fileIds: files.filter((file) => file.chapterId === "ch3" && /claim|field|request/.test(file.path)).map((file) => file.id) },
  { id: "p22908-n-import", label: "Webhook import", architectureSection: "Data access / API", chapterId: "ch3", severity: "needs-human", changed: true, fileIds: files.filter((file) => file.chapterId === "ch3" && !/claim|field|request/.test(file.path)).map((file) => file.id) },
  { id: "p22908-n-provider", label: "Recall API", architectureSection: "Data access / API", chapterId: "ch4", severity: "standard", changed: true, fileIds: files.filter((file) => file.chapterId === "ch4").map((file) => file.id) },
  { id: "p22908-n-contract", label: "Contract & coverage", architectureSection: "Tooling", chapterId: "ch5", severity: "noise", changed: true, fileIds: files.filter((file) => file.chapterId === "ch5").map((file) => file.id) },
];

export const reviewPlanTwenty22908: ReviewPlan = {
  repo: "twentyhq/twenty",
  pr: 22908,
  headSha: "683e588b28873f64ae6a375a0b33187dbf316ecc",
  title: "Reduce Recall bot lifecycle reconciliation traffic",
  stats: {
    totalFiles: changedPaths.length,
    noiseFiles: files.filter((file) => file.severity === "noise").length,
    chapters: chapters.length,
  },
  chapters,
  files,
  graph: {
    nodes: graphNodes,
    edges: [
      { source: "p22908-n-trigger", target: "p22908-n-recovery", kind: "imports" },
      { source: "p22908-n-trigger", target: "p22908-n-cancel", kind: "imports" },
      { source: "p22908-n-cancel", target: "p22908-n-orphans", kind: "imports" },
      { source: "p22908-n-recovery", target: "p22908-n-provider", kind: "imports" },
      { source: "p22908-n-import", target: "p22908-n-lease", kind: "imports" },
      { source: "p22908-n-import", target: "p22908-n-provider", kind: "imports" },
      { source: "p22908-n-contract", target: "p22908-n-trigger", kind: "imports" },
    ],
  },
  repositoryGraph: {
    status: "unsupported",
    message: "Repository-wide extraction is not connected for this server-side fixture. Showing the PR evidence graph instead.",
  },
};

