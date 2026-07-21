import { createHash } from "node:crypto";
import {
  DiffSnapshotSchema,
  type DiffSnapshot,
} from "@review-story/contracts";
import type { GitHubChangedFile, PullMetadata } from "./types.js";

export function buildDiffSnapshot(
  metadata: PullMetadata,
  files: GitHubChangedFile[],
): DiffSnapshot {
  return DiffSnapshotSchema.parse({
    repo_node_id: metadata.repoNodeId,
    pr: metadata.pullNumber,
    base_oid: metadata.baseOid,
    head_oid: metadata.headOid,
    files: [...files]
      .sort((left, right) => left.filename.localeCompare(right.filename))
      .map((file) => ({
        path: file.filename,
        previous_path: file.previousFilename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
        patch_hash: createHash("sha256")
          .update(file.patch ?? "")
          .digest("hex"),
      })),
  });
}
