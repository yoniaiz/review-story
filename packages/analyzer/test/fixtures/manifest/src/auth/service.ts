import { token } from "../shared/token.js";

export class SessionService {
  rotateToken(value: string) {
    const normalized = value.trim();
    return `${token}:${normalized}`;
  }
}
