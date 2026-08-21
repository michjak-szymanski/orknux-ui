/**
 * The old name, kept alive for one import.
 *
 * This was a chain-link glyph, and the name and the drawing taught the same
 * wrong idea: that the control joins two things. It opens the definition a
 * field names, in a tab of its own. Both now live in `OpenDefinitionIcon`.
 *
 * Nine of the ten call sites moved. `FunctionEditorPage.tsx` was being edited
 * elsewhere when this landed, so its two are still reached through here — they
 * draw the new mark, because this is the new component under the old name. When
 * that file's import moves to `./OpenDefinitionIcon`, delete this file; nothing
 * else refers to it.
 *
 * @deprecated Import `OpenDefinitionIcon` from './OpenDefinitionIcon'.
 */
export { OpenDefinitionIcon as LinkIcon } from './OpenDefinitionIcon';
