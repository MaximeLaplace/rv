export function nameHue(name: string) {
  let hash = 0;
  for (const character of name) {
    hash = Math.imul(hash, 31) + character.codePointAt(0)!;
  }
  return (hash >>> 0) % 360;
}

const relativeTime = new Intl.RelativeTimeFormat("en", { style: "narrow" });
export function commitAge(date: string) {
  const seconds = (new Date(date).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 86400],
    ["month", 30 * 86400],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return relativeTime.format(Math.trunc(seconds / size), unit);
  }
  return "just now";
}
