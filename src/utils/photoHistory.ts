/**
 * Pure helpers for the remote's captured-photo history.
 *
 * The history is kept chronological (oldest first) so the photo viewer can lay
 * the photos out left-to-right like a camera roll: dragging right walks back in
 * time. Entries are file URIs, never base64 - see Logging Guidelines.
 */

export interface HistoryPhoto {
  uri: string;
  timestamp: number;
}

export interface AppendResult {
  /** The new history, oldest first, capped at `max`. */
  list: HistoryPhoto[];
  /** Entries pushed out by the cap - their files should be deleted. */
  evicted: HistoryPhoto[];
}

/**
 * Append a photo to the history, keeping it sorted by timestamp and capped at
 * `max` entries. Writes are async, so a slow write can deliver an older photo
 * after a newer one - sorting on insert keeps a burst in capture order.
 */
export function appendPhoto(
  list: HistoryPhoto[],
  photo: HistoryPhoto,
  max: number
): AppendResult {
  if (max <= 0) {
    return { list: [], evicted: [...list, photo] };
  }

  const combined = [...list, photo].sort((a, b) => a.timestamp - b.timestamp);
  const overflow = Math.max(0, combined.length - max);

  return {
    list: combined.slice(overflow),
    evicted: combined.slice(0, overflow),
  };
}
