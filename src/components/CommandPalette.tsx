import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { fetchWorkspaceEntities } from '../api/palette';
import { goToPages } from '../navigation';
import type { EntityKind, NamedEntity } from '../api/palette';
import activityIcon from '../assets/activity.svg';
import bellIcon from '../assets/bell.svg';
import bookIcon from '../assets/book.svg';
import botIcon from '../assets/bot.svg';
import boxIcon from '../assets/box.svg';
import chartNetworkIcon from '../assets/chart-network.svg';
import codeIcon from '../assets/code.svg';
import databaseIcon from '../assets/database.svg';
import filterIcon from '../assets/filter.svg';
import lockKeyholeIcon from '../assets/lock-keyhole.svg';
import memoryIcon from '../assets/memory.svg';
import searchIcon from '../assets/search.svg';
import bugIcon from '../assets/bug.svg';
import toolIcon from '../assets/tool.svg';
import { matches, usePaletteShortcut } from '../session/shortcut';
import styles from './CommandPalette.module.css';

export interface CommandPaletteProps {
  /** The workspace the pages belong to; without one only the rest is offered. */
  workspacePath?: string;
  /** Whether this person may see the admin pages at all. */
  showAdmin?: boolean;
  /** False where the installation has no chat, so the palette does not offer it. */
  showChat?: boolean;
}

interface Command {
  label: string;
  /** Which part of the product it belongs to, shown beside the label. */
  where: string;
  to: string;
  /**
   * The same file the menu draws for this destination, so a row here and the
   * item in the sidebar are recognisably the same thing.
   */
  icon: string;
  /** Words somebody might type for it that are not in the label. */
  also?: string;
}

/**
 * What each kind of thing is drawn as.
 *
 * Taken from the sidebars rather than chosen again: `WorkspaceSidebar` already
 * decided that an action is an activity line and a variable is a padlock, and two
 * answers to that question is one too many.
 */
const KIND_ICON: Record<EntityKind, string> = {
  Workflow: chartNetworkIcon,
  Trigger: bellIcon,
  Action: activityIcon,
  Condition: filterIcon,
  Function: codeIcon,
  Agent: botIcon,
  Object: boxIcon,
  Variable: lockKeyholeIcon,
  Memory: memoryIcon,
  Model: databaseIcon,
  Skill: bookIcon,
  Tool: toolIcon,
  Issue: bugIcon,
};

/** How many are worth showing at once; the rest are found by typing more. */
const SHOWN = 10;

/**
 * Where one of the workspace's own things is edited.
 *
 * Every kind but one opens on its own page. A variable does not have one — the
 * catalogue screen edits them in place — so it goes to the catalogue it is in,
 * which is as close as the routes allow.
 */
const EDIT_PATH: Record<EntityKind, (workspace: string, id: string) => string> = {
  Workflow: (workspace, id) => `${workspace}/workflows/${id}/editor`,
  // By the number people say, which is what the tracker's own addresses use.
  Issue: (workspace, number) => `${workspace}/issues/${number}`,
  Trigger: (workspace, id) => `${workspace}/triggers/${id}`,
  Action: (workspace, id) => `${workspace}/actions/${id}`,
  Condition: (workspace, id) => `${workspace}/conditions/${id}`,
  Function: (workspace, id) => `${workspace}/functions/${id}`,
  Agent: (workspace, id) => `${workspace}/agents/${id}/settings`,
  Object: (workspace, id) => `${workspace}/objects/${id}`,
  Variable: (workspace) => `${workspace}/variables`,
  Memory: (workspace, id) => `${workspace}/memory/${id}`,
  Model: (workspace, id) => `${workspace}/models/${id}`,
  Skill: (workspace, id) => `${workspace}/skills/${id}`,
  Tool: (workspace, id) => `${workspace}/tools/${id}`,
};

/**
 * How well a command answers what was typed.
 *
 * Lower is better, and the order matters more now than it did when this offered
 * sixteen fixed pages: typing `che` should not bury the action called `Check
 * stock` under every page whose description happens to contain those letters.
 * What was named exactly comes first, then what starts with it, then what
 * contains it, and last what is only found by the words it is also known by.
 */
function rank(one: Command, needle: string): number {
  const label = one.label.toLowerCase();
  if (label === needle) return 0;
  if (label.startsWith(needle)) return 1;
  if (label.includes(needle)) return 2;
  if (`${one.where} ${one.also ?? ''}`.toLowerCase().includes(needle)) return 3;
  return -1;
}

/**
 * Go anywhere by typing, from the top bar.
 *
 * The product is wide — a workspace alone has a dozen screens — and finding one
 * means knowing which section it lives under. This is the other way round: type
 * what the thing is called and go there, which is what the address bar of an
 * operating system, or the search of a cloud console, is for.
 *
 * Pages and the workspace's own contents. The pages are fixed and knowable and
 * cost nothing; the names of workflows, actions, agents and the rest are fetched
 * once, the first time the palette is opened on a workspace, and matched here
 * afterwards. Nothing is fetched while somebody types — a palette that waits for
 * a request is a palette that cannot keep up with typing.
 */
