import { createApp } from "../server/app.js";

// Schema changes run in the production build before this handler is deployed.
// Request handlers never seed data or mutate schemas during cold starts.
export default createApp();
