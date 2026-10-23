// Several files, as one.
//
// An archive that is one byte wrong does not open at all, so most of these
// are about offsets - and the one that matters most is the central
// directory, because that is what a reader looks at and what a writer gets
// wrong last.

import test from 'node:test';
import assert from 'node:assert/strict';

import { writeZip, readZip, crc32, dosTime } from '../src/sketch/zip.js';
import { distinct } from '../src/sketch/stems.js';

const say = (text) => new TextEncoder().encode(text);
const read = (bytes) => new TextDecoder().decode(bytes);

test('CRC-32 agrees with the values everybody checks against', () => {
  // The three in every implementation's test suite.
  assert.equal(crc32(say('')), 0);
  assert.equal(crc32(say('a')), 0xe8b7be43);
  assert.equal(crc32(say('123456789')), 0xcbf43926);
});

test('files go in and come back out', () => {
  const zip = writeZip([
    { name: 'one.txt', bytes: say('hello') },
    { name: 'two.txt', bytes: say('there, at some length') },
  ]);

  const back = readZip(zip);
  assert.equal(back.length, 2);
  assert.deepEqual(back.map((file) => file.name), ['one.txt', 'two.txt']);
  assert.equal(read(back[0].bytes), 'hello');
  assert.equal(read(back[1].bytes), 'there, at some length');
});

test('what is stored is what the directory says is stored', () => {
  const bytes = new Uint8Array(5000);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 37) & 0xff;

  const [file] = readZip(writeZip([{ name: 'stems/kit.wav', bytes }]));
  assert.equal(file.name, 'stems/kit.wav');
  assert.equal(file.bytes.length, bytes.length);
  assert.deepEqual([...file.bytes], [...bytes]);
  assert.equal(file.crc, crc32(bytes));
});

test('the signatures are where a reader looks for them', () => {
  const zip = writeZip([{ name: 'a', bytes: say('x') }]);
  const view = new DataView(zip.buffer);

  assert.equal(view.getUint32(0, true), 0x04034b50, 'no local header');
  // The end record is the last twenty-two bytes when there is no comment.
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50, 'no end record');
  // And the directory it points at really is one.
  const where = view.getUint32(zip.length - 22 + 16, true);
  assert.equal(view.getUint32(where, true), 0x02014b50, 'the directory is not there');
});

test('the archive is exactly as long as its parts', () => {
  const files = [
    { name: 'one', bytes: say('abc') },
    { name: 'a/longer/name.wav', bytes: new Uint8Array(100) },
  ];
  const zip = writeZip(files);

  const expected = files.reduce(
    (sum, file) => sum + 30 + file.name.length + file.bytes.length + 46 + file.name.length,
    22,
  );
  assert.equal(zip.length, expected);
});

test('an empty archive is still an archive', () => {
  const zip = writeZip([]);
  assert.equal(zip.length, 22);
  assert.deepEqual(readZip(zip), []);
});

test('a name with a backslash in it becomes a folder, not a strange file', () => {
  const [file] = readZip(writeZip([{ name: 'stems\\kit.wav', bytes: say('x') }]));
  assert.equal(file.name, 'stems/kit.wav');
});

test('a name with something other than ASCII in it survives', () => {
  const [file] = readZip(writeZip([{ name: 'séance — pad.wav', bytes: say('x') }]));
  assert.equal(file.name, 'séance — pad.wav');
});

test('the date is the one MS-DOS could store, and never before 1980', () => {
  const { time, day } = dosTime(new Date(2026, 9, 22, 14, 35, 20));
  assert.equal((time >> 11) & 0x1f, 14);
  assert.equal((time >> 5) & 0x3f, 35);
  assert.equal((time & 0x1f) * 2, 20);
  assert.equal(((day >> 9) & 0x7f) + 1980, 2026);
  assert.equal((day >> 5) & 0x0f, 10);
  assert.equal(day & 0x1f, 22);

  // The format has no way to say 1970.
  assert.equal(((dosTime(new Date(1970, 0, 1)).day >> 9) & 0x7f) + 1980, 1980);
});

test('something that is not an archive reads as nothing', () => {
  assert.equal(readZip(new Uint8Array(100)), null);
});

test('the end record says where the directory is and how long it really is', () => {
  // The field that round-trips fine through any reader using the count and
  // the offset, and that `unzip` refuses outright when it is wrong.
  const zip = writeZip([
    { name: 'one', bytes: say('abc') },
    { name: 'two', bytes: new Uint8Array(300) },
    { name: 'three', bytes: say('x') },
  ]);
  const view = new DataView(zip.buffer);
  const end = zip.length - 22;

  const size = view.getUint32(end + 12, true);
  const where = view.getUint32(end + 16, true);

  assert.equal(where + size, end, 'the directory does not end where the end record begins');
  assert.equal(view.getUint16(end + 8, true), 3);
  assert.equal(view.getUint16(end + 10, true), 3);
});

test('nothing is written past the end record', () => {
  // An over-allocated buffer leaves zeroes after it, and a reader scanning
  // backwards for the signature reports a truncated archive.
  const zip = writeZip([{ name: 'a', bytes: say('hello') }]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
});

test('two tracks called the same thing do not become one file', () => {
  // Nothing stops two tracks sharing a name, and now that tracks are added
  // by hand it is likely - a second synth gets called Synth. Two files of
  // the same name in one archive is one of them lost, quietly, at whichever
  // end unzips it.
  assert.deepEqual(
    distinct(['Synth', 'Synth', 'Kit', 'synth', 'Synth']),
    ['synth', 'synth-2', 'kit', 'synth-3', 'synth-4'],
  );

  // And a name that is nothing at all still lands somewhere.
  assert.deepEqual(distinct(['', '']), ['track', 'track-2']);
});
