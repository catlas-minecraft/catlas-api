export type GeometryCoordinate = [number, number];

export const areaInteriorAnchor = (
  coordinates: readonly GeometryCoordinate[],
): GeometryCoordinate => {
  const lastIndex =
    coordinates.length > 1 &&
    coordinates[0]![0] === coordinates.at(-1)![0] &&
    coordinates[0]![1] === coordinates.at(-1)![1]
      ? coordinates.length - 1
      : coordinates.length;
  const points = coordinates.slice(0, lastIndex);
  if (points.length === 0) return [0, 0];

  const [averageX, averageY] = points.reduce(
    ([xSum, ySum], [x, y]) => [xSum + x, ySum + y],
    [0, 0],
  );
  const fallback: GeometryCoordinate = [averageX / points.length, averageY / points.length];
  const scanLines = [
    fallback[1],
    ...points.map(([, y], index) => (y + points[(index + 1) % points.length]![1]) / 2),
  ];
  let widestSpan = 0;
  let anchor: GeometryCoordinate | undefined;

  for (const scanLine of scanLines) {
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const [startX, startY] = points[index]!;
      const [endX, endY] = points[(index + 1) % points.length]!;
      if (!((startY <= scanLine && endY > scanLine) || (endY <= scanLine && startY > scanLine))) {
        continue;
      }
      const ratio = (scanLine - startY) / (endY - startY);
      intersections.push(startX + (endX - startX) * ratio);
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = intersections[index]!;
      const right = intersections[index + 1]!;
      if (right - left > widestSpan) {
        widestSpan = right - left;
        anchor = [(left + right) / 2, scanLine];
      }
    }
  }

  return anchor ?? fallback;
};

export const anchorForPath = (
  coordinates: readonly GeometryCoordinate[],
  geometryKind: "line" | "area",
): GeometryCoordinate => {
  if (geometryKind === "area") return areaInteriorAnchor(coordinates);

  const lengths = coordinates.slice(1).map(([x, y], index) => {
    const previous = coordinates[index]!;
    return Math.hypot(x - previous[0], y - previous[1]);
  });
  const halfway = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (traversed + length >= halfway) {
      const start = coordinates[index]!;
      const end = coordinates[index + 1]!;
      const ratio = length === 0 ? 0 : (halfway - traversed) / length;
      return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
    }
    traversed += length;
  }
  return coordinates[0] ?? [0, 0];
};
