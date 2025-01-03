import { TodoistApi } from "npm:@doist/todoist-api-typescript";
// @deno-types="npm:@types/prompts"
import prompt from "npm:prompts";
import process from "node:process";
import chalk from "npm:chalk";
import { assert } from "@std/assert";
import * as csv from "@std/csv";
import { formatISO, parse } from "npm:date-fns";
import "@std/dotenv/load";
import { subDays } from "date-fns/subDays";

const CONSTS = {
  DRY_RUN: false,
  // task args
  PRIORITY: 3, // p2
  DURATION: 5,
  DURATIONUNIT: "minute",
  LABEL: "api",
  TIME: "9pm",
} as const;

const BINS = {
  "Bio": "#955b2c",
  "Restmüll": "#323232",
  "Papier": "#0091d4",
  "Gelbe Tonne": "#c7be01",
} as const;

type TodoistProject = { name: string; id: string };
type BinName = keyof typeof BINS;
type PickUpEvent = { bin: BinName; dueString: string };

const isInFuture = (dateString: string) => new Date(dateString) >= new Date();
function isValidDate(d: Date): d is Date {
  return !isNaN(d.getTime());
}

const parseCsv = (path: string): PickUpEvent[] => {
  const decoder = new TextDecoder("iso-8859-1");
  const data = Deno.readFileSync(path);
  const lines = csv.parse(decoder.decode(data), {
    separator: ";",
    skipFirstRow: true,
  });

  const skippedBins = new Set();

  const relevantEvents: PickUpEvent[] = [];
  for (const l of lines) {
    assert(
      "Datum" in l && "Abfallart" in l,
      `csv line has not expected keys ${Object.keys(l)}`,
    );
    const pickupDate = parse(l.Datum, "dd.MM.yyyy", new Date());
    assert(
      isValidDate(pickupDate),
      `date string: ${l.Datum} didnt resolve into valid date ${pickupDate}`,
    );
    const remindDate = subDays(pickupDate, 1);
    const dueString = formatISO(remindDate, { representation: "date" });
    const binName = l.Abfallart;

    if (!(binName in BINS)) {
      skippedBins.add(binName);
      continue;
    }

    const binColor = BINS[binName as BinName];

    console.log(chalk.hex(binColor).bold(binName), dueString);
    const isRelevantEvent = isInFuture(dueString) && binColor;

    if (!isRelevantEvent) {
      console.log(chalk.gray("irrelevant past bin", dueString));
      continue;
    }
    relevantEvents.push({
      dueString,
      bin: (binName as BinName),
    });
  }
  console.log(chalk.gray(`Skipped bin types: ${[...skippedBins].join(" & ")}`));
  return relevantEvents;
};

const createTasks = async (
  eventsToCreateByDate: Record<string, string[]>,
  projectId: string,
  api: TodoistApi,
) => {
  let taskCount = 0;

  for await (const dueString of Object.keys(eventsToCreateByDate)) {
    const eventsToCreateForDate = eventsToCreateByDate[dueString];
    const taskString = `${eventsToCreateForDate.join(" && ")} wegbringen`;

    try {
      const newTask = await api.addTask({
        content: taskString,
        dueString: `${dueString} ${CONSTS.TIME}`,
        projectId,
        priority: CONSTS.PRIORITY,
        duration: CONSTS.DURATION,
        durationUnit: CONSTS.DURATIONUNIT,
        labels: [CONSTS.LABEL],
      });

      console.log(
        `Task: "${newTask.content}" Due: ${newTask.due?.date} created`,
      );
      taskCount++;
    } catch (error) {
      console.error(`Failed creating task '${dueString}'`, error);
    }
  }
  return taskCount;
};

const userConfirmation = async (message: string) => {
  const confirmation = await prompt({
    type: "toggle",
    name: "value",
    message,
    initial: false,
    inactive: "no",
    active: "yes",
  }, {});
  return confirmation.value as boolean;
};

const selectProject = async (projects: TodoistProject[]) => {
  const response = await prompt({
    type: "autocomplete",
    name: "name",
    message: "Pick a project",
    initial: 0,
    limit: 5,
    choices: projects.map((project) => {
      return {
        title: project.name,
        value: {
          name: project.name,
          id: project.id,
        },
      };
    }),
  });
  const selectedProject: { name: string; id: string } = response.name;
  return selectedProject;
};

const getProjects = async (api: TodoistApi): Promise<TodoistProject[]> => {
  const projects = await api.getProjects();
  const parsedProjects = projects.map((project) => {
    return {
      name: project.name,
      id: project.id,
    };
  });
  return parsedProjects;
};

async function main() {
  const TODOIST_API_KEY = Deno.env.get("TODOIST_API_KEY");
  assert(TODOIST_API_KEY, "TODOIST_API_KEY env var missing");

  const icsFilePath = Deno.args[0];
  if (!icsFilePath) {
    console.error("file arg missing");
    process.exit(1);
  }

  const relevantEvents = parseCsv(icsFilePath);
  const todoistApi = new TodoistApi(TODOIST_API_KEY);

  if (relevantEvents.length < 1) {
    throw new Error("No valid events found, maybe all events are in the past?");
  }
  console.log(`--- parsed ${relevantEvents.length} events ---`);

  console.log(chalk.red(`\n--- DRY_RUN: ${CONSTS.DRY_RUN} ---\n`));

  const projects = await getProjects(todoistApi);
  console.log(`fetched ${projects.length} projects`);

  const selectedProject = await selectProject(projects);
  if (!selectedProject) {
    console.log("no project selected");
    process.exit(0);
  }

  const testEvent = { bin: "Bio", dueString: "today" } as const;
  const eventsToCreate = CONSTS.DRY_RUN ? [testEvent] : relevantEvents;

  const eventsToCreateByDate = eventsToCreate.reduce((acc, event) => {
    if (!acc[event.dueString]) acc[event.dueString] = [];
    acc[event.dueString].push(event.bin);
    return acc;
  }, <Record<string, BinName[]>> {});
  console.log("tasks to be created", eventsToCreateByDate);

  const confirmation = await userConfirmation(
    `Creating ${
      Object.keys(eventsToCreateByDate).length
    } Tasks in project "${selectedProject.name}". Confirm?`,
  );
  if (!confirmation) {
    console.error("Creation of tasks canceled.");
    process.exit(1);
  }

  const taskCount = await createTasks(
    eventsToCreateByDate,
    selectedProject.id,
    todoistApi,
  );
  console.log(`Summary: ${taskCount} task(s) created`);
  process.exit(0);
}

await main();
