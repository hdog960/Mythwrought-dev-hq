import { isId, isISO } from './model.mjs';
import { actions, badge, button, el, header, muted, panel, readLocal, saveLocal, time } from './ui.mjs';

const categories = ['Biomes', 'Magic', 'Combat', 'Skills', 'Crafting', 'Mobs', 'Bosses', 'Quests', 'Story',
  'Settlements', 'Exploration', 'Progression', 'Multiplayer', 'Performance', 'Quality of life', 'Other'];
const priorities = ['Low', 'Normal', 'High'];
const allowedFields = ['id', 'title', 'notes', 'category', 'related', 'dependencies', 'priority', 'tags', 'createdAt', 'archived', 'proposal'];
const maxIdeas = 400;

function valid(item) {
  return item && Object.keys(item).every(key => allowedFields.includes(key)) && isId(item.id) &&
    typeof item.title === 'string' && Boolean(item.title.trim()) && item.title.length <= 120 &&
    typeof item.notes === 'string' && item.notes.length <= 3000 && categories.includes(item.category) &&
    typeof item.related === 'string' && item.related.length <= 120 && priorities.includes(item.priority) &&
    typeof item.dependencies === 'string' && item.dependencies.length <= 250 &&
    Array.isArray(item.tags) && item.tags.length <= 12 && item.tags.every(tag => typeof tag === 'string' && tag.length <= 40) &&
    isISO(item.createdAt) && typeof item.archived === 'boolean' && typeof item.proposal === 'boolean';
}

function labeled(name, input) {
  return el('label', '', name, input);
}

function input(name, maxLength, required = false) {
  const node = el('input');
  Object.assign(node, { name, maxLength, required });
  return node;
}

function select(name, choices, initial) {
  const node = el('select', '', choices.map(choice => el('option', '', choice)));
  node.name = name;
  node.value = initial;
  return node;
}

export function ideasPage(notify) {
  let ideas = readLocal('ideas-v1', []);
  if (!Array.isArray(ideas)) ideas = [];
  ideas = ideas.filter(valid);
  const search = input('search', 100);
  search.type = 'search';
  search.placeholder = 'Search ideas';
  const archiveToggle = el('input');
  archiveToggle.type = 'checkbox';
  archiveToggle.className = 'checkbox';
  const results = el('div', 'stack');
  const title = input('title', 120, true);
  const notes = el('textarea');
  Object.assign(notes, { name: 'notes', maxLength: 3000, rows: 3 });
  const related = input('related', 120);
  const dependencies = input('dependencies', 250);
  const tags = input('tags', 250);
  const category = select('category', categories, 'Other');
  const priority = select('priority', priorities, 'Normal');
  const form = el('form', '', labeled('Title', title), labeled('Notes', notes),
    el('div', 'form-grid', labeled('Category', category), labeled('Priority', priority),
      labeled('Related project', related), labeled('Potential dependencies', dependencies)),
    labeled('Tags, separated by commas', tags), actions(button('Save idea', null, 'primary', 'submit')));
  const file = el('input');
  Object.assign(file, { type: 'file', accept: '.json,application/json', hidden: true });

  function save(next, message) {
    if (next.length > maxIdeas || !saveLocal('ideas-v1', next)) {
      notify('Idea storage is full or unavailable. Export your existing ideas to keep a copy.');
      return false;
    }
    ideas = next;
    render();
    if (message) notify(message);
    return true;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const matches = ideas.filter(item => item.archived === archiveToggle.checked &&
      [item.title, item.notes, item.category, item.related, ...item.tags].some(value => value.toLowerCase().includes(query)));
    results.replaceChildren(...(matches.length ? matches.map(item => panel(item.title,
      [muted(`${item.category} · ${item.priority} priority`), el('p', 'wrap-text', item.notes),
        item.related && muted(`Related project — ${item.related}`),
        item.dependencies && muted(`Dependencies — ${item.dependencies}`),
        item.tags.length ? muted(item.tags.join(' · ')) : null,
        el('p', 'row-meta', time(item.createdAt)),
        actions(button(item.archived ? 'Restore' : 'Archive', () =>
          save(ideas.map(row => row.id === item.id ? { ...row, archived: !item.archived } : row), item.archived ? 'Idea restored' : 'Idea archived')),
        !item.proposal && button('Create roadmap proposal', () =>
          save(ideas.map(row => row.id === item.id ? { ...row, proposal: true } : row), 'Local roadmap proposal saved')))],
      { end: item.proposal ? badge('Local proposal', 'purple') : null })) : [muted('No ideas match this view.')]));
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const idea = { id: crypto.randomUUID(), title: title.value.trim(), notes: notes.value,
      category: category.value, related: related.value.trim(), dependencies: dependencies.value.trim(), priority: priority.value,
      tags: tags.value.split(',').map(value => value.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
      createdAt: new Date().toISOString(), archived: false, proposal: false };
    if (valid(idea) && save([idea, ...ideas], 'Idea saved on this device')) {
      form.reset();
      category.value = 'Other';
      priority.value = 'Normal';
    }
  });

  function exportIdeas() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, ideas }, null, 2)], { type: 'application/json' }));
    const download = el('a');
    Object.assign(download, { href: url, download: 'mythwrought-ideas.json' });
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  file.addEventListener('change', async () => {
    try {
      const incoming = file.files[0];
      if (!incoming) return;
      if (incoming.size > 2_000_000) throw new Error('Import is too large');
      const data = JSON.parse(await incoming.text());
      if (data.schemaVersion !== 1 || !Array.isArray(data.ideas) || !data.ideas.every(valid)) throw new Error('Invalid import');
      const merged = new Map(ideas.map(item => [item.id, item]));
      for (const item of data.ideas) if (!merged.has(item.id)) merged.set(item.id, item);
      save([...merged.values()], 'Idea import complete');
    } catch { notify('Import failed. Choose a valid Mythwrought idea export.'); }
    finally { file.value = ''; }
  });
  search.addEventListener('input', render);
  archiveToggle.addEventListener('change', render);
  render();
  return [header('Idea Vault', 'Ideas and roadmap proposals are stored on this device.',
    actions(button('Export JSON', exportIdeas), button('Import JSON', () => file.click()), file)),
    el('div', 'main-grid', panel('Capture an idea', form), el('div', 'stack', panel('Saved ideas',
      [labeled('Search ideas', search), el('label', 'check-label', archiveToggle, 'Show archive')]), results))];
}