export function CommandPalette({ workspacePath, showAdmin = true, showChat = true }: CommandPaletteProps) {
  const navigate = useNavigate();
  const shortcut = usePaletteShortcut();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [at, setAt] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [entities, setEntities] = useState<NamedEntity[]>([]);
  /** The workspace the names in hand belong to, so they are fetched once per workspace. */
  const loaded = useRef<string | null>(null);

  /*
   * Asked for when the palette is first opened rather than when the shell
   * mounts: somebody who never opens it never pays for it, and by the time a
   * second character is typed the names are already here.
   */
  useEffect(() => {
    if (!open || workspacePath === undefined) return;
    const workspace = workspacePath.replace(/\/$/, '');
    if (loaded.current === workspace) return;
    loaded.current = workspace;

    const workspaceId = workspace.split('/').pop() ?? '';
    if (workspaceId === '') return;

    let current = true;
    fetchWorkspaceEntities(workspaceId)
      .then((found) => {
        if (current) setEntities(found);
      })
      .catch(() => {
        // The pages are still worth offering, so a failure here is not one the
        // palette reports; it just has less to offer until it is opened again.
        if (current) setEntities([]);
        loaded.current = null;
      });

    return () => {
      current = false;
    };
  }, [open, workspacePath]);

  /*
   * The pages, from the one list that also defines the router.
   *
   * These used to be written out here as well as there, which is why two pages
   * existed for a while without being findable: nothing connected the two lists, so
   * one could be updated and the other not. Now a page carries its own answer to
   * "how is this found", and this only decides which of them apply right now.
   */
  const commands = useMemo<Command[]>(
    () =>
      goToPages({
        workspacePath: workspacePath === undefined ? null : workspacePath.replace(/\/$/, ''),
        showAdmin,
        showChat,
      }),
    [workspacePath, showAdmin, showChat],
  );

  /** The workspace's own things, as somewhere to go. */
  const named = useMemo<Command[]>(() => {
    if (workspacePath === undefined) return [];
    const workspace = workspacePath.replace(/\/$/, '');

    return entities.map((entity) => ({
      label: entity.name,
      // "Variable in Defaults" — the kind, and which catalogue when two catalogues
      // may hold the same name.
      where: entity.catalog === undefined ? entity.kind : `${entity.kind} in ${entity.catalog}`,
      to: EDIT_PATH[entity.kind](workspace, entity.id),
      icon: KIND_ICON[entity.kind],
      // Matched, not shown: a model found by the id its provider knows it by.
      also: entity.also,
    }));
  }, [entities, workspacePath]);

  const found = useMemo(() => {
    const needle = text.trim().toLowerCase();
    // Nothing typed offers the pages. Listing a workspace's every action before
    // a single letter is a wall, not an answer.
    if (needle === '') return commands.slice(0, SHOWN);

    return [...commands, ...named]
      .map((one) => ({ one, at: rank(one, needle) }))
      .filter((scored) => scored.at >= 0)
      // Stable, so pages keep their place ahead of contents at the same rank.
      .sort((left, right) => left.at - right.at)
      .slice(0, SHOWN)
      .map((scored) => scored.one);
  }, [commands, named, text]);

  // The shortcut works wherever the caret is, which is the point of one.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!matches(event, shortcut)) return;
      event.preventDefault();
      setOpen(true);
      setText('');
      setAt(0);
      inputRef.current?.focus();
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcut]);

  // Clicking anywhere else puts it away, the way a menu goes away.
  useEffect(() => {
    if (!open) return;

    function onDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }

    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  function go(command: Command) {
    setOpen(false);
    setText('');
    inputRef.current?.blur();
    navigate(command.to);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAt((held) => (found.length === 0 ? 0 : (held + 1) % found.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAt((held) => (found.length === 0 ? 0 : (held - 1 + found.length) % found.length));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = found[at];
      if (chosen !== undefined) go(chosen);
    }
  }

  return (
    <div className={styles.palette} ref={boxRef}>
      <div className={open ? `${styles.box} ${styles.boxOpen}` : styles.box}>
        <img src={searchIcon} alt="" width={12} height={12} />
        <input
          ref={inputRef}
          className={styles.input}
          value={text}
          placeholder="Go to…"
          aria-label="Go to a page"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setText(event.target.value);
            setAt(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className={styles.shortcut}>{shortcut}</kbd>
      </div>

      {open && (
        <ul className={styles.results} role="listbox">
          {found.length === 0 && <li className={styles.empty}>Nothing goes by that name.</li>}
          {/* Two variables in different catalogues share a destination, so the
              name and the position are part of what tells one row from another. */}
          {found.map((one, index) => (
            <li key={`${one.where}:${one.to}:${one.label}:${index}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === at}
                className={index === at ? `${styles.result} ${styles.resultAt}` : styles.result}
                // Down rather than click: the box loses focus first otherwise,
                // and the list is gone before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  go(one);
                }}
                onMouseEnter={() => setAt(index)}
              >
                {/*
                 * Masked, not drawn — the icon files hardcode their own stroke
                 * colour, so an <img> would be a fixed grey no CSS could reach.
                 * The quotes inside url() are load-bearing: Vite inlines these as
                 * data URIs whose attributes are single-quoted, and an unquoted
                 * url() token cannot contain a quote character.
                 */}
                <span
                  className={styles.resultIcon}
                  style={{ maskImage: `url("${one.icon}")`, WebkitMaskImage: `url("${one.icon}")` }}
                  aria-hidden="true"
                />
                <span className={styles.resultLabel}>{one.label}</span>
                <span className={styles.resultWhere}>{one.where}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
