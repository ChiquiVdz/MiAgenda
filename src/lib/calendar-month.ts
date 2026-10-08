// A month uses complete Sunday–Saturday rows, including adjacent month days.
export function monthDays(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  const count = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  first.setDate(first.getDate() - first.getDay());
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(first);
    day.setDate(first.getDate() + index);
    return day;
  });
}

export function moveMonth(date: Date, amount: number) {
  // Anchor at the first day so moving from the 31st never skips February.
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
}
