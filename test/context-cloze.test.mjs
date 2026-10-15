import { describe, expect, it } from 'vitest';
import { clozeSentence, parseExampleLine, pickExample, resolveExampleSourcePath, surfacesFor } from '../src/context-cloze.mjs';
import { buildNote, parseNote } from '../src/note-format.mjs';

describe('context cloze', () => {
  it('should cloze explicit be and have irregular forms without leaking the answer', () => {
    expect(clozeSentence('He is ready and was calm.', { word: 'be', pos: 'verb' }).text).toBe('He _____ ready and _____ calm.');
    expect(clozeSentence('She has it.', { word: 'have', pos: 'verb' }).text).toBe('She _____ it.');
  });

  it('should parse markdown source when example line has a path source', () => {
    expect(parseExampleLine('She was running late. — [Daily\\[Run\\]](../sources/run.md)')).toEqual({
      sentence: 'She was running late.',
      source: { title: 'Daily[Run]', path: '../sources/run.md' },
    });
  });

  it('should parse encoded markdown source paths containing spaces unicode and parentheses', () => {
    expect(parseExampleLine('Source line. — [A source](../sources/资料%20a%29b.md)')).toEqual({
      sentence: 'Source line.',
      source: { title: 'A source', path: '../sources/资料 a)b.md' },
    });
  });

  it('should preserve a malformed encoded source path when decoding is unsafe', () => {
    expect(parseExampleLine('Source line. — [A source](../sources/a%ZZ.md)')).toEqual({
      sentence: 'Source line.',
      source: { title: 'A source', path: '../sources/a%ZZ.md' },
    });
  });

  it('should parse url source when example line has an angle url source', () => {
    expect(parseExampleLine('She ran home. — <https://example.com/run>')).toEqual({
      sentence: 'She ran home.',
      source: { url: 'https://example.com/run' },
    });
  });

  it('should keep sentence dash text when example line has no source syntax', () => {
    expect(parseExampleLine('A pause — not a source.')).toEqual({
      sentence: 'A pause — not a source.',
      source: null,
    });
    expect(parseExampleLine(null)).toEqual({ sentence: '', source: null });
    expect(parseExampleLine('- Run now.')).toEqual({ sentence: 'Run now.', source: null });
  });

  it('should preserve a literal internal no-source marker in user example text', () => {
    const sentence = 'Keep <!-- ev:no-source -->';
    const noteLine = parseNote(buildNote({ word: 'keep', definition: 'retain', example: sentence })).entry.examples[0];
    expect(parseExampleLine(noteLine)).toEqual({ sentence, source: null });
    const encoded = 'Keep &lt;!-- ev:no-source --&gt; too';
    const encodedLine = parseNote(buildNote({ word: 'keep', definition: 'retain', example: encoded })).entry.examples[0];
    expect(parseExampleLine(encodedLine)).toEqual({ sentence: encoded, source: null });
  });

  it('should resolve example source path when source stays inside readable markdown roots', () => {
    expect(resolveExampleSourcePath('wiki/vocab/run.md', 'wiki/source.md')).toBe('wiki/source.md');
    expect(resolveExampleSourcePath('wiki/vocab/run.md', '../sources/run.md')).toBe('wiki/sources/run.md');
    expect(resolveExampleSourcePath('docs/vocab/run.md', './source.md')).toBe('docs/vocab/source.md');
  });

  it('should reject example source path when source escapes readable markdown roots', () => {
    expect(resolveExampleSourcePath('wiki/vocab/run.md', '../../secret.md')).toBeNull();
    expect(resolveExampleSourcePath('wiki/vocab/run.md', '../sources/run.txt')).toBeNull();
    expect(resolveExampleSourcePath('wiki/vocab/run.md', '/tmp/run.md')).toBeNull();
    expect(resolveExampleSourcePath('wiki/vocab/run.md', '')).toBeNull();
    expect(resolveExampleSourcePath('wiki/vocab/run.md', 'wiki/../../secret.md')).toBeNull();
    expect(resolveExampleSourcePath('', '../secret.md')).toBeNull();
    expect(resolveExampleSourcePath()).toBeNull();
  });

  it('should include comparative surfaces only when adjective pos is known', () => {
    expect(surfacesFor({ word: 'big', pos: 'adjective' })).toEqual(expect.arrayContaining(['big', 'bigger', 'biggest']));
    expect(surfacesFor({ word: 'quick' })).toEqual(['quick']);
    expect(surfacesFor({ word: 'quick', pos: 'adjective' })).toContain('quicker');
  });

  it('should cloze whole inflected word surfaces when sentence contains matching tokens', () => {
    expect(clozeSentence('Run, she ran while running studies.', { word: 'run', pos: 'verb' }).text).toBe('_____, she _____ while _____ studies.');
    expect(clozeSentence('She studies daily.', { word: 'study', pos: 'verb' }).text).toBe('She _____ daily.');
    expect(clozeSentence('A rerun is not run.', { word: 'run' }).text).toBe('A rerun is not _____.');
  });

  it('should skip ambiguous inflection surfaces without reliable local part of speech', () => {
    expect(clozeSentence('He bought a new saw.', { word: 'see', pos: 'verb' }).hits).toEqual([]);
    expect(clozeSentence('Turn left here.', { word: 'leave', pos: 'verb' }).hits).toEqual([]);
    expect(clozeSentence('The does crossed the road.', { word: 'do', pos: 'verb' }).hits).toEqual([]);
    expect(clozeSentence('A rose bloomed.', { word: 'rise', pos: 'verb' }).hits).toEqual([]);
    expect(clozeSentence('They found a company.', { word: 'find', pos: 'verb' }).hits).toEqual([]);
    expect(clozeSentence('Lay the book down.', { word: 'lie', pos: 'verb' }).hits).toEqual([]);
    expect(clozeSentence('The wound healed.', { word: 'wind', pos: 'verb' }).hits).toEqual([]);
    expect(clozeSentence('They fell the tree.', { word: 'fall', pos: 'verb' }).hits).toEqual([]);
    for (const [sentence, word, form] of [
      ['The ground was wet.', 'grind', 'ground'], ['Wait a bit.', 'bite', 'bit'],
      ['A spoke broke on the wheel.', 'speak', 'spoke'], ['The parcel was bound tightly.', 'bind', 'bound'],
      ['The rent is due.', 'rend', 'rent'],
    ]) expect(clozeSentence(sentence, { word, forms: [word, form], dictionaryPos: 'verb' }).hits).toEqual([]);
  });

  it('should conservatively skip reviewed homographs even in genuine inflection sentences', () => {
    expect(clozeSentence('The beans were ground finely.', { word: 'grind', forms: ['grind', 'ground'], dictionaryPos: 'verb' }).hits).toEqual([]);
    expect(clozeSentence('She spoke clearly.', { word: 'speak', forms: ['speak', 'spoke'], dictionaryPos: 'verb' }).hits).toEqual([]);
  });

  it('should cloze straight and curly possessive stems without splitting contractions', () => {
    expect(clozeSentence("The runner's pace and runner’s speed increased.", { word: 'runner', pos: 'noun' }).text).toBe("The _____'s pace and _____’s speed increased.");
    expect(clozeSentence("The runners' pace increased.", { word: 'runner', pos: 'noun' }).text).toBe("The _____' pace increased.");
    expect(clozeSentence("I can't stop.", { word: 'can', pos: 'verb' }).hits).toEqual([]);
  });

  it('should cloze prototype-shaped words as ordinary vocabulary surfaces', () => {
    expect(clozeSentence('The constructor calls another constructor.', { word: 'constructor', pos: 'noun' }).text).toBe('The _____ calls another _____.');
    expect(clozeSentence('Use toString and hasOwnProperty.', { word: 'toString' }).text).toBe('Use _____ and hasOwnProperty.');
  });

  it('should use only the lemma when note pos cannot be inferred', () => {
    const run = { word: 'run', definition: 'to move fast on foot' };
    expect(surfacesFor(run)).toEqual(['run']);
    expect(clozeSentence('She was running late.', run).hits).toEqual([]);
    expect(clozeSentence('He ran home.', run).hits).toEqual([]);
    expect(clozeSentence('I ate herring.', { word: 'her', definition: 'pronoun' }).hits).toEqual([]);
  });

  it('should cloze dictionary-confirmed forms for notes without pos or definition prefixes', () => {
    const run = { word: 'run', definition: 'to move fast on foot', forms: ['run', 'ran', 'running'], dictionaryPos: 'verb' };
    expect(clozeSentence('She was running late.', run).text).toBe('She was _____ late.');
    expect(clozeSentence('He ran home.', run).text).toBe('He _____ home.');
    const record = { word: 'record', pos: 'noun', forms: ['record', 'records', 'recorded', 'recording'], dictionaryPos: 'noun, verb' };
    expect(clozeSentence('They recorded it.', record).text).toBe('They _____ it.');
  });

  it('should constrain known noun entries and infer explicit definition prefixes', () => {
    expect(clozeSentence('She booked it.', { word: 'book', pos: 'noun' }).text).toBe('She booked it.');
    expect(clozeSentence('They sawed it.', { word: 'saw', pos: 'noun' }).text).toBe('They sawed it.');
    expect(clozeSentence('She opened it.', { word: 'open', definition: 'v. make accessible' }).text).toBe('She _____ it.');
  });

  it('should not cloze apostrophe tokens or unrelated words when they are not exact surfaces', () => {
    expect(clozeSentence("Don't stop the runner.", { word: 'do' }).text).toBe("Don't stop the runner.");
    expect(clozeSentence('Nothing to see.', { word: 'run' }).hits).toEqual([]);
  });

  it('should treat curly and straight apostrophes as the same collected token', () => {
    expect(clozeSentence("I don’t know, but I don't mind.", { word: "don't" }).text).toBe('I _____ know, but I _____ mind.');
  });

  it('should cloze a collected hyphenated word as one context token', () => {
    expect(clozeSentence('My mother-in-law arrived.', { word: 'mother-in-law', pos: 'noun' }).text).toBe('My _____ arrived.');
  });

  it('should preserve a titled web source when parsing a markdown example source', () => {
    expect(parseExampleLine('Read it. — [Article title](https://example.com/article)')).toEqual({
      sentence: 'Read it.',
      source: { title: 'Article title', url: 'https://example.com/article' },
    });
  });

  it('should pick examples by review log count after filtering unusable examples', () => {
    const entry = {
      word: 'run',
      pos: 'verb',
      examples: [
        'No target here.',
        'She was running late. — [Read](wiki/read.md)',
        'Yesterday I ran home.',
      ],
    };
    expect(pickExample(entry, 0)?.sentence).toBe('She was running late.');
    expect(pickExample(entry, 1)?.sentence).toBe('Yesterday I ran home.');
    expect(pickExample(entry, 2)?.sentence).toBe('She was running late.');
    expect(pickExample({ word: 'run', examples: ['No target here.'] }, 0)).toBeNull();
  });

  it('should truncate long cloze sentences on token boundaries after clozing target tokens', () => {
    const before = 'alpha '.repeat(45);
    const after = ' omega'.repeat(45);
    const result = clozeSentence(`${before}running${after}`, { word: 'run', pos: 'verb' }, { maxLength: 120 });
    expect(result.text).toContain('_____');
    expect(result.text).not.toContain('running');
    expect(result.text).not.toMatch(/\b(?:run|runni|runnin|running)\b/i);
    expect(result.text.length).toBeLessThanOrEqual(120);
  });

  it('should keep the full cloze sentence when distant hits cannot fit one safe window', () => {
    const middle = ' middle'.repeat(80);
    const result = clozeSentence(`Run${middle} while running.`, { word: 'run', pos: 'verb' }, { maxLength: 80 });
    expect(result.text).toBe(`_____${middle} while _____.`);
    expect(result.hits).toHaveLength(2);
  });

  it('should keep a cloze intact when a tiny window cannot end on token boundaries', () => {
    expect(clozeSentence('running', { word: 'run', pos: 'verb' }, { maxLength: 1 }).text).toBe('_____');
    expect(clozeSentence(null, { word: 'run' }).text).toBe('');
  });

  it('should use safe defaults when example list and review count are absent or invalid', () => {
    expect(pickExample({ word: 'run' })).toBeNull();
    expect(pickExample({ word: 'run', examples: ['Run one.', 'Run two.'] }, -1)?.sentence).toBe('Run two.');
    expect(pickExample({ word: 'run', examples: ['Run one.'] }, 'invalid')?.sentence).toBe('Run one.');
  });
});
