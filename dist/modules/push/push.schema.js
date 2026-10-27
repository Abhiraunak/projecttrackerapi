import { z } from "zod";
import { isAllowedPushEndpoint } from "./push.endpoints.js";
const key = z.string().min(10).max(200).regex(/^[A-Za-z0-9_-]+=*$/, "Not a valid key");
const endpoint = z.string().max(1000).refine(isAllowedPushEndpoint, "Not a known push service");
/** What the browser's PushSubscription.toJSON() gives */
export const subscribeSchema = z.object({
    body: z.object({ endpoint, keys: z.object({ p256dh: key, auth: key }) }),
});
export const unsubscribeSchema = z.object({ body: z.object({ endpoint: z.string().max(1000) }) });
//# sourceMappingURL=push.schema.js.map