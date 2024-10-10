# GarbageCollectionTodoistTasks

> Parses a 'Abfallkalender' `.ics` file, and turns the garbage collection dates
> into Todoist tasks

<img src="assets/example.png" width="500" alt="example">

## Setup

    # set `TODOIST_API_KEY` env var or create `.env`

    deno task dev [ICS_FILE_PATH]
    deno task run [ICS_FILE_PATH]

    # example
    deno task dev 2024.ics

## Development

    deno fmt
    deno lint
    deno check main.ts

### Calendar File

A `.ics` file is required that only includes events of garbage collection days
such as provided here
[Abfall- und Müllkalender](https://www.raunheim.de/kalender/de/stadtverwaltung/-/2/calendar_show).

## References

- [Todoist JS SDK](https://developer.todoist.com/rest/v2/?javascript=#overview)
