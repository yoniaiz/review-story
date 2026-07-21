import type { ReviewStep } from "../lib/review-plan";

// Stable pre-hackathon fixture. It lets the review UI progress independently
// while the real diff and planning pipelines are built against the same shape.
export const reviewStepsByChapter: Record<string, ReviewStep[]> = {
  ch1: [
    {
      fileId: "f-7bf4b5532",
      order: 1,
      reason: "Start at the composition boundary: this component decides whether the record view enters the new weekly calendar path.",
      evidence: [
        { kind: "entry-point", description: "Recommended chapter entry point" },
        { kind: "imports", description: "Routes into both month and week calendar implementations", relatedFile: "RecordCalendarWeek.tsx" },
        { kind: "risk", description: "A wrong branch changes the layout shown to every calendar user" },
      ],
      patch: `@@ -18,6 +18,7 @@ import { RecordCalendarMonth } from './month/components/RecordCalendarMonth';
+import { RecordCalendarWeek } from './week/components/RecordCalendarWeek';
 
 export const RecordCalendar = () => {
   const calendarLayout = useRecordCalendarLayout();
@@ -31,6 +32,10 @@ export const RecordCalendar = () => {
+  if (calendarLayout === ViewCalendarLayout.WEEK) {
+    return <RecordCalendarWeek />;
+  }
+
   return <RecordCalendarMonth />;
 };`,
      status: "pending",
    },
    {
      fileId: "f-6fd14f857",
      order: 2,
      reason: "Confirm the capability gate before reading rendering details; it defines when the new layout is considered valid.",
      evidence: [
        { kind: "changed", description: "Adds the weekly layout to the supported calendar modes" },
        { kind: "imported-by", description: "Consumed by the calendar entry component", relatedFile: "RecordCalendar.tsx" },
      ],
      patch: `@@ -7,7 +7,10 @@ export const getSupportedRecordCalendarLayout = (
   layout: ViewCalendarLayout,
 ) => {
-  return layout === ViewCalendarLayout.MONTH ? layout : ViewCalendarLayout.MONTH;
+  return [
+    ViewCalendarLayout.MONTH,
+    ViewCalendarLayout.WEEK,
+  ].includes(layout) ? layout : ViewCalendarLayout.MONTH;
 };`,
      status: "pending",
    },
    {
      fileId: "f-14e1dc1d9",
      order: 3,
      reason: "Trace how a reviewer-visible layout choice reaches the new calendar mode before following its downstream state changes.",
      evidence: [
        { kind: "changed", description: "Adds the week option to the layout menu" },
        { kind: "imports", description: "Delegates the state transition to the shared layout hook", relatedFile: "useSetViewTypeFromLayoutOptionsMenu.ts" },
      ],
      patch: `@@ -42,6 +42,12 @@ export const ObjectOptionsDropdownLayoutContent = () => (
     <MenuItem accent="secondary" text="Month" onClick={setMonthLayout} />
+    <MenuItem
+      accent="secondary"
+      text="Week"
+      onClick={setWeekLayout}
+    />
   </MenuItemSelect />
 );`,
      status: "pending",
    },
    {
      fileId: "f-52e3febd5",
      order: 4,
      reason: "Verify the state transition that persists the selected layout and closes the options menu.",
      evidence: [
        { kind: "imported-by", description: "Called from the layout options menu", relatedFile: "ObjectOptionsDropdownLayoutContent.tsx" },
        { kind: "risk", description: "Touches persisted view configuration rather than temporary component state" },
      ],
      patch: `@@ -20,9 +20,12 @@ export const useSetViewTypeFromLayoutOptionsMenu = () => {
-  const setViewType = (viewType: ViewType) => {
-    setCurrentView({ type: viewType });
+  const setViewType = (
+    viewType: ViewType,
+    calendarLayout?: ViewCalendarLayout,
+  ) => {
+    setCurrentView({ type: viewType, calendarLayout });
     closeDropdown();
   };
`,
      status: "pending",
    },
    {
      fileId: "f-b997d585f",
      order: 5,
      reason: "Check that the existing month path remains unchanged after introducing the sibling week implementation.",
      evidence: [
        { kind: "imported-by", description: "Still selected by the calendar entry component", relatedFile: "RecordCalendar.tsx" },
        { kind: "risk", description: "Regression checkpoint for the existing default layout" },
      ],
      patch: `@@ -14,7 +14,8 @@ export const RecordCalendarMonth = () => {
   const visibleRecords = useRecordCalendarMonthRecords();
 
-  return <RecordCalendarMonthBody records={visibleRecords} />;
+  return <RecordCalendarMonthBody
+    records={visibleRecords}
+  />;
 };`,
      status: "pending",
    },
    {
      fileId: "f-766836fd4",
      order: 6,
      reason: "Finish at the query boundary and verify that the visible date range still constrains the records loaded for the calendar.",
      evidence: [
        { kind: "imports", description: "Builds the date overlap filter", relatedFile: "getRecordCalendarDateRangeOverlapFilter.ts" },
        { kind: "risk", description: "An incorrect range can silently omit or over-fetch calendar records" },
      ],
      patch: `@@ -26,8 +26,11 @@ export const useRecordCalendarQueryDateRangeFilter = () => {
   const dateRange = useRecordCalendarMonthDaysRange();
 
   return getRecordCalendarDateRangeOverlapFilter({
-    start: dateRange.start,
-    end: dateRange.end,
+    rangeStart: dateRange.start,
+    rangeEnd: dateRange.end,
+    startFieldMetadataId,
+    endFieldMetadataId,
   });
 };`,
      status: "pending",
    },
  ],
};

