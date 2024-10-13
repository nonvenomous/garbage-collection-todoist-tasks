import { TodoistApi } from "npm:@doist/todoist-api-typescript";
import ical from "npm:node-ical";
// @deno-types="npm:@types/prompts"
import prompt from "npm:prompts";
import process from "node:process";
import chalk from "npm:chalk";
import { assert } from "@std/assert";
import "@std/dotenv/load";

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
  "Bio-Tonne": "#955b2c",
  "Restmüll-Tonne": "#323232",
  "Altpapier-Tonne": "#0091d4",
  "Wertstoff-Tonne": "#c7be01",
} as const;

type TodoistProject = { name: string; id: string };
type BinName = keyof typeof BINS;

const isInFuture = (dateString: string) => new Date(dateString) >= new Date();
const parseIcs = (filePath: string): {
  bin: BinName;
  dueString: string;
}[] => {
  const allEvents = ical.sync.parseFile(filePath);
  console.log(`File: ${filePath} parsed.`);

  console.log("Listing future relevant garbage pick up events");
  const relevantEvents: { bin: BinName; dueString: string }[] = [];

  for (const key of Object.keys(allEvents)) {
    const event = allEvents[key];

    if (event.type !== "VEVENT") {
      console.log(chalk.gray("non garbage event, type:", event?.type));
      continue;
    }

    const eventHasExpectedStructure = typeof event.summary === "object" &&
      ("val" in event.summary);
    assert(eventHasExpectedStructure, "Event has unexpected structure");

    // @ts-expect-error asserted summary is object not string
    const eventTitle = event.summary?.val;
    assert(
      typeof eventTitle === "string",
      `event.summary.val not string: '${eventTitle}'`,
    );

    const isoDate = event.start.toISOString().split("T")[0];
    const binName = eventTitle.split(" ")[0];

    if (!(binName in BINS)) {
      console.log(chalk.gray(`irrelevant bin ${binName}`));
      continue;
    }

    const binColor = BINS[binName as BinName];

    // Due timezones, "isoDate" is the day before the bin is actually collected
    const isRelevantEvent = isInFuture(isoDate) && binColor;

    if (!isRelevantEvent) {
      console.log(chalk.gray("irrelevant bin"));
      continue; // Skip irrelevant events
    }

    console.log(chalk.hex(binColor).bold(binName), isoDate);

    relevantEvents.push({
      bin: (binName as BinName),
      dueString: isoDate,
    });
  }

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

  const relevantEvents = parseIcs(icsFilePath);
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

  const testEvent = { bin: "Bio-Tonne", dueString: "today" } as const;
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
