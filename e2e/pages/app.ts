// The first render after a navigation: session, profile and roles, the privacy status (a server function) and the
// page's own queries, all against the shared QA project. Under CI load (three shards) that has taken 10–30 s, so
// "the page is there" waits get this budget instead of the 10 s expect default. They are state waits: they return
// as soon as the page is ready, and only a page that never loads uses the whole budget.
export const APP_LOAD_TIMEOUT = 30_000;
