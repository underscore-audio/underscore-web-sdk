/**
 * MSW server setup for Node.js tests.
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";

export const server = setupServer(...handlers);
