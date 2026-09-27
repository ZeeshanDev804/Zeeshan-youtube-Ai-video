import fs from 'fs';
import path from 'path';

const STORE_DIRECTORY = path.resolve('data');
const STORE_FILE = path.join(STORE_DIRECTORY, 'store.json');

function ensureStore() {
  if (!fs.existsSync(STORE_DIRECTORY)) {
    fs.mkdirSync(STORE_DIRECTORY, { recursive: true });
  }

  if (!fs.existsSync(STORE_FILE)) {
    const initialData = {
      projects: [],
      scripts: [],
      renders: [],
      history: []
    };

    fs.writeFileSync(
      STORE_FILE,
      JSON.stringify(initialData, null, 2),
      'utf8'
    );
  }
}

function readStore() {
  ensureStore();

  try {
    const content = fs.readFileSync(STORE_FILE, 'utf8');

    if (!content.trim()) {
      return {
        projects: [],
        scripts: [],
        renders: [],
        history: []
      };
    }

    return JSON.parse(content);
  } catch (error) {
    console.error('[Store] Failed to read store:', error.message);

    return {
      projects: [],
      scripts: [],
      renders: [],
      history: []
    };
  }
}

function writeStore(data) {
  ensureStore();

  fs.writeFileSync(
    STORE_FILE,
    JSON.stringify(data, null, 2),
    'utf8'
  );

  return data;
}

function createId(prefix = 'item') {
  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function getStore() {
  return readStore();
}

export function saveStore(data) {
  return writeStore(data);
}

export function addProject(project) {
  const store = readStore();

  const item = {
    id: project?.id || createId('project'),
    createdAt: project?.createdAt || new Date().toISOString(),
    ...project
  };

  store.projects.push(item);
  writeStore(store);

  return item;
}

export function addScript(script) {
  const store = readStore();

  const item = {
    id: script?.id || createId('script'),
    createdAt: script?.createdAt || new Date().toISOString(),
    ...script
  };

  store.scripts.push(item);
  writeStore(store);

  return item;
}

export function addRender(render) {
  const store = readStore();

  const item = {
    id: render?.id || createId('render'),
    createdAt: render?.createdAt || new Date().toISOString(),
    ...render
  };

  store.renders.push(item);
  writeStore(store);

  return item;
}

export function addHistory(entry) {
  const store = readStore();

  const item = {
    id: entry?.id || createId('history'),
    createdAt: entry?.createdAt || new Date().toISOString(),
    ...entry
  };

  store.history.push(item);
  writeStore(store);

  return item;
}

export function getProjects() {
  return readStore().projects;
}

export function getScripts() {
  return readStore().scripts;
}

export function getRenders() {
  return readStore().renders;
}

export function getHistory() {
  return readStore().history;
}

export function getProjectById(id) {
  return readStore().projects.find(
    project => project.id === id
  ) || null;
}

export function getScriptById(id) {
  return readStore().scripts.find(
    script => script.id === id
  ) || null;
}

export function getRenderById(id) {
  return readStore().renders.find(
    render => render.id === id
  ) || null;
}

export function updateRender(id, updates = {}) {
  const store = readStore();

  const index = store.renders.findIndex(
    render => render.id === id
  );

  if (index === -1) {
    return null;
  }

  store.renders[index] = {
    ...store.renders[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  writeStore(store);

  return store.renders[index];
}

export function updateProject(id, updates = {}) {
  const store = readStore();

  const index = store.projects.findIndex(
    project => project.id === id
  );

  if (index === -1) {
    return null;
  }

  store.projects[index] = {
    ...store.projects[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  writeStore(store);

  return store.projects[index];
}

export function clearStore() {
  const emptyStore = {
    projects: [],
    scripts: [],
    renders: [],
    history: []
  };

  writeStore(emptyStore);

  return emptyStore;
}

export function getStorePath() {
  ensureStore();
  return STORE_FILE;
}
