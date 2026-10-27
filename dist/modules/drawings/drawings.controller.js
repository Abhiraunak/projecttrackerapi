import { createDrawing, deleteDrawing, listDrawings, replaceShares } from "./drawings.service.js";
import { listQuerySchema } from "./drawings.schema.js";
import { HttpError } from "../../lib/error.js";
const viewerId = (req) => req.user.sub;
export async function list(req, res) {
    const query = listQuerySchema.parse(req.query);
    res.json(await listDrawings(viewerId(req), query));
}
export async function create(req, res) {
    if (!req.file)
        throw new HttpError(400, "Choose a file to upload.");
    const drawing = await createDrawing({ ownerId: viewerId(req), ...req.body, file: req.file });
    res.status(201).json({ drawing });
}
export async function share(req, res) {
    const drawing = await replaceShares(viewerId(req), req.params.id, req.body.userIds);
    res.json({ drawing });
}
export async function remove(req, res) {
    await deleteDrawing(viewerId(req), req.params.id);
    res.status(204).end();
}
//# sourceMappingURL=drawings.controller.js.map