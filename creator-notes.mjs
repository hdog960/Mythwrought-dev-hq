import { actions, button, el, header, muted, panel, readLocal, saveLocal, time } from './ui.mjs';

const key = 'creator-notes-v1';
const notebookKey = 'creator-notebook-link-v1';
const limits = { title: 120, body: 6000, items: 100 };

export function creatorNotes() {
  const data = readLocal(key, []);
  return Array.isArray(data) ? data.filter(item => item && typeof item.id === 'string' &&
    typeof item.title === 'string' && typeof item.body === 'string' && typeof item.updatedAt === 'string' &&
    typeof item.archived === 'boolean') : [];
}

function notebookURL(value) {
  if (typeof value !== 'string' || value.length > 240) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com' &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      /^\/space\/page_[0-9a-f]{32}\/?$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function privateNotebook(notify) {
  const initial = notebookURL(readLocal(notebookKey, null));
  const input = Object.assign(el('input'), { type: 'url', maxLength: 240, value: initial ?? '',
    placeholder: 'https://chatgpt.com/space/…' });
  const destination = el('div', 'actions');
  const form = el('form', '', el('label', '', 'Private Page link', input),
    actions(button('Save Page link', null, '', 'submit')));
  function renderLink(url) {
    const anchor = url ? Object.assign(el('a', 'button primary', 'Open private Page'),
      { href: url, target: '_blank', rel: 'noopener noreferrer' }) : null;
    destination.replaceChildren(...(anchor ? [anchor] : []));
    destination.hidden = !anchor;
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = input.value.trim();
    const url = value ? notebookURL(value) : null;
    if (value && !url) {
      notify('Enter a canonical ChatGPT Page link.');
      return;
    }
    if (!saveLocal(notebookKey, url)) {
      notify('Could not save the Page link.');
      return;
    }
    renderLink(url);
    notify(url ? 'Private Page link saved on this device' : 'Private Page link removed from this device');
  });
  renderLink(initial);
  return panel('Private notebook', [
    muted('Save a shortcut to a private ChatGPT Page. Add notes on that Page when you want Codex to look them up in a connected chat.'),
    form, destination,
  ], { iconName: 'book' });
}

function asMarkdown(note) {
  return `## ${note.title}\n\n${note.body}`;
}

export function creatorNotesPage({ notify, copy }) {
  let notes = creatorNotes();
  let editing = null;
  let showArchive = false;
  const title = Object.assign(el('input'), { maxLength: limits.title, required: true });
  const body = Object.assign(el('textarea'), { maxLength: limits.body, rows: 7, required: true });
  const save = button('Save note', null, 'primary', 'submit');
  const cancel = button('Cancel edit', reset);
  cancel.hidden = true;
  const form = el('form', '', el('label', '', 'Title', title), el('label', '', 'Note', body), actions(save, cancel));
  const noteList = el('div', 'stack');
  const archiveToggle = button('Show archive', () => {
    showArchive = !showArchive;
    archiveToggle.textContent = showArchive ? 'Show current notes' : 'Show archive';
    renderNotes();
  });
  const exportNotes = button('Export Markdown', () => {
    if (!notes.length) return;
    const markdown = '# Mythwrought Creator Notes\n\n' + notes.map(note =>
      asMarkdown(note) + (note.archived ? '\n\n*Archived*' : '')).join('\n\n---\n\n') + '\n';
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const download = Object.assign(el('a'), { href: url, download: 'mythwrought-creator-notes.md' });
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  });

  function persist(next) {
    if (next.length > limits.items || !saveLocal(key, next)) {
      notify('Could not save the note. Check available browser storage.');
      return false;
    }
    notes = next;
    renderNotes();
    return true;
  }

  function reset() {
    editing = null;
    form.reset();
    cancel.hidden = true;
  }

  function edit(note) {
    editing = note.id;
    title.value = note.title;
    body.value = note.body;
    cancel.hidden = false;
    title.focus();
    title.scrollIntoView({ block: 'nearest' });
  }

  function renderNotes() {
    exportNotes.disabled = notes.length === 0;
    const visible = notes.filter(note => note.archived === showArchive);
    noteList.replaceChildren(...(visible.length ? visible.map(note => panel(note.title, [
      el('p', 'wrap-text', note.body),
      el('p', 'row-meta', 'Updated ', time(note.updatedAt)),
      actions(button('Copy for Codex', () => copy(asMarkdown(note), 'Note copied'), 'primary'),
        button('Edit', () => edit(note)),
        button(note.archived ? 'Restore' : 'Archive', () => {
          if (persist(notes.map(item => item.id === note.id ? { ...item, archived: !item.archived } : item)) && editing === note.id) reset();
        })),
    ])) : [muted(showArchive ? 'No archived notes.' : 'No saved notes on this device.')]));
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = body.value.trim();
    const name = title.value.trim();
    if (!text || !name) {
      notify('Enter a title and note.');
      return;
    }
    const previous = notes.find(item => item.id === editing);
    const note = { id: previous?.id ?? crypto.randomUUID(), title: name, body: text,
      updatedAt: new Date().toISOString(), archived: previous?.archived ?? false };
    if (persist([note, ...notes.filter(item => item.id !== note.id)])) {
      reset();
      notify('Creator note saved');
    }
  });

  renderNotes();
  return [header('Creator Notes', 'Saved in this browser. Copy a note into a Codex chat or export this notebook to share it privately.',
    actions(exportNotes, archiveToggle)),
  el('div', 'main-grid', el('div', 'stack', panel('Write a note', form, { iconName: 'book' }), privateNotebook(notify)), noteList)];
}
