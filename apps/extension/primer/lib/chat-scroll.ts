export interface ScrollPosition {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function distanceFromScrollEnd(position: ScrollPosition): number {
  return Math.max(0, position.scrollHeight - position.scrollTop - position.clientHeight);
}

export function isNearScrollEnd(position: ScrollPosition, threshold = 64): boolean {
  return distanceFromScrollEnd(position) <= threshold;
}
