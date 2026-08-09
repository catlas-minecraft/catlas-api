export type FeatureCoordinate = [number, number, number?];

export const areaInteriorAnchor = (
  coordinates: readonly FeatureCoordinate[],
): FeatureCoordinate => {
  const lastIndex =
    coordinates.length > 1 &&
    coordinates[0]![0] === coordinates.at(-1)![0] &&
    coordinates[0]![1] === coordinates.at(-1)![1]
      ? coordinates.length - 1
      : coordinates.length;
  const points = coordinates.slice(0, lastIndex);
  const [averageLat, averageLng] = points.reduce(
    ([latSum, lngSum], [lat, lng]) => [latSum + lat, lngSum + lng],
    [0, 0],
  );
  const fallback: FeatureCoordinate = [averageLat / points.length, averageLng / points.length];
  const scanLatitudes = [
    fallback[0],
    ...points.map(([lat], index) => (lat + points[(index + 1) % points.length]![0]) / 2),
  ];
  let widestSpan = 0;
  let anchor: FeatureCoordinate | undefined;

  for (const latitude of scanLatitudes) {
    const intersections: number[] = [];
    for (let index = 0; index < points.length; index++) {
      const [startLat, startLng] = points[index]!;
      const [endLat, endLng] = points[(index + 1) % points.length]!;
      if (
        !(
          (startLat <= latitude && endLat > latitude) ||
          (endLat <= latitude && startLat > latitude)
        )
      ) {
        continue;
      }
      const ratio = (latitude - startLat) / (endLat - startLat);
      intersections.push(startLng + (endLng - startLng) * ratio);
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = intersections[index]!;
      const right = intersections[index + 1]!;
      if (right - left > widestSpan) {
        widestSpan = right - left;
        anchor = [latitude, (left + right) / 2];
      }
    }
  }

  return anchor ?? fallback;
};
