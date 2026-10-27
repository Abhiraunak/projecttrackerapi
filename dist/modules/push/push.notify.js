import { prisma } from "../../lib/prisma.js";
import { logger } from "../../config/logger.js";
import { sendToUsers } from "./push.service.js";
const KIND_LABEL = { IMAGE: "drawing", PDF: "PDF drawing", CAD: "AutoCAD drawing" };
/**
 * "Anita shared 'Ground floor plan' with you". Sent in the background, after the share is saved.
 * Only people who may use Drawings are told: anyone else couldn't open it.
 */
export function notifyDrawingShared(drawing, recipientIds) {
    if (recipientIds.length === 0)
        return;
    void (async () => {
        const allowed = await prisma.user.findMany({
            where: { id: { in: recipientIds }, OR: [{ role: "ADMIN" }, { permissions: { has: "drawings.use" } }] },
            select: { id: true },
        });
        const params = new URLSearchParams({ tab: "shared", q: drawing.title });
        await sendToUsers(allowed.map((u) => u.id), {
            title: "Drawing shared with you",
            body: `${drawing.owner.email} shared the ${KIND_LABEL[drawing.kind]} "${drawing.title}"`,
            url: `/dashboard/drawing?${params}`,
            tag: `drawing-${drawing.id}`,
        });
    })().catch((err) => logger.error({ err, drawingId: drawing.id }, "share notification failed"));
}
//# sourceMappingURL=push.notify.js.map