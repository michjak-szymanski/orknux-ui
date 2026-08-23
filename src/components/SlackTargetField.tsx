import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { fetchSlackSuggestions } from '../api/integrations';
import type { SlackSuggestion, SlackSuggestions } from '../api/integrations';
import { Marked } from './DefinitionPicker';
import { SlackTargetAnswer, TARGET_PAUSE } from './SlackTargetAnswer';
import { SlackTargetKind } from './SlackTargetKind';
import own from './SlackTargetField.module.css';

export interface SlackTargetFieldProps {
  /** The field's own id, which its label points at. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * The Slack connection to ask, or null for a field there is nobody to ask
   * about - which is every parameter in the node panel but one.
   *
   * Null is a plain text field: no list, no answer, no request. Not an empty
   * list and not a disabled control; a field nothing can be said about is a
   * field that behaves like any other.
   */
  connectionId: string | null;
  /** What the answer under the field is called, for `aria-describedby`. */
  answerId: string;
  /** The surface's own class for a text input. */
  className?: string;
  /** The surface's own box around one, which is what the list is aligned to. */
  wrapperClassName?: string;
  /** The surface's own class for an aside under a field. */
  answerClassName?: string;
  placeholder?: string;
  spellCheck?: boolean;
}

/**
 * A Slack target, typed - with what the connection can see offered underneath.
 *
 * Two surfaces hold this field and neither may behave differently: the action
 * form, where a send is defined, and the workflow editor's node panel, where one
 * step binds its own `target`. The check was lifted into `SlackTargetAnswer` for
 * that reason and the suggestions are lifted here for the same one. What is left
 * to each surface is only what is genuinely its own - the classes its inputs are
 * painted with, its placeholder, its ids - and everything a person would notice
 * is one piece of code rather than two that agree today.
 *
 * **It suggests and it never gates.** The field is an ordinary `<input>` with
 * ordinary typing in it, the list is an offer beside it, and nothing that saves
 * reads either. That is not a technicality: an id pasted out of somebody else's
 * message, a member who joined a minute ago, a private channel this bot was
 * never invited to and an archived channel are all correct values that no list
 * here will ever hold. A picker that refused them would be wrong more often than
 * the typos it caught.
 *
 * **It is never told which kind it is naming, because nothing knows.** Slack does
 * not differentiate when sending - one `chat.postMessage` takes a channel id or
 * a user id, a direct message being a conversation - and the kind only ever
 * chose which of its two endpoints answered a lookup. Nothing stores it now: an
 * action holds a name and a send resolves that name when it goes. So both
 * surfaces ask without one, one list comes back holding channels and members
 * together, and each row and each answer says which kind it turned out to be.
 * The alternative was what issue #176 was reported as - a panel that asked
 * nothing, and therefore said nothing, to somebody whose bot token could not
 * read one of the two halves.
 *
 * The two answers under one field are kept apart by where they are drawn, which
 * is the only way to have both without stacking two paragraphs under a text box.
 * Under the field, in the answer box, is what is known about *what was typed* -
 * the check, one line, as it has been. Inside the list, at the head of it, is
 * what is known about *the list* - that it was cut short, or that there could be
 * no list at all and why. Each sentence sits with the thing it is about, each is
 * the server's own and printed as it arrives, and neither is ever a second copy
 * of the other. And a name taken from the list silences the check, because a
 * name Slack has just offered is not a name worth asking Slack about.
 */
