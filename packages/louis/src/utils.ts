import { DateTime } from "effect";

/**
 * Convert DateTime to epoch seconds
 */
export const dateTime2Epoch = (dateTime: DateTime.DateTime) => {
  return Math.floor(dateTime.pipe(DateTime.toEpochMillis) / 1000);
};
