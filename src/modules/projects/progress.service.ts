import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan } from "../../lib/projectAccess.js";
import { materialTotalsByProject } from "../inventory/cost.service.js";
import { dayKeyIn } from "../punches/punch.calc.js";
import { taskDto } from "./projects.mapper.js";
import { costFigures, timeFigures, timelineRows } from "./progress.calc.js";

/** GET /projects/:id/progress: the whole Progress page in one request */
export async function projectProgress(userId: string, projectId: string) {
  await requireCan(userId, "project.view");
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, projectCost: true, tasks: { orderBy: { position: "asc" } } },
  });
  if (!project) throw new HttpError(404, "Project not found");

  const today = dayKeyIn(new Date());
  const tasks = project.tasks.map(taskDto);
  const materials = (await materialTotalsByProject([projectId])).get(projectId) ?? { spent: 0, expected: 0 };

  return {
    today,
    cost: costFigures(project.projectCost?.toNumber() ?? null, tasks, materials),
    time: timeFigures(tasks, today),
    rows: timelineRows(tasks, today),
  };
}

export type ProjectProgress = Awaited<ReturnType<typeof projectProgress>>;
