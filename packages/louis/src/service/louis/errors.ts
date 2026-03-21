import { Data, type DateTime, type Option } from "effect";
import type { SessionId } from "../../domain/model/session/value-object/mod";

// export class SessionExpiredError extends Data.TaggedError(
//   "SessionExpiredError",
// )<{
//   readonly currentTime?: DateTime.Utc;
//   readonly expiresAt?: DateTime.Utc;
//   message: string;
// }> {
//   constructor({
//     currentTime,
//     expiresAt,
//   }: {
//     currentTime?: DateTime.Utc;
//     expiresAt?: DateTime.Utc;
//   }) {
//     super({
//       currentTime,
//       expiresAt,
//       message: `Session expired at ${expiresAt}, current time is ${currentTime}`,
//     });
//   }
// }

// export class SessionNotFoundError extends Data.TaggedError(
//   "SessionNotFoundError",
// ) {}

// export class ReplayAttackDetectedError extends Data.TaggedError(
//   "ReplayAttackDetectedError",
// )<{
//   readonly sessionId: SessionId.SessionId;
//   readonly receivedJti: Jti.Type;
//   readonly expectedJti: Option.Option<Jti.Type>;
// }> {}

// export class UnexpectedTokenUseError extends Data.TaggedError(
//   "UnexpectedTokenUseError",
// )<{
//   expected: string;
//   received: string;
// }> {}
