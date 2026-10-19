import { invalid, object } from './taxonomy-content.mjs';

// A deliberately small, version-independent format shared by the UI and PDF.
// No HTML is accepted or rendered. Absence uses the product snapshot default;
// an empty array is an intentional empty description.
export function checkedDescription(value, path) {
  if (!Array.isArray(value) || value.length > 1000) invalid(path, 'Use at most 1,000 description formatting runs.');
  let length = 0;
  return value.map((run, index) => {
    const at = `${path}/${index}`;
    object(run, ['text', 'bold', 'italic', 'underline'], at, ['text']);
    if (typeof run.text !== 'string' || !run.text.length || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cs}]/u.test(run.text)) invalid(`${at}/text`, 'Use text with newlines and no other control characters.');
    length += run.text.length;
    if (length > 5000) invalid(path, 'Use at most 5,000 description characters.');
    for (const mark of ['bold', 'italic', 'underline']) if (run[mark] !== undefined && typeof run[mark] !== 'boolean') invalid(`${at}/${mark}`, 'Use true or false.');
    return { text: run.text, ...Object.fromEntries(['bold', 'italic', 'underline'].filter(mark => run[mark]).map(mark => [mark, true])) };
  });
}
export function lineDescription(line) {
  if (line.descriptionVisible === false) return [];
  return line.descriptionContent ?? (line.snapshot.content.productDescription ? [{ text: line.snapshot.content.productDescription }] : []);
}