export function SlackTargetField({
  id,
  value,
  onChange,
  connectionId,
  answerId,
  className,
  wrapperClassName,
  answerClassName,
  placeholder,
  spellCheck,
}: SlackTargetFieldProps) {
  /*
   * Whether there is anybody to ask, which is the whole of the condition.
   *
   * It used to require a kind as well, and that was the bug in issue #176: an
   * action whose target kind had never been set left `target` null, so the panel
   * asked nothing and drew nothing, and somebody whose bot token was missing
   * `users:read` was told that by silence. The kind was never needed to ask -
   * it only ever chose which of Slack's two endpoints did the looking up, and
   * it is not stored at all any more - so the field falls quiet only where it
   * genuinely cannot ask, which is where no Slack connection could be resolved.
   */
  const suggesting = connectionId !== null;

  /** Whether the list is being offered at all. Focus opens it; Escape and a pick close it. */
  const [open, setOpen] = useState(false);
  /** Which row the arrows are on; -1 while they are on none, which is where they start. */
  const [at, setAt] = useState(-1);
  const [offered, setOffered] = useState<{ question: string; answer: SlackSuggestions } | null>(null);
  /**
   * The exact text a row put in the field, held so that editing it is telling
   * again. Not a flag: the field may be typed back to what was picked, and it
   * is the text and not the gesture that decides whether there is anything left
   * to check.
   */
  const [taken, setTaken] = useState<string | null>(null);
  /**
   * Whether the list stands above the field rather than below it.
   *
   * Worked out from where the field actually is rather than chosen once. The
   * target is the last field of the action dialog and the panel is a column
   * that scrolls, so this list is very often opened a few pixels from the
   * bottom of the window - where a list drawn downwards is a list whose rows,
   * and whose line about itself, are off the screen. The alternative is
   * scrolling the form to make room, which moves everything somebody is looking
   * at to show them something they only glanced at.
   */
  const [above, setAbove] = useState(false);

  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const typed = value.trim();

  /**
   * Everything the list on screen would have to be a list *for*.
   *
   * The connection and what is typed - and null while the list is closed, which
   * is what stops a field nobody is picking from asking anything. An empty
   * `typed` is a question all the same, and the only one here that is: it asks
   * for the first few of everything, which is what a picker shows when it opens.
   */
  const question = suggesting && open ? [connectionId, typed].join(' ') : null;

  /*
   * The same two guards the answer box keeps, for the same two reasons.
   *
   * `current` stops a reply to a question nobody is asking any more from being
   * stored. What it cannot do is decide what is *drawn*: between a keystroke and
   * the reply to it, the list in state is a true list for the previous text, and
   * rows that no longer match what is in the field are an offer to pick
   * something that was never searched for. So the list is kept with the question
   * it answers and drawn only while that is still the question.
   */
  useEffect(() => {
    if (question === null || connectionId === null) return;

    let current = true;
    const timer = setTimeout(() => {
      /*
       * Asked without a kind, always. There is nothing left to narrow it with -
       * an action holds a name and no kind beside it - so one list comes back
       * holding channels and members together and each row says which it is.
       */
      fetchSlackSuggestions(connectionId, null, typed)
        .then((answer) => {
          if (current) setOffered({ question, answer });
        })
        .catch(() => {
          // A question that could not be put is not a list. Nothing is offered,
          // and the field carries on as the plain text field it always was.
          if (current) setOffered(null);
        });
    }, TARGET_PAUSE);

    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `question` is made of the other two, so it is what changes when they do.
  }, [question, connectionId, typed]);

  /** The list, but only while it is a list for what is in the field now. */
  const answer = offered !== null && offered.question === question ? offered.answer : null;
  const rows = useMemo(() => answer?.matches ?? [], [answer]);
  /**
   * The server's line about the list.
   *
   * Empty in the usual case, and said in the three the list would otherwise get
   * wrong: the reason there are no suggestions, the caveat under none that
   * matched, and the word that a complete-looking list was cut. Printed exactly
   * as it arrives, with nothing of ours around it.
   */
  const note = answer?.message ?? '';

  /*
   * Drawn when there is something in it, and never when there is not.
   *
   * An empty box under a field says "there is nothing there", which is a claim
   * this cannot make - it is the one thing an `UNCHECKED` explicitly is not. So
   * a list with no rows and nothing to say is no list at all, and a list with no
   * rows and a reason is that reason.
   */
  const showing = open && answer !== null && (rows.length > 0 || note !== '');

  /*
   * Back off the rows whenever the list changes underneath them.
   *
   * On no row rather than on the first, which is where this parts company with
   * the picker it is modelled on: that one is opened to choose from and Enter
   * has nothing else to mean, while this stands in a form where Enter saves and
   * the field is meant to be typed into. Enter takes a row only once the arrows
   * have put the cursor on one; until then it does what it does in any other
   * field of the dialog.
   */
  useEffect(() => {
    setAt(-1);
  }, [question]);

  /*
   * Measured after it is drawn and before it is painted, so the list is never
   * seen in the wrong place. It is drawn downwards, its real height is read,
   * and it turns over only where that height does not fit and there is more
   * room the other way.
   */
  useLayoutEffect(() => {
    if (!showing) {
      setAbove(false);
      return;
    }
    const field = anchor.current?.getBoundingClientRect();
    const height = menu.current?.offsetHeight ?? 0;
    if (field === undefined) return;
    const under = window.innerHeight - field.bottom;
    setAbove(under < height + 8 && field.top > under);
  }, [showing, rows.length, note]);

  /**
   * Puts a row in the field, and does nothing else at all.
   *
   * The name is the whole of what picking does, on both surfaces. It used to
   * hand the row's kind back to the action dialog as well, because the dialog
   * had a Channel/User control to settle - and that control is gone, nothing
   * storing the kind any more. A row that is a person and a row that is a
   * channel therefore leave the same thing behind them: what was picked, in the
   * field, ready to be resolved when the message goes.
   */
  function take(row: SlackSuggestion) {
    onChange(row.name);
    setTaken(row.name);
    setOpen(false);
    setAt(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggesting) return;

    if (event.key === 'ArrowDown' && !showing) {
      // Asking for the list back after Escape, without having to retype.
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (!showing) return;

    if (event.key === 'Escape') {
      /*
       * Prevented and stopped: this field stands in a `<dialog>`, where an
       * Escape that carried on is a close request the browser answers by
       * shutting the form - so putting a list away would throw away everything
       * typed into the dialog around it.
       */
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAt((held) => (held + 1 > rows.length - 1 ? 0 : held + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAt((held) => (held - 1 < 0 ? rows.length - 1 : held - 1));
      return;
    }

    if (event.key === 'Enter') {
      const row = rows[at];
      // Only when the arrows are on a row. Anywhere else Enter belongs to the
      // form, and a field that swallowed it would be a field that cannot save.
      if (row === undefined) return;
      event.preventDefault();
      take(row);
      return;
    }

    if (event.key === 'Tab') setOpen(false);
  }

  return (
    <>
      {/*
        The list hangs off this rather than off the box around the input: the
        surfaces pad that box, and an absolute list anchored inside the padding
        would stand a hand's width narrower than the field it belongs to.
      */}
      <div className={own.field} ref={anchor}>
        <div className={wrapperClassName}>
          <input
            id={id}
            className={className}
            type="text"
            value={value}
            placeholder={placeholder}
            spellCheck={spellCheck}
            autoComplete="off"
            aria-describedby={suggesting ? answerId : undefined}
            /*
              A combobox only where there is a list to be one of. Without a
              connection to ask, this is a text field and says so - the
              alternative is announcing a list to a screen reader and then never
              having one.
            */
            role={suggesting ? 'combobox' : undefined}
            aria-expanded={suggesting ? showing : undefined}
            aria-controls={suggesting ? `${id}-listbox` : undefined}
            aria-autocomplete={suggesting ? 'list' : undefined}
            aria-activedescendant={showing && rows[at] !== undefined ? `${id}-suggestion-${at}` : undefined}
            onFocus={() => {
              if (suggesting) setOpen(true);
            }}
            /*
              Leaving puts the list away, and nothing else. What is in the field
              stays exactly as it was typed, matched or not - the list is an
              offer and this is where refusing it costs nothing.

              The list itself takes no focus (see the mousedown below), so a
              click on a row never arrives here.
            */
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            onChange={(event) => {
              onChange(event.target.value);
              if (suggesting) setOpen(true);
            }}
          />
        </div>

        {showing && (
          <div
            id={`${id}-suggestions`}
            className={above ? `${own.menu} ${own.menuAbove}` : own.menu}
            ref={menu}
            /*
              What the list is, for anything reading the page rather than the
              wire: which of the three outcomes it came back as, and whether it
              is everything that matched.
            */
            data-outcome={answer.outcome}
            data-complete={String(answer.complete)}
            /*
              The field keeps the focus through a click on a row. Without this
              the box blurs on mousedown, the list is gone before mouseup, and
              the click lands on whatever the layout put there instead.
            */
            onMouseDown={(event) => event.preventDefault()}
          >
            {/*
              What the server has to say about the list, at the head of it, in
              its own words and one line of them.

              This is where a partial list admits to being partial, and it is
              first rather than last because the rows scroll and it does not. A
              line about a cut list, written under twenty-five rows in a box that
              shows six, is a line nobody reads - and a list that quietly leaves
              things out teaches somebody it is the whole of what exists, until
              the first channel it does not hold costs them the thing the picker
              was for. Nothing of ours is added around it: the sentence arrives
              under 120 characters and whole, and a previous round of prose
              written here came out as eight scrolling lines under a field.
            */}
            {note !== '' && <p className={own.note}>{note}</p>}

            {rows.length > 0 && (
              <div id={`${id}-listbox`} className={own.rows} role="listbox" aria-label="Suggestions">
                {rows.map((row, index) => (
                  <button
                    key={row.id}
                    id={`${id}-suggestion-${index}`}
                    type="button"
                    role="option"
                    aria-selected={row.name === value}
                    className={index === at ? `${own.option} ${own.optionAt}` : own.option}
                    // Kept in view as the arrows move past the bottom of the list.
                    ref={(node) => {
                      if (index === at) node?.scrollIntoView({ block: 'nearest' });
                    }}
                    // Under the pointer as well as under the arrows: a hand and
                    // a keyboard must not disagree about which row is next.
                    data-target={row.target}
                    onMouseMove={() => setAt(index)}
                    onClick={() => take(row)}
                  >
                    {/*
                      Which of the two this row is, before the name is read.

                      One list holds both now, so a row that did not say would
                      leave somebody to work it out from the sigil buried in a
                      highlighted name - see `SlackTargetKind` for why that is
                      not enough and why this is a mark rather than a word or a
                      heading. `data-target` says the same thing to anything
                      reading the page rather than looking at it.
                    */}
                    <SlackTargetKind className={own.optionKind} target={row.target} />
                    <span className={own.optionText}>
                      <span className={own.optionName}>
                        <Marked text={row.name} needle={typed} />
                      </span>
                      {row.realName !== null && row.realName !== '' && (
                        <span className={own.optionReal}>
                          <Marked text={row.realName} needle={typed} />
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <SlackTargetAnswer
        id={answerId}
        className={answerClassName}
        connectionId={connectionId}
        name={value}
        picked={taken !== null && taken === value}
      />
    </>
  );
}
