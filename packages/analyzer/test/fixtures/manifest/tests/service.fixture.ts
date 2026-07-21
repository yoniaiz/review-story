import { SessionService } from "../src/auth/service.js";

new SessionService().rotateToken("fixture");
