import { useEffect, useState } from 'react';

import type { MessageTarget } from '../api/actions';
import { checkSlackTarget } from '../api/integrations';
import type { SlackTargetCheck, SlackTargetOutcome } from '../api/integrations';
import own from './SlackTargetAnswer.module.css';

/**
 * How long the target field must be still before Slack is asked about it.
 *
 * Every one of these is a round trip and a lookup at Slack's end, so it is not
 * one per keystroke. The same pause the memory slider waits before asking what
 * a share works out to: long enough that typing a channel name is one question
 * and not twelve, short enough that stopping shows the answer at once.
 */
export const TARGET_PAUSE = 150;

/** One class per outcome, so the box draws all three and never the absence of one. */
const TARGET_CLASS: Record<SlackTargetOutcome, string> = {
  FOUND: own.targetFound,
  NOT_FOUND: own.targetNotFound,
  UNCHECKED: own.targetUnchecked,
};

export interface SlackTargetAnswerProps {
  /** What the field points its `aria-describedby` at. */
  id: string;
  /**
   * The surface's own hint class, whatever it calls it.
   *
   * The size and weight an aside reads at is the surface's business - the
   * dialog's hints are set larger than the node panel's notes - and this box is
   * an aside on both. Only what has to be the same in both is held here: the
   * three colours, and the room the answer takes.
   */
  className?: string;
  /** The Slack connection to ask, or null to ask nobody and say nothing. */
  connectionId: string | null;
  /** Which of the two things is being named, or null when that is not known. */
  target: MessageTarget | null;
  /** What is in the field, exactly as it was typed. */
  name: string;
}

/**
 * Whether a Slack connection can see the user or channel typed into a field.
 *
 * Two surfaces ask this now and neither of them may answer it differently. The
 * action form asks where a send is defined; the workflow editor's node panel
 * asks where one step binds its own `target`, which is where somebody typing a
 * channel name most often is. What they share is not only the wording - that is
 * the server's and is printed as it arrives - but the three colours, the room
 * kept for the answer, the pause before asking and the two guards that keep a
 * stale answer off the screen. Any of those drifting apart between the two
 * would be the same feature behaving differently in two places.
 *
 * A question and never a gate. Nothing that saves reads this, the field stays
 * free text, and a `NOT_FOUND` is as often a private channel this bot was never
 * invited to as it is a typo.
 *
 * Nothing at all is drawn without a connection to ask and a kind to ask about.
 * Not an empty box: a caller that cannot work out which connection a target
 * would go through has nothing to say about it, and reserving room under a
 * field for an answer that will never come is the interface promising something
 * it cannot do.
 */
export function SlackTargetAnswer({ id, className, connectionId, target, name }: SlackTargetAnswerProps) {
  /**
   * Exactly what the answer on screen would have to be an answer *to*.
   *
   * Everything the question is made of, in one string: the connection, which of
   * the two kinds, and what is typed. Nothing is asked while it is null -
   * nothing typed is nothing to say, and a lookup of an empty field is a round
   * trip to be told so.
   */
  const typed = name.trim();
  const asking = connectionId !== null && target !== null;
  const question = asking && typed !== '' ? [connectionId, target, typed].join(' ') : null;

  const [answered, setAnswered] = useState<{ question: string; check: SlackTargetCheck } | null>(null);

  /*
   * The answer, asked for once the field has been still for a moment.
   *
   * Two things keep a stale answer off the screen, and they are two because one
   * of them is not enough. `current` stops a slow reply to a question nobody is
   * asking any more from being stored at all - the same guard the memory
   * preview uses, and the same reason. What it cannot do is decide what is
   * *drawn*: between a keystroke and the reply to it, the answer in state is a
   * true answer to the previous text, and printing it beside the new text is
   * the same lie as a description that lags the field by a keystroke. So the
   * answer is kept with the question it belongs to and drawn only while that
   * question is still the one being asked.
   */
  useEffect(() => {
    if (connectionId === null || target === null || question === null) return;

    let current = true;
    const timer = setTimeout(() => {
      checkSlackTarget(connectionId, target, typed)
        .then((check) => {
          if (current) setAnswered({ question, check });
        })
        .catch(() => {
          // A question that could not be put is not an answer about the field.
          // The box goes quiet rather than saying something about the typing on
          // the strength of a request that never arrived.
          if (current) setAnswered(null);
        });
    }, TARGET_PAUSE);

    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `question` is made of the other three, so it is what changes when they do.
  }, [question, connectionId, target, typed]);

  if (!asking) return null;

  /** The answer, but only while it is an answer to what is in the field now. */
  const answer = answered !== null && answered.question === question ? answered.check : null;

  return (
    <p
      id={id}
      className={`${className ?? ''} ${own.targetAnswer} ${answer === null ? '' : TARGET_CLASS[answer.outcome]}`}
      data-outcome={answer?.outcome ?? (question === null ? 'nothing' : 'asking')}
      aria-live="polite"
    >
      {answer === null ? (
        question === null ? (
          ''
        ) : (
          'Checking…'
        )
      ) : (
        <>
          {/*
            Which thing matched, when the sentence does not already open with
            it. `general` typed and `#general` found is the whole value of a
            confirmation, and the server's wording leads with it today - so this
            draws nothing now and keeps the naming if that ever changes.
          */}
          {answer.outcome === 'FOUND' && answer.label !== null && !answer.message.startsWith(answer.label) && (
            <>
              <strong className={own.targetLabel}>{answer.label}</strong>{' '}
            </>
          )}
          {answer.message}
        </>
      )}
    </p>
  );
}
