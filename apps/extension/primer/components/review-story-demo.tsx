"use client";

import { useState } from "react";
import type { ReviewPlan } from "../lib/review-plan";
import { ReviewStoryApp } from "./review-story-app";

export function ReviewStoryDemo({ plans }: { plans: ReviewPlan[] }) {
  const [selectedPr, setSelectedPr] = useState(String(plans[0]?.pr ?? ""));
  const plan = plans.find((candidate) => String(candidate.pr) === selectedPr) ?? plans[0];

  if (!plan) return null;

  return (
    <div className="review-demo-shell">
      <ReviewStoryApp key={`${plan.repo}-${plan.pr}-${plan.headSha}`} plan={plan} />
      <label className="review-demo-selector">
        <span className="demo-selector-signal" aria-hidden="true" />
        <span className="demo-selector-copy">
          <small>Demo input</small>
          <strong>Switch pull request</strong>
        </span>
        <select
          aria-label="Select a pull request fixture"
          value={selectedPr}
          onChange={(event) => setSelectedPr(event.target.value)}
        >
          {plans.map((candidate) => (
            <option key={`${candidate.repo}-${candidate.pr}`} value={candidate.pr}>
              #{candidate.pr} · {candidate.title}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

