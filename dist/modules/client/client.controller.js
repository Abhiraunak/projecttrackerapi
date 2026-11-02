import { HttpError } from "../../lib/error.js";
import { clientPortal, invoice, myProjects, uploadProof } from "./client.service.js";
import { addClient, addDelay, clientOverview, clientProject, createInstalment, decideProof, deleteInstalment, recordPayment, removeClient, requestPayment, resetClientPassword, setAdvanceOverride, updateInstalment, } from "./clientAdmin.service.js";
const me = (req) => req.user.sub;
/* ------------------------------ client portal ------------------------------ */
export const projects = async (req, res) => void res.json({ projects: await myProjects(me(req)) });
export const portal = async (req, res) => void res.json(await clientPortal(me(req), req.params.id));
export const getInvoice = async (req, res) => void res.json(await invoice(me(req), req.params.id));
export async function sendProof(req, res) {
    if (!req.file)
        throw new HttpError(400, "Attach the payment screenshot or PDF.");
    res.status(201).json({ proof: await uploadProof(me(req), req.params.id, req.body, req.file) });
}
/* ---------------------------------- admin ---------------------------------- */
export const overview = async (req, res) => void res.json(await clientOverview(me(req)));
export const project = async (req, res) => void res.json(await clientProject(me(req), req.params.id));
export const addProjectClient = async (req, res) => void res.status(201).json(await addClient(me(req), req.params.id, req.body));
export async function removeProjectClient(req, res) {
    await removeClient(me(req), req.params.id, req.params.userId);
    res.status(204).end();
}
export const resetPassword = async (req, res) => void res.json(await resetClientPassword(me(req), req.params.userId));
export const addInstalment = async (req, res) => void res.status(201).json(await createInstalment(me(req), req.params.id, req.body));
export async function editInstalment(req, res) {
    await updateInstalment(me(req), req.params.id, req.body);
    res.status(204).end();
}
export async function removeInstalment(req, res) {
    await deleteInstalment(me(req), req.params.id);
    res.status(204).end();
}
export async function askForPayment(req, res) {
    await requestPayment(me(req), req.params.id);
    res.status(204).end();
}
export const addPayment = async (req, res) => void res.status(201).json({ proof: await recordPayment(me(req), req.params.id, req.body) });
export const approveProof = async (req, res) => void res.json({ proof: await decideProof(me(req), req.params.id, true, req.body.note) });
export const rejectProof = async (req, res) => void res.json({ proof: await decideProof(me(req), req.params.id, false, req.body.note) });
export async function advance(req, res) {
    await setAdvanceOverride(me(req), req.params.id, req.body.override);
    res.status(204).end();
}
export const delay = async (req, res) => void res.status(201).json(await addDelay(me(req), req.params.id, req.body));
//# sourceMappingURL=client.controller.js.map