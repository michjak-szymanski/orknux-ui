import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import {
  createModel,
  createProvider,
  fetchDiscoveredModels,
  modelKindLabel,
  providerTypeLabel,
} from '../api/models';
import type { DiscoveredModel, Model, ModelKind, ModelProvider } from '../api/models';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import { FieldHint } from './FieldHint';
import styles from './Dialog.module.css';
import { t } from '../i18n';

export interface ModelDialogProps {
  open: boolean;
  /** Which workspace the model — and any provider made here — belongs to. */
  workspaceId: string;
  /** A model belongs to a provider; a speech model may bring its own. */
  providers: ModelProvider[];
  onClose: () => void;
  onCreated: (model: Model) => void;
}

/**
 * The kinds something calls: a chat model answers, a transcription model
 * listens, a speech model reads aloud.
 *
 * Embedding and completion are missing on purpose — no code path anywhere asks for a
 * model of either kind, so registering one produced an entry that could be edited,
 * checked and counted against a quota it would never spend. They stay in the type and
 * the labels for anything registered while they were on offer.
 */
const MODEL_KINDS: ModelKind[] = ['CHAT', 'TRANSCRIPTION', 'SPEECH'];

/**
 * A name worth showing, from an id that may not be one.
 *
 * A hosted provider's id already reads as a name — `gpt-4o`, `claude-3-5-sonnet`
 * — but a local server answers with the path to a file on its own disk, and
 * `/home/michal/llama.cpp/models/gemma-4-31B-it-Q5_K_M.gguf` is not what anyone
 * wants to see in a model picker. The file name without the extension is. Only
 * `.gguf` is dropped, because a dot in an id is usually part of it: `gpt-3.5`.
 *
 * Only a suggestion — the field stays editable.
 */
function suggestName(modelId: string): string {
  const file = modelId.split(/[/\\]/).pop() ?? modelId;
  const named = file.endsWith('.gguf') ? file.slice(0, -'.gguf'.length) : file;
  return named === '' ? modelId : named;
}

