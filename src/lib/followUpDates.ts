/** Next strictly later pending follow-up for the same requirement (or unlinked client). */
export function nextFollowUpDates<T extends { id: string; clientId: string; enquiryId: string | null; dueDateTime: Date }>(tasks: T[]): Map<string, Date | null> {
  const dates = new Map<string, Date | null>();
  const last = new Map<string, { due: Date; next: Date | null }>();
  for (const task of [...tasks].sort((a, b) => b.dueDateTime.getTime() - a.dueDateTime.getTime())) {
    const key = task.enquiryId ? `enquiry:${task.enquiryId}` : `client:${task.clientId}`;
    const following = last.get(key);
    const next = following ? (following.due > task.dueDateTime ? following.due : following.next) : null;
    dates.set(task.id, next);
    last.set(key, { due: task.dueDateTime, next });
  }
  return dates;
}