/** What to call a provider made from a URL: the machine it points at. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Blank is "not recorded", which is different from zero. */
function optionalNumber(value: string): number | null {
  const trimmed = value.replace(/[,\s]/g, '');
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Add Model. The Models screen lists what a workspace may reach but has no frame for
 * putting one there, so this follows the Add MCP Server modal with the fields
 * the model settings page shows.
 *
 * What the provider offers is a suggestion beside the id field rather than the
 * only way in: a listing can be incomplete — a cloud provider need not name
 * every deployment, and a model can exist before it is listed — so the field
 * stays typeable.
 */
export function ModelDialog({ open, workspaceId, providers, onClose, onCreated }: ModelDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [providerId, setProviderId] = useState('');
  /** Where a speech server is, when one is being named here rather than picked. */
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [modelId, setModelId] = useState('');
  const [kind, setKind] = useState<ModelKind>('CHAT');
  const [contextWindow, setContextWindow] = useState('');
  const [maxOutput, setMaxOutput] = useState('');
  const [inputCost, setInputCost] = useState('');
  const [outputCost, setOutputCost] = useState('');
  const [voice, setVoice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * An audio model brings its own provider, so it wants a URL rather than one.
   *
   * Both kinds: whichever direction it runs in, it is usually a box somebody
   * has just started rather than a provider they set up earlier.
   */
  const audio = kind === 'TRANSCRIPTION' || kind === 'SPEECH';

  // What the provider says it can run. Null until asked, so "none offered" and
  // "not asked yet" do not look the same.
  const [offered, setOffered] = useState<DiscoveredModel[] | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  /**
   * Asks the chosen provider what it offers, whenever there is a new one to ask.
   *
   * Failing is normal here — an unchecked provider, a wrong key, a box that is
   * off — so it is kept out of the form's own error line: not knowing what is on
   * offer does not stop anyone typing an id in by hand.
   */
  useEffect(() => {
    // An audio server has no catalogue to ask for: what it answers is
    // `/audio/transcriptions` or `/audio/speech` and nothing else, so `/models`
    // is a 404 rather than a listing — and a form that reports that as a
    // problem is inventing one. The model name is typed instead.
    if (!open || audio || providerId === '') {
      setOffered(null);
      setOfferError(null);
      return;
    }

    let current = true;
    setAsking(true);
    setOffered(null);
    setOfferError(null);
    fetchDiscoveredModels(providerId)
      .then((found) => {
        if (current) setOffered(found);
      })
      .catch((cause: unknown) => {
        if (current) setOfferError(cause instanceof Error ? cause.message : t('Could not ask the provider.'));
      })
      .finally(() => {
        if (current) setAsking(false);
      });
    return () => {
      current = false;
    };
  }, [open, audio, providerId]);

  /** Picking one fills the id, and the name when nobody has typed one yet. */
  function choose(picked: string) {
    if (picked === '') return;
    setModelId(picked);
    if (name.trim() === '') setName(suggestName(picked));
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      setEndpoint('');
      setApiKey('');
      setProviderId(providers[0]?.id ?? '');
      setName('');
      setModelId('');
      setKind('CHAT');
      setContextWindow('');
      setMaxOutput('');
      setInputCost('');
      setOutputCost('');
      setVoice('');
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, providers]);

  const complete =
    name.trim() !== '' &&
    modelId.trim() !== '' &&
    (audio ? endpoint.trim() !== '' : providerId !== '');

  /**
   * The provider this model will hang off, making one if it has to.
   *
   * An audio server is usually a box somebody has just started — the thing they
   * have is a URL, not a provider they set up earlier — so the URL is asked for
   * here and the provider is made from it. One that already points at the same
   * place is reused rather than duplicated, which is also how a box that both
   * listens and reads ends up as one provider with two models.
   */
  async function providerFor(): Promise<string> {
    if (!audio) return providerId;

    const url = endpoint.trim().replace(/\/$/, '');
    const known = providers.find(
      (provider) => provider.endpoint.replace(/\/$/, '') === url && provider.type === 'OPENAI',
    );
    if (known !== undefined) return known.id;

    const made = await createProvider(workspaceId, {
      name: `Speech (${hostOf(url)})`,
      type: 'OPENAI',
      endpoint: url,
      authMethod: 'API_KEY',
      // Optional: a Whisper box on a private network usually wants none, and
      // an empty key is honest about that rather than a placeholder nobody
      // checks.
      secret: apiKey.trim() === '' ? undefined : apiKey.trim(),
    });
    return made.id;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const provider = await providerFor();
      onCreated(
        await createModel(provider, {
          name: name.trim(),
          modelId: modelId.trim(),
          kind,
          contextWindow: optionalNumber(contextWindow),
          maxOutput: optionalNumber(maxOutput),
          inputCostPerMillion: optionalNumber(inputCost),
          outputCostPerMillion: optionalNumber(outputCost),
          // Only meaningful on a speech model, and blank means "the provider's
          // own" rather than a name this would have to invent.
          voice: kind === 'SPEECH' ? (voice.trim() === '' ? null : voice.trim()) : null,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not add the model.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.dialogWide}`} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{t('Add Model')}</h2>
        </header>

        <p className={styles.dialogMessage}>
          {t('Add a model this workspace may reach through one of its providers')}
        </p>

        <div className={styles.fields}>
          {/*
            What it is for comes first, because it decides the rest: a speech
            model is usually a server somebody has just started, and asking
            which existing provider it belongs to is the wrong first question.
          */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-kind">{t('Type')}</label>
            <div className={styles.inputWrapper}>
              <select
                id="model-kind"
                name="kind"
                className={`${styles.input} ${styles.select}`}
                value={kind}
                onChange={(event) => setKind(event.target.value as ModelKind)}
              >
                {MODEL_KINDS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {modelKindLabel(candidate)}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>

          {audio ? (
            <>
              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="model-api">{t('Provider')}</label>
                  <FieldHint label={t('Provider')}>
                    {t('The shape OpenAI and the servers that imitate it speak: a URL that answers')}
                    <code>{kind === 'SPEECH' ? ' /audio/speech' : ' /audio/transcriptions'}</code>.
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <select id="model-api" className={`${styles.input} ${styles.select}`} value="OPENAI" disabled>
                    <option value="OPENAI">OpenAI API</option>
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="model-endpoint">{t('Server URL')}</label>
                <div className={styles.inputWrapper}>
                  <input
                    id="model-endpoint"
                    name="endpoint"
                    className={`${styles.input} ${styles.inputMono}`}
                    type="url"
                    placeholder="http://192.168.0.199:8005/v1"
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="model-key">{t('API Key')}</label>
                  <FieldHint label={t('API Key')}>
                    {t('Left empty for a server on your own network that asks for none.')}
                  </FieldHint>
                </span>
                <div className={styles.inputWrapper}>
                  <input
                    id="model-key"
                    name="apiKey"
                    className={styles.input}
                    type="password"
                    autoComplete="off"
                    placeholder={t('Optional')}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="model-provider">{t('Provider')}</label>
              <div className={styles.inputWrapper}>
                <select
                  id="model-provider"
                  name="providerId"
                  className={`${styles.input} ${styles.select}`}
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value)}
                  required
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} ({providerTypeLabel(provider.type)})
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </div>
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-name">{t('Name')}</label>
            <div className={styles.inputWrapper}>
              <input
                id="model-name"
                name="modelName"
                className={styles.input}
                type="text"
                placeholder={t("Claude 3.5 Sonnet")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.labelWithHint}>
              <label className={styles.label} htmlFor="model-id">{t('Model ID')}</label>
              {/*
                What to type, which differs by what is being added. It was two
                paragraphs under the field; it is the same two sentences, behind
                the control the rest of the product asks with.
              */}
              {kind === 'TRANSCRIPTION' && (
                <FieldHint label={t('Model ID')}>
                  Whatever your server calls the model — <code>whisper-1</code> is accepted by most of
                  them, and faster-whisper takes names like <code>Systran/faster-whisper-small</code>.
                </FieldHint>
              )}
              {kind === 'SPEECH' && (
                <FieldHint label={t('Model ID')}>
                  Whatever your server calls the model — <code>tts-1</code> for OpenAI, and a local
                  reader usually takes the name of the voice pack it loaded.
                </FieldHint>
              )}
            </span>
            <div className={styles.inputWrapper}>
              <input
                id="model-id"
                name="modelId"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder={
                  kind === 'SPEECH' ? 'tts-1' : kind === 'TRANSCRIPTION' ? 'whisper-1' : 'claude-3-5-sonnet-20241022'
                }
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                required
              />
            </div>
            {/*
              What the provider itself offers. A suggestion beside the field
              rather than instead of it: a model the provider has not listed yet
              still has to be addable by hand.
            */}
            {asking && <p className={styles.fieldNote}>{t('Asking the provider what it offers…')}</p>}
            {offerError !== null && <p className={styles.fieldNote}>{offerError}</p>}
            {offered !== null && offered.length === 0 && (
              <p className={styles.fieldNote}>{t('The provider listed no models.')}</p>
            )}
            {offered !== null && offered.length > 0 && (
              <div className={styles.inputWrapper}>
                <select
                  id="model-offered"
                  className={`${styles.input} ${styles.select}`}
                  value=""
                  onChange={(event) => choose(event.target.value)}
                  aria-label={t('Models the provider offers')}
                >
                  <option value="">Choose from {offered.length} the provider offers…</option>
                  {offered.map((candidate) => (
                    <option key={candidate.modelId} value={candidate.modelId} disabled={candidate.added}>
                      {candidate.modelId}
                      {candidate.added ? ' — already added' : ''}
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </div>
            )}
          </div>

          {/*
            Which voice reads. Text rather than a list, because the names belong
            to the provider — OpenAI knows `alloy`, a local reader knows its own
            — and a list here would be one this has to keep correct for every
            server that exists.
          */}
          {kind === 'SPEECH' && (
            <div className={styles.field}>
              <span className={styles.labelWithHint}>
                <label className={styles.label} htmlFor="model-voice">{t('Voice')}</label>
                <FieldHint label={t('Voice')}>
                  Left empty sends no voice at all, which is what a server with a single built-in one
                  wants. OpenAI requires one — <code>alloy</code>, <code>nova</code> and the rest.
                </FieldHint>
              </span>
              <div className={styles.inputWrapper}>
                <input
                  id="model-voice"
                  name="voice"
                  className={`${styles.input} ${styles.inputMono}`}
                  type="text"
                  placeholder="alloy"
                  value={voice}
                  onChange={(event) => setVoice(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-context">{t('Context Window')}</label>
            <div className={styles.inputWrapper}>
              <input
                id="model-context"
                name="contextWindow"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                inputMode="numeric"
                placeholder="200000"
                value={contextWindow}
                onChange={(event) => setContextWindow(event.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-max-output">{t('Max Output')}</label>
            <div className={styles.inputWrapper}>
              <input
                id="model-max-output"
                name="maxOutput"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                inputMode="numeric"
                placeholder="8192"
                value={maxOutput}
                onChange={(event) => setMaxOutput(event.target.value)}
              />
            </div>
          </div>

          {/* What the provider charges, so a cost can be worked out rather than guessed. */}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-input-cost">
              {t('Input $ / million tokens')}
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="model-input-cost"
                name="inputCostPerMillion"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                inputMode="decimal"
                placeholder="3.00"
                value={inputCost}
                onChange={(event) => setInputCost(event.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="model-output-cost">
              {t('Output $ / million tokens')}
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="model-output-cost"
                name="outputCostPerMillion"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                inputMode="decimal"
                placeholder="15.00"
                value={outputCost}
                onChange={(event) => setOutputCost(event.target.value)}
              />
            </div>
          </div>
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
            {t('Cancel')}
          </button>
          <button type="submit" className={styles.filled} disabled={!complete || submitting}>
            {submitting ? t('Adding…') : t('Add Model')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
